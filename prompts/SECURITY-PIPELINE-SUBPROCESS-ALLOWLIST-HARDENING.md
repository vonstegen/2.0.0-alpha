# OMP BUILD — Security Pipeline Subprocess Allowlist Hardening

Paste this entire prompt into a new OMP harness session.

---

You are hardening the ResonantOS security pipeline's subprocess/terminal
allowlist. Read this prompt and the listed files before editing anything. Do not
rely on prior chat history.

## 0. Mission

The security pipeline (`scripts/security-pipeline/run-check.mjs`) is green
(72 verdict-pass, 0 fail, 0 warn), but it reports 16 **off-list-approved**
subprocess spawn sites: commands that execute under a reviewed `approved_by`
marker instead of sitting on the explicit terminal allowlist. This session makes
the subprocess posture explicit and closed rather than relying on scattered
inline approval markers, while preserving every existing security invariant.

This session covers **only** the subprocess/terminal-allowlist hardening:

1. inventory the 16 off-list-approved sites and their command heads;
2. for each fixed, reviewed, pinned command, move it onto the explicit terminal
   allowlist in `.github/security-pipeline/checks.yml`;
3. for each command that legitimately cannot be allowlisted (platform-specific
   file-open/browse helpers, runtime-installed binaries), keep a reviewed
   approval marker and document why it is not a fixed allowlist entry;
4. verify `shell: false`, `env-clear`, pinned roots, and no-argv-secret on every
   affected site;
5. add a regression test asserting the off-list set is closed (no new unapproved
   off-list spawn can be introduced);
6. `STOP AND REPORT`.

Do **not** touch feature work (CP-BR0…CP-BR4 or later), do not weaken any
currently passing check, and do not widen any allowlist to a broad shell or
ambient-PATH executable.

## 1. Repository and branch

Repository:

```text
/Users/andrewjochl/Developer/Projects/resonant-os/2.0.0-alpha
```

Branch:

```text
r-and-d/terminal-host-current-dev
```

Base `HEAD`:

```text
ce6ebdf3 feat(terminal-host): add Launch Bridge UI affordance + auto-retry
```

No commits were made during CP-BR0 through CP-BR4; all work remains uncommitted
in the working tree. The branch is still ahead of origin. Nothing should be
pushed.

Use:

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Node 24+ is required; Homebrew Node 26 is the known-working version.

## 2. Preserve the worktree

Five phases (CP-BR0…CP-BR4) are uncommitted. Inspect `git status` first and
preserve everything. Do not reset, discard, overwrite, or broadly reformat
existing work. Before editing a modified file, inspect its working-tree diff.

Editor/formatting previously caused whole-file JS/TS/Markdown noise. Use surgical
edits. If formatting noise appears, restore only your own edit and reapply it
with an exact-string throwaway script, then delete the script.

Do not push, open a PR, merge, rebase, or merge `feature/pi-testing-phase`.

## 3. Source of truth — read in order

1. `scripts/security-pipeline/run-check.mjs`
2. `.github/security-pipeline/checks.yml`
   - especially `recordSets.browser-first-production-spawns` and any terminal
     allowlist declaration;
3. `scripts/security-pipeline/checks/subprocess-terminal-allowlist.mjs`
4. `scripts/security-pipeline/checks/subprocess-pinned-roots.mjs`
5. `scripts/security-pipeline/checks/subprocess-no-argv-secret.mjs`
6. `scripts/security-pipeline/checks/subprocess-env-clear.mjs`
7. `scripts/security-pipeline/checks/committed-private-key-material.mjs`
8. `scripts/security-pipeline/checks/npm-lockfiles.mjs`
9. `scripts/security-pipeline/disclosure-baseline.test.mjs`
10. `SECURITY.md`
11. `.github/workflows/security.yml`

## 4. Current state (do not regress)

- `run-check.mjs` currently reports **72 verdict-pass, 0 fail, 0 warn**.
- The off-list-approved command heads and their count:

```text
openssl       4   (browser-first/host/bridge-tls.mjs — TLS certificate ops)
xdg-open      2   (diagnostics/memory-source open helper)
open          2   (browser-diagnostics-service.mjs launchDiagnosticDownload:darwin)
explorer.exe  2   (browser-diagnostics-service.mjs launchDiagnosticDownload:win32)
zenity        1   (memory-source-settings-service.mjs executeMemorySourceBrowse)
python        1   (addon-delegation-service.mjs:execHermesPythonAdapter)
powershell.exe 1  (memory-source-settings-service.mjs executeMemorySourceBrowse:win32)
osascript     1   (memory-source-settings-service.mjs executeMemorySourceBrowse:darwin)
opencode      1   (addon-delegation-service.mjs:execOpenCodeCli)
kdialog       1   (memory-source-settings-service.mjs executeMemorySourceBrowse)
```

Re-derive this list yourself from `run-check.mjs` before editing; treat this
table as a starting inventory only.

## 5. Required behavior

### 5.1 Inventory and classify

For each off-list-approved site, record: file:function, command head, platform,
whether the command is a **fixed/pinned binary** (deterministic absolute path or
fixed install root) or a **platform dispatch helper** (`open`, `xdg-open`,
`explorer.exe`, `osascript`, `powershell.exe`, `zenity`, `kdialog`).

### 5.2 Fixed commands → explicit allowlist

For fixed, reviewed, pinned commands (e.g. `openssl`, `python` for the Hermes
venv, `opencode`), move them onto the explicit terminal allowlist in
`.github/security-pipeline/checks.yml`. Each entry must declare:

- the exact program (fixed path or pinned resolution, no ambient PATH lookup);
- a closed argv shape;
- `shell: false`;
- `env-clear: true` with an explicit `env_vars` allowlist;
- the `approved_by` rationale.

After the move, the site must no longer report `off-list-approved` — it should
report `on-list` or the equivalent passing rule.

### 5.3 Platform helpers → reviewed marker, no widening

For platform dispatch helpers (`open`, `xdg-open`, `explorer.exe`, `osascript`,
`powershell.exe`, `zenity`, `kdialog`), keep a reviewed approval marker but:

- ensure the call is `shell: false` with a fixed argv (no string interpolation of
  user input into a shell string);
- ensure no credential/token/path/env value is passed in argv;
- ensure the helper is dispatched only from the reviewed capability boundary;
- document, per site, why it is not a single fixed binary (platform abstraction).

Do **not** add a bare shell interpreter or a wildcard executable to the
allowlist.

### 5.4 Invariants to preserve (verify, do not weaken)

Every affected site must continue to satisfy:

- `shell: false`;
- env-clear (no `process.env` spread into the child);
- pinned roots (no ambient executable resolution);
- no argv secret (no token, credential, or private path in argv).

If any site currently violates one of these, fix it in the same change; if a
violation is intentional and reviewed, record it explicitly.

### 5.5 Closed-off-list regression test

Add or extend a test that enumerates every off-list spawn site and asserts:

- every site has either an explicit allowlist entry or a reviewed approval
  marker;
- the set of approved command heads is closed (no new off-list head appears
  without an explicit allowlist entry or marker);
- no site uses `shell: true` or spreads `process.env`.

The test must fail if a future change introduces an unapproved off-list spawn.

## 6. Non-negotiable security rules

1. No caller-supplied executable, command, argv, shell string, path, cwd, or env.
2. No `shell: true` spawn; no ambient PATH lookup for fixed binaries.
3. No `process.env` spread into a child; explicit env allowlist only.
4. No token, credential, provider secret, or private path in argv.
5. Pinned executable roots for fixed commands.
6. Do not widen the terminal allowlist to a broad shell or wildcard.
7. Do not regress `committed-private-key-material`, `npm-lockfiles`, or the
   disclosure baseline.
8. Do not touch CP-BR0…CP-BR4 feature code beyond the security findings.

## 7. Test requirements

- `run-check.mjs` still ends **0 fail** (and, ideally, 0 warn) after the change;
- the off-list set is closed by the new regression test;
- existing security-pipeline check tests remain green:
  - `scripts/security-pipeline/checks/*.test.mjs`;
