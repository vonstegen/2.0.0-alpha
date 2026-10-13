# OMP BUILD — Terminal Add-ons On Generic Lifecycle — CP-BR7

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR7 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Make Ghostty and iTerm2 the first production proof of the generic lifecycle
manager: register reviewed runtime factories that wrap the existing
`createTerminalHostService`, wire the CP-BR4 reconciler into the production
composition root, and let enable/grant/disable/revoke/remove drive start/stop
through the generic lifecycle — without rebuilding the terminal adapters.

This session covers **CP-BR7 only**:

1. replace the CP-BR4 no-op seed factories with reviewed Ghostty and iTerm2
   runtime factories wrapping `createTerminalHostService`;
2. wire the reconciler (and factory registry) into `run-bridge-minimal.mjs`;
3. make enable + grant start the selected adapter and disable/revoke/remove stop
   it, closing ROS-owned sessions;
4. make switching terminals stop the old adapter before activating the new one;
5. source connection badges from the generic runtime projection;
6. gate `Open in Terminal` on the runtime being `ready`;
7. preserve the existing Pi grant/resource projection, no-confirm Ghostty
   teardown, and zero leaked windows;
8. `STOP AND REPORT` before end-to-end acceptance.

Do **not** implement CP-BR8. In particular, do not build the operator acceptance
runbook or the real-Ghostty/iTerm2 smoke proofs, and do not change the Pi
grant/resource projection semantics.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

CP-BR0…CP-BR6 and security hardening are committed; `HEAD` is:

```text
18ae4ffb docs(bridge): add CP-BR6 OMP build prompt
```

Start by confirming `git status` is clean. Nothing should be pushed.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node 24+ is required; Homebrew Node 26 is the known-working version. Under nvm
Node 22.13 the `bridge-auth-inprocess-self-test.test.mjs` test fails with
`ERR_UNKNOWN_FILE_EXTENSION`; always verify with Node 26.

## 2. Worktree state — commit this phase

The tree is clean and prior work is committed. Make small checkpoint commits for
CP-BR7. Do not push. Do not rebase or merge.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use surgical
edits. If formatting noise appears, restore only your own edit and reapply it with
an exact-string throwaway script, then delete the script.

## 3. Source of truth — read in order

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially CP-BR4, CP-BR5, CP-BR6, and CP-BR7;
2. `docs/architecture/RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md`
3. `docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`
4. `docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`
5. `docs/architecture/ADR-040-terminal-host-adapter-contract.md`
6. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
7. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
8. `docs/architecture/MODULE-OWNERSHIP.md`
9. CP-BR4 reconciler + factory registry (the act side you are wiring):
   - `browser-first/host/runtime-factory-registry.mjs`
   - `browser-first/host/runtime-reconciler.mjs`
   - `browser-first/host/runtime-lifecycle-host.mjs`
10. CP-BR3 resolver (the decide side):
    - `packages/addon-sdk/src/runtime-lifecycle.ts`
11. Existing terminal host (what you wrap; do NOT rebuild):
    - `browser-first/host/terminal-host-service.mjs`
    - `browser-first/host/terminal-host-bridge-wiring.mjs`
    - `browser-first/host/agent-adapters/external-cli-terminal.mjs`
12. Composition root (where the reconciler is wired):
    - `browser-first/host/run-bridge-minimal.mjs`
