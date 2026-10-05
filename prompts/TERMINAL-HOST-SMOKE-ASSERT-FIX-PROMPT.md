# Terminal Host — Smoke `command.started` Timing Fix — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The Ghostty long-command fix (G1/G2) is correct, and CP-S5c's core acceptance
now passes. The only remaining `RED` is a smoke-test timing artifact, not a
functional defect. This prompt fixes that assertion so CP-S5c exits green.

---

## 0. Confirmed context (read first)

AVIS re-ran CP-S5c and established:

1. Ghostty's AppleScript `command:` dispatcher **works** — the earlier
   "Ghostty 1.3.1 dispatcher defect / needs PR #11713" conclusion was a false
   negative from standalone `echo MARKER` tests with no persistent evidence.
2. The proof file IS written with the full projected env:
   `OPENAI_API_KEY` + `ROS_PROJECT_ROOT` + `ROS_SKILLS_DIR` (non-empty).
3. The attach route is hit, the grant is consumed once, and no token/credential
   leaks into the URL, bus events, or proof file.
4. The single failing assertion is `bus saw terminal.command.started`.

Root cause of that assertion:

- `pi-attach-smoke.mjs`'s wait loop (around line 368) breaks the moment the
  proof file (or error file) appears — in ~500ms.
- `terminal.command.started` is emitted later by the Ghostty adapter's
  **title-diff polling** (`pollOnce`), which is inherently laggy (a documented
  Phase-3 observation-fidelity limitation).
- So the proof file arrives before the telemetry event, the loop exits early,
  and the assertion runs against a bus that hasn't seen `command.started` yet.

Pre-fix, the command never completed, so the loop waited the full 15s and the
event happened to fire. Post-fix, the fast proof file changes the timing and
exposes the ordering issue.

---

## 1. Hard rules

1. The **proof file is the authoritative gate** for CP-S5c. Do not weaken it.
2. `terminal.command.started` / `terminal.command.ended` remain **best-effort
   observation** for Ghostty (title-diff polling). Treat them as such.
3. Do not change the Ghostty adapter's command delivery, grant flow, or any
   production code to satisfy a smoke assertion.
4. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`.
   Do not push this branch until AVIS audits.

---

## 2. The fix · gate CP-S5T

In `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs`:

1. After the proof file is confirmed, wait an additional bounded window
   (e.g. up to 3–5s) **specifically for** `terminal.command.started` before
   asserting it. Continue draining the bus in this window.
2. If `terminal.command.started` still does not arrive in that window:
   - log a **warning** (`WARN`, not `FAIL`);
   - do **not** set `pass = false` on account of it — the proof file is the
     authoritative evidence the command ran.
3. Keep `terminal.session.started` as a hard assertion (it is deterministic on
   window creation).
4. Keep all non-leak assertions hard (credential/token absent from bus, URL,
   proof file).
5. Ensure the proof file / token / auth / script / error files are still
   cleaned up in teardown regardless of the `command.started` outcome.

**CP-S5T gate:** CP-S5c exits green (no `RED`) on the real Ghostty run, with the
proof file present and non-leak assertions passing. If `command.started` is
missing after the extended window, the run still exits green with a clear
`WARN` line explaining it is a known title-diff polling limitation.

`STOP AND REPORT` here.

---

## 3. Regression commands

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

And the real smoke:

```sh
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  RESONANT_TERMINAL_DRIVER=ghostty \
  RESONANT_TERMINAL_HOST_BRIDGE=1 \
  node --experimental-strip-types \
    examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

---

## 4. Commit/report discipline

Suggested commit:

- `test(terminal-host): treat Ghostty command.started as best-effort in smoke`

Final report must state CP-S5c exits **green**, attach the proof-file contents
(redacted credential), and note whether `command.started` was observed or
logged as a `WARN`. Do not push until AVIS audits.
