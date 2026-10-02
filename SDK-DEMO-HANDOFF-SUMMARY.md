# ResonantOS SDK Demo — Handoff Summary

A self-contained summary of the ResonantOS 2.0.0 Alpha SDK work discussed on
2026-09-28: what was built, what the architecture/security model is, and what
remains to build for a realistic SDK demo. Written for hand-off to a reviewer
(ChatGPT or another engineer) with no conversation context.

## 1. Goal

Demonstrate the ResonantOS add-on SDK end-to-end with a **pi.dev** coding-harness
add-on, and converge on a design where **harness-style add-ons (Augmentor, pi.dev,
Claude Code, OpenCode, Codex) are one first-class SDK category** that can be
installed, enabled/disabled, and swapped as the active agent.

## 2. Repository and runtime facts

- Repo: `2.0.0-alpha` (branch `r-and-d/sdk-demo-003-current-dev`).
- Runtime = a Chrome Manifest V3 extension
  (`browser-first/resonantos-side-panel-extension`) plus an authenticated local
  Node.js bridge (`browser-first/host/`, launched by `run-bridge-minimal.mjs`).
- Node **>= 24.21.0** is required. The bridge imports `.ts` SDK files, so Node 22
  fails with `ERR_UNKNOWN_FILE_EXTENSION`. Use the Homebrew node
  (`/opt/homebrew/bin/node`, v26.0.0); the default nvm node (v22.13.0) does not
  work.
- The SDK package is `packages/addon-sdk/` (`@resonantos/addon-sdk`, not yet
  published). It is declarative-only: manifest contract (`AddOnSdkManifest`),
  capability model, `validateAddOnManifest`, registry/surface-routing helpers.
  The runtime kernel (grants, bridge, adapters, delegation) is host code, not in
  the SDK.

## 3. What exists and works today

### 3.1 Workspace local-service add-ons (SDK demo)

Discovered from `examples/sdk-demo/*/addon.json` by
`browser-first/host/workspace-addon-discovery.mjs`. The lifecycle works: manifest
validation, discovery, host-owned grant (`/addons/workspace/grant`, `consent:
true`), sandboxed cross-origin iframe + `postMessage` bootstrap, and revocation.

- `addon.resonant-echo` (port 47321), `addon.resonant-counter` (47322),
  `addon.sdk-guide` (47323) — pre-existing SDK-DEMO-003.
- `addon.resonant-pi` (`examples/sdk-demo/pi/`, port 47324) — a **local-service
  Pi demo** built this session. It was renamed from `addon.pi` to
  `addon.resonant-pi` to avoid an id collision with the harness-provider below.

### 3.2 pi.dev as a harness-provider (primary-agent swap)

The "replace Augmentor" path, built this session:

- `browser-first/host/harness-examples/pi.json` — SDK manifest: `id: addon.pi`,
  `systemSlots: [primary-agent, chat-interface]`,
  `agentRuntime.adapterId: "openai-compatible-v1"`, `authScheme: "bearer"`,
  `endpoint: http://127.0.0.1:47326`, `credentialBinding: "pi.dev"`.
- `browser-first/host/harness-examples/pi-server.mjs` — operator-started loopback
  wrapper that speaks the OpenAI-compatible SSE contract and drives `pi -p`
  (with a deterministic stub fallback when `PI_LIVE != "1"`).
- `browser-first/host/harness-host-service.mjs` — added `pi` to the
  `RESONANTOS_HARNESS_DEMO` catalog array.
- `scripts/pi-swap-demo.mjs` — drives install → grant → `assignSlot('primary-agent',
  'addon.pi')` against the running bridge and verifies the result.

This **was demonstrated working**: `primary-agent = addon.pi`,
`governanceActivated: true`, all three declared capabilities granted. The governed
chat now routes through the pi wrapper (stub reply until a real provider is wired).

### 3.3 OpenCode (the credential model to copy)

