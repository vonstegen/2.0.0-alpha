# Terminal Host — XH1+XH2: Generic External-CLI Harness + Pi Policy — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

This is the first build prompt of the "harnesses run across terminal add-ons"
workflow. It generalizes the proven Pi path into a reusable external-CLI
harness layer, so Pi, Claude Code, Codex, Hermes, and OpenCode can each run on
iTerm2 / Ghostty / WezTerm / kitty **without pair-specific code**.

---

## 0. Recorded decision + invariants

**Decision:** terminal surfaces and TUI harnesses are two independent,
many-to-many integration layers. ROS selects one of each and produces a
host-authorized launch plan. Credentials/memory/skills/project come from ROS,
never from the terminal app.

**Invariants (non-negotiable):**

1. A terminal adapter never resolves provider credentials.
2. A harness policy never controls terminal transport.
3. A manifest never provides executable paths or shell commands.
4. Only the host maps provider identity → credential env-var name.
5. Secrets never enter command strings, URLs, events, logs, or durable state.
6. Bootstrap grants stay short-lived, audience-bound, single-use.
7. Project/files/skills/memory are grants, not inferred from terminal cwd.
8. Compatibility is host-derived from requirements + capabilities.
9. Adding a terminal must not require editing a harness policy.
10. Adding a harness must not require editing a terminal adapter.

---

## 1. Prerequisite

Phase 0 (native-fetch + live-loopback + real Ghostty proof) is a separate,
still-open prompt: `prompts/TERMINAL-HOST-STEP5-HTTP-CLI-SMOKE-FIX-PROMPT.md`.
**Complete it first.** Do not run it in parallel with this prompt: both touch
`browser-first/host/harness-host-service.mjs` (adapter wiring). If Phase 0 is
not yet merged, build XH1/XH2 in a sequence that does not conflict, and keep
the current `pi-terminal-v1` behavior green until the cutover in XH2.

---

## 2. Authority — read first

- `browser-first/host/agent-adapters/pi-terminal.mjs` — the current Pi-specific
  adapter to split (generic launcher + Pi policy).
- `browser-first/host/harness-host-service.mjs` — `resolveAdapter`,
  `reviewedAdapterIds`, `createHarnessRegistry`.
- `browser-first/host/terminal-host-service.mjs` — corrected
  `launchBootstrap({ commandSuffix })` owner path; `buildProjectedSessionEnv`.
- `browser-first/host/pi-runtime.mjs` — `piCommand()` (fixed-root allowlist).
- `browser-first/host/pi-native-provider-map.mjs` — `resolvePiNativeProvider`.
- `examples/sdk-demo/terminal-host/iterm2/adapter.py` and
  `examples/sdk-demo/terminal-host/ghostty/adapter.mjs` — the two terminal
  adapters to read for their descriptors + parity checks (see 4a).
- `src/core/terminal-host-contract.ts` — terminal adapter contract shape.
- `src/core/contracts.ts` — harness/runtime/registry contracts.
- `browser-first/test/pi-terminal-adapter.test.mjs`,
  `browser-first/test/pi-terminal-grant-chain.test.mjs` — must remain green.

---

## 3. Hard rules

1. No `if (harness === "pi")` or `if (terminal === "ghostty")` inside the
   generic launcher.
2. The generic launcher must not import `piCommand()` or any Pi-specific symbol.
3. Manifests still cannot specify executables, commands, credential names, or
   arbitrary env maps. The validator rejects these.
4. Token/credential never argv/env/shell history/logs/events (unchanged).
5. F2 split holds: terminal adapter ops stay the four; ROS verbs stay on the
   session manager.
6. Preserve green regressions (core 735 / demo 103 / browser-first 90+).
7. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push this branch until AVIS audits.

---

## 4. Phase XH1 — formalize the two contracts · gate CP-XH1

### 4a. Terminal surface descriptor

Add a host-owned descriptor (suggested new file
`src/core/terminal-surface-contract.ts` or extend
`src/core/terminal-host-contract.ts` — pick and record):

