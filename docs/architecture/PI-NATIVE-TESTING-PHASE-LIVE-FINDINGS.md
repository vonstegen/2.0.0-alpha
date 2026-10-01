# Pi Testing-Phase Live Verification — Findings (2026-10-01)

Staged and executed against the testing bridge on `127.0.0.1:47773`
(isolated registry `/tmp/pi-testing-user-root`, real Settings provider store).

## Status

- Staging: complete and verified (bridge, addon installed + granted, extension
  token alignment).
- **Full credential chain proven with a shaped canary** (no inference): a
  `POST /pi-native/proof` for the OpenRouter account returned `200`, spawned
  the real `pi` v0.74.2 with the session credential ONLY in env, and
  OpenRouter answered `401 User not found.` — the Bearer header was attached,
  the key was parsed, and no user existed for the canary. The only remaining
  human step is entering the real OpenRouter test key through the ROS
  extension Settings (see the runbook), after which the identical proof runs
  with the real key.
- Live inference with the SESSION credential: pending that human save.

## Proven in this session

1. **Clean authorize gate.** Proof with the addon granted-less → 403; after
   agent-runtime revocation → 403 `permission-denied`; grant restored.
   No slot displacement anywhere in the chain.
2. **Fail-closed credential chain.** No credential → 503 `runtime-unavailable`,
   no spawn.
3. **Real launcher + session env as the credential source.** The final proof
   ran the REAL `pi` v0.74.2 binary (nvm allowlist, `source: "nvm"`),
   headless `--print --no-session`, cwd = the projected repo root, with the
   canary in `OPENROUTER_API_KEY` env only. Evidence was redacted (env key
   names only, no values, no `--api-key` in argv).
4. **Extension-path compatibility.** The testing bridge runs with the tokens
   baked into the ROS extension's generated bridge config; the extension's
   exact bootstrap + `/providers/credentials` flow succeeded (canary), proving
   the extension Settings surface reaches this bridge when its Bridge Target
   is the loopback bridge.

## Critical finding — auth.json precedence and its countermeasure

Pi 0.74.2's `AuthStorage.getApiKey()` prefers the DURABLE `~/.pi/agent/auth.json`
credential over the environment variable for any provider present there. The
harness countermeasure — now wired into the bridge — is to pin pi's agent dir
to a host-owned disposable directory via `PI_CODING_AGENT_DIR`
(`<user-root>/pi-coding-agent-isolated`). With the durable dir invisible, the
session env var is the ONLY key source for every provider, including those
present in the user's auth.json (openrouter, xai, minimax, zai). pi creates an
empty `{}` auth.json in the isolated dir; the session credential is never
written anywhere durable.

## Corrected sub-finding — "Missing Authentication header"

Earlier tests concluded OpenRouter ignored the env key because direct pi-ai
calls returned `401 Missing Authentication header.` That was wrong: OpenRouter
reports malformed key strings as "missing". The header was attached all along —
a canary in valid `sk-or-v1-…` shape returns `401 User not found.` (parsed,
no such user) from both the direct pi-ai layer and the full harness chain.
OpenAI's endpoint, by contrast, echoes `401 Incorrect API key provided: …`
for any nonempty key, which is why the two providers disagreed.

## Hygiene

- `~/.pi/agent/auth.json` unchanged (size 557, sha256
  `ac488b73…f73ac0`) — never written.
- Isolated agent dir `auth.json` is `{}` (pi-created, empty).
- No lingering pi processes.
- No credential value in any evidence, projection, argv, or registry snapshot.
- OMP / VIGIL / VIGIL-MCP processes untouched.
