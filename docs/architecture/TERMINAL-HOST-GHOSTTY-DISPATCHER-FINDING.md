# Terminal Host — Ghostty Command Dispatch: Corrected Finding

**Status:** Working note (not ADR-status). Corrects the record from the Ghostty
long-command delivery investigation.

**Date:** 2026-10-05.

---

## Claim being corrected

A prior report concluded that Ghostty 1.3.1's AppleScript `command:` property
"accepts the literal but does not dispatch the command," framing it as an
upstream dispatcher defect requiring Ghostty PR #11713 before CP-S5c could be
claimed.

## What was actually verified

1. **The Ghostty AppleScript `command:` dispatcher works.** Direct tests both
   wrote a persistent marker file:

   ```applescript
   new window with configuration {command:"echo G1 > /tmp/ghostty-g1.txt", wait after command:true}
   ```

   and the `surface configuration` object form both produced the file. The
   earlier "does not run" conclusion came from standalone `echo MARKER` tests
   that produced no persistent evidence (no file redirect), so a successful
   run was indistinguishable from a failed one.

2. **The real defect was long-command delivery.** The full composed bootstrap
   command (~1000+ chars of absolute token/auth/project paths + shell quoting)
   was embedded directly in the AppleScript `command:"…"` literal, which
   dropped the trailing `; bash -c …` portion. The head ran (the attach route
   was hit), the tail did not (no proof file). This is now fixed by writing the
   command to a 0600 script file and delivering only `bash '<file>'` —
   see commits `9450c219` and `ff47c296`.

3. **CP-S5c core acceptance passes.** Re-running the smoke after the fix
   produced `/tmp/ros-s5c-proof.txt` containing non-empty
   `OPENAI_API_KEY`, `ROS_PROJECT_ROOT`, and `ROS_SKILLS_DIR`, with the grant
   consumed once and no token/credential leak into the URL, bus events, or
   proof file.

## Remaining non-blocking gap

The smoke's single remaining `FAIL` — `bus saw terminal.command.started` — is a
timing artifact: the smoke's wait loop breaks as soon as the proof file appears
(~500ms), before the Ghostty adapter's title-diff polling emits
`command.started`. The proof file is the authoritative evidence that the
command ran; `command.started`/`command.ended` remain a documented best-effort
observation for Ghostty (polling, not event-stream).

This is a smoke-assertion ordering issue, not a functional defect. It is
addressed separately (see
`prompts/TERMINAL-HOST-SMOKE-ASSERT-FIX-PROMPT.md`).

## Conclusion

- TH-6 real-terminal proof: **functionally complete.**
- The "upstream Ghostty dispatcher defect / PR #11713" blocker is **not real**.
- The long-command AppleScript delivery defect is **fixed** (0600 script file).
- The only open item is a cosmetic smoke assertion (`command.started` timing).

The iTerm2 adapter (`examples/sdk-demo/terminal-host/iterm2/adapter.py`) should
be checked for the same long-command delivery weakness as a follow-up, since it
may pass commands through a similar length-sensitive transport.
