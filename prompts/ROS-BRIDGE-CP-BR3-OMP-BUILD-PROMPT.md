# OMP BUILD — Generic SDK Runtime Lifecycle Contract — CP-BR3

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR3 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Add the **pure, generic add-on runtime lifecycle contract**: public lifecycle
status types and a `deriveDesiredRuntimeState()` resolver that decides whether an
add-on's runtime should be running, independent of terminal identity or add-on
category. No process is spawned and no I/O occurs in this phase — CP-BR3 is a
contract + resolver + fixtures + tests, not a lifecycle manager.

This session covers **CP-BR3 only**:

1. add the public runtime lifecycle status types and snapshot shape;
2. add the pure `deriveDesiredRuntimeState()` resolver implementing the
   desired-state rule;
3. add fixture add-ons for local-service, agent-addon, UI-only, and connector;
4. prove the resolver matrix (install/enable/grant/compatibility/revocation)
   and category-independence with deterministic tests;
5. document the lifecycle contract, the author guide, and the status vocabulary;
6. `STOP AND REPORT` before the runtime factory registry and reconciler.

Do **not** implement CP-BR4. In particular, do not build the reviewed runtime
factory registry, do not write `reconcile(snapshot)`, do not spawn or stop any
process, and do not close sessions. Do not build the projection UI (CP-BR5/6) and
do not wire terminal add-ons onto this lifecycle (CP-BR7).

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

No commits were made during CP-BR0, CP-BR1, or CP-BR2; all work remains
uncommitted in the working tree. The branch is still ahead of origin. Nothing
should be pushed.

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

## 2. Preserve the CP-BR0 + CP-BR1 + CP-BR2 worktree

Three phases of work are already uncommitted. Inspect `git status` first and
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
?? docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
?? docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md
?? docs/architecture/BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md
?? docs/architecture/BRIDGE-BOOTSTRAP-PROTOCOL.md
?? docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md
?? prompts/ROS-BRIDGE-CP-BR1-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-CP-BR2-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-SDK-RUNTIME-NEW-CHAT-HANDOFF.md
```

The CP-BR1/CP-BR2 packages, tests, and docs are authoritative. Read them; do not
rebuild them.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use
surgical edits. If formatting noise appears, restore only your own edit and
reapply it with an exact-string throwaway script, then delete the script.

Do not push, open a PR, merge, rebase, or merge `feature/pi-testing-phase`.

## 3. Source of truth — read in order

1. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
2. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially §4 (public lifecycle model) and CP-BR3;
3. `docs/architecture/ADR-046-addon-classification-category-discovery.md`
4. `docs/architecture/ADR-018-addon-sdk-v0.md`
5. `docs/architecture/ADR-006-addon-runtime-sdk.md`
6. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
7. `docs/architecture/MODULE-OWNERSHIP.md`
8. `docs/architecture/README.md`
9. SDK package (canonical contracts + validation):
   - `packages/addon-sdk/src/contracts.ts`
   - `packages/addon-sdk/src/validation.ts`
   - `packages/addon-sdk/src/registry.ts`
   - `packages/addon-sdk/src/index.ts`
10. `src/sdk/addons/` compatibility exports (if present)
11. Host-owned registry projection (read only; do not change lifecycle):
    - `browser-first/host/harness-registry.mjs`
    - `browser-first/host/harness-registry-store.mjs`
12. CP-BR1 bootstrap package (context only):
    - `browser-first/bootstrap/bridge-policy.mjs`
    - `browser-first/bootstrap/bootstrap-protocol.mjs`

## 4. Contracts you must consume (do not rebuild)

### 4.1 Public add-on runtime status (roadmap §4.2)

```ts
type AddOnRuntimeLifecycleStatus =
  "inactive" | "starting" | "ready" | "degraded" | "failed" | "stopping";

interface AddOnRuntimeLifecycleSnapshot {
  addonId: string;
  runtimeId: string;
  status: AddOnRuntimeLifecycleStatus;
  generation: number;
  activeSessionCount: number;
  startedAt?: string;
  lastTransitionAt?: string;
  publicFailureCode?: string;
}
```

The projection carries public identifiers only. No capability token, credential,
provider secret, filesystem path, child argv, PID, or raw error.

### 4.2 Desired-state rule (roadmap §4.3)

```text
desiredRunning =
  installed
  AND enabled
  AND required capabilities granted
  AND compatible
  AND reviewed runtime factory exists
  AND no hard-stop revocation fence is active
