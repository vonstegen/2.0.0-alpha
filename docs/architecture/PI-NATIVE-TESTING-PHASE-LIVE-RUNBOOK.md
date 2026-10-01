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
2. **Settings → Providers → OpenRouter** (the `ros-openrouter-test-api`
   account) → enter the OpenRouter test API key → **Save**. The value lives
   only in the bridge's session memory — never in argv, auth.json, a file, or
   a log.
3. Tell the agent; it re-checks the registry flag (never the key) and runs
   the proof. A successful turn is a real OpenRouter response from
   `anthropic/claude-sonnet-4.5`; if a stale canary is still in place the
   provider returns 401 and the turn fails closed.

## Stage 2 — Proof turn (agent-driven)

`POST /pi-native/proof` with
`providerProfileId: openai-compatible-ros-openrouter-test-api`,
`selectedModel: anthropic/claude-sonnet-4.5`, and a discriminating identity
prompt (the model must self-identify as Claude on OpenRouter, distinguishing
it from local ollama models). The real `pi` v0.74.2 process runs headless
(`--print --no-session`) with the credential ONLY in `OPENROUTER_API_KEY` env
and the isolated agent dir, never argv; cwd is the projected repo root. Only
redacted evidence returns.

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
