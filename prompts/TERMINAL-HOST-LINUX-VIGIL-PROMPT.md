# Terminal Host — Linux Adapter (kitty/WezTerm) + Cross-Platform Replaceability — OMP Build Prompt (v1)

**Handoff from AVIS → OMP (running on VIGIL, a Linux host). Read this whole
document before touching anything.**

This is the cross-platform proof of the ResonantOS terminal-host contract. The
contract, bridge service, and fixtures are already defined and green on macOS
(with iTerm2). Your job is to **design, build, and test a Linux-native terminal
host adapter** on VIGIL so the same harness (Pi) runs unchanged whether the
terminal is macOS+iTerm2 or Linux+kitty/WezTerm.

---

## 0. Mission

The terminal-host contract (ADR-040) says the terminal is a **replaceable host**
and ROS is the authority. So far that is only proven on macOS. Prove it holds on
Linux:

- A Linux-native terminal (kitty or WezTerm) implements the **same 4 adapter
  operations** (`createSession`, `launchBootstrap`, `sendInput`,
  `terminateSession`) through the **same bridge** (`terminal-host-service.mjs`)
  and the **same JSON-RPC `terminal.event` notifications**.
- A harness (Pi) sees a PTY/shell and **never learns** whether it is macOS+iTerm2
  or Linux+kitty/WezTerm.

Final acceptance: the lifecycle + replaceability test passes on Linux against a
real Linux terminal, with zero change to the contract or the harness.

---

## 1. Environment + current state (verify first; do not trust this list)

VIGIL is Linux. The reference repo lives on macOS; you will clone the fork here.

```bash
git clone https://github.com/vonstegen/2.0.0-alpha.git
cd 2.0.0-alpha
git checkout r-and-d/terminal-host-current-dev   # or the latest terminal-host branch
git rev-parse --short HEAD                        # capture the actual SHA
node --version                                    # repo requires >=24.21.0
```

Use a recent Node (>=24.21.0) — via `nvm install 24` or a distro package. Confirm
with `node --version`.

Install a Linux-native terminal with a scriptable control surface. **Recommend
kitty** (remote-control socket, `kitty @ ...`) as primary; **WezTerm**
(`wezterm cli ...`) as the alternative. Do **not** attempt iTerm2 or Apple
Terminal — those are macOS-only and will not run on VIGIL.

**Already done (in the repo; verify, then build on top — do NOT redo):**

- Contract — `src/core/terminal-host-contract.ts` (`TERMINAL_HOST_OPERATIONS`,
  `ROS_SESSION_OPERATIONS`, `TerminalHostAdapterContract`, `SessionBootstrapGrant`,
  the two event families).
- Bridge service — `browser-first/host/terminal-host-service.mjs` (spawns the
  adapter as a `stdio-json-rpc` peer, mints `SessionBootstrapGrant`, republishes
  `terminal.event` to the broker bus). This is platform-agnostic Node.
- Driver selector — `examples/sdk-demo/terminal-host/driver.ts`
  (`RESONANT_TERMINAL_DRIVER` = `in-memory` | `iterm2`).
- Fixtures + tests — `in-memory-host.ts`, `terminal-host-contract.test.ts`,
  `terminal-host-driver.test.ts`, `terminal-host-live.test.ts`.
- macOS reference adapter — `examples/sdk-demo/terminal-host/iterm2/adapter.py`
  (macOS-only; do not run it on Linux).

---

## 2. Sources (read and verify, not just link)

1. **ADR-040** — `docs/architecture/ADR-040-terminal-host-adapter-contract.md`.
2. **F2 operation split** — `docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md`.
3. **Ghostty reconciliation** — `docs/architecture/TERMINAL-HOST-GHOSTTY-RECONCILIATION.md`.
   This is the **template** for your Linux control-surface reconciliation: map the
   4 ops onto the real automation surface, name the transport/feedback/capabilities,
   and record degradations — before writing any adapter code.
4. **v7 as-built** — `prompts/OMP-BUILD-iTerm2-SDK-Addon-Connection.md`.

---

## 3. Non-negotiable constraints (do not violate any)

1. **The operation split is law.** The Linux adapter implements exactly the 4
   adapter ops. `supportedOperations` may only list `createSession` /
   `launchBootstrap` / `sendInput` / `terminateSession`. Never put the 5 ROS verbs
   (`adoptSession` / `attachSession` / `detachSession` / `listSessions` /
   `getSessionState`) on a terminal adapter.
