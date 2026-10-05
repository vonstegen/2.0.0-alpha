# Terminal Host — Step 4: External Env Wiring — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

Step 3 (route + credential resolver + `ros-session` CLI) is complete and green.
This prompt implements **Step 4, scoped to the external terminal path only**:
make `launchBootstrap` deliver the full projected session environment
(project / files / skills / credential) into the adopted iTerm2/Ghostty
session — instead of just minting and echoing a grant.

The external-vs-embedded fork is **decided**: external-first, embedded TUI
deferred. See `docs/architecture/TERMINAL-HOST-SURFACE-DECISION.md`. Do **not**
build the embedded TUI host services (`pi-native-tui-host-service.mjs`,
`pi-native-session-service.mjs`, etc.) in this step.

---

## 0. Authority (read first)

- `browser-first/host/terminal-host-service.mjs` — `launchBootstrap`,
  `attachSessionEnv`, `mintSessionBootstrapGrant`, `trackSessionBootstrapGrant`,
  `consumeGrant`, `createTerminalHostCredentialResolver`,
  `GRANT_PUBLIC_REJECTION_REASONS`.
- `browser-first/host/harness-session-environment.mjs` — `buildSessionEnvironment`
  (the only place a credential value may enter the env, under a host-owned name).
- `browser-first/host/harness-resource-projection.mjs` —
  `createHarnessResourceProjection`, `deriveProjectionOperations`.
- `browser-first/host/harness-skills-projection.mjs` —
  `createHarnessSkillsProjection`, `buildSkillCatalogFromManifests`,
  `deriveStagingIdentity`.
- `browser-first/host/harness-host-service.mjs` — `POST /terminal-host/session/attach`
  (the route the CLI calls).
- `browser-first/bin/ros-session.mjs` — the `attach` subcommand
  (`readTokenFile` reads-then-unlinks; `attach()` POSTs the grant).
- `browser-first/host/pi-native-provider-map.mjs` — `resolvePiNativeProvider`.
- `src/core/terminal-host-contract.ts` — `SessionBootstrapGrant`.
- Adapters (the stdio peers that run the bootstrap command in a window):
  `examples/sdk-demo/terminal-host/iterm2/adapter.py`,
  `examples/sdk-demo/terminal-host/ghostty/adapter.mjs`.

---

## 1. Hard rules

1. **Token never argv/env/shell history.** The grant token rides a 0600 file +
   the POST body only (the Step-3 decision). Never a literal in the composed
   command string.
2. **Secret never argv/env/logs/shell history.** The credential value enters
   only under the host-owned env name inside `buildSessionEnvironment`, and is
   delivered to the shell via the route → CLI → `eval "$(...)"` — never a
   literal in the composed command string.
3. **No terminal IO in the composition layer.** `launchBootstrap` composes a
   command string and writes a token file; the *adapter* runs the command. Keep
   the host service free of terminal reads/writes.
4. **F2 split holds.** The 4 adapter ops (`createSession` / `launchBootstrap` /
   `sendInput` / `terminateSession`) never gain ROS session verbs
   (`adopt` / `attach` / `detach` / `listSessions` / `getSessionState`).
5. **Fail closed.** Missing project / skills / provider / credential → deliver
   whatever is legitimately resolvable, or reject; never fabricate a value or
   echo a secret.
