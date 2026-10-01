# Pi Testing-Phase Live Run — Operator Runbook

Testing bridge: **running** on `http://127.0.0.1:47773` (pi-phase2 worktree).
Registry is isolated (`/tmp/pi-testing-user-root`); the provider store is the real
`~/ResonantOS_User` Settings store. `addon.pi-harness` is installed, enabled, and
granted (agent-runtime, network, chat-interface, filesystem). The approved
binding is `pi.native` → **OpenRouter** account
(`openai-compatible-ros-openrouter-test-api`).

## Why the provider is OpenRouter (and why isolation makes it safe)

Pi 0.74.2's auth storage prefers `~/.pi/agent/auth.json` over the environment
variable for any provider present there — and OpenRouter is in the local
auth.json. The harness neutralizes this by pinning pi's agent dir to a
host-owned disposable directory via `PI_CODING_AGENT_DIR`
(`/tmp/pi-testing-user-root/pi-coding-agent-isolated`): the durable auth.json is
invisible to the spawned pi, so the session env var is the only key source.
Proved end-to-end with a shaped canary: the full harness chain returned 200 and
OpenRouter answered `401 User not found.` (header attached, key parsed, no
inference). The user's real auth.json is never read and never written.

## Stage 1 — OpenRouter test key through the ROS extension (human-only)

The testing bridge runs with the exact tokens baked into the ROS extension's
bridge config (`2.0.0-alpha` worktree), so the extension's normal Settings
flow reaches it with no reload or Bridge-Target override needed.

1. Open the ROS extension side panel (the usual unpacked extension). Its
   loopback probe finds the testing bridge on `127.0.0.1:47773`.
   (If you ever set a custom **Settings → Bridge Target** override in the
   extension, clear it or point it at `http://127.0.0.1:47773`.)
2. **Reload the extension** after any bridge restart:
   `chrome://extensions` → Reload on the ResonantOS side panel. The bridge
   rewrites the extension's generated bridge config (`src/bridge-config.generated.js`)
   at boot; a stale copy (e.g. one left by an earlier bridge on a different
   port) makes Settings → Providers report the bridge as unreachable. Both
   extension folders (`pi-phase2` and `2.0.0-alpha`) share one extension ID
   and the same token set, so loading either works once its generated config
   is current. See `docs/DEV-LAYOUT.md` for the full machine layout and the
   load rule; `scripts/dev-extension-current.sh` prints the exact folder to
   load for each running bridge.
3. **Settings → Providers → OpenRouter** (the `ros-openrouter-test-api`
   account) → enter the OpenRouter test API key → **Save**. The value lives
   only in the bridge's session memory — never in argv, auth.json, a file, or
   a log. **Every bridge restart wipes session-only credentials**, so the key
   must be re-saved (and any running pi session restarted) after each restart.
4. Tell the agent; it re-checks the registry flag (never the key) and runs
   the proof. A successful turn is a real OpenRouter response from
   `anthropic/claude-sonnet-4.5`; if no credential (or a stale canary) is in
   place the provider returns 503/401 and the turn fails closed.

### MiniMax through the pi add-on (optional, second approved binding)

The bridge approves TWO bindings for `addon.pi-harness` under the `pi.native`
credential-binding identity: the OpenRouter account and `shared-minimax`
(`pi.native.minimax`, `MiniMax-M3`). The panel's profile dropdown lists both;
pick MiniMax and the session runs pi against `https://api.minimax.io/v1` with
the credential in `MINIMAX_API_KEY` env only. The MiniMax key must also be
saved through Settings → Providers → MiniMax after every bridge restart
(session-only store).

## Stage 2 — Proof turn (agent-driven)

`POST /pi-native/proof` with
`providerProfileId: openai-compatible-ros-openrouter-test-api`,
`selectedModel: anthropic/claude-sonnet-4.5`, and a discriminating identity
prompt (the model must self-identify as Claude on OpenRouter, distinguishing
it from local ollama models). The real `pi` v0.74.2 process runs headless
(`--print --no-session`) with the credential ONLY in `OPENROUTER_API_KEY` env
and the isolated agent dir, never argv; cwd is the projected repo root. Only
redacted evidence returns.

## Stage 2B — Interactive Pi session (TUI, human + agent)

The extension's Pi panel (left rail → **Add-on Surfaces → pi-harness** → "Pi
session") now drives the REAL Pi terminal UI:

- Pick the provider profile (`openai-compatible-ros-openrouter-test-api`) and
  model (`anthropic/claude-sonnet-4.5`), then **Start session**. The bridge
  spawns real `pi` v0.74.2 inside a host-owned pseudo-TTY (node-pty, direct
  exec — no shell — `TERM=xterm-256color`) through the SAME clean chain as
  the proof: authorize gate → issued Project/Files projection → reviewed
  planner → bounded launcher. Credential is env-only; the raw plan never
  leaves the session service; the session dir is the isolated agent dir plus
  a host-appended `--session-dir`.
- Raw ANSI output streams to the panel over SSE
  (`GET /pi-native/tui-session/events?sessionId=…`); keystrokes return over
  `POST /pi-native/tui-session/input`; the panel resizes the PTY through
  `POST /pi-native/tui-session/resize`; **Cancel** sends SIGTERM (SIGKILL
  after the grace window) and the stream ends with a `pi.tui.exit` frame
  carrying the exit evidence. Teardown posts `dispose`, which drops the
  host-side session so a later events request is refused.
- Wire note: every SSE stream ends with a terminal `event: harness.close`
  frame (transport bookkeeping, matches the platform writer contract); the
  `pi.tui.exit` DATA frame is what carries the real outcome. The panel only
  surfaces the `harness.close` error payload when no exit frame arrived.
- With the canary still in the credential slot the TUI renders and pi sits in
  its auth-retry screen (OpenRouter 401) — expected; cancel the session.
  After the real key is saved (Stage 1), the same Start yields a fully
  interactive pi.

The xterm runtime is vendored under
`browser-first/resonantos-side-panel-extension/src/vendor/xterm/` and loads as
plain scripts (MV3 `script-src 'self'`), so no remote CDN or eval is involved.

## Stage 3 — Revocation check (agent-driven)

The agent-runtime grant is revoked through `/addons/grants`; a new proof request
must return 403 permission-denied while the provider credential stays
configured for other consumers. The grant is then restored.

## Hygiene checks (agent-driven)

- `~/.pi/agent/auth.json` hash/size/mtime unchanged (never written).
- Isolated agent-dir `auth.json` stays `{}`.
- No lingering `pi` process.
- No credential in any log, projection, argv, or registry snapshot.

If the credential save does not register: confirm nothing else is bound to
47773 and the extension has no stale Bridge-Target override.
