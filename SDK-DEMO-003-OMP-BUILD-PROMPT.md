# SDK-DEMO-003 — OMP Build Handoff

**Handoff from AVIS → OMP. Read this whole document before touching anything.**

You are continuing a build that is already partially complete. Do not redo P0–P2
or the P3 service layer or the P5 renderer. Pick up at **Phase 1** below and work
phase-by-phase, stopping to report at every `STOP AND REPORT` gate.

---

## 0. Mission

Build SDK-DEMO-003: a reference SDK demonstration that runs against the
**current ResonantOS `dev`** and *consumes* the platform's existing manifest,
registry, host-policy, capability, endpoint-guard, bridge, and extension
mechanisms. The demo **does not create** a parallel architecture.

Acceptance (final): a developer can check out this branch, follow the README,
load the real ResonantOS extension, run multiple SDK examples, observe real
host-owned authorization and denial, and reproduce the demo without exposing
host secrets, creating a second trust model, weakening route auditing, or
regressing existing behavior.

---

## 1. Current state — read first

| Fact | Value |
| --- | --- |
| Repo | `/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha` (the main checkout — **not** a worktree) |
| Branch | `r-and-d/sdk-demo-003-current-dev` |
| HEAD | `65ceae43` (pushed to `origin/r-and-d/sdk-demo-003-current-dev`) |
| Base | `upstream/dev @ 19665c06` (current alpha) |
| Remotes | `origin` = `vonstegen/2.0.0-alpha` (your fork). `upstream` = `ResonantOS/2.0.0-alpha` (fetch-only, never push) |
| Node | repo requires `>=24.21.0`. nvm only has 22. Use Homebrew: `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"` (Node 26) |

**Already done (do NOT redo):**

- **P0** baseline — `upstream/dev @ 19665c06`, build + vitest 721/721 + browser-host 13/13.
- **P1** architecture map — `SDK-DEMO-003-ARCHITECTURE-MAP.md` (repo root). Read it; it is the file inventory and the 002-findings disposition table.
- **P2** scaffold — `examples/sdk-demo/README.md`, `echo/addon.json` (valid `AddOnSdkManifest`), `tests/echo-manifest.test.ts`, `vitest.config.ts`.
- **P3 service layer** — `examples/sdk-demo/echo/server.mjs` (operator-started loopback echo; `/health`, `/`, `POST /api/echo/message`; **no ACAO**), `tests/echo-roundtrip.test.ts`.
- **P5 renderer** — `browser-first/resonantos-side-panel-extension/src/lib/addon-iframe-workspace.js` (cross-origin sandboxed iframe + postMessage bootstrap), `examples/sdk-demo/echo/index.html` (bootstrap listener + round-trip), `tests/echo-workspace.test.ts`.

**Demo tests (must stay green):**
`npx vitest run --config examples/sdk-demo/vitest.config.ts` → currently **9/9 passing**.

---

## 2. Non-negotiable constraints (do not violate any)

1. **No second add-on registry, manifest schema, capability system, or bridge launcher.** Reuse `AddOnManifest` (`src/core/contracts.ts`), `validateAddOnManifest` (`packages/addon-sdk/src/validation.ts`), and the host-owned `createHarnessRegistry` / capability-token paths.
2. **No manifest-controlled command execution.** Add-ons declare `service.entrypoint` / `agentRuntime.endpoint`; the operator starts them. The bridge never `spawn`s an add-on.
3. **No `process.env` inheritance into add-ons.** The launcher must not spread `parentEnv` into add-on processes or export capability tokens as env vars.
4. **No self-granted capabilities.** `requestedCapabilities` are authored `granted: false`; grants are host-owned (`setGrants(consent)`), revocable, policy-enforced.
5. **No universal/shared capability token crossing add-on/audience boundaries.** Each add-on's grant is scoped; Echo's credential must not authorize Counter/Guide.
6. **No demo route may replace or disable Hermes/dashboard behavior.** Run the Hermes regression gate in P8.
7. **No manifest-created unauthenticated bridge mirror path.**
8. **No security acceptance test may pass solely through mocks** when a real host boundary can be exercised. Use real-extension (Playwright) tests.
9. **The SDK Guide's denied operation must be rejected by real host policy**, not a hard-coded `403`.
10. **Keep credentials out of served HTML and URLs.** Deliver capability tokens only via `postMessage` with pinned `targetOrigin`.

## 3. Security model (the verified 002-FIX-2 shape)

- Workspace add-on iframe: `sandbox="allow-scripts allow-same-origin"`, `src` = the add-on's own upstream origin. `allow-same-origin` is safe because the iframe origin equals the upstream origin, not the extension origin.
- Parent mints capability tokens via the bridge, delivers `{ type: "resonantos-addon-bootstrap", apiBasePath, capabilityTokens }` with `targetOrigin` = add-on origin.
- Add-on validates `event.source === window.parent` **and** `event.data.type === "resonantos-addon-bootstrap"`.
- No `Access-Control-Allow-Origin` on upstreams. Bridge token never reaches the add-on. No token in HTML/URL.

