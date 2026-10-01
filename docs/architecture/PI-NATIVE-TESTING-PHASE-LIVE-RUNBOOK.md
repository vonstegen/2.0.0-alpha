# Pi Testing-Phase Live Run — Operator Runbook

Testing bridge: **running** on `http://127.0.0.1:47773` (pi-phase2 worktree).
Registry is isolated (`/tmp/pi-testing-user-root`); the provider store is the real
`~/ResonantOS_User` Settings store. `addon.pi-harness` is installed, enabled, and
granted (agent-runtime, network, chat-interface, filesystem).

## Why the provider is `shared-openai` (not OpenRouter)

Pi 0.74.2's auth storage prefers `~/.pi/agent/auth.json` over the environment
variable for any provider present there. OpenRouter (and xai/minimax/zai) exist
in the local auth.json, so an `OPENROUTER_API_KEY` session env var is ignored
and the durable key is used instead — the exact behavior this phase must avoid.
OpenAI is NOT in auth.json: a canary-key run proved the session env var is the
only key source (`401 Incorrect API key provided: canary…` from the real
OpenAI endpoint, no inference).

## Stage 1 — Credential through Settings (human-only)

1. Terminal, in the pi-phase2 worktree:

   ```bash
   cd /Users/andrewjochl/Developer/Projects/resonant-os/pi-phase2
   npm run dev
   ```

   Shell opens at `http://127.0.0.1:1430`; its dev bridge config points at the
   running testing bridge (47773). Do NOT start another bridge.

2. In the shell: **Settings → Providers → Shared OpenAI** → enter the OpenAI API
   key → **Save**. The value lives only in the bridge's session memory.

3. The agent re-checks the registry flag (never the key) and proceeds.

## Stage 2 — Proof turn (agent-driven)

`POST /pi-native/proof` with `providerProfileId: shared-openai`,
`selectedModel: gpt-5.5`, and a discriminating identity prompt (the model must
self-identify as OpenAI GPT, distinguishing it from the local ollama models and
any other consumer). The real `pi` v0.74.2 process runs headless
(`--print --no-session`) with the credential ONLY in `OPENAI_API_KEY` env,
never argv; cwd is the projected repo root. Only redacted evidence returns.

## Stage 3 — Revocation check (agent-driven)

The agent-runtime grant is revoked through `/addons/grants`; a new proof request
must return 403 permission-denied while the shared provider credential stays
configured for other consumers. The grant is then restored.

## Hygiene checks (agent-driven)

- `~/.pi/agent/auth.json` hash/size/mtime unchanged (never written).
- No lingering `pi` process.
- No credential in any log, projection, argv, or registry snapshot.

If the credential save does not register: confirm the shell at 1430 is the
pi-phase2 dev server and nothing else is bound to 47773.