```

UI state never starts a service directly. The host-owned registry projection is
the source of truth.

### 4.3 Runtime type and classification (ADR-018 / ADR-046)

Runtime type (`runtimeType`) is one of:

```text
ui-module | embedded-module | local-service | agent-addon | channel-addon
```

Classification (`classification.category`) describes *what* an add-on is. It
grants no authority, selects no executable, and does **not** change lifecycle
authority. Category must never branch `deriveDesiredRuntimeState()`.

### 4.4 User-facing state mapping (roadmap §4.4)

Keep this mapping as the contract; CP-BR3 defines the inputs that produce it, not
the UI:

```text
no installation            -> Not installed
installed, disabled        -> Disabled
enabled, grant missing     -> Authorization required
desired running, starting  -> Starting
runtime ready              -> Connected / Ready
runtime degraded           -> Degraded
start or health failure    -> Failed
stop in progress           -> Stopping
authorized but inactive    -> Disconnected
```

## 5. Required CP-BR3 behavior

### 5.1 Public lifecycle types

Add the public runtime lifecycle status type, snapshot shape, and any supporting
public types (public failure codes, desired-state enum) to the SDK package's
canonical contracts. Use the exact vocabulary above; do not invent new states.

### 5.2 `deriveDesiredRuntimeState()`

Implement a **pure** resolver. Its inputs are a validated manifest and a
host-owned registry/authority projection. Its output is a public desired-state
decision (for example `running | stopped | degraded` plus a public reason or
failure code). It must:

- be side-effect free (no process, no filesystem, no network, no timers, no
  mutation of its inputs);
- fail closed on every missing authority: not installed, not enabled, missing
  required grant, incompatible, missing reviewed factory, active revocation
  fence;
- treat "reviewed runtime factory exists" as an input flag/list supplied by the
  host, **not** something CP-BR3 resolves (the factory registry is CP-BR4);
- never consult `classification.category` to change the outcome;
- never emit secrets or private paths.

Design the exact input/output types, but keep them aligned with the roadmap
vocabulary and the SDK `runtimeType` enum. Unknown runtime type or unknown
authority input must fail closed.

### 5.3 Revocation mapping

Map revocation policy to a closed outcome:

- hard-stop revocation fence → not running (fail closed);
- degrade → `degraded`/stopped per the documented policy;
- no revocation → normal desired-state evaluation.

Do not invent a process action here; CP-BR3 maps revocation to a desired state
and a public reason, and CP-BR4 will translate that into stop/degrade behavior.

### 5.4 Fixture add-ons

Add deterministic fixtures for the four families:

- `local-service` (runtimeType `local-service`);
- `agent-addon` (runtimeType `agent-addon`);
- UI-only (runtimeType `ui-module`);
- a connector-classified add-on (classification.category `connector`, with a
  concrete runtimeType).

Fixtures are validated manifests plus a host-projection fixture. They must be
minimal and carry no secrets.

### 5.5 Category independence

The resolver must produce identical lifecycle decisions for two add-ons that
differ only in `classification.category`. This is a gate, not an implementation
detail — test it explicitly.

## 6. Implementation requirements

### 6.1 Package boundary

Place the public lifecycle types and the pure resolver in the SDK package
(`packages/addon-sdk/src/`), exported from `index.ts`, and mirrored through
`src/sdk/addons/` compatibility exports if that is the established pattern.

Do **not** place the resolver inside:

- the bridge (`harness-host-service.mjs`, `bridge-server.mjs`);
- a process or spawn path;
- React/renderer code;
- an add-on manifest.

The resolver must be importable by both Node (bridge/tests) and browser (SDK
consumers) without pulling in Node-only or Chrome-only modules.

### 6.2 Pure resolver

No `node:child_process`, no `fs`, no `fetch`, no `setTimeout`, no `Date.now()`
for decision-making (timestamps may appear only in projected snapshots, never as
decision inputs). Freeze input types where the project convention does so.

### 6.3 Registry projection input

The resolver consumes an already-projected, validated authority snapshot
(installed/enabled/granted/compatibility/factory-available/revocation). CP-BR3
defines the projection shape; CP-BR4 will supply the live projection from the
host registry. Do not read `harness-registry.mjs` state directly from the
resolver; accept a plain projection object.

### 6.4 Public projection

The snapshot and desired-state result expose public identifiers and public
failure codes only. Provide a shape-walker-safe construction path (no token-,
credential-, path-, PID-, or env-shaped fields can enter).

## 7. Non-negotiable security rules

1. Resolver is pure; no process, I/O, network, or timers.
2. Missing install/enable/grant/compatibility/factory/revocation-clearance all
   fail closed.
3. Classification is not authority; category never changes the outcome.
4. No manifest `service.entrypoint` or arbitrary shell execution is consulted or
   authorized by CP-BR3 (the factory registry is CP-BR4).
5. Public projection carries public identifiers only; no tokens, credentials,
   paths, argv, PID, raw errors, or prompt/memory content.
6. UI state never starts a service; the host projection is the source of truth.
7. Preserve existing bridge authentication, capability minting, and CP-BR1/CP-BR2
   bootstrap behavior; do not touch them.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic, pure-unit tests. At minimum prove the resolver matrix:

1. installed + enabled + granted + compatible + factory + no revocation →
   running;
2. not installed → stopped/Not installed;
3. installed, disabled → stopped/Disabled;
4. enabled but missing a required grant → stopped (Authorization required);
5. incompatible → stopped;
6. missing reviewed factory → stopped;
7. hard-stop revocation fence → stopped;
8. degrade revocation → degraded/stopped per policy;
9. two add-ons differing only in `classification.category` → identical result
   (category independence);
10. UI-only (`ui-module`) never produces a runtime-process desired state;
11. unknown `runtimeType` fails closed;
12. unknown/forged authority input fails closed;
13. resolver performs no I/O — assert with a seam that no `fs`/`spawn`/`fetch`/
    timer is reachable, or by running in a sandbox that would throw on I/O;
14. shape-walker finds no token/credential/path/PID/env value in any public
    result;
15. fixture manifests validate under the SDK validator.

Reuse existing SDK validation and shape-walker helpers where present.

## 9. Documentation

Add or update:

- SDK runtime lifecycle contract (types, resolver, desired-state rule, fail-closed
  matrix);
- add-on author guide: when a runtime is required (local-service / agent-addon
  vs UI-only) and that classification is not lifecycle authority;
- runtime status vocabulary and the user-facing state mapping;
- explicit statement that the factory registry and `reconcile()` are CP-BR4.

Update the CP-BR3 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep ADR-046,
ADR-018, the architecture index, and module ownership consistent.

## 10. Verification

Run targeted CP-BR3 tests first, then the documented regression set. Always use
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
  <new CP-BR3 resolver/contract test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs
npm run docs:check
git diff --check
```

