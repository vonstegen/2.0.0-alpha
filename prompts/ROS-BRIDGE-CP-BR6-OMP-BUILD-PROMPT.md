# OMP BUILD — Bridge & Runtimes UI — CP-BR6

Paste this entire prompt into a new OMP harness session.

---

You are implementing CP-BR6 of the ResonantOS **ROS Bridge + SDK Add-on Runtime
Lifecycle** program. Read this prompt and the listed source-of-truth files before
editing anything. Do not rely on prior chat history.

## 0. Mission

Make bridge infrastructure and SDK runtime activation **observable and
operable** inside ROS: a Settings → Bridge & Runtimes surface that shows core
bridge health, the add-on runtime list, connectors, sessions, and redacted
diagnostics, and that drives actions through host transactions — never local
flags. CP-BR5 delivered the non-secret projection; this session renders it.

This session covers **CP-BR6 only**:

1. add the Settings → Bridge & Runtimes navigation and section;
2. render the five views from CP-BR5's projection plus CP-BR2's bootstrap status;
3. wire enable/disable (and retry/restart only where the host provides a real
   transaction) through host transactions;
4. add accessible status badges, live regions, and loading/empty/degraded/failed
   states;
5. add component and workspace-integration tests;
6. `STOP AND REPORT` before terminal add-ons are migrated to the generic
   lifecycle.

Do **not** implement CP-BR7. In particular, do not register the Ghostty/iTerm2
runtime factories, do not wrap `createTerminalHostService` into the generic
lifecycle, and do not change how terminal add-ons start. Do not reimplement the
projection, the reconciler, or the bootstrap host.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

CP-BR0…CP-BR5 and security hardening are committed; `HEAD` is:

```text
81175a69 docs(bridge): add CP-BR5 OMP build prompt
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
CP-BR6. Do not push. Do not rebase or merge.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use surgical
edits. If formatting noise appears, restore only your own edit and reapply it with
an exact-string throwaway script, then delete the script.

## 3. Source of truth — read in order

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   - especially CP-BR5 and CP-BR6;
2. `docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`
3. `docs/architecture/SDK-RUNTIME-LIFECYCLE-CONTRACT.md`
4. `docs/architecture/BRIDGE-BOOTSTRAP-ROS-STARTUP.md`
5. `docs/architecture/ADR-047-core-bridge-bootstrap-runtime-lifecycle.md`
6. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md`
7. `docs/architecture/MODULE-OWNERSHIP.md`
8. CP-BR5 projection shapes (what you render):
   - `browser-first/host/runtime-projection.mjs`
   - `browser-first/host/runtime-projection-service.mjs`
   - `browser-first/host/bridge-runtimes-host-service.mjs`
9. CP-BR2 bootstrap status surface (the offline source):
   - `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-renderer.js`
   - `browser-first/resonantos-side-panel-extension/src/lib/bootstrap-startup.js`