OpenCode v1.18.4 is installed at `~/.local/bin/opencode` and discovered by the
bridge (`opencode-runtime.mjs`, fixed install roots). It **self-authenticates**
via `~/.opencode/auth.json` (`opencode auth login`; the machine is authed to
OpenRouter) and was verified working with `opencode run -m
openrouter/openai/gpt-5.4-mini "…"`. This is the credential pattern the design
below adopts for pi.dev.

## 4. Architecture and security model (the mental model)

### 4.1 Three add-on shapes

| Shape | Expressed by | Host subsystem |
| --- | --- | --- |
| Workspace local-service | `service.entrypoint` (`http-json`) | discovery + iframe + bootstrap |
| Harness-provider (alternative provider) | `agentRuntime` + `systemSlots` | harness registry, `primary-agent` slot |
| Delegation runtime (coding CLI) | **hardcoded, not a manifest** | `execOpenCodeCli` / `execHermesCli` |

OpenCode and Hermes are **not SDK add-ons**; they are hardcoded host lanes. That
is the gap ADR-039 closes.

### 4.2 Two credential systems

| System | Source | Persistence | Consumers |
| --- | --- | --- | --- |
| Provider Profiles (Settings → Providers) | user-entered / env | session-only host memory | `provider-fabric-v1` (Augmentor), OpenCode/Hermes delegation |
| Harness bindings (`RESONANTOS_HARNESS_BINDINGS` + `credentialBinding`) | operator file/env | operator-managed | harness-provider adapters (`dsh-typert-v1`, `openai-compatible-v1`) |

### 4.3 Security boundary (non-negotiables)

- Provider secrets are **session-only** and never persisted by the alpha host.
- The bridge **does not load dotenv**; secrets come from Settings → Providers or
  process env (deliberate).
- Provider keys reach external CLIs only through a **scoped env allowlist**
  (`env-clear`), to a **fixed-install-root**, `sandbox-exec`-isolated binary,
  behind an **explicit execution-enable** gate.
- Harness CLIs **self-authenticate** (`pi auth`, `opencode auth login`), so the
  bridge does not hold their provider key.
- "First-party does not imply privileged" (ADR-038); request/grant types are
  structurally separate; Core-only capabilities are not requestable.

## 5. The design proposal (ADR-039, Proposed / Deferred)

`docs/architecture/ADR-039-harness-addon-category-swappable-default-agent.md`.

1. **One `harness` category** — `runtimeType: "harness"` + a `harnessRuntime`
   descriptor with two variants:
   - `provider` (host-mediated, Provider Profiles, no spawn) — Augmentor.
   - `cli` (`stdio-json-rpc` / `host-command`, self-auth + scoped env, fixed-root
     spawn) — pi.dev, Claude Code, OpenCode, Codex.
2. **Augmentor as a default-owner add-on** — bundle `addon.augmentor-chat`
   (`provider-fabric-v1`), installed/granted/assigned `primary-agent` at first
   run, so the swap is symmetric and the `!governanceActivated` fallback becomes
   recovery-only.
3. **Two orthogonal on/off axes** — enable/disable is **multi** (many harnesses
   running at once, each with a tools tab + workspace), while `primary-agent` is
   **single** (the default chat brain). A picker provides toggles (multi) + a
   selector (single).
4. **Security boundary** — the `cli` variant reuses the OpenCode controls
   (fixed root, `env-clear`, execution gate, sandbox) rather than a generic
   `command`; provider secrets stay session-only; CLIs self-authenticate.
5. **Migration** — add the category to the SDK contract + validator; ship
   `addon.augmentor-chat`; re-express OpenCode (then Hermes, pi, Claude, Codex) as
   harness manifests; add the picker; add per-harness security-pipeline records;
   retire the pi wrapper + `credentialBinding` hack.

## 6. What remains to build (for a realistic demo)

Ranked, roughly by dependency:

1. **SDK contract + validator** — add `runtimeType: "harness"` and `harnessRuntime`
   to `packages/addon-sdk/src/contracts.ts` / `src/core/contracts.ts`, with
   rejection tests (no ambient `PATH`/`command`, no `granted: true` self-grant).
2. **`addon.augmentor-chat`** — a bundled default-owner harness manifest so the
   `primary-agent` slot is populated from first boot.
