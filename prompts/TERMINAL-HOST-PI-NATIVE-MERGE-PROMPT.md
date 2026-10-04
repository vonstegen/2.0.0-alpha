# Terminal Host ↔ Pi-Native — Carry-Over + Session Manager + Bootstrap — OMP Build Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before touching anything.**

This is the reconciliation execution: carry the terminal-agnostic "authorized
session environment" seam (ADR-041–044) from `feature/pi-testing-phase` onto
`r-and-d/terminal-host-current-dev`, then build the ROS session manager and the
`ros-session attach` bootstrap. Steps 4–5 of the overall plan (launchBootstrap
env wiring + Pi attach) are **out of scope here** and gated on the
external-vs-embedded decision, which the operator has not yet made.

---

## 0. Mission

Make the "adopted terminal + harness uses ROS project/files/skills/credential"
path real up to the bootstrap: the seam files land on the active branch, the 5
ROS session verbs get a real home, and `ros-session attach` turns a
`SessionBootstrapGrant` into a projected session environment.

---

## 1. Read first (sources)

1. `docs/architecture/TERMINAL-HOST-PI-NATIVE-CARRYOVER-PLAN.md` — the exact
   carry-over order + conflict surface. **This is the authority for Phase 1–4.**
2. `docs/architecture/TERMINAL-HOST-PI-NATIVE-RECONCILIATION.md` — why the two
   tracks must meet, and what stays deferred.
3. `docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md` — the 4/5 op split (law).
4. `docs/architecture/ADR-040-terminal-host-adapter-contract.md` — the contract.
5. Pi branch sources (in the worktree at `../pi-phase2`): `ADR-041`…`ADR-044` and
   the seam files listed in the plan.

---

## 2. Environment + current state (verify first)

- **Active branch:** `r-and-d/terminal-host-current-dev` in
  `/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha`.
- **Source worktree:** `/Users/andrewjochl/Developer/Projects/resonant-os/pi-phase2`
  (branch `feature/pi-testing-phase`, HEAD `d6bfd37c`). Carry files **from here**.
- Node `>=24.21.0` (Homebrew Node 26).

Verify loop (must exit clean):

```bash
cd /Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null || { echo "NOT A GIT REPO"; exit 1; }
git rev-parse --short HEAD
git status --porcelain
test -f ../pi-phase2/packages/addon-sdk/src/harness-resources.ts || { echo "MISSING pi seam source"; exit 1; }
echo "verify-ok"
```

---

## 3. Non-negotiable constraints

1. **No wholesale merge.** Never `git merge feature/pi-testing-phase`. Carry the
   specific files, in dependency order, per the plan.
2. **ADR renumbering:** the active branch keeps `ADR-039`/`ADR-040`. The pi
   branch's `ADR-039`→`045`, `ADR-040`→`046`. Update `docs/architecture/README.md`.
3. **Keep both sides of every conflict file.** `src/core/contracts.ts`,
   `packages/addon-sdk/src/contracts.ts`, and
   `browser-first/host/harness-adapter-contract.mjs` must retain **both** the
   terminal-host additions and the pi additions.
4. **Do not carry the deferred files** (`pi-native-session-service.mjs`,
   `pi-native-tui-host-service.mjs`, `pi-process-launcher.mjs`, `pi-runtime.mjs`,
   `grok-native-*.mjs`, `opencode-session-host-service.mjs`).
5. **F2 split is law:** the 5 ROS verbs (`adoptSession`/`attachSession`/
   `detachSession`/`listSessions`/`getSessionState`) are ROS-side; never put them
   on a terminal adapter.
6. **No regression.** Core 721/721, demo 103/103, browser-first terminal-host
   21/21 must stay green at every gate.
7. **No secrets in argv/env/logs** — the credential seam (`buildSessionEnvironment`)
   is the only credential path.

---

## 4. Build plan (phase-by-phase)

### Phase 1 — TH-P1: carry Layer 0 leaves · gate CP-M1

Carry (copy from `../pi-phase2`, adapting import paths only):

- `browser-first/host/harness-session-environment.mjs`
- `browser-first/host/pi-native-provider-map.mjs`

Add their unit tests if they exist; otherwise note they are leaf-tested via Layer 3.

**CP-M1 gate:** files present; `node --experimental-strip-types --test` on any new
test passes; core/demo unchanged.

`STOP AND REPORT` here.

### Phase 2 — TH-P2: carry Layer 1 (contract constants + request contract) · gate CP-M2

1. Add `HARNESS_RESOURCE_FAMILIES` + `HARNESS_RESOURCE_OPERATIONS` to
   `packages/addon-sdk/src/contracts.ts` (reconciling with the existing
   `terminal-host` entry in `ADDON_CAPABILITIES`).