13. CP-BR5 projection + CP-BR6 surface (the badge source):
    - `browser-first/host/runtime-projection-service.mjs`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`
14. Terminal UI affordance (the Open-in-Terminal gate):
    - `src/modules/terminal/OpenInTerminalButton.tsx`

## 4. Contracts you must consume (do not rebuild)

### 4.1 RuntimeFactory interface (CP-BR4)

```text
spawnPolicy, start, stop, health, degrade, closeSessions
```

A factory owns its process policy. The reconciler never reaches into a factory's
child process. The registry currently seeds three **no-op-shaped** factories
(`terminal-host-service`, `external-cli-terminal`, `pi-runtime`) — replace the
terminal-host seed with real Ghostty/iTerm2 factories.

### 4.2 Desired-state rule (CP-BR3)

```text
installed AND enabled AND required capabilities granted
AND compatible AND reviewed factory exists AND no hard-stop revocation fence
```

Enable + grant, and disable/revoke/remove, change this rule's inputs and flow
through `deriveDesiredRuntimeState` → `reconcile` → factory start/stop.

### 4.3 Terminal add-on identity

The two reviewed terminal add-ons are `addon.resonant-terminal-ghostty` and
`addon.resonant-terminal-iterm2`, both `runtimeType` `local-service`, gated by
the `terminal-host` capability with grant presets `ghostty-terminal-host` and
`iterm2-terminal-host`. `RESONANT_TERMINAL_DRIVER` selects the driver
(`ghostty` / `iterm2` / `in-memory`).

## 5. Required CP-BR7 behavior

### 5.1 Register reviewed terminal factories

Add real Ghostty and iTerm2 runtime factories to the registry. Each factory:

- wraps `createTerminalHostService` (do not rebuild the adapters);
- pins its own spawn policy (driver, executable/script, argv, cwd, env
  allowlist) — never a caller-supplied command/argv/env;
- exposes `start`, `stop`, `health`, `degrade`, `closeSessions`;
- `closeSessions` closes ROS-owned terminal sessions before reporting stopped.

Keep `external-cli-terminal` and `pi-runtime` seeds untouched (they are not
CP-BR7).

### 5.2 Wire the reconciler into production composition

Wire the CP-BR4 factory registry + reconciler into `run-bridge-minimal.mjs` so
the lifecycle actually runs in production (the reconciler is currently an
unwired seam). The reconciler consumes the host registry projection and the
CP-BR3 resolver decisions; the projection service (CP-BR5) then reflects live
`listActive()` state.

### 5.3 Enable + grant → start; disable/revoke/remove → stop

- Installing + enabling + granting the `terminal-host` capability for Ghostty or
  iTerm2 transitions the selected adapter `Authorization required → Starting →
  Connected` through the generic lifecycle.
- Disabling, revoking the grant, or removing the add-on stops the adapter and
  transitions it to `Disabled`/`Disconnected`/`Inactive`.

### 5.4 Switching terminals is deterministic

Switching the active terminal (e.g. Ghostty → iTerm2) must stop the old adapter
before activating the new one, with no duplicate ownership or two active
adapters.

### 5.5 Connection badges from the generic projection

The terminal connection badges must derive from the generic runtime projection
(CP-BR5), not from a separate terminal-only status path. Keep the existing
`GET /terminal-host/status` route where it is still consumed, but the badge
source-of-truth becomes the projection.

### 5.6 Open in Terminal gated on ready

`Open in Terminal` is enabled only when the selected terminal runtime is `ready`
in the projection. Preserve the existing XH5 launch/authorization auto-retry
shape.

### 5.7 Preserve Pi projection and cleanup invariants

- The existing Pi grant/resource projection is unchanged.
- Preserve no-confirm Ghostty teardown and the zero-leaked-windows invariant
  (existing XH4/XH5 cleanup tests stay green).

## 6. Implementation requirements

### 6.1 Package boundary

Put the terminal factories in `browser-first/host/` (e.g.
`terminal-runtime-factories.mjs`) and wire them into the registry/reconciler in
the composition root. Do not:

- place reconciler wiring in `bridge-server.mjs` (auth/transport);
- rebuild `createTerminalHostService` or the Ghostty/iTerm2 adapters;
- add domain behavior to `run-bridge-minimal.mjs` beyond composition;
- let the factory execute a caller-supplied command/argv/env.

### 6.2 Seams

Factories and the reconciler must be testable with an injected fake terminal
host service (no real process in unit tests). Keep the existing
`installTerminalHostBridge` `serviceFactory` seam where it already exists.

### 6.3 Ownership

Update `MODULE-OWNERSHIP.md` so the terminal factories, the reconciler wiring,
and the badge source have named owners and boundaries.

## 7. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, path, cwd,
   endpoint, or environment.
2. Factories own their spawn policy (pinned driver/entry/argv/env allowlist).
3. No `process.env` spread into a spawned adapter.
4. `closeSessions` closes ROS-owned sessions; no orphaned or leaked windows.
5. Lifecycle events and projection stay non-secret (no PID/path/argv/env/token).
6. Classification is not lifecycle authority.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR6
   behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests with injected fake terminal factories/hosts. At minimum
prove:

1. Ghostty factory wraps `createTerminalHostService` and does not rebuild the
   adapter;
2. enable + grant transitions Ghostty `Authorization required → Starting →
   Connected`;
3. disable stops Ghostty and closes its ROS-owned sessions;
4. revoke/remove stops the adapter;
5. switching Ghostty → iTerm2 stops the old adapter before starting the new one
   (no duplicate ownership);
6. connection badges derive from the generic runtime projection;
7. `Open in Terminal` is gated on `ready`;
8. the factory never executes a caller-supplied command/argv/env;
9. `closeSessions` preserves no-confirm teardown and zero leaked windows;
10. the reconciler is wired into the composition root (a boot fixture produces
    a live lifecycle);
11. existing terminal-host, Pi grant/resource, and XH4/XH5 tests remain green;
12. existing CP-BR1…CP-BR6 tests remain green.

## 9. Documentation

Add or update:

- terminal add-on activation guide (enable → grant → starting → connected);
- terminal switching and cleanup semantics;
- Ghostty/iTerm2 platform prerequisites.

Update the CP-BR7 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep
`MODULE-OWNERSHIP.md`, the Alpha boundary, and ADR-047 consistent.

## 10. Verification

Run targeted CP-BR7 tests first, then the documented regression set. Always use
Node 26.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test --test-force-exit \
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
  browser-first/test/bridge-target-section.test.mjs \
  browser-first/test/bridge-runtimes-section.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  browser-first/test/runtime-reconciler.test.mjs \
  browser-first/test/runtime-projection.test.mjs \
  browser-first/test/runtime-projection-staleness.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  <new CP-BR7 terminal-factory/lifecycle test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR7 terminal-factory/lifecycle test files>` with exact paths; do