- `disclosure-baseline.test.mjs` remains green;
- no new off-list head can be introduced (negative test).

## 8. Documentation

Update `SECURITY.md` and/or `.github/security-pipeline/checks.yml` comments to
describe:

- the terminal-allowlist policy (fixed binaries are allowlisted; platform
  helpers are marker-approved);
- the rationale for each retained approval marker;
- the process for adding a future reviewed spawn.

## 9. Verification

```sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

node scripts/security-pipeline/run-check.mjs --certify
node --test scripts/security-pipeline/checks/*.test.mjs
node --test scripts/security-pipeline/disclosure-baseline.test.mjs
npx tsc --noEmit
git diff --check
```

Also run the full CP-BR0…CP-BR4 regression to prove no feature regressions:

```sh
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/bootstrap-protocol.test.mjs \
  browser-first/test/bootstrap-framing.test.mjs \
  browser-first/test/bootstrap-lifecycle.test.mjs \
  browser-first/test/bootstrap-host-main.test.mjs \
  browser-first/test/bootstrap-installer.test.mjs \
  browser-first/test/bootstrap-client.test.mjs \
  browser-first/test/bootstrap-startup.test.mjs \
  browser-first/test/rebind-coordinator.test.mjs \
  browser-first/test/bootstrap-manifest-and-launch-route-absent.test.mjs \
  browser-first/test/bridge-bootstrap-probe.test.mjs \
  browser-first/test/bridge-launcher.test.mjs \
  browser-first/test/bridge-launch-route.test.mjs \
  browser-first/test/bridge-target-section-launch.test.mjs \
  browser-first/test/terminal-host-launch.test.mjs \
  browser-first/test/terminal-host-status.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/bridge-auth-inprocess-self-test.test.mjs \
  browser-first/test/runtime-reconciler.test.mjs \
  packages/addon-sdk/test/runtime-lifecycle.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
node --test --test-concurrency=1 scripts/module-ownership-doc.test.mjs
```

Report:

- the final `run-check.mjs` verdict breakdown (pass/warn/fail/skipped) and the
  exact number of remaining off-list-approved sites;
- per-site disposition (allowlisted vs marker-retained) and rationale;
- any invariant violation found and fixed;
- test counts labeled `core`, `demo`, `browser-first`, `security`, `ownership`.

Do not claim a test passed unless you ran it and saw it pass.

## 10. Editing and Git discipline

- Preserve all uncommitted CP-BR0…CP-BR4 work.
- Do not push.
- Do not rewrite history, merge, or rebase.
- Do not commit unrelated files.
- If the accumulated uncommitted work makes safe isolated commits ambiguous,
  leave changes uncommitted and report that explicitly.
- Keep the change scoped to the security pipeline and the specific sites it
  flags.

Suggested commit sequence only if the worktree permits isolated commits safely:

1. `security(bridge): move fixed subprocess commands onto the terminal allowlist`
2. `security(bridge): document platform-helper approval markers`
3. `test(security): close the off-list spawn set`

## 11. Gate

Green only when all are true:

- `run-check.mjs --certify` passes with 0 fail;
- every off-list-approved site is either explicitly allowlisted or has a
  documented, reviewed marker with `shell: false`, env-clear, pinned roots, and
  no-argv-secret;
- the closed-off-list regression test is in place and fails on a new unapproved
  spawn;
- no existing security check regresses;
- the CP-BR0…CP-BR4 regression remains green.

## 12. Final report format

Report:

1. **Verdict:** green / partial / blocked.
2. **Inventory:** final off-list site list and per-site disposition.
3. **Files and commits:** exact files changed and commit hashes, or state why no
   commits were safe.
4. **Allowlist changes:** which commands moved onto the allowlist and their
   pinned program/argv/env/roots.
5. **Markers retained:** which platform helpers keep a marker and why.
6. **Invariant fixes:** any `shell`/env/argv/root violation found and fixed.
7. **Tests:** `run-check.mjs` verdict breakdown and labeled test counts.
8. **Remaining risks/blockers.**
9. Explicit `STOP`.

The session is complete only when the pipeline is green and the off-list set is
closed, or honestly blocked with a clear report.
