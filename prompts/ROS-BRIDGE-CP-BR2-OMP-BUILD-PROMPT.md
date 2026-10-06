# OMP BUILD — ROS Bridge Owned By ROS Startup — CP-BR2

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR2 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Make the core bridge start and stop with ROS: the extension queries the
independent bootstrap host on startup, starts the bridge when it is offline,
binds once it is healthy, reuses an already-running bridge, surfaces failures,
and stops only an owned bridge on shutdown.

CP-BR1 delivered the independent native-messaging bootstrap host under
`browser-first/bootstrap/`. This session wires the **extension** to it.

This session covers **CP-BR2 only**:

1. add the extension-side native-messaging client and `nativeMessaging`
   permission;
2. implement the startup sequence (`status` → offline `start` → health → bind)
   with idempotency and bounded backoff;
3. implement post-start credential adoption and rebind after the generated
   bridge config changes;
4. implement version-mismatch, unexpected-exit, and graceful shutdown behavior;
5. add deterministic tests and the ROS startup / shutdown / recovery docs;
6. `STOP AND REPORT` before the generic add-on runtime lifecycle manager.

Do **not** implement CP-BR3/CP-BR4. In particular, do not build the generic SDK
runtime lifecycle manager, do not add a runtime factory registry, and do not
wire terminal add-on enable/disable to lifecycle. Do not change CP-BR1 bootstrap
process policy (spawn/env/generation) except to fix a defect the tests prove.

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

No commits were made during CP-BR0 or CP-BR1; all work remains uncommitted in
the working tree. The branch is still ahead of origin. Nothing should be
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

## 2. Preserve the CP-BR0 + CP-BR1 worktree

Two phases of work are already uncommitted. Inspect `git status` first and
preserve everything. Do not reset, discard, overwrite, or broadly reformat
existing work. Before editing any modified file, inspect its working-tree diff.

Expected modified/untracked work includes (exact status may differ):

```text
 M browser-first/host/bridge-bootstrap.mjs
 M browser-first/host/bridge-launcher.mjs
 M browser-first/host/harness-host-service.mjs
 M browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js
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
?? browser-first/test/bootstrap-framing.test.mjs
?? browser-first/test/bootstrap-host-main.test.mjs
?? browser-first/test/bootstrap-installer.test.mjs
?? browser-first/test/bootstrap-lifecycle.test.mjs
?? browser-first/test/bootstrap-protocol.test.mjs
?? browser-first/test/bridge-bootstrap-probe.test.mjs
?? docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
?? docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md
?? docs/architecture/BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md
?? docs/architecture/BRIDGE-BOOTSTRAP-PROTOCOL.md
?? prompts/ROS-BRIDGE-CP-BR1-OMP-BUILD-PROMPT.md
?? prompts/ROS-BRIDGE-SDK-RUNTIME-NEW-CHAT-HANDOFF.md
```

The CP-BR1 package, tests, and docs are authoritative. Read them; do not rebuild
them.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use
surgical edits. If formatting noise appears, restore only your own edit and
reapply it with an exact-string throwaway script, then delete the script.

Do not push, open a PR, merge, rebase, or merge `feature/pi-testing-phase`.

## 3. Source of truth — read in order

1. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
2. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially CP-BR0, CP-BR1, and CP-BR2;
3. `docs/architecture/BRIDGE-BOOTSTRAP-PROTOCOL.md`
4. `docs/architecture/BRIDGE-BOOTSTRAP-MACOS-RUNBOOK.md`
5. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
6. `docs/architecture/MODULE-OWNERSHIP.md`
7. `docs/architecture/README.md`
8. `prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md`
   - historical and marked **SUPERSEDED — DO NOT IMPLEMENT**;
9. `prompts/ROS-BRIDGE-CP-BR1-OMP-BUILD-PROMPT.md`
   - the CP-BR1 contract you must consume;
10. CP-BR1 bootstrap package (implementation, not precedent):
    - `browser-first/bootstrap/bridge-policy.mjs`
    - `browser-first/bootstrap/bootstrap-protocol.mjs`
    - `browser-first/bootstrap/bootstrap-lifecycle.mjs`
    - `browser-first/bootstrap/native-framing.mjs`
    - `browser-first/bootstrap/native-host-main.mjs`
    - `browser-first/bootstrap/install-macos.mjs`
    - `browser-first/bootstrap/uninstall-macos.mjs`
11. `browser-first/host/bridge-bootstrap.mjs`
12. `browser-first/host/run-bridge-minimal.mjs`
13. `browser-first/host/bridge-server.mjs`
14. Extension manifest and existing rebind owners:
    - `browser-first/resonantos-side-panel-extension/manifest.json`
    - `browser-first/resonantos-side-panel-extension/src/background.js`
    - `browser-first/resonantos-side-panel-extension/src/side-panel.js`
    - `browser-first/resonantos-side-panel-extension/src/main-workspace.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
15. Native-messaging precedent (structure only):
    - `apps/augmentor/extension/manifest.json`
    - `apps/augmentor/extension/port.mjs`

## 4. CP-BR1 contracts you must consume (do not rebuild)

CP-BR1 froze these facts. Reference them; do not redefine them.

| Fact | Value |
| --- | --- |
| Bootstrap package | `browser-first/bootstrap/` |
| Protocol envelope | `resonantos/bootstrap/v1` |
| Operations | `status`, `start`, `restart`, `stopForShutdown` |
| Status vocabulary | `offline \| starting \| connected \| degraded \| restarting \| failed` |
| Failure codes | `invalid-request`, `start-failed`, `health-timeout`, `restart-failed`, `stop-failed`, `version-mismatch`, `unexpected-exit`, `internal-error` |
| Native host name | `com.resonantos.bridge_bootstrap` |
| Pinned extension origin | `chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/` |
| Authoritative endpoint | `http://127.0.0.1:47773` |
| Bridge entry | `browser-first/host/run-bridge-minimal.mjs` (pinned by the host) |

The native host owns every process input: pinned Node executable, pinned entry,
fixed argv, pinned working directory, pinned endpoint, and the child env
allowlist. The extension **never** supplies a command, argv, endpoint, path, cwd,
environment, or token to the host. Extension messages are only
`{ protocol, requestId, operation }`.

The native host returns only the public projection (status, public version,
endpoint, generation/instance id, startedAt, public failure code,
alreadyRunning). It never returns PID, private paths, argv, environment, tokens,
or credentials.

## 5. Required CP-BR2 behavior

### 5.1 Startup sequence

On extension service-worker boot, perform exactly this sequence, bounded at
every step:

```text
query status
  -> offline/starting  : call start, poll status until connected or bounded timeout
  -> connected         : reuse; do not start again
  -> version-mismatch  : surface public incompatibility; do not reuse unsafely
bind bridge clients after healthy + config adoption (see 5.3)
```

Concurrent boots (MV3 worker revival, multiple panels) must converge on one
start without producing duplicate bridge processes. Prefer joining the CP-BR1
lifecycle's in-flight start rather than issuing parallel `start` calls, but do
not assume the host is the only guard — keep extension-side idempotency too.

### 5.2 Reuse

If the host reports `connected`, reuse the existing bridge and skip `start`.
"Restarting ROS" (reloading the extension / relaunching the browser) must not
create a second bridge.

### 5.3 Post-start credential adoption and rebind

The host returns public status only; it never returns the bridge token or
capability-bootstrap token. After a fresh start the bridge rewrites
`browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`.
The extension must then:

1. re-fetch/re-parse the generated config (reuse the existing cache-busting
   extension-resource fetch, do not read it from disk or a private path);
2. rebuild the bridge clients with the new config;
3. re-run the scoped capability-token bootstrap;
4. re-resolve the loopback endpoint (port may match the pinned 47773, but do not
   assume the old endpoint is still correct).

Reuse `bridge-client.js` (`resolveBridgeConfig`, `detectLoopbackBridge`) and the
existing rebind chains in `background.js`, `side-panel.js`, and
`main-workspace.js`. Do not create a second, divergent rebind implementation.
If the existing rebind is only triggered by an authenticated `401`, add the
missing "bridge just became healthy after start" trigger; keep one owner for the
rebind logic.

Never write tokens into `chrome.storage` beyond the existing narrow bridge-target
override, and never surface them in logs or UI.

### 5.4 Version mismatch

If the host (or the bound bridge) reports a version the extension cannot accept,
surface a public incompatibility state and do not reuse the bridge for
privileged operations. Do not crash-loop; hold a bounded, visible failed state.

### 5.5 Shutdown

Provide a graceful shutdown path that calls `stopForShutdown` and stops only a
bridge owned by the ROS bootstrap host. A bridge that was already running before
ROS started (not owned) must be left untouched.

