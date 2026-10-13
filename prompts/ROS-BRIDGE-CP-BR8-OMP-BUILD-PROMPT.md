# OMP BUILD — End-to-end Acceptance — CP-BR8

Paste this entire prompt into a new OMP harness session.

---

You are running CP-BR8 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
doing anything. Do not rely on prior chat history.

## 0. Mission

CP-BR8 is the **end-to-end acceptance** phase — it proves the whole loop works,
it does **not** build new factories. Concretely, prove:

1. ROS starts the bridge automatically;
2. Bridge & Runtimes reports `Connected`;
3. Ghostty activates through the ROS add-on UI (`Starting → Connected`);
4. Pi shows `Open in Terminal` and opens in Ghostty;
5. Pi receives the ROS project, skills, and memory context;
6. Pi can use an approved provider credential;
7. no token / credential / path leaks into UI, logs, argv, or the bus;
8. disable closes ROS-owned terminal windows and the UI updates;
9. ROS restart restores enabled runtimes exactly once.

Do **not** implement CP-BR9, and do **not** build real `pi-runtime` /
`external-cli-terminal` factories. Pi launch flows through the existing harness
path (`OpenInTerminalButton → external-cli-terminal → launchBootstrap`); the
generic lifecycle's `pi-runtime` seed stays a no-op. This is an acceptance gate,
not a build gate.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

`HEAD` is expected to be:

```text
e19548e4 feat(bridge): derive bridge overview from real boot/health state
```

Prior to CP-BR8, the uncommitted part-2 `publicEndpoint` follow-up must be
committed (suggested subject: `feat(bridge): expose public endpoint in the bridge
overview`). Confirm `git status` is clean before starting. Nothing is pushed.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node 24+ is required; `.nvmrc` pins `24.21.0`, which is the known-working version
(`nvm use` from the repo root).

## 2. Worktree state — commit this phase

Start clean. CP-BR8 is mostly evidence-gathering; the only new artifacts are the
stub-terminal smoke (if missing), any real-Ghostty smoke script, the operator
runbook, and the roadmap/checklist updates. Make small checkpoint commits. Do not
push. Do not rebase or merge.

Editor/formatting previously caused whole-file noise. Use surgical edits.

## 3. Source of truth — read in order

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   — especially §14 "Phase 8 — End-to-end acceptance · CP-BR8" (the automated
   checklist + 15-row operator checklist + gate);
2. `docs/architecture/BRIDGE-RUNTIME-PROJECTION.md` (the `bridgeOverview` shape);
3. `docs/architecture/RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md`;
4. `docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`;
5. `docs/product/TERMINAL-ACTIVATION.md` and
   `docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md`;
6. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md` and `MODULE-OWNERSHIP.md`;
7. Composition root and terminal wiring:
   - `browser-first/host/run-bridge-minimal.mjs`
   - `browser-first/host/terminal-runtime-factories.mjs`
   - `browser-first/host/terminal-host-bridge-wiring.mjs`
8. The Pi harness path (what CP-BR8 accepts, do NOT rebuild):
   - `browser-first/host/agent-adapters/external-cli-terminal.mjs`
   - `browser-first/host/harness-policies/pi.mjs`
   - `browser-first/host/pi-runtime.mjs`
   - `src/modules/terminal/OpenInTerminalButton.tsx`
9. Existing smoke examples:
   - `examples/sdk-demo/terminal-host/in-memory-smoke.mjs`
   - `examples/sdk-demo/terminal-host/ghostty/smoke.mjs`

## 4. Contracts you must accept (do not rebuild)

- **RuntimeFactory interface (CP-BR4):** `spawnPolicy, start, stop, health,
  degrade, closeSessions`. The terminal factories are real; `pi-runtime` and
  `external-cli-terminal` remain reviewed no-op seeds.
- **Projection (CP-BR5):** `bridgeOverview` now carries `endpoint` (loopback) and
  `publicEndpoint` (LAN/Tailscale). The shape-walker and hostile-value tests are
  the non-leak authority.
- **Desired-state rule (CP-BR3):** `installed AND enabled AND required caps
  granted AND compatible AND reviewed factory exists AND no hard-stop`.
- **Terminal identity:** `addon.resonant-terminal-ghostty` and
  `addon.resonant-terminal-iterm2` (both `local-service`, `terminal-host`
  capability, grant presets `ghostty-terminal-host` / `iterm2-terminal-host`).
  `RESONANT_TERMINAL_DRIVER` selects `ghostty` / `iterm2` / `in-memory`.

## 5. Required CP-BR8 behavior

### 5.1 Automated checklist — the agent runs and records counts

Prove each of these is green, and report the exact command + count:

1. Bootstrap offline / start / already-running / restart tests.
2. SDK desired-state matrix (`packages/addon-sdk/test/runtime-lifecycle.test.mjs`).
3. Lifecycle manager start/stop/generation/recovery tests
   (`runtime-reconciler.test.mjs`).
4. Projection shape-walker and hostile-value tests.
5. Bridge & Runtimes UI component tests (`bridge-runtimes-section.test.mjs`).
6. Terminal activation/deactivation integration tests
   (`terminal-runtime-factories`, `terminal-lifecycle-reconciler-wiring`,
   `terminal-projection-badges`).
7. Full core / demo / browser-first regression.
8. Stub terminal smoke (in-memory; no real process).
9. Real Ghostty smoke (macOS Ghostty is installed) — the adapter spawns and the
   connection is reported `Connected`; do **not** fake this with in-memory.
10. iTerm2 parity smoke where available.

### 5.2 Operator checklist — produce a runnable runbook, then execute what you can

Record each row `Yes` / `No` with non-secret evidence. Rows 6–11 require a real
Pi binary, a real provider credential, and a human at Chrome — the agent must
prepare exact steps and env vars but may not claim `Yes` without a real run.

| # | Proof |
|---|-------|
| 1 | ROS starts bridge automatically |
| 2 | Bridge & Runtimes shows `Connected` |
| 3 | Ghostty appears under Terminal add-on surfaces |
| 4 | Enabling Ghostty requests `terminal-host` grant |
| 5 | Ghostty transitions `Starting → Connected` |
| 6 | Pi shows `Open in Terminal` |
| 7 | Pi opens in Ghostty |
| 8 | Pi receives ROS project |
| 9 | Pi receives ROS skills |
| 10 | Pi receives ROS memory context |
| 11 | Pi can use approved provider credential |
| 12 | No token/credential appears in UI/logs/argv/bus |
| 13 | Disable closes ROS-owned terminal windows |
| 14 | Bridge/runtime UI updates after disable |
| 15 | ROS restart restores enabled runtimes once |

## 6. Implementation requirements

- Stub terminal smoke lives alongside the existing
  `examples/sdk-demo/terminal-host/` smoke scripts; it uses the in-memory driver
  and never spawns a real terminal.
- Real Ghostty smoke must drive the real `ghostty` driver (`RESONANT_TERMINAL_HOST_BRIDGE=1`,
  `RESONANT_TERMINAL_DRIVER=ghostty`) and assert the adapter is reachable /
  `Connected`; it never embeds a credential, token, or absolute user path in its
  output or assertions.
- Do not add the reconciler / factory wiring into `bridge-server.mjs`; acceptance
  exercises the existing composition, it does not re-architect it.
- Evidence is recorded in Markdown under `docs/` with redaction; never write a
  token, credential, or full private path.

## 7. Non-negotiable security rules

1. No caller-supplied executable / command / argv / shell / path / cwd / env /
   endpoint.
2. Factories own their spawn policy; the acceptance smoke never bypasses it.
3. No `process.env` spread into a spawned adapter.
4. `closeSessions` closes ROS-owned sessions; zero leaked windows.
5. Lifecycle events, projection, and acceptance evidence stay non-secret.
6. Classification is not lifecycle authority.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR7 behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Run the automated checklist (§5.1) in the order listed. The stub smoke and real
Ghostty smoke are new; every other item is an existing suite that must stay
green. If a suite fails, fix only what CP-BR8 acceptance exposes — do not weaken
tests.

## 9. Documentation

- Add the operator runbook (exact steps + env vars for rows 1–15), linked from
  the roadmap §14 and the Terminal Activation guide.
- Update the CP-BR8 checklist and gate in
  `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` with recorded `Yes`/`No`
  and evidence pointers (no secrets).
- Keep `MODULE-OWNERSHIP.md`, the Alpha boundary, and ADR-047 consistent.

## 10. Verification

Always use Node 24.21.0. Run targeted suites first, then the full regression.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test --test-force-exit \
  browser-first/test/bootstrap-protocol.test.mjs \
  browser-first/test/bootstrap-lifecycle.test.mjs \
  browser-first/test/bootstrap-host-main.test.mjs \
  browser-first/test/bootstrap-installer.test.mjs \
  browser-first/test/bootstrap-client.test.mjs \
  browser-first/test/bootstrap-startup.test.mjs \
  browser-first/test/rebind-coordinator.test.mjs \
  browser-first/test/bridge-bootstrap-probe.test.mjs \
  browser-first/test/bridge-runtimes-section.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/runtime-reconciler.test.mjs \
  browser-first/test/runtime-projection.test.mjs \
  browser-first/test/runtime-projection-staleness.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs \
  browser-first/test/terminal-runtime-factories.test.mjs \
  browser-first/test/terminal-lifecycle-reconciler-wiring.test.mjs \
  browser-first/test/terminal-projection-badges.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Report counts by label: `core`, `demo`, `browser-first`, `ownership/docs`, and
the two smoke results (stub + real Ghostty). Do not claim a test passed unless
you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR8 work in small checkpoint commits.
- Do not push. Do not rewrite history, merge, or rebase.
- Do not commit unrelated files or add dependencies.
- Do not weaken tests.

Suggested commit sequence:

1. `test(bridge): add stub terminal smoke`
2. `test(bridge): add real Ghostty smoke`
3. `docs(bridge): add CP-BR8 operator acceptance runbook`
4. `docs(bridge): record CP-BR8 acceptance evidence and gate`

## 12. CP-BR8 gate

CP-BR8 is green only when:

- every automated checklist item (§5.1) is green with a recorded count;
- every **mandatory** operator row is `Yes` (rows requiring a real Pi/credential
  and a human are honestly marked, not fabricated);
- evidence is recorded without secrets;
- the roadmap checklist + gate are updated.

If rows 6–11 cannot be executed by the agent (no real Pi / credential / human),
report CP-BR8 as **partial** with an explicit list of the rows that remain open
for the operator — never mark them `Yes`.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Automated checklist:** each item + command + count.
3. **Smoke:** stub-terminal result and real-Ghostty result (separate).
4. **Operator checklist:** 15-row table with `Yes` / `No` / `not-runnable` and
   non-secret evidence; call out which rows are open for the operator.
5. **Files and commits:** exact files changed and commit hashes.
6. **Non-leak evidence:** how the shape-walker / hostile-value / smoke checks
   confirm no secret in UI/logs/argv/bus.
7. **Docs check:** exact issue count and delta from baseline.
8. **Remaining risks/blockers:** especially the operator-only rows deferred.
9. Explicit `STOP — CP-BR8`.
