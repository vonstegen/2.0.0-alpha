# ResonantOS Extension — Service-Worker Keepalive And Recovery (CP-BR11)

> CP-BR11 is the MV3 service-worker keepalive and recovery work. It
> closes the "Bridge offline" false negative that the extension UI
> reported when Chromium idle-killed the SW even though the bridge
> process was still healthy. The bridge's enable / grant / launch
> logic is intentionally untouched; the keepalive and recovery
> are purely extension-side.

## 1. The failure mode being closed

- The MV3 SW is idle-killed by Chromium after ~30s of no dispatchable
  work. When the main-workspace page is hidden (or unfocused), the
  SW loses its keepalive signals and is torn down.
- After a tear-down, the CP-BR2 orchestrator's in-memory snapshot
  resets to `"offline"`. The next renderer poll landed on
  `bootstrap:get-status` answered with that placeholder, so the
  workspace header and the Terminals card reported "Bridge offline"
  even though the bridge process was up.
- The bridge is spawned `detached: true, stdio: "ignore"` by the
  CP-BR1 host (see `host/bridge-launcher.mjs`), so an actual bridge
  death also left no stderr breadcrumb on the bridge host.

## 2. Fix (1) — open-port keepalive

- New module:
  `browser-first/resonantos-side-panel-extension/src/lib/sw-keepalive.js`
  exports `createSwKeepalive({ connectImpl, setTimeoutImpl, clearTimeoutImpl, ... })`.
- The main-workspace page
  (`browser-first/resonantos-side-panel-extension/src/main-workspace.js`)
  instantiates the factory on load, calls `start()` to open
  `chrome.runtime.connect({ name: "resonantos.keepalive" })`, and
  binds `pagehide` / `beforeunload` to `stop()`. The port carries
  no payload: both ends ignore incoming messages and the
  shape-walker test in `browser-first/test/sw-keepalive.test.mjs`
  proves no token, credential, path, PID, or env string crosses it.
- The background SW
  (`browser-first/resonantos-side-panel-extension/src/background.js`)
  registers a `chrome.runtime.onConnect` listener that pins any
  `resonantos.keepalive` port into a `Set`. The set is the only
  reference; the open channels are the SW keepalive signal.
- Reconnect discipline mirrors the CP-BR2 recovery backoff
  vocabulary: `1s → 2s → 5s → 10s → 30s` cap. A successful connect
  resets the attempt counter so a transient storm does not
  over-backoff the next outage window. The factory never schedules
  a sub-1s reconnect — that would be a reconnect storm.
- The factory does not require a `chrome` global; tests inject
  `connectImpl`, `setTimeoutImpl`, `clearTimeoutImpl` seams.

## 3. Fix (2) — recovery resilience

- New orchestrator method: `bootstrapStartup.whenBootSettled()`. It
  resolves when any in-flight `boot()` settles, and resolves
  immediately when the orchestrator is idle. The implementation
  rides the existing `bootInFlight` promise so concurrent callers
  join a single resolution.
- The `bootstrap:get-status` message handler
  (`background.js`) now awaits `whenBootSettled()` before
  answering. The first poll after a SW revival lands on the
  post-boot snapshot — typically `"connected"` when the bridge is
  healthy — instead of the pre-boot `"offline"` placeholder.
- The new deterministic test
  `browser-first/test/bootstrap-get-status-recovery.test.mjs`
  reproduces the window by deferring the host's status response
  and asserts the handler's snapshot is `"connected"` (no false
  `"offline"`), the steady-state path is unchanged, real failures
  still surface truthfully, and concurrent callers see the same
  converged snapshot.
- The orchestrator's top-level `void bootstrapStartup.boot()` is
  unchanged: the SW still re-runs `boot()` on every wake. The
  recovery handler closes the window between wake and
  convergence; the orchestrator's bounded-retry / "no recursive
  auto-restart" rules (CP-BR2 §6) are not modified.

## 4. Fix (3) — bridge-death breadcrumb