3. **Re-express OpenCode as a `cli` harness manifest** — keep its existing
   boundary code (`opencode-boundary.mjs`, session routes) as the enforcement
   layer, but drive it through the same install/grant/slot path.
4. **Re-express pi.dev as a `cli` harness** — `pi` self-auths (`pi auth`), provider
   key from Settings → Providers via scoped env; remove the
   `openai-compatible-v1` wrapper and `RESONANTOS_HARNESS_BINDINGS`.
5. **Agent/Harness picker UI** — enable/disable toggles (multi) + primary-agent
   selector (single), over the existing `/addons/{install,enabled,grants,
   slots/assign,remove}` routes.
6. **Security-pipeline records** — one `env-clear` + fixed-root + spawn record per
   `cli` harness, mirroring `opencode-cli`.
7. **Live pi.dev** — replace the stub with the real `pi` CLI behind the harness
   manifest (or an operator-started `stdio-json-rpc` service), and confirm a real
   200 answer through the governed chat.

### Stretch / optional

- Add Claude Code and Codex as additional `cli` harnesses to prove the category is
  generic.
- The request/grant type separation from ADR-038 (prerequisite, tracked
  separately).

## 7. Open decisions for the reviewer

1. For the `cli` variant: **spawn** (`stdio-json-rpc`, most faithful to pi.dev)
   vs **operator-started loopback endpoint** (keeps the existing "no spawn for
   add-ons" posture). The ADR allows both; the security cost of spawn is the key
   tradeoff.
2. Picker UX: a single "Agent" selector vs. per-harness tabs, and how it coexists
   with the existing OpenCode/Hermes delegation workspaces.
3. Which harnesses ship as bundled catalog entries vs. sideloaded examples.
4. Whether "primary-agent swap" and "delegation runtime" should be the same
   category or two sub-variants of `harness` (the ADR says two variants).

## 8. How to run what exists today

```bash
cd ~/Developer/Projects/resonant-os/2.0.0-alpha
export PATH="/opt/homebrew/bin:$PATH"   # Node 26

# Terminal 1 — bridge (harness demo + pi binding)
RESONANTOS_HARNESS_DEMO=1 \
PI_BEARER=demo-pi-bearer \
RESONANTOS_HARNESS_BINDINGS='[{"name":"pi.dev","addonId":"addon.pi","adapterId":"openai-compatible-v1","authScheme":"bearer","endpoint":"http://127.0.0.1:47326","source":{"env":"PI_BEARER"}}]' \
node browser-first/host/run-bridge-minimal.mjs \
  --pi-bearer-token=demo-pi-bearer --pi-admin-token=demo-pi-admin

# Terminal 2 — pi wrapper (stub unless PI_LIVE=1)
node browser-first/host/harness-examples/pi-server.mjs --pi-bearer-token=demo-pi-bearer

# Terminal 3 — perform the primary-agent swap (install → grant → assign)
node scripts/pi-swap-demo.mjs
```

Then load `browser-first/resonantos-side-panel-extension` unpacked in Chrome,
reload, and send a message in Augmentor chat (routes through the pi stub).

## 9. Key files

- `packages/addon-sdk/src/contracts.ts`, `validation.ts` — SDK contract + validator.
- `src/core/contracts.ts` — canonical `AddOnManifest` (runtime types, slots, adapters).
- `browser-first/host/harness-registry.mjs`, `harness-policy.mjs`,
  `harness-host-service.mjs` — the governed registry, slots, and chat.
- `browser-first/host/addon-delegation-service.mjs` — OpenCode/Hermes delegation lanes.
- `browser-first/host/opencode-runtime.mjs`, `opencode-boundary.mjs` — OpenCode discovery + boundary.
- `browser-first/host/harness-examples/` — pi.json, pi-server.mjs (this session).
- `scripts/pi-swap-demo.mjs` — the swap driver (this session).
- `docs/architecture/ADR-026-…`, `ADR-038-…`, `ADR-039-…` — replaceable defaults, boundary/invariants, and the new harness-category proposal.