10. Extension settings + bridge client (where the UI plugs in):
    - `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-settings.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-bootstrap-section.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
11. Existing settings test style:
    - `browser-first/test/bridge-target-section-launch.test.mjs`
    - `browser-first/test/bridge-target-section.test.mjs`

## 4. Contracts you must consume (do not rebuild)

### 4.1 CP-BR5 projection (the online source)

The route `GET /bridge/runtimes` (capability `addon-runtime-read`,
loopback-only) returns the frozen non-secret projection:

```text
bridgeOverview, runtimeList, connectorList, activeSessions,
projectionGeneration, producedAt, updateMechanism
```

- `bridgeOverview`: status/version/endpoint/uptime/generation/bootEpoch/failure.
- `runtimeList`: addonId, runtimeId, runtimeType, status (CP-BR3 vocabulary),
  generation, activeSessionCount, startedAt, lastTransitionAt,
  publicFailureCode, factoryId, classification, displayLabel.
- `connectorList`: addonId, label, runtimeType, connectionState,
  authorizationState, lastSuccessfulHealthAt, publicFailureCode,
  supportedRuntimeTypes.
- `activeSessions`: addonId, runtimeId, activeSessionCount.

Render only these fields; never invent new secret-bearing fields.

### 4.2 CP-BR2 bootstrap status (the offline source)

When the bridge is offline, the UI must derive core-bridge health from the
bootstrap status (`offline | starting | connected | degraded | restarting |
failed`), not from a bridge route. Use `bootstrap-renderer` (SW snapshot via
`chrome.runtime.sendMessage`); do not call `connectNative` from the UI.

### 4.3 Status vocabularies

- Core bridge: `offline | starting | connected | degraded | restarting | failed`.
- Add-on runtime: `inactive | starting | ready | degraded | failed | stopping`.

Do not invent new states. Map these to the UI labels in the roadmap §4.4.

## 5. Required CP-BR6 behavior

### 5.1 Overview

Show core bridge state, public version, uptime, endpoint, and the
runtime/connector/active-session counts, plus an overall health indicator. The
core-bridge state must be visually distinguishable from any single add-on
runtime state (gate).

### 5.2 Add-on runtimes

Per add-on: label, runtime type, lifecycle state
(disabled/authorization/starting/ready/degraded/failed), active session count,
and the actions the host actually supports (see §5.6).

### 5.3 Connectors

Per connector: label, public connection state, authorization state, and
last-successful public health timestamp (render `undefined` as "—" / unknown).

### 5.4 Sessions

Public runtime/session identifiers and running/idle/stopped state, with a safe
terminate action **only where the host supports it**. Never render private
session data.

### 5.5 Diagnostics

Redacted lifecycle events and public failure codes, with retry/restart controls
gated on host support. Use `redactLogValue`-style rendering; never dump raw
errors.

### 5.6 Actions are host transactions, never local flags

- `enable`/`disable` map to the existing registry transaction
  (`POST /addons/enabled`), then re-fetch the projection.
- `retry`/`restart` must call a real host transaction only. Because the CP-BR4
  reconciler is not yet wired into the production composition root, do **not**
  present a restart/retry control as functional if the host does not expose it.
  In that case render the control disabled with an accessible explanation, or
  omit it. Never simulate state locally.

Every action must survive page reload because host state is authoritative; the
UI re-derives from the projection on mount and after each completed transaction.

### 5.7 Rendering and accessibility

- text-only rendering (React text nodes or `textContent`); no `innerHTML`, no
  `dangerouslySetInnerHTML`, no script injection.
- accessible status badges and `aria-live` regions for state transitions;
- loading, empty, degraded, and failed states for every view.

## 6. Implementation requirements

### 6.1 Package boundary

Add the UI under the extension settings surface
(`browser-first/resonantos-side-panel-extension/src/lib/settings/`, e.g.
`bridge-runtimes-section.js`), registered as a section in
`main-workspace-settings.js` (`id: "bridge-runtimes"`, label
"Bridge & Runtimes"). Do not place projection logic in the UI; import the public
types only.

### 6.2 Data access

- Fetch the projection through `bridge-client.js` (register `/bridge/runtimes` →
  `addon-runtime-read` in the capability map if not present).
- Fetch core-bridge status through `bootstrap-renderer`.
- Poll the projection on mount and on a bounded interval, and refresh after each
  completed host transaction. Guard against out-of-order responses using
  `projectionGeneration` (drop stale responses).

### 6.3 Seams

Every data source and transaction must be injectable for tests: the projection
fetcher, the bootstrap-status source, and the enable/disable transaction. No
module-global mutable test seam in production paths.

### 6.4 Ownership

Update `MODULE-OWNERSHIP.md` so the new settings section has a named owner and
boundary (renders only the public projection; never owns lifecycle authority,
credentials, or process state).

## 7. Non-negotiable security rules

1. No capability/bootstrap token, provider credential, prompt content, memory
   content, raw env, auth-file/token-file path, child argv, PID, or private path
   is rendered.
2. Text-only rendering; no innerHTML/script injection.
3. Host state is authoritative; UI never mutates lifecycle state with a local
   flag.
4. Actions route through host transactions only; no client-side simulation of
   start/stop/enable/disable.
5. Core-bridge health and add-on runtime health are rendered as distinct,
   correctly sourced states.
6. Stale projection responses are dropped by generation.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR5
   behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic component and workspace-integration tests (jsdom + injected
seams, matching the existing settings-test style). At minimum prove:

1. the section renders bridgeOverview, runtimeList, connectorList,
   activeSessions, and diagnostics from injected projection data;
2. core-bridge health is shown from bootstrap status when offline (no bridge
   route call);
3. online detail comes from the projection route;
4. a stale projection (older `projectionGeneration`) is dropped;
5. add-on runtime state is distinct from core bridge state;
6. loading/empty/degraded/failed states render for each view;
7. `enable`/`disable` call the host transaction and re-fetch (not a local flag);
8. restart/retry is disabled/omitted when no host transaction exists;
9. no secret/path/token-shaped value reaches the rendered DOM (shape-walker);
10. rendering uses text nodes/textContent only (no innerHTML/script);
11. the section is registered in the Settings navigation and renders in the
    workspace;
12. existing CP-BR1…CP-BR5 tests remain green.

## 9. Documentation

Add or update:

- user guide: Bridge & Runtimes;
- UI state glossary (map the two status vocabularies to labels);
- operator troubleshooting flow (offline → start, failed → retry, degraded →
  inspect failure code);
- explicit statement that terminal add-on migration is CP-BR7.

Update the CP-BR6 checklist and gate in
`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` when done. Keep
`MODULE-OWNERSHIP.md`, the Alpha boundary, and the architecture index
consistent.

## 10. Verification

Run targeted CP-BR6 tests first, then the documented regression set. Always use
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
  browser-first/test/bridge-target-section.test.mjs \
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
  <new CP-BR6 UI test files> \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR6 UI test files>` with exact paths; do not leave a placeholder
