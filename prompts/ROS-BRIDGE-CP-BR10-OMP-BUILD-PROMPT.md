# OMP BUILD — Add-on Tools Settings Section (iTerm2 + Ghostty) — CP-BR10

Paste this entire prompt into a new OMP harness session.

---

You are implementing **CP-BR10** of the ResonantOS **ROS Bridge + SDK Add-on
Runtime Lifecycle** program: the **Add-on Tools** extension settings section.
Read this prompt and the listed source-of-truth files before editing anything.
Do not rely on prior chat history.

## 0. Mission

Add a new **Add-on Tools** section to the ROS Chrome side-panel extension
(`browser-first/resonantos-side-panel-extension`) with one sub-tab per reviewed
terminal add-on — **iTerm2** and **Ghostty** — where each tab lets the operator:

1. see the terminal's connection state (Connected / Disconnected / Not
   installed);
2. **launch** the terminal from the extension — the terminal **auto-connects**
   through the ROS bridge, and the **TUI harness** running inside that terminal
   (Pi, Grok-Build, etc.) receives the resources it needs (project / skills /
   memory / credential) from the ROS extension, no manual step required;
3. **copy a re-attach script** to paste into a terminal that is already running
   but not connected (e.g. the operator started the harness before the bridge,
   or the bridge was stopped when the terminal launched) — the pasted script
   establishes the terminal↔bridge connection and delivers the same
   **TUI-harness resources** to the harness running in that terminal.

This is a UI + small host-route checkpoint only. It depends on CP-BR9
(terminal add-ons installed into the host registry + the live terminal-host
service unified). Do **not** re-do CP-BR9's registry seeding or service
unification. If the host side is not yet present, build the UI defensively
(render the correct empty / not-installed / disconnected states and keep the
actions disabled until the host data arrives) and call it out in the report.

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
783a9009 fix(bootstrap): create the ownership record directory before writing the PID
```

CP-BR9 is in flight and may have added commits. Confirm `git status` is clean
and `git log` before starting; nothing is pushed. Do not rebase or merge.

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

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` — §13 (CP-BR7), §14
   (CP-BR8), and the "Tabbed Terminal add-on surfaces" baseline in §3.
2. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md` and `MODULE-OWNERSHIP.md`.
3. `docs/product/TERMINAL-ACTIVATION.md`,
   `docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md`.
4. The extension settings composition (where the new section is registered):
   - `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-settings.js`
5. The renderer pattern to mirror (plain DOM, textContent, `aria-live`, injected
   host seams):
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-bootstrap-section.js`
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`
   - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js`
6. The bridge route capability map (add the `/terminal-host/*` routes):
   - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
7. The existing terminal surface + launch semantics to mirror:
   - `src/modules/terminal/TerminalSurfaceTabs.tsx` (badge states + tab source)
   - `src/modules/terminal/OpenInTerminalButton.tsx` (launch gate + rejections)
8. The terminal-host routes and the bootstrap/attach CLI the connection script
   reuses:
   - `browser-first/host/harness-host-service.mjs` (`/terminal-host/status`,
     `/terminal-host/launch`, `/terminal-host/prompt-path`)
   - `browser-first/host/terminal-host-service.mjs`
     (`mintSessionBootstrapGrant`, `composeBootstrapCommand`, `launchBootstrap`)
   - `browser-first/bin/ros-session.mjs`

## 4. Contracts you must accept (do not rebuild)

- **Terminal add-on ids:** `addon.resonant-terminal-iterm2`,
  `addon.resonant-terminal-ghostty`.
- **Factory ids (CP-BR7):** `com.resonantos.factory.terminal-host.iterm2`,
  `com.resonantos.factory.terminal-host.ghostty`.
- **Capability:** `terminal-host`.
- **Badge vocabulary (CP-XH4d):** `Connected` | `Disconnected` |
  `Not installed`, sourced from `GET /terminal-host/status` surfaces
  (`{ adapterId, label, compatible, connected }`).
- **Launch rejections (CP-XH5a, documented + stable):** `bridge-not-running`,
  `capability-not-granted`, `policy-not-reviewed`, `executable-unavailable`,
  `launch-failed`.
- **The UI never hard-codes the terminal ids in the renderer** — the tab list
  flows from the host data (`/terminal-host/status` surfaces / the projection),
  as `TerminalSurfaceTabs` already does.
- **Non-leak boundary:** every string the renderer touches passes the
  shape-walker / `assertNoSecretShapedValue` invariant (no token, credential,
  path, argv, env value, prompt, or memory content).
