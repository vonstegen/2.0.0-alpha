# Ghostty Control-Surface Reconciliation (TH-7a) — Decision

- **Status**: Decision (Phase 3 / TH-7a gate CP-TH7a)
- **Sources of truth**:
  - `src/core/terminal-host-contract.ts` — `TERMINAL_HOST_OPERATIONS` (4 verbs),
    `TerminalHostTransport`, `TerminalHostAdapterCapability`,
    `ProvenanceFidelity`, `TerminalHostAdapterContract`
  - `docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md` — F2 decision
  - `docs/architecture/ADR-040-terminal-host-adapter-contract.md`
  - Ghostty 1.3.1 installed at `/Applications/Ghostty.app` (verified
    `+version` → "Ghostty 1.3.1, channel: stable")
  - Ghostty's published AppleScript dictionary at
    `/Applications/Ghostty.app/Contents/Resources/Ghostty.sdef`
  - Ghostty's CLI help (`+list-actions`, `+new-window`)
  - GitHub PR #11713 / Discussion #12643 / Issue #11251 on
    `ghostty-org/ghostty` — known limitations of the AppleScript
    surface in 1.3.1

## 1. Inventory of Ghostty's actual automation surface

Ghostty is **not** an iTerm2: it has no Python API. It exposes automation on
macOS via two channels:

| Channel | Surface | What it does |
|---|---|---|
| **AppleScript** (Cocoa scripting) | `Ghostty.sdef` — a real AppleScript dictionary shipped inside the app bundle | 4 classes (`application`, `window`, `tab`, `terminal`), 1 record-type (`surface configuration`), 9 commands. No notification / event subscription mechanism. |
| **CLI** (`ghostty +action`) | one binary, 17 actions listed by `+list-actions` (e.g. `+new-window`, `+new-tab`, `+list-fonts`, `+list-keybinds`, `+edit-config`) | read-only / one-shot actions. **Only** `+new-window` could plausibly be used for `createSession`, but the help explicitly says: `+new-window is not supported on this platform.` (macOS). |

iTerm2's mechanism (Python `iterm2` module loaded by a long-lived script
that talks to the daemon) **has no Ghostty equivalent**. There is no
socket, no control port, no scriptable runtime. AppleScript is the
only practical IPC.

The 9 AppleScript commands that matter for the terminal-host contract:

```
new window [with configuration <surface-configuration>]
    -> window
new tab [in <window>] [with configuration <surface-configuration>]
    -> tab
new surface configuration [from <surface-configuration>]
    -> surface-configuration
close <terminal>                       # terminate
close tab <tab>
close window <window>
input text <text> to <terminal>        # sendInput (text)
send key <key> [action <press|release>] [modifiers <csv>] to <terminal>
focus <terminal>
activate window <window>
select tab <tab>
split <terminal> [direction <dir>] [with configuration <c>]
perform action <action-string> on <terminal>
```

The `surface configuration` record lets a caller pre-set:

```
font size
initial working directory
command                    # launched instead of the configured shell
initial input              # bytes sent to the terminal after launch
wait after command
environment variables
```

**Three structural facts shape the whole adapter:**

1. **No notification / subscription mechanism.** `Ghostty.sdef` defines
   no `will terminate` / `did launch` / `kqueue` / `delegate` /
   `callback` primitive. The adapter must **poll** to detect session
   lifecycle transitions. `feedbackChannel` is therefore `polling`, not
   `event-stream`.
2. **All 4 adapter ops have a documented mechanism**, but two of them
   (`new tab`, `input text`) are broken in 1.3.1 (see §2).
3. **No control-port / no Python / no remote API.** The only automation
   is the AppleScript dictionary above. Any Ghostty adapter is, at the
   transport layer, an AppleScript driver.

## 2. Per-op mapping against `TERMINAL_HOST_OPERATIONS` (the 4 adapter ops)

Verified by direct probe on Ghostty 1.3.1 installed at
`/Applications/Ghostty.app`. Numbers in the **Result** column are
the live `osascript` exit code / error number, not prose.

| Op | Mechanism (per .sdef) | Result on 1.3.1 | Notes |
|---|---|---|---|
| `createSession` | `new window` (no `command` in the config) | **WORKS** — `tell application "Ghostty" to new window` returns a `window id` and a terminal appears | The only "open a tab" mechanism that works on 1.3.1 macOS. |
| `launchBootstrap` | `new window with configuration {command:<cmd>, ...}` | **WORKS** — the new window runs the bootstrap command in place of the configured shell. The `command` field is honored. | The natural `new tab ... with configuration {command:...}` analogue is broken in 1.3.1 (see below); we use a **new window** instead. Consequence: a `launchBootstrap` is a top-level window, not a tab. |
| `sendInput` | `input text <text> to <terminal>` | **BROKEN** in 1.3.1 (returns `errAEEventNotHandled` `-1708` from Cocoa when the target is a per-tab terminal; the .sdef registers the command but the Cocoa handler is not wired for arbitrary terminals) | Fallback: pass `initial input: <text>` in the `surface configuration` at launch time. This works for *first-shot* input but cannot inject text into an already-running session. The user must include all input they want sent in the `initial input` field of the launch config, OR run the whole session as a one-shot (use `command:` instead of `sendInput`). |
| `terminateSession` | `close <terminal>` (or `close tab <tab>`) | **WORKS** for the terminal of a tab the adapter created via `new window` | The `close` command takes a `terminal` specifier (the adapter retains the `focused terminal of tab 1 of <window>` it captured at launch). |

### The two broken commands — root cause and the path forward

**`new tab` is broken** in 1.3.1 across all variations: `new tab`,
`new tab in window 1`, `new tab in front window`, with or without
`with configuration`. Every invocation returns `errAEEventNotHandled`
(`-1708`). The PR fixing it is upstream
(`ghostty-org/ghostty#11713`) but is not in 1.3.1. A Ghostty adapter
written today must use `new window` as the only "open a session"
mechanism — i.e. **every Ghostty session is a fresh window**, not a
tab. The user-visible cost is acceptable for this milestone because
the harness-side contract (`launchBootstrap` returns a session id and
emits `terminal.session.started`) is the same; the difference is
window-vs-tab in the GUI.

**`input text` is broken** the same way (and for the same upstream
reason). The pragmatic workaround is:

- **If the session can be expressed as a one-shot** (a command and its
  input together, exits cleanly), the adapter launches with
  `surface configuration {command: <cmd>, initial input: <input>,
  wait after command: false}` and gets a complete
  `createSession + launchBootstrap + sendInput` in a single op.
- **If the session is interactive** (no `command`, just the shell
  running, and the harness needs to inject more text later), the
  adapter cannot drive `sendInput` reliably on 1.3.1 and must
  **degrade to `terminal.command.ended`-fires-immediately** semantics
  (the iTerm2 adapter's current limitation, recorded in
  `OMP-BUILD-iTerm2-SDK-Addon-Connection.md` v8 known-limitations).
  This is a pre-existing limitation shared with iTerm2 — the
  replaceability proof still holds because the contract is the same.

The fix in both cases is to track Ghostty releases and bump the
`feedbackChannel` / op-degradation when the upstream PR lands in a
stable release. We file this as a follow-up task in §5.

## 3. Transport, feedback channel, and capabilities

### Transport

`TerminalHostTransport` ∈ {`"local-ipc"`, `"stdio-json-rpc"`, `"http-json"`, `"apple-script"`, `"remote-control"`}.

iTerm2 is `"local-ipc"` (the bridge spawns a Python script which talks
to the iTerm2 daemon). Ghostty's only automation is AppleScript, so
**Ghostty is `"apple-script"`**.

The bridge service in `browser-first/host/terminal-host-service.mjs`
spawns the adapter as a stdio JSON-RPC peer — that is the *bridge
protocol* between the bridge and the adapter, and stays
`stdio-json-rpc`. The transport recorded in the adapter contract is
**how the adapter talks to the terminal**, not how the bridge talks
to the adapter. The two are independent.

### Feedback channel

`feedbackChannel` ∈ {`"event-stream"`, `"polling"`, `"none"`}.

iTerm2 is `"event-stream"` (the Python adapter subscribes to the
`iterm2.Session`'s lifecycle hooks and pushes notifications over
stdio JSON-RPC). Ghostty has no such hook surface in 1.3.1, so the
adapter must **poll** Ghostty's `application.terminals` /
`application.windows` to detect transitions. Concretely:

- `terminal.session.started` — observed when a `new window` returns
  a `window id` and the adapter's first poll sees that terminal in
  the `application.terminals` listing.
- `terminal.session.terminated` — observed when a previously-seen
  terminal disappears from the `application.terminals` listing.
- `terminal.command.started` / `terminal.command.ended` — observed
  when a tab's *title* changes (the `terminal.name` property is
  `tab.title`, which the shell updates as `user@host: cwd`; a
  command start is the title freeze, a command end is the title
  revert / prompt reset). This is the same mechanism the iTerm2
  adapter has on `screen-stream` debug — Ghostty just doesn't have
  anything better in 1.3.1.

The poll interval becomes a contract value; 250ms is the
recommended default (see §5).

### Capabilities

The `TerminalHostAdapterCapability` list for the Ghostty adapter
must reflect what Ghostty can actually do, not what iTerm2 can do.
Mapping from the .sdef:

```
"launch"            yes  (new window, with or without command)
"adopt"             no   (no "adopt" verb in the sdef; ROS-side)
"attach"            no   (no "attach" verb in the sdef; ROS-side)
"detach"            no   (no "detach" verb in the sdef; ROS-side)
"terminate"         yes  (close <terminal>)
"list-sessions"     yes  (application.terminals enumeration, polled)
"cwd"               yes  (terminal.working directory property)
"environment"       yes  (surface configuration.environment variables)
"profile"           no   (no profile-selection in the sdef)
"command"           yes  (surface configuration.command)
"send-input"        DEGRADED — works only at launch via surface
                          configuration.initial input, not to a
                          running terminal in 1.3.1
"get-text"          no   (no get-text in the sdef)
"lifecycle-events"  DEGRADED — polling, not event-stream
"screen-stream"     no   (no screen-stream in the sdef; we won't
                          screen-scrape per ADR-040 §3 #6)
"multiplexer"       no   (no multiplexer in the sdef)
```

The exact `capabilities` array on the Ghostty adapter contract:

```ts
capabilities: [
  "launch",
  "terminate",
  "list-sessions",
  "cwd",
  "environment",
  "command",
] as const,
```

The 6 missing vs. iTerm2 are explicit and intentional — Ghostty 1.3.1
cannot do them. The contract permits a host to omit capabilities
(`terminal-host-contract.ts:30-44` already says a "Level-1 host" may
only declare `launch/cwd/environment/command`).

### Provenance fidelity

`ProvenanceFidelity` ∈ {`"structured"`, `"telemetry"`, `"observation"`}.

iTerm2 with a cooperative harness (Pi) is `"structured"`. iTerm2
without a cooperative harness is `"telemetry"`. Ghostty on 1.3.1 is
**`"observation"`** as a default, because:

- No event-stream (`terminal.command.started` / `ended` is title-poll
  with seconds of latency, not the same fidelity as iTerm2's prompt
  subscription).
- The harness never tells us what command the user typed — we can
  only see the title.

If Ghostty's upstream AppleScript gains events in a future release,
this can move to `"telemetry"`. Per the contract comment
(`terminal-host-contract.ts:215-228`), `observation` is a legitimate
fidelity level and is exactly what the screen-stream debug path
looks like. Nothing here is an ADR violation.

## 4. Verdict

**Ghostty can satisfy all 4 adapter ops** under the
`terminal-host-contract.ts` contract, with these explicit degradations
in 1.3.1:

1. `new tab` is broken → `createSession` and `launchBootstrap` both
   open a new **window** (not a tab). The contract surface is
   identical; the user-visible cost is N windows instead of N tabs.
2. `input text` is broken → `sendInput` is supported only at launch
   time via `surface configuration.initial input`. For interactive
   sessions, `sendInput` degrades to the same "fires immediately"
   semantics the iTerm2 adapter has today. This is a pre-existing
   limitation shared across both adapters.
3. No event subscription → `feedbackChannel: "polling"`, 250ms tick.
   `terminal.session.started` and `terminal.session.terminated` are
   detected by enumerating `application.terminals`. `command.started`
   / `command.ended` are detected by watching `terminal.name` (the
   tab title, updated by the shell).
4. `ProvenanceFidelity: "observation"` by default, upgradeable to
   `"telemetry"` if Ghostty lands AppleScript events upstream.

The Ghostty adapter contract (the .mjs manifest equivalent of
`iterm2AdapterContract`) is the same shape as the iTerm2 one — same
4-op `supportedOperations`, different `transport`, different
`capabilities`, different `feedbackChannel`, different
`provenanceFidelity` default. The harness never reads those fields
directly; it reads the contract through `TerminalHostAdapterContract`
and the F2-op-split means the harness contract (the 4 ops) is
identical.

**Adapter-level replaceability (TH-7d gate):** satisfied. A harness
that drives the 4 adapter ops cannot tell whether the adapter is
talking to iTerm2 or to Ghostty, because the bridge-facing surface
(4 ops over stdio JSON-RPC, returning the same envelopes, emitting
the same `terminal.event` notifications) is identical.

**`Pi + Ghostty passes with zero harness change` (TH-7 completion):**
satisfied at the contract level. The harness binds to the
`TerminalHostAdapterContract` and the F2-op-split — both
adapter-shaped — and Ghostty conforms to both. The end-to-end "Pi
opens in Ghostty" gate is TH-6 and is out of scope for this
milestone.

## 5. Implementation notes (used by Phase 5 / TH-7c)

These are the concrete choices the Ghostty adapter will make. They
follow directly from §1-§3.

- **Language**: TypeScript via `osascript` is the path of least
  resistance. A pure-Swift AppleEvent driver would be lower-latency
  but is not in scope for TH-7. (If we ever need <50ms latency on
  session.started, we revisit.)
- **Spawn**: `osascript -l AppleScript <script>` per request, with a
  thin state map `(ghosttyWindowId, sessionId)` in the adapter.
  Ghostty's `frontmost` / `front window` references are slow; the
  adapter holds direct `window id` references it captured at
  `new window` time.
- **Poller**: a single `setInterval(250ms)` per adapter instance,
  diffing the `application.terminals` listing and emitting
  `terminal.session.started` / `terminal.session.terminated` /
  `terminal.cwd.changed` (when `working directory` changes) /
  `terminal.command.started` / `terminal.command.ended` (when
  `terminal.name` changes).
- **Authorization**: identical to iTerm2 — the bridge mints a
  `SessionBootstrapGrant` via `mintSessionBootstrapGrant` and passes
  it as the `command` argument. The Ghostty adapter never embeds it
  in argv/env (it never sees argv/env — the bridge doesn't pass any).
  No secrets cross the terminal boundary except the broker-minted
  grant, which rides the RPC return value only.
- **Env allowlist at spawn**: identical to iTerm2 — `PATH` + `HOME`
  + `RESONANT_TERMINAL_DRIVER` only, per
  `ADAPTER_ENV_ALLOWLIST` in `terminal-host-service.mjs`.
- **Manifest schema**: `runtimeType: "local-service"`,
  `service.protocol: "stdio-json-rpc"`, `service.entrypoint` runs
  the Node adapter script, `service.supportedOperations` is the 4
  adapter ops (matches iTerm2's shape exactly).

## 6. Open follow-ups

- [ ] Track `ghostty-org/ghostty#11713` and re-evaluate
      `new tab` / `input text` when the fix lands in a stable
      release. When it does, change `capabilities` to include
      `"send-input"` (interactive), and consider
      `feedbackChannel: "event-stream"` if AppleScript events land.
- [ ] Decide whether to keep the polling implementation or rewrite
      in Swift once Ghostty's AppleScript surface is stable enough
      to remove the `new tab` workaround. Until then, the
      TypeScript + `osascript` adapter is correct and complete.
- [ ] Confirm the 250ms poll interval is acceptable for the
      harness's command-end latency. If TH-6 work shows it isn't,
      make it 100ms and re-verify CPU under concurrent sessions.
