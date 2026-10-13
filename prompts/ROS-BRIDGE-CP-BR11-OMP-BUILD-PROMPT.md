# OMP BUILD — Terminals On The Left Rail — CP-BR11

Paste this entire prompt into a new OMP harness session.

---

You are implementing **CP-BR11** of the ResonantOS **ROS Bridge + SDK Add-on
Runtime Lifecycle** program: surface the reviewed terminal add-ons (Ghostty +
iTerm2) on the extension's **left rail** with enable/grant/launch, instead of
burying them in Settings. Read this prompt and the listed source-of-truth files
before editing anything. Do not rely on prior chat history.

## 0. Mission

The terminal add-ons are already seeded into the harness registry (CP-BR9) and
already have a Settings renderer (CP-BR10), but they are only visible under
**Settings → Bridge & Runtimes** and **Settings → Add-on Tools**. The operator
wants them on the **left rail** of the main workspace — one obvious place to
see them, enable + grant them, and launch them.

Concretely:

1. Add a new **"Terminals"** workspace to the main workspace's left rail
   (`allowedWorkspaces` + a rail button), matching the roadmap's
   "Add-on Surfaces → Terminal" intent.
2. Render one card/tab per reviewed terminal add-on (Ghostty + iTerm2) driven
   by the host, with the badge, **enable + grant**, **launch**, and
   **copy connection script** affordances.
3. Read the terminal state from the **harness registry / projection**
   (`GET /bridge/runtimes`, `GET /terminal-host/status`) — **not** from
   `GET /addons/status`, which is a different registry and is why the
   terminals are currently absent from the left rail.
4. STOP AND REPORT. Do not implement packaging/release (roadmap §15).

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

`HEAD` is expected to be at or after:

```text
68d293d3 test(bridge): allow re-introduced terminal-host module and addons in alpha scope
```

Confirm `git status` is clean and `git log` before starting; nothing is pushed.
Do not rebase or merge.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node 24+ is required; `.nvmrc` pins `24.21.0` (`nvm use` from the repo root).
Do not use Node 22 — `.ts` files and several tests fail on it.

## 2. Worktree state — commit this phase

Start clean. Make small checkpoint commits. Do not push. Do not rewrite history.
Use surgical edits; if a formatter rewrites a whole file, revert to HEAD and
re-apply your change via an exact-string throwaway `node` script, then delete
the script.

