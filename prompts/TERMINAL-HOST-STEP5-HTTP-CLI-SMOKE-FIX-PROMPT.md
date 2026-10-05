# Terminal Host — Step 5 HTTP/CLI/Smoke Integration Fix — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The TH-6 grant-flow ownership repair is complete and audited:

- `93808e11` — `launchBootstrap` owns grant mint/track/token-file composition.
- `ec4538f0` — real Pi adapter → real terminal-host-service grant-chain test.
- `b178d756` — grant-flow prompt documentation.

F1–F3 are green. **Do not revert or redesign them.**

CP-S5c is still incomplete. The latest Ghostty run proved Automation now works
(`terminal.session.started` + `terminal.command.started` were observed), but the
proof command never completed. AVIS found two integration defects and one smoke
coverage defect that explain this result:

1. `ros-session.mjs` defaults `fetcher = globalThis.fetch` but invokes it with a
   test-only object signature (`fetcher({ url, init })`) instead of native
   `fetch(url, init)` and expects `response.body` to already be decoded JSON.
2. `pi-attach-smoke.mjs` creates `createHarnessHostService()` in process and calls
   route handlers directly, but never mounts `/terminal-host/session/attach` on
   a live loopback HTTP server. The Ghostty subprocess therefore has no route to
   POST to at the CLI's default URL.
3. The smoke's env-proof block manually mints/tracks/writes/composes a grant and
   uses the `bootstrapCommand` escape hatch instead of exercising the corrected
   host-owned `commandSuffix` production path.

Fix these root causes before claiming CP-S5c.

---

## 0. Authority — read first

- `browser-first/bin/ros-session.mjs`
  - `attach()`
  - CLI `main()` and argument parsing.
- `browser-first/test/ros-session.test.mjs`
- `browser-first/host/harness-host-service.mjs`
  - `POST /terminal-host/session/attach`
  - route auth metadata (`loopbackHostOnly`, required capability, error family).
- `browser-first/host/bridge-server.mjs`
  - existing loopback HTTP server/auth helpers. Reuse them; do not invent a
    parallel security model.
- `browser-first/host/run-bridge-minimal.mjs`
  - production mounting precedent for host routes and bridge/capability tokens.
- `browser-first/host/terminal-host-service.mjs`
  - corrected `launchBootstrap({ commandSuffix })` owner path.
- `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs`
- `browser-first/test/pi-terminal-grant-chain.test.mjs` — preserve this audited
  real-chain test.

---

## 1. Hard rules

1. **Never expose the grant token or provider credential** in argv, URL, headers,
   logs, stdout/stderr, bus events, test names, or failure payloads.
   - Grant token remains in a 0600 file + POST body.
   - Provider credential remains only in the returned projected env under the
     host-owned env-var name.
2. **Use the existing bridge authentication model.** Route remains loopback-only
   and requires `addon-runtime-control`. Do not bypass auth for the smoke.
3. **Production and test fetch semantics must match.** Tests may inject a seam,
   but they must exercise the same `fetch(url, init) -> Response -> json()`
   contract as native fetch.
4. **Use the corrected owner path.** CP-S5c must call
   `launchBootstrap({ commandSuffix })`; it must not manually mint/track/write
   the grant or use `bootstrapCommand` for the proof chain.
5. Preserve F1–F3, grant replay/audience/expiry behavior, F2 adapter/ROS split,
   and all existing regressions.
6. No merge of `feature/pi-testing-phase`. Do not push to `dev`, `main`, or
   `upstream`. Do not push this branch until AVIS audits the result.

---

## 2. Phase H1 — fix native fetch semantics · gate CP-S5H1

Refactor `browser-first/bin/ros-session.mjs::attach()` so its default network
path actually works with `globalThis.fetch`.

Required behavior:

```js
const response = await fetcher(url, init);
const body = await response.json();
```

Requirements:

1. `fetcher` uses native-compatible `(url, init)` arguments.
2. Handle native `Response` semantics:
   - non-2xx/non-200 status → existing structured `http-<status>` reason;
   - malformed/non-JSON response → structured, non-secret reason such as
     `invalid-response`;
   - fetch rejection → `bridge-unreachable`;
   - `{ ok: true, env }` → `formatExports(env)`;
   - `{ ok: false, reason }` → return the public reason.
3. Do not include token/credential in thrown errors, structured reasons, or
   diagnostics.
4. Preserve token-file read-then-unlink semantics even when fetch fails.
5. Update all test mocks from the old `{ url, init }` callback shape to native
   `(url, init)` semantics. Prefer actual `Response` objects where Node supports
   them so JSON decoding is exercised.

**CP-S5H1 gate:** `ros-session.test.mjs` proves:

- native-style fetch receives URL + init separately;
- token is in request body only, never URL/headers;
- a real `Response(JSON.stringify(...), ...)` is decoded;
- malformed JSON fails closed;
- HTTP error and rejected fetch remain structured and non-secret;
- token file is gone after every attempted attach once read.

`STOP AND REPORT` here.

---

## 3. Phase H2 — real loopback HTTP integration test · gate CP-S5H2

Add a test that mounts the actual
`POST /terminal-host/session/attach` route on a real ephemeral loopback HTTP
listener and drives it through the real `ros-session.attach()` native-fetch
path.

Requirements:

1. Use the existing bridge server/router/auth helpers from
   `bridge-server.mjs` / production mounting code. Do not hand-roll a permissive
   server that bypasses route metadata.
2. Listen on `127.0.0.1` with port `0`; derive the actual base URL from the
   listener address.
3. Generate/provide real bridge + `addon-runtime-control` capability tokens in
   the same header names production expects.
4. Track a real `SessionBootstrapGrant`, write it to a real 0600 temp file, and
   call real `attach()` with:
   - base URL;
   - bridge token;
   - control capability token;
   - profile/session/project inputs.
5. Inject only host data sources (profile/secret/project/catalog), not the
   route result. The route + broker + environment composition + native fetch +
   JSON decoding must all be real.
6. Assert:
   - first attach returns exports containing project/skills/credential keys;
   - token file is removed;
   - replay fails `already-consumed`;
   - wrong bridge/capability token receives the correct auth failure;
   - no token or credential appears in URL, headers, metadata, server logs, or
     rejection payloads.
7. Close the HTTP listener and clean all temp/staging files in `finally` /
   test teardown.

Suggested file:

`browser-first/test/ros-session-http-integration.test.mjs`

**CP-S5H2 gate:** this test must fail on `b178d756` because the native-fetch
contract is incompatible and pass after H1/H2.

`STOP AND REPORT` here.

---

## 4. Phase H3 — repair CP-S5c smoke transport · gate CP-S5H3

Refactor
`examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs` so the command
running inside Ghostty can actually reach the attach route.

Requirements:

1. Mount the smoke's real `createHarnessHostService().harnessRoutes` on a live
   authenticated loopback bridge server using production route mounting.
2. Use an ephemeral loopback port when possible. If the existing bridge helper
   requires a configured port, choose an unused local port and report it without
   tokens.
3. Deliver the non-secret base URL and bridge/capability credentials to
   `ros-session` without violating security:
   - Bridge/capability tokens must not appear in the terminal command argv,
     shell history, logs, or bus events.
   - Prefer another 0600 config/auth file read-and-unlinked by `ros-session`, or
     a broker-local side channel. Do **not** put auth tokens into
     `commandSuffix`, URL query parameters, or environment exported in the
     command string.
   - If this requires extending `ros-session` with `--auth-file`, keep it 0600,
     read-then-unlink, and cover it with tests. The auth file may contain base
     URL + bridge/capability tokens; only its path may appear in argv.
4. Replace the manual env-proof grant block. Do not import/call
   `mintSessionBootstrapGrant`, `trackSessionBootstrapGrant`, or
   `composeBootstrapCommand` from the smoke.
5. Exercise the corrected production path:

```js
bridge.service.launchBootstrap({
  sessionId: proofSessionId,
  providerProfileId: "openai",
  harness: manifest.id,
  project: /* authorized project context */,
  commandSuffix: /* reviewed bash proof tail */,
})
```

6. The proof tail may write `/tmp/ros-s5c-proof.txt`, but it must never contain
   literal credential/token values. It should observe only the env names after
   successful attach.
7. Improve diagnostics without leaking secrets:
   - Capture/report structured `ros-session.error.reason` if possible.
   - Distinguish `bridge-unreachable`, HTTP auth failure, attach rejection,
     terminal command failure, and timeout.
   - Remove the stale message that every missing proof file means “Ghostty
     adapter unreachable”; terminal events already proved reachability.
8. Ensure cleanup closes the loopback server and removes proof/token/auth/prompt
   files even on failure.

**CP-S5H3 gate:** before real Ghostty, add/test a deterministic smoke mode with
an external-terminal adapter stub that executes or inspects the same full chain
and proves the live HTTP route is reachable and authenticated.

`STOP AND REPORT` here.

---

## 5. Phase H4 — retry real CP-S5c · gate CP-S5H4

Run from a macOS shell with Ghostty Automation permission:

```sh
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  RESONANT_TERMINAL_DRIVER=ghostty \
  RESONANT_TERMINAL_HOST_BRIDGE=1 \
  node --experimental-strip-types \
    examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

Required evidence:

1. Real Ghostty session/window receives the command.
2. `ros-session attach` successfully authenticates against the live loopback
   route and consumes the grant.
3. Proof file contains non-empty values for:
   - `OPENAI_API_KEY` (assert sentinel equality internally but redact in output),
   - `ROS_PROJECT_ROOT`,
   - `ROS_SKILLS_DIR`.
4. Bus sees at least `terminal.session.started` and
   `terminal.command.started`; report `terminal.command.ended` if Ghostty
   observation supports it.
5. Pi resolves through `piCommand()` and is launched through the fixed
   `pi-terminal-v1` path.
6. No token/credential value appears in command, bus, logs, or report.

If real terminal execution still fails, report the exact structured layer and
reason. Do not label it TCC unless AppleScript itself returns an Automation/TCC
error. Do not claim CP-S5c without the proof file/env assertions.

`STOP AND REPORT` here.

---

## 6. Regression commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/ros-session-http-integration.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs
```

Report counts by label: core / demo / browser-first. Re-run every command.

---

## 7. Commit/report discipline

Suggested commits:

1. `fix(terminal-host): use native fetch semantics in ros-session`
2. `test(terminal-host): cover authenticated ros-session HTTP round-trip`
3. `fix(terminal-host): mount live attach route in Pi Ghostty smoke`
4. `docs(terminal-host): capture HTTP CLI smoke fix prompt`

Final report must separate:

- H1 native-fetch status;
- H2 authenticated HTTP integration status;
- H3 deterministic full-chain smoke status;
- H4 real Ghostty CP-S5c evidence or exact remaining blocker;
- test counts by label;
- non-leak assertions.

Do not push until AVIS audits the result unless the operator explicitly asks.
