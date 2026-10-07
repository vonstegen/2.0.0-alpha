# OMP BUILD — Runtime, Connector, And Session Projection — CP-BR5

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR5 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Expose a single non-secret projection for the Bridge & Runtimes UI: one shape
that carries core bridge state, the add-on runtime list, the connector list, and
an active-session summary. CP-BR4 delivered the reconciler and its non-secret
lifecycle events; this session turns those private signals into a public
projection contract plus the host-side module and route that serve it.

This session covers **CP-BR5 only**:

1. add the bridge overview, runtime list, connector list, and active-session
   summary projection shapes;
2. implement the projection module that assembles them from host-owned inputs;
3. define the polling/push update mechanism and stale-generation behavior;
4. shape-walker every public payload and redact logs/rejections;
5. document the schema, failure-code catalog, and privacy/redaction contract;
6. `STOP AND REPORT` before the Bridge & Runtimes UI.

Do **not** implement CP-BR6. In particular, do not build the Settings →
Bridge & Runtimes UI, do not render any React/extension view, and do not add
user actions (enable/disable/retry/restart) — those are CP-BR6/CP-BR7. The
projection is the data contract; the UI consumes it later.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

The CP-BR0…CP-BR4 and security-hardening work is **already committed** in seven
local commits ending at:

```text
6796db8f security(bridge): close subprocess terminal allowlist
```

Start by confirming `git status` is clean (it should be). Nothing should be
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

## 2. Worktree state — commit this phase

Unlike prior phases, the worktree is clean and the accumulated work is
committed. Make small checkpoint commits for CP-BR5; there is no longer a
"capturing someone else's work" ambiguity. Do not push. Do not rebase or merge.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use surgical
edits. If formatting noise appears, restore only your own edit and reapply it with
an exact-string throwaway script, then delete the script.

## 3. Source of truth — read in order

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially §4 (public lifecycle model) and CP-BR5;
2. `docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`
3. `docs/architecture/RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md`
4. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
5. `docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md`
6. `docs/architecture/ADR-046-addon-classification-category-discovery.md`
7. `docs/architecture/MODULE-OWNERSHIP.md`
8. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
9. CP-BR3 lifecycle types (the vocabulary you project):
   - `packages/addon-sdk/src/runtime-lifecycle.ts`
10. CP-BR4 reconciler + factory registry (the state/event sources):
    - `browser-first/host/runtime-reconciler.mjs`
    - `browser-first/host/runtime-factory-registry.mjs`
    - `browser-first/host/runtime-lifecycle-host.mjs`
11. CP-BR2 bridge status source:
    - `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-client.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-startup.js`
12. Host-owned registry projection (connectors/installations):
    - `browser-first/host/harness-registry.mjs`
    - `browser-first/host/harness-host-service.mjs`
13. Existing session projections (session counts, no private data):
    - `browser-first/host/terminal-host-service.mjs`
    - `browser-first/host/opencode-session-host-service.mjs` (if present)

## 4. Contracts you must consume (do not rebuild)

### 4.1 Add-on runtime status vocabulary (CP-BR3)

```ts
type AddOnRuntimeLifecycleStatus =
  "inactive" | "starting" | "ready" | "degraded" | "failed" | "stopping";
```

The projection reuses this vocabulary; it does not invent new states.

### 4.2 Core bridge status vocabulary (CP-BR1/CP-BR2)

```text
offline | starting | connected | degraded | restarting | failed
```

### 4.3 Reconciler events (CP-BR4)

The reconciler emits non-secret lifecycle events
(`{ type, addonId, factoryId, generation, publicFailureCode?, publicReason?, at }`).
The projection may consume these (in generation order) but must never re-derive
desired state or reach into private process state.

## 5. Required CP-BR5 behavior

### 5.1 Bridge overview projection

One public bridge overview carrying:

- core bridge status (the CP-BR2 vocabulary);
- public version;
- loopback endpoint (public only);
- uptime or started-at (public timestamp);
- instance/generation id;
- public failure code when failed.

No capability token, bootstrap token, credential, private path, or raw env.

### 5.2 Runtime list projection

A list of add-on runtimes, each carrying:

- `addonId`, `runtimeId`, `runtimeType` (unknown runtime types must remain
  displayable via public identifiers — do not drop them);
- lifecycle `status`;
- `generation`;
- `activeSessionCount`;
- `startedAt`/`lastTransitionAt` where public;
- `publicFailureCode` where applicable.

Do not include PID, child argv, spawn summary internals, or factory private
state.

### 5.3 Connector list projection

A list of connectors, each carrying a public label, public connection state,
authorization state, and last-successful public-health timestamp. Connectors are
derived from the host registry (classification.category `connector` and/or
connector surfaces); the projection surfaces public identifiers only.

### 5.4 Active-session summary

Public runtime/session identifiers and active-session counts. Never include
private session data (prompt content, memory content, credential, token, raw
session payload). Only counts and public identifiers.

### 5.5 Ordering and staleness

The projection must reflect lifecycle transitions in order (monotonic by
generation/sequence). A stale or superseded projection must not overwrite a
newer one. Include a projection generation/sequence so consumers can detect
staleness.

### 5.6 Polling/push update mechanism

Define how the projection is delivered:

- a snapshot route (e.g. `GET` returning the current projection) for polling;
- and/or a projection event stream derived from the reconciler events.

Choose one primary mechanism and document it; the projection module must remain
independent of the transport (route vs stream) so the CP-BR6 UI can subscribe
either way.

### 5.7 Shape-walker and redaction

Every public payload must pass a shape-walker asserting no token-, credential-,
path-, PID-, argv-, env-, prompt-, or memory-shaped value is reachable. Log and
rejection serialization must be redacted to the public projection only.