- The bridge is `browser-first/host/run-bridge-minimal.mjs`. A
  new `process.on("exit", code)` handler appends a single
  redacted JSON line
  `{ "event": "bridge.exit", "code": <number|null>, "signal": null, "at": <ISO> }`
  to `~/.ros/bridge-exit.log`. The existing SIGINT / SIGTERM
  handlers still drive `shutdown() → process.exit(0)`, which
  fires the same `exit` event, so the `exit` handler is the
  single sink for every exit path (normal return, graceful
  shutdown, uncaught exception, or a signal that bubbles
  through `process.exit`).
- The log is bounded by simple size-based rotation
  (≤ 256 KiB; trimmed to the trailing 128 KiB on overflow). The
  field set is exactly `{ event, code, signal, at }`; the
  `secret-shaped` walker in
  `browser-first/test/bridge-exit-log-shape.test.mjs` proves
  the record carries no token, credential, path, PID, env, or
  argv string.
- The signal is always `null` at the `exit` event because the
  Node runtime does not surface the terminating signal there.
  Operators that need the signal name can recover it from
  their own shell history; the breadcrumb's job is to prove
  the bridge exited, not to re-derive the cause.

## 5. What was NOT changed (out of scope, by design)

- The bridge's enable / grant / launch logic. No route handlers
  were touched in `bridge-server.mjs`, `harness-host-service.mjs`,
  `terminal-host-service.mjs`, or any CP-BR7/CP-BR9/CP-BR10
  reviewed factory.
- The native-messaging bootstrap protocol. `bootstrap-protocol.mjs`
  is unchanged; the CP-BR1 host wire contract is unchanged.
- The provider / MiniMax credential resolution. The known
  `Connection error` for the `pi` runtime (missing credential)
  is documented as a separate, out-of-scope issue.
- The "pre-existing" failures called out in the prompt:
  `npm run verify:alpha` (fake `sk-...` fixtures), `npm run docs:check`
  (60 reachability), `bridge-route-capability-audit`, and
  `alpha-browser-extension-scope` drift.

## 6. Ownership

| Surface | Owner | Test |
|---|---|---|
| `sw-keepalive.js` factory | CP-BR11 | `browser-first/test/sw-keepalive.test.mjs` |
| `bootstrapStartup.whenBootSettled()` | CP-BR11 (additive on CP-BR2) | `browser-first/test/bootstrap-get-status-recovery.test.mjs` |
| `background.js` keepalive port holder | CP-BR11 | manual / `terminals-browser-e2e-complete.mjs` |
| `background.js` get-status await | CP-BR11 | `browser-first/test/bootstrap-get-status-recovery.test.mjs` |
| `main-workspace.js` keepalive wiring | CP-BR11 | manual / `terminals-browser-e2e-complete.mjs` |
| `run-bridge-minimal.mjs` exit log | CP-BR11 | `browser-first/test/bridge-exit-log-shape.test.mjs` |

## 7. Acceptance evidence

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 52 files, 774 tests, all green.
- `npx vitest run --config examples/sdk-demo/vitest.config.ts` — 14 files,
  107 tests, all green.
- `node --experimental-strip-types --test --test-force-exit
   browser-first/test/main-workspace-terminals.test.mjs
   browser-first/test/terminal-host-launch.test.mjs` — 49 tests,
  all green.
- `node --test --test-force-exit
   browser-first/test/sw-keepalive.test.mjs
   browser-first/test/bootstrap-get-status-recovery.test.mjs
   browser-first/test/bridge-exit-log-shape.test.mjs` — 15 tests,
  all green (this commit).
- Live: `node browser-first/test/terminals-browser-e2e-complete.mjs`
  + a backgrounded 2-minute hold with the workspace focused on the
  Terminals card — Terminals card "Connected" and Bridge & Runtimes
  status "connected" remain green across the hold.

## 8. Future follow-up (not in this commit)

- The same keepalive factory could be wired into `side-panel.js`
  so the side panel also pins the SW. Out of scope here; the
  prompt scoped the keepalive to the main-workspace page.
- The CP-BR2 orchestrator's snapshot could carry a `lastHealthzAt`
  timestamp so a stalled snapshot (e.g. the host returning
  "connected" but the bridge actually having died) is detectable
  from the renderer. Out of scope here; the bridge-death log
  gives the operator a breadcrumb but does not change the public
  snapshot shape.
