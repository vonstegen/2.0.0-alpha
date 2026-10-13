# OMP BUILD — Terminal Add-ons Live In The ROS Extension — CP-BR9

Paste this entire prompt into a new OMP harness session.

---

You are implementing **CP-BR9** of the ResonantOS **ROS Bridge + SDK Add-on
Runtime Lifecycle** program. Read this prompt and the listed source-of-truth
files before editing anything. Do not rely on prior chat history.

## 0. Mission

CP-BR7 registered reviewed Ghostty and iTerm2 **runtime factories** and wired
the CP-BR4 reconciler, but it never installed the two terminal **add-ons** into
the host registry. CP-BR8 proved the lifecycle with smokes, not through the
extension. CP-BR9 closes that gap: make Ghostty and iTerm2 appear as real,
enableable/disableable add-ons in the ROS extension and make enable → real
adapter spawn → `Open in Terminal` launch Pi into the live terminal, with no
manual bridge command and no leaked secret.

Concretely:

1. **Install the two terminal add-ons into the host registry** with reviewed
   manifests so they appear in the Bridge & Runtimes projection and the
   reconciler drives them.
2. **Unify the terminal-host service path** so that "enable Ghostty/iTerm2"
   produces a _live_ terminal the `POST /terminal-host/launch` route
   (`Open in Terminal`) actually launches into — no in-memory fallback in the
   default ROS-started bridge.
3. **Prove it end-to-end through the real extension** (or a live-Chrome E2E
   harness where no human/display is available), recording evidence without
   secrets.
4. **Add an "Add-on Tools" settings section** with one sub-tab per reviewed
   terminal (iTerm2 + Ghostty), each offering a **launch** action and a
   **copy/paste connection script** (see §5.6).
5. **STOP AND REPORT** before packaging/release (roadmap §15, which is _not_
   this checkpoint).

This checkpoint closes the CP-BR7/CP-BR8 "remaining risks" items (terminal
add-ons not registered in the host registry; live `terminalHostService` not
wired into the factory closures). It does **not** build the packaging/recovery/
release runbook (§15) — leave that for a later checkpoint unless the operator
explicitly folds it in.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

`HEAD` is expected to be:

```text
783a9009 fix(bootstrap): create the ownership record directory before writing the PID
```

Start by confirming `git status` is clean (two out-of-scope untracked prompt
files may remain; treat them as out-of-scope). Nothing is pushed. Do not rebase
or merge.

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

1. `docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`
   — §13 (CP-BR7), §14 (CP-BR8), §15 (CP-BR9 packaging — do NOT build), §3
   (current baseline), §4.2 (add-on runtime status).
2. `docs/architecture/RUNTIME-FACTORY-REGISTRY-AND-RECONCILER.md`
3. `docs/architecture/BRIDGE-RUNTIME-PROJECTION.md`
4. `docs/architecture/ALPHA_RUNTIME_BOUNDARY.md` and `MODULE-OWNERSHIP.md`
5. `docs/product/TERMINAL-ACTIVATION.md`,
   `docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md`,
   `docs/operations/TERMINAL-PREREQUISITES.md`
6. The factory side (already built — understand, do not rebuild):
   - `browser-first/host/terminal-runtime-factories.mjs`
   - `browser-first/host/runtime-factory-registry.mjs`
   - `browser-first/host/runtime-reconciler.mjs`
   - `browser-first/host/runtime-lifecycle-host.mjs`
7. The host registry + installation side (the gap lives here):
   - `browser-first/host/harness-host-service.mjs` (the `/addons/install`,
     `/addons/enabled`, `/addons/grants`, `/addons/remove`, and
     `/terminal-host/*` routes)
   - `browser-first/host/harness-registry.mjs`
   - `browser-first/host/harness-registry-store.mjs`
   - `browser-first/host/harness-examples/pi.json` and `pi-terminal.json`
     (the manifest shape)
8. The terminal-host service + bridge wiring:
   - `browser-first/host/terminal-host-service.mjs` (SPAWN_PLANS + driver)
   - `browser-first/host/terminal-host-bridge-wiring.mjs`
     (`installTerminalHostBridge`, `RESONANT_TERMINAL_HOST_BRIDGE`)
   - `browser-first/bootstrap/bridge-policy.mjs` (the child-env allowlist that
     sets `RESONANT_TERMINAL_HOST_BRIDGE=1` for the bootstrap-started bridge)
