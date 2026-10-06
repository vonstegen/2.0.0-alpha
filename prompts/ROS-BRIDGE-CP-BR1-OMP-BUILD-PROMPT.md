# OMP BUILD — ROS Independent Core Bridge Bootstrap — CP-BR1

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR1 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Build and verify the independent core bridge bootstrap contract selected by
CP-BR0.

The Alpha bootstrap owner is a **dedicated Browser-First Chrome
native-messaging host** that remains reachable while the authenticated core
bridge HTTP server is offline.

This session covers **CP-BR1 only**:

1. implement the independent bootstrap protocol and host-owned lifecycle core;
2. add deterministic process, generation, timeout, hostile-input, and non-leak
   tests;
3. document the protocol and macOS installation/removal path needed to exercise
   the fixture;
4. `STOP AND REPORT` before extension startup integration.

Do **not** implement CP-BR2. In particular, do not connect extension boot to the
native host, do not auto-start the bridge when the MV3 worker starts, and do not
build the generic add-on runtime lifecycle manager.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

Expected base `HEAD`:

```text
ce6ebdf3 feat(terminal-host): add Launch Bridge UI affordance + auto-retry
```

The branch was 20 commits ahead of origin at the CP-BR0 handoff. Nothing should
be pushed.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node must satisfy the repository requirement. Node 24+ is required; Homebrew
Node 26 is known working.

## 2. Preserve the CP-BR0 worktree

CP-BR0 was completed without creating commits because user/AVIS documentation
was already uncommitted. Inspect `git status` first and preserve everything.

Expected modified/untracked work includes some or all of:

```text
 M browser-first/host/bridge-bootstrap.mjs
 M browser-first/host/bridge-launcher.mjs
 M browser-first/host/harness-host-service.mjs
 M browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js
 M browser-first/test/bridge-launch-route.test.mjs
 M browser-first/test/bridge-target-section-launch.test.mjs
 M docs/architecture/ALPHA_RUNTIME_BOUNDARY.md
 M docs/architecture/MODULE-OWNERSHIP.md
 M docs/architecture/README.md
 M prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md
 M src/core/web-transport.test.ts
 M src/core/web-transport.ts
 M src/modules/terminal/OpenInTerminalButton.test.tsx
 M src/modules/terminal/OpenInTerminalButton.tsx
?? docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
?? docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md
?? prompts/ROS-BRIDGE-SDK-RUNTIME-NEW-CHAT-HANDOFF.md
?? prompts/ROS-BRIDGE-CP-BR1-OMP-BUILD-PROMPT.md
```

The exact status may differ if CP-BR0 was committed after this prompt was
created. Never reset, discard, overwrite, or broadly reformat existing work.
Before editing any modified file, inspect its working-tree diff.

Zed/editor formatting previously caused whole-file JS/TS/Markdown noise. Use
surgical edits. If formatting noise appears, restore only your own edit and
reapply it with an exact-string throwaway script, then delete the script.

Do not push, open a PR, merge, rebase, or merge `feature/pi-testing-phase`.

## 3. Source of truth — read in order

1. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
2. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially CP-BR0 and CP-BR1;
3. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
4. `docs/architecture/MODULE-OWNERSHIP.md`
5. `docs/architecture/README.md`
6. `prompts/TERMINAL-HOST-LAUNCH-BRIDGE-PROMPT.md`
   - historical and marked **SUPERSEDED — DO NOT IMPLEMENT**;
7. `docs/architecture/ADR-006-addon-runtime-sdk.md`
8. `docs/architecture/ADR-018-addon-sdk-v0.md`
9. `docs/architecture/ADR-037-browser-first-chromium-resonantos.md`
10. `docs/architecture/ADR-046-addon-classification-category-discovery.md`
11. `browser-first/host/bridge-bootstrap.mjs`
12. `browser-first/host/bridge-launcher.mjs`
   - deprecated implementation evidence, not a production bootstrap boundary;
13. `browser-first/host/run-bridge-minimal.mjs`
14. `browser-first/host/bridge-server.mjs`
15. `apps/augmentor/install-native-host.sh`
16. `apps/augmentor/extension/manifest.json`
17. `apps/augmentor/extension/port.mjs`
18. `apps/augmentor/pipe.mjs`
19. Browser-First extension manifest and rebind owners:
    - `browser-first/resonantos-side-panel-extension/manifest.json`
    - `browser-first/resonantos-side-panel-extension/src/background.js`
    - `browser-first/resonantos-side-panel-extension/src/side-panel.js`
    - `browser-first/resonantos-side-panel-extension/src/main-workspace.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`

The `apps/augmentor` native host is **precedent only**. It is a separately
classified product and must not silently become the ROS bootstrap owner.

## 4. CP-BR0 decisions you must preserve

### One core bridge

ROS owns one authenticated loopback core bridge. Do not create a bridge per
add-on, category, connector, or terminal adapter.

### Independent bootstrap owner

The CP-BR1 owner is a new, narrowly scoped Browser-First Chrome
native-messaging bootstrap host. It must remain callable while the bridge HTTP
server is absent.

A macOS `launchd` unit may be useful as an optional development supervisor, but
it is not lifecycle authority and must not replace the native-messaging
contract.

### No bridge-hosted self-start

CP-BR0 removed production wiring for:

```text
POST /bridge/launch
bridge_launch
```

Do not restore those paths. A stopped bridge cannot serve a route that starts
itself. Tests must continue to prove the route and UI action are absent.

### Modular add-on runtimes are later

Add-ons activate reviewed runtime factories behind the running bridge. They do
not start the bridge. CP-BR3/CP-BR4 own the generic runtime lifecycle manager;
do not build it here.

### Classification is not authority

`classification.category` describes identity. It does not grant process,
capability, surface, executable, or lifecycle authority.

## 5. Required CP-BR1 protocol

Implement a deterministic bootstrap protocol with these operations:

```text
status
start
restart
stopForShutdown
```

Use a closed public status vocabulary:

```text
offline | starting | connected | degraded | restarting | failed
```

A public result may contain only:

```text
status
public version
loopback endpoint
instance/generation id
startedAt
public failure code
alreadyRunning
```

Use repository naming conventions, but keep the vocabulary closed and
documented. Do not return PID, process paths, argv, raw errors, or private
configuration.

Define a narrow versioned native-message envelope. Suggested shape:

```ts
type BootstrapRequest =
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "status" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "start" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "restart" }
  | { protocol: "resonantos/bootstrap/v1"; requestId: string; operation: "stopForShutdown" };
```

The exact response shape is yours to design, subject to the public-field and
non-leak rules. Reject unknown fields and unsupported protocol versions.

## 6. Implementation requirements

### 6.1 Package boundary

Create a dedicated Browser-First bootstrap package/module boundary. Choose a
clear repository path consistent with ADR-047 and update module ownership. Do
not place bootstrap process lifecycle inside:

- `harness-host-service.mjs`;
- `bridge-server.mjs`;
- an add-on manifest;
- the independent `apps/augmentor` product;
- renderer or page JavaScript.

Keep protocol validation, lifecycle state, native framing, process policy, and
installer generation separable enough for deterministic unit tests.

### 6.2 Native messaging framing

Implement Chrome native-messaging framing correctly:

- four-byte little-endian unsigned message length;
- UTF-8 JSON payload;
- bounded maximum message size;
- deterministic malformed/truncated-frame rejection;
- serialized stdout writes with no logs on stdout;
- diagnostics, if any, go to a bounded/redacted stderr path;
- no raw request or environment logging.

You may adapt structural ideas from `apps/augmentor/pipe.mjs`, but do not copy
its DSH authority, tokens, protocol, product identity, or unrelated runtime
behavior.

### 6.3 Pinned process launch

The bootstrap host owns all process inputs:

- use a pinned Node executable selected by installation/package policy;
- launch with `process.execPath` or an equivalently installer-pinned absolute
  Node path;
- pass the reviewed `browser-first/host/run-bridge-minimal.mjs` entry as argv;
- pin the working directory;
- use a fixed argv shape;
- pin or internally derive the loopback endpoint;
- no shell;
- no ambient executable lookup;
- no caller-supplied command, argv, script, path, cwd, endpoint, or environment.

The deprecated launcher currently executes the `.mjs` entry directly even
though it is not executable. Do not copy that defect. The required process
shape is conceptually:

```text
<pinned node> <pinned run-bridge-minimal.mjs> <fixed bridge args>
```

### 6.4 Child environment

Never spread `process.env` into the bridge child.

Build an explicit environment allowlist owned by the bootstrap package. Include
only keys demonstrated to be required by the reviewed Alpha bridge startup.
Provider credentials, capability tokens, generated bridge tokens, prompt or
memory values, arbitrary user variables, and raw browser/native-host state must
not be forwarded.

If `PATH` is required, prefer a host-pinned value over ambient inheritance and
document why. Do not make provider behavior depend on arbitrary browser process
environment inheritance.

### 6.5 Idempotency and concurrency

`start` must be idempotent across both sequential and concurrent calls:

- connected → return `alreadyRunning: true`, no spawn;
- one in-flight start owns the generation;
- concurrent starts join or receive the same bounded public result;
- never spawn two bridge processes for one desired generation;
- health success must be attributable to the expected owned generation, not
  merely any process answering the port.

Use an explicit lifecycle state machine and private ownership record.

### 6.6 Generation fencing

Every owned start/restart receives a new generation or instance identifier.
Late completion from an older start, restart, health probe, exit callback, or
stop must not overwrite newer state.

`restart` must:

1. fence the old generation;
2. stop only an instance owned by this bootstrap host;
3. start one new generation;
4. reject/ignore stale old-generation completion.

Do not expose PID publicly. PID/process handles remain private implementation
state.

### 6.7 Bounded lifecycle

Bound all waits:

- initial health probe;
- start health wait;
- restart stop/start wait;
- shutdown stop wait;
- native request handling where relevant.

No infinite polling, recursive restart loop, or unbounded queue.

On failed startup or timeout, make a bounded attempt to stop only the owned
child. Return a closed public failure code such as:

```text
start-failed
health-timeout
restart-failed
stop-failed
version-mismatch
invalid-request
```

Do not surface platform error codes or exception messages publicly.

### 6.8 Health probing

Reuse `ensureBridgeReachable` from
`browser-first/host/bridge-bootstrap.mjs`. Do not implement a second HTTP/TCP
health probe.

Resolve the current default-port mismatch deliberately:

- bridge/extension Alpha default is `47773`;
- historical `DEFAULT_BRIDGE_ENDPOINT` may use `47800`.

Choose one authoritative host-pinned Alpha endpoint or a safe internally owned
port-adoption strategy and update docs/tests consistently. The UI must not
choose an arbitrary loopback port.

### 6.9 Shutdown ownership

`stopForShutdown` may stop only a process owned by this bootstrap host and only
the current generation. It must not kill an unrelated process that happens to
listen on the endpoint.

If a healthy bridge is discovered but is not owned by the bootstrap host,
`start` may report it already running, but shutdown must leave it untouched.
Represent ownership privately and test this distinction.

### 6.10 Generated config and credentials

Do not return, log, or shape-walk through the contents of:

```text
browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js
```

The native bootstrap status contract is public and non-secret. Secure adoption
of generated bridge credentials by the extension must be designed explicitly,
but CP-BR1 must not wire extension startup or leak tokens through public status.

If a private native-message operation is absolutely required for credential
adoption, stop and document the proposed authenticated/private contract before
implementing it. Do not smuggle credentials into the public lifecycle result.
CP-BR2 owns extension startup/rebind integration.

## 7. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, script path,
   working directory, endpoint, environment key, or environment value.
2. Bridge entrypoint, Node executable, working directory, endpoint policy, and
   argv are host-pinned.
3. Never spread `process.env`.
4. Never return/read/log bridge capability tokens, bootstrap tokens, provider
   credentials, auth/token-file contents, prompt content, memory content, or raw
   environment.
5. Never return private paths, PID, child argv, or raw exceptions publicly.
6. Start is concurrency-safe, idempotent, and generation-fenced.
7. Startup/restart/shutdown/health waits are bounded.
8. Native stdout carries framed protocol messages only.
9. The native-host manifest must pin `allowed_origins` to the intended extension
   origin; no wildcard origin.
10. Preserve bridge authentication, loopback enforcement, capability checks,
    and all XH4/XH5 terminal non-leak/cleanup invariants.
11. Do not restore `/bridge/launch` or `bridge_launch`.
12. Do not execute manifest `service.entrypoint` values or create a generic
    arbitrary process launcher.

## 8. Deterministic test requirements

Add focused tests with injected seams for spawn, clock/timers, health probe,
process exit/kill, filesystem/package resolution, and framing.

At minimum prove:

1. offline → `start` → `connected`;
2. connected → `start` returns `alreadyRunning` with no second spawn;
3. two concurrent starts cause exactly one spawn;
4. restart creates a new generation;
5. stale old-generation health success cannot replace new state;
6. stale old-generation exit cannot mark the new instance offline/failed;
7. synchronous spawn failure returns only a public `start-failed` equivalent;
8. asynchronous child error returns only a public failure;
9. health timeout is bounded and attempts owned-child cleanup;
10. restart timeout is bounded;
11. `stopForShutdown` stops the current owned instance;
12. `stopForShutdown` does not stop an externally discovered bridge;
13. arbitrary command/argv/cwd/path/endpoint/env fields are rejected by exact
    request-shape validation;
14. spawn receives the pinned Node executable, pinned entrypoint, fixed argv,
    pinned cwd, `shell: false`, and allowlisted env only;
15. non-loopback or caller-selected endpoints are impossible or rejected;
16. native framing handles split frames, multiple frames, oversized frames,
    malformed JSON, arrays/null, unsupported protocol versions, and unknown
    fields;
17. no log text contaminates native stdout;
18. shape-walker finds no token/credential/path/PID/env/prompt/memory/raw-error
    field or value in public results and telemetry;
19. bootstrap fixture remains callable with no bridge HTTP server running;
20. bridge-hosted `/bridge/launch`, `bridge_launch`, and Launch Bridge UI remain
    absent.

Use fake processes and deterministic timers. Do not require killing a real user
bridge. A narrow integration fixture may launch a reviewed test bridge entry if
it uses an isolated port and guaranteed cleanup.

## 9. Packaging and documentation

Add or update documentation for:

- protocol request/response schema;
- lifecycle state machine;
- public error codes;
- ownership and generation semantics;
- environment allowlist;
- Chrome native-host manifest identity and extension-origin restriction;
- macOS install/uninstall steps for the Alpha fixture;
- troubleshooting for offline, start-failed, timeout, and version mismatch;
- explicit statement that extension startup integration is CP-BR2;
- explicit statement that provider credentials are not inherited from arbitrary
  browser/native-host environment.

Update these architecture contracts if implementation paths become concrete:

- `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
- `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
- `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
- `docs/architecture/MODULE-OWNERSHIP.md`
- `docs/architecture/README.md`

Do not mark CP-BR2 complete.

## 10. Verification

Start with focused CP-BR1 tests, then run the documented regression set.

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
  browser-first/test/bridge-launcher.test.mjs \
  browser-first/test/bridge-launch-route.test.mjs \
  browser-first/test/bridge-target-section-launch.test.mjs \
  <new CP-BR1 bootstrap test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
npm run docs:check
git diff --check
```

Replace `<new CP-BR1 bootstrap test files>` with exact paths; do not leave a
placeholder in the command you execute.

Report test counts by label:

- `core`
- `demo`
- `browser-first`
- `ownership/docs`

`docs:check` had **53 known reachability findings** at CP-BR0. Report the exact
new count and diff. Do not fix unrelated documentation backlog. Any finding for
new CP-BR1 protocol/runbook files is attributable to this work and must be
resolved through a canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Preserve all user/AVIS work.
- Do not push.
- Do not rewrite history.
- Do not merge or rebase.
- Do not commit unrelated files.
- If the existing mixed worktree makes safe commits ambiguous, leave changes
  uncommitted and report that explicitly rather than capturing someone else's
  work.
- Keep implementation focused on CP-BR1.
- Do not add dependencies unless native framing/testing genuinely requires one;
  prefer Node built-ins and existing repository patterns.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence only if the worktree permits isolated commits safely:

1. `feat(bridge): add independent native bootstrap protocol`
2. `feat(bridge): add generation-fenced bootstrap lifecycle`
3. `test(bridge): cover bootstrap idempotency fencing and non-leak`
4. `docs(bridge): document native bootstrap installation and protocol`

## 12. CP-BR1 gate

CP-BR1 is green only when all are true:

- the independent native bootstrap fixture is callable while the bridge HTTP
  server is absent;
- it starts the reviewed bridge exactly once;
- sequential and concurrent starts are idempotent;
- restart and stale completion are generation-fenced;
- startup, restart, shutdown, and health waits are bounded;
- shutdown affects only a ROS-bootstrap-owned instance;
- public results and telemetry pass hostile-input and shape-walker tests;
- native framing is bounded and stdout-clean;
- existing terminal-host tests remain green;
- `/bridge/launch`, `bridge_launch`, and the superseded UI action remain absent;
- architecture, ownership, protocol, and installation docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** package path, native-host identity, protocol,
   lifecycle state machine, and process ownership model.
3. **Files and commits:** exact files changed and commit hashes, or state why no
   commits were safe.
4. **Spawn policy:** pinned executable/entry/cwd/argv/endpoint and exact env
   allowlist.
5. **Generation/idempotency evidence:** concurrent start, restart, stale
   completion, and shutdown ownership results.
6. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
7. **Non-leak evidence:** hostile-input and shape-walker coverage.
8. **Docs check:** exact issue count, baseline delta from 53, and attributable
   findings.
9. **Remaining risks/blockers:** especially credential adoption or packaging
   limitations deferred to CP-BR2.
10. Explicit `STOP — CP-BR1`.

The session is complete only when CP-BR1 is green or honestly blocked and the
agent has stopped before CP-BR2.
