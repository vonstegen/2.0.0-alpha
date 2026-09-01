# CP-5 Phase 5 continuation prompt

This document is the **Phase 5 continuation prompt** for the CP-5 reference
harness migration workstream. Read it before starting a fresh session on
Phase 5. It picks up where the CP-4 Phase 4 cutover left off, scoped to the
CP-5 workstream only.

## Workstream context

**Branch**: `feat/dev-external-agent-runtimes-panel` (worktree at
`/Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel`).

**Current head**: `91a5700` (synced on `feat/dev-external-agent-runtimes-panel`)
— the CP-4 Phase 4 cutover commit.

**Goal**: finish the four open CP-5 rows in
[`IMPLEMENTATION_TRACKING.md`](./IMPLEMENTATION_TRACKING.md) (rows 98, 99, 100,
103) by replacing the legacy packet-only host service blocks for Hermes and
OpenCode with the bridge, end-to-end validating the live CLI + Cordis
Hermes path and the live `opencode serve` path, and reclassifying the
OpenClaw gateway transport from conformance-only to real-transport.

## What's already done (Phases 1–4)

### Phase 1 — Conformance suite + 7 reference adapters (`2af17fb` + earlier)

`src/sdk/harnesses/conformance.ts` (`runHarnessProviderConformance`) +
`BaseHarnessProvider` + `Fake`/`Hermes`/`OpenCode`/`OpenClaw`/`AgentZero`/
`DeepSeekHarness`/`Pi`/`Aider` adapters; 5 gate checks × 8 providers pass —
seven shapes use one contract, no vendor-specific authority exception.

### Phase 2 — Bridge-side adapters wire real diagnose + governed dispatch

`browser-first/host/harness-provider-adapters.mjs`: 7 factories
(`create{Hermes,OpenCode,OpenClaw,AgentZero,DeepSeekHarness,Pi,Aider}ProviderAdapter`);
`governedRuntimeDispatch` builds a `GovernedRequest` from `(TaskPacket,
grantHandle)` and defers authority to `dispatchGovernedExternalAgentRuntime`
(no per-caller path); 10 tests incl. forged-subject denial + fail-closed
without authority.

### Phase 3 — Six harness-provider manifests bundled

`public/addons/{openclaw,opencode,agentzero,deepseek-harness,pi,aider}.json`
declare `extensionClass: "harness-provider"` + `harnessProvider`;
OpenClaw/OpenCode migrated in place, 4 new; `index.json` registers all six
(D-10).

### Phase 4 — Host-service lifecycle dedup (`91a5700`)

[`browser-first/host/addon-delegation-adapter-bridge.mjs`](../../../browser-first/host/addon-delegation-adapter-bridge.mjs) is the canonical author of the Hermes + OpenCode lifecycles;
[`browser-first/host/addon-delegation-service.mjs`](../../../browser-first/host/addon-delegation-service.mjs) no longer inlines credential gating, CLI invocation, env scoping, or result
parsing for either provider (only host-side glue: markdown status writes,
artifact I/O, route dispatch). 4 new seam parity tests in
`browser-first/test/addon-delegation-seam-parity.test.mjs` plus 1197
pre-existing extension tests still pass.

## What Phase 5 needs to do

Phase 5 in [`IMPLEMENTATION_TRACKING.md`](./IMPLEMENTATION_TRACKING.md) has
four open rows:

| Row | Item | Current state |
|---|---|---|
| 98 | Migrate Hermes to generic adapter | `in-progress` — real diagnose + dispatch wired; end-to-end (live CLI + Cordis) pending |
| 99 | Migrate OpenCode + workspace lease/isolation | `in-progress` — `opencodeRuntimeDispatch` drives a real `opencode serve` session; workspace lease enforcement + dedup pending |
| 100 | Validate OpenClaw against the contract | `in-progress` — runtime-gateway shape passes shared conformance; real gateway transport pending |
| 103 | Archive reads scoped/cited; writes intake-only | `in-progress` — `archive-promotion-guards.mjs` etc. present; per-harness parity pending |

The Phase 4 cutover already retired the **lifecycle dedup** half of rows 98
and 99 (row 104 is now `done`). Phase 5 picks up the **live transport +
conformance** halves.

### 5.1 — Hermes end-to-end (row 98)

The bridge seam proves the lifecycle parity. The remaining work is the
end-to-end happy path through the **live** Hermes CLI and the **live**
Cordis runtime:

- Add at least one test that drives a real `run_agent.py` invocation
  through `bridge.startTask` with `runtime.installed = true` and a
  real Python venv fixture (the existing in-process self-test at
  `browser-first/test/addon-cli-execution-inprocess-self-test.test.mjs`
  already exercises this for the host-service route — extend the same
  pattern to call the bridge directly, then verify the bridge-only
  result matches the route result).
- Add a test that drives a real `opencode serve` session through
  `opencodeRuntimeDispatch` (the CP-5 row 99 half), asserting the
  `WorkspaceLease` is acquired before the request and released after
  the response (parity with the SDK's `WorkspaceLease` flow).
- The workspace-lease enforcement: add a `workspace-lease.ts` shared
  helper that the `opencodeRuntimeDispatch` calls, and prove the
  bridge cannot bypass it (a test that runs `opencodeRuntimeDispatch`
  outside a lease holder returns 403).

### 5.2 — OpenClaw real gateway transport (row 100)

The conformance suite already passes. The remaining work is the real
MCP-gateway transport:

- Add a `gatewayClient` runtime that the OpenClaw adapter calls
  (parity with `opencodeRuntimeDispatch`).
- Add at least one test that spins a mock MCP server, calls the
  OpenClaw adapter's `dispatch` through `governedRuntimeDispatch`,
  and verifies the gateway is the only authority path (forged
  grant → 403; missing capability → 403; happy path → gateway
  forwards to the child actor).

### 5.3 — Per-harness archive parity (row 103)

The `archive-promotion-guards.mjs` machinery is present. The remaining
work is the per-harness parity:

- For each of the 7 reference adapters (Hermes, OpenCode, OpenClaw,
  AgentZero, DeepSeekHarness, Pi, Aider), prove that a synthesized
  result with an archive citation is *not* written to the trusted
  Living Archive without going through the intake path
  (`archive-review-service.mjs`). The test: dispatch a task whose
  result includes a "## Archive Citation" section, then assert the
  intake path was hit (not the direct write path).

### 5.4 — Tracking + doc 14

Update `IMPLEMENTATION_TRACKING.md`:

- Row 98 → `done` (Hermes end-to-end)
- Row 99 → `done` (OpenCode + workspace lease)
- Row 100 → `done` (OpenClaw real transport)
- Row 103 → `done` (per-harness archive parity)
- Row 101 (`Keep installs/config intact; approval-gate install`) —
  *not in scope for Phase 5; defer to Phase 6 (resource governor)*
- Row 105+ — Phase 6 is the next workstream; do not touch

Update `14-master-phased-implementation-checklist.md`:

- Phase 5 checkboxes:
  - "Migrate Hermes to the generic adapter and manifest class" → checked
  - "Migrate OpenCode and enforce workspace lease/isolation semantics" → checked
  - "Validate OpenClaw or another structurally different harness against the same contract" → checked
  - "Keep existing installs/configuration intact and approval-gate installation" → unchecked (Phase 6)
  - "Verify archive reads are scoped/cited and writes remain intake-only" → checked

### 5.5 — Run the full `engineer:verify` gate

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
npm run docs:check
npx tsc --noEmit
npx vitest run
node scripts/run-browser-first-extension-tests.mjs
```

All gates must be green. The Phase 4 baseline is `1201/1201` extension
tests; Phase 5 should add at least **4 new tests** (Hermes end-to-end,
OpenCode end-to-end, OpenClaw real transport, archive-parity × 7
harnesses) without regressing any of the 1201.

### 5.6 — Commit + push

One Phase 5 commit per sub-area (5.1, 5.2, 5.3), then a final cutover
commit that updates tracking + doc 14 + verifies the engineer:verify
gate + pushes to `feat/dev-external-agent-runtimes-panel`.

## What Phase 5 must NOT do

- Do NOT change the public wire format of
  `executeXDelegationStart/Status/Artifact/Cancel` — the bridge seam
  preserved it bit-for-bit; Phase 5 must keep it.
- Do NOT touch the SDK adapters (`src/sdk/harnesses/*.ts`) — they
  passed conformance in Phase 1 and the bridge already implements
  the same lifecycle in `.mjs`. Phase 5 only adds live-transport
  tests and the workspace-lease helper.
- Do NOT collapse the bridge into the legacy host service — the
  Phase 4 cutover is the seam; Phase 5 builds on it, not over it.
- Do NOT introduce a new harness-provider class — only the 7
  reference shapes (Hermes, OpenCode, OpenClaw, AgentZero,
  DeepSeekHarness, Pi, Aider) are in scope for Phase 5.
- Do NOT touch Phase 6 (resource governor) — it is the next
  workstream after Phase 5 lands.

## Risks + mitigations

- **Workspace lease contention.** If the live `opencode serve` test
  races another test for the same workspace, the test will flake.
  Mitigation: each test acquires a unique temp workspace under
  `os.tmpdir()`; the lease helper scopes per-test.
- **Hermes Python venv drift.** The in-process self-test ships a
  fake `run_agent.py`. The bridge end-to-end test must use the
  same fake to avoid pulling a real Hermes install into the test
  matrix. Mitigation: copy the fixture from
  `addon-cli-execution-inprocess-self-test.test.mjs` into a new
  `bridge-harness-end-to-end.test.mjs`.
- **OpenClaw gateway stubbing.** A real MCP server is heavy; the
  test must stub the gateway with the same shape the SDK adapter
  expects. Mitigation: reuse the conformance test's fake gateway,
  lift it into a `MockMcpGateway` helper exported from the
  conformance module.
- **Archive-parity false positive.** The intake path is the only
  write path. A test that only checks "the write happened" is
  insufficient; the test must check "the write went through the
  intake path" (e.g. assert `archive-review-service.mjs` was
  invoked, not `archive-write.mjs`).

## Where to start in a fresh session

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
git log --oneline -10
git status
git checkout -b feat/cp5-phase5-reference-harnesses
```

Then read:
- This file (Phase 5 continuation prompt)
- The CP-5 row context in
  [`IMPLEMENTATION_TRACKING.md`](./IMPLEMENTATION_TRACKING.md) rows 91–104
- The Phase 4 cutover commit `91a5700` and the seam parity tests at
  [`browser-first/test/addon-delegation-seam-parity.test.mjs`](../../../browser-first/test/addon-delegation-seam-parity.test.mjs)
- The CP-4 migration table at
  [`CP4-LIFECYCLE-EXTRACTION-MIGRATION.md`](./CP4-LIFECYCLE-EXTRACTION-MIGRATION.md)
  (background — Phase 4 already retired the lifecycle-dedup half)

Then plan Phase 5 commits: 5.1 (Hermes + OpenCode end-to-end) →
5.2 (OpenClaw real transport) → 5.3 (per-harness archive parity) →
final cutover (tracking + doc 14 + verify gate + push).