## 3. Source of truth — read in order

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` — §1 (the "Open Add-on
   Surfaces → Terminal" product outcome), §13 (CP-BR7), §14 (CP-BR8).
2. `docs/operations/CP-BR8-ACCEPTANCE-RUNBOOK.md` — the enable/grant/launch
   operator walk (rows 3–7).
3. The main-workspace composition (where the left rail lives):
   - `browser-first/resonantos-side-panel-extension/src/main-workspace.html`
     (the `<aside class="workspace-rail">` buttons)
   - `browser-first/resonantos-side-panel-extension/src/main-workspace.js`
     (`allowedWorkspaces`, `workspaceButtons`, `setActiveWorkspace`,
     `renderMessages`, `renderAll`)
4. The existing Settings terminal renderer to reuse (do not duplicate logic):
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js`
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js`
5. The host-seam injection pattern to mirror:
   - `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-settings.js`
     (the `bridge-runtimes` and `addon-tools` section injection blocks)
6. The route capability map (already declares the terminal-host routes):
   - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
7. The host side (understand, do not rebuild):
   - `browser-first/host/harness-host-service.mjs` (`/addons/registry`,
     `/addons/enabled`, `/addons/grants`, `/terminal-host/status`,
     `/terminal-host/launch`, `/terminal-host/connection-script`)
   - `browser-first/host/terminal-addon-seed.mjs` (the seed)
   - `browser-first/host/runtime-projection-service.mjs` (the projection)

## 4. Contracts you must accept (do not rebuild)

- **Terminal add-on ids:** `addon.resonant-terminal-ghostty`,
  `addon.resonant-terminal-iterm2`.
- **Factory ids (CP-BR7):** `com.resonantos.factory.terminal-host.ghostty`,
  `com.resonantos.factory.terminal-host.iterm2`.
- **Capability:** `terminal-host` (grant scope `system`, revocation
  `degrade`, `granted: true` when authorized).
- **The two-registry split (the root cause you are fixing):** the terminal
  add-ons live in the **harness registry** (`GET /addons/registry`,
  `GET /bridge/runtimes`, `GET /terminal-host/status`), while the existing
  left-rail **"Add-ons"** workspace reads `GET /addons/status` (the
  addon-delegation service). Do **not** fold the terminals into the
  `/addons/status` path; read them from the harness registry/projection.
- **Enable transaction:** `POST /addons/enabled` `{ addonId, enabled,
  expectedRevision }` (registry-revision-aware; read `GET /addons/registry`
  immediately before, and fail closed on `ownership-conflict`).
- **Grant transaction:** `POST /addons/grants` `{ addonId, grants, consent:
  true, expectedRevision }` with `grants = [{ capability: "terminal-host",
  granted: true, scope: "system", revocationBehavior: "degrade" }]`. Consent is
  operator-consented; never auto-grant.
- **Launch:** `POST /terminal-host/launch` `{ agentId, terminalAddonId,
  promptPath }` (gated on `ready` + a valid 0600 prompt file; typed rejections
  `bridge-not-running`, `capability-not-granted`, `policy-not-reviewed`,
  `executable-unavailable`, `launch-failed`).
- **Connection script:** `POST /terminal-host/connection-script`
  `{ terminalAddonId }` — non-secret, 0600 token-file-only.
- **Badge vocabulary:** `Connected` / `Disconnected` / `Not installed`, from
  `GET /terminal-host/status` surfaces (`{ adapterId, label, compatible,
  connected }`).

## 5. Required CP-BR11 behavior

### 5.1 Add a "Terminals" workspace to the left rail

- Add `"terminals"` to `allowedWorkspaces` in `main-workspace.js`.
- Add a rail button in `main-workspace.html` (`data-workspace="terminals"`),
  ideally in the "Tools" `<section class="rail-section">` next to Hermes /
  OpenCode, with a terminal icon and the label "Terminals".
- Wire the new button into the existing `workspaceButtons` / `setActiveWorkspace`
  click handling (follow how `addons` / `memory` / `hermes` are wired — do not
  invent a second switching mechanism).
- Add a `renderTerminalsWorkspace` branch in `renderMessages()` that renders
  the terminal workspace into the `transcript` container.

### 5.2 Render the terminal cards/tabs from the host

Render one card per reviewed terminal add-on (Ghostty + iTerm2), driven by the
host, each showing:

1. the **badge** (`Connected` / `Disconnected` / `Not installed`) from
   `GET /terminal-host/status`;
2. an **Enable** / **Disable** action (`POST /addons/enabled`), visible even
   when the add-on is `inactive` (this is what the current Settings surface is
   missing);
3. a **Grant terminal-host** action when the capability is missing
   (`POST /addons/grants`, operator-consented);
4. a **Launch** action (`POST /terminal-host/launch`), gated on `ready` + a
   valid 0600 prompt file;
5. a **Copy connection script** action (`POST /terminal-host/connection-script`).

Reuse `addon-tools-section.js` (or extract its view-model) rather than
re-implementing the tab/badge/copy logic. If `addon-tools-section.js` is too
Settings-coupled, extract a shared `renderTerminalCards` helper that both the
Settings section and the new rail workspace use — do **not** fork a second copy
of the renderer.

### 5.3 Enable → grant → ready on the rail

The flow from the rail must be: see Ghostty/iTerm2 as `inactive` → **Enable** →
**Grant terminal-host** → status transitions to `ready` → **Launch**. Reuse the
existing `enableTransaction` / grant seams; do not invent a new authority path
and do not auto-grant. The registry-revision-aware transaction (read registry,
then post with `expectedRevision`) must be preserved.

### 5.4 No secret in the DOM

The rail workspace renders text-only (no innerHTML, no script injection), and
every string passes the shape-walker / `assertNoSecretShapedValue` invariant
(no token, credential, path, argv, env value, prompt, or memory content).

## 6. Implementation requirements

- The new renderer lives in
  `browser-first/resonantos-side-panel-extension/src/lib/` (e.g. a new
  `main-workspace-terminals.js` or a shared `terminal-cards.js`), not in
  `bridge-server.mjs`.
- Host seams are derived from the existing `bridgeRequest` callback in
  `main-workspace.js` (as `renderSettingsWorkspace` already does); add no new
  global state and no local toggling.
- Do not rebuild `terminal-addon-seed.mjs`, the reconciler, the projection, the
  factories, `createTerminalHostService`, or the `/terminal-host/*` host routes.
- Keep `addon-tools-section.js` working (Settings path) unless you extract a
  shared helper, in which case both call sites must pass their existing tests.

## 7. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, path, cwd,
   endpoint, or environment.
2. Factories own their spawn policy.
3. No `process.env` spread into a spawned adapter.
4. `closeSessions` closes ROS-owned sessions; zero leaked windows.
5. Lifecycle events, projection, and the connection script stay non-secret.
6. Classification is not lifecycle authority.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR10
   behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests (injected fake host data; no real process). At minimum
prove:

1. the "Terminals" workspace is in `allowedWorkspaces` and a rail button with
   `data-workspace="terminals"` exists and switches to it;
2. the workspace renders one card per terminal add-on with the correct badge
   for each of the three badge states;
3. the Enable action posts `POST /addons/enabled` with the registry-revision
   (`expectedRevision`) read immediately before;
4. the Grant action posts `POST /addons/grants` with `terminal-host` granted and
   `consent: true`, and never auto-grants;
5. Launch is gated on `ready` + a valid 0600 prompt file, and branches on the
   documented rejections;
6. Copy connection script renders the host-minted script as text only and copies
   it with a manual-select fallback;
7. the rail workspace reads from the harness registry / projection, not
   `GET /addons/status`;
8. the rendered DOM contains no secret-shaped value (shape-walker /
   `assertNoSecretShapedValue`);
9. existing terminal-host, projection, reconciler, bootstrap, addon-tools,
   bridge-runtimes, and main-workspace tests remain green.

## 9. Documentation

Update:

- `docs/product/TERMINAL-ACTIVATION.md` — the rail path (Terminals → Enable →
  Grant → Launch);
- `docs/architecture/MODULE-OWNERSHIP.md` — the new rail renderer row;
- `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` — mark the
  "Add-on Surfaces → Terminal" product outcome as wired, and add a CP-BR11
  note; keep the Alpha boundary and ADR-047 consistent.

## 10. Verification

Always use Node 24.21.0. Run targeted suites first, then the regression.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test --test-force-exit \
  browser-first/test/bridge-runtimes-section.test.mjs \
  browser-first/test/addon-tools-section.test.mjs \
  browser-first/test/terminal-host-connection-script.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs \
  browser-first/test/terminal-runtime-factories.test.mjs \
  browser-first/test/terminal-lifecycle-reconciler-wiring.test.mjs \
  browser-first/test/terminal-projection-badges.test.mjs \
  browser-first/test/main-workspace-settings.test.mjs \
  browser-first/test/alpha-browser-extension-scope.test.mjs \
  browser-first/test/bridge-route-capability-audit.test.mjs \
  <new CP-BR11 terminals-workspace test files> \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR11 terminals-workspace test files>` with exact paths; do not
leave a placeholder in the command you execute.

Report counts by label (`core`, `demo`, `browser-first`, `ownership/docs`). Do
not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR11 work in small checkpoint commits.
- Do not push. Do not rewrite history, merge, or rebase.
- Do not commit unrelated files or add dependencies.
- Do not weaken tests.

Suggested commit sequence:

1. `feat(ui): add a Terminals workspace to the main-workspace left rail`
2. `feat(ui): render terminal cards with enable/grant/launch/copy on the rail`
3. `test(ui): cover the Terminals workspace states and transactions`
4. `docs(ui): document the Terminals rail surface`

## 12. CP-BR11 gate

CP-BR11 is green only when:

- a "Terminals" workspace appears on the left rail and switches correctly;
- it renders Ghostty + iTerm2 with correct badge states, driven by the harness
  registry/projection (not `/addons/status`);
- Enable → Grant `terminal-host` → `ready` → Launch works entirely from the rail
  with no manual bridge command and no auto-grant;
- the copy-connection-script fallback is available from the rail;
- the rendered DOM contains no secret-shaped value;
- existing CP-BR1…CP-BR10, terminal-host, projection, and non-leak tests remain
  green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** the Terminals workspace, its renderer, and the
   enable/grant/launch/copy wiring.
3. **Files and commits:** exact files changed and commit hashes.
4. **Non-leak evidence:** how the shape-walker confirms no secret in the rail
   DOM or the copied script.
5. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`,
   `ownership/docs`.
6. **Docs check:** exact issue count and delta from baseline.
7. **Remaining risks/blockers:** anything requiring a real terminal/credential/
   human, or deferred to packaging (§15).
8. Explicit `STOP — CP-BR11`.
