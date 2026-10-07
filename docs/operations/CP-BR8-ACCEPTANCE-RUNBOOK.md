# CP-BR8 — Operator Acceptance Runbook

> Status: **CP-BR8 (recorded on `r-and-d/terminal-host-current-dev`)**.
> Phase: Phase 8 — End-to-end acceptance.
> Source of truth: the 15-row operator checklist in
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md` §14](../architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md),
> the smokes in
> [`examples/sdk-demo/terminal-host/cp-br8-stub-smoke.mjs`](../../examples/sdk-demo/terminal-host/cp-br8-stub-smoke.mjs)
> and
> [`examples/sdk-demo/terminal-host/cp-br8-real-ghostty-smoke.mjs`](../../examples/sdk-demo/terminal-host/cp-br8-real-ghostty-smoke.mjs),
> and the CP-BR1…CP-BR7 architecture documents.

CP-BR8 is the **acceptance** phase. The agent runs every green test, every
fixture, and every smoke; the human runs the rows that require a real Pi
binary, a real provider credential, and the Chrome extension open on a
profile where the operator can click `Open in Terminal`. This runbook
is the operator-side companion.

## Pre-flight (operator)

1. **Node version**: `node --version` must print `v24.21.0`. If not,
   `nvm use` from the repository root.
2. **Bridge start**: open a terminal, `cd` to the repo, and run
   `npm run browser-first:bridge`. The bridge writes
   `browser-first/resonantos-side-panel-extension/src/bridge-config.generated.js`
   (local-only; do not commit).
3. **Extension load**: open Chrome at
   `chrome://extensions`, enable Developer Mode, choose **Load unpacked**,
   and select `browser-first/resonantos-side-panel-extension/`. Pin the
   side panel for fast access.
4. **Bridge & Runtimes open**: open the extension, go to **Settings →
   Bridge & Runtimes**. Confirm the bridge card reads **"Core bridge
   Connected"** with the loopback endpoint.

## The 15-row operator checklist

| # | Proof | Steps | Pass criterion |
|---|-------|-------|----------------|
| 1 | ROS starts bridge automatically | (CP-BR1) After installing the bootstrap host via `node browser-first/bootstrap/install-macos.mjs`, the bridge appears in **Bridge & Runtimes** without the operator typing `npm run browser-first:bridge`. | Bridge card reads `Connected`. |
| 2 | Bridge & Runtimes shows `Connected` | Open **Settings → Bridge & Runtimes**. | Top card reads "Core bridge Connected" (Status badge `Live`). |
| 3 | Ghostty appears under Terminal add-on surfaces | Open **Add-on Surfaces → Terminal**. | The terminal list shows a Ghostty row with status `Not installed` (or `Disabled` if previously installed). |
| 4 | Enabling Ghostty requests `terminal-host` grant | Click **Install & enable** for Ghostty. | A grant dialog appears requesting the `terminal-host` capability; the operator approves. |
| 5 | Ghostty transitions `Starting → Connected` | After grant approval, watch the row. | Within ~2s, the row transitions `Disabled → Starting → Active`. |
| 6 | Pi shows `Open in Terminal` | Select Pi as the active harness; open a conversation; the **Open in Terminal** card on the Pi agent panel. | The button is enabled (tooltip "Open in Terminal"). |
| 7 | Pi opens in Ghostty | Click **Open in Terminal**. | A new Ghostty window opens with the attach command and the prompt file mounted at `0600`. |
| 8 | Pi receives ROS project | Inside the Ghostty session, run `echo $RESONANT_PROJECT_ROOT`. | The output is the absolute path to the active ROS project (e.g. `/Users/<operator>/ResonantOS_User/Projects/...`). |
| 9 | Pi receives ROS skills | Inside the Ghostty session, run `ls $RESONANT_SKILLS_ROOT`. | The output lists the projected skill directories. |
| 10 | Pi receives ROS memory context | Inside the Ghostty session, run `ls $RESONANT_MEMORY_ROOT`. | The output lists the projected memory directories. |
| 11 | Pi can use approved provider credential | Inside the Ghostty session, run a Pi command that requires the provider credential (e.g. a model call). | Pi returns a model response; no manual credential entry required. |
| 12 | No token/credential appears in UI/logs/argv/bus | Open Chrome DevTools → Network → filter `bridge/runtimes`. View the JSON payload. Open the bridge terminal and `grep -E 'token\|secret\|credential\|password' ~/.ros/bridge.log`. | The UI payload and the log contain only public identifiers; no token, credential, password, secret, or absolute private path. |
| 13 | Disable closes ROS-owned terminal windows | Back in **Settings → Add-ons → Ghostty**, click **Disable**. | The Ghostty window with the Pi session closes within ~2s. |
| 14 | Bridge/runtime UI updates after disable | Watch the **Bridge & Runtimes** panel. | The Ghostty row transitions `Active → Disabled`. |
| 15 | ROS restart restores enabled runtimes once | Stop the bridge (Ctrl-C) and restart it. | On restart, the **Ghostty row** transitions `Disabled → Starting → Active` exactly once (not repeatedly). |

