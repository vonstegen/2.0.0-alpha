# Terminal Add-ons → TUI Harness: Launch Status (2026-10-12, updated PM)

Continuation of `TESTING-SUMMARY.md`. Goal: launch a real terminal via the
terminal add-ons and run the pi TUI harness inside it with ROS-provided
resources (prompt file, provider credential, session env).

## TL;DR — RESOLVED, proven live

The full chain works end-to-end on the live bridge: enable → grant →
prompt → launch → window opens → attach → **pi answers via minimax
MiniMax-M3 using the ROS-delivered credential and prompt file**.

Proof (pi's own session record, `2026-10-12T18-31-04Z`):

```
[user]      <file name="…/pi-prompt-dcc90eb6.txt"> Reply with exactly: …
[assistant] provider=minimax model=MiniMax-M3 stop=toolUse out=61
            | ROS terminal-host pi harness OK.
```

`terminals-browser-e2e.mjs`: **OK** (17/17). Terminal regression batch:
**185/185** (11 suites).

The day's "terminal delivery is hopeless" hypothesis was wrong. Three more
root causes were found and fixed in ROS code (below); the environmental
one (display asleep ⇒ Ghostty cannot spawn surfaces) is handled by the
adapter itself now.

## Fixes landed this session (uncommitted, on `r-and-d/terminal-host-current-dev`)

### 1. Ghostty adapter process leak (root of the machine-wide wedge)

`examples/sdk-demo/terminal-host/ghostty/adapter.mjs`

- **Orphan leak:** adapters never exited when the bridge died — 8 orphaned
  adapters from prior runs were each polling Ghostty every 250 ms (~32
  osascript/sec), flooding Ghostty's AppleEvent queue into `-1712` timeouts.
  Fix: exit on stdin `close` (parent-death watchdog).
- **Overlapping polls:** `setInterval` fired `pollOnce` without awaiting;
  hung AppleEvents accumulated ~170 stuck osascript processes. Fix:
  self-scheduling serialized poll chain.
- **No watchdog:** hung osascript calls parked 60 s each. Fix: 15 s SIGKILL
  watchdog in `runOsa`.

Proof: spawned adapter, killed parent, adapter exits (previously orphaned).
iTerm2 adapter (`adapter.py`) audited: already exits on stdin EOF; no
polling loop; no fix needed.

### 2. `--auth-file` never reached production bootstrap commands

`browser-first/host/terminal-runtime-factories.mjs`,
`browser-first/host/run-bridge-minimal.mjs`

`attachAuth` (CP-S5H3) was only passed to `installTerminalHostBridge` — a
no-op in production (no `RESONANT_TERMINAL_HOST_BRIDGE=1`). The CP-BR7
factory-owned services (which the CP-BR9 owner facade actually serves
launches with) never received it, so every composed bootstrap omitted
`--auth-file` → in-window `ros-session attach` → `http-401` → dead window.

Fix: thread `attachAuth` through `seedTerminalRuntimeFactories` →
`createTerminalRuntimeFactory` → `serviceFactory({...})`. Verified: composed
script now carries `--auth-file '<0600-path>'`.

### 3. Ghostty bootstrap delivery: `command:` → `initial input:`

`examples/sdk-demo/terminal-host/ghostty/adapter.mjs`

Ghostty 1.3.1 **silently ignores** the `command:` field of
`new window with configuration` (proven: window opens, staged
script/auth/token files never consumed). Adapter now types
`bash '<0600-script>'` + newline via `initial input:` (the only delivery
that has ever executed — once). Newline is appended *after* `osaEscape`
(osaEscape doubles backslashes; `\n` must reach AppleScript as an escape).
`wait after command` fixed to `false` (it only governs the ignored
`command:` field). `waitAfterCommand` parameter removed.

### Test state (final)

- Full terminal-host regression batch: **185/185 pass** across 11 suites
  (adapter incl. 3 new dead-surface tests, factories incl. idempotent-start,
  service-owner, launch incl. 3 new model-flag tests, launch-bootstrap,
  grant-broker, ros-session, session-manager, bridge-wiring, service,
  status).
- The 6 failures in `pi-terminal-adapter.test.mjs` (XH2 ×4) and
  `pi-terminal-grant-chain.test.mjs` (×2, all "launchBootstrap RPC not
  received") are **pre-existing**: verified identical with these changes
  stashed. Not a regression; the XH2 generic-launcher chain is mid-refactor
  from a previous session.

### 4. Launch pinned the provider but not the model (the "Connection error")

`browser-first/host/harness-policies/pi.mjs`,
`browser-first/host/terminal-host-host-wiring.mjs`,
`browser-first/host/harness-host-service.mjs`

Observed: pi launched in the window, read the ROS prompt, then replied with
4× `Connection error.` and exited. pi's session record showed it routed to
`ollama/gemma4:31b-mlx` (the operator's pinned default model, server down):
`--provider minimax` does NOT win routing when pi settings pin a default
model, so the injected credential was never consumed.

Fix: the launch now also pins `--model`. The model is host-derived from the
authorized provider profile (`profile.models[0]` → `MiniMax-M3`), threaded
`resolvePiProvider` → launch route → `composePiInvocationFromFile`, which
emits `--model <id>` (token-validated; mirrors the credential-adapter argv
convention `--provider X --model Y`). pi 0.74.2 accepts `MiniMax-M3` as a
custom model id (warns, proceeds); the MiniMax API answers 200 with the
operator's key for both M2.7 and M3.

### 5. Factory `start()` leaked an adapter per generation bump

`browser-first/host/terminal-runtime-factories.mjs`

`start({ addonId })` unconditionally created a new service + adapter and
overwrote `perAddon` WITHOUT stopping the old one. Every registry
generation bump (enable, grant, extension re-sync — each bumps
`runtimeGeneration`) added another live adapter: observed 3 concurrent
ghostty adapters polling the terminal app, with churn pairs every ~45 s.
This also degraded delivery: multiple pollers racing the same AppleEvents.

Fix: `start` is idempotent per add-on — a live existing service is
returned as-is (the service carries no grant-dependent state; grants are
enforced at the route level); a dead one is replaced. Verified live:
enable + grant + launch + 55 s settle ⇒ exactly **1** adapter, stable.

### 6. Ghostty dead-surface deliveries: display-count-0 + no verification

`examples/sdk-demo/terminal-host/ghostty/adapter.mjs`

Root cause of the day's "1-in-6 flaky" `initial input:` deliveries —
**Ghostty cannot initialize a surface while the WindowServer reports zero
displays** (display asleep/locked):

```
CVDisplayLinkCreateWithCGDisplays error -6661: invalid display count (0)
embedded_window: error initializing surface err=error.OutOfMemory
```

The window opens as a dead 👻 surface; typed input is silently dropped.
Every failed delivery of the day correlated with the display being off;
every success with it awake.

Adapter hardening (`ghosttyNewWindow`): assert user activity
(`caffeinate -u -t 1`) before creating the window, poll the new window's
title until it leaves the 👻 no-surface default (6 s budget), close the
corpse and retry — bounded at 3 attempts; on final failure the launch
returns the same observable shape as before. All seams injectable
(`wakeDisplay` / `windowTitle` / `closeWindow` / `sleep`); 3 new unit
tests (retry-on-corpse, first-try success, bounded exhaustion).

Incidental finding: `close window id "…"` is not understood by Ghostty —
windows close via `tell window id … to close (focused terminal of tab 1)`
(the adapter's existing form, verified working on dead-surface windows).

## Verified live end-to-end (2026-10-12 PM)

1. `terminals-browser-e2e.mjs` → **TERMINALS-E2E: OK** (both cards,
   badges, buttons, no leaks, no exceptions).
2. API flow: credential → enable → grant → prompt → launch ⇒ 1 adapter,
   window title `ROS: connected` at T+3 s, first delivery attempt.
3. pi session record: `provider=minimax model=MiniMax-M3`, assistant reply
   `ROS terminal-host pi harness OK.` + tool call, turn completed.
4. Regression batch 185/185 across 11 terminal-host suites. The 6
   pre-existing failures (`pi-terminal-adapter` XH2 ×4, `pi-terminal-grant-chain`
   ×2 — "launchBootstrap RPC not received", mid-refactor from a previous
   session) are unchanged and not caused by these fixes.

## Remaining known limitations (not blockers)

- iTerm2 Python API consent: RESOLVED — consent had persisted; the 401s
  were the wedged pre-restart process. First connect answered `API-OK`;
  the iTerm2 launch path is proven live (multi-live section below).
- pi-infra bootstrap prints a harmless `cd: ~/vibellm: No such file or
  directory` on startup (operator's pi-config extension; the directory was
  removed; does not affect the harness run).
- Ghostty `sendInput` follow-ups still degrade to no-ops on 1.3.1
  (documented `input text` limitation); launch-time delivery is reliable.

Final state: bridge on `127.0.0.1:47773` (fully fixed code,
minimax credential in the session vault), ghostty add-on enabled+granted,
1 healthy adapter, and a live pi TUI in the launched Ghostty window.

## Multi-live terminals (2026-10-12 PM, second feature)

Andrew asked for both terminals running at once on the same credential
source. The CP-BR9 singleton was a product invariant, not a technical
one, so it was lifted:

- `terminal-host-service-owner.mjs` — rewritten: `attach` is per-add-on
  keyed and **never refuses** (same-addon+same-service → idempotent;
  same-addon+different-service → REPLACE, required by the factory's
  dead-service restart path, which re-attaches without detaching;
  cross-addon → coexist). `ownerAddonId()` → `ownerAddonIds()`.
  The facade now dispatches per add-on: `status(addonId)` per surface,
  `launchBootstrap` honors a `terminalAddonId` dispatch hint (stripped
  before the service sees it), session-addressed RPCs route via a
  session→service index learned from launches (broadcast fallback for
  pre-index adopted sessions), and `start.bus` is a fan-in merged view
  over all live terminal buses.
- `terminal-runtime-factories.mjs` — cross-addon singleton gate and the
  dead attach-refusal branch removed; per-addon idempotency kept.
- `harness-host-service.mjs` — `/terminal-host/status` resolves each
  surface's `connected` per add-on (both cards show Connected when both
  are live); `/terminal-host/launch` gates on the requested add-on's
  own status and passes the dispatch hint.
- Docs: `docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md` rewritten to
  multi-live; the credential source was already per-launch and
  terminal-agnostic (`shared-minimax` resolves identically for both).

Tests: owner suite rewritten (8 tests incl. dual-live dispatch, replace
semantics, merged-bus fan-in), lifecycle suite's refused-switch test
flipped to concurrent operation — **202/206 in the 12-suite batch; the 4
failures (+2 in pi-terminal-grant-chain) are the documented pre-existing
XH2 mid-refactor set** (`launchBootstrap RPC not received`; that path
wires the adapter directly to a stub, untouched by this change).

Live proof (bridge restarted on the new code): both add-ons enabled →
`surfaces` reported BOTH `connected: true` with 1× adapter.mjs + 1×
adapter.py. Same `shared-minimax` credential, one launch per terminal:
- Ghostty session `2026-10-13T00-57-20Z`: minimax/MiniMax-M3 received the
  ROS prompt (quoted it verbatim) and replied via the ROS credential.
- iTerm2 session `2026-10-13T00-58-10Z`: minimax/MiniMax-M3 replied
  exactly `ROS multi-live iterm2 OK.`

## "Copy connection script" auth fix (2026-10-13 AM)

Andrew asked about terminals launched BEFORE the extension. Two answers:

1. **Start order is agnostic.** Both apps predated the bridge process and
   both reported `Connected`; on bridge restart the reconciler re-starts
   BOTH adapters from the durable enabled+granted state (restore path).
2. **The paste-into-a-plain-shell path was broken: `http-401`.** The
   connection-script route composed its command WITHOUT the CP-S5H3
   `--auth-file`, so the pasted `ros-session attach` hit the
   addon-runtime-control-gated `/terminal-host/session/attach` with no
   credentials. (The launch path worked because factories get
   `attachAuth` and compose the auth file into the bootstrap.)

Fix:
- `harness-host-service.mjs` — `createHarnessHostService` accepts
  `attachAuth`; the connection-script route mints the same 0600
  `{baseUrl, bridgeToken, controlCapabilityToken}` JSON the launch path
  uses, passes `authFilePath` to `composeBootstrapCommand`, tracks it in
  the adoption record, and best-effort unlinks token+auth files for
  unconsumed adoptions on disable/revoke/remove (the CLI read-then-
  unlinks on a successful paste).
- `run-bridge-minimal.mjs` — passes the existing `attachAuth` closure
  into `createHarnessHostService`.
- Test: `terminal-host-connection-script.test.mjs` +1 (0600 auth file
  minted, `--auth-file` in the command, token VALUES never in the
  clipboard text). Suites: connection-script 12/12, regression 174/174.

Live proof (plain shells ROS never spawned, script minted via the same
route the Copy button uses):
- iTerm2 (new tab via Python API, send_text): `ROS-ATTACH-RC=0-CRED-PRESENT`.
- Ghostty (new plain window, initial-input typed): `RC=0 CRED=PRESENT`.
- Both: `MINIMAX_API_KEY` present from the `shared-minimax` vault;
  single-use grant consumed; 0 leftover 0600 files in tmp.

Caveat surfaced: Ghostty `ghosttyNewWindow`'s short-form `initialInput`
is verbatim (caller supplies the trailing `\n`; pinned by 3 adapter
tests). Only affects direct helper consumers, not the ROS launch flow.

## Ghostty app-absence gate (2026-10-13 AM, third fix)

**Glitch:** with the ghostty add-on enabled, Ghostty could not be quit —
the adapter's 250ms AppleScript polling relaunched it on every attempt
(AppleEvents launch their target on macOS). iTerm2 never had this issue:
its adapter holds a websocket, and a dead peer just fails the connect.

Fix (`examples/sdk-demo/terminal-host/ghostty/adapter.mjs`):
- `pollOnce()` and the poller seed are gated on `isGhosttyRunning()`
  (`pgrep -xiq ghostty` — a process-table query, never an AppleEvent).
- App absent → tracked sessions drain as `terminal.session.terminated`
  (their windows died with the app), the window cache resets, and the
  tick issues ZERO AppleScript. Cost in absent mode: one pgrep per tick.
- App returns → the next present tick reseeds from scratch; the SAME
  adapter keeps serving (no disable/enable cycle, no bridge restart).
- Explicit ops (createSession / launchBootstrap / terminateSession)
  still AppleScript directly — an explicit launch relaunching the app
  is correct behavior for an explicit action.

Tests: adapter suite 13/13 (new absence-gate test: drain + terminated
notification + zero OSA), regression batch 191/191.

Live proof:
1. Quit Ghostty with the add-on ENABLED: 0 ghostty processes at
   T+3s / T+9s / T+15s (pre-fix: resurrected in <250ms); adapter
   process alive and idle.
2. `open -a Ghostty` → same adapter accepted a launch immediately;
   window `ROS: connected` at T+3s; pi replied exactly
   `ROS ghostty self-heal OK.` via minimax/MiniMax-M3.

Known residual asymmetries (documented, not blockers):
- The status card reads Connected while the app is closed (service
  alive = adapter process liveness, not app presence).
- iTerm2's adapter EXITS when its app is absent (code 1, socket gone);
  reopening iTerm2 does NOT self-heal — the reconciler only retries a
  failed start on the next registry event. Workaround: toggle the card
  (or restart the bridge). A matching fix would make adapter.py idle
  with connect-backoff instead of exiting.

## Extension Copy/Launch handlers: unwrap contract + sticky feedback (2026-10-13 PM)

**Bug 1 — Copy always failed from the UI** ("Copy failed: the host did
not return a connection script.") and Launch always reported "Launch
returned no result." despite succeeding. Root cause: the shared seam
`terminals-host-seams.js` `unwrap()` strips the host envelope's `ok`
field, but both Copy handlers and both Launch handlers keyed success on
`result.ok` — always `undefined` post-unwrap. The route itself was fine
(API mints returned `command` correctly; earlier CRED=PRESENT proofs
used API-minted scripts, never the button). Fix: handlers now key on
payload fields — `typeof result.command === "string"` (copy),
`typeof result.launchId === "string"` (launch) — matching the
reason/exception convention `onGrant` already used. Sites:
`main-workspace-terminals.js`, `settings/addon-tools-section.js`.

**Bug 2 — success confirmations were invisible.** Both panels write
action feedback ("Launched X.", "Connection script copied…") into the
status node, then `scheduleRefresh()` re-renders and the refresh's
generic summary overwrites it within microseconds. Errors survived
(state-driven per-card nodes); successes did not. Fix: `state.actionStatus`
in both panels; refresh re-applies it instead of the generic summary;
cleared on the next action/error.

**Bug 3 (test hygiene + production leak) —** `renderSettingsWorkspace`
discarded section handles, so visiting Add-on Tools leaked a poll
interval per visit and the CP-BR10 suite never exited. The workspace now
stops the previous section on switch and returns `{ stop() }`.

Regression coverage: CP-BR11 #7 clicks Copy through the REAL seam +
stubbed host envelope and asserts clipboard write, no error, and a
persistent confirmation; the #5 launch test now uses a faithful
`launchId` envelope and asserts the success status. Suites:
main-workspace-terminals 25/25, addon-tools-section 11/11 (and exits in
<1s; previously hung the runner).

**Operator note:** extension code is loaded by Chrome at install/reload
time — after pulling these fixes, reload the extension
(chrome://extensions → ResonantOS → reload) or the old handlers keep
running.
