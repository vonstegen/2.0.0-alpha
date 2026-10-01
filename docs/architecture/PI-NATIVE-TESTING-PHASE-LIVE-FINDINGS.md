# Pi Testing-Phase Live Verification — Findings (2026-10-01)

Staged and executed against the testing bridge on `127.0.0.1:47773`
(isolated registry `/tmp/pi-testing-user-root`, real Settings provider store).

## Status

- Staging: complete and verified (bridge, addon installed + granted, dev shell).
- Live inference with the SESSION credential: **not yet run** — the provider
  credential must be entered through ResonantOS Settings into the testing
  bridge, and repeated operator saves did not reach it (the flag stayed
  `providerProfileConfigured: false`). The prepared dev shell
  (`http://127.0.0.1:1430/`, Basic auth `dev` + page key) was verified to boot
  and read bridge state; the runbook
  (`PI-NATIVE-TESTING-PHASE-LIVE-RUNBOOK.md`) documents the remaining steps.

## What was proven without a real credential

1. **Clean authorize gate.** Proof request with the addon installed but
   ungranted → `403 permission-denied`. No slot displacement involved.
2. **Fail-closed credential chain.** With grants in place and no credential →
   `503 runtime-unavailable`; no pi process spawned.
3. **Real launcher.** A canary credential run executed the REAL `pi` v0.74.2
   binary resolved by the nvm allowlist (`source: "nvm"`), headless
   `--print --no-session`, cwd = the projected repo root, redacted evidence
   only (`envKeys` names, no values, no `env` object).

## Critical finding — auth.json precedence (design-relevant)

Pi 0.74.2's `AuthStorage.getApiKey()` prefers the DURABLE `~/.pi/agent/auth.json`
credential over the environment variable for any provider present there
(`core/auth-storage.js` + `core/model-registry.js` in the installed package).
Consequences observed live:

- With `OPENROUTER_API_KEY=<canary>` in the session env and OpenRouter present
  in the local auth.json, pi **ignored the session env** and answered with the
  auth.json credential (a real provider round trip occurred during
  verification; disclosed, one short call).
- With `OPENAI_API_KEY=<canary>` (OpenAI is NOT in auth.json), pi used the
  session env as the only source — the real OpenAI endpoint returned
  `401 Incorrect API key provided: canary…` (no inference).

Therefore the session-environment delivery guarantee holds only for providers
ABSENT from the user's auth.json. The live proof MUST use `shared-openai`
(gpt-5.5) — the only ROS profile whose Pi provider is not in auth.json — as
the runbook specifies. Providers present in auth.json (openrouter, xai,
minimax, zai here) would silently use the durable key, violating the
testing-phase credential contract.

Follow-up for the product owner: for auth.json-present providers, the host
cannot currently distinguish which source pi used; the adapter should either
refuse such providers (fail closed) or the harness must run pi with an
isolated `PI_CONFIG_DIR` so no durable credential is discoverable.

## Hygiene

- `~/.pi/agent/auth.json` unchanged (size 557, sha256
  `ac488b73…f73ac0`) — never written.
- No lingering pi processes.
- No credential value in any evidence, projection, argv, or registry snapshot.
- OMP / VIGIL / VIGIL-MCP processes untouched.