## Automated checks (agent runs)

The agent runs the following on every CP-BR8 commit; counts are recorded
in the final report. None of these require a human at the keyboard.

```sh
# TypeScript type-check
npx tsc --noEmit

# Vitest: core + demo
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts

# Node test runner: CP-BR1…CP-BR8 targeted suites
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
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs

# Module ownership contract
node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs

# Security pipeline
node scripts/security-pipeline/run-check.mjs --certify

# Documentation contract
npm run docs:check

# Clean working tree
git diff --check
```

## Smokes (agent runs)

```sh
# CP-BR8 stub-terminal smoke (in-memory; never spawns a real terminal)
node --experimental-strip-types \
  examples/sdk-demo/terminal-host/cp-br8-stub-smoke.mjs

# CP-BR8 real-Ghostty smoke (requires /Applications/Ghostty.app)
node --experimental-strip-types \
  examples/sdk-demo/terminal-host/cp-br8-real-ghostty-smoke.mjs
```

The stub smoke proves that:

- the terminal-host service composes without spawning a real adapter;
- the `terminal.*` event envelopes validate and round-trip;
- the CP-BR4 reconciler + CP-BR7 Ghostty factory start the runtime;
- the CP-BR5 projection surfaces the Ghostty runtime as `ready`;
- the projection contains no token / credential / path / PID / env value;
- the factory object exposes only `spawnPolicy` + the five CP-BR4
  functions (plus the underscored test seams `__driver`, `__perAddon`);
- `closeSessions` preserves the no-confirm Ghostty teardown.

The real-Ghostty smoke proves the same plus:

- `installTerminalHostBridge({ env })` with `RESONANT_TERMINAL_HOST_BRIDGE=1`
  + `RESONANT_TERMINAL_DRIVER=ghostty` actually spawns the Ghostty adapter;
- the bridge's `started` handle carries `driveId === "ghostty"` and a
  populated `adapterId`;
- `uninstallTerminalHostBridge` cleans up the bridge global state
  cleanly;
- a `stop` reconcile transitions Ghostty from `Active → Disabled` with
  `publicFailureCode: "addon-disabled"` and emits the `adapter_exit`
  event.

## Environment variables

| Variable | Default | Purpose | Notes |
|----------|---------|---------|-------|
| `RESONANT_TERMINAL_DRIVER` | `in-memory` in production, `ghostty` / `iterm2` when the bridge flag is on | Selects the terminal-host driver | Pinned per factory id in the CP-BR7 factories; not inherited from ambient `process.env` |
| `RESONANT_TERMINAL_HOST_BRIDGE` | unset (production) | Opt-in flag for the bridge service | `1` enables the bridge service (use for dev + tests) |
| `PATH` | inherited from operator shell | Required for runtime resolution | The factory passes `PATH` + `HOME` only — no other env keys cross into the child |
| `HOME` | inherited from operator shell | iTerm2 Python API | Same as above |
| `RESONANTOS_BROWSER_FIRST_USER_ROOT` | `~/ResonantOS_User` | User state root | Provider credentials stay in bridge process memory; the factory never reads this |

## Failure recovery

If the operator row fails, the runbook records the failure in the
final CP-BR8 report with the row number, the observed behavior, and the
`publicFailureCode` from the projection. The factory's revival
test (`runtime-reconciler.test.mjs`) covers the bridge-restart-restore
loop. The non-leak guarantee is enforced by the shape-walker
(`runtime-projection-shape-walker.test.mjs`); if a leak is observed,
that test fails closed before any operator run is needed.

## What you should never do

- **Do not start the bridge manually** after the bootstrap host is
  installed — that defeats CP-BR1's purpose and breaks row 1.
- **Do not pre-populate a provider credential** outside of **Settings →
  Providers** — the bridge reads it from session memory, never from the
  filesystem.
- **Do not open `bridge-config.generated.js`** and paste its contents
  anywhere; it holds the bridge token and capability-bootstrap token in
  `0600` mode and is intentionally machine-local.
- **Do not run a smoke against a real Ghostty install from a CI worker
  that does not have one** — the smoke exits with code 2 (skip) if
  `/Applications/Ghostty.app` is absent.
- **Do not interpret a single `Failed` row as a regression** — CP-BR8 is
  the acceptance phase; the architecture is owned by CP-BR1…CP-BR7, and
  the smokes guard against architecture regressions, not operator
  mis-configuration.