# Terminal Host — Step 5 Grant-Flow Fix Before CP-S5c — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

Step 5A/5B tests are green and the Ghostty CP-S5c smoke is blocked by macOS
Automation/TCC. During audit, AVIS found a separate functional defect that the
blocked smoke and stubbed tests did not reach: the `pi-terminal-v1` path
composes a command referencing a token-file path, but no grant is minted or
tracked and no token file is written.

This prompt fixes that root cause before the real CP-S5c smoke is retried.

---

## 0. Reproduce and understand the defect first

Read:

- `browser-first/host/agent-adapters/pi-terminal.mjs`
  - `composePiInvocation`
  - `composePiTerminalBootstrap`
  - `createPiTerminalAdapter().invoke()` around the token/prompt path and the
    `terminalHostService.launchBootstrap()` call.
- `browser-first/host/terminal-host-service.mjs`
  - `composeBootstrapCommand`
  - `launchBootstrap()`.
- `browser-first/test/pi-terminal-adapter.test.mjs`
- `browser-first/test/terminal-host-launch-bootstrap.test.mjs`
- `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs`

Current broken flow:

1. `pi-terminal.mjs` chooses `tokenFilePath` and composes the complete command:
   `eval "$(ros-session attach ... --token-file <path> ...)"; pi ...`.
2. It calls `terminalHostService.launchBootstrap({ bootstrapCommand })`.
3. `launchBootstrap()` initializes `grant = null`, then mints/tracks/writes the
   token file **only inside `if (!bootstrapCommand)`**.
4. Because `bootstrapCommand` is supplied, that branch is skipped.
5. The terminal receives a command referencing a nonexistent token file; the
   grant broker has no tracked grant. The CLI would fail with
   `token-file-unreadable` (or `unknown-session` if given a token by some other
   means).

The adapter's current `grant = null` sentinel/comment does not fix this. Delete
that dead/conflicting reasoning as part of the repair.

---

## 1. Hard rules

1. **Single owner:** `terminal-host-service.mjs::launchBootstrap()` owns grant
   minting, tracking, 0600 token-file creation, attach-command composition, and
   RPC delivery. The Pi adapter must not duplicate these responsibilities.
2. **Token never argv/env/shell history/logs.** Only the token-file path appears
   in the composed command. The token value exists only in the 0600 file, grant
   record, and POST body.
3. **Credential never command/argv/logs.** It still enters only through the
   attach route's projected env.
4. **Prompt privacy:** multiline/large prompts remain in a 0600 prompt file.
   Preserve current cleanup behavior. A short prompt may remain POSIX-quoted in
   argv only if that is the existing accepted policy; do not broaden exposure.
5. **Do not weaken** `consumeGrant`, expiry, audience binding, replay rejection,
   adapter token-substring rejection, or F2 operation separation.
6. No merge of `feature/pi-testing-phase`. Do not push to `dev`, `main`, or
   `upstream`.

---

## 2. Phase F1 — centralize composition in `launchBootstrap` · gate CP-S5F1

Implement a narrow extension to `launchBootstrap()` that allows callers to add
an executable tail **after** the host-owned attach command without supplying a
complete `bootstrapCommand` override.

Recommended shape:

```js
launchBootstrap({
  sessionId,
  providerProfileId,
  harness,
  project,
  commandSuffix, // e.g. `pi '@<prompt-file>'`
})
```

Requirements:

1. When `bootstrapCommand` is absent, `launchBootstrap` must always:
   - mint and track exactly one `SessionBootstrapGrant`;
   - choose/write exactly one token file with mode `0600`;
   - compose the host-owned `ros-session attach` command using that same file;
   - append the validated `commandSuffix` as `; <suffix>`;
   - send both the composed command and grant to the terminal adapter.
2. Preserve the explicit `bootstrapCommand` override semantics for existing
   callers/smokes, but document that it is an escape hatch that does **not**
   request grant/env composition. The Pi path must no longer use it.
3. Validate `commandSuffix` as a string. The host must not accept arbitrary
   manifest/caller commands; it is supplied only by reviewed host code
   (`pi-terminal-v1`) after `piCommand()` validation and shell quoting.
4. Keep fallback cleanup: if the adapter RPC fails before CLI consumption,
   unlink the token file.
5. Prefer returning non-secret launch metadata useful to reviewed callers/tests,
   e.g. `tokenFilePath` is acceptable; never return the token value. Do not
   change an existing wire contract unnecessarily if the test can observe the
   injected token-file path instead.

**CP-S5F1 gate:** extend `terminal-host-launch-bootstrap.test.mjs` using the real
`createTerminalHostService` with the stdio adapter stub. Assert:

- one grant is tracked for the session;
- the referenced token file exists and has mode `0600`;
- its content equals the tracked grant token (test only; never log either);
- the composed command contains the token-file path but not the token value;
- `commandSuffix` appears after the attach command;
- simulated adapter failure removes the token file;
- replay/claim semantics remain single-use and audience-bound.

`STOP AND REPORT` here.

---

## 3. Phase F2 — update `pi-terminal-v1` to use the owner · gate CP-S5F2

Refactor `createPiTerminalAdapter().invoke()`:

1. Continue validating the Pi executable through `piCommand()` only.
2. Continue building the Pi invocation tail via `composePiInvocation()` (or a
   renamed equivalent). Use the validated executable's absolute path rather
   than a bare ambient `pi` command if the current code does not already do so.
3. Continue writing multiline/large prompts to a 0600 prompt file.
4. Call `terminalHostService.launchBootstrap()` **without `bootstrapCommand`**,
   passing attach context plus the Pi invocation as `commandSuffix`.
5. Remove the adapter-owned `tokenFilePath` choice from the actual invoke path,
   the `grant = null` sentinel, and comments claiming a grant will be minted
   while also passing a complete command.
6. Do not import or call grant broker internals from the adapter.

If `composePiTerminalBootstrap()` remains exported for compatibility/tests,
mark it as a pure helper only or update tests so it cannot be mistaken for the
runtime ownership path. Prefer removing it if no legitimate caller remains.

**CP-S5F2 gate:** update `pi-terminal-adapter.test.mjs` so its service stub
asserts:

- `launchBootstrap` receives no `bootstrapCommand`;
- it receives `providerProfileId`, harness/project context, and a reviewed
  `commandSuffix` containing the validated absolute Pi executable;
- multiline prompts use only a prompt-file path in the suffix, not prompt text;
- token/credential values are absent from every launch argument;
- telemetry still maps to harness `delta`/`final`/`error` events.

`STOP AND REPORT` here.

---

## 4. Phase F3 — real-chain integration test · gate CP-S5F3

Add one integration test that combines the **real** Pi terminal adapter with the
**real** terminal-host service and only stubs the external terminal JSON-RPC
peer. Do not stub `terminalHostService.launchBootstrap` in this test.

The test must prove the exact gap the prior suite missed:

1. Invoke Pi through `pi-terminal-v1` with an injected fixed-root Pi executable.
2. Capture the RPC sent to the adapter peer.
3. Parse the `--token-file` path from the command without printing it.
4. Assert the file exists, mode is `0600`, and the grant is outstanding/tracked.
5. Run the real token-consumption path (`consumeGrant` or the route/CLI helper),
   assert success, then replay returns `already-consumed`.
6. Assert the composed command contains neither token value nor credential
   value.
7. Clean up token/prompt files in `finally`.

This test is mandatory. A unit test with a stubbed `launchBootstrap` is not a
substitute.

**CP-S5F3 gate:** new integration test passes and would fail on commit
`c1e705c8` for the missing token file / untracked grant.

`STOP AND REPORT` here.

---

## 5. Phase F4 — retry CP-S5c only where Automation is allowed

After F1–F3 are green, retry:

```sh
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  RESONANT_TERMINAL_DRIVER=ghostty \
  RESONANT_TERMINAL_HOST_BRIDGE=1 \
  node --experimental-strip-types \
    examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

The Zed/harness shell currently reproduces macOS TCC error `-600`; do not claim
CP-S5c passed from that shell. Run from Terminal.app (or another app) that has
System Settings → Privacy & Security → Automation permission for Ghostty.

If TCC still blocks it, report **CP-S5F1–F3 green; CP-S5c still TCC-blocked**.
Do not fake terminal evidence.

---

## 6. Regression commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs
```

Report counts by label: core / demo / browser-first. Re-run every gate yourself.

---

## 7. Commit and report discipline

Suggested commits:

1. `fix(terminal-host): centralize Pi grant flow in launchBootstrap`
2. `test(terminal-host): cover real Pi-to-bootstrap grant chain`
3. `docs(terminal-host): capture step-5 grant-flow fix prompt` (include this
   prompt and `TERMINAL-HOST-STEP5-TH6-PI-ATTACH-PROMPT.md` if still untracked)

Do not push until AVIS audits the fix unless the operator explicitly requests
it. Final report must distinguish:

- **TH-6 implementation:** F1–F3 status;
- **CP-S5c real terminal evidence:** pass or still TCC-blocked;
- exact commits/files/tests;
- token/secret non-leak assertions.