MV3 service workers do not provide a reliable "extension unload" hook. Do not
claim shutdown happens automatically on worker termination. Provide an explicit,
testable stop invocation (for example, a Settings → Bridge & Runtimes action)
and document the ownership rule. If `chrome.runtime.onSuspend` is used, treat it
as best-effort only.

### 5.6 Unexpected exit and bounded recovery

If a bridge that was `connected` exits unexpectedly, the host reports
`unexpected-exit`/`failed`. The extension must:

- surface `Failed` (not hang);
- offer a bounded retry/restart action;
- use bounded backoff (no unbounded restart loop, no recursive auto-restart);
- never auto-start in a tight loop.

### 5.7 Preserve bridge security

Do not weaken bridge-token or capability-token enforcement, loopback binding, or
capability minting. The native host is a lifecycle boundary, not a shortcut past
bridge authentication.

## 6. Implementation requirements

### 6.1 Extension native-messaging permission

Add `"nativeMessaging"` to
`browser-first/resonantos-side-panel-extension/manifest.json` and keep the
permissions minimal. The native-host manifest already pins `allowed_origins` to
the extension origin; do not introduce a wildcard on either side.

### 6.2 Native-messaging client module

Add a narrowly scoped extension client (for example
`browser-first/resonantos-side-panel-extension/src/lib/bootstrap-client.js`)
that wraps `chrome.runtime.connectNative(NATIVE_HOST_NAME)` (or
`sendNativeMessage`) and:

- speaks the `resonantos/bootstrap/v1` envelope;
- generates a request id and matches responses;
- validates responses with the same exact-shape rules as the host (unknown
  fields rejected, status/failure vocabulary enforced, non-leak shape check);
- bounds connection lifetime and response wait;
- treats `chrome.runtime.lastError` and disconnects as closed public failures,
  never raw errors;
- exposes a deterministic seam for tests (inject a fake port/transport); no
  module-global mutable seam in production paths.

`chrome.runtime.connectNative` is only available in the extension context; guard
it so page/React code cannot call it directly.

### 6.3 Startup orchestration module

Add an orchestrator (for example
`browser-first/resonantos-side-panel-extension/src/lib/bootstrap-startup.js`)
that implements the §5.1 sequence with injected seams for the native client,
health polling, config refresh, and rebind. Keep it independent of React
rendering so it can be driven from `background.js` and tested headlessly.

### 6.4 Rebind trigger

Wire the post-start rebind through the existing owners, not a parallel path.
Update `bridge-client.js` and the three entry points only as needed to add the
"healthy after start" trigger. Prefer one shared function.

### 6.5 Deterministic seams

Every external boundary must be injectable for tests:

- native messaging port/transport;
- timers / backoff (fake or short real bounds);
- generated-config fetch;
- `chrome.storage` and `chrome.runtime` shims;
- health poll.

Do not use real Chrome in tests; use jsdom + injected shims consistent with the
existing extension test style.

## 7. Non-negotiable security rules

1. The extension sends only `{ protocol, requestId, operation }` to the host.
2. The extension never supplies a command, argv, path, cwd, endpoint,
   environment, or token to the host.
3. The host remains the sole owner of process policy and child environment.
4. Public bootstrap status never carries tokens, credentials, PID, paths, argv,
   or raw errors; the extension must not log or render such values either.
5. Generated bridge config is read only through the existing extension-resource
   fetch; never read from disk or a private path.
6. Do not write bridge/capability tokens to `chrome.storage` beyond the existing
   narrow bridge-target override.
7. `allowed_origins` stays pinned to the Alpha extension origin; no wildcard.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).
9. Preserve bridge authentication, capability minting, loopback enforcement, and
   all XH4/XH5 terminal non-leak/cleanup invariants.
10. Start/recover with bounded backoff; no unbounded restart loop.

## 8. Test requirements

Add focused deterministic tests (extension context, injected seams). At minimum
prove:

1. startup queries `status` before deciding;
2. offline → `start` → poll health → bind → `Bridge: Connected`;
3. already-connected → no `start` call, existing client reused;
4. two concurrent startup attempts produce exactly one `start`;
5. version mismatch surfaces public incompatibility and does not reuse;
6. post-start rebind re-fetches generated config and rebuilds clients;
7. rebind failure is visible and does not use stale credentials silently;
8. unexpected exit surfaces `Failed` and a single bounded retry, then backoff;
9. backoff is bounded (no unbounded loop under repeated failure);
10. shutdown calls `stopForShutdown` and only stops an owned bridge;
11. shutdown leaves an externally started bridge untouched;
12. native client validates responses with exact-shape rules and rejects unknown
    fields / bad status / bad failure code;
