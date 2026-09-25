# SDK-DEMO-003 — Architecture Map

**Branch:** `r-and-d/sdk-demo-003-current-dev`
**Base:** `upstream/dev @ 19665c06` (2026-09-24)
**Status:** P0 baseline frozen + P1 architecture inventory complete. This document is the implementation contract for P2 onward.

This document records, from repository evidence only, where the current `dev`
architecture implements each SDK concept, and where SDK-DEMO-002's reusable
browser-side mechanism is **not** yet present. It does not modify code.

---

## 1. P0 — Baseline (CP0)

| Item | Result |
| --- | --- |
| Base SHA | `19665c06` (`upstream/dev`, 2026-09-24, 241 commits ahead of stale `origin/dev @ 6aa0bb68`) |
| Worktree | `2.0.0-alpha.worktrees/sdk-demo-003-current-dev` |
| Required Node | `>=24.21.0` (`.nvmrc` = `24.21.0`; `packages/addon-sdk` also declares `>=24.21.0`) |
| Node used | `v26.0.0` (Homebrew `/opt/homebrew/bin/node`; nvm only has `v22.13.0`, which is **below** the requirement) |
| `npm ci` | PASS — 278 packages, 0 vulnerabilities |
| `npm run build` | PASS — `tsc` + Vite (394 modules, 8.15s) |
| `npm test` (Vitest) | PASS — 721/721 (48 files) |
| `npm run test:browser-host` | PASS — 13/13 |
| `npm run test:browser-first` | 2168/2169 — 1 pre-existing failure (see below) |

**Baseline environment note (not a demo defect).** The single `test:browser-first`
failure is `openai-harness-adapter.test.mjs` → "split SSE and cancellation retain
bounded ownership over a real loopback server". It fails deterministically in
isolation on this machine under Node 26 (`deadline-exceeded` instead of a
`final` frame). This is a pre-existing upstream timing-sensitive test, not
touched by this milestone. It should be re-verified on the pinned Node 24.21.0
before it is treated as a real regression.

---

## 2. Architecture Inventory (CP1)

The current `dev` already contains the **host-aligned** model that the
SDK-DEMO-002 review said to build against. The mapping below is authoritative
for the phases that follow.

### 2.1 Public SDK surface — `packages/addon-sdk/` (the author-facing contract)