2. **Replaceability, both axes.** The harness never learns the host's identity;
   the host adapter never learns the harness's identity.
3. **No second registry, manifest schema, capability system, or bridge launcher.**
   Reuse `AddOnManifest`, `validateAddOnManifest`, `createHarnessRegistry`, and
   `terminal-host-service.mjs` unchanged.
4. **No secrets in a command string, argv, env, shell history, or URL.** The only
   credential that crosses the terminal boundary is the broker-minted
   `SessionBootstrapGrant`, which rides the RPC return value only, never argv/env.
5. **No `process.env` inheritance into the adapter.** Allowlist `PATH` + `HOME` +
   `RESONANT_TERMINAL_DRIVER` (mirror `ADAPTER_ENV_ALLOWLIST` in
   `terminal-host-service.mjs`).
6. **Screen-scraping is not the primary protocol.** Structured `HarnessRuntimeEvent`
   first, `TerminalTelemetryEvent` supplemental, screen-stream debug-only.
7. **DAR stays optional.**
8. **Real-terminal tests drive the actual kitty/WezTerm app**, not a mock. If the
   terminal cannot run headless on VIGIL (no display), say so explicitly and use a
   named skip reason; do not fake the result.
9. **Do not regress** the in-memory + contract tests, which must pass unchanged on
   Linux.

---

## 4. Build plan (phase-by-phase)

### Phase 0 — TH-L0: environment + contract verification · gate CP-THL0

Clone, install Node + kitty (or WezTerm), and confirm the platform-agnostic tests
already pass on Linux:

```bash
npm ci
npx vitest run --config examples/sdk-demo/vitest.config.ts \
  examples/sdk-demo/tests/terminal-host-contract.test.ts \
  examples/sdk-demo/tests/terminal-host-driver.test.ts
```

The iTerm2-specific smoke/`adapter.py` will not run here — that is expected. Record
the exact test counts you produced.

**CP-THL0 gate:** repo cloned; Node >=24.21.0; terminal installed; contract +
driver tests green on Linux.

`STOP AND REPORT` here.

### Phase 1 — TH-L1: Linux control-surface reconciliation · gate CP-THL1

**Do not write the adapter yet.** Produce a short note (mirror the Ghostty
reconciliation) that maps the **4 adapter ops** onto kitty/WezTerm's actual
automation surface. Determine and document:

1. **Terminal choice + transport** — kitty's remote-control socket (`kitty @
   --to unix:...`) or WezTerm's `wezterm cli`. Name the `TerminalHostTransport`.
2. **Op-by-op mapping** — for each of `createSession`, `launchBootstrap`,
   `sendInput`, `terminateSession`: the exact mechanism, and whether it is
   natively supported or degrades.
3. **Feedback channel** — `event-stream` | `polling` | `none`, and the consequence
   for `ProvenanceFidelity`.
4. **Capabilities** — the `TerminalHostAdapterCapability` list the Linux adapter
   declares (it may legitimately omit what kitty/WezTerm cannot do; the
   Level-1/Level-3 axis already anticipates this).

Deliverable: a `docs/architecture/` note with a one-paragraph verdict on whether
the Linux terminal can satisfy all 4 ops.

**CP-THL1 gate:** the note exists, is anchored to the real kitty/WezTerm control
surface, and names transport + per-op mechanism + feedback + capabilities.

`STOP AND REPORT` here.

### Phase 2 — TH-L2: Linux adapter (4 ops) · gate CP-THL2

Implement the Linux adapter per the Phase 1 reconciliation:

1. Register it as a `local-service` add-on (`examples/sdk-demo/terminal-host/kitty/
   addon.json` or `.../wezterm/addon.json`, `runtimeType: "local-service"`,
   `service.protocol: "stdio-json-rpc"`). Validate the manifest.
2. Implement the 4 ops via the reconciled mechanism, emitting the same
   `terminal.event` notifications (session.started, command.started, command.ended,
   session.terminated) over the bridge stdio JSON-RPC peer. Reuse the existing
   bridge; do **not** build a second bridge.
3. `SessionBootstrapGrant` flow is identical: the bridge mints it
   (`mintSessionBootstrapGrant`) and returns it over RPC; the adapter never embeds
   it in argv/env and never holds credentials on disk.
4. Enforce the same env allowlist at spawn, and track received grant tokens in
   memory to reject any token that would ride the wire via `sendInput` /
   `bootstrapCommand` (mirror the iTerm2 `_reject_known_tokens` check).

**CP-THL2 gate:** `addon.json` validates; the 4 ops run against real kitty/WezTerm;
`terminal.session.started` / `session.terminated` observed; no secrets on the wire.

`STOP AND REPORT` here.

### Phase 3 — TH-L3: driver wiring + replaceability test · gate CP-THL3

1. Add the Linux driver id to `examples/sdk-demo/terminal-host/driver.ts`
   (`TerminalDriverId`, `ALLOWED_DRIVERS`, the error message) and its test.
2. Parameterize the replaceability test in `terminal-host-live.test.ts` over the
   **4 adapter ops** for the new driver (alongside `in-memory` and `iterm2`), with
   the Linux path gated on the terminal/daemon being present and a named skip
   reason otherwise.
3. Do not weaken the 5 ROS-verb assertions — assert them on the in-memory
   session-manager fixture, not on the adapter (per F2).

**CP-THL3 gate:** the lifecycle test parameterizes the 4 ops; in-memory path still
passes; no test weakened.

`STOP AND REPORT` here.

### Phase 4 — TH-L4: cross-platform replaceability proof · gate CP-THL4

Prove the adapter-level equivalence on Linux:

- Run the hardened replaceability test with the Linux adapter and record
  real-terminal evidence: `createSession → launchBootstrap → sendInput →
  terminateSession` with a real session id and the 4 telemetry events in order.
- State explicitly whether the harness-facing contract is byte-for-byte identical
  to the macOS+iTerm2 path; any difference is a leak and must be fixed in the
  contract, not the harness.
- Note: the full "Pi + Linux terminal passes with zero harness change" gate also
  requires the Pi-attach milestone (TH-6) to have landed; state this boundary.

**CP-THL4 gate:** Linux + kitty/WezTerm pass the parameterized 4-op replaceability
test; in-memory unchanged; all baselines green.

`STOP AND REPORT` here.

---

## 5. Commands (Linux / VIGIL)

```bash
node --version                    # >=24.21.0
npm ci
npx vitest run --config examples/sdk-demo/vitest.config.ts   # demo suite
npm test                                                       # core vitest
node --experimental-strip-types --test \
  browser-first/test/harness-manifest.test.mjs \
  browser-first/test/terminal-host-service.test.mjs \
  browser-first/test/terminal-host-bridge-wiring.test.mjs
# kitty remote control (verify flags yourself):
kitty --listen-on unix:/tmp/kitty-ros.sock &
kitty @ --to unix:/tmp/kitty-ros.sock ls
```

Do **not** run the macOS-only `examples/sdk-demo/terminal-host/iterm2/adapter.py`
or `iterm2/smoke.mjs` on VIGIL.

---

## 6. Verification discipline + STOP AND REPORT template

**Never trust a green number you did not produce yourself.** Re-run the exact
command. For `npm test`, paste the summary line + last ~20 lines. Real-terminal
tests must drive the actual kitty/WezTerm app; no mock that skips the control
surface. Do not weaken a test to pass.

Commit per phase with a scope + imperative summary, e.g.:

- `docs(terminal-host): add Linux control-surface reconciliation` (Phase 1)
- `feat(terminal-host): implement kitty adapter` (Phase 2)
- `test(terminal-host): parameterize replaceability over the 4 adapter ops` (Phase 3)

Create a new branch off the terminal-host branch (e.g. `r-and-d/terminal-host-linux`);
never push to `dev`/`main`/`upstream`.

**At every `STOP AND REPORT` gate, report:**

1. Exact commits — `git log --oneline -3`.
2. Exact commands run + output (summary line + last ~20 lines each), with the test
   counts you produced **named by label** (demo = N, core = N, browser-first = N).
3. Files changed — `git status --porcelain`.
4. Real-terminal evidence (named format): the session id + the 4 telemetry events in
   order (paste the smoke transcript for kitty/WezTerm).
5. Known limitations / unresolved error cases (e.g. "kitty cannot enumerate
   sessions so `list-sessions` capability is omitted", "no headless display on VIGIL,
   used Xvfb with named skip reason").
