# Terminal Host — Launch Bridge: Auto-Start the Bridge from the UI — OMP Prompt (v1)

> **SUPERSEDED — DO NOT IMPLEMENT.** A stopped bridge cannot serve the
> `/bridge/launch` route proposed below. This prompt is retained as decision
> history only. Its replacement is the independent ROS bootstrap + modular SDK
> runtime lifecycle program in
> [`docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md`](../docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md).

**Historical handoff from AVIS → OMP. Do not execute this prompt.**

XH4 (tabbed Terminal surface + connection badge) and XH5 (the "Open in
Terminal" launch action) are complete and green. The remaining runtime gap is
operational: when the bridge process — `run-bridge-minimal.mjs`, which composes
`harness-host-service` **and** `terminal-host-service` and binds the loopback
port — is not running on the machine, the Terminal surface shows `Not
installed` / `Disconnected` and the `POST /terminal-host/launch` route returns
the typed `bridge-not-running` error (XH5a's `bridge-bootstrap.mjs` probes but
deliberately never starts). This prompt builds the **auto-start**: the operator
launches the bridge from the UI, idempotently and fail-closed, so the terminal
add-ons actually connect and the launch path completes.

---

## 0. Recorded decisions + invariants

Decision: **"Launch Bridge" is a single, host-driven action** that spawns the
bridge process and confirms it is healthy via the existing
`ensureBridgeReachable` probe. It is not a chat command, not a settings toggle,
and it never re-implements bridge composition — it only starts the reviewed
`run-bridge-minimal.mjs` entrypoint with a pinned command + fixed args + a
minimal env allowlist.

Invariants (non-negotiable):

1. **Pinned spawn.** The launcher spawns a fixed absolute entry
   (`browser-first/host/run-bridge-minimal.mjs`) with a fixed argv shape. No
   caller-supplied command, argv, shell string, or ambient-PATH lookup.
2. **Minimal env.** Only an explicit allowlist is passed to the child
   (`RESONANT_TERMINAL_HOST_BRIDGE=1` so the terminal-host service starts,
   `RESONANT_TERMINAL_DRIVER`, `PATH`). Never spread `process.env`; never pass
   a token, credential, or provider secret into the child env.
3. **Idempotent + fail-closed.** Probe first; if `ensureBridgeReachable`
   returns `ok: true`, report `alreadyRunning` and do not spawn again. A spawn
   that fails to become healthy within a bounded window returns a typed error,
   never a half-started state.
4. **Non-secret.** The launch route response and any telemetry carry only
   `{ ok, endpoint, version, alreadyRunning, pid }`. The bridge writes its own
   `bridge-config.generated.js` (tokens) — the launcher never reads or returns
   it, and `/healthz` returns no secrets.
5. **Loopback + capability.** The new route is loopback-only and requires
   `addon-runtime-control`, mirroring `GET /terminal-host/status` and
   `POST /terminal-host/launch`.
6. **Detached child.** The spawned bridge must outlive the launching host
   (`detached: true`, `stdio: "ignore"`, `unref()`), matching the existing
   always-on LaunchAgent behavior — not a child that dies with the launcher.
7. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push until AVIS audits.

---

## 1. Authority — read first

- `browser-first/host/bridge-bootstrap.mjs` — `ensureBridgeReachable` +
  `DEFAULT_BRIDGE_ENDPOINT`. The probe is the single owner of health-checking;
  do **not** inline a second probe.
- `browser-first/host/run-bridge-minimal.mjs` — the bridge entrypoint;
  `--bridge-port`, the terminal-host wiring (`installTerminalHostBridge`), and
  where `RESONANT_TERMINAL_HOST_BRIDGE` gates the terminal-host service.
- `browser-first/host/terminal-host-bridge-wiring.mjs` — `installTerminalHostBridge`
  returns `{ enabled, service, started }`; the env-flag contract.
- `browser-first/host/harness-host-service.mjs` — route composition
  (`route(...)` helper, `control` capability), and the existing launch route's
  `bridge-not-running` branch.
- `src/core/web-transport.ts` — the `commandRouteMap` where the new
  `bridge_launch` route is registered for the renderer.
- `src/modules/terminal/OpenInTerminalButton.tsx` — the XH5 button's
  `bridge-not-running` → `onOpenBridgeSettings()` branch that this prompt
  augments.
- `src/modules/settings/` — the Bridge Target settings section (deep-link
  target from XH5b).
- `browser-first/test/terminal-host-launch.test.mjs` — existing launch route
  coverage to preserve; `bridge-bootstrap` direct cases live here.

---

## 2. Hard rules

1. Do NOT re-implement the bridge; spawn `run-bridge-minimal.mjs` only.
2. Do NOT accept a command/argv/script path from the request body — the entry
   is pinned in host code.
3. Do NOT spread `process.env` into the child; use the explicit env allowlist.
4. Do NOT read, return, or log `bridge-config.generated.js` or any token.
5. Do NOT weaken the `addon-runtime-control` + loopback checks on the new route.
6. Do NOT regress XH4/XH5 gates; the new route must coexist with
   `/terminal-host/status` and `/terminal-host/launch`.

---

## 3. Phase LBa — bridge launcher (host-owned spawn) · gate CP-LBa

Add `browser-first/host/bridge-launcher.mjs` exporting:

```ts
launchBridge({
  endpoint,          // absolute loopback URL, e.g. http://127.0.0.1:<port>
  bridgeEntry,       // pinned absolute path to run-bridge-minimal.mjs
  env,               // minimal allowlist (see invariants)
  probe = ensureBridgeReachable,
  spawnImpl = spawn, // test seam
  timeoutMs = 10_000,// bounded healthy-window
}): Promise<{ ok: true, alreadyRunning: boolean, endpoint, version, pid? } |
            { ok: false, reason: "bridge-start-failed", endpoint, code? }>
```

Requirements:

1. Probe first. `ok: true` → return `{ ok: true, alreadyRunning: true, endpoint, version }` with **no** spawn.
2. On `bridge-not-running`, spawn `process.execPath <bridgeEntry> --bridge-port=<port>`
   with `detached: true`, `stdio: "ignore"`, then `child.unref()`. The port is
   derived from `endpoint` (never from the caller).
3. Pass the minimal env allowlist; never `...process.env`.
4. Poll `probe` on a bounded interval (e.g. 250 ms) up to `timeoutMs`. On
   healthy, return `{ ok: true, alreadyRunning: false, endpoint, version, pid }`.
   On timeout / spawn error, return the typed `bridge-start-failed` result.
5. Pure of secrets: nothing here reads tokens, credentials, prompt files, or
   provider secrets.

**CP-LBa gate:** unit tests (stub `spawnImpl` + `probe`) prove:
already-running short-circuits without spawning; a healthy spawn returns the
receipt with `pid`; a spawn that never becomes healthy returns
`bridge-start-failed`; spawn receives the pinned entry + fixed argv + the
env allowlist (assert no `process.env` key leaks); no secret-shaped value in
the result.

`STOP AND REPORT` here.

---

## 4. Phase LBb — launch route · gate CP-LBb

Add `POST /bridge/launch` to `harness-host-service.mjs`:

- **Loopback-only** transport and `addon-runtime-control` capability (mirror
  `/terminal-host/status` + `/terminal-host/launch`).
- Request body: `{}` (or optional `{ endpoint? }` bounded to loopback). No
  command, argv, or secret fields.
- Behavior: resolve the bridge endpoint, call `launchBridge`, and return the
  non-secret result. Map `bridge-start-failed` to a public rejection without
  surfacing internal spawn details.

**CP-LBb gate:** route enforces loopback + capability (401/403 on missing);
an already-running bridge returns `alreadyRunning: true` without a second
spawn; a stopped bridge spawns and returns `{ ok: true, version }`; the
response payload carries no secret-shaped value (shape-walker).

`STOP AND REPORT` here.

---

## 5. Phase LBc — UI affordance · gate CP-LBc

1. In `OpenInTerminalButton`, extend the `bridge-not-running` branch: alongside
   the existing Settings deep-link, offer a **"Launch Bridge"** action that
   POSTs `/bridge/launch` and, on success, **auto-retries** the terminal launch
   (same auto-retry shape as the XH5c authorize path).
2. In the Settings → Bridge Target section, add a **Launch Bridge** button +
   a non-secret status line (endpoint + `Connected`/`Starting`/`Not running`).
3. Host-owned rendering only: `textContent`, no `innerHTML` /
   `dangerouslySetInnerHTML`, no script injection. Only the documented fields
   (`endpoint`, `version`, `alreadyRunning`) are surfaced.

**CP-LBc gate:** component test — the `bridge-not-running` branch renders a
"Launch Bridge" action; invoking it calls the launch seam then retries the
terminal launch; a second click while running surfaces `alreadyRunning` without
a second spawn; the Settings section renders the status via textContent only.

`STOP AND REPORT` here.

---

## 6. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  browser-first/test/harness-host-service.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  browser-first/test/bridge-launcher.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

Report counts by label: core / demo / browser-first.

---

## 7. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label. Never trust a green number
you did not produce. Also assert the launcher never leaks a token/credential/path
into argv, env, the route response, or telemetry (shape-walker + spawn-spy).

---

## 8. Out of scope (do not build here)

- Re-implementing bridge composition / a second bridge entrypoint.
- Cross-machine or non-loopback bridge hosting.
- The extension's re-bind after a fresh spawn (the existing
  `bridge-config.generated.js` + `chrome.storage.onChanged` rebind already
  handles this; verify, don't rebuild).
- Linux WezTerm / kitty adapters; additional harness policies.

Suggested commits:

1. `feat(terminal-host): add idempotent bridge launcher`
2. `test(terminal-host): cover bridge launcher spawn + env allowlist`
3. `feat(terminal-host): add POST /bridge/launch route`
4. `feat(terminal-host): add Launch Bridge UI affordance + auto-retry`
5. `docs(terminal-host): capture Launch Bridge prompt` (include this prompt).

Report explicitly when the Launch Bridge prompt is complete, then pause for the
next prompt (the compatibility-matrix / OpenCode / Claude / Codex / Hermes
harness policies, or the Linux VIGIL adapters).
