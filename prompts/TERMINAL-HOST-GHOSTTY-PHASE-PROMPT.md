# Terminal Host — Ghostty Adapter + Replaceability (TH-7) — OMP Build Prompt (v1)

**Handoff from AVIS → OMP. Read this whole document before touching anything.**

This is the next milestone after Phases 1 / 1.5 / 2 (iTerm2 adapter, bridge
service, lifecycle test — all green, see
[`OMP-BUILD-iTerm2-SDK-Addon-Connection.md`](OMP-BUILD-iTerm2-SDK-Addon-Connection.md)
v7). Scope here is **Ghostty equivalence (TH-7)** — the adapter-level
replaceability proof that the terminal host is truly swappable. It does **not**
include attaching Pi (that is TH-6, a separate milestone); the final "Pi +
Ghostty passes with zero harness change" gate depends on TH-6 landing first.

---

## 0. Sources (originating spec — read and verify, not just link)

1. **ADR-040** — `docs/architecture/ADR-040-terminal-host-adapter-contract.md`
   (esp. "Terminal is a replaceable host; ROS is the authority", "Three entry
   modes, one session contract", "Adapter operations vs. ROS session
   operations", and Migration step 7).
2. **F2 operation-split decision** — `docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md`.
   This is the load-bearing decision for this whole milestone. The nine verbs
   are split into **4 adapter ops** (`TerminalHostOperation`) and **5 ROS ops**
   (`RosSessionOperation`). A Ghostty adapter implements **only the 4**.
3. **Contract** — `src/core/terminal-host-contract.ts` (`TERMINAL_HOST_OPERATIONS`,
   `ROS_SESSION_OPERATIONS`, `TerminalHostAdapterContract`, `TerminalHostAdapterId`,
   `TerminalHostTransport`, `TerminalHostAdapterCapability`, `SessionBootstrapGrant`).
4. **v7 as-built** — `prompts/OMP-BUILD-iTerm2-SDK-Addon-Connection.md` (Phases
   1/1.5/2, the iTerm2 adapter `adapter.py`, bridge service, lifecycle test).

---

## 1. Glossary

- **Adapter operation (4)** — `createSession`, `launchBootstrap`, `sendInput`,
  `terminateSession`. What a *terminal* does. `supportedOperations` may list only
  these.
- **ROS session operation (5)** — `adoptSession`, `attachSession`,
  `detachSession`, `listSessions`, `getSessionState`. ROS-owned bookkeeping on
  `RosTerminalSession`; a terminal adapter never implements them.
- **Replaceability, both axes** — (a) the harness never learns which host is
  attached, and (b) the host adapter never learns which harness it is serving.
- **Fixed-root** — the adapter launches only from its manifest-declared root;
  no ambient `PATH` resolution.

---

## 2. Current state — verify first; do not trust this list

Run from `2.0.0-alpha/`. This loop must exit clean before any build work:

```bash
cd /Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null || { echo "NOT A GIT REPO"; exit 1; }
git rev-parse --short HEAD                 # capture actual SHA; do not assume
git status --porcelain                     # capture working-tree state
for f in \
  src/core/terminal-host-contract.ts \
  docs/architecture/ADR-040-terminal-host-adapter-contract.md \
  docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md \
  browser-first/host/terminal-host-service.mjs \
  browser-first/host/terminal-host-bridge-wiring.mjs \
  examples/sdk-demo/terminal-host/driver.ts \
  examples/sdk-demo/terminal-host/in-memory-host.ts \
  examples/sdk-demo/terminal-host/iterm2/addon.json \
  examples/sdk-demo/terminal-host/iterm2/adapter.py \
  examples/sdk-demo/tests/terminal-host-contract.test.ts \
  examples/sdk-demo/tests/terminal-host-driver.test.ts \
  examples/sdk-demo/tests/terminal-host-live.test.ts \
  examples/sdk-demo/terminal-host/in-memory-smoke.mjs \
  examples/sdk-demo/terminal-host/iterm2/smoke.mjs ; do
  test -f "$f" || { echo "MISSING: $f"; exit 1; }
done
echo "verify-ok"
```

**Re-locate the key symbols (line numbers drift; use these, not prose):**

```bash
grep -n "TERMINAL_HOST_OPERATIONS"         src/core/terminal-host-contract.ts
grep -n "ROS_SESSION_OPERATIONS"           src/core/terminal-host-contract.ts
grep -n "interface TerminalHostAdapterContract" src/core/terminal-host-contract.ts
grep -n "type TerminalHostTransport"       src/core/terminal-host-contract.ts
grep -n "type TerminalHostAdapterCapability" src/core/terminal-host-contract.ts
grep -n "mintSessionBootstrapGrant"        browser-first/host/terminal-host-service.mjs
```

**Already done (verify, then build on top; do NOT redo):**

- **Phases 1/1.5/2** — iTerm2 adapter (`adapter.py`, 4 ops), bridge service
  (`terminal-host-service.mjs` with `mintSessionBootstrapGrant`), bridge wiring
  (`RESONANT_TERMINAL_HOST_BRIDGE=1`), driver selector (`in-memory` | `iterm2`),
  lifecycle + replaceability test. All green.
- **F1/F3** — adapter spawn env allowlist (`PATH`+`HOME`+`RESONANT_TERMINAL_DRIVER`).
- **F2** — operation split (type + fixture + guard test + ADR-040 subsection).
- **F4** — `SessionBootstrapGrant` token is broker-grade (32-byte base64url via
  `mintSessionBootstrapGrant`), not a `tok-<uuid>` placeholder.

**Test baselines — re-run on day-of-build and record your own numbers** (last
observed: core **721/721**, demo **100/100** across 13 files, browser-first
terminal-host files **20/20**). These are placeholders, not authority.

**Environment:** Node `>=24.21.0` — use Homebrew Node 26 via the `PATH` export in
§5. **Ghostty is installed** at `/Applications/Ghostty.app` (CLI at
`/Applications/Ghostty.app/Contents/MacOS/ghostty`). iTerm2 is installed with its
Python API enabled.

---

## 3. Non-negotiable constraints (do not violate any)

1. **The operation split is law.** A Ghostty adapter implements exactly the 4
   adapter ops. `TerminalHostAdapterContract.supportedOperations` may only list
   `createSession` / `launchBootstrap` / `sendInput` / `terminateSession`. Do
   **not** put `adoptSession` / `attachSession` / `detachSession` / `listSessions`
   / `getSessionState` on a terminal adapter — those are ROS session-manager verbs.
2. **Replaceability, both axes.** The Ghostty adapter must satisfy the same
   `TerminalHostAdapterContract` as iTerm2 from the harness's perspective, and it
   must never learn which harness it is serving.
3. **No second registry, manifest schema, capability system, or bridge launcher.**
   Reuse `AddOnManifest`, `validateAddOnManifest`, `createHarnessRegistry`, and the
   existing bridge service.
4. **No secrets in a command string, argv, env, shell history, or URL.** The only
   credential that crosses the terminal boundary is the broker-minted
   `SessionBootstrapGrant`, which rides the RPC return value only, never argv/env.
5. **No `process.env` inheritance into the adapter.** Allowlist `PATH` + `HOME` +
   `RESONANT_TERMINAL_DRIVER` (already enforced by `ADAPTER_ENV_ALLOWLIST` in
   `terminal-host-service.mjs`); the Ghostty spawn must match.
6. **Screen-scraping is not the primary protocol.** Structured `HarnessRuntimeEvent`
   first, `TerminalTelemetryEvent` supplemental, screen-stream debug-only.
7. **DAR stays optional.** Nothing here may assume DAR is present.
8. **Real-terminal tests drive the actual app**, not a mock that skips
   auth/origin checks. If Ghostty cannot be driven headlessly, say so explicitly
   and mark the test skip with a named reason.
9. **Do not regress** the existing counts (core 721, demo 100, browser-first 20).

---

## 4. Build plan (phase-by-phase)

### Phase 3 — TH-7a: Ghostty control-surface reconciliation · gate CP-TH7a

**Do not write an adapter yet.** Produce a short note (mirror
`TERMINAL-HOST-OPERATION-SPLIT.md`) titled "Ghostty control-surface
reconciliation" that maps the **4 adapter ops** onto Ghostty's *actual*
automation surface. Determine and document:

1. **Transport** — which `TerminalHostTransport` Ghostty will use
   (`stdio-json-rpc` like iTerm2? `apple-script`? `remote-control`? a CLI
   wrapper?). Ghostty has no iTerm2-style Python API; investigate the bundled CLI
   (`ghostty +new-window`, `+new-tab`) and whether a control socket / scriptable
   interface exists.
2. **Op-by-op mapping** — for each of `createSession`, `launchBootstrap`,
   `sendInput`, `terminateSession`: is it natively supported, and via what
   mechanism? If an op cannot be done natively (e.g. `sendInput` into an existing
   pane), name the degradation and the `TerminalHostAdapterCapability` that
   reflects it.
3. **Feedback channel** — does Ghostty emit session lifecycle events, or is it
   polling/one-way? Record the `feedbackChannel` value (`event-stream` |
   `polling` | `none`) and the consequence for `ProvenanceFidelity`.
4. **Capabilities** — the `TerminalHostAdapterCapability` list the Ghostty adapter
   will declare (it may legitimately omit `adopt`/`attach`/`detach`/`get-text` if
   Ghostty can't do them; the contract's Level-1/Level-3 axis already anticipates
   this).

Deliverable: a `docs/architecture/` note (or an addendum to an existing one) plus
a one-paragraph verdict on whether Ghostty can satisfy all 4 ops or must degrade.

**CP-TH7a gate:** the note exists, is anchored to the real Ghostty CLI/API, and
names the transport + per-op mechanism + feedback channel + capability list.

`STOP AND REPORT` here.

### Phase 4 — TH-7b: Replaceability test hardening · gate CP-TH7b

The current `terminal-host-live.test.ts` skips most lifecycle rows for iTerm2
(`it.skip`) and the "replaceability" row only does a stub `createSession`. Before
Ghostty can be proven equivalent, the test must actually exercise the **4 adapter
ops** over both real drivers:

1. Extend the driver selector (`examples/sdk-demo/terminal-host/driver.ts`) to
   accept `"ghostty"` (still throw for unknown ids; add it to `TerminalDriverId`
   and `ALLOWED_DRIVERS`).
2. Replace the single "replaceability" `it` with a parameterized block over
   `["in-memory", "iterm2"]` (and `"ghostty"` once its adapter exists) that runs
   `createSession → launchBootstrap → sendInput → terminateSession` with identical
   assertions on the observable contract (`sessionId`, `state`, telemetry event
   types/order).
3. Keep the in-memory path the deterministic CI default; the iTerm2/Ghostty paths
   gate on the driver being present, and **skip with a named reason** (not a bare
   `it.skip`) when the app/daemon isn't running.
4. Do not weaken the 5 ROS-verb assertions — but assert them on the in-memory
   session-manager fixture, not on a terminal adapter (per F2).

**CP-TH7b gate:** the lifecycle test parameterizes the 4 adapter ops; iTerm2 path
is real (not a stub); the in-memory path still passes; no test weakened.

`STOP AND REPORT` here.

### Phase 5 — TH-7c: Ghostty adapter (4 ops) · gate CP-TH7c

Implement the Ghostty adapter per the Phase 3 reconciliation. Concretely:

1. Register it as a `local-service` add-on (a `ghostty/addon.json` mirroring
   `iterm2/addon.json`, with the transport from Phase 3 and `runtimeType:
   "local-service"`). Validate the manifest.
2. Implement the 4 adapter ops via the reconciled mechanism, emitting the same
   `terminal.event` notifications (session.started, command.started, command.ended,
   session.terminated) over the bridge stdio JSON-RPC peer — reuse the existing
   `terminal-host-service.mjs` bridge, do **not** build a second bridge.
3. The `SessionBootstrapGrant` flow is identical to iTerm2: the bridge mints it via
   `mintSessionBootstrapGrant` and returns it over RPC; the adapter never embeds it
   in argv/env and never holds credentials.
4. Enforce the same env allowlist (`PATH` + `HOME` + `RESONANT_TERMINAL_DRIVER`)
   at spawn.

**CP-TH7c gate:** `ghostty/addon.json` validates; the 4 ops run against real
Ghostty; `terminal.session.started` / `session.terminated` observed; no secrets on
the wire.

`STOP AND REPORT` here.

### Phase 6 — TH-7d: Ghostty lifecycle + adapter-replaceability proof · gate CP-TH7

Run the hardened replaceability test (Phase 4) with the Ghostty adapter (Phase 5)
and prove the adapter-level equivalence:

- `Pi` is **not** required here (that is TH-6). The proof is that the Ghostty
  adapter and the iTerm2 adapter satisfy the same 4-op `TerminalHostAdapterContract`
  — a harness (or the in-memory fixture standing in for it) cannot tell which is
  attached.
- Record real-Ghostty evidence: `createSession → launchBootstrap → sendInput →
  terminateSession` with a real session id and the 4 telemetry events in order.
- The full "Pi + Ghostty passes with zero harness change" gate is the **TH-7
  completion**, which additionally requires TH-6 (Pi attach) to have landed; state
  this boundary explicitly in your report.

**CP-TH7 gate:** both iTerm2 and Ghostty pass the parameterized 4-op replaceability
test; in-memory unchanged; all baselines green.

`STOP AND REPORT` here.

---

## 5. Commands (verified present in `package.json`)

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node --version                  # expect v26 (repo requires >=24.21.0)
npx vitest run --config examples/sdk-demo/vitest.config.ts   # demo suite (100 now)
npm test                                                       # core vitest (721 now)
node --experimental-strip-types --test \
  browser-first/test/harness-manifest.test.mjs \
  browser-first/test/terminal-host-service.test.mjs \
  browser-first/test/terminal-host-bridge-wiring.test.mjs     # terminal-host browser-first (20 now)
```

Ghostty CLI (for the reconciliation note, verify the exact flags yourself):
`/Applications/Ghostty.app/Contents/MacOS/ghostty --help`.

---

## 6. Verification discipline + STOP AND REPORT template

**Never trust a green number you did not produce yourself.** Re-run the exact
command. For `npm test` (hundreds of tests), paste **the summary line + last ~20
lines**. Real-terminal tests must drive the actual iTerm2/Ghostty app; no mock
bridge that skips auth/CORS/origin. Do not weaken a test to pass.

Commit per phase with a scope + imperative summary, e.g.:

- `docs(terminal-host): add Ghostty control-surface reconciliation` (Phase 3)
- `test(terminal-host): parameterize replaceability over the 4 adapter ops` (Phase 4)
- `feat(terminal-host): implement Ghostty adapter` (Phase 5)

Never push to `dev`/`main`/`upstream`.

**At every `STOP AND REPORT` gate, report:**

1. Exact commits — `git log --oneline -3`.
2. Exact commands run + output (summary line + last ~20 lines each), with the test
   counts you produced **named by label** (demo = N, core = N, browser-first = N).
3. Files changed — `git status --porcelain`.
4. Real-terminal evidence (named format): for iTerm2 and/or Ghostty, the session id
   + the 4 telemetry events in order (paste the smoke transcript).
5. Known limitations / unresolved error cases (e.g. "Ghostty `sendInput` degrades
   to X", "Ghostty cannot enumerate sessions so `list-sessions` capability is
   omitted").

---

## 7. As-built (TH-7d gate)

TH-7a / TH-7b / TH-7c / TH-7d all green. Commits in this milestone:

```
1085a548  feat(terminal-host): implement Ghostty adapter (TH-7c)
c86dedfd  test(terminal-host): parameterize replaceability over the 4 adapter ops (TH-7b)
da43b97b  docs(terminal-host): add Ghostty control-surface reconciliation
22e57777  fix(terminal-host): reject grant tokens in sendInput / bootstrapCommand  (preparatory)
fde4c5d1  feat(terminal-host): F4 broker-grade grant + F2 doc-stale cleanup         (preparatory)
```

### TH-7d gate evidence

Both iTerm2 and Ghostty drivers pass the parameterized 4-op
replaceability test through the real bridge:

```
$ RESONANT_TERMINAL_HOST_BRIDGE=1 RESONANT_TERMINAL_DRIVER=iterm2 \
    npx vitest run --config examples/sdk-demo/vitest.config.ts tests/terminal-host-live.test.ts
Test Files  1 passed (1)
Tests  3 passed | 7 skipped (10)
# All 3 replaceability rows pass:
#   - driver=in-memory  (deterministic)
#   - driver=iterm2     (real bridge, real iTerm2)
#   - driver=ghostty    (real bridge, real Ghostty; this row runs
#                        because RESONANT_TERMINAL_HOST_BRIDGE=1 is on,
#                        regardless of the value of RESONANT_TERMINAL_DRIVER)

$ RESONANT_TERMINAL_HOST_BRIDGE=1 RESONANT_TERMINAL_DRIVER=ghostty \
    npx vitest run --config examples/sdk-demo/vitest.config.ts tests/terminal-host-live.test.ts
Test Files  1 passed (1)
Tests  3 passed | 7 skipped (10)
# Symmetric: ghostty row is the "primary" live driver, iterm2 row is
# also real (because the bridge flag is on).
```

Ghostty manual smoke (real `/Applications/Ghostty.app`):
```
$ node --experimental-strip-types examples/sdk-demo/terminal-host/ghostty/smoke.mjs
[smoke] createSession
[smoke]   -> {"sessionId":"smoke-8318e284","windowId":"window-78b178900"}
[smoke] launchBootstrap 'echo ghostty-smoke-bootstrap'
[smoke]   -> {"sessionId":"smoke-d29b3efd","grant":{...,"token":"c81757c8...","purpose":"attach",...},"windowId":"window-78b17a100"}
[smoke] sendInput 'echo hello-from-ros' (degrades to immediate in 1.3.1)
[smoke]   -> {"sessionId":"smoke-8318e284","delivered":true,"at":"2026-10-03T10:55:02.804Z"}
[smoke] terminateSession (created)   -> {"sessionId":"smoke-8318e284","terminated":true}
[smoke] terminateSession (launched)  -> {"sessionId":"smoke-d29b3efd","terminated":true}
[smoke] observed 10 notifications: terminal.session.started, terminal.session.started,
  terminal.command.started, terminal.command.started, terminal.command.started,
  terminal.command.ended, terminal.session.terminated, terminal.session.terminated,
  terminal.command.ended, terminal.command.started
[smoke] PASS
```

### Final regression (TH-7d baselines)

| Suite | Count |
|---|---|
| core vitest | **721/721** (no regression) |
| demo vitest (in-memory) | **103/103** (was 100; +2 from `ghostty-manifest.test.ts`, +1 from ghostty in `terminal-host-driver.test.ts`) |
| browser-first terminal-host files | **21/21** (was 20; +1 from ghostty bridge test) |
| in-memory smoke | PASS (3 events) |
| iTerm2 manual smoke | PASS (4 notifications) |
| Ghostty manual smoke | PASS (10 notifications) |
| iTerm2 mode lifecycle | 3/3 replaceability rows pass (in-memory + iTerm2 + Ghostty) |
| Ghostty mode lifecycle | 3/3 replaceability rows pass (symmetric) |

### Known limitations (TH-7 done, TH-6 still pending)

- Ghostty `sendInput` to a running interactive session degrades in
  1.3.1 (emits `terminal.command.started` + `terminal.command.ended`
  back-to-back; the fix is upstream `ghostty-org/ghostty#11713`).
  Same pre-existing limitation as the iTerm2 adapter.
- Ghostty `new tab` AppleScript is broken in 1.3.1; sessions open
  as **windows**, not tabs. The harness contract is identical.
- `feedbackChannel: "polling"` and `provenanceFidelity: "observation"`
  for Ghostty until the upstream AppleScript events land.
- Pi attach (TH-6) is out of scope for TH-7. The "Pi + Ghostty
  passes with zero harness change" end-to-end gate depends on TH-6.

TH-7d gate satisfied. The terminal host is adapter-replaceable:
both iTerm2 and Ghostty satisfy the same 4-op
`TerminalHostAdapterContract`, and the harness cannot tell which
is attached.