in the command you execute.

Report counts by label:

- `core` (`npx vitest run`)
- `demo` (`examples/sdk-demo` vitest)
- `browser-first` (Node test runner)
- `ownership/docs` (ownership test + docs:check + security pipeline)

`docs:check` baseline at CP-BR5 was **59** (53 pre-existing + 6 program prompt
files). Report the exact new count and diff. Do not fix unrelated documentation
backlog. Any finding for new CP-BR6 files is attributable and must be resolved
through a canonical link.

Do not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR6 work in small checkpoint commits.
- Do not push.
- Do not rewrite history, merge, or rebase.
- Do not commit unrelated files.
- Do not add dependencies; use existing React/jsdom test patterns and
  `bridge-client.js`/`bootstrap-renderer`.
- Do not weaken tests to accommodate the implementation.

Suggested commit sequence:

1. `feat(ui): add Bridge & Runtimes settings section`
2. `feat(ui): wire projection + bootstrap status and host transactions`
3. `test(ui): cover states, staleness, and non-leak rendering`
4. `docs(ui): document Bridge & Runtimes user guide and glossary`

## 12. CP-BR6 gate

CP-BR6 is green only when all are true:

- an operator can distinguish core bridge health from an individual add-on
  runtime;
- every action survives page reload because host state is authoritative;
- the UI displays no secret or private path;
- offline state comes from bootstrap status and online detail from the
  projection;
- enable/disable route through host transactions, not local flags;
- retry/restart is not presented as functional without a real host transaction;
- loading/empty/degraded/failed states and accessible badges/live regions are
  present;
- text-only rendering with no innerHTML/script injection;
- existing CP-BR1…CP-BR5 tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** section path, data sources, transaction wiring,
   and staleness handling.
3. **Files and commits:** exact files changed and commit hashes.
4. **View evidence:** the five views and their public fields.
5. **Source-of-truth evidence:** offline (bootstrap) vs online (projection), and
   host-transaction actions.
6. **Non-leak evidence:** shape-walker on the rendered DOM.
7. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`, and
   `ownership/docs`.
8. **Docs check:** exact issue count, baseline delta from 59, and attributable
   findings.
9. **Remaining risks/blockers:** especially retry/restart gating and anything
   deferred to CP-BR7.
10. Explicit `STOP — CP-BR6`.

The session is complete only when CP-BR6 is green or honestly blocked and the
agent has stopped before CP-BR7.
