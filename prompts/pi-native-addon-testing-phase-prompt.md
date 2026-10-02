# Prompt — Build the Pi Add-on to a Testing Phase (Pi-Native Phase 2 Integration)

**Role:** You are a ResonantOS engineer completing the Pi-native session integration.

**Goal:** Make the Pi add-on (`addon.pi-harness`) work end-to-end in a TESTING phase: a user configures a provider credential once in ResonantOS Settings, selects a model, spins a session from the Pi add-on workspace, and a REAL `pi` process calls a REAL provider model — with the credential delivered session-only (never durable, never in argv).

**Repository:** `vonstegen/2.0.0-alpha` (remote `origin`).

**State / branches:**
- Work on a NEW branch off `feature/pi-phase2c3-staging-identity-encoding` (candidate `e8074499bfe3b3f617133af88f65136a23242c71`).
- P2 credential work lives on `feature/pi-native-session-credential-p2` (HEAD `5ac7c248ed85cd07ff02c882f09d45ccb9cbcd99`).
- The two branches diverged: `pi-phase2` has the credential planner + resource/skills projection but NO launcher; `pi-native-p2` has the launcher + session service but NO projection.

**Already implemented (do NOT redesign):**
- `browser-first/host/pi-native-credential-adapter.mjs` — pure planner (host-owned mapping → protocol gate → session-env → secret-free argv). In `pi-phase2` its `plan()` derives cwd from `consumeProjection(projection, { addonId, sessionId })` (no static `projectPath`).
- `browser-first/host/pi-process-launcher.mjs` + `pi-native-session-service.mjs` (in `pi-native-p2` only) — bounded launcher: spawns only `piCommand()`; `shell:false`; argv `[--print, --no-session, --provider X, --model Y, prompt]`; never `--api-key`; private env only; bounded timeout + stdout/stderr capture; sanitized evidence.
- `browser-first/host/harness-resource-projection.mjs` (Phase 2B) and `harness-skills-projection.mjs` (Phase 2C).
- Generic harness boundary + host service (`harness-boundary.mjs`, `harness-host-service.mjs`) with `/agent/*` routes and a `resolveAdapter` factory.

**Work items (in order):**
1. Reconcile the branches: bring `pi-process-launcher.mjs`, `pi-native-session-service.mjs`, and the nvm-resolution in `pi-runtime.mjs` into the new branch, aligned with the Phase 2 planner signature (`consumeProjection`, no static `projectPath`).
2. Implement `browser-first/host/agent-adapters/pi-native.mjs` — a `pi-native-v1` adapter implementing the SAME interface as `agent-adapters/openai-compatible.mjs`: `probe`, `createSession`, `invoke` (async generator yielding `final`/`cancelled`/`error`), `cancel`, `history`, `status`, `selectModel`, `dispose`. It composes the credential planner + launcher. Model selection, bounded ephemeral history, and turn ownership are host-owned in the adapter, never read from the caller.
3. Wire a `pi-native-v1` branch into `resolveAdapter` in `harness-host-service.mjs` (currently only `provider-fabric-v1`, `dsh-typert-v1`, `openai-compatible-v1`; else `permission-denied`).
4. Fix `examples/addons/pi-harness.json`: change `agentRuntime.adapterId` from `openai-compatible-v1` to `pi-native-v1`; align `authScheme`/`credentialDelivery` to `session-environment` (not `bearer`/`runtime-adapter`).
5. Implement the clean authorize gate: authorize on installed + enabled + `agent-runtime` granted + approved binding via `registry.snapshot()`, NOT `authorize("primary-agent", addonId)` slot displacement.
6. Wire `consumeProjection` so the session cwd is the authorized project/files projection (and optionally stage Phase 2C skills into the session).
7. Research + map the REAL installed Pi CLI session semantics (`createSession`/`invoke`/`cancel`/`status`/`history`) onto the adapter. Installed Pi is v0.74.2 (config claims 0.80.3); built-in providers in 0.74.2 are minimax, ollama, openrouter, xai, zai (openai/deepseek NOT built-in). Use a discriminating identity prompt to prove the response came from the real model, not the local ollama default.
8. Build the session-spin UI in the `pi-workspace`/`pi-tool-panel` surfaces: model selection, start/invoke, streaming `/agent/events`, status, cancel.
9. Tests: unit tests for the adapter + host wiring (canary secrets only), plus run the existing 285-test baseline.

**Hard constraints (STOP rather than weaken):**
- NEVER ask for, handle, or print real API keys. The user enters the credential ONLY through ResonantOS Settings. Tests use canary strings only.
- The credential must never appear in argv, manifest, git, logs, evidence, projections, or Pi `auth.json`. Delivery is `session-environment` only; never `--api-key`.
- Only `redactLaunchPlan()` output may cross an observability/UI boundary; never the raw launch plan.
- No PTY/TUI/embedded terminal; no arbitrary shell (`shell:false`); no arbitrary caller argv; no arbitrary manifest command.
- Do NOT modify Pi `auth.json`, provider profiles, or existing credentials.
- Do NOT merge to `dev`; do NOT start Phase 2D; do NOT run live inference without explicit authorization.
- Do NOT interfere with OMP/VIGIL/VIGIL-MCP processes.

**Environment:**
- Node `v24.21.0` at `/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node` (PATH has v22.13.0 — pin the binary for anything with an engine gate).
- Vitest `4.1.11` (run via `node node_modules/vitest/vitest.mjs run …`).
- Existing `.mjs` tests use Node's built-in `node:test`.

**Definition of done (testing phase):**
- Unit/integration tests pass (adapter + wiring + full baseline).
- A live, user-controlled run where: Settings credential → provider profile → grant → session-scoped credential → REAL `pi` process → REAL provider model → REAL response → session authority cleaned up, with NO durable credential copy.
- Revocation after the session yields `permission-denied` on a new launch plan, while the shared provider credential remains usable by other authorized consumers.
