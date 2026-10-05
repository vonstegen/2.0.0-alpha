# Goal
Execute the XH4 prompt end-to-end on the `r-and-d/terminal-host-current-dev` branch:
surface terminals (Ghostty + iTerm2) as a tabbed "Terminal" entry under
**Add-on Surfaces**, with a non-secret connection badge, in four STOP/REPORT
phases. STOP at every CP-XH4 gate and report the verification you ran.

# Constraints (non-negotiable — read prompt §2 first)
- Do NOT add `"terminal"` to `AddOnSurfaceType`. The terminal surface is
  `type: "panel"` + `embeddedWorkspace.mode: "terminal"`.
- Grouping is by shared `sectionId`. Do NOT hard-code ghostty/iterm2 ids.
- Preserve the install + enable + `requiredCapabilities` granted + not-hidden
  gate. Reuse `createAddOnSurfaceDockRoutes`'s existing semantics.
- Connection status derives from the live `terminal-host-service` runtime
  (`alive`, adapter child, driveId), exposed read-only and non-secret.
- No token / credential / path / env value may appear in any surface or
  status payload. Write a shape-walker test that enforces this.
- Host renders textContent only. No HTML/script injection.
- Do NOT merge `feature/pi-testing-phase`. Do NOT push to dev/main/upstream.
  Commit locally; AVIS audits.
- Stay on the existing branch (`r-and-d/terminal-host-current-dev`).
- No token, credential, path, env value in surface or status payloads.

# Existing baseline (do not re-do, build on it)
Branch: `r-and-d/terminal-host-current-dev` (ahead 3, working-tree
modifications already present). Inspect `git diff` before editing.

Working tree already has:
- `examples/sdk-demo/terminal-host/ghostty/addon.json` — `shellNavigation`
  with `sectionId:"terminal"`, `dockIcon:"terminal"`, `eyebrow:"Terminal"`,
  but `requiredCapabilities:["terminal-host"]` MUST be verified/added.
- `examples/sdk-demo/terminal-host/iterm2/addon.json` — same.
- `packages/addon-sdk/src/surface-routing.ts` — exports
  `groupSurfaceDockRoutesBySection` + `AddOnSurfaceDockSection`. Verify the
  helper matches the prompt spec exactly (return shape `{ sectionId, label,
  eyebrow, dockIcon, order, tabs }`).
- `src/sdk/addons/surface-routing.test.ts` — has a `groupSurfaceDockRoutesBySection`
  describe block; verify coverage matches CP-XH4a.
- `examples/sdk-demo/tests/ghostty-manifest.test.ts` — asserts `shellNavigation`
  shape but MUST also assert `requiredCapabilities:["terminal-host"]` per prompt.
- `examples/sdk-demo/tests/iterm2-manifest.test.ts` — same.

If anything in the baseline diverges from the prompt spec, fix it as part of
XH4a and report the divergence.

# Phase XH4a — terminal surface shellNavigation + grouping · CP-XH4a gate
1. Confirm both terminal manifests carry `shellNavigation` with
   `{ sectionId:"terminal", dockIcon:"terminal", eyebrow:"Terminal",
   requiredCapabilities:["terminal-host"] }`.
2. Confirm `groupSurfaceDockRoutesBySection` matches the prompt's contract:
   returns `{ sectionId, label, eyebrow, dockIcon, order, tabs }`, deterministic
   (existing `order` then `label` tiebreak), pure.
3. Extend demo manifest tests:
   - assert `shellNavigation.requiredCapabilities` resolves to granted
     capabilities (i.e. `"terminal-host"` is in the granted set).
   - assert `type:"panel"` + `embeddedWorkspace.mode:"terminal"` is accepted
     by the validator.
4. Add unit tests covering the grouping helper:
   - two routes sharing `"terminal"` → one section with two tabs.
   - single route → one tab.
   - empty input → `[]`.
   - preserve `order`/`label` tiebreak.

`STOP AND REPORT` at CP-XH4a with: files changed, tests added, full
verification log.

# Phase XH4b — catalog registration · CP-XH4b gate
Register `addon.resonant-terminal-ghostty` and `addon.resonant-terminal-iterm2`
in the host manifest catalog so `createAddOnSurfaceDockRoutes` can discover
them (desktop surface's `loadBundledManifests` / `loadSideloadedManifests`,
or the SDK demo catalog — whichever is the reviewable host-owned source).
Preserve `hiddenSurfaceIds` and capability grant flow.

`STOP AND REPORT` at CP-XH4b with: registration location, gate verification,
test log.

# Phase XH4c — non-secret status projection · CP-XH4c gate
1. Extend `createTerminalHostService` to expose a synchronous snapshot:
   `{ alive, driveId, adapterId, sessions: [{ sessionId, status }] }`.
   No tokens, credentials, paths, env values.
2. `harness-host-service.mjs` gains `GET /terminal-host/status`:
   - loopback-only (mirror the attach route transport enforcement).
   - requires `addon-runtime-control` capability.
   - returns `{ connected, driveId, surfaces: [{ adapterId, label, compatible,
     connected }], sessions }`. `connected` derives from `alive` + adapter
     child liveness; each surface's `connected` true only for the active drive.
3. Add a shape-walker test that walks every string field and asserts no
   secret-shaped value (path/token/credential/env-key) leaks.

`STOP AND REPORT` at CP-XH4c with: route file, capability enforcement
evidence, shape-walker output, test log.

# Phase XH4d — tabbed "Terminal" surface rendering · CP-XH4d gate
Render the grouped `"terminal"` section as a tab strip. Reuse the
`browser-tab-strip` / `obsidian-window-tabs` pattern. One tab per terminal
surface; the active tab is the connected surface; each tab shows the
`Connected` / `Disconnected` / `Not installed` badge. Entry appears only
when installed + enabled + authorized and not hidden. Host-owned textContent
rendering only.

`STOP AND REPORT` at CP-XH4d with: render file path, badge mapping source,
test log.

# Verification (run at every gate, report counts by label)
```
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  browser-first/test/harness-host-service.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```
Plus the stub + real Ghostty smoke, and shape-walker asserts on every
status/surface payload. Re-run every gate yourself. Report counts labeled
core / demo / browser-first.

# Commits (suggested — only commit locally; do NOT push)
1. `feat(terminal-host): add terminal surface shellNavigation + section grouping`
2. `test(terminal-host): cover terminal surface validation + grouping`
3. `feat(terminal-host): register terminal add-ons in the host manifest catalog`
4. `feat(terminal-host): expose non-secret terminal-host status route`
5. `feat(terminal-host): render tabbed Terminal surface with connection badge`
6. `docs(terminal-host): capture XH4 surface-tabs prompt` (include the
   prompt file from `2.0.0-alpha/prompts/TERMINAL-HOST-XH4-SURFACE-TABS-PROMPT.md`).

# Hard bans
- Do NOT push. Do NOT open a PR. Do NOT merge.
- Do NOT change `AddOnSurfaceType` to add `"terminal"`.
- Do NOT hard-code `ghostty` / `iterm2` ids in shared rendering code.
- Do NOT embed HTML/scripts; textContent only.
- Do NOT include credentials/tokens/paths/env values in any surface or
  status payload.

# Acceptance
Each phase gate passes its CP-XH4{N} assertion, full verification suite is
green, and you explicitly call out the stop at every gate with the
verification evidence you ran. On XH4d completion, pause for the
"Open in Terminal" launch-action prompt.