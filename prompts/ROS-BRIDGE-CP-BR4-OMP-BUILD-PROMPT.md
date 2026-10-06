# OMP BUILD — Runtime Factory Registry And Reconciler — CP-BR4

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR4 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Start and stop reviewed add-on runtimes from host-owned registry state. CP-BR3
delivered the pure `deriveDesiredRuntimeState()` resolver; this session builds
the **act** side of the decide→act seam: a reviewed runtime factory registry and
an idempotent `reconcile(snapshot)` that translates desired-state decisions into
bounded, generation-fenced, per-add-on start/stop behavior.

This session covers **CP-BR4 only**:

1. add a reviewed runtime factory registry (no arbitrary entrypoint execution);
2. implement idempotent `reconcile(snapshot)`;
3. serialize lifecycle transitions per add-on and add generation fencing;
4. bound start/stop/health timeouts and stop stale runtimes;
5. restore desired runtimes after bridge restart and close sessions on stop;
6. emit non-secret lifecycle events;
7. fix the CP-BR3 grant-completeness gap before the reconciler trusts the
   resolver's `running` decision;
8. `STOP AND REPORT` before the runtime/connector/session projection.

Do **not** implement CP-BR5/CP-BR6. In particular, do not build the Bridge &
Runtimes UI, do not add the public runtime/connector/session projection, and do
not migrate terminal add-ons onto this lifecycle (CP-BR7).

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

Base `HEAD`:

```text
ce6ebdf3 feat(terminal-host): add Launch Bridge UI affordance + auto-retry
```

No commits were made during CP-BR0 through CP-BR3; all work remains uncommitted
in the working tree. The branch is still ahead of origin. Nothing should be
pushed.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node must satisfy the repository requirement. Node 24+ is required; Homebrew
Node 26 is the known-working version and must be on the PATH above. Under nvm
Node 22.13 the `bridge-auth-inprocess-self-test.test.mjs` test fails with
`ERR_UNKNOWN_FILE_EXTENSION` because it spawns a bridge entry that imports
`.ts`; that is a Node-version requirement, not a code defect. Always verify with
Node 26.

## 2. Preserve the CP-BR0 + CP-BR1 + CP-BR2 + CP-BR3 worktree

Four phases of work are already uncommitted. Inspect `git status` first and
preserve everything. Do not reset, discard, overwrite, or broadly reformat
existing work. Before editing any modified file, inspect its working-tree diff.

Expected modified/untracked work includes (exact status may differ):

```text
 M browser-first/host/bridge-bootstrap.mjs
 M browser-first/host/bridge-launcher.mjs
 M browser-first/host/harness-host-service.mjs
 M browser-first/resonantos-side-panel-extension/manifest.json
 M browser-first/resonantos-side-panel-extension/src/background.js
 M browser-first/resonantos-side-panel-extension/src/lib/main-workspace-settings.js
 M browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js
 M browser-first/resonantos-side-panel-extension/src/main-workspace.js
 M browser-first/resonantos-side-panel-extension/src/side-panel.js
 M browser-first/test/bridge-launch-route.test.mjs
 M browser-first/test/bridge-launcher.test.mjs
 M browser-first/test/bridge-target-section-launch.test.mjs
 M docs/architecture/ALPHA_RUNTIME_BOUNDARY.md
 M docs/architecture/MODULE-OWNERSHIP.md
 M docs/architecture/README.md
 M packages/addon-sdk/src/index.ts
 M prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md
 M src/core/web-transport.test.ts
 M src/core/web-transport.ts
 M src/modules/terminal/OpenInTerminalButton.test.tsx
 M src/modules/terminal/OpenInTerminalButton.tsx
?? browser-first/bootstrap/
?? browser-first/resonantos-side-panel-extension/src/lib/bootstrap-client.js
?? browser-first/resonantos-side-panel-extension/src/lib/bootstrap-renderer.js
?? browser-first/resonantos-side-panel-extension/src/lib/bootstrap-startup.js
?? browser-first/resonantos-side-panel-extension/src/lib/rebind-coordinator.js
?? browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-bootstrap-section.js
?? browser-first/test/bootstrap-*.test.mjs
?? browser-first/test/bridge-bootstrap-probe.test.mjs
?? browser-first/test/rebind-coordinator.test.mjs
?? packages/addon-sdk/src/runtime-lifecycle.ts
?? packages/addon-sdk/test/
?? docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
?? docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md
?? docs/architecture/BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md
?? docs/architecture/BRIDGE-BOOTSTRAP-PROTOCOL.md
?? docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md
?? docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md
?? prompts/ROS-BRIDGE-CP-BR1-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-CP-BR2-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-CP-BR3-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-SDK-RUNTIME-NEW-CHAT-HANDOFF.md
```

