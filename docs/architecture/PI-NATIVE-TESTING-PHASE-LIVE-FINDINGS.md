# Pi Testing-Phase Live Verification — Findings (2026-10-01)

Staged and executed against the testing bridge on `127.0.0.1:47773`
(isolated registry `/tmp/pi-testing-user-root`, real Settings provider store).

## Postmortem — workspace said "Bridge unavailable" while the bridge was fine (2026-10-01, ~17:24 EDT)

**Symptom.** Workspace banner: red "Bridge unavailable. Check Settings →
Bridge Target and the bridge process." Left rail: "Add-on Surfaces: No
authorized tool-panel surfaces." User reported: "NO Pi or Grok-Build add-ons
and this message."

**Real state (contradicting the banner).** `lsof -nP -iTCP:47773 -sTCP:LISTEN`
showed the bridge node process (pid 85574) alive and listening. 120/120 raw
sockets to 127.0.0.1:47773 succeeded over a 60-second sample. The bridge
*was* healthy.

**Root cause.** Config drift between worktrees.

```
2.0.0-alpha/.../src/bridge-config.generated.js
  bridgeUrl: http://127.0.0.1:47773  ← live bridge's port + token  (last
  bridgeToken: rdfyjPeEx0Xy4NSrEEjpoctS4O-VBIfo1TfTkCdA2a0        written 28 Sep
  capabilityBootstrapToken: 48QCyNLy1asBkKF2bQhUc5dkFFxXFCaq2UIJrKiMOCE

pi-phase2/.../src/bridge-config.generated.js
  bridgeUrl: http://127.0.0.1:49636  ← dead bridge port from an old
  bridgeToken: p8-collision-token    run; last written 1 Oct 17:24 by a
                                       different (now-dead) bridge process
```