9. The composition root (where registration must be added):
   - `browser-first/host/run-bridge-minimal.mjs`
10. The projection + UI (what must show the add-ons):
    - `browser-first/host/runtime-projection-service.mjs`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js`
    - `src/modules/terminal/OpenInTerminalButton.tsx`
    - `src/modules/terminal/TerminalSurfaceTabs.tsx` (the existing tabbed
      terminal surface + badge source; the new `Add-on Tools` section mirrors
      its badge semantics in the extension settings)
11. The extension settings composition + bridge route capabilities (where the
    new section and route capabilities are added):
    - `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-settings.js`
    - `browser-first/resonantos-side-panel-extension/src/lib/settings/bridge-bootstrap-section.js`
      (the renderer pattern to mirror)
    - `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
      (`BRIDGE_ROUTE_CAPABILITIES` — add the `/terminal-host/*` routes)
12. The bootstrap/attach CLI that the connection script reuses:
    - `browser-first/bin/ros-session.mjs`
    - `browser-first/host/terminal-host-service.mjs` (`mintSessionBootstrapGrant`,
      `composeBootstrapCommand`, `launchBootstrap`)

## 4. Contracts you must accept (do not rebuild)

- **Factory ids (CP-BR7):** `com.resonantos.factory.terminal-host.ghostty` and
  `com.resonantos.factory.terminal-host.iterm2`.
- **Add-on ids:** `addon.resonant-terminal-ghostty` and
  `addon.resonant-terminal-iterm2`.
- **Runtime type:** `local-service`.
- **Capability:** `terminal-host` (grant scope `self`, revocation behavior
  `graceful`). The CP-BR7 prompt named grant presets
  `ghostty-terminal-host` / `iterm2-terminal-host` — verify whether they exist;
  if they do not, define them canonically in exactly one place and do not
  invent a second grant path.
- **Driver selection:** `RESONANT_TERMINAL_DRIVER` ∈ `ghostty` | `iterm2` |
  `in-memory` (owned by `terminal-host-service.mjs`).
- **Desired-state rule (CP-BR3):** `installed AND enabled AND required caps
granted AND compatible AND reviewed factory exists AND no hard-stop`.
- **The reconciler and the projection both read `registry.snapshot().installations`.**
  An add-on that is not installed in the host registry does not exist to
  either of them. This is the root cause of the terminal add-ons being absent
  from the UI.

## 5. Required CP-BR9 behavior

### 5.1 Install the terminal add-ons into the host registry

Add reviewed installation manifests for `addon.resonant-terminal-ghostty` and
`addon.resonant-terminal-iterm2` and install them into the host registry so
they survive a fresh bridge boot. Each manifest must at minimum carry:

- `id`, `name`, `version`, `category` (`local-service`), `sdkVersion`;
- `runtimeType: "local-service"`;
- `requestedCapabilities` / required capability including `terminal-host`
  (not granted by default — authorization is operator-consented);
- a `factoryId` field on the **installation** (not the manifest) pointing at
  the CP-BR7 factory id, OR a reviewed host-owned factory selection for
  `local-service` that deterministically maps each add-on to its driver;
- `surfaces` declaring the terminal workspace surface (see `pi-terminal.json`
  and the `/terminal-host/status` surface walk for the expected shape —
  `embeddedWorkspace.mode === "terminal"`), unless the surface is already
  sourced from elsewhere; verify and match the existing surface contract.

The installation must be seeded through the same registry path the routes use
(`POST /addons/install` semantics), not a parallel in-memory map that diverges
from `registry.snapshot().installations`. Prefer a reviewed host-owned seed
that is idempotent and re-runs on boot.

### 5.2 Enable → live adapter; disable/revoke/remove → stop

With the add-ons installed:

- Enabling Ghostty (or iTerm2) and granting `terminal-host` must start the
  **real** driver adapter (`ghostty` / `iterm2`), not the in-memory driver.
- Disabling, revoking the grant, or removing the add-on must stop the adapter
  and close ROS-owned sessions (preserve the XH4/XH5 zero-leaked-windows
  invariant).
- Switching Ghostty ↔ iTerm2 must stop the old adapter before starting the new
  one (no duplicate ownership).

### 5.3 Unify the terminal-host service path

There are currently **two** terminal-host service instances in play:

1. the per-add-on service the factory creates in `start()` via
   `createTerminalHostService({ env: buildPinnedEnv(...) })`, and