- **Terminal vs. TUI harness (resource-model distinction):** two resource
  tiers. The **terminal/adapter** (Ghostty / iTerm2) needs only a minimal,
  host-pinned connection env — the driver selector (`RESONANT_TERMINAL_DRIVER`),
  `PATH` and `HOME` (already allowlisted in `ADAPTER_ENV_ALLOWLIST` /
  `buildPinnedEnv`), and the loopback bridge endpoint + terminal-host grant used
  to attach. It does **not** consume project/skills/memory/credential. The
  **TUI harness** running _inside_ the terminal (Pi, Grok-Build, etc.) is the
  consumer of the projected **TUI-harness resources** — project root/cwd, skills
  root, memory root, and the provider credential under a host-owned env var
  (`PROJECTED_SESSION_ENV_NAMES` / `buildProjectedSessionEnv`). Model the
  terminal as transport + a small pinned connection env, never as the consumer
  of the harness resources.

## 5. Required CP-BR10 behavior

### 5.1 Register the Add-on Tools section

Add a new settings section with `id: "addon-tools"`, `label: "Add-on Tools"`,
a sensible `hint`, placed in the `Work` group next to `Add-ons`, and a
`render` function (`renderAddonToolsSection`) in
`browser-first/resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js`.
Follow the `bridge-bootstrap-section.js` / `bridge-runtimes-section.js` pattern:
plain DOM, `textContent` only, no innerHTML, `aria-live="polite"` for status.

### 5.2 Sub-tabs driven by the host

Render one sub-tab per reviewed terminal add-on from the host data (iTerm2 +
Ghostty), with the badge label from `/terminal-host/status` surfaces. When the
host reports no surfaces, render the not-installed state for each known id (the
ids may be enumerated in a small closed allowlist, but the _surface_ data —
labels, compatibility, connection — must come from the host).

### 5.3 Launch action — auto-connect (primary path)

Each tab's launch button calls `POST /terminal-host/launch`
(`terminalAddonId` = the tab's add-on id). On success the terminal is launched
and **auto-connects** through the bridge: the **TUI harness** running inside
that terminal receives the resources it needs (project / skills / memory /
credential) via the existing `ros-session attach` / projected-session-env path —
the operator does not paste anything. Gate the button on:

- the selected terminal runtime being `ready` in the projection (CP-BR7), and
- a valid 0600 prompt file (mirror `OpenInTerminalButton`: no prompt → disabled
  with "Write a prompt first.").

Branch on the documented rejections exactly as `OpenInTerminalButton` does:
`bridge-not-running` → deep-link Settings → Bridge Target;
`capability-not-granted` → surface an Authorize action (do not auto-grant).

Add `GET /terminal-host/status` (`addon-runtime-read`), `POST /terminal-host/launch`
(`addon-runtime-control`), and `GET /terminal-host/prompt-path`
(`addon-runtime-read`) to `BRIDGE_ROUTE_CAPABILITIES` in `bridge-client.js`.
Keep the capability strings byte-identical to the route definitions in
`harness-host-service.mjs`; the route-capability audit fails closed on drift.

### 5.4 Copy re-attach script (fallback for an already-running terminal)

Add a **reviewed** host route (e.g. `GET /terminal-host/connection-script`,
loopback-only, `addon-runtime-read`) that returns a shell snippet for the
requested terminal add-on. This is the **fallback** path for when the operator
started the terminal harness _before_ the ROS bridge was running (the bridge was
stopped, or the terminal launched before ROS), so it never auto-connected. The
operator pastes the script into that already-running terminal to **re-attach it
through the bridge and deliver the same TUI-harness resources** (project /
skills / memory / credential) to the harness running in that terminal — the
same resources the auto-connect path (§5.3) delivers. The UI renders the
script in a `<code>`/`<textarea>` block (textContent only) with a
copy-to-clipboard action (`navigator.clipboard.writeText`, plus a manual-select
fallback when the clipboard API is unavailable).

**Script contract (the new piece — design it against the existing machinery,
do not invent a second trust path):**

- Reuse `composeBootstrapCommand` / `ros-session.mjs attach` and the
  `mintSessionBootstrapGrant` family so the pasted script delivers the same
  projected session env (project root, skills root, memory root, credential
  under a host-owned env-var name) as the auto-connect launch. The script must
  reference a 0600 token file by path; it must **never** put a raw bridge
  token, credential, private path, or env value into the script text or argv.
- The route must mint or reuse a short-lived, single-use, terminal-scoped grant
  (not a long-lived bridge token) and return only the composed, non-secret
  command plus any documented, non-secret metadata (e.g. the 0600 file path).
- The script must be safe to run **only against the operator's own
  already-running terminal** and must not require the bridge to have spawned
  that terminal in the first place; it is the manual equivalent of the
  auto-connect attach, not a bypass of the grant/capability boundary.
- Resolve the **ownership** question explicitly: a terminal re-attached via the
  pasted script must still be trackable/terminable by the host so `disable` /
  `revoke` / `remove` can close it (preserve the zero-leaked-windows
  invariant). If the reviewed design cannot guarantee that, document the
  limitation and keep the script gated behind the same `terminal-host` grant and
  `ready` state as the launch button.
- The renderer copies the script as text only; it never evaluates it, never
  injects it as HTML, and never writes it to a file or the bridge.

### 5.5 No secret in the DOM

The rendered section (including the copied script) must contain no
token/credential/path/argv/env/prompt/memory-shaped substring. Add a test that
asserts this for both the status payload and the connection-script payload.

## 6. Implementation requirements

- New renderer: `.../src/lib/settings/addon-tools-section.js`.
- Register it in `main-workspace-settings.js` and inject the host seams via
  `sectionContext` (fetch status, launch, connection script) exactly like the
  existing `bridge-runtimes` injection — derive everything from the existing
  `bridgeRequest` callback; add no new global state and no local toggling.
- Add the three `/terminal-host/*` route capabilities to `bridge-client.js`.
- Host route(s) live in `harness-host-service.mjs` (or a small reviewed
  terminal-host host module), never in `bridge-server.mjs`.
- Do not rebuild `createTerminalHostService`, the adapters, the CP-BR7
  factories, or `OpenInTerminalButton`.

## 7. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, path, cwd,
   endpoint, or environment.
2. Factories own their spawn policy (pinned driver/entry/argv/env allowlist).
3. No `process.env` spread into a spawned adapter.
4. `closeSessions` closes ROS-owned sessions; zero leaked windows.
5. Lifecycle events, projection, and the connection script stay non-secret (no
   PID/path/argv/env/token/credential/prompt/memory).
6. Classification is not lifecycle authority.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR9
   behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests (injected fake host data; no real process). At minimum
prove:

1. the section renders one sub-tab per terminal add-on from host data, with the
   correct badge label for each of the three badge states;
2. the launch button is disabled unless the terminal runtime is `ready` and a
   0600 prompt file exists;
3. the launch button routes through `POST /terminal-host/launch` and branches
   on `bridge-not-running` and `capability-not-granted` as specified;
4. the connection-script route returns a composed script that contains no raw
   token/credential/path/env (shape-walker / `assertNoSecretShapedValue`
   enforced) and references the 0600 token file by path;
5. the renderer renders the script as text only (no innerHTML / script /
   event-handler attributes) and copies via the clipboard API with a fallback;
6. the three `/terminal-host/*` route capabilities are declared in
   `bridge-client.js` and match the host route definitions byte-for-byte;
7. existing terminal-host, projection, reconciler, bootstrap, and
   bridge-runtimes tests remain green.

## 9. Documentation

Update:

- `TERMINAL-ACTIVATION.md` — document the Add-on Tools section (launch + copy
  connection script) and the manual-attach ownership note;
- `MODULE-OWNERSHIP.md` — add the new section + connection-script route owner;
- the roadmap §13/§14 as needed to note the Add-on Tools surface; keep the
  Alpha boundary and ADR-047 consistent.

## 10. Verification

Always use Node 24.21.0. Run targeted suites first, then the regression.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test --test-force-exit \
  browser-first/test/bridge-runtimes-section.test.mjs \
  browser-first/test/bridge-extension-e2e.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs \
  browser-first/test/terminal-runtime-factories.test.mjs \
  browser-first/test/terminal-lifecycle-reconciler-wiring.test.mjs \
  browser-first/test/terminal-projection-badges.test.mjs \
  <new CP-BR10 addon-tools test files> \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR10 addon-tools test files>` with exact paths; do not leave a
placeholder in the command you execute.

Report counts by label (`core`, `demo`, `browser-first`, `ownership/docs`). Do
not claim a test passed unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR10 work in small checkpoint commits.
- Do not push. Do not rewrite history, merge, or rebase.
- Do not commit unrelated files or add dependencies.
- Do not weaken tests.

Suggested commit sequence:

1. `feat(ui): add Add-on Tools settings section with terminal sub-tabs`
2. `feat(ui): wire terminal launch + copy connection script into Add-on Tools`
3. `feat(bridge): add /terminal-host/connection-script host route`
4. `test(ui): cover Add-on Tools states, launch gate, and non-leak script`
5. `docs(ui): document the Add-on Tools section`

## 12. CP-BR10 gate

CP-BR10 is green only when:

- the Add-on Tools section renders one sub-tab per terminal add-on from host
  data, with correct badge states;
- the launch button routes through `POST /terminal-host/launch` and is gated on
  `ready` + a valid 0600 prompt file, with the documented rejection branches;
- the copy connection script is host-minted, contains no raw secret, and the
  renderer renders it as text only;
- the `/terminal-host/*` route capabilities are declared and match the host;
- existing terminal-host, projection, reconciler, bootstrap, and
  bridge-runtimes tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** the Add-on Tools section, the launch wiring,
   and the connection-script route + renderer.
3. **Files and commits:** exact files changed and commit hashes.
4. **Non-leak evidence:** how the shape-walker / `assertNoSecretShapedValue`
   checks confirm no secret in the DOM or the copied script.
5. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`,
   `ownership/docs`.
6. **Docs check:** exact issue count and delta from baseline.
7. **Remaining risks/blockers:** anything depending on CP-BR9 landing, or
   requiring a real terminal/credential/human.
8. Explicit `STOP — CP-BR10`.