13. native client maps `lastError`/disconnect to closed public failures;
14. hostile request/response shape-walkers find no token/credential/path/env
    value;
15. `nativeMessaging` permission is present in the manifest and the client is
    not reachable from page/React code;
16. `/bridge/launch`, `bridge_launch`, and the superseded Launch Bridge UI remain
    absent.

Reuse existing CP-BR1 non-leak and shape-walker helpers where possible.

## 9. Documentation

Add or update:

- ROS startup sequence (extension boot → status → start → health → bind);
- process ownership and shutdown policy (owned vs externally started);
- recovery/backoff behavior and the bounded retry action;
- native-messaging client contract and manifest permission;
- the version-mismatch incompatibility state;
- the environment requirement (Node 26, PATH export) and the `.ts` caveat;
- explicit statement that generic add-on runtime lifecycle is CP-BR3/4.

Update the CP-BR2 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep the
architecture index, ownership map, Alpha boundary, and ADR-047 consistent.

## 10. Verification

Run targeted CP-BR2 tests first, then the documented regression set. Always use
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
  browser-first/test/bridge-bootstrap-probe.test.mjs \
  browser-first/test/bridge-launcher.test.mjs \
  browser-first/test/bridge-launch-route.test.mjs \
  browser-first/test/bridge-target-section-launch.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  <new CP-BR2 extension test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs
npm run docs:check
git diff --check
```

Replace `<new CP-BR2 extension test files>` with exact paths; do not leave a
placeholder in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` had a **53-finding pre-existing baseline** at CP-BR0 and CP-BR1.
Report the exact new count and diff. Do not fix unrelated documentation backlog.
Any finding for new CP-BR2 files is attributable and must be resolved through a
canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Preserve all user/AVIS and CP-BR0/CP-BR1 work.
- Do not push.
- Do not rewrite history.
- Do not merge or rebase.
- Do not commit unrelated files.
- If the accumulated uncommitted work makes safe isolated commits ambiguous,
  leave changes uncommitted and report that explicitly rather than capturing
  someone else's work.
- Keep implementation focused on CP-BR2.
- Do not add dependencies unless the extension native-messaging client genuinely
  requires one; prefer existing repository patterns and Chrome APIs.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence only if the worktree permits isolated commits safely:

1. `feat(bridge): add extension native-messaging bootstrap client`
2. `feat(bridge): wire ROS startup to bootstrap status/start/bind`
3. `feat(bridge): add post-start credential adoption and rebind`
4. `test(bridge): cover startup idempotency, backoff, and shutdown ownership`
5. `docs(bridge): document ROS startup, shutdown, and recovery`

## 12. CP-BR2 gate

CP-BR2 is green only when all are true:

- a fresh ROS start reaches `Bridge: Connected` without terminal commands;
- restarting ROS / reloading the extension does not create duplicate bridge
  processes;
- offline → start → health → bind is deterministic and bounded;
- version mismatch surfaces a public incompatibility state;
- post-start credential adoption and rebind are explicit and non-leaking;
- unexpected exit surfaces `Failed` with a bounded retry/backoff (no restart
  loop);
- shutdown stops only a ROS-owned bridge;
- existing bridge authentication and capability minting are preserved;
- CP-BR1 bootstrap tests remain green;
- `/bridge/launch`, `bridge_launch`, and the superseded UI action remain absent;
- architecture, ownership, startup/shutdown, and recovery docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** extension client/orchestrator paths, startup
   sequence, rebind trigger, shutdown path, and backoff policy.
3. **Files and commits:** exact files changed and commit hashes, or state why no
   commits were safe.
4. **Startup/reuse evidence:** offline start, already-connected reuse, and
   concurrent-boot idempotency.
5. **Credential adoption evidence:** how and where the generated config is
   re-read and clients rebuilt, with the non-leak proof.
6. **Failure/recovery evidence:** version-mismatch, unexpected exit, bounded
   backoff, shutdown ownership.
7. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
8. **Non-leak evidence:** hostile-input and shape-walker coverage.
9. **Docs check:** exact issue count, baseline delta from 53, and attributable
   findings.
10. **Remaining risks/blockers:** especially any MV3 lifecycle limits or
    cross-platform gaps deferred to CP-BR3+.
11. Explicit `STOP — CP-BR2`.

The session is complete only when CP-BR2 is green or honestly blocked and the
agent has stopped before CP-BR3.
