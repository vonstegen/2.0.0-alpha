# Terminal Host — Step 5 (TH-6): Attach Pi as a cli Harness + End-to-End Proof — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

Steps 1–4 are complete and green: the env seam is carried, the ROS session
manager + grant broker + route + credential resolver + `ros-session` CLI exist,
and `launchBootstrap` now delivers a full projected env into an adopted
external terminal. This prompt is the final integration: **attach Pi as a
harness that runs in the adopted terminal and actually uses ROS-granted
project / files / skills / credential — then prove it end-to-end.**

The surface decision is **external-first** (see
`docs/architecture/TERMINAL-HOST-SURFACE-DECISION.md`): Pi runs in the adopted
iTerm2/Ghostty session via the `launchBootstrap` chain, **not** as a
bridge-spawned embedded PTY. Do not build `pi-native-tui-host-service.mjs` /
`pi-native-session-service.mjs` here.

---

## 0. Authority — ground truth (read first, do not guess paths)

- `browser-first/host/terminal-host-service.mjs` — `launchBootstrap`,
  `buildProjectedSessionEnv`, `createTerminalHostCredentialResolver`,
  `attachSessionEnv`, `composeBootstrapCommand`, `trackSessionBootstrapGrant`.
- `browser-first/host/harness-host-service.mjs` — `resolveAdapter`,
  `createHarnessRegistry`, `POST /terminal-host/session/attach`,
  `POST /agent/session`, `POST /agent/turn`, `boundary.invoke`, `boundary.events`.
  `resolveAdapter` currently supports only `provider-fabric-v1`,
  `dsh-typert-v1`, `openai-compatible-v1` — there is **no** Pi/`cli` branch yet.
- `browser-first/host/pi-runtime.mjs` — `piCommand()` (fixed-install-root
  allowlist for the `pi` executable; the only place the `pi` name is trusted).
- `browser-first/host/pi-native-credential-adapter.mjs` —
  `createPiNativeCredentialAdapter` (composes `resolveExecutable`,
  `allProviderProfiles`, `allModelCatalog`, `credentialEnv`, `authorize`,
  `consumeProjection`, `envAllowlist`, `baseEnv`).
- `browser-first/host/pi-native-provider-map.mjs` — `resolvePiNativeProvider`.
- Provider host functions that already exist (do not reimplement):
  `readProviderSecrets()` (session-only secrets, e.g. `shared-openai`,
  `shared-minimax`, …), `allProviderProfiles()`, `allModelCatalog()`.
  Locate their export site in the provider host / agent-control host and wire
  them in — see
  `browser-first/host/agent-control-host-service.mjs` (destructures
  `readProviderSecrets`, `allProviderProfiles`, `allModelCatalog`).
- Existing Pi manifests (two, do not conflate):
  - `browser-first/host/harness-examples/pi.json` — `addon.pi`, the OLD
    `openai-compatible-v1` HTTP wrapper + `credentialBinding: "pi.dev"`.
    ADR-039 migration step 4 retires this; the Step-5 attach path replaces its
    runtime, not its manifest identity.
  - `examples/addons/pi-harness.json` — `addon.pi-harness`, the
    provider-profile harness example (session-environment delivery).
- `docs/architecture/ADR-039-harness-addon-category-swappable-default-agent.md`
  — the `cli` harness proposal (status **Deferred**). This step implements the
  narrow external slice of its `cli` variant (spawn + scoped env), not the full
  harness-category migration.

---

## 1. Hard rules

1. **Token/secret never argv/env/shell history/logs.** The credential value
   enters only under the host-owned env name via `buildSessionEnvironment`
   (route → CLI → `eval "$(...)"`). The grant token rides a 0600 file + POST
   body only.
2. **`pi` executable only via `piCommand()`.** Never a manifest field, ambient
   `PATH`, or caller argv.
3. **F2 split holds.** Adapter ops stay `createSession` / `launchBootstrap` /
   `sendInput` / `terminateSession`; ROS verbs stay on the session manager.
4. **Fail closed.** Missing profile/credential/project/skills/`pi` binary →
   reject (`runtime-unavailable` / `missing-credential` / `permission-denied`),
   never fabricate.
5. **No terminal IO in the composition layer.** The adapter runs the command;
   the host service only composes + issues the RPC.
