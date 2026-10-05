# Terminal Host — Ghostty Long-Command Delivery Fix — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

CP-S5c was re-run by AVIS on the live branch and the blocker is now isolated to
one defect. This prompt fixes it so the real Ghostty proof can pass.

---

## 0. Confirmed diagnosis (read first)

AVIS reproduced CP-S5c and established these facts:

1. AppleScript automation works from this shell (no `-600`). The bridge starts,
   the Ghostty adapter spawns, and the bus sees
   `terminal.session.started` + `terminal.command.started`.
2. The ROS-side chain is correct and complete. The attach route is hit with the
   grant token, so `ros-session attach` runs inside the Ghostty window, reads the
   0600 token/auth files, POSTs, and consumes the grant.
3. The composed command's **head** executes (`eval "$(node ros-session.mjs …)"`),
   but its **tail** (`; bash -c 'printf … > /tmp/ros-s5c-proof.txt'`) does not.
   Neither the proof file nor the `--error-file` is written (verified absent from
   both `/tmp` and `/private/tmp`; they are the same inode).
4. Stub mode (H3) executes the *identical* composed command via local
   `spawn("/bin/bash", ["-c", cmd])` and the proof file **is** written.

Conclusion: the defect is in the Ghostty adapter's delivery of a long,
quote-heavy command through the AppleScript `command:"…"` literal. The command
(now ~1000+ chars with absolute token/auth/project paths) is not carried
reliably; the trailing portion is dropped.

---

## 1. Authority — read first

- `examples/sdk-demo/terminal-host/ghostty/adapter.mjs`
  - `ghosttyNewWindow()` — embeds `command:"…"` via `osaEscape()`.
  - `osaEscape()` — backslash + double-quote escaping only.
  - `handleRequest()` `launchBootstrap` case — passes `bootstrapCommand`.
- `browser-first/host/terminal-host-service.mjs`
  - `launchBootstrap({ commandSuffix })` owner path; `composeBootstrapCommand`.
- `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs`
  - `proofTail`, `launchBootstrap({ commandSuffix: proofTail })`.
- `browser-first/test/terminal-host-launch-bootstrap.test.mjs` and the Ghostty
  smoke's stub mode as the correctness reference.

---

## 2. Hard rules

1. **Command length/quoting must not be a delivery concern.** The adapter must
   not pass a long, quote-heavy string through AppleScript `command:"…"`.
2. **Token/credential still never in argv/env/shell history/logs.** The script
   file contains the composed command (paths only, never token/credential
   values) — same discipline as the existing token/auth files.
3. **Script file is 0600** and cleaned up (or safely left for a bounded cleanup
   pass). Never world-readable.
4. Preserve the F2 split, grant ownership fix, and the
   `launchBootstrap({ commandSuffix })` owner path. Do not reintroduce manual
   grant minting or the `bootstrapCommand` override in the proof path.
5. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push this branch until AVIS audits.

---

## 3. Phase G1 — deliver via script file · gate CP-SG1

Change the Ghostty adapter's `launchBootstrap` delivery so a long command is
never embedded in an AppleScript literal.

Recommended approach:

1. In the adapter's `launchBootstrap` handler, write `bootstrapCommand` to a
   0600 script file under a reviewed temp root (reuse the same
   `osTmpdir()`-style location and 0600 discipline as the token/auth files).
2. Deliver a **short** AppleScript command: `bash '<scriptFile>'` (single-quoted
   path, which is short and free of shell metacharacters beyond the path).
3. Keep `rejectKnownTokens` checking the original `bootstrapCommand` before
   writing the file (the grant token must still be rejected if present).
4. Resolve the script-file cleanup policy and document it in the commit message:
   - `bash '<file>'` reads the file after the AppleScript call returns, so the
     file cannot be unlinked synchronously. Options: best-effort delayed unlink,
     unlink-on-next-launch for the same session, or a small bounded reaper. Pick
     one that cannot delete a file before the shell reads it and cannot leak
     secrets (the file has no secrets, but keep it 0600 anyway).
5. Ensure `ghosttyNewWindow` still applies the `wait after command:false` and
   `initial input` semantics unchanged.

**CP-SG1 gate:**

- A unit test (or the stub-mode smoke) asserts:
  - a long composed command is written to a 0600 script file;
  - the AppleScript `command:` value is a short `bash '<file>'` string;
  - the script file content equals the original composed command;
  - no token/credential value appears in the script file;
  - cleanup does not unlink before the shell reads the file.

`STOP AND REPORT` here.

---

## 4. Phase G2 — deterministic long-command delivery test · gate CP-SG2

Add a test that fails on the current AppleScript `command:"…"` approach and
passes after G1:

1. Compose a realistic long command (absolute token/auth/project paths +
   `commandSuffix`).
2. Assert the adapter never embeds the full command in the AppleScript string —
   i.e. the delivered `command:` value is under a fixed, small length and
   references the script file.
3. Simulate the shell reading `bash '<file>'` and assert the executed command
   matches the original (round-trips through the script file unchanged).

**CP-SG2 gate:** test is red before G1, green after.

`STOP AND REPORT` here.

---

## 5. Phase G3 — re-run real CP-S5c · gate CP-SG3

Run:

```sh
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  RESONANT_TERMINAL_DRIVER=ghostty \
  RESONANT_TERMINAL_HOST_BRIDGE=1 \
  node --experimental-strip-types \
    examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

Required evidence:

1. Proof file `/tmp/ros-s5c-proof.txt` is written with non-empty:
   - `OPENAI_API_KEY` (assert sentinel equality internally, redact in output);
   - `ROS_PROJECT_ROOT`;
   - `ROS_SKILLS_DIR`.
2. The attach route is hit and the grant is consumed once.
3. Bus sees `terminal.session.started` and `terminal.command.started`.
4. No token/credential value appears in command, script file, AppleScript,
   bus events, or logs.

If the proof file still does not appear, capture the actual in-window error:
have the proof tail append `2>/tmp/ros-s5c-stderr.txt` (and read it back) or
report the `--error-file` content. Do not claim CP-S5c without the proof file.

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

Report counts by label: core / demo / browser-first.

---

## 7. Commit/report discipline

Suggested commits:

1. `fix(terminal-host): deliver Ghostty bootstrap via 0600 script file`
2. `test(terminal-host): guard against long-command AppleScript delivery`
3. `docs(terminal-host): capture Ghostty long-command delivery prompt`

Final report must state:

- G1/G2 status;
- G3 real Ghostty evidence or the exact remaining error (with in-window
  stderr/error-file content);
- test counts by label;
- non-leak assertions.

Do not push until AVIS audits.

---

## 8. Follow-up (out of scope here, flag only)

The iTerm2 adapter (`examples/sdk-demo/terminal-host/iterm2/adapter.py`) may
have the same long-command delivery weakness. Do **not** fix it in this prompt;
flag it for a follow-up once Ghostty CP-S5c passes.
