# ROS Bridge — Extension SW Keepalive + Recovery Fix (Build Prompt)

## Objective

Fix the "works for a minute and then dies / Bridge offline" failure in the ResonantOS
browser extension. The bridge **process** is stable (already verified); the failure is the
MV3 service worker being idle-killed, which makes the extension UI report "Bridge offline"
even though the bridge is still up. Do the keepalive + recovery work here; do not touch the
bridge's enable/grant/launch logic.

## Context (verified — do not re-derive)

- Repo: `/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha`
- Branch: `r-and-d/terminal-host-current-dev` (HEAD `a965e094`). The working tree already has
  uncommitted terminal-host work — leave it intact and do not revert it.
- Node: `/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node`
- Extension: `browser-first/resonantos-side-panel-extension/` (MV3, service worker
  `src/background.js`)
- Bridge: `browser-first/host/run-bridge-minimal.mjs`, spawned detached by
  `browser-first/bootstrap/native-host-main.mjs`

### Root cause (verified)

1. The MV3 service worker has **no keepalive**:
   - `manifest.json` has no `alarms` and no `offscreen` permission.
   - `src/lib/bootstrap-renderer.js` pauses its 1s poll when
     `document.visibilityState === "hidden"`.
   - `src/lib/bootstrap-client.js` opens a fresh `connectNative` port per request and
     disconnects it immediately after (`finish()` → `port.disconnect()`).
   - `src/background.js` has no `chrome.runtime.onSuspend` handler and no `chrome.alarms`.
2. `bootstrap:get-status` (in `src/background.js`) answers with the in-memory snapshot
   immediately while the fire-and-forget `void bootstrapStartup.boot()` is still resolving,
   so the first answer after a SW restart is "offline" even when the bridge is healthy.
3. (Separate, OUT OF SCOPE here) `pi`'s `Connection error` is a missing MiniMax credential.
   Do not "fix" that in this change.

## Required changes

### 1. SW keepalive (primary)

An open `chrome.runtime.connect()` port from an extension page pins the MV3 SW alive, even
when the page is hidden. Add one:

- In the main-workspace page (small module imported by `src/main-workspace.js`), call
  `chrome.runtime.connect({ name: "resonantos.keepalive" })`, retain the port, and on
  `port.onDisconnect` reconnect with a short backoff + a guard against reconnect storms.
- In `src/background.js`, add a `chrome.runtime.onConnect` listener that keeps the port
  reference (this is what holds the SW alive).
- Do **not** change the existing `connectNative` bootstrap design; keep it per-request.

### 2. Recovery resilience

Make `bootstrap:get-status` never report a false "offline":

- Either have the handler await any in-flight `bootstrapStartup.boot()` /
  `rebindAndHydrate()` before calling `sendResponse`, or
- Have `bootstrap-renderer.js` retry (bounded) when it first sees "offline" after a
  disconnect before rendering "offline".
- Ensure the SW re-runs `boot()` on wake and converges to "connected" within a couple of
  polls when the bridge is healthy.

### 3. (Optional but recommended) Bridge death logging

The bridge is spawned with `stdio: "ignore"`, so a real bridge death is currently silent.
Add a bounded, redacted `process.on("exit")` / signal handler in `run-bridge-minimal.mjs`
that appends `{event:"bridge.exit", code, signal, at}` to a fixed path (e.g.
`~/.ros/bridge-exit.log`), OR change the native host to spawn the bridge with stderr to a
file. Keep it secret-free.

## Constraints / pitfalls

- `.mjs` files are single-quoted; extension `.js` files are double-quoted. Match surrounding
  style.
- Do **not** use `edit_file` on `.mjs` files (it reformats the whole file). Use a raw-`fs`
  patch script or `write_file`.
- MV3 SW must not use top-level `await`; use `.then()` chains (see existing `background.js`).
- No shell interpolation in terminal commands.
- Keep the native-messaging security boundary intact: the keepalive port must carry no
  tokens/credentials; it only pins the SW alive.
- Do not chase pre-existing failures: `npm run verify:alpha` (fake `sk-...` fixtures),
  `npm run docs:check` (60 reachability), and the bridge-route-capability-audit /
  alpha-browser-extension-scope drift are all pre-existing and out of scope.

## Acceptance criteria

1. `npx tsc --noEmit` — clean.
2. `npx vitest run` (core) and `npx vitest run --config examples/sdk-demo/vitest.config.ts`
   (demo) — no new failures.
3. `node --experimental-strip-types --test --test-force-exit browser-first/test/main-workspace-terminals.test.mjs`
   and `browser-first/test/terminal-host-launch.test.mjs` — green.
4. New deterministic test(s) cover: (a) keepalive port opened on page load and reconnects on
   disconnect; (b) `bootstrap:get-status` does not emit a false "offline" when a healthy
   bridge is reachable during SW restart.
5. Live: `node browser-first/test/terminals-browser-e2e-complete.mjs` passes, then a ~2 min
   hold with the Chrome window backgrounded (simulating focusing the terminal) keeps the
   Terminals card "Connected" and Bridge & Runtimes status "connected".
6. No new secret-shaped value crosses the keepalive or recovery path (reuse the existing
   shape-walker assertions).

## Non-goals

- Do not change the bridge's enable/grant/launch logic.
- Do not add a MiniMax credential or touch provider resolution.
- Do not change the native-host bootstrap protocol (`status`/`start`/`restart`/
  `stopForShutdown`).

## Deliverables

- Code changes + tests + a short docs/ownership note consistent with existing conventions.
- A verification report listing the commands run and their pass counts.

## STOP

Report per the project's final-report convention: files + commits, what changed, test counts,
and any remaining risks.