```ts
interface TerminalSurfaceDescriptor {
  adapterId: string;
  platform: "macos" | "linux" | "windows";
  supportedOperations: readonly [
    "createSession",
    "launchBootstrap",
    "sendInput",
    "terminateSession",
  ];
  capabilities: readonly TerminalCapability[];
  feedbackChannel: "event-stream" | "polling" | "observation" | "none";
}

type TerminalCapability =
  | "command"
  | "environment"
  | "cwd"
  | "send-input"
  | "lifecycle-events"
  | "command-events"
  | "screen-stream"
  | "multiplexer"
  | "adopt-existing";
```

Populate descriptors for the existing adapters (iTerm2, Ghostty, in-memory).
The descriptor carries **no harness-specific behavior**.

### iTerm2 parity (fold into 4a)

While reading the iTerm2 adapter to populate its descriptor, verify it does
**not** share the two defects fixed on Ghostty — and fix, or file a
failing-test follow-up, for any gap:

1. **Long-command delivery.** Ghostty's AppleScript `command:"…"` dropped long
   commands (fixed via a 0600 script file). iTerm2 uses the iTerm2 Python API,
   which may not have the same limit. Confirm a long composed command
   (token/auth/project paths + `commandSuffix`) reaches the iTerm2 session
   intact; if not, apply the same script-file delivery pattern.
2. **Window/session cleanup on shutdown.** `terminateSession` must actually
   close the iTerm2 session/window, and the W1 tracked-sessions fix in
   `createTerminalHostService().stop()` must clean up iTerm2 windows too (the
   fix is adapter-agnostic, but the adapter's `terminateSession` must perform
   the real close).
3. **No-confirm close.** Determine whether iTerm2 prompts before closing a
   session with a running process, and whether teardown can close silently.
   Resolve any equivalent of Ghostty's `confirm-close-surface` the same way
   (keep the one-shot proof window open via the adapter's own mechanism; no
   running process at close time).

Record the iTerm2 adapter's actual `capabilities` and `feedbackChannel` in its
descriptor honestly — do not claim `command-events` or `screen-stream` that the
adapter does not actually provide.

### 4b. External-CLI harness policy contract

Add a host-owned policy contract (suggested
`src/core/external-cli-harness-contract.ts`):

```ts
interface ExternalCliHarnessPolicy {
  policyId: string;
  harnessId: string;
  executablePolicyId: string;
  terminalRequirements: readonly TerminalCapability[];
  credentialPolicy: {
    source: "provider-profile" | "self-auth" | "none";
    supportedProviderFamilies: readonly string[];
    delivery: "session-environment" | "native-login";
  };
  promptDelivery: "file" | "stdin" | "argv";
  supportsModelSelection: boolean;
  resolveExecutable(input: PolicyExecutableInput): ReviewedExecutable | null;
  composeInvocation(input: HarnessInvocationInput): ReviewedInvocation;
}
```

This is **host code**, not manifest code. It returns reviewed results only.

### 4c. Manifest declaration + validator

Allow a manifest to request a reviewed policy, never to define one:

```jsonc
{
  "runtimeType": "harness",
  "harnessRuntime": {
    "variant": "external-cli",
    "policyId": "pi-v1",
    "terminalRequirements": ["command", "environment", "lifecycle-events"],
    "credentialSource": "provider-profile",
    "promptDelivery": "file",
    "executionGating": "explicit-enable",
  },
}
```

The manifest validator must reject unknown `policyId`, executable paths,
commands, credential names, and unrestricted env maps. Add rejection tests.

**CP-XH1 gate:**

- `tsc` clean; contracts compile.
- Validator rejects an executable path, a command string, a credential name,
  and an unknown `policyId`.
- Validator accepts a valid `pi-v1` declaration.
- iTerm2/Ghostty/in-memory descriptors exist and are accurate.
- iTerm2 parity verified: long-command delivery intact (or a failing-test
  follow-up filed), and `stop()`/`terminateSession` close tracked iTerm2
  sessions with no confirmation prompt.

`STOP AND REPORT` here.