2. the bridge-level `installTerminalHostBridge({ env })` service exposed on
   `globalThis` (only active under `RESONANT_TERMINAL_HOST_BRIDGE=1`), which the
   `POST /terminal-host/launch` route uses for `Open in Terminal`.

Reconcile these so that "enable a terminal add-on" and "Open in Terminal" use
**one** live terminal service with the correct driver, and so the default
ROS-started bridge (which already sets `RESONANT_TERMINAL_HOST_BRIDGE=1` via
`bridge-policy.mjs`) has a live terminal-host service that the launch route can
reach. Do **not** require a manually-started bridge or a manual env flag from
the operator. Document the single owner of the terminal-host service and the
driver selection.

If you find the factory's `createTerminalHostService` default already spawns
the real adapter (because `buildPinnedEnv` pins `RESONANT_TERMINAL_DRIVER`),
make the launch route and the factory share that live instance rather than
maintaining two. Verify with a real smoke, not by reading alone.

### 5.4 Bridge & Runtimes surfaces the add-ons

The Bridge & Runtimes UI must show Ghostty and iTerm2 as `local-service`
runtimes with the correct public lifecycle status (`inactive` / `starting` /
`ready` / `degraded` / `failed` / `stopping`), and the enable/disable action
must route through `POST /addons/enabled` (the existing `enableTransaction`).
No new UI state flag, no local toggling.

### 5.5 Open in Terminal gated on ready

`Open in Terminal` stays gated on `projectionRuntimeStatus === "ready"` (CP-BR7)
and, once the terminal add-on is `ready`, `POST /terminal-host/launch` must
actually compose and launch Pi into the live Ghostty/iTerm2 adapter with the
projected session env (project/skills/memory/credential), without any token or
credential entering argv or logs.

### 5.6 Add-on Tools settings section (iTerm2 + Ghostty)

Add a new extension settings section `Add-on Tools` (`id: "addon-tools"`) with
**one sub-tab per reviewed terminal add-on** — `iTerm2`
(`addon.resonant-terminal-iterm2`) and `Ghostty`
(`addon.resonant-terminal-ghostty`). The tab list must be driven from the host
projection / `/terminal-host/status` surfaces, not hardcoded in the renderer.

Each tab renders:

1. **Status badge** — `Connected` / `Disconnected` / `Not installed`, sourced
   from `GET /terminal-host/status` (add this route to the extension's
   `BRIDGE_ROUTE_CAPABILITIES` as `addon-runtime-read`).
2. **Launch button** — routes through `POST /terminal-host/launch` (add as
   `addon-runtime-control`), gated on the selected terminal being `ready` in
   the projection and on a valid 0600 prompt file (mirror
   `OpenInTerminalButton` semantics: `bridge-not-running` → deep-link Bridge
   Target; `capability-not-granted` → surface an Authorize action).
3. **Copy connection script** — a host-minted shell snippet the operator can
   paste into the already-open terminal to attach it to the ROS bridge, plus a
   `<code>`/`<textarea>` block and a copy-to-clipboard action
   (`navigator.clipboard.writeText`, with a manual-select fallback).

**Connection-script contract (the new piece — design it, do not invent a
second trust path):**

- Add a reviewed host route (e.g. `GET /terminal-host/connection-script`,
  `addon-runtime-read`, loopback-only) that returns the script for the
  requested terminal add-on.
- The script must **never** embed a raw bridge token, credential, private path,
  or env value. Reuse the existing grant flow: the host mints a short-lived,
  single-use, terminal-scoped grant (the same family as
  `mintSessionBootstrapGrant`) and writes the token to a 0600 file; the script
  references the file path (e.g. via the existing `ros-session.mjs attach`
  bootstrap, or a reviewed `ros-bridge connect` CLI if one is introduced), never
  the token value in argv.
- The UI renders the script as text only (textContent — no innerHTML) and the
  shape-walker / `assertNoSecretShapedValue` invariant applies to every string
  the renderer touches.
- If the current architecture is that the **bridge spawns the terminal** (via
  the adapter child process), the "copy/paste script" is the manual-attach
  alternative: it must establish the same reviewed connection the adapter would,
  with the same capability/auth boundary, and must not bypass the reconciler's
  ownership (i.e. pasting the script must not create a second, untracked
  terminal the reconciler cannot stop). Resolve this ownership question in the
  implementation and document the single source of truth.

