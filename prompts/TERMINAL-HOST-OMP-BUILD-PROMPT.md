# Terminal Host Adapter — OMP Build Handoff

**Handoff from AVIS → OMP. Read this whole document before touching anything.**

You are starting the terminal-host implementation track defined by
[`docs/architecture/ADR-040-terminal-host-adapter-contract.md`](../docs/architecture/ADR-040-terminal-host-adapter-contract.md).
The contract, capability, and headless fixtures are already done. Pick up at
**Migration step 4** below and work phase-by-phase, stopping to report at every
`STOP AND REPORT` gate.

---

## 0. Mission

Make a dedicated external terminal (iTerm2 first, then Ghostty) a **replaceable
host** for harness add-ons (Pi / OMP / Codex / …). ResonantOS supplies session,
resource, credential, policy, project, and add-on lifecycle; the terminal does
terminal things. Pi must **not** change when the terminal host changes
(TH-6 equivalence).

Final acceptance: an operator selects `Pi → Open in Terminal`, ROS creates an
iTerm2 session, attaches the project/provider/resources, launches Pi, and
records the session; the same Pi add-on then runs unchanged against Ghostty.

---

## 1. Current state — read first

| Fact   | Value                                                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Repo   | `/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha`                                                                  |
| Branch | `r-and-d/sdk-demo-003-current-dev` (HEAD `c92bf898`)                                                                             |
| Base   | current alpha `dev`                                                                                                              |
| Node   | repo requires `>=24.21.0`; use Homebrew Node 26 (`export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"`) |

**Already done (do NOT redo):**

- **Contract types** — `src/core/terminal-host-contract.ts` (`TerminalHostAdapterContract`,
  `RosTerminalSession`, `RosTerminalSessionState`, `TerminalSessionEntryMode`,
  `ProvenanceFidelity`, `SessionBootstrapGrant`, the two event families, error
  vocabulary).
- **`terminal-host` capability** — added to `Capability` in
  `src/core/contracts.ts` and to `ADDON_CAPABILITIES` in
  `packages/addon-sdk/src/contracts.ts` (the validator consumes that list).
- **ADRs** — `docs/architecture/ADR-039-*` (harness category, status Deferred),
  `ADR-040-*` (terminal host contract), `TERMINAL-HOST-RECONCILIATION.md`.
- **Headless fixture + contract tests** — `examples/sdk-demo/terminal-host/in-memory-host.ts`
  (state machine, provenance derivation, in-memory host) and
  `examples/sdk-demo/tests/terminal-host-contract.test.ts`.
- **iTerm2 scaffold** — `examples/sdk-demo/terminal-host/iterm2/addon.json`
  (valid `AddOnSdkManifest`) and `adapter.mjs` (operation stubs), plus
  `examples/sdk-demo/tests/iterm2-manifest.test.ts`.

**Demo tests (must stay green):**
`npx vitest run --config examples/sdk-demo/vitest.config.ts` → currently **83/83 passing**.

---

## 2. Non-negotiable constraints (do not violate any)

1. **No second registry, manifest schema, capability system, or bridge launcher.**
   Reuse `AddOnManifest`, `validateAddOnManifest`, `createHarnessRegistry`, and
   the capability-token paths.
2. **No manifest-controlled command execution.** The adapter is an operator-started
   `local-service`; the bridge never `spawn`s an add-on. Spawn (iTerm2 itself,
   the harness) is fixed-root and gated — never ambient `PATH`.
3. **No `process.env` inheritance into add-ons or harnesses.** Provider
   credentials cross only as a scoped env allowlist, session-only.
4. **No secrets in a command string, shell history, HTML, or URL.** The only
   credential that crosses the terminal command line is the short-lived,
   single-use, audience-bound `SessionBootstrapGrant` delivered to
   `ros-session attach <id>`.
5. **No self-granted capabilities.** `terminal-host` is authored `granted: false`;
   the host grants it via `setGrants(consent)`, revocable, policy-enforced.
6. **The terminal is replaceable.** Pi must not learn whether iTerm2 or Ghostty
   (or an adopted vs. created session) is hosting it — the TH-3D/TH-6 equivalence.
7. **Screen-scraping is not the primary protocol.** Structured `HarnessRuntimeEvent`
   - terminal `TerminalTelemetryEvent` only; screen-stream is debug-only.
