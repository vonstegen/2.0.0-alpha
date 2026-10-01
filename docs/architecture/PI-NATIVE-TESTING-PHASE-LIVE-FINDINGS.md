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