The existing bridge-proxy/srcdoc renderer (`addon-iframe.js`) and Hermes/OpenCode paths must remain untouched.

---

## 4. Build plan (phase-by-phase)

### Phase 1 — P3 wiring: make Echo round-trip in the extension  ·  gate CP3

Connect the pieces that already exist. Deliverables:

1. **Generic discovery** (Approach A): the bridge exposes workspace add-ons
   generically — read add-on manifests from a canonical repo location
   (`examples/sdk-demo/*/addon.json`), validate with `validateAddOnManifest`,
   and expose `{ id, name, entrypoint, requestedCapabilities, available }` for
   each `local-service` add-on. No spawn, no env spread, no per-ID branch.
   Decide the cleanest seam (extend `GET /addons/status` vs. a new route) and
   document the choice.
2. **Generic workspace resolver**: in
   `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-addons.js`,
   replace the hard-coded `workspaceForAddon()` with a registry-driven resolver:
   a `local-service` add-on with `service.entrypoint` opens via
   `createWorkspaceAddonIframe({ addonOrigin: entrypoint, ... })`. Keep
   hermes/opencode/living-archive behavior unchanged.
3. **Capability delivery**: the parent mints the add-on's granted capabilities
   via `POST /api/capability-tokens` and calls `deliverBootstrap({ apiBasePath,
   capabilityTokens })` (with a re-deliver on the add-on's `resonantos-addon-ready`
   ping to avoid the load/race).
4. **Real-extension test**: load the actual unpacked extension in Chrome, open
   Resonant Echo, type a message, click SEND, assert the echo renders.

**CP3 gate (all must pass):** Echo is discovered generically; the cross-origin
iframe renders; the round-trip works in the real extension; Hermes/OpenCode/Living
Archive still work; `examples/sdk-demo` tests + `test:browser-first` green.

`STOP AND REPORT` here.

### Phase 2 — P4 Counter  ·  gate CP4

Add `examples/sdk-demo/counter/` (manifest + server + index.html + tests) as a
second, independent `local-service` add-on through the **same** generic path.
Prove isolation: Echo's credential cannot call Counter's API and vice versa.

`STOP AND REPORT` here.

### Phase 3 — P6 Capabilities (real grant/deny/revoke)  ·  gate CP6

Demonstrate, against the actual host: request → consent → grant → enforcement →
revocation. Echo's `network` grant is host-owned; a denied capability fails
closed with 403; revoking a capability makes the formerly-working operation fail.

`STOP AND REPORT` here.

### Phase 4 — P7 SDK Guide  ·  gate CP7

`examples/sdk-demo/sdk-guide/` — interactive tutorial that walks discovery →
validation → request → grant → sandboxed UI → authorized call → denied call →
revocation. The denial must be a **real host policy rejection**.

`STOP AND REPORT` here.

### Phase 5 — P8 Adversarial gate  ·  gate CP8

Deliberately attack, and prove each fails safely while legit operations work:
read bridge/provider secrets from add-on context; cross-add-on credential reuse;
use-after-revocation; unauthorized capability; forged postMessage origin/source;
arbitrary runtime/executable declaration; unauthorized mirror route; missing/
malformed credentials; add-on crash + bridge restart; port collision; **Hermes
with all demo add-ons active**; the honest route-capability audit with demo
routes included.

`STOP AND REPORT` here.

### Phase 6 — P9 Live demo  ·  gate CP9

Clean checkout → README-only setup → real unpacked extension → Echo + Counter +
SDK Guide + denial + revocation all demonstrated.

`STOP AND REPORT` here.

### Phase 7 — P10 Integration review  ·  gate CP10

Disposition every SDK-DEMO-002 finding (fixed / removed / not-applicable /
upstream-owned) with evidence. Audit the diff for unnecessary core changes.
Full build + test + security + regression suite green. Prepare PR notes — **do
not merge or open a PR automatically.**

---

## 5. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npm ci
npx vitest run --config examples/sdk-demo/vitest.config.ts   # demo tests (9/9 now)
npm run build
npm test                                                     # vitest
npm run test:browser-host
npm run test:browser-first
npm run browser-first:audit-scope
```

---

## 6. Verification discipline (non-optional)

- **Never trust a green number you did not produce yourself.** Re-run the exact
  command and paste the tail.
- **Real-browser tests must load the actual unpacked extension** (no
  `--disable-extensions`, no `Page.addScriptToEvaluateOnNewDocument`).
- **No mock bridge that skips auth/CORS/origin checks** for security assertions.
- **Do not weaken a test to make it pass.** Record known failures exactly.
- **Commit per phase** with a `feat(sdk-demo-003):` / `fix(sdk-demo-003):` message.
- **Push only after a phase gate passes** (fast-forward; no force).
- **Never push to `dev`/`main` or to `upstream`.**

## 7. STOP AND REPORT

At each gate, report: the exact commits, the exact commands run and their output
tails, what changed (files), what you verified in the real browser, and any
known limitations — before continuing to the next phase.