---

## 5. Phase XH2 — generic launcher + Pi policy · gate CP-XH2

### 5a. Generic external-CLI launcher

Create `browser-first/host/agent-adapters/external-cli-terminal.mjs`
(`createExternalCliTerminalAdapter`). Responsibilities:

1. Resolve the reviewed harness policy by `policyId`.
2. Resolve a compatible terminal surface (see XH1 descriptor; compatibility
   is a simple requirement ⊆ capability check in this phase).
3. `resolveExecutable()` via the policy; missing → `runtime-unavailable`.
4. Build the projected session env via `buildProjectedSessionEnv`.
5. Stage prompt/skills files (0600 where secret-bearing).
6. `composeInvocation()` via the policy → reviewed `commandSuffix`.
7. Call `terminalHostService.launchBootstrap({ commandSuffix, ... })`
   **without** `bootstrapCommand` (preserve the F1 ownership fix).
8. Translate terminal telemetry → harness `delta`/`final`/`error`.
9. Clean up temp files; support cancel/dispose.

The launcher must **not** import `pi-runtime.mjs`, reference `"pi"` strings, or
branch on harness/terminal identity.

### 5b. Pi policy

Create `browser-first/host/harness-policies/pi.mjs` implementing
`ExternalCliHarnessPolicy`:

- `resolveExecutable` → `piCommand()`.
- `composeInvocation` → `pi <executable> @<prompt-file>` (or quoted short
  prompt), reusing the existing POSIX quoting discipline.
- `credentialPolicy.source: "provider-profile"`,
  `supportedProviderFamilies` from `resolvePiNativeProvider` identities.
- `terminalRequirements`: `["command", "environment", "lifecycle-events"]`.
- `promptDelivery: "file"`.
- `supportsModelSelection: true`.

### 5c. Registry wiring + cutover

- Add `external-cli-terminal-v1` to `reviewedAdapterIds`.
- In `resolveAdapter`, route `pi-terminal-v1` (and the new manifest
  declaration) through `createExternalCliTerminalAdapter` with the `pi-v1`
  policy.
- Remove Pi-specific branching from the adapter resolution. Keep
  `pi-terminal.mjs` only if needed as a thin wrapper; prefer deleting it once
  tests pass against the generic path.

### 5d. Tests

- Convert `pi-terminal-adapter.test.mjs` and
  `pi-terminal-grant-chain.test.mjs` to exercise the generic launcher + `pi-v1`
  policy (same assertions as before, now through the generic path).
- Add a test asserting the generic launcher contains no Pi/terminal-specific
  branching (grep the built module for forbidden identifiers is acceptable as
  a lint-style test, but prefer behavioral proof: drive a second trivial
  in-memory policy through the same launcher and show it launches).

**CP-XH2 gate:**

- `tsc` clean.
- core 735 / demo 103 / browser-first green.
- Pi grant-chain passes through the generic launcher.
- A second (fixture) policy drives the same launcher end-to-end.
- The launcher source contains no harness/terminal identity branches.

`STOP AND REPORT` here.

---

## 6. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs
```

---

## 7. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label (core / demo /
browser-first). Never trust a green number you did not produce.

---

## 8. Out of scope (do not build here)

- The live-loopback HTTP/CLI fix and real Ghostty proof (Phase 0, separate
  prompt).
- Compatibility matrix UI/registry discovery (later phase).
- OpenCode / Claude / Codex / Hermes policies (later phases).
- Linux WezTerm/kitty adapters (later phase).
- Memory projection and "Open in Terminal" UI (later phases).

Suggested commits:

1. `feat(terminal-host): add terminal-surface + external-cli policy contracts`
2. `feat(terminal-host): extract generic external-CLI launcher; add pi-v1 policy`
3. `test(terminal-host): drive generic launcher through pi-v1 + fixture policy`
4. `docs(terminal-host): capture XH1+XH2 prompt` (include this prompt).

Report explicitly when XH1 + XH2 are complete, then pause for the
compatibility-resolver + registry-discovery prompt.
