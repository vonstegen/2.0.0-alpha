# NEW ZED CHAT — ROS Bridge + SDK Add-on Runtime Lifecycle — CP-BR0/CP-BR1 Handoff

Paste this entire prompt into a **new Zed harness chat session**.

---

You are starting a new implementation session in the ResonantOS repository.
Read this entire prompt before changing files. Do not rely on prior chat history;
this document is the handoff.

## 0. Mission

Begin the **ROS Bridge + SDK Add-on Runtime Lifecycle** program. The product
outcome is:

- ROS owns and starts one authenticated core bridge when ROS starts.
- Add-ons do not start the bridge; add-on activation starts reviewed modular
  runtime services behind the already-running bridge.
- The ROS UI provides **Settings → Bridge & Runtimes**, showing core bridge,
  add-on runtime, connector, and session status.
- Terminal add-ons are the first complete proof: enable/authorize Ghostty or
  iTerm2 in ROS → SDK lifecycle starts the adapter → tab becomes Connected →
  Open in Terminal launches Pi with ROS-granted credential/project/skills/memory.

This session covers **CP-BR0 and CP-BR1 only**:

1. freeze/reconcile the architecture and superseded work (CP-BR0);
2. design and implement the independent core bridge bootstrap contract with
   deterministic tests (CP-BR1);
3. `STOP AND REPORT` before integrating bridge startup into extension startup
   (CP-BR2 is a later session).

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

At handoff time:

- `HEAD`: `ce6ebdf3 feat(terminal-host): add Launch Bridge UI affordance + auto-retry`
- branch is **20 commits ahead of origin**;
- nothing is pushed;
- do not push, open a PR, merge, rebase onto `dev`/`main`, or merge
  `feature/pi-testing-phase`.

Uncommitted user/AVIS work exists and must be preserved:

```text
 M docs/architecture/README.md
 M prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md
?? docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
```

Do not discard, reset, overwrite, or reformat these files. Review them first.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node must satisfy the repository requirement (Node 24+; Homebrew Node 26 is
known working).

## 2. Source of truth — read first

Read these in order:

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - governing program roadmap;
   - phases CP-BR0 through CP-BR9;
   - one core bridge + modular SDK runtimes decision;
   - public lifecycle states, gates, test matrix, operator checklist.
2. `prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md`
   - now marked **SUPERSEDED — DO NOT IMPLEMENT**;
   - retained as decision history.
3. `docs/architecture/ADR-006-addon-runtime-sdk.md`
4. `docs/architecture/ADR-018-addon-sdk-v0.md`
5. `docs/architecture/ADR-037-browser-first-chromium-resonantos.md`
6. `docs/architecture/ADR-046-addon-classification-category-discovery.md`
7. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
8. `docs/architecture/MODULE-OWNERSHIP.md`
9. `browser-first/host/run-bridge-minimal.mjs`
10. `browser-first/host/bridge-bootstrap.mjs`
11. `browser-first/host/bridge-launcher.mjs` (if present)
12. `browser-first/host/terminal-host-bridge-wiring.mjs`
13. `browser-first/host/harness-host-service.mjs`
14. `src/core/web-transport.ts`
15. `src/modules/terminal/OpenInTerminalButton.tsx`

## 3. Important branch fact: superseded design was implemented

After the Launch Bridge prompt was committed, three commits implemented its
self-start design:

```text
68fe1ff2 feat(terminal-host): add idempotent bridge launcher
a901fa1f feat(terminal-host): add POST /bridge/launch route
ce6ebdf3 feat(terminal-host): add Launch Bridge UI affordance + auto-retry
```

Do **not** blindly trust, delete, or revert these commits. Audit them first.

The architectural problem is:

> A stopped bridge cannot serve `POST /bridge/launch` to start itself.

Parts of those commits may still be reusable:

- pinned process launch logic;
- fixed argv;
- environment allowlist;
- health polling;
- typed public errors;
- deterministic tests;
- UI status/auto-retry patterns.

But the **offline bootstrap owner must be independent of the bridge**. Reconcile
the implementation by extracting reusable logic behind an independent bootstrap
contract. Keep `/bridge/launch` only if it has a truthful online-only purpose
(e.g. restart/diagnostics while the bridge is already reachable); otherwise
mark/deprecate it without deleting evidence prematurely.

## 4. Recorded architecture decision

### One core bridge

ROS has one authenticated loopback bridge process. It owns common:

- authentication and capability tokens;
- host-owned add-on registry;
- provider/credential boundaries;
- route composition;
- lifecycle reconciliation;
- non-secret runtime/connector/session projection;
- audit and telemetry.

### Modular add-on runtime services

Add-on services start and stop behind the bridge from host-owned SDK state.
Do not create a bridge per add-on or per category.

### Category is not lifecycle authority

Per ADR-046, classification says what an add-on is. It must not decide process
lifecycle or grant authority. Desired runtime state derives from:

```text
installed
AND enabled
AND required capabilities granted
AND compatible
AND reviewed runtime factory exists
AND no hard-stop revocation fence
```

### Independent offline bootstrap

For browser-first ROS, extension JavaScript cannot directly spawn Node. The
core bridge bootstrap must be reachable while the bridge is offline. Candidate
owners:

- installed ROS native-messaging/bootstrap host (preferred product direction);
- ROS-managed macOS `launchd` service (acceptable development/Alpha path);
- future native shell host (not current Alpha runtime).

CP-BR0 must choose and document the Alpha owner before CP-BR1 implementation.
Do not invent a second HTTP route hosted by the stopped bridge.

## 5. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, or working
   directory.
2. Bridge entrypoint and working directory are host-pinned.
3. Never spread `process.env` to a spawned process; use an explicit allowlist.
4. Never return/read/log bridge capability tokens, provider credentials,
   prompt content, memory content, auth-file/token-file contents, or raw env.