Keep the section renderer consistent with the existing settings sections
(`bridge-bootstrap-section.js` / `bridge-runtimes-section.js`): pure DOM,
textContent rendering, `aria-live` for status, and host transactions injected
via `sectionContext` in `main-workspace-settings.js` — no new global state, no
local toggling.

## 6. Implementation requirements

### 6.1 Where the code goes

- Manifests + installation seeding live in `browser-first/host/` (composition
  or a small reviewed seed module), not in the extension, not in `bridge-server.mjs`.
- Do not put reconciler/factory wiring in `bridge-server.mjs` (auth/transport).
- Do not rebuild `createTerminalHostService`, the Ghostty/iTerm2 adapters, or
  the CP-BR7 factories.
- Do not let any factory execute a caller-supplied command / argv / cwd / env /
  endpoint / path.

### 6.2 Seams

Keep factories and the launch route testable with an injected fake terminal
service (no real process in unit tests). Preserve the existing
`installTerminalHostBridge` `serviceFactory` seam and the factory's
`serviceFactory` / `terminalHostService` seams. Real-driver behavior is proven
by smoke scripts, not unit tests.

### 6.3 Ownership

Update `MODULE-OWNERSHIP.md` so the terminal add-on manifests, the installation
seed, and the single terminal-host service owner are documented with named
owners and boundaries.

## 7. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, path, cwd,
   endpoint, or environment.
2. Factories own their spawn policy (pinned driver/entry/argv/env allowlist).
3. No `process.env` spread into a spawned adapter.
4. `closeSessions` closes ROS-owned sessions; zero leaked windows.
5. Lifecycle events and projection stay non-secret (no PID/path/argv/env/token/
   credential/prompt/memory).
6. Classification is not lifecycle authority.
7. Preserve bridge authentication, capability minting, and CP-BR1…CP-BR8
   behavior.
8. Do not restore `/bridge/launch` or `bridge_launch` (CP-BR0).

## 8. Test requirements

Add deterministic tests (injected fake services; no real process in unit
tests). At minimum prove:

1. the two terminal add-on manifests install into the host registry and appear
   in `registry.snapshot().installations` across a fresh boot;
2. enabling + granting `terminal-host` for Ghostty transitions it through the
   reconciler to `ready` and calls `factory.start` exactly once;
3. disabling / revoking / removing stops the adapter and closes ROS-owned
   sessions;
4. switching Ghostty → iTerm2 stops the old adapter before starting the new
   one;
5. the Bridge & Runtimes projection surfaces both terminal add-ons with correct
   status and the `POST /addons/enabled` transaction path;
6. `Open in Terminal` is gated on `ready`;
7. the factory never executes a caller-supplied command/argv/env;
8. the single terminal-host service owner is unambiguous (one live instance
   drives both enable and launch), verified by a fixture;
9. the `Add-on Tools` settings section renders one sub-tab per terminal add-on,
   with a status badge sourced from `/terminal-host/status`;
10. the `Add-on Tools` launch button routes through `POST /terminal-host/launch`
    and is gated on the terminal being `ready`;
11. the connection-script route returns a script with **no** raw token,
    credential, private path, or env value (shape-walker enforced); the
    renderer copies it as text only and never injects innerHTML;
12. existing terminal-host, Pi grant/resource, XH4/XH5, reconciler, projection,
    and bootstrap tests remain green.

Add one **live smoke** (in `examples/sdk-demo/terminal-host/`) that, when a real
Ghostty (and iTerm2 if present) is available, drives `RESONANT_TERMINAL_DRIVER`
and asserts the adapter actually spawns and the projection reports `ready`. Do
not fake this with the in-memory driver; if the environment has no real
terminal, record it as not-runnable, never as `Yes`.

## 9. Documentation

Update:

- `TERMINAL-ACTIVATION.md` — reflect that the add-ons are now installed by
  default and enable/grant drives the real adapter;
- `ADDON-BRIDGE-RUNTIME-ROADMAP.md` — mark the CP-BR7/CP-BR8 deferred items
  closed and record CP-BR9 evidence; keep §15 (packaging) as Not started;
- `MODULE-OWNERSHIP.md`, the Alpha boundary, and ADR-047 consistent;
- any install/prereq note about `RESONANT_TERMINAL_HOST_BRIDGE` (now set by the
  bootstrap-started bridge, not a manual operator flag).

## 10. Verification

Always use Node 24.21.0. Run targeted suites first, then the regression.

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