The CP-BR1/CP-BR2/CP-BR3 packages, tests, and docs are authoritative. Read them;
do not rebuild them.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use
surgical edits. If formatting noise appears, restore only your own edit and
reapply it with an exact-string throwaway script, then delete the script.

Do not push, open a PR, merge, rebase, or merge `feature/pi-testing-phase`.

## 3. Source of truth — read in order

1. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
2. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially §4 (public lifecycle model) and CP-BR4;
3. `docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`
4. `docs/architecture/ADR-046-addon-classification-category-discovery.md`
5. `docs/architecture/ADR-018-addon-sdk-v0.md`
6. `docs/architecture/ADR-006-addon-runtime-sdk.md`
7. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
8. `docs/architecture/MODULE-OWNERSHIP.md`
9. CP-BR3 resolver (the decide side you must act on):
   - `packages/addon-sdk/src/runtime-lifecycle.ts`
   - `packages/addon-sdk/test/runtime-lifecycle.test.mjs`
10. Host-owned registry state (read only; do not change authority semantics):
    - `browser-first/host/harness-registry.mjs`
    - `browser-first/host/harness-registry-store.mjs`
    - `browser-first/host/harness-host-service.mjs`
11. Existing reviewed runtime/process patterns (seeds for the factory registry):
    - `browser-first/host/terminal-host-service.mjs`
    - `browser-first/host/terminal-host-bridge-wiring.mjs`
    - `browser-first/host/agent-adapters/external-cli-terminal.mjs`
    - `browser-first/host/pi-runtime.mjs`
    - `browser-first/host/hermes-runtime.mjs` (if present)
    - `browser-first/host/opencode-runtime.mjs` (if present)
12. CP-BR1 pinned spawn policy (the pattern factories must follow):
    - `browser-first/bootstrap/bridge-policy.mjs`
13. Deprecated launcher (historical evidence only):
    - `browser-first/host/bridge-launcher.mjs`

## 4. Contracts you must consume (do not rebuild)

### 4.1 CP-BR3 decide→act seam

`deriveDesiredRuntimeState(input)` returns `AddOnRuntimeDesiredStateDecision`
(`desiredState: "running" | "stopped" | "degraded"`, `publicReason`,
`publicFailureCode?`). CP-BR4 consumes these decisions; it never re-derives the
desired-state rule and never duplicates the resolver.

### 4.2 Runtime type vocabulary (ADR-018)

```text
ui-module | embedded-module | local-service | agent-addon | channel-addon
```

Factories are keyed by a reviewed identifier derived from `runtimeType` and the
add-on's reviewed runtime binding — never by `classification.category`, which is
not lifecycle authority.

### 4.3 Host registry authority

Installed/enabled/grant/compatibility/revocation/generation come from the
host-owned registry projection. The reconciler treats the registry as the source
of truth and never lets a UI button, a stale snapshot, or a forged request start
a runtime directly.

## 5. Required CP-BR4 behavior

### 5.1 Reviewed runtime factory registry

Add a registry mapping a **reviewed runtime factory id** to a host-owned factory
function. A factory is reviewed host code with a pinned spawn policy (executable,
entry, argv, cwd, env allowlist, endpoint) and a typed `start`/`stop`/`health`
interface. CP-BR4:

- never executes `manifest.service.entrypoint` as shell text;
- never accepts a caller-supplied executable, command, argv, path, cwd, env, or
  endpoint;
- refuses an unknown/unregistered factory id (fail closed);
- keeps the registry independent of add-on grant/slot authority (a factory
  existing is not a grant).

Seed the registry with the existing reviewed runtime paths
(`terminal-host-service`, the external CLI harness adapter, `pi-runtime`, and the
OpenCode/Hermes runtimes where applicable), but do not migrate terminal add-ons
onto the generic lifecycle yet (that is CP-BR7).

### 5.2 Idempotent `reconcile(snapshot)`

Implement `reconcile(snapshot)` that, for each add-on in the host projection:

- desired `running` + registered factory → ensure started exactly once;
- already `ready` for the current generation → no-op;
- desired `stopped`/`degraded` + currently running → stop (close sessions,
  deterministic cleanup);
- desired `running` but no reviewed factory → leave stopped and surface the
  public `addon-factory-missing` code (do not guess an entrypoint);
- desired `degraded` → degrade or stop per the reviewed factory's degrade policy.

The reconciler must be idempotent: running it twice with the same snapshot
produces no duplicate process and no spurious transitions.

### 5.3 Serialize transitions per add-on

Lifecycle transitions for one add-on are serialized. Concurrent reconciles join
or queue, never race two starts/stops for the same add-on. Different add-ons may
proceed independently.

### 5.4 Generation fencing

Every start/restart receives a new generation. A stale start, health result,
exit callback, or stop from an older generation must not become active or
overwrite newer state. Reuse the host registry's generation/boot-epoch identity;
do not invent a parallel identity.