not leave a placeholder in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` baseline at CP-BR6 was **59** (53 pre-existing reachability + 6
program prompt files). Report the exact new count and diff. Do not fix unrelated
documentation backlog. Any finding for new CP-BR7 files is attributable and must
be resolved through a canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR7 work in small checkpoint commits.
- Do not push.
- Do not rewrite history, merge, or rebase.
- Do not commit unrelated files.
- Do not add dependencies; wrap existing terminal-host modules and use Node
  built-ins.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence:

1. `feat(bridge): register reviewed Ghostty and iTerm2 runtime factories`
2. `feat(bridge): wire reconciler into the production composition root`
3. `feat(ui): source terminal badges from the generic runtime projection`
4. `test(bridge): cover terminal activation, switching, and cleanup`
5. `docs(bridge): document terminal activation and switching`

## 12. CP-BR7 gate

CP-BR7 is green only when all are true:

- a user can activate Ghostty entirely through the ROS add-on UI;
- Ghostty transitions `Authorization required → Starting → Connected`;
- switching to iTerm2 transitions deterministically without duplicate ownership;
- disable closes sessions and changes status to `Disabled`/`Disconnected`;
- connection badges derive from the generic runtime projection;
- `Open in Terminal` is enabled only when the runtime is `ready`;
- the existing Pi grant/resource projection and no-confirm teardown/zero-leak
  invariants are preserved;
- existing CP-BR1…CP-BR6 and terminal-host tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** factory registry entries, reconciler wiring,
   badge source, and Open-in-Terminal gate.
3. **Files and commits:** exact files changed and commit hashes.
4. **Lifecycle evidence:** enable/grant → start, disable/revoke/remove → stop,
   switching stops-old-first.
5. **Non-leak evidence:** no-confirm teardown and zero leaked windows.
6. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
7. **Docs check:** exact issue count, baseline delta from 59, and attributable
   findings.
8. **Remaining risks/blockers:** especially anything deferred to CP-BR8
   (end-to-end acceptance / real Ghostty smoke).
9. Explicit `STOP — CP-BR7`.

The session is complete only when CP-BR7 is green or honestly blocked and the
agent has stopped before CP-BR8.