The user has been loading the **pi-phase2** extension folder (per the URL
`chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html`
and the work we've been doing here). The pi-phase2 generated config was
written by a previous bridge process that ran on port 49636 — a port that
no longer has anything listening. The user's Chrome was dutifully calling
127.0.0.1:49636, getting ECONNREFUSED every fetch, retrying, and eventually
marking the bridge as `persistent` in the reachability store.

**Why the launch script didn't catch this.**

`/tmp/pi-testing-bridge-launch.sh` extracts the bridge token and bootstrap
token from `2.0.0-alpha/.../bridge-config.generated.js` (the main worktree),
but does **not** set `RESONANTOS_EXTENSION_ROOT`. So:

1. The bridge code writes its own generated config to its own `repoRoot` —
   the pi-phase2 worktree (since the bridge was started from
   `pi-phase2/browser-first/host/run-bridge-minimal.mjs`).
2. The bridge used the **tokens from 2.0.0-alpha** (because the launch
   script read them from there) but the **port from its own `startBridgeServer`**
   — which honors a fixed `--bridge-port=47773` request.
3. In an earlier session, a different bridge (or test) had run on port 49636
   and overwritten the pi-phase2 config with that port + a different token.
4. On the most recent bridge restart, the new bridge correctly self-rewrote
   the pi-phase2 config — but the actual file on disk at the time of the
   user-reported outage was the stale 49636 entry (the restart I did
   *during* this session, 17:24, was still writing to that file but the
   file's effective contents at the moment of the screenshot showed 65047
   → then 49636 → now 47773 as I traced it across reads).
5. Chrome MV3 caches the loaded config in the service worker. The workspace
   tab was still alive from before the restart, so its in-memory
   `__RESONANTOS_BRIDGE_CONFIG__` pointed at the dead port and never
   re-read the file.

**Why the banner couldn't recover.** Even with my new retry layer, the
reachability store only transitions out of `persistent` when a fetch
succeeds. With the config pointing at the wrong port, every fetch hits
ECONNREFUSED on the dead bridge — not a transient burst on the live one.
The store can't tell the difference; retrying a dead port looks exactly
like a sustained outage on the right port.

**Fix applied.**

1. Copied the live (2.0.0-alpha) generated config over the stale pi-phase2
   one — the ports/tokens now match.
2. Killed the running bridge (pid 85574) and restarted it with
   `RESONANTOS_EXTENSION_ROOT=/Users/andrewjochl/.../pi-phase2/.../resonantos-side-panel-extension`
   so every future restart writes its own config into the pi-phase2 worktree
   (no more drift).
3. Live HTTP probe against the new config: `200 OK` from
   `POST /api/capability-tokens`, `200 OK` from `GET /addons/registry`,
   installations: `['addon.pi-harness', 'addon.grok-build']`.
4. User reloaded the extension and confirmed: "Add-ons are back."

**Defenses to add (follow-ups).**

- **Launch script should set `RESONANTOS_EXTENSION_ROOT`** explicitly to the
  worktree whose extension the user is loading. Today it reads tokens from
  2.0.0-alpha but doesn't tell the bridge which worktree owns the config.
  Trivial fix: set `RESONANTOS_EXTENSION_ROOT` to the same path that owns
  the tokens. Until that's done, every restart is a coin flip whether the
  written config matches the loaded extension.
- **Bridge should sanity-check at startup** that its own
  `writeBridgeConfig` target dir actually contains the same tokens it was
  started with, and fail loudly if they diverge. Cheap; prevents silent
  drift.
- **Extension should re-read the generated config on a 401/token mismatch
  error**, not only on rebindBridge. A 401 with a different token in the
  response (or any bootstrap mismatch the bridge detects) should trigger
  `resolveBridgeConfig` and a rebind. Today the config is only refreshed
  on `chrome.runtime.onInstalled` / `chrome.runtime.onStartup`.
- **Reachability store should distinguish "wrong port" from "burst"** — if
  every retry attempt refuses with ECONNREFUSED and the bursts don't
  correlate with socket open/close timing, escalate to a settings-level
  hint ("bridge target URL may be wrong") rather than a transient banner.
  Defer until we have a heuristic that doesn't false-positive on real
  bursts.
- **Workspace should not cache the resolved bridge URL across reloads when
  the bridge is unreachable** — currently the boot path can resolve a
  dead URL and pin it for the session lifetime. A periodic re-check
  (e.g. when the tab is foregrounded, the network changes, or the user
  clicks Settings → Bridge Target) would self-heal faster.

**Lesson.** The banner is doing its job (correctly saying "unavailable")
but the user's mental model ("the bridge is broken") didn't match reality
("the bridge is fine, the extension is calling the wrong port"). The
banner copy should probably say "Bridge target unreachable — check Settings
→ Bridge Target" rather than "the bridge process" so the wrong-port case
is more discoverable. Filed as a copy fix; not blocking.

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

## Interactive TUI session — proven live (2026-10-01)

The extension Pi panel (Add-on Surfaces → pi-harness → "Pi session") drives
the REAL Pi TUI through a host-owned pseudo-TTY (node-pty, direct exec, no
shell). Live proof against the testing bridge:

- `POST /pi-native/tui-session` → 200 with a real sessionId; pi v0.74.2
  spawned (verified by pid and by its session record in the isolated
  `--session-dir`).
- SSE stream delivered 21 raw ANSI `pi.tui.data` frames (full TUI renders,
  ~950–1020 bytes each) through the bridge's standard SSE writer.
- `cancel` → SIGTERM → exit frame
  `{exitCode: 0, signal: 15, aborted: true, spawnError: null}` delivered,
  followed by the terminal `event: harness.close` frame and a clean EOF.
- `dispose` removes the session; a later events request is refused (403).
- Credential stayed env-only (`OPENROUTER_API_KEY`), never in argv,
  projections, or logs.

## Bugs found and fixed during the TUI smoke

1. **`startSession` called the wrong launch function.** It invoked
   `launcher.launchInteractive` (the injected parameter) instead of the
   resolved `launch` const — every session failed with an opaque 503. Fixed
   in `pi-native-session-service.mjs`.
2. **`createRequire` under ESM.** Loading node-pty via bare
   `require("node:module")` inside an ESM module threw `require is not
   defined`. Fixed with a top-level `import { createRequire } from
   "node:module"` and `createRequire(import.meta.url)` in
   `pi-process-launcher.mjs`.
3. **SSE streams never ended on normal completion.** The TUI subscription's
   `close()` no-oped once `complete()` had run, but the bridge SSE writer
   (`writeBridgeEventStream`) only ends a response through
   `subscription.close() → transport.terminate()`; a normally completed
   session left the client hanging with the response open. Fixed: `close()`
   always terminates — the terminal `harness.close` frame is transport
   bookkeeping (the platform's own harness reference subscription behaves the
   same way); the `pi.tui.exit` data frame carries the real outcome. The
   extension consumer now surfaces the `harness.close` error payload only
   when no exit frame was seen.
4. **Restart hygiene.** A bridge process that had been restarted mid-edit
   served dead TUI sessions (pi exiting instantly, no frames); a clean
   restart after the edits behaved correctly. Always restart the bridge
   after touching its sources — do not trust a pre-edit process.

## MiniMax as a second approved binding (2026-10-01)

User request: MiniMax through the pi add-on. Two platform constraints made
this a code change, not just operator config:

- `createHarnessCredentials` requires binding NAMES to be unique (fail-closed
  at bridge startup).
- The original pi-native authorize gate required
  `binding.name === installation.agentRuntime.credentialBinding` — one name,
  one profile, so a second provider was structurally impossible.

Resolution: the gate now authorizes on (addonId, adapterId, authScheme,
operator-approved providerProfileId); the binding name stays the
generic-harness credentialBinding identity (still unique per
`createHarnessCredentials`). Two bindings — `pi.native` (OpenRouter) and
`pi.native.minimax` (`shared-minimax`) — now approve different provider
profiles for the same addon. Proven with a shaped canary: create 200, real pi
TUI streamed, typed input reached MiniMax's API, and MiniMax answered its own
`401 authentication_error` (header attached, key rejected) — the full chain
works with the credential in `MINIMAX_API_KEY` env only.

Note: provider credentials are SESSION-ONLY in the bridge's memory. Every
bridge restart wipes them, so both the OpenRouter and MiniMax keys must be
re-saved through Settings after each restart, and running sessions capture
the credential at start.

## Grok Build as a second first-class harness add-on (2026-10-01)

Operator decision: Grok-Build (previously a quick SDK demo, content lost in
the worktree prune) is promoted to a first-class harness add-on through the
same dynamic architecture as Pi — `examples/addons/grok-build.json`,
`classification: harness/coding-agent`, adapter `pi-native-v1`, binding
`grok-build.native` → `shared-xai` (xAI, OpenAI-compatible, `api.x.ai/v1`).

- **Dynamic rail discovery proven for a second add-on**: install + grant via
  the bridge routes → the registry projection renders BOTH `Pi` and
  `Grok Build` tool-panel entries. Zero rail code, zero hard-coded add-on ids
  (ADR-040 end to end).
- **Bug found + fixed — single-manifest TUI route.** `createPiNativeTuiHostService`
  was constructed with one fixed manifest; every `/pi-native/tui-session`
  create was a pi-harness session regardless of profile, so the grok-build
  binding could never authorize (403). The route now requires `addonId` and
  resolves the manifest dynamically via a new host-only
  `registry.manifest(addonId)` accessor (durable-registry source of truth —
  route-installed manifests resolve identically after restarts). Unknown ids
  fail closed (`permission-denied`). The extension panel sends `addonId`
  explicitly; tests cover per-addon resolution and the fail-closed paths.
- **Dedicated panel pickers.** The projection now exposes
  `approvedProviderProfileIds` per add-on (operator bindings, same semantics
  as the authorize gate: addonId + adapterId + authScheme, no binding-name
  coupling). Pi panel → its two approved profiles (OpenRouter, MiniMax);
  Grok Build panel → `shared-xai` only. `sanitizedRuntime` gained
  `authScheme` to make the match possible.
- **Session label derives from the installation** (`chatAuthorLabel` →
  "Grok Build session"), no longer hard-coded "Pi session".
- **Chain proof (canary)**: direct pi probe with `--provider xai --model
  grok-4` → xAI answered `400 Incorrect API key provided` (header attached,
  canary parsed). Bridge create for `addon.grok-build` → 200, real pi spawn;
  session record shows provider `xai`, model resolved `grok-4.3`, exchange
  completed. Real inference awaits the operator's xAI key in the
  `xAI (shared)` account (canary currently saved, session-only).
- Grant validation note: `setGrants` matches capability + scope +
  revocationBehavior — grant calls must carry the full request shape, not
  bare `{capability, granted}`.

## Grok-native adapter — official Grok CLI as a first-class harness (2026-10-01)

Operator correction: for `addon.grok-build` we don't want "pi with a Grok
model" — the user envisioned a dedicated Grok Build CLI harness analogous to
the pi chain. The official Grok CLI is installed at `~/.grok/bin/grok`
(install: `curl -fsSL https://x.ai/cli/install.sh | bash`), version 1.0.34,
"stable" channel. It is a full agentic coding CLI (TUI default, sessions,
permission rules, model flags) and accepts `XAI_API_KEY` env as the API-key
auth path. The `~/.grok/auth.json` OIDC login is xAI's consumer OAuth — the
harness does not ride that credential (countermeasure is the same shape as
PI_CODING_AGENT_DIR: isolate the CLI's home).

### Architecture (adapter-generic, two native chains)

- **New adapter `grok-native-v1`** wraps the official grok CLI under the
  SAME session-environment delivery chain as `pi-native-v1`:
  - `grok-runtime.mjs` — `grokCommand()` executable allowlist (realpath inside
    `~/.grok/bin` or `GROK_BIN_DIR`); mirrors pi-runtime.mjs canonical-path
    discipline.
  - `grok-native-provider-map.mjs` — host-owned mapping ROS identity → env var;
    only `xai → XAI_API_KEY` (grok is single-provider).
  - `grok-native-credential-adapter.mjs` — planner modeled on pi's: authorize
    gate (calls `authorize({ adapterId: "grok-native-v1" })`), protocol gate
    (`openai-compatible`), provider-profile resolution, secret in session env,
    argv builder (`--cwd <projectPath> --model <model>`), env keys
    (`GROK_HOME=<userRoot>/grok-home-isolated` + `XAI_API_KEY`); never `--api-key`.
  - `grok-native-session-service.mjs` — composes the planner with the binary-
    agnostic interactive launcher (`pi-process-launcher.launchInteractive`),
    exposes `probe` + `startSession` + `redact`. Session continuity is
    implicit: grok stores session records under `$GROK_HOME/sessions`, no
    `--session-dir` flag is appended.

- **Adapter-generic TUI host service** (`pi-native-tui-host-service.mjs`):
  same route shape (`/pi-native/tui-session*`) for both chains; the factory
  now accepts EITHER the legacy `piNativeSessionService + issuePiProjection`
  OR a dispatcher (`resolveSessionService({addonId}) → service`,
  `resolveProjection({addonId, sessionId, manifest}) → projection`). The
  bridge wires the dispatcher: `addonId === "addon.grok-build"` returns
  `grokNativeSessionService`, else `piNativeSessionService`. The public
  route surface is unchanged (extension contract intact).

- **Authorization generalized**: `piNativeAuthorize` →
  `nativeAuthorize({ addonId, adapterId, providerProfileId })`. Both
  `piNativeAuthorize` and `grokNativeAuthorize` are thin shims. Planners
  hardcode their adapterId when calling `authorize`.

- **Registry**: `grok-native-v1` added to `reviewedAdapterIds` in
  `harness-host-service.mjs` (without the entry, install of `addon.grok-build`
  fails closed at `bindingAllowed`). `addon.grok-build.json` adapterId swap
  (pi-native-v1 → grok-native-v1) + binding adapterId match in operator
  launch script. `providerProfile: true` explicit on bindings for symmetry.

- **Catalog**: xAI preset `models` expanded to current grok CLI ids
  (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4`, `grok-3`); the
  existing durable account `shared-xai` carried only the legacy ids — its
  frozen model list is in `~/ResonantOS_User/ProviderFabric/provider-accounts.json`
  and was patched in place. New saves pick up the preset automatically.

### Open follow-ups

- **GROK_HOME binding (`grok-build.native`)**: the `authScheme`/`source`
  shape is identical to the pi bindings — the bind/source-name is
  `"grok-build.native"`. The host-owned credentials service
  (`createHarnessCredentials`) uses the binding NAME as the credentialBinding
  identity; the name must match the manifest's `agentRuntime.credentialBinding`.
  Today they do (manifest + script) — but a name-rename in one place breaks
  the gate silently. Add a launch-script invariant test.
- **Diagnostic noise during dev**: the planner's gate failures throw
  `permission-denied` with no public detail; the existing `publicHarnessError`
  surface is intentional, but added console.error breadcrumbs helped trace
  the real bug (`reviewedAdapterIds` missing `grok-native-v1`) and the
  catalog frozen-models surprise. Consider a `--diagnostic` host flag that
  exposes the breadcrumbs in the HTTP response (still fail-closed).
- **Headless chat surface for grok** (`-p --output-format streaming-json`
  gives ACP NDJSON; the user can build a non-TUI chat adapter reusing the
  same grok planner). The TUI is today's surface; headless lands when the
  bridge gets the generic chat route.
- **OIDC login expiry note**: the user's interactive `~/.grok` token reports
  "not authenticated" (`grok models` fails) — refresh via `grok login` for
  interactive use. The harness does not need this; it uses the API key.

### Chain evidence (canary, no real keys)

- Direct probe: `PI_CODING_AGENT_DIR=<isolated> XAI_API_KEY=<canary>
  grok -p "say hi" --output-format json` returned the expected "not
  authenticated" (proves `XAI_API_KEY` is recognized, awaits a real key).
- Direct probe (isolated dir): `XAI_API_KEY=<canary> grok models` →
  "You are using XAI_API_KEY." (proves header attachment path is wired).
- Bridge create: `POST /pi-native/tui-session` with `addonId:
  addon.grok-build, providerProfileId: shared-xai` → 200 with redacted
  projection (executable = `~/.grok/bin/grok`, argv = `[--cwd, <proj>,
  --model, grok-4.7]`, envKeys include `GROK_HOME` and `XAI_API_KEY`).
- Authorize gate passes: `nativeAuthorize({adapterId: "grok-native-v1",
  providerProfileId: "shared-xai"})` matches the `grok-build.native`
  binding. The same gate with `adapterId: "pi-native-v1"` continues to
  authorize `addon.pi-harness` sessions (regression check passed; battery
  green).

## Bridge retry hardening — transient ECONNREFUSED no longer blanks the panels (2026-10-01)

The bridge process listens on 127.0.0.1:47773 (Node HTTP). The extension's
service worker occasionally hits ECONNREFUSED bursts (kernel backlog
saturation, App Nap throttling on the host, transient bridge restarts). Each
failure surfaced as `TypeError: fetch failed` to the extension, which had no
retry/backoff — boot fetches blanked the rail (`#tool-rail-list` rendered
empty) and the user had to manually reload Chrome. Same root cause produced
the "no add-ons again" reports even though the durable registry was intact.

### Defenses

- **`bridge-retry.mjs`** — `fetchWithRetry(fetch, url, init, options)` wraps
  every bridge fetch with bounded retry on transient network errors. Aborts
  and HTTP error responses (4xx/5xx) are NEVER retried — the bridge answered;
  the caller decides what to do. Defaults: 4 attempts (initial + 3 retries),
  250ms linear backoff (0, 250, 500, 750ms — total ceiling ~1.5s). Classifies
  errors via `isTransientNetworkError` (checks `.code` / `.cause.code`
  against `ECONNREFUSED | ECONNRESET | ETIMEDOUT | EAI_AGAIN | ENOTFOUND |
  EPIPE | EHOSTUNREACH | ENETUNREACH`, plus common message patterns like
  "fetch failed" / "NetworkError").
- **Reachability store** — `createReachabilityStore()` emits three states
  (`online | unreachable | persistent`) with subscription callbacks. The
  bridge client emits transitions:
    - `unreachable` — every transient failure during retry (UI shows
      "retrying…" while the retry budget is in flight)
    - `recovered` — a fetch succeeded after one or more transient failures
    - `persistent` — retries exhausted; UI shows "Bridge unavailable.
      Check Settings → Bridge Target and the bridge process."
- **`createBridgeClient`** — the request function returned now exposes
  `subscribeReachability(listener)` and `getReachabilityState()` so any UI
  module can render banners / panels without re-implementing retry.
- **Banner UI** — `bridge-reachability-banner.js` renders a sticky top banner
  keyed on `#resonantos-bridge-reachability-banner` (added to
  `main-workspace.html`). Mounted inside `rebindBridge` after each bridge
  client swap. Hidden when state is online, visible with a yellow tint when
  unreachable, red when persistent. CSS lives in `main-workspace.css`.
- **Backwards-compatible** — the returned `bridgeRequest` is still a
  function (existing callers unchanged); reachability hooks are attached as
  properties on the function.

### Verification

- **Unit tests** (29 total):
  - `bridge-retry.test.mjs` (14 tests): error classification, backoff
    schedule, retry/recover/persistent sequencing, abort cancels retry,
    sleep honors abort signal, reachability state transitions and
    subscribe/unsubscribe.
  - `bridge-reachability.test.mjs` (8 tests): end-to-end through
    `createBridgeClient` — success on first try, recovery after transient
    burst, persistent after max attempts, recovery from persistent, no retry
    on non-transient errors, abort halts retry, unsubscribe, HTTP errors
    don't change state.
  - `bridge-reachability-banner.test.mjs` (7 tests): no-op when
    document/element missing, hides when online, reveals on burst,
    persistent after exhaustion, transient → online recovery, dispose
    clears state.
- **Battery**: green.

### Open follow-ups

- **Root-cause forensics deferred** — the ECONNREFUSED burst pattern looks
  like kernel backlog saturation when Chrome opens parallel keepalive
  connections during a burst. `sample` shows the bridge's main thread
  parked in `kevent` (idle, healthy). Need either `dtrace`/ltrace on the
  listener or to bound the extension's keep-alive concurrency. The retry
  layer makes the UX robust regardless.
- **Backoff tuning** — 6 attempts × 250ms linear (0/250/500/750/1000/1250
  ms, ~3.75 s ceiling) survives the 1–3 s bursts we see in the wild. If
  the burst pattern turns out to last longer, raise `DEFAULT_MAX_ATTEMPTS`
  or add jitter. The previous 4-attempt budget was blown by a single
  sustained burst (e.g. 2026-10-01 ~16:55 EDT).
- **Self-heal probe** — once the store reaches `persistent`, it stays
  there until a fetch succeeds. `fetchWithRetry`'s `onRecovered` only fires
  when at least one transient failure happened during the SAME call, so a
  first-try success after a burst cleared would NOT drive the state back
  to `online`. Fixed by adding `reachability.recordSuccess()` (drives
  persistent→online / unreachable→online on any clean fetch) and a
  `banner.probe()` hook. Banner now fires probes on `window.focus`,
  `visibilitychange→visible`, and `DOMContentLoaded`. Re-test after the
  bridge client module is reloaded (chrome://extensions → ↻ on the
  ResonantOS Browser Layer card).
- **Banner copy** — "Bridge unreachable — retrying…" is generic; could
  surface the most recent failure reason (already passed in `event.reason`)
  for diagnostics. Keep terse for now.

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