### 5.5 Bounded waits

Bound start, stop, health, and restart waits. On timeout, make a bounded attempt
to stop only the owned child and surface the public failure code. No unbounded
polling or restart loop.

### 5.6 Stop stale runtime after generation replacement

When an add-on's generation is replaced (restart/reconcile), the previous owned
runtime must be stopped before or deterministically after the new one is
adopted, never left orphaned.

### 5.7 Restore desired runtimes after bridge restart

After the core bridge restarts, the reconciler re-reads the host registry
snapshot and restores the desired runtimes that were running. Do not persist
process identity across a bridge restart as authority; re-derive desired state
from registry state and reconcile.

### 5.8 Close runtime-owned sessions on stop

Stopping a runtime closes the sessions it owns (terminal sessions, harness
sessions, event streams) before reporting stopped. Preserve the existing XH4/XH5
session-cleanup invariants.

### 5.9 Non-secret lifecycle events

Emit lifecycle events (start requested, ready, degraded, failed, stopped,
unexpected-exit) carrying public identifiers and public failure codes only. No
PID, path, argv, environment, token, credential, prompt, or memory content.

### 5.10 Fix the CP-BR3 grant-completeness gap

Before the reconciler trusts a `running` decision, close the CP-BR3 gap: the
resolver currently treats any non-empty `grantedCapabilities` set as authorized
and does not verify that **all** of the manifest's `requestedCapabilities` are
granted. Choose one of:

- extend `deriveDesiredRuntimeState` to accept the manifest's required
  capabilities (or a `requiredCapabilities` list) and require
  `required.every(cap => granted.has(cap))`; or
- perform the required∩granted check in the host projection that feeds the
  resolver.

Either way, an add-on granted only a subset of its required capabilities must
resolve `stopped` / `addon-authorization-required`, never `running`. Add tests
for the partial-grant case (currently untested).

## 6. Implementation requirements

### 6.1 Package boundary

Place the factory registry and reconciler in `browser-first/host/` (for example
`runtime-factory-registry.mjs` and `runtime-reconciler.mjs`). Do not place
reconcile logic inside:

- `harness-host-service.mjs` (route composition);
- `bridge-server.mjs` (transport/auth);
- `run-bridge-minimal.mjs` (composition root);
- the SDK package (which stays pure and shared);
- React/renderer code.

The reconciler may consume the CP-BR3 resolver (a pure import) and the host
registry projection.

### 6.2 Factory interface

Define a typed runtime-factory contract (id, supported `runtimeType`s, spawn
policy, `start`, `stop`, `health`, `degrade`/`closeSessions`). Factories own
their process policy; the reconciler never reaches into a factory's child
process. Keep the interface injectable for tests (a fake factory is a first-class
fixture).

### 6.3 Seams

Every external boundary must be injectable: the factory registry, the host
registry snapshot, timers/timeouts, and process spawn (inside factories). No
module-global mutable test seam in production paths.

### 6.4 Ownership

Update `MODULE-OWNERSHIP.md` so the new registry and reconciler have named
owners, named boundaries, and stated non-ownership (no provider credentials, no
bridge auth, no arbitrary entrypoint execution).

## 7. Non-negotiable security rules

1. No arbitrary `manifest.service.entrypoint` shell execution; only reviewed
   factory functions with pinned spawn policy.
2. No caller-supplied executable, command, argv, shell string, path, cwd,
   endpoint, or environment.
3. `reconcile` is idempotent; no duplicate processes, no spurious transitions.
4. Generation fencing: stale completion/exit/stop never overwrites newer state.
5. Bounded waits; no restart loop.
6. Non-secret lifecycle events and snapshots (public identifiers + failure codes
   only).
7. Close runtime-owned sessions on stop.
8. Registry authority is the source of truth; a stale or forged UI state cannot
   start/stop a runtime.
9. Classification is not lifecycle authority.
10. Partial grants fail closed (see §5.10); never start an under-granted runtime.
11. Preserve bridge authentication, capability minting, CP-BR1/CP-BR2 bootstrap,
    and XH4/XH5 session-cleanup invariants.
12. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests with injected fake factories and bounded timers. At
minimum prove:

1. a fixture runtime starts once and a second reconcile is a no-op;
2. `stopped` desired state stops the runtime and closes its sessions;
3. two concurrent reconciles for one add-on produce exactly one start;
4. a stale start/health/exit from an older generation cannot become active;
5. generation replacement stops the previous runtime deterministically;
6. start/stop/health timeouts are bounded;
7. an unknown/unregistered factory id fails closed;
8. `manifest.service.entrypoint` is never executed (hostile entrypoint fixture);
9. a caller-supplied command/argv/path/env is rejected or impossible by shape;
10. a partial grant (subset of required capabilities) resolves
    `addon-authorization-required`, not `running` (the CP-BR3 fix);