5. Bootstrap status contains public fields only: status, public version,
   loopback endpoint, generation/instance id, timestamps, public failure code.
6. Start is idempotent and generation-fenced.
7. Startup/restart/health waits are bounded; no infinite polling or restart loop.
8. No manifest `service.entrypoint` arbitrary shell execution. Future add-on
   runtimes use a reviewed runtime factory registry.
9. Preserve existing bridge authentication and loopback/capability enforcement.
10. Preserve all XH4/XH5 terminal non-leak and cleanup invariants.

## 6. Phase CP-BR0 — architecture reconciliation

### Tasks

- [ ] Audit `68fe1ff2`, `a901fa1f`, and `ce6ebdf3` file by file.
- [ ] Record which implementation pieces are reusable and which depend on the
      impossible self-start route.
- [ ] Confirm the actual current Alpha startup/package boundary.
- [ ] Inventory existing native messaging, launchd, startup scripts, generated
      bridge config, and extension rebind behavior.
- [ ] Select the CP-BR1 bootstrap owner for Alpha.
- [ ] Add/extend an ADR recording:
      - one core bridge;
      - independent bootstrap owner;
      - modular SDK runtime services;
      - category is not lifecycle authority;
      - public bootstrap/runtime status boundaries.
- [ ] Add this roadmap to the canonical architecture index if not already done.
- [ ] Keep the old Launch Bridge prompt marked superseded.
- [ ] Reconcile or deprecate the implemented `/bridge/launch` route truthfully.

### CP-BR0 gate

- No reachable code path claims a stopped bridge can start itself through a
  bridge-hosted HTTP route.
- One Alpha bootstrap owner is named and reviewed.
- Reusable Launch Bridge code is documented, not silently discarded.
- Architecture docs and ownership docs agree.

`STOP AND REPORT` CP-BR0 before beginning CP-BR1 implementation. The report
must identify the selected bootstrap owner and list exact files kept/changed/
deprecated from the three superseded commits.

## 7. Phase CP-BR1 — independent bootstrap contract

After CP-BR0 is accepted in-session, implement a deterministic bootstrap
contract owned outside the bridge.

### Public contract

Minimum operations:

```text
status
start
restart
stopForShutdown
```

Minimum public status vocabulary:

```text
offline | starting | connected | degraded | restarting | failed
```

Public result may carry:

```text
status
public version
loopback endpoint
instance/generation id
startedAt
public failure code
alreadyRunning
```

No secrets or private paths.

### Implementation checklist

- [ ] Add the independent bootstrap protocol/module for the owner selected in
      CP-BR0.
- [ ] Pin bridge entrypoint, working directory, and fixed argv.
- [ ] Add explicit child env allowlist.
- [ ] Make start idempotent.
- [ ] Add generation fencing.
- [ ] Bound startup, restart, and health timeouts.
- [ ] Reuse `ensureBridgeReachable`; do not duplicate health probing.
- [ ] Reuse safe pieces from `bridge-launcher.mjs` where appropriate.
- [ ] Return public error codes only.
- [ ] Add deterministic tests with spawn/bootstrap seams.
- [ ] Add hostile-input and shape-walker tests.
- [ ] Do not wire extension startup yet (CP-BR2).
- [ ] Do not build generic runtime lifecycle manager yet (CP-BR3/4).

### CP-BR1 test cases

- offline → start → connected;
- connected → start returns already-running with no second spawn;
- restart uses a new generation and rejects stale completion;
- failed spawn returns public `start-failed`/equivalent;
- health timeout is bounded;
- arbitrary command/argv/workdir rejected or impossible by type/shape;
- process env contains allowlisted keys only;
- non-loopback endpoint rejected;
- no token/credential/path/env/prompt/memory content in result or telemetry;
- shutdown stops only an instance owned by ROS bootstrap.

### CP-BR1 gate

- Independent bootstrap fixture starts the reviewed bridge exactly once.
- It remains callable while the bridge HTTP server is absent.
- Idempotency, generation fencing, timeout, and non-leak tests pass.
- Existing terminal-host tests remain green.

`STOP AND REPORT` at CP-BR1. Do not proceed to CP-BR2 in this chat session.

## 8. Verification commands

Start targeted, then run full regression:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/harness-host-service.test.mjs \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

Add the new CP-BR1 test file(s) to the browser-first command. Report counts by
label: `core`, `demo`, `browser-first`.

`docs:check` currently has a known pre-existing reachability backlog. Report the
exact count and whether any new issue is attributable to this work; do not fix
unrelated documentation findings.

## 9. Git and editing discipline

- Preserve user work.
- Do not push.
- Do not rewrite unrelated history.
- Make small checkpoint commits.
- Suggested commit sequence:
  1. `docs(bridge): record core bridge + SDK runtime lifecycle decision`
  2. `refactor(bridge): reconcile superseded self-start route`
  3. `feat(bridge): add independent ROS bootstrap contract`
  4. `test(bridge): cover bootstrap idempotency + generation fencing`
- Zed may auto-format whole JS/TS files. If a surgical edit causes formatting
  noise, revert that file and reapply via an exact-string throwaway script;
  delete the script afterward.
- Do not claim a gate passed unless you ran it and saw it pass.

## 10. Final report format

At each checkpoint report:

1. Verdict: green / partial / blocked.
2. Selected architecture/owner.
3. Files and commits.
4. Reusable/deprecated Launch Bridge work.
5. Tests run with labeled counts.
6. Non-leak evidence.
7. Remaining risks/blockers.
8. Explicit `STOP` at CP-BR0 or CP-BR1.

The session is complete only after CP-BR1 is green or honestly blocked and the
agent has stopped before CP-BR2.
