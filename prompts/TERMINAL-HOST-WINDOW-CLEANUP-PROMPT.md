# Terminal Host — Window Cleanup + No-Confirm Close — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The real Ghostty CP-S5c proof is green and pushed. One integration defect
remains: terminal windows opened by the bridge/smoke are leaked on shutdown,
and closing them triggers Ghostty's confirmation dialog because each window
holds a running keep-alive shell. This prompt fixes both.

---

## 0. Confirmed context (read first)

AVIS established:

1. `createTerminalHostService().stop()` SIGTERMs the adapter child process but
   does **not** close the Ghostty windows it opened. The adapter's
   SIGTERM/SIGINT handler only does `stopPoller(); process.exit(0)`.
2. `terminateSession` → `ghosttyCloseTerminal(windowId)` *does* close a window,
   but the smoke never calls it during teardown, so every run leaks one window.
3. The keep-alive `exec "${SHELL:-/bin/bash}"` (added in `fd1b1265` to dodge
   Ghostty's false "failed to launch" banner from `abnormal-command-exit-runtime`)
   leaves a **running interactive shell** in the window. Ghostty's
   `confirm-close-surface` behavior therefore prompts before closing — which is
   why the operator had to click through a confirmation per window.

Fix both the leak and the confirmation prompt.

---

## 1. Authority — read first

- `browser-first/host/terminal-host-service.mjs`
  - `createTerminalHostService()` — `start`, `stop`, `launchBootstrap`,
    `createSession`, `sendInput`, `terminateSession`, `status`.
  - `stop()` is where tracked sessions must be terminated before the child is
    killed.
- `examples/sdk-demo/terminal-host/ghostty/adapter.mjs`
  - `handleRequest()` `terminateSession` case → `ghosttyCloseTerminal`.
  - `ghosttyNewWindow()` / `composeGhosttyNewWindowOsa()` — surface
    configuration record (`command`, `wait after command`, etc.).
  - SIGTERM/SIGINT handlers and `startPoller()`/`stopPoller()`.
- `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs`
  - `proofTail` / keep-alive `exec $SHELL`.
  - teardown (`uninstallTerminalHostBridge` → `service.stop()`).
- `browser-first/host/terminal-host-bridge-wiring.mjs`
  - `uninstallTerminalHostBridge`.
- Ghostty sdef: `/Applications/Ghostty.app/Contents/Resources/Ghostty.sdef`
  - `surface configuration` record-type properties (no `confirm-close-surface`
    property exposed), `close window`, `close`, `quit`, `perform action`.
- Existing tests: `examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs`.

---

## 2. Hard rules

1. **No leaked windows.** After `stop()` (or the smoke teardown), the adapter
   must have closed every window it opened.
2. **No confirmation dialogs.** Programmatic close must not require operator
   interaction. The operator must never have to click through a Ghostty prompt.
3. **No regression** to the keep-alive's purpose: a launched terminal that is
   *meant* to stay interactive (the real "Pi running in a terminal" behavior)
   must still stay open — the fix is about **shutdown/teardown**, not about
   disabling interactive terminals wholesale.
4. **Token/credential still never in argv/env/logs/bus.** The close path must
   not introduce any new leak.
5. **F2 split holds** — `terminateSession` stays an adapter op; do not move
   session-close authority onto the ROS session manager.
6. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push until AVIS audits.

---

## 3. Phase W1 — `stop()` closes tracked sessions · gate CP-SW1

Make `createTerminalHostService().stop()` close every window it opened before
killing the adapter child.

Requirements:

1. Track the session ids the service has launched (via `createSession` and
   `launchBootstrap`) in a service-owned set, regardless of which adapter
   instance handled them.
2. On `stop()`, before SIGTERM:
   - call `terminateSession({ sessionId })` for each tracked id;
   - tolerate `session-not-found` / already-closed errors (idempotent close);
   - bound the total close time (e.g. do not hang `stop()` if an adapter is
     unresponsive) and then proceed to kill the child regardless.
3. Return/record a non-secret summary (e.g. `{ closedSessions: number }`) —
   never window ids or tokens if they could be sensitive; window ids are fine
   but keep the payload minimal.
4. Clear the tracked set after stop.

**CP-SW1 gate:** a unit test with a stubbed terminal peer asserts that `stop()`
issues a `terminateSession` RPC per launched session **before** the child is
killed, and that `stop()` is idempotent and does not throw on a missing session.

`STOP AND REPORT` here.

---

## 4. Phase W2 — no-confirm close · gate CP-SW2

Resolve the confirmation-dialog problem. The current `ghosttyCloseTerminal`
(AppleScript `close`) prompts because the keep-alive shell is still running.
Evaluate and pick one approach; it must be **verified** to close without a
dialog, and documented in the commit message.

Candidate approaches (investigate; pick the one that actually works on Ghostty
1.3.1 from this shell):

1. **Kill-then-close:** make the shell exit before closing. Options to try:
   - `perform action "close_surface" on <terminal>` (or the equivalent Ghostty
     action string) — determine whether it bypasses confirmation;
   - `send key "d"` with `modifiers: "control"` (Ctrl-D) to the terminal to end
     the shell, then `close`.
2. **Config-driven:** set `confirm-close-surface = false` (or the correct
   Ghostty config key) — but note the `surface configuration` record in the
   sdef does **not** expose it; if a per-surface/config path exists (e.g. via
   `new surface configuration` additional properties, or a config file), confirm
   it empirically before relying on it.
3. **Keep-alive redesign:** replace `exec $SHELL` with a form that does not
   leave a blocking process for *teardown-only* windows — e.g. use
   `wait after command:true` (window stays open after the one-shot command
   exits) instead of a long-lived `exec`, or raise/disable
   `abnormal-command-exit-runtime` so the keep-alive is unnecessary for the
   smoke. Ensure the real hosted-terminal path (interactive Pi) is unaffected.

**CP-SW2 gate:** a real Ghostty check (scripted, but observed) proves that
`terminateSession` closes a keep-alive window **without** a confirmation prompt.
No manual clicking. Capture the chosen mechanism and the observed behavior in
the report.

`STOP AND REPORT` here.

---

## 5. Phase W3 — smoke teardown + regression · gate CP-SW3

1. Update `pi-attach-smoke.mjs` teardown to close the proof window via the
   now-correct path (e.g. rely on `service.stop()` from W1, or call
   `terminateSession({ sessionId: proofSessionId })` explicitly before
   `uninstallTerminalHostBridge`).
2. After teardown, assert (in real Ghostty mode) that the window count returns
   to its pre-smoke baseline — i.e. no leaked window.
3. Add/keep a test proving the leak is fixed: after a smoke run (or a
   stub-driven run with the real service), `stop()` leaves zero tracked
   sessions and the terminal peer received a `terminateSession` per session.
4. Re-run the real Ghostty smoke to confirm it still exits green **and** the
   operator observes no confirmation dialogs and no leftover windows.

**CP-SW3 gate:** real smoke green + zero leftover windows + zero confirmation
prompts.

`STOP AND REPORT` here.

---

## 6. Regression commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/ros-session-http-integration.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

And the real smoke (observe window count + no confirm dialogs):

```sh
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  RESONANT_TERMINAL_DRIVER=ghostty \
  RESONANT_TERMINAL_HOST_BRIDGE=1 \
  node --experimental-strip-types \
    examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

Report counts by label: core / demo / browser-first (+ the real smoke result).

---

## 7. Commit/report discipline

Suggested commits:

1. `fix(terminal-host): close tracked sessions on terminal-host stop`
2. `fix(terminal-host): close Ghostty windows without confirmation prompts`
3. `test(terminal-host): assert no window leak or confirm prompt on teardown`
4. `docs(terminal-host): capture window-cleanup prompt`

Final report must state:

- W1 status (stop closes tracked sessions);
- W2 status (chosen no-confirm mechanism + observed behavior);
- W3 status (real smoke green + zero leaked windows + zero prompts);
- test counts by label;
- non-leak assertions unchanged.

Do not push until AVIS audits.