node --experimental-strip-types --test --test-force-exit \
  browser-first/test/bootstrap-protocol.test.mjs \
  browser-first/test/bootstrap-lifecycle.test.mjs \
  browser-first/test/bootstrap-host-main.test.mjs \
  browser-first/test/bootstrap-installer.test.mjs \
  browser-first/test/bootstrap-client.test.mjs \
  browser-first/test/bootstrap-startup.test.mjs \
  browser-first/test/rebind-coordinator.test.mjs \
  browser-first/test/bridge-bootstrap-probe.test.mjs \
  browser-first/test/bridge-runtimes-section.test.mjs \
  browser-first/test/bridge-extension-e2e.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/runtime-reconciler.test.mjs \
  browser-first/test/runtime-projection.test.mjs \
  browser-first/test/runtime-projection-staleness.test.mjs \
  browser-first/test/runtime-projection-shape-walker.test.mjs \
  browser-first/test/runtime-projection-no-io.test.mjs \
  browser-first/test/terminal-runtime-factories.test.mjs \
  browser-first/test/terminal-lifecycle-reconciler-wiring.test.mjs \
  browser-first/test/terminal-projection-badges.test.mjs \
  <new CP-BR9 terminal-add-on install/live test files> \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
node scripts/security-pipeline/run-check.mjs --certify
npm run docs:check
git diff --check
```

Replace `<new CP-BR9 terminal-add-on install/live test files>` with exact paths;
do not leave a placeholder in the command you execute.

Run the live-Chrome E2E harness (`browser-first/test/bridge-extension-e2e.mjs`)
if the harness has Chrome + a display; otherwise record the operator rows as
not-runnable and document the exact walk. Report counts by label (`core`,
`demo`, `browser-first`, `ownership/docs`, smoke). Do not claim a test passed
unless you ran it and saw it pass.

## 11. Editing and Git discipline

- Commit CP-BR9 work in small checkpoint commits.
- Do not push. Do not rewrite history, merge, or rebase.
- Do not commit unrelated files or add dependencies.
- Do not weaken tests.

Suggested commit sequence:

1. `feat(bridge): install reviewed Ghostty and iTerm2 add-ons into the host registry`
2. `feat(bridge): unify the terminal-host service across enable and launch`
3. `feat(ui): add Add-on Tools settings section with terminal launch + connection script`
4. `test(bridge): cover terminal add-on install, lifecycle, and projection surfacing`
5. `test(bridge): live Ghostty/iTerm2 add-on smoke`
6. `docs(bridge): document terminal add-on production connection`

## 12. CP-BR9 gate

CP-BR9 is green only when:

- Ghostty and iTerm2 appear in the Bridge & Runtimes UI as `local-service`
  runtimes and can be enabled/disabled through `POST /addons/enabled`;
- enabling + granting `terminal-host` starts the **real** adapter and the
  projection reports `ready`;
- `Open in Terminal` launches Pi into the live terminal with the projected
  session env, with no token/credential in argv/logs/UI/bus;
- disabling/revoking/removing stops the adapter and closes ROS-owned sessions;
- there is exactly one live terminal-host service owner driving both enable and
  launch (no in-memory fallback in the default ROS-started bridge);
- the `Add-on Tools` settings section renders one sub-tab per terminal add-on
  with a status badge, a gated launch action, and a copy/paste connection script
  that contains no raw token/credential/path/env (shape-walker enforced);
- existing CP-BR1…CP-BR8, terminal-host, and non-leak tests remain green;
- architecture, ownership, and docs agree.

## 13. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Architecture implemented:** installation seeding, terminal-host service
   unification, the end-to-end enable → spawn → launch path, and the
   `Add-on Tools` settings section (launch + connection script).
3. **Files and commits:** exact files changed and commit hashes.
4. **Lifecycle evidence:** enable/grant → real start, disable/revoke/remove →
   stop, switching stops-old-first, Open-in-Terminal → live launch.
5. **Non-leak evidence:** how the shape-walker / hostile-value / smoke checks
   confirm no secret in UI/logs/argv/bus.
6. **Tests:** commands and counts labeled `core`, `demo`, `browser-first`,
   `ownership/docs`, and smoke; call out which live-smoke rows are not-runnable
   and why.
7. **Docs check:** exact issue count and delta from baseline.
8. **Remaining risks/blockers:** anything deferred to packaging (§15) or
   requiring a real terminal/credential/human.
9. Explicit `STOP — CP-BR9`.
