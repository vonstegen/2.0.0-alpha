# Terminal Host — CP-S5c Proof Fix + Launch-Pi Smoke — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The functional seam (terminal + project + skills + credential + memory) is
built and green. Two things remain before the user can see it working:

1. The CP-S5c smoke proof tail doesn't print `ROS_MEMORY_CONTEXT`, and its
   one-shot `printf` command trips Ghostty's `abnormal-command-exit-runtime`
   (250ms) "failed to launch" banner.
2. The smoke has never launched the **real `pi` TUI** — its proof tail is
   `bash -c 'printf …'`, not `pi`.

This prompt fixes both and adds the launch-Pi proof.

---

## 0. Confirmed facts (read first)

- The smoke currently prints exactly three proof lines: `OPENAI_API_KEY`,
  `ROS_PROJECT_ROOT`, `ROS_SKILLS_DIR` (no `ROS_MEMORY_CONTEXT`).
- Ghostty default `abnormal-command-exit-runtime = 250` — the fast-exiting
  proof command flashes a "failed to launch" error page (cosmetic; the smoke
  still exits green and the proof file is correct).
- `ROS_MEMORY_CONTEXT` is already emitted by `buildProjectedSessionEnv` (M2)
  when `memoryAccess.archiveReadMode === "read-only-context"` and a
  `stagingBase` is supplied — but the smoke neither supplies memory projection
  nor prints the variable.

---

## 1. Authority — read first

- `examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs` — the proof
  tail, `launchBootstrap({ commandSuffix })`, host wiring, install/grant/slot.
- `browser-first/host/terminal-host-service.mjs` — `buildProjectedSessionEnv`
  (`ROS_MEMORY_CONTEXT` emission), `launchBootstrap`, `composeBootstrapCommand`.
- `browser-first/host/agent-adapters/external-cli-terminal.mjs` — the generic
  launcher (`invoke()` → policy → `launchBootstrap`).
- `browser-first/host/harness-policies/pi.mjs` — `composeInvocation` (produces
  `pi <exec> @<file>` / `pi <exec> '<quoted>'`).
- `browser-first/bin/ros-session.mjs` — CLI args + POST body fields.
- `browser-first/host/harness-memory-projection.mjs` — `buildHarnessMemoryProjection`.

---

## 2. Hard rules

1. Token/credential/memory-content never argv/env/logs/bus. Only the
   `ROS_MEMORY_CONTEXT` **path** may appear in the proof output; never content.
2. The launch-Pi path must use the **reviewed `pi-v1` policy** (via
   `composeInvocation` / the generic launcher) — never a hand-rolled `pi`
   command or an ambient `PATH` `pi`.