6. **No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`.**
   Commit per phase (`feat(terminal-host):` / `test(terminal-host):`).

---

## 2. Phase 5A — host installation · gate CP-S5a

`createTerminalHostCredentialResolver` (Step 3) and the route's
`resolveCredential` injection are host-agnostic seams. Install real host
resolvers now:

1. Build/install a `getProfile(profileId)` from `allProviderProfiles()` and a
   `resolveSecret(profile)` from `readProviderSecrets()`.
2. Wire them so the `POST /terminal-host/session/attach` route defaults to the
   host-owned resolver (a real credential lands under the `resolvePiNativeProvider`
   env-var name; `shared-*`/`anthropic` still fail closed per the frozen map).
3. Wire a host project store + skill-catalog source so `buildProjectedSessionEnv`
   receives a real `authorizedProject` + `skillCatalog` (not test fixtures) when
   the caller supplies a project/session identity. If a real project store does
   not exist, add a minimal host-owned one (never a caller-supplied root); the
   projection already enforces `validProjectIdentity`.

**Design point (resolve + record):** where these resolvers are assembled (a new
`terminal-host-host-wiring.mjs`, or injected into `createHarnessHostService`'s
dependencies). Prefer assembling at the host boundary (one place), mirroring how
`readProviderSecrets`/`allProviderProfiles` are already injected.

**CP-S5a gate:** a test proves the route resolves a real (injected) profile →
env-var name → secret, `shared-*`/`anthropic` fail closed, and a real project +
catalog feed `buildProjectedSessionEnv` into `ROS_PROJECT_ROOT` /
`ROS_PROJECT_CWD` / `ROS_SKILLS_DIR`.

`STOP AND REPORT` here.

---

## 3. Phase 5B — attach Pi as a `cli` harness · gate CP-S5b

Add a reviewed Pi branch to `resolveAdapter` (e.g. adapter id `pi-terminal-v1`)
so that `addon.pi` (and/or `addon.pi-harness`) can own a harness turn whose
runtime is the **adopted external terminal**, not a provider fabric or an HTTP
endpoint.

The adapter's `invoke` must:

1. Validate `pi` via `piCommand()`; absent → `runtime-unavailable`.
2. Resolve the projected session env via `buildProjectedSessionEnv`
   (project + files + skills + credential), using the Phase-5A host resolvers.
3. Drive the **terminal-host** path: mint/track a grant, write the 0600 token
   file, and compose a bootstrap command that runs `pi` after the env is
   exported — e.g. `eval "$(ros-session attach …)"; <pi> …` — then issue it via
   `launchBootstrap` (reuse `composeBootstrapCommand` / the Step-4 machinery;
   do not duplicate it).
4. Stream the turn back as harness events: subscribe to the terminal telemetry
   (`terminal.command.started` / `terminal.command.ended` /
   `terminal.session.terminated`) and translate to `delta`/`final`/`error`
   harness events with correct provenance.

**Design point (resolve + record, then STOP AND REPORT before building if you
intend to deviate):** how the chat input reaches `pi`. The external-first
default is: the composed bootstrap command carries the prompt (quoted) as a
`pi` argument or a here-doc/stdin from a file written alongside the token file.
Never place the prompt or a secret in `ps`/argv in a way that leaks — quote via
`shellQuote` and prefer a file for multi-line prompts. Record your choice.

**CP-S5b gate:** a unit test drives `adapter.invoke` against a stubbed
terminal-host service (no real iTerm2) and asserts: `piCommand()` is consulted,
`buildProjectedSessionEnv` runs, a `launchBootstrap` RPC is issued with a
composed command whose argv references the token-file **path** and prompt file
but never the token **value** or the credential, and terminal telemetry maps to
`delta`/`final` harness events.

`STOP AND REPORT` here.

---

## 4. Phase 5C — end-to-end proof · gate CP-S5c

Produce the acceptance evidence (manual smoke, model it on
`examples/sdk-demo/terminal-host/iterm2/smoke.mjs`):

1. Adopt a real iTerm2 (or Ghostty) session; create + attach the session.
2. `launchBootstrap` with a real authorized project + a real (or injected)
   provider profile + a real skill catalog.
3. Run `pi` inside the session and observe it resolves the credential
   (e.g. `pi` model listing reflects the provider configured via the
   delivered env) and sees `ROS_PROJECT_ROOT` / `ROS_SKILLS_DIR`.

**Prerequisite:** `pi` must be installed
(`npm install -g @earendil-works/pi-coding-agent`); `piCommand()` already
encodes the fixed-install-root discipline. If `pi` is not installed on AVIS,
record that as the blocker and stop — do not fake the evidence.

Record the run output. The proof is complete when real text lands in the
adopted terminal, the credential/project/skills env is exported, and `pi`
observably uses them (capture the evidence).

`STOP AND REPORT` here.

---

## 5. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run                                                   # core (735)
npx vitest run --config examples/sdk-demo/vitest.config.ts        # demo (103)
node --experimental-strip-types --test \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs
```

---

## 6. Verification discipline + STOP AND REPORT

Re-run every gate yourself; paste summary + last ~20 lines per command. Report
test counts **named by label** (core / demo / browser-first). Do not count
`src/sdk/addons/harness-resources.test.ts` in the browser-first bucket.

---

## 7. Out of scope (do not build here)

- The embedded TUI host (`pi-native-tui-host-service.mjs`,
  `pi-native-session-service.mjs`, `pi-process-launcher.mjs`, `grok-native-*`,
  `opencode-session-host-service.mjs`).
- The full ADR-039 harness-category migration (`runtimeType: "harness"`,
  the Agent/Harness picker, retiring `openai-compatible-v1` wholesale). Step 5
  adds the external `cli` runtime path; the category migration is a follow-up.

After CP-S5c clears, **TH-6 is complete** — report that explicitly, with the
end-to-end evidence attached.