11. desired runtimes are restored after a simulated bridge restart;
12. non-secret lifecycle events carry no PID/path/argv/env/token/credential
    (shape-walker);
13. a stale or forged UI/registry snapshot cannot start a runtime;
14. terminal-host / external-CLI / pi fixtures still pass unchanged (no
    regression).

Reuse the CP-BR3 fixtures and shape-walker helpers where present.

## 9. Documentation

Add or update:

- runtime factory registration guide (what a reviewed factory must pin);
- lifecycle manager ownership contract (registry vs reconciler vs factories);
- failure/recovery semantics (timeouts, unexpected exit, restore-after-restart);
- explicit statement that projection is CP-BR5 and the UI is CP-BR6;
- the CP-BR3 grant-completeness correction and its tests.

Update the CP-BR4 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep
`MODULE-OWNERSHIP.md`, the Alpha boundary, ADR-047, and the architecture index
consistent.

## 10. Verification

Run targeted CP-BR4 tests first, then the documented regression set. Always use
Node 26.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test \
  browser-first/test/bootstrap-protocol.test.mjs \
  browser-first/test/bootstrap-framing.test.mjs \
  browser-first/test/bootstrap-lifecycle.test.mjs \
  browser-first/test/bootstrap-host-main.test.mjs \
  browser-first/test/bootstrap-installer.test.mjs \
  browser-first/test/bootstrap-client.test.mjs \
  browser-first/test/bootstrap-startup.test.mjs \
  browser-first/test/rebind-coordinator.test.mjs \
  browser-first/test/bootstrap-manifest-and-launch-route-absent.test.mjs \
  browser-first/test/bridge-bootstrap-probe.test.mjs \
  browser-first/test/bridge-launcher.test.mjs \
  browser-first/test/bridge-launch-route.test.mjs \
  browser-first/test/bridge-target-section-launch.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  <new CP-BR4 registry/reconciler test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs
npm run docs:check
git diff --check
```

Replace `<new CP-BR4 registry/reconciler test files>` with exact paths; do not
leave a placeholder in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` had a **53-finding pre-existing baseline** through CP-BR0…CP-BR3.
Report the exact new count and diff. Do not fix unrelated documentation backlog.
Any finding for new CP-BR4 files is attributable and must be resolved through a
canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Preserve all user/AVIS and CP-BR0…CP-BR3 work.
- Do not push.
- Do not rewrite history.
- Do not merge or rebase.
- Do not commit unrelated files.
- If the accumulated uncommitted work makes safe isolated commits ambiguous,
  leave changes uncommitted and report that explicitly rather than capturing
  someone else's work.
- Keep implementation focused on CP-BR4.
- Do not add dependencies; the reconciler uses the existing host modules and
  Node built-ins.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence only if the worktree permits isolated commits safely:

1. `feat(bridge): add reviewed runtime factory registry`
2. `feat(bridge): add idempotent generation-fenced reconciler`
3. `fix(sdk): require full grant coverage before runtime start`
4. `test(bridge): cover reconcile idempotency, fencing, and cleanup`
5. `docs(bridge): document factory registration and lifecycle ownership`

## 12. CP-BR4 gate

CP-BR4 is green only when all are true:

- a fixture runtime starts once, remains idempotent, stops once, and restores
  after a bridge restart;
- a failed/stale start cannot become active after a newer generation;
- revoke/remove produces deterministic cleanup (sessions closed);
- no arbitrary `manifest.service.entrypoint` or caller-supplied process input is
  ever executed;
- partial grants fail closed (the CP-BR3 fix is in and tested);
- start/stop/health waits are bounded with no restart loop;
- lifecycle events are non-secret;
- registry authority is preserved against stale/forged UI state;
- existing bridge/bootstrap/terminal-host tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** factory registry shape, factory interface,
   reconciler flow, generation fencing, and restore-after-restart.
3. **Files and commits:** exact files changed and commit hashes, or state why no
   commits were safe.
4. **Idempotency/fencing evidence:** duplicate reconcile, concurrent reconcile,
   stale-generation rejection, generation-replacement cleanup.
5. **Grant-completeness evidence:** the partial-grant fix and its tests.
6. **Non-leak evidence:** lifecycle-event shape-walker.
7. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
8. **Docs check:** exact issue count, baseline delta from 53, and attributable
   findings.
9. **Remaining risks/blockers:** especially anything deferred to CP-BR5 (projection),
   CP-BR6 (UI), or CP-BR7 (terminal add-on migration).
10. Explicit `STOP — CP-BR4`.

The session is complete only when CP-BR4 is green or honestly blocked and the
agent has stopped before CP-BR5.