8. **DAR stays optional.** Installing/removing DAR must not affect Pi.
9. **Security acceptance must exercise the real iTerm2 + bridge boundary**, not
   mocks (mirror the SDK-DEMO-003 rule: no mock bridge that skips auth/CORS/origin).
10. **Do not regress** Hermes/OpenCode/browser-first behavior or the 83 demo tests.

---

## 3. Build plan (phase-by-phase)

### Phase 1 — TH-4: iTerm2 adapter · gate CP-TH4

Complete `examples/sdk-demo/terminal-host/iterm2/adapter.mjs`: resolve each
operation against iTerm2's Python API (its bundled `iterm2env`; no system Python).
Deliverables:

1. Register the adapter as a `local-service` add-on (the scaffold `addon.json`
   already validates). Prove capability discovery + host-owned `terminal-host`
   grant (request → consent → grant) through the existing registry.
2. Implement `createSession` / `adoptSession` / `attachSession` / `detachSession` /
   `terminateSession` / `listSessions` / `getSessionState` / `sendInput` /
   `launchBootstrap` against iTerm2 (windows/tabs/sessions, PromptMonitor,
   user variables). No spawn, no env spread, no credential in the command line.
3. The `ros-session attach <id>` bootstrap uses a `SessionBootstrapGrant` to fetch
   the authorized environment — never a long-lived token.

**CP-TH4 gate:** adapter discovered generically; `terminal-host` granted via
consent (never self-granted); operations stub-free and fixed-root.

`STOP AND REPORT` here.

### Phase 2 — TH-5: ROS ↔ iTerm2 connection proof (no Pi) · gate CP-TH5

Prove the full session lifecycle against real iTerm2 _without_ a harness:
create → attach → run → detach → terminate, plus adopt (`ros attach`) and
telemetry (`terminal.session.started`, `terminal.command.ended` with exit
status, `terminal.cwd.changed`). Prove the TH-3D equivalence: a session adopted
by the user and a session created by ROS expose the same attached contract.

**CP-TH5 gate:** create/adopt/attach/terminate all work against real iTerm2;
telemetry flows to ROS; no Pi involved.

`STOP AND REPORT` here.

### Phase 3 — TH-6: Pi end-to-end · gate CP-TH6

Attach Pi as a `cli` harness (ADR-039): project + files + provider profile +
skills through the existing Resource Projection. Launch from the ROS UI, execute
a real development task, verify artifacts.

**CP-TH6 gate:** real Pi operates in the iTerm2 session; provider credentials
session-only; artifacts recorded.

`STOP AND REPORT` here.

### Phase 4 — TH-7: Ghostty equivalence · gate CP-TH7

Build the Ghostty adapter and run the **same Pi add-on unchanged**:
`Pi + iTerm2 → PASS`, then `Pi + Ghostty → PASS`. If Pi needs any change to
switch terminals, the abstraction has leaked and you must fix the contract, not
Pi.

**CP-TH7 gate:** both terminal hosts PASS with zero harness change.

`STOP AND REPORT` here.

### Phase 5 — DAR optional composition · gate CP-DAR

Install DAR independently; subscribe it to `RosTerminalEventEnvelope`; run the
Pi proof again. Pi behaves identically; DAR records. Remove DAR; Pi still works.

`STOP AND REPORT` here.

---

## 4. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# iTerm2 is already installed in this environment. Ghostty is still needed for Phase 4:
brew install --cask ghostty
npm ci
npx vitest run --config examples/sdk-demo/vitest.config.ts   # 83/83 now
npm run build
npm test
npm run test:browser-host
npm run test:browser-first
npm run browser-first:audit-scope
```

Enable iTerm2's Python API under _Preferences → General → Magic → Enable Python
API_ (iterm2env is bundled; no separate system Python install).

---

## 5. Verification discipline (non-optional)

- **Never trust a green number you did not produce yourself.** Re-run the exact
  command and paste the tail.
- **Real-terminal tests must drive the actual iTerm2/Ghostty app**, not a mock.
- **No mock bridge that skips auth/CORS/origin checks** for security assertions.
- **Do not weaken a test to make it pass.** Record known failures exactly.
- **Commit per phase** with a `feat(terminal-host):` / `fix(terminal-host):` message.
- **Never push to `dev`/`main` or to `upstream`.**

---

## 6. STOP AND REPORT

At each gate, report: exact commits, exact commands run and their output tails,
files changed, what you verified against the real terminal, and any known
limitations — before continuing to the next phase.