6. **No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`.**
   Commit per phase (`feat(terminal-host):` / `test(terminal-host):`).

---

## 2. Phase 4A — complete the projected env · gate CP-S4a

Today `attachSessionEnv` composes only `PATH`/`HOME` + credential. The
resource/skills projections were carried in L2/L3 but are **not wired** into the
env. Wire them so the "projected session environment" actually means
project + files + skills + credential.

Requirements:

1. Add a composition that, given host inputs, produces the full projected env:
   - `authorizedProject` `{ id, label, root }`
   - resource/skills request + `grantedCapabilities`
   - `skillCatalog` + `skillSourceRoot` + `stagingBase`
   - `providerProfileId` + `resolveCredential`
   - `baseEnv` / `envAllowlist` / `parentEnv` (unchanged semantics)
2. Run `createHarnessResourceProjection` (project root / files) and
   `createHarnessSkillsProjection` (skills staged into `stagingBase`) and emit
   their results as **host-owned env names** that satisfy `SESSION_ENV_NAME_PATTERN`
   (`/^[A-Z_][A-Z0-9_]*$/`).
3. Combine with `buildSessionEnvironment` so the credential still enters only
   under the host-owned name from `resolvePiNativeProvider`.
4. Keep `meta` non-secret (sessionId / harness / project id / providerProfileId
   only — never values, never the token).

**Design point (resolve + record in the commit message):** choose the canonical
env-var names for project root and skills dir (e.g. `ROS_PROJECT_ROOT`,
`ROS_SKILLS_DIR`). They are host-owned and must pass the ENV_NAME pattern.

**Shape:** prefer extending `attachSessionEnv` with optional projection inputs
(backward-compatible defaults) so the existing route + CLI chain benefits, **or**
add a `buildProjectedSessionEnv` and have the route prefer it. Pick one and keep
the route's `{ ok, env, meta }` contract stable.

**CP-S4a gate:** a test proves a projected env includes project-root +
skills-dir + credential keys, stages skills under `stagingBase`, and fails
closed (no fabricated values) when project/skills/credential inputs are absent.

`STOP AND REPORT` here.

---

## 3. Phase 4B — `launchBootstrap` delivers the env · gate CP-S4b

Extend `createTerminalHostService`'s `launchBootstrap` so the terminal ends up
with the projected env exported in its shell.

Requirements:

1. Accept the attach context on `launchBootstrap`: `providerProfileId`,
   `harness`, `project`, plus the projection inputs (or a precomputed attach
   payload). Keep the existing `bootstrapCommand` as an explicit override that
   skips composition when supplied.
2. Mint + track the grant (unchanged — `mintSessionBootstrapGrant` +
   `trackSessionBootstrapGrant`).
3. Write the grant token to a **0600 temp file** (TOCTOU-safe), and compose the
   command the adapter will run:
   `eval "$(ros-session attach --session-id <id> --token-file <file> --provider-profile-id <id> [--harness <id>] [--project <json>])"`
   — resolved against a script path (absolute path to
   `browser-first/bin/ros-session.mjs`, or a `ros-session` on PATH).
4. Send the composed command + grant to the adapter via the existing
   `launchBootstrap` RPC (transport unchanged).

**Design point (resolve + record):** token-file lifecycle. The CLI's
`readTokenFile` already renames-then-unlinks on success. Decide whether
`launchBootstrap` also needs a fallback cleanup (e.g. on adapter error) and
record it. The token must never appear in `ps`, argv, env, or shell history —
only the *file path* may appear in the command string.

**CP-S4b gate:** a test proves `launchBootstrap` composes a valid
`ros-session attach` command whose argv contains the token-file **path** but
never the token **value**; the token exists only in the 0600 file; and the
grant is tracked (single-use/audience-bound) exactly as in Step 2.

`STOP AND REPORT` here.

---

## 4. Phase 4C — external smoke · gate CP-S4c

A manual smoke (model it on `examples/sdk-demo/terminal-host/iterm2/smoke.mjs`
and `.../ghostty/smoke.mjs`) that:

1. Creates a session, then calls `launchBootstrap` with a stub host resolver
   (inject `getProfile`/`resolveSecret` returning a fake credential — no real
   secret) and a minimal authorized project + empty skill catalog.
2. Asserts the adapter receives a command that is a `ros-session attach`
   invocation, the token file exists with mode `0600`, and (on success) the
   file is unlinked after the CLI consumes it.
3. Does **not** print the token or the (fake) credential value to stdout/stderr.

Record the run output in the report. If a real provider is not configured, the
smoke may stop at "command delivered + token consumed" — that is acceptable for
this gate; the full "Pi actually uses a real credential" proof is Step 5.

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
  browser-first/test/ros-session.test.mjs
```

---

## 6. Verification discipline + STOP AND REPORT

Never trust a green number you did not produce yourself. Re-run; paste summary +
last ~20 lines per command. Report test counts **named by label**
(core / demo / browser-first). Do not count `src/sdk/addons/harness-resources.test.ts`
in the browser-first `node --test` bucket (it runs under core vitest).

---

## 7. Out of scope (do not build here)

- The embedded TUI host services (`pi-native-tui-host-service.mjs`,
  `pi-native-session-service.mjs`, `pi-process-launcher.mjs`, `grok-native-*`,
  `opencode-session-host-service.mjs`).
- TH-6 (attaching Pi as the ADR-039 `cli` harness) and the end-to-end
  "Pi uses ROS memory/skills/credentials" proof — that is Step 5.
- Installing the real host profile store / secret resolver / project store /
  skill-catalog source. Step 4 uses injectable seams (like
  `createTerminalHostCredentialResolver`); host installation is a Step 5
  follow-up.

After CP-S4c clears, **Step 4 is complete** — report that explicitly, then
pause for the Step 5 (TH-6 Pi attach) prompt.