## 6. Implementation requirements

### 6.1 Package boundary

Place the projection in `browser-first/host/` (for example
`runtime-projection.mjs`). Keep it a **pure projection** — it takes structured
inputs (bridge status, reconciler snapshot/events, factory registry metadata,
registry connector/install projection, session counts) and returns the public
projection. It must not:

- read files, spawn processes, or call the network;
- reach into reconciler/factory private state;
- import React/renderer code;
- contain route/auth logic.

A thin host route (in `harness-host-service.mjs` or a dedicated service) serves
the projection; that route owns capability enforcement and redaction, not the
projection itself.

### 6.2 Pure projection

`projectBridgeRuntimes(input)` is pure and deterministic. `Object.freeze` the
result where the project convention does. Validate inputs and fail closed on
malformed/unknown shapes, but keep unknown `runtimeType` values displayable via
their public identifiers.

### 6.3 Seams

Make the projection testable with injected bridge status, reconciler snapshot,
factory metadata, registry projection, and session counts. No module-global
mutable test seam in production paths.

### 6.4 Ownership

Update `MODULE-OWNERSHIP.md` so the projection module and route have named
owners and boundaries, and state the non-ownership (no secrets, no process
control, no bridge auth).

## 7. Non-negotiable security rules

1. Public projection carries public identifiers, statuses, counts, timestamps,
   and public failure codes only.
2. No capability/bootstrap tokens, provider credentials, prompt content, memory
   content, raw env, auth-file/token-file paths, child argv, or PID.
3. Shape-walker every public payload; redact logs and rejection serialization.
4. Projection reflects transitions in order and never lets stale state overwrite
   newer state.
5. Unknown runtime types remain displayable via public identifiers (fail open on
   display, fail closed on authority).
6. Classification is not authority; it may be displayed but never branches
   behavior.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR4
   behavior; the projection does not bypass them.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests. At minimum prove:

1. bridge overview carries status/version/endpoint/generation and no secret;
2. runtime list carries status/runtimeType/generation/activeSessionCount/failure
   code in generation order;
3. an unknown `runtimeType` is still projected with its public `addonId`/`runtimeId`;
4. connector list carries label/connection state/authorization/last-health;
5. active-session summary carries counts + public identifiers, no private data;
6. stale projection (older generation) cannot overwrite a newer one;
7. the projection reflects lifecycle transitions in order;
8. shape-walker finds no token/credential/path/PID/argv/env/prompt/memory value
   in any public payload;
9. log and rejection serialization are redacted to the public shape;
10. malformed/forged input fails closed (or is coerced to public identifiers);
11. the projection module performs no I/O (no `fs`/`spawn`/`fetch`/timers);
12. the snapshot route enforces its capability and loopback (if a route is
    added);
13. existing CP-BR1…CP-BR4 tests remain green.

Reuse the CP-BR3/CP-BR4 shape-walker helpers.

## 9. Documentation

Add or update:

- bridge/runtime projection schema (bridge overview, runtime list, connector
  list, session summary, update mechanism, projection generation);
- public failure-code catalog;
- privacy and redaction contract (what is never in the projection, what is
  public);
- explicit statement that the UI is CP-BR6.

Update the CP-BR5 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep
`MODULE-OWNERSHIP.md`, the Alpha boundary, and ADR-047 consistent.

## 10. Verification

Run targeted CP-BR5 tests first, then the documented regression set. Always use
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
  browser-first/test/runtime-reconciler.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  <new CP-BR5 projection test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR5 projection test files>` with exact paths; do not leave a
placeholder in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` had a **53-finding pre-existing baseline** through CP-BR0…CP-BR4.
Report the exact new count and diff. Do not fix unrelated documentation backlog.
Any finding for new CP-BR5 files is attributable and must be resolved through a
canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR5 work in small checkpoint commits (the tree is clean; safe to
  commit).
- Do not push.
- Do not rewrite history, merge, or rebase.
- Do not commit unrelated files.
- Keep implementation focused on CP-BR5.
- Do not add dependencies; the projection uses existing host modules and pure
  functions.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence:

1. `feat(bridge): add non-secret runtime/connector/session projection`
2. `feat(bridge): serve projection route with capability and loopback`
3. `test(bridge): shape-walker and ordering coverage for the projection`
4. `docs(bridge): document projection schema and redaction contract`

## 12. CP-BR5 gate

CP-BR5 is green only when all are true:

- the projection reflects lifecycle transitions in order;
- no token, credential, prompt content, memory content, raw env, auth-file path,
  token-file path, or child argv is present;
- unknown runtime types remain displayable through public identifiers;
- a stale/superseded projection cannot overwrite a newer one;
- the update mechanism (polling and/or push) is defined and documented;
- every public payload passes the shape-walker;
- logs and rejection serialization are redacted;
- existing CP-BR1…CP-BR4 tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** projection module/route paths, projection
   shapes, update mechanism, and generation/staleness handling.
3. **Files and commits:** exact files changed and commit hashes.
4. **Projection evidence:** the four shapes (bridge/runtime/connector/session)
   and their public fields.
5. **Ordering/staleness evidence:** monotonic generation and stale rejection.
6. **Non-leak evidence:** shape-walker and redaction coverage.
7. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
8. **Docs check:** exact issue count, baseline delta from 53, and attributable
   findings.
9. **Remaining risks/blockers:** especially anything deferred to CP-BR6 (UI).
10. Explicit `STOP — CP-BR5`.

The session is complete only when CP-BR5 is green or honestly blocked and the
agent has stopped before CP-BR6.