2. Add `harnessProviderConnection`, `agentRuntime.credentialSource`, and any
   `HarnessResource*` types to `src/core/contracts.ts` (reconciling with the
   existing `terminal-host` capability + `HarnessEvent` `terminal.*` variants).
3. Carry `packages/addon-sdk/src/harness-resources.ts`.

**CP-M2 gate:** `npx tsc --noEmit` clean; `npx vitest run` (core) = 721/721.

`STOP AND REPORT` here.

### Phase 3 — TH-P3: carry Layer 2 + 3 (projections + credential adapter) · gate CP-M3

Carry:

- `browser-first/host/harness-resource-projection.mjs`
- `browser-first/host/harness-skills-projection.mjs`
- `browser-first/host/pi-native-credential-adapter.mjs`

Verify the dependency `deriveProviderProtocol` exists in
`browser-first/host/provider-fabric-core.mjs` (it is present; confirm the export).

**CP-M3 gate:** `node --experimental-strip-types --test` on
`harness-resource-projection.test.mjs` + `harness-skills-projection.test.mjs`
passes; no core/demo regression.

`STOP AND REPORT` here.

### Phase 4 — TH-P4: carry Layer 4 + 5 (tests + ADRs + renumber) · gate CP-M4

1. Carry `browser-first/test/harness-resource-projection.test.mjs`,
   `harness-skills-projection.test.mjs`, `harness-skills-staging-audit.test.mjs`,
   `harness-skills-staging-hardening.test.mjs`, `pi-native-session-credential.test.mjs`,
   and `src/sdk/addons/harness-resources.test.ts`.
2. Carry `ADR-041`…`ADR-044`. Renumber pi `ADR-039`→`045`, `ADR-040`→`046`; fix
   the index in `docs/architecture/README.md`.

**CP-M4 gate:** `npm run docs:check` passes (no new unreachable docs); ADR index
validates; all suites green.

`STOP AND REPORT` here.

### Phase 5 — TH-P5: build the ROS session manager (5 verbs) · gate CP-M5

Implement `ROS_SESSION_OPERATIONS` as a ROS-side service. Recommended shape: port
the state machine + `RosTerminalSession` shape from
`examples/sdk-demo/terminal-host/in-memory-host.ts` into a
`browser-first/host/terminal-host-session-manager.mjs` exporting
`adoptSession`, `attachSession`, `detachSession`, `listSessions`,
`getSessionState` (plus `createSession`/`terminateSession` for completeness).

- It owns `RosTerminalSession` records only — no terminal IO, no adapter calls.
- It reconciles state against terminal telemetry (e.g. a `terminal.session.terminated`
  event marks the ROS session terminated).
- The in-memory fixture becomes a thin wrapper over it, or the test still passes
  through the same transitions.

**CP-M5 gate:** a new `terminal-host-session-manager.test.mjs` exercises
adopt→attach→detach→list→state; in-memory + contract tests unchanged.

`STOP AND REPORT` here.

### Phase 6 — TH-P6: build `ros-session attach` · gate CP-M6

Implement the bootstrap that consumes the grant and returns the projected env:

1. The bridge must **track minted grants** (extend `mintSessionBootstrapGrant` /
   `launchBootstrap` to record `sessionId → { token, issuedAt, expiresAt, consumed }`).
2. Add a broker endpoint (mirror the `POST /addons/grants` precedent) — e.g.
   `POST /terminal-host/session/attach` — that validates the presented
   `SessionBootstrapGrant` (token known, unexpired, unconsumed, audience =
   `sessionId`) and returns the projected session env built from
   `buildSessionEnvironment` + resource/skills projection + credential adapter.
3. Provide a thin `ros-session` CLI (or shell entry) that POSTs the grant and
   exports the returned env into the shell — **never** printing the secret.

**CP-M6 gate:** a test proves a valid grant returns a projected env and a
replayed/expired/wrong-session grant is rejected; no secret in argv/logs.

`STOP AND REPORT` here.

---

## 5. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
node --version
npm ci
npx tsc --noEmit
npx vitest run                                                  # core (721)
npx vitest run --config examples/sdk-demo/vitest.config.ts       # demo (103)
node --experimental-strip-types --test \
  browser-first/test/harness-resource-projection.test.mjs \
  browser-first/test/harness-skills-projection.test.mjs \
  browser-first/test/harness-skills-staging-audit.test.mjs \
  browser-first/test/harness-skills-staging-hardening.test.mjs
npm run docs:check
```

---

## 6. Verification discipline + STOP AND REPORT

Never trust a green number you did not produce yourself. Re-run the exact command;
paste the summary + last ~20 lines. Commit per phase with `feat(terminal-host):` /
`test(terminal-host):` / `docs(terminal-host):`. Never push to `dev`/`main`/`upstream`.

At each gate report: exact commits, exact commands + output tails, files changed,
test counts **named by label** (core / demo / browser-first), and any known
limitations (e.g. "deferred pi-native session/TUI files not carried").
