# OMP Build — iTerm2 SDK Add-on Connection for ResonantOS (v5)

**Handoff from AVIS → OMP. Read this whole document before touching anything.**

Build the iTerm2 terminal host adapter as a ResonantOS **SDK add-on** and prove
the ROS ↔ iTerm2 connection: the session lifecycle works against live iTerm2,
telemetry and the `[ROS]` status indicator flow back to ROS, and no harness (Pi)
is involved yet.

Scope: **Phase 1 (TH-4)** and **Phase 2 (TH-5)** only. Later phases (Pi, Ghostty,
DAR) are in `2.0.0-alpha/prompts/TERMINAL-HOST-OMP-BUILD-PROMPT.md`.

---

## 0. Sources (originating spec — read and verify, not just link)

The architecture is not re-derived here. Read these before building, and confirm
they exist (the §2 verify loop covers them):

- **Terminal Host Contract** — [ADR-040](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md).
  Load-bearing sections (clickable anchors):
  - [Decision](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md#decision) —
    _"Terminal is a replaceable host; ROS is the authority"_: the terminal does
    terminal things; ROS does resource/authority/session/lifecycle things; **a
    harness sees a PTY/shell and never learns which terminal host is attached.**
  - [Rules](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md#rules)
  - [Authorization model](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md#authorization-model)
    (and [New: session bootstrap token](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md#new-session-bootstrap-token))
  - [Migration](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-040-terminal-host-adapter-contract.md#migration)
    (TH-4/TH-5 are the acceptance milestones).
- **Harness category** — [ADR-039](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ADR-039-harness-addon-category-swappable-default-agent.md).
- **Contract types** — [terminal-host-contract.ts](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/src/core/terminal-host-contract.ts).
- **Alpha runtime/bridge boundary** — [ALPHA_RUNTIME_BOUNDARY.md](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/docs/architecture/ALPHA_RUNTIME_BOUNDARY.md).
- **Build-discipline precedent** — [SDK-DEMO-003-OMP-BUILD-PROMPT.md](file:///Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha/prompts/SDK-DEMO-003-OMP-BUILD-PROMPT.md).

The test of adherence is: the Phase gates in §4 below, each of which maps to a
ADR-040 Migration step (TH-4, TH-5). A build is conforming only if every gate
passes against the real boundary, not a mock.

## 1. Glossary

- **Bridge** — the authenticated local Node bridge: launcher
  `browser-first/host/run-bridge-minimal.mjs` + server `browser-first/host/bridge-server.mjs`
  (loopback-only privileged path; `ALPHA_RUNTIME_BOUNDARY.md`).
- **Registry** — host-owned `createHarnessRegistry`
  (`browser-first/host/harness-registry.mjs`); `setGrants` enforces `consent`.
- **Adapter daemon** — `addon.resonant-terminal-iterm2`, a `local-service` add-on
  speaking JSON-RPC over stdio (`service.protocol: "stdio-json-rpc"`,
  `service.entrypoint: "node adapter.mjs"` — a command the operator runs in the
  add-on's own directory, e.g. `cd examples/sdk-demo/terminal-host/iterm2 && node
  adapter.mjs`). The scaffold currently has no `package.json` — `npm` does not
  drive it; the operator runs the entrypoint command directly. The Phase 1.5
  bridge route owner connects to the stdio peer the operator produces.
- **Fixed-root** — for `service.protocol: "stdio-json-rpc"`, the add-on is a
  process the **operator** starts; `service.entrypoint` is the command string the
  operator types (e.g. `"node adapter.mjs"` in the add-on's own directory, or a
  project absolute path). The host bridge has no `spawn` path
  (`workspace-addon-discovery.mjs:9`); there is no ambient `PATH` resolution of a
  bare command name. For `service.protocol: "http-json"`, `service.entrypoint`
  must be a loopback URL (`http://127.0.0.1:<port>`); see
  `parseLoopbackOrigin` at `workspace-addon-discovery.mjs:50`. **No-spawn is the
  rule**; fixed-root means the entrypoint string itself, not the host launching.
- **Scoped env allowlist** — the only env vars an add-on/harness receives are the
  explicitly allowlisted ones (`env-clear` model, ADR-039); no `process.env`
  inheritance.

## 2. Current state — verify first; do not trust this list

Run from `2.0.0-alpha/`. This loop must exit clean (no `MISSING:` lines) before
any build work:

```bash
cd /Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null || { echo "NOT A GIT REPO"; exit 1; }
git rev-parse --short HEAD                 # capture actual SHA; do not assume
git status --porcelain                     # capture working-tree state
for f in \
  src/core/terminal-host-contract.ts \
  src/core/contracts.ts \
  packages/addon-sdk/src/contracts.ts \
  packages/addon-sdk/src/validation.ts \
  browser-first/host/harness-registry.mjs \
  browser-first/host/run-bridge-minimal.mjs \
  browser-first/host/bridge-server.mjs \
  docs/architecture/ADR-040-terminal-host-adapter-contract.md \
  docs/architecture/ADR-039-harness-addon-category-swappable-default-agent.md \
  docs/architecture/ALPHA_RUNTIME_BOUNDARY.md \
  prompts/SDK-DEMO-003-OMP-BUILD-PROMPT.md \
  examples/sdk-demo/terminal-host/in-memory-host.ts \
  examples/sdk-demo/terminal-host/iterm2/addon.json \
  examples/sdk-demo/terminal-host/iterm2/adapter.mjs \
  examples/sdk-demo/echo/addon.json \
  examples/sdk-demo/tests/terminal-host-contract.test.ts \
  examples/sdk-demo/tests/iterm2-manifest.test.ts ; do
  test -f "$f" || { echo "MISSING: $f"; exit 1; }
done
echo "verify-ok"

# Confirm add-on protocols (echo is http-json; iterm2 is stdio-json-rpc; both are runtimeType:local-service):
test "$(jq -r .runtimeType examples/sdk-demo/echo/addon.json)" = "local-service" || { echo "echo: not local-service"; exit 1; }
test "$(jq -r .service.protocol examples/sdk-demo/echo/addon.json)" = "http-json" || { echo "echo: unexpected protocol"; exit 1; }
test "$(jq -r .runtimeType examples/sdk-demo/terminal-host/iterm2/addon.json)" = "local-service" || { echo "iterm2: not local-service"; exit 1; }
test "$(jq -r .service.protocol examples/sdk-demo/terminal-host/iterm2/addon.json)" = "stdio-json-rpc" || { echo "iterm2: unexpected protocol"; exit 1; }
```

**Re-locate the key symbols (line numbers drift; use these, not prose):**

```bash
grep -n "export interface AddOnManifest"      src/core/contracts.ts
grep -n "export interface CapabilityGrant"    src/core/contracts.ts
grep -n "export const validateAddOnManifest"  packages/addon-sdk/src/validation.ts
grep -n "export async function createHarnessRegistry" browser-first/host/harness-registry.mjs
grep -n "setGrants(addonId"                   browser-first/host/harness-registry.mjs
grep -n "interface SessionBootstrapGrant"     src/core/terminal-host-contract.ts
grep -n "interface RosTerminalEventEnvelope"  src/core/terminal-host-contract.ts
grep -n "interface RosTerminalSession"        src/core/terminal-host-contract.ts
```

**Already done (verify, then build on top; do NOT redo):**

| Artifact                                                                                                                                         | Path                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Contract types (incl. `SessionBootstrapGrant`, `RosTerminalEventEnvelope`, `RosTerminalSession`, `ProvenanceFidelity`, `TerminalTelemetryEvent`) | `src/core/terminal-host-contract.ts`                                                                                 |
| `terminal-host` capability                                                                                                                       | `src/core/contracts.ts` (type) + `packages/addon-sdk/src/contracts.ts` (`ADDON_CAPABILITIES`)                        |
| Manifest schema / validator                                                                                                                      | `src/core/contracts.ts` (`AddOnManifest`) + `packages/addon-sdk/src/validation.ts` (`validateAddOnManifest`)         |
| Host-owned registry                                                                                                                              | `browser-first/host/harness-registry.mjs`                                                                            |
| ADRs                                                                                                                                             | `docs/architecture/ADR-039-*.md`, `ADR-040-*.md`                                                                     |
| Headless fixture + contract tests                                                                                                                | `examples/sdk-demo/terminal-host/in-memory-host.ts`, `examples/sdk-demo/tests/terminal-host-contract.test.ts`        |
| iTerm2 scaffold                                                                                                                                  | `examples/sdk-demo/terminal-host/iterm2/{addon.json,adapter.mjs}`, `examples/sdk-demo/tests/iterm2-manifest.test.ts` |

**Test baselines — re-run on day-of-build and record your own numbers** (last
observed 2026-10-02: demo 85/85, core 721/721). These are placeholders, not
authority.

**Node:** repo requires `>=24.21.0`. This environment's nvm has Node 22; use
Homebrew Node 26 via the PATH export in §5, and confirm with `node --version`.
**iTerm2:** installed; enable the Python API (_Preferences → General → Magic →
Enable Python API_; `iterm2env` is bundled).

## 3. Non-negotiable constraints

1. **No second registry/manifest/capability/bridge launcher.** Reuse
   `AddOnManifest`, `validateAddOnManifest`, `createHarnessRegistry`, and the
   capability-token paths (re-locate via §2).
2. **No manifest-controlled command execution.** The adapter is operator-started
   (a `local-service`, see `examples/sdk-demo/echo/addon.json` — `runtimeType:
   "local-service"` with `service.protocol: "http-json"`; the iTerm2 add-on is
   also `runtimeType: "local-service"` with `service.protocol: "stdio-json-rpc"`).
   The bridge never spawns it (cf. `workspace-addon-discovery.mjs:9`: _"No
   `spawn`. Add-ons declare `service.entrypoint`; the operator starts."_). Spawn
   is **fixed-root** (Glossary) and gated.

   **Operator-start procedure** (no host-managed spawn ever):

   ```bash
   cd 2.0.0-alpha/examples/sdk-demo/terminal-host/iterm2
   node adapter.mjs           # exact command from service.entrypoint
   ```

   The operator leaves this process running; the Phase 1.5 bridge route owner
   connects to its stdio as a peer. CI cannot automate this — Phase 1.5's gate
   includes a **manual smoke step**: confirm the adapter accepts a `terminal.event`
   notification from the bridge.
3. **No `process.env` inheritance.** Provider credentials cross only as a scoped
   env allowlist, session-only.
4. **No secrets in argv/env/HTML/URL.** The bootstrap grant is exchanged over the
   bootstrap RPC — never embedded in `argv` or `env`. Shape:
   `SessionBootstrapGrant` (`src/core/terminal-host-contract.ts:209`):

   ```ts
   export interface SessionBootstrapGrant {
     sessionId: string;   // audience: bound to one ros-session-<id>
     token: string;
     purpose: "attach" | "adopt";
     issuedAt: string;
     expiresAt: string;
   }
   ```

   The grant is **audience-bound to the `sessionId` field** (one
   `ros-session-<id>`), short-lived (`expiresAt`), single-use (`purpose`), and
   reason-scoped (`attach` vs `adopt`).
5. **No self-grant.** `terminal-host` is authored `granted: false`; the host
   grants it via `setGrants(addonId, grants, { consent: true, expectedRevision })`
   (`browser-first/host/harness-registry.mjs:201`). Consent is the **operator
   action**: an HTTP `POST /addons/grants` to the bridge
   (`browser-first/host/harness-host-service.mjs:275`, route signature
   `['addonId', 'grants', 'consent', 'expectedRevision']`). Existing call sites
   that demonstrate this operator action are `scripts/harness-swap-demo.mjs:122`
   and `scripts/pi-swap-demo.mjs:64` (`jsonFetch(${bridgeUrl}/addons/grants, …)`).
   There is no built-in CLI; the operator UI is HTTP — not a manifest field and
   not self-service.
6. **The terminal is replaceable — two axes.** (a) the harness must not learn the
   host's identity, and (b) the adapter must not learn the harness's identity.
   Both are asserted in §4 Phase 2.
7. **Screen-scraping is not the primary protocol.** Structured
   `HarnessRuntimeEvent` + terminal `TerminalTelemetryEvent` only. The
   `screen-stream` adapter capability (`TerminalHostAdapterCapability`,
   `terminal-host-contract.ts:38` — one of `launch`/`adopt`/`attach`/`detach`/
   `terminate`/`list-sessions`/`cwd`/`environment`/`profile`/`command`/
   `send-input`/`get-text`/`lifecycle-events`/`screen-stream`/`multiplexer`)
   is gated by the add-on manifest's `requestedCapabilities` and never recorded
   as provenance. Use the `ProvenanceFidelity` enum
   (`terminal-host-contract.ts:122`: `structured`/`telemetry`/`observation`)
   instead.
8. **Security acceptance must exercise the real iTerm2 + bridge boundary**, not
   mocks.
9. **No regression** of Hermes/OpenCode/browser-first, demo suite, or core suite.

## 4. Build plan

### Phase 1 — TH-4: iTerm2 adapter · gate CP-TH4

**Step 1 — register as a `local-service` add-on.** The scaffold
`examples/sdk-demo/terminal-host/iterm2/addon.json` validates. Registration shape:
`examples/sdk-demo/echo/addon.json` (canonical `local-service`; same
`runtimeType: "local-service"`, different `service.protocol`). Prove discovery

- host-owned grant: **operator action via HTTP** — `POST /addons/grants` to the
  bridge with `{ addonId, grants, consent: true, expectedRevision }`
  (`browser-first/host/harness-host-service.mjs:275`). Use `scripts/harness-swap-demo.mjs:122`
  or `scripts/pi-swap-demo.mjs:64` as references (no production CLI exists). The
  grant must be host-owned (never `granted: true` in the manifest).

**Step 2 — implement the nine operations.** Each row is the acceptance; exercise
against real iTerm2 (input → observable success → error):

| Operation          | Input                                                                  | Observable success                                                                                              | Error case                                                                                |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `createSession`    | `{ project: {root,cwd}, providerProfileId: string, bootstrapCommand }` | New iTerm2 window/tab running bootstrap; returns `RosTerminalSession` with `state:"created"` (consumer-observable) | iTerm2 down → `terminal-unavailable`                                                      |
| `adoptSession`     | `{ hostSessionId }`                                                    | Existing session identified; `state:"adopted"`                                                                 | not found → `session-not-found`                                                           |
| `attachSession`    | `{ sessionId }`                                                        | `state:"attached"`, `attachedAt` set, `ROS_SESSION_ID` exported + `user.rosSession` set                        | already attached → `attach-conflict`                                                      |
| `detachSession`    | `{ sessionId, reason }`                                                | `state:"detached"`, `detachedReason` set, status cleared                                                     | not found → `session-not-found`                                                           |
| `terminateSession` | `{ sessionId }`                                                        | session closed; `state:"terminated"`; `terminal.session.terminated` emitted (via Phase 1.5 receiver)           | not found → `session-not-found`                                                           |
| `listSessions`     | `—`                                                                    | sessions enumerated with cwd + process identity                                                              | iTerm2 down → `terminal-unavailable`                                                      |
| `getSessionState`  | `{ sessionId }`                                                        | `{ state, cwd, processIdentity, capabilities }`                                                              | not found → `session-not-found`                                                           |
| `sendInput`        | `{ sessionId, text }`                                                  | text written to session                                                                                      | not found → `session-not-found`; text contains `SessionBootstrapGrant`-shaped token → `permission-denied` (no token may ride the wire) |
| `launchBootstrap`  | `{ sessionId, bootstrapCommand }`                                      | consumer receives the resolved environment via the bootstrap RPC return value + `terminal.session.started` event (NOT via argv/env) | grant invalid → `permission-denied`; bootstrap cannot start → `bootstrap-failed`         |

**CP-TH4 gate:** adapter discovered generically; `terminal-host` granted via
consent (never self-granted); all nine rows pass against real iTerm2; spawn is
fixed-root; **demo suite + core suite + `npm run test:browser-first` all pass**
(no Hermes/OpenCode/browser-first regression).

`STOP AND REPORT` (template in §6).

### Phase 1.5 — TH-4.5: Telemetry plumbing foundations · gate CP-TH45

Phase 2 depends on **three pieces of plumbing** that do not exist yet. They
are created here so Phase 2 only proves behavior, not new infrastructure.

**Step 0 — extend the broker bus to accept terminal events.** The bus event
validator (`validateHarnessEvent` at
`browser-first/host/harness-adapter-contract.mjs:37`) currently accepts only
the harness runtime event types (`delta`/`final`/`status`/`cancelled`/`error`).
`RosTerminalEventEnvelope` (`terminal-host-contract.ts:166`) defines five
distinct terminal telemetry event types (`terminal.session.started`,
`terminal.command.started`, `terminal.command.ended`, `terminal.cwd.changed`,
`terminal.session.terminated` — see `terminal-host-contract.ts:135-139`).
Without extending the validator, **Step B cannot publish terminal events to
the bus** (every `ctx.bus.publish({ type: 'terminal.session.started', … })`
throws `invalid-event` at `harness-event-bus.mjs:36`). This is a v5 prerequisite
discovered while attempting to wire Step B; v4 omitted it.

Concretely, extend two places:

1. **`src/core/contracts.ts`** — the `HarnessEvent` union (currently 5 variants
   at `:565`). Add a new variant:
   ```ts
   | { type: "terminal.session.started"; data: { sessionId: string; at: string } }
   | { type: "terminal.command.started"; data: { sessionId: string; at: string; command?: string } }
   | { type: "terminal.command.ended"; data: { sessionId: string; at: string; exitStatus?: number } }
   | { type: "terminal.cwd.changed"; data: { sessionId: string; at: string; cwd: string } }
   | { type: "terminal.session.terminated"; data: { sessionId: string; at: string; exitStatus?: number } }
   ```
   The `data` payloads are the body of the matching `TerminalTelemetryEvent`
   (drop the `type` field — the bus type is the discriminated key).

2. **`browser-first/host/harness-adapter-contract.mjs:37`** —
   `validateHarnessEvent(event)`'s switch on `event.type`. Add the five
   `case` arms above, each verifying `data` shape with the `exactKeys` +
   typeof pattern the existing arms use (e.g.
   `case "terminal.cwd.changed": return exactKeys(data, ["sessionId","at","cwd"]) && typeof data.cwd === "string"`).
   No new error codes — terminal telemetry is not an error, so existing
   `HARNESS_PUBLIC_ERROR_MESSAGES` keys are untouched.

The bus itself (`harness-event-bus.mjs:36`) does not need changes — it just
forwards to `validateHarnessEvent`. The SSE writer
(`writeBridgeEventStream` at `bridge-server.mjs:361`, payload at `:408`) just
serializes the event JSON; new event types are **wire-additive** and existing
consumers ignore unknown `type` values. No extension-side change required
either — the side panel's `/agent/events` consumer
(`bridge-client.js:102`) treats the SSE stream as opaque.

**Acceptance.** Add a test alongside `browser-first/test/harness-manifest.test.mjs`
or extend it: for each new variant, assert `validateHarnessEvent(...) === true`
with a valid provenance stub, and `=== false` when `data` is malformed (e.g.
`terminal.cwd.changed` with `cwd` missing). This test is the regression fence
that prevents the validator from drifting back to the v4 five-type-only state.

**Step A — declare the driver selector env var.** Add `RESONANT_TERMINAL_DRIVER`
as a first-class driver selector. Currently nothing in source reads it
(`grep -rn RESONANT_TERMINAL_DRIVER --include="*.ts" --include="*.mjs"` returns
no hits). Introduce it in `examples/sdk-demo/vitest.config.ts` (or the config
file vitest reads) as the single switch consumed by Phase 2's lifecycle driver
and the replaceability test. Allowed values: `in-memory` (default), `iterm2`.

**Step B — create the bridge route owner.** New file
`browser-first/host/terminal-host-service.mjs`. It must:

- follow the same composition pattern as `browser-first/host/harness-host-service.mjs`
  (read imports: `createHarnessRegistry`, `createHarnessRegistryStore`, etc. —
  only the components it consumes).
- subscribe to a **stdio loopback** for the `terminal-host` add-on (the add-on
  exposes `service.protocol: "stdio-json-rpc"` and `service.entrypoint: "node
  adapter.mjs"`; the bridge connects as the stdio peer when the operator starts
  the add-on).
- receive JSON-RPC **requests** from the add-on. **Method name is part of this
  contract** — choose one and stick to it: propose `"terminal.event"` (a
  notification, no response required). Each request body is a
  `RosTerminalEventEnvelope` (`terminal-host-contract.ts:166`).
- republish to the **broker event bus** (same bus the harness subscribes to
  via `GET /agent/events` at `harness-host-service.mjs:310`). The bus is
  implemented in `browser-first/host/harness-boundary.mjs`: `publish` at
  `:68`/`:160`/`:164`/`:176`, `subscribe` at `:138` (`events(ref)` returns
  `registered(ref).bus.subscribe()`). Use the same `publish` API the harness
  boundary uses for `harness.*` events. The bus `publish` validates with
  `validateHarnessEvent` (`harness-event-bus.mjs:36`); Step 0 above extends
  that validator so `terminal.*` payloads pass.

**CP-TH45 gate:** `RESONANT_TERMINAL_DRIVER` is declared in vitest config; the
new file `browser-first/host/terminal-host-service.mjs` exists and imports the
same composition primitives as `harness-host-service.mjs`; **`HarnessEvent`
union and `validateHarnessEvent` accept the five `terminal.*` event types**
(Step 0); the new `validateHarnessEvent` acceptance test passes; manual smoke
test (see Step B's "smoke" sub-task below) passes.

`STOP AND REPORT` (template in §6).

### Phase 2 — TH-5: ROS ↔ iTerm2 connection proof (no Pi) · gate CP-TH5

**Prerequisites from Phase 1.5:**
- `HarnessEvent` union + `validateHarnessEvent` accept the five `terminal.*`
  event types (Step 0) — without this, the bus rejects terminal telemetry.
- `RESONANT_TERMINAL_DRIVER` env var is the driver selector.
- `browser-first/host/terminal-host-service.mjs` exists and consumes the
  add-on's stdio JSON-RPC `terminal.event` notifications, republishing to the
  broker event bus.

**Lifecycle driver.** Implement `examples/sdk-demo/tests/terminal-host-live.test.ts`
that drives `create → attach → run → detach → terminate` + adopt (`ros attach`)
against real iTerm2. Test structure:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createDriver } from "../terminal-host/driver"; // declared in Phase 1.5

const DRIVER = process.env.RESONANT_TERMINAL_DRIVER ?? "in-memory";
const liveIt = DRIVER === "iterm2" ? it : it.skip; // CI without iTerm2 stays green

describe("terminal host lifecycle (real iTerm2)", () => {
  let driver: string;
  beforeAll(async () => { driver = await createDriver(DRIVER); });
  afterAll(async () => { await driver.shutdown?.(); });

  liveIt("createSession yields state:created", async () => { /* … */ });
  liveIt("attachSession yields state:attached", async () => { /* … */ });
  liveIt("sendInput writes through to the session", async () => { /* … */ });
  liveIt("detachSession yields state:detached", async () => { /* … */ });
  liveIt("terminateSession yields state:terminated", async () => { /* … */ });
  liveIt("adoptSession accepts an existing iTerm2 session", async () => { /* … */ });
});
```

**Telemetry transport + receiver.** The adapter emits JSON-RPC notifications
(`terminal.event`) over its stdio channel, each carrying a
`RosTerminalEventEnvelope` (`terminal-host-contract.ts:166`). The receiver is
the bridge route owner created in **Phase 1.5 Step B**. Event names (from
`TerminalTelemetryEvent`, `terminal-host-contract.ts:135-139`):
`terminal.session.started`, `terminal.command.started`, `terminal.command.ended`
(exit status), `terminal.cwd.changed`, `terminal.session.terminated`. Verify
each reaches the broker event bus (the same bus consumed by
`GET /agent/events` at `harness-host-service.mjs:310`).

**Replaceability proof — both axes (required).** Parameterize
`terminal-host-contract.test.ts` over a driver factory, selected by
`RESONANT_TERMINAL_DRIVER` (`in-memory` default | `iterm2`):

```ts
it.each([{ driver: "in-memory" }, { driver: "iterm2" }])(
  "contract holds for %s",
  async ({ driver }) => {
    if (driver === "iterm2" && process.env.RESONANT_TERMINAL_DRIVER !== "iterm2") return; // skip
    const host = await createDriver(driver); // in-memory fixture | live iTerm2 adapter
    /* run the same session-state + event-shape assertions */
  },
);
```

- Axis (a) — the **harness** sees the same contract regardless of host: swap
  `in-memory-host.ts` for the iTerm2 adapter; identical state transitions + event
  shapes.
- Axis (b) — the **adapter** never learns the harness: drive the adapter with a
  headless harness fixture (no Pi/OMP/Codex); the adapter must satisfy the
  contract without branching on harness identity.

**Session status indicator.** Bootstrap exports `ROS_SESSION_ID`; adapter sets
iTerm2 `user.rosSession`. `ROS_SESSION_ID` is a string id whose **presence
(non-empty) means attached**; `user.rosSession` carries live state. Source of
truth on conflict: **`user.rosSession` wins** (live state).

**No-Pi proof (automated).** In `terminal-host-live.test.ts`, after the lifecycle,
assert no harness process is running **excluding the test runner and its
parent**:

```ts
import { execSync } from "node:child_process";
const exclude = [process.pid, process.ppid].join(",");
const out = execSync(
  `pgrep -f 'pi|omp|codex|claude' | grep -vwE '${exclude}' || true`
).toString().trim();
expect(out, "no harness process may be spawned").toBe("");
```

This is an automated assertion, not a manual step. It excludes the test runner
itself and its parent so the assertion is meaningful when run from inside OMP.

**CP-TH5 gate:** lifecycle passes against real iTerm2; telemetry reaches the
event bus (via `terminal-host-service.mjs` from Phase 1.5); both replaceability
axes pass; status indicator reflects attached/detached; no-Pi guard excludes
the test runner and still finds no harness process.

`STOP AND REPORT` (template in §6).

## 5. Commands (verified present in `package.json`)

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node --version                  # expect v26 (repo requires >=24.21.0)
npm ci
npx vitest run --config examples/sdk-demo/vitest.config.ts   # demo suite
npm run build                                                 # tsc && vite build --target es2022
npm test                                                       # core vitest
npm run test:browser-host      # node --test addons/resonant-browser-host/test/*.test.mjs
npm run test:browser-first     # node scripts/run-browser-first-extension-tests.mjs
npm run browser-first:audit-scope # node scripts/browser-first-release-scope-audit.mjs
```

## 6. Verification discipline + STOP AND REPORT template

**Never trust a green number you did not produce yourself.** Re-run the exact
command. For `npm test` (hundreds of tests), paste **the summary line + last ~20
lines**, not the full tail. Real-terminal tests must drive the actual iTerm2 app;
no mock bridge that skips auth/CORS/origin. Do not weaken a test to pass.

Commit per phase with a scope + imperative summary, e.g.:

- `feat(terminal-host): implement iTerm2 adapter operations` (Phase 1)
- `test(terminal-host): add iTerm2 connection proof and replaceability test` (Phase 2)

Never push to `dev`/`main`/`upstream`.

**At every `STOP AND REPORT` gate, report:**

1. Exact commits — `git log --oneline -3`.
2. Exact commands run + output (summary line + last ~20 lines each), with the
   test counts you produced **named by label** (demo = N, core = N, browser-first = N).
3. Files changed — `git status --porcelain`.
4. Real-iTerm2 evidence (named format): paste `ros session ls --json` output +
   the `iterm2.user.rosSession` value for the attached/detached states.
5. Known limitations / unresolved error cases.

Report before continuing to the next phase.