3. Pi is long-lived; do not wait for `terminal.command.ended` as a success
   signal. Assert `terminal.command.started` + (for the smoke's own sanity)
   that the command did **not** end within the observation window.
4. Preserve the F1 grant-ownership fix, compatibility fail-closed (XH3), and
   memory fail-closed (M1). No merge of `feature/pi-testing-phase`; no push to
   `dev`/`main`/`upstream`; do not push until AVIS audits.

---

## 3. Phase L1 — fix the CP-S5c proof tail · gate CP-L1

1. Make the smoke pass memory projection through so `ROS_MEMORY_CONTEXT` is
   actually delivered: supply `memoryAccess` (e.g.
   `{ archiveReadMode: "read-only-context" }`) + a `stagingBase` (and
   `memoryRoot` if required) so `buildProjectedSessionEnv` projects memory.
   Thread the inputs end-to-end as M2 expects (route/CLI/command), and
   document the exact path if any flag/field must be added.
2. Extend the proof tail's `printf` to also emit
   `ROS_MEMORY_CONTEXT=$ROS_MEMORY_CONTEXT`.
3. Append `; sleep 1` to the proof tail so the command runtime exceeds 250ms
   and the `abnormal-command-exit-runtime` banner no longer fires.
4. Update the smoke assertions to also check the `ROS_MEMORY_CONTEXT` line
   (path present, non-empty, and it does not contain memory *content*).

**CP-L1 gate:** real Ghostty run shows a 4-line proof file
(`OPENAI_API_KEY`, `ROS_PROJECT_ROOT`, `ROS_SKILLS_DIR`, `ROS_MEMORY_CONTEXT`)
and the operator observes **no** "failed to launch" error page. Still exits
`CP-S5c green`.

`STOP AND REPORT` here.

---

## 4. Phase L2 — launch the real Pi · gate CP-L2

Add a launch-Pi proof that runs the actual `pi` TUI through the production
chain, not a `printf` placeholder.

Requirements:

1. Drive it through the **harness path**: dispatch a turn via `/agent/turn`
   (or call the `external-cli-terminal` adapter's `invoke()`) so the
   `pi-v1` policy's `composeInvocation` produces the real `pi` invocation, and
   `launchBootstrap({ commandSuffix })` delivers it.
2. The composed command must reference the **validated absolute `pi`
   executable** from `piCommand()` and a **0600 prompt file** (multi-line /
   oversize) — never a bare `pi` and never the prompt text inline.
3. Assert:
   - `piCommand()` resolved the executable;
   - the RPC to the terminal peer carries a `commandSuffix` containing the
     `pi` executable path + prompt-file path;
   - the attach route was hit and the grant consumed;
   - `terminal.session.started` and `terminal.command.started` fire;
   - the prompt file exists (0600) and is cleaned up;
   - no token/credential/prompt content in the command or bus events.
4. Final proof is **manual observation** (you, the operator): the Ghostty
   window shows Pi's TUI and stays open (long-lived). The smoke must print a
   clear `[smoke] observe Pi TUI in the Ghostty window — PASS? (yes/no)` prompt
   and pause/await that observation before teardown.

**CP-L2 gate:** automated assertions pass, and the operator reports Pi's TUI is
visibly running in the adopted terminal. A real credential is **not** required
to launch (Pi starts unauthenticated); it is only required for Tier 3 (a real
model call).

`STOP AND REPORT` here.

---

## 5. Phase L3 — real-credential run (Tier 3) · gate CP-L3

Document (in the smoke's header comments) how to run with a real key so Pi can
make an actual model call:

1. Configure a provider in Settings → Providers (ROS reads it session-only).
2. Run the launch-Pi smoke with that provider profile selected.
3. Operator confirms Pi can list models / complete a chat turn using the
   delivered credential.

This is a **manual** acceptance step, not an automated assertion. Record the
run in the report if the operator performs it.

**CP-L3 gate:** documented instructions present; if a real key is available,
the operator confirms a real model call succeeds.

`STOP AND REPORT` here.

---

## 6. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/harness-memory-projection.test.mjs \
  browser-first/test/harness-session-environment.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/harness-terminal-compatibility-xh3.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/ros-session-http-integration.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

And the real smokes:

```sh
RESONANT_TERMINAL_DRIVER=ghostty RESONANT_TERMINAL_HOST_BRIDGE=1 \
node --experimental-strip-types examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
```

Report counts by label: core / demo / browser-first (+ the real smoke results).

---

## 7. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label. Never trust a green number
you did not produce.

---

## 8. Out of scope (do not build here)

- Registry discovery (XH4), the "Open in Terminal" UI, additional harness
  policies, Linux adapters — later phases.
- `retrieval-with-citations` memory (deferred, not-implemented marker).

Suggested commits:

1. `fix(terminal-host): print ROS_MEMORY_CONTEXT + suppress Ghostty exit banner`
2. `feat(terminal-host): launch real pi TUI through the harness chain`
3. `docs(terminal-host): document real-credential acceptance run`
4. `docs(terminal-host): capture proof-fix + launch-pi prompt` (include this prompt).

Report explicitly when L1/L2 (and L3 if performed) are complete.