Replace `<new CP-BR3 resolver/contract test files>` with exact paths; do not
leave a placeholder in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` had a **53-finding pre-existing baseline** through CP-BR0/CP-BR1/
CP-BR2. Report the exact new count and diff. Do not fix unrelated documentation
backlog. Any finding for new CP-BR3 files is attributable and must be resolved
through a canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Preserve all user/AVIS and CP-BR0/CP-BR1/CP-BR2 work.
- Do not push.
- Do not rewrite history.
- Do not merge or rebase.
- Do not commit unrelated files.
- If the accumulated uncommitted work makes safe isolated commits ambiguous,
  leave changes uncommitted and report that explicitly rather than capturing
  someone else's work.
- Keep implementation focused on CP-BR3.
- Do not add dependencies; the resolver and types use the existing SDK package
  and Node/TS built-ins.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence only if the worktree permits isolated commits safely:

1. `feat(sdk): add generic runtime lifecycle contract + resolver`
2. `test(sdk): cover resolver matrix and category independence`
3. `docs(sdk): document runtime lifecycle contract and author guide`

## 12. CP-BR3 gate

CP-BR3 is green only when all are true:

- public lifecycle status types and snapshot shape are added and exported;
- `deriveDesiredRuntimeState()` implements the full desired-state rule as a pure
  function;
- the resolver matrix covers install/enable/grant/compatibility/revocation;
- no process or I/O occurs in resolver tests;
- UI-only add-ons never request a runtime process;
- category changes do not change lifecycle authority;
- missing grant/compatibility/factory and revocation fences fail closed;
- public projection carries public identifiers only (shape-walker clean);
- fixture add-ons for local-service, agent-addon, UI-only, and connector are
  present and validate;
- existing bridge/bootstrap/terminal-host tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** package paths, resolver signature, input
   projection shape, and public types.
3. **Files and commits:** exact files changed and commit hashes, or state why no
   commits were safe.
4. **Resolver matrix evidence:** the install/enable/grant/compatibility/
   revocation outcomes.
5. **Category-independence evidence:** identical decisions across categories.
6. **Purity evidence:** how the "no I/O" gate is enforced and tested.
7. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
8. **Non-leak evidence:** shape-walker coverage of the public projection.
9. **Docs check:** exact issue count, baseline delta from 53, and attributable
   findings.
10. **Remaining risks/blockers:** especially anything deferred to CP-BR4 (factory
    registry, reconciler, actual process start/stop).
11. Explicit `STOP — CP-BR3`.

The session is complete only when CP-BR3 is green or honestly blocked and the
agent has stopped before CP-BR4.