This is the canonical, declarative-only SDK package (ADR-055 §12.1 C12 "Public
SDK External Boundary"; ADR-056 §3). It is **not yet published** to npm.

| File | Responsibility |
| --- | --- |
| `packages/addon-sdk/src/contracts.ts` | `AddOnSdkManifest`, `ADDON_CAPABILITIES`, `ADDON_SERVICE_PROTOCOLS`, validation result types |
| `packages/addon-sdk/src/validation.ts` | `validateAddOnManifest` / `assertValidAddOnManifest` (deterministic, ~1268 lines) |
| `packages/addon-sdk/src/registry.ts` | `createAddOnRegistryEntry`, `createAddOnRegistrySnapshot` |
| `packages/addon-sdk/src/surface-routing.ts` | `createAddOnSurfaceDockRoutes` (host projection is sole authority) |
| `packages/addon-sdk/src/index.ts` | re-exports the above |

`src/sdk/addons/*.ts` are **re-export shims** to this package (soft cutover);
tests under `src/sdk/addons/*.test.ts` keep working through the shims.

**Capability model.** `ADDON_CAPABILITIES` (14, declared in
`packages/addon-sdk/src/contracts.ts`, type `Capability` in
`src/core/contracts.ts`):

```
filesystem, archive-read, archive-intake-write, chat-interface, memory-provider,
providers, shell, network, ui-embedding, browser-control, agent-delegation,
agent-runtime, notifications, device-integration
```

Each grant is a `CapabilityGrant { capability, granted, scope, revocationBehavior }`
with `CapabilityScope` (`none|self|workspace|shared|system|intake-only`) and
`RevocationBehavior` (`hard-stop|degrade|hide-surface`).

### 2.2 Core manifest contract — `src/core/contracts.ts`

`AddOnManifest` (line 619) is the authority. It carries **requests, never
grants**: `requestedCapabilities: CapabilityGrant[]` (authored with
`granted: false`), plus `grantPresets` (host-approvable presets). The runtime
and workspace models are declared as endpoints, not spawned commands:

- `service?: AddOnLocalServiceDefinition { protocol, entrypoint, ... }` — an
  endpoint URL, not a `runtime.command`.
- `agentRuntime?: AddOnAgentRuntimeContract { adapterId, authScheme, endpoint,
  supportedOperations, ... }` — the harness runtime contract.
- `embeddedWorkspace?: AddOnEmbeddedWorkspaceContract { surfaceId, mode,
  requiredCapabilities, ... }`.
- `provenance`, `runtimeIsolation`, `systemSlots`, `delegation`, `tools`,
  `hooks`, `install`, `audit`, `memoryAccess`, `smokeTests`, `compatibility`,
  `agents`.

`AddOnInstallation` (line 2268) holds the **host-owned** grants
(`grantedCapabilities`), separate from the manifest's `requestedCapabilities`.

### 2.3 Host authority — `browser-first/host/`

The runtime kernel is host-owned and is **not** in the SDK package (ADR-055 §7
Runtime Boundary). Privilege enforcement lives here.

| File | Responsibility |
| --- | --- |
| `bridge-capability-tokens.mjs` | `BRIDGE_CAPABILITY_TOKEN_SPECS` (27 bridge capabilities) → single mint map. Each capability-scoped bridge route declares `requiredCapability`; the extension requests exactly these via `POST /api/capability-tokens`. |
| `harness-registry.mjs` | `createHarnessRegistry` — durable host-owned registry. `install()` normalizes requests to `granted: false`; `setGrants()` requires `consent === true` + expected revision; `assignSlot()` gates replacement; `snapshot()` emits `grantedCapabilities` + policy. |
| `harness-policy.mjs` | Pure policy: computes `disabledOperations` + `hiddenSurfaceIds` from host-owned grants and manifest dependencies; implements revocation behavior. |
| `harness-boundary.mjs` | `createHarnessBoundary` — session/authz enforcement over the registry (signed session references, `timingSafeEqual`, revocation fences). |
| `agent-runtime-endpoint.mjs` | `createAgentRuntimeEndpoint` — **the shared outbound endpoint guard**: loopback-only hostname, http/https + port, no credentials, origin-snapshot, redirect-refusing, DNS re-resolved and validated as loopback. |
| `external-agent-runtime-dispatcher.mjs` | `findAddonManifest` (validates `addonId` vs traversal), `dispatchExternalAgentRuntime`, `checkToolGrants` — the external-agent-runtime dispatch path. |
| `addon-delegation-service.mjs` / `-host-service.mjs` | Host-mediated add-on delegation (Hermes/OpenCode paths use `sandbox-exec` isolation). |
| `run-bridge-minimal.mjs` | Launcher. Composes `harnessRoutes` + provider/memory/delegation/etc. routes. `spawn` is used only for the OpenCode server, **not** for arbitrary workspace add-ons. No `~/ResonantOS_User/BrowserFirst/addons` scan, no `runtime.command` execution, no `process.env` spread into add-ons. |

### 2.4 Bridge route/capability audit

`browser-first/test/bridge-route-capability-audit.test.mjs` honestly enumerates
every bridge handler group (`memoryHandlers`, `addonHandlers`, …) and checks
`capabilityForBridgeRoute` (in
`browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`) maps
each route to a capability. This is the honest audit the 002 review said had
been evaded (`workspaceAddonManifests: []`); current `dev` has no such bypass.

### 2.5 Extension renderer — `browser-first/resonantos-side-panel-extension/`

- Add-ons panel: `src/lib/main-workspace-addons.js` — registry/display view.
  `workspaceForAddon()` hard-codes `addon.hermes → "hermes"`,
  `addon.opencode → "opencode"`, `addon.living-archive → "memory"`, and returns
  `""` for everything else → **generic add-ons have no workspace launcher yet**.
- Add-on iframe: `src/lib/addon-iframe.js` — `buildAddonSrcdoc()` uses an
  `srcdoc` iframe with an inline `<script>` preamble. This is the **pre-002**
  mechanism that the 002 review found broken under the extension CSP
  (`script-src 'self'` drops inline scripts). It is **not** the cross-origin
  `src` + `postMessage` bootstrap renderer that 002 built and verified.
- `src/lib/bridge-client.js` — bridge token allowlist (`RUNTIME_CAPABILITY_ALLOWLIST`
  derived from `BRIDGE_ROUTE_CAPABILITIES`) and `capabilityForBridgeRoute`.
- Bundled content-script add-ons `src/addons/resonant-context/addon.json` and
  `src/addons/resonator/addon.json` use a **separate, simpler manifest schema**
  (`mode`, `trust`, `contentScripts`, `capabilities[]`) — the "second manifest
  schema" the review flagged. These are page-observer/overlay add-ons, a
  distinct category from SDK workspace add-ons.

### 2.6 Existing reference examples — `examples/addons/`

Three manifests already model the correct host-aligned pattern (requests +
grant presets + endpoint, no self-grant, no spawn):

- `recursive-mas.json` — `runtimeType: local-service`, `service.entrypoint:
  http://127.0.0.1:4891`, requests all `granted: false`, `grantPresets` with
  `granted: true`, `delegation`, `tools`, `systemSlots`, `agents`.
- `openai-compatible-harness.json` — `agentRuntime.endpoint:
  http://127.0.0.1:8000`, `systemSlots` (primary-agent / chat-interface),
  description explicitly: "this manifest grants no authority".
- `reference-memory.json` — memory-provider slot owner with `grantPresets`.

These are the pattern SDK-DEMO-003's Echo/Counter/Guide must follow.

---

## 3. Mapping 002 findings → current-dev disposition

| # | 002 finding | Current-dev state | 003 action |
| --- | --- | --- | --- |
| 1 | env + all tokens leaked to add-on | launcher does not spread `process.env` into add-ons | keep; prove in P8 |
| 2 | RCE by `runtime.command` spawn | manifests declare `service.entrypoint` / `agentRuntime.endpoint`; no spawn | keep; add-on runs as operator-started endpoint |
| 3 | route audit evaded | audit enumerates all handler groups honestly | keep; add demo routes to the audit |
| 4 | one shared unbound bearer token | per-capability bridge tokens (27) + host grant/authorization per add-on | keep; per-add-on authz via harness registry |
| 5 | self-declared grants | requests `granted:false`; grants host-owned via `setGrants(consent)` | keep; P6 exercises real grant/deny/revoke |
| 6 | add-on replaces Hermes proxy | no workspace-proxy-replacement path in launcher | keep; P8 asserts Hermes with demos active |
| 7 | manifest-declared open mirror paths | no manifest-driven mirror-path mechanism in `bridge-server.mjs` | keep |
| 8 | hard-coded demo denial | n/a (no demo yet) | P7 denial must be a real policy rejection |
| 9 | mock-backed security tests | real-extension Playwright harness exists | port 002's real-extension tests |
| 10 | lifecycle/hygiene | delegation paths use `sandbox-exec`; cleanup on `shutdown()` | P8 covers port collision / restart / reload |
| 11 | merge collisions | branch is from current `upstream/dev` (no 235-commit divergence) | no rebase debt |

---

## 4. Gaps 003 must close (P2–P10)

1. **Cross-origin renderer is absent.** Current `addon-iframe.js` is srcdoc-based
   and CSP-broken for generic add-ons. P5 ports 002's verified cross-origin
   `src` iframe + `postMessage` bootstrap + height propagation + syntax gate
   into the current renderer (with the 002-FIX-2 correction: `sandbox="allow-scripts
   allow-same-origin"` where iframe origin == upstream origin, `targetOrigin`
   set, `event.source` **and** `event.origin` validated, no ACAO, no token in
   HTML/URL).
2. **Generic workspace launcher.** `workspaceForAddon()` only knows three Core
   add-ons. P3/P4 need a generic "open workspace" path driven by the registry
   snapshot (`embeddedWorkspace` + `agentRuntime`/`service.entrypoint`), not a
   per-ID branch.
3. **Demo folder.** A canonical SDK examples location (P2) holding
   `echo`, `counter`, `sdk-guide` built against `AddOnSdkManifest` and the host
   registry — no second manifest schema, no second registry.
4. **Real capability demonstration.** P6 drives request → host consent → grant
   → enforcement → revocation through the harness registry, with a real (not
   hard-coded) denial.
5. **Adversarial + live gates.** P8/P9 reproduce the 002 red-team checklist and
   the real unpacked-extension demo against the current bridge.

---

## 5. Key file inventory (authoritative)

| Concept | File(s) |
| --- | --- |
| Manifest contract | `src/core/contracts.ts` (`AddOnManifest` L619, `CapabilityGrant` L250, `Capability` L4, `AddOnInstallation` L2268) |
| SDK package | `packages/addon-sdk/src/{contracts,validation,registry,surface-routing,index}.ts` |
| Capability tokens | `browser-first/host/bridge-capability-tokens.mjs` |
| Host registry / grants | `browser-first/host/harness-registry.mjs`, `harness-policy.mjs`, `harness-boundary.mjs` |
| Endpoint guard | `browser-first/host/agent-runtime-endpoint.mjs` |
| External runtimes | `browser-first/host/external-agent-runtime-dispatcher.mjs` |
| Route audit | `browser-first/test/bridge-route-capability-audit.test.mjs` |
| Extension add-on panel | `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-addons.js` |
| Extension iframe | `browser-first/resonantos-side-panel-extension/src/lib/addon-iframe.js` |
| Extension bridge client | `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js` |
| Reference manifests | `examples/addons/{recursive-mas,openai-compatible-harness,reference-memory}.json` |
| Governing ADRs | `docs/architecture/ADR-018-addon-sdk-v0.md`, `ADR-023-addon-repository-registry-model.md`, `ADR-055-resonant-extension-framework.md`, `ADR-056-provider-fabric-boundary-external-agent-runtimes.md` |

## 6. Phase 3 (P6) — host-owned grants

After P6 the workspace add-on capability surface is host-owned end-to-end.

- **Registry.** `browser-first/host/harness-registry.mjs` is the single
  source of truth for grants. `executeAddonsStatus` calls `registry.install`
  for every discovered workspace add-on. The bridge route `POST
  /addons/workspace/grant` proxies `registry.setGrants(addonId, grants, {
  consent: true, expectedRevision })`. Consent is enforced at the
  registry boundary — `consent: false` throws `permission-denied`.
- **Bootstrap envelope.** The renderer fetches `POST
  /addons/workspace/bootstrap` at workspace-iframe open time. The handler
  returns `capabilityTokens[capability].token` only for capabilities that
  the host has granted. Manifests' `grantPresets` are no longer consulted
  for the bootstrap path; the renderer surfaces the registry snapshot
  in the `Capability contract` chips.
- **Bearer + admin tokens.** Two distinct operator-pinned tokens per
  add-on:
    - **Bearer** — delivered to the iframe via the bootstrap envelope;
      carried as `Authorization: Bearer` on every mutating request. Held
      by the bridge (host side); never reaches the add-on's HTML/URL.
    - **Admin** — gates `POST /admin/deny` on the upstream. Never
      delivered to the iframe; held by the bridge and used to flip the
      upstream's in-memory deny flag via `POST
      /addons/workspace/admin-revoke`.
- **403 is real host policy.** When the host revokes the grant (registry
  path) AND flips the upstream's admin deny flag, the same bearer that
  worked moments earlier returns 403 from `/api/echo/message` or
  `/api/counter/{increment,decrement,reset}`. A bare 401 means "missing
  or wrong bearer"; 403 means "host revoked". The two states are distinct
  and the test exercises both.

### Demo-vs-production honesty (do not over-claim)

The P6 enforcement point is the **add-on's own upstream** (bearer on
mutating routes + admin-gated in-memory deny flag). The bridge calls
`/admin/deny` out-of-band. This is the cleanest mechanism that fits an
operator-started local-service add-on without inventing a second host
transport, and it is what the real-extension test exercises against
unpacked Chrome + a real bridge + both real upstreams.

This is **not** the host-aligned production model. The clean production
model is host-mediated: the add-on's mutating request is proxied through
the bridge's endpoint guard
(`browser-first/host/agent-runtime-endpoint.mjs`) which already enforces
loopback-only, no-follow-redirect, and (for harness adapters) per-binding
credentials. For workspace add-ons the equivalent would be a
`POST /addons/workspace/proxy/{addonId}/api/...` route that the bridge
exposes, the iframe calls (no token), and the bridge validates the
manifest's grant surface + forwards to the upstream with a host-side
token. That is the production-grade shape and is **not what this demo
implements**.

This demo proves: (a) the host-owned registry is the right authority;
(b) consent-gated grant + revoke round-trips through the registry;
(c) the per-add-on audience boundary holds; (d) the upstream can
distinguish 401 (wrong bearer) from 403 (host-revoked) without trusting
the iframe. It does **not** prove: (e) the host is the only path the
mutating request can take (the iframe still has direct loopback access
to its own upstream, which is the operator's choice for local-service
add-ons). Future P-n work would close (e) by routing the iframe's
mutating requests through a bridge-owned proxy that is the only listener
on the upstream's loopback port.

## 7. Phase 4 (P7) — SDK Guide add-on

Phase 4 adds `addon.sdk-guide` — an interactive 9-step tutorial that
**uses** the SDK instead of merely describing it. The guide is the third
local-service add-on on its own loopback port (47323) and reuses the
exact P6 mechanism; no second registry, no second grant surface, no
second manifest schema.

| Step | UI label | Endpoint | Surface proof |
| --- | --- | --- | --- |
| 1 | Discovery | `GET /api/guide/step/1` | workspace-addon-discovery scanned `examples/sdk-demo/*/addon.json`; renderer is generic |
| 2 | Manifest validation | `GET /api/guide/step/2` | `validateAddOnManifest` accepted the guide |
| 3 | Capability request | `GET /api/guide/step/3` | `requestedCapabilities` is declarative; the grant lives in the registry |
| 4 | Host consent | `GET /api/guide/step/4` | registry `setGrants({ consent: false })` throws `permission-denied` |
| 5 | Grant | `GET /api/guide/step/5` + `/health` | registry `setGrants({ consent: true })` flipped `grantedCapabilities[network].granted = true` |
| 6 | Sandboxed UI render | `GET /api/guide/step/6` | iframe = `service.entrypoint`, sandboxed, bootstrap via postMessage with pinned `targetOrigin` |
| 7 | Authorized call | `POST /api/guide/ping` (bearer) | **real 200** from the upstream with the host-minted bearer |
| 8 | Denied call (wrong bearer) | `POST /api/guide/ping` (wrong bearer) | **real 401** — audience-bound credential boundary |
| 9 | Revocation | `POST /api/guide/ping` (bearer, after `/admin/deny`) | **real 403** — host-revoked, distinct from 401 |

### Reused, not invented

- **Manifest schema** — `AddOnSdkManifest` (`packages/addon-sdk/src/validation`).
- **Discovery** — `examples/sdk-demo/*/addon.json` (no per-ID branch in
  `workspace-addon-discovery.mjs`).
- **Host-owned registry** — `harness-registry` (same instance gates
  harness adapters and the three local-service add-ons).
- **Bridge routes** — `POST /addons/workspace/grant`,
  `POST /addons/workspace/admin-revoke`,
  `POST /addons/workspace/bootstrap` (added in P6; reused here).
- **Renderer** — `createWorkspaceAddonIframe` + bootstrap envelope from
  `main-workspace.js` (added in P5/P6; reused here).
- **Per-add-on token model** — operator-pinned bearer + admin tokens are
  threaded through `run-bridge-minimal.mjs`'s `--sdk-guide-bearer-token`
  and `--sdk-guide-admin-token` flags (or `RESONANTOS_DEMO_SDK_GUIDE_{BEARER,ADMIN}`
  env vars). The bridge hands both to `addon-delegation-service.mjs`'s
  `workspaceAddonBearerTokens` / `workspaceAddonAdminTokens` maps;
  the iframe receives only the bearer via the bootstrap envelope; the
  admin token stays bridge-side.

### Educational guarantee

The guide's 9 steps are *not* a UI walkthrough of canned responses.
Every successful or denied outcome the iframe displays is an actual HTTP
response from the operator-started guide upstream — the iframe fetches
`/api/guide/step/{1..6}` directly (public reads), `/api/guide/ping`
directly (bearer-gated mutating), and `/admin/*` indirectly via the
bridge's `admin-revoke` route. The denial/revocation steps hit the
exact same per-add-on audience-bound credential boundary that
`{echo,counter,counter-p6}-extension-live.test.mjs` exercise:

- step 8 (`401 wrong bearer`) is the audience-bound guarantee proof —
  Echo's bearer cannot authorize the guide, nor the guide's bearer
  authorize Echo or Counter.
- step 9 (`403 host-revoked`) is the host-policy revocation proof — the
  same bearer that worked moments earlier now returns 403 after
  `POST /addons/workspace/admin-revoke` flips the upstream's
  `hostGranted` flag through the admin path.

The P7 real-extension test (`sdk-guide-extension-live.test.mjs`) walks
all nine steps in the real unpacked extension; step 7 must report 200,
step 8 must report 401, step 9 must report 403, and step 9's direct
upstream fetch with the bearer after revoke must return 403. No step
is hard-coded; if any of the boundary guarantees regress, step 8 or 9
is the first place a red test appears.

## 8. Phase 5 (P8) — adversarial red-team

Every attack on the trust boundaries fails safely; legitimate SDK
operations continue working. The adversarial suite lives at
`browser-first/test/sd003-p8-adversarial.test.mjs`; the route audit
(`bridge-route-capability-audit.test.mjs`) is upgraded to enumerate the
6 new workspace-addon handlers.

### Attack matrix

| # | Attack | Defensive control | Witness |
| --- | --- | --- | --- |
| 1 | Bridge / admin / provider secrets leak to iframe, HTML, URL, or env | Bootstrap envelope carries only the host-minted bearer; HTML/URL carry nothing; no `process.env` inheritance | `Attack 1` (envelope + index.html scan), `Attack 1 cross-add-on` |
| 2 | Cross-add-on credential reuse (Echo bearer → Counter/Guide) | Per-add-on audience-bound bearer; isolation proof (3-way) | `sdk-guide-roundtrip.test.ts` 3-way isolation group |
| 3 | Use-after-revoke | Two independent channels (registry + admin); bearer never works again until BOTH restored | `Attack 3` (round-trip), `harness-registry-workspace-addon.test.mjs` durable-journal test |
| 4 | Self-grant / grant outside `requestedCapabilities` / grant without `consent: true` | Registry throws `permission-denied`; CAS revision prevents drift | `harness-registry-workspace-addon.test.mjs` (consent:false, outside caps, CAS) |
| 5 | Forged postMessage (wrong source / wrong type) | Iframe rejects `event.source !== window.parent` and `event.data.type !== resonantos-addon-bootstrap`; parent pins `targetOrigin = addonOrigin` (no `"*"`) | `Attack 5` (iframe listener), `Attack 5 parent origin-pin` |
| 6 | Arbitrary `service.entrypoint` / non-loopback / non local-service runtime | Discovery rejects non-loopback entrypoint + non `local-service` runtime | `Attack 6` (throwaway manifests) |
| 7 | Honest route-capability audit | New `executeWorkspaceAddon{Install,Grants,Grant,Revoke,AdminRevoke,Bootstrap}` handlers + their exact `addon-runtime-{control,read}` capabilities enumerated; bridge client knows each route | `bridge-route-capability-audit.test.mjs` (5/5), `Attack 11` |
| 8 | Malformed / missing / case-shifted credentials | Upstreams strict-compare (constant-time); 503 no-bearer / 401 wrong / 200 correct | `Attack 8` |
| 9 | Add-on crash + bridge restart | Restart re-discovers; registry durable journal preserves grants | `harness-registry-workspace-addon.test.mjs` + `addons-status-grant-regression.test.mjs` |
| 10 | Port collision between bridge and another process | Bridge launcher's `startBridgeServerWithFallback` may recover to port 0; the manifest entrypoint is NEVER rewritten by the bridge (attacker can't redirect the iframe to a peer-controlled origin) | `Attack 10` (manifest SHA-256 hash before/after) |
| 11 | Demo add-ons replace or disable Hermes / OpenCode / Living Archive | Three host services still wired and capability-gated alongside the workspace-addon routes; exact capability strings preserved (`addon-runtime-{control,read}`, `archive-read`, `archive-write`) | `Attack 11` (host-service factory construction) |

### Safety guarantee

- No attack is "passed" by weakening a control.
- No mock bridge skips auth/CORS/origin checks.
- No token in HTML / URL / env / postMessage wildcards.
- Hermes / OpenCode / Living Archive are not weakened even after the demo
  add-on routes ship — they remain present and capability-gated.
- The P6 regression test (`addons-status-grant-regression.test.mjs`)
  continues to fail-then-pass the grant-wipe bug, proving the no-second-
  trust-path guarantee is reasserted.
