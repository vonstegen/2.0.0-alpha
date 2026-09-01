# CP-4 Phase 4 continuation prompt

This document is the **Phase 4 continuation prompt** for the CP-4 lifecycle
extraction workstream. Read it before starting a fresh session on Phase 4.

## Workstream context

**Branch**: `feat/dev-external-agent-runtimes-panel` (worktree at
`/Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel`).

**Current head**: `bc6435f` (synced on `feat/dev-external-agent-runtimes-panel`).

**Goal**: thin the legacy host service so the per-provider branches
delegate to the adapters migrated in Phase 2 + Phase 3, then verify the
≥50% line-count reduction and update tracking + doc 14.

## What's already done (Phases 1–3)

### Phase 1 — Migration table (`e0f6f73`)

Doc: [`CP4-LIFECYCLE-EXTRACTION-MIGRATION.md`](./CP4-LIFECYCLE-EXTRACTION-MIGRATION.md).
Per-provider method → generic counterpart mapping with blast-radius and
cost columns. Identified Hermes as lowest-blast-radius provider.

### Phase 2 — Hermes (`0a37538` + `3b96b1c`)

`src/sdk/harnesses/hermes-provider-adapter.ts` lifts the Hermes lifecycle
onto `BaseHarnessProvider`. 17 parity tests in
`hermes-provider-adapter.test.ts`.

### Phase 3 — Full provider migration set (`6708155` + `feb9237` + `beb7d92` + `068bae4` + `2af17fb` + `bc6435f`)

Five provider adapters migrated, each with its own parity tests:

| Provider | File | Tests | Distinct shape |
|---|---|---|---|
| OpenCode | `opencode-provider-adapter.ts` | 18 | `finish-atomic` cancel, workspace-root enforcement, JSON-stream CLI parsing |
| OpenClaw | `openclaw-provider-adapter.ts` | 11 | `quarantine` cancel + forensic-survival, gateway child enumeration |
| AgentZero | `agentzero-provider-adapter.ts` | 10 | `cancel` + `docker kill` lifecycle, single container-agent child |
| DeepSeek | `deepseek-provider-adapter.ts` | 12 | OpenAI-compatible HTTP delegation, single cloud-inference child |
| Hermes | `hermes-provider-adapter.ts` | 17 | (already in Phase 2) |

Total: **68 parity tests across 5 providers**. Conformance suite still
passes for all 8 reference providers. 1197 browser-first extension tests
still pass. `tsc --noEmit` clean. `npm run docs:check` green.

### Per-provider runtime contract pattern

Each adapter follows the same dependency-injected runtime pattern:

```ts
export interface XRuntime {
  discoverCommand(...): Promise<string | null>;
  readSecrets(): Promise<Record<string, { key: string }>>;
  readExecutionSettings(): Promise<{...}>;
  invokeCli(command, args/prompt, options): Promise<string>;
  artifactRoot(workspaceRoot): string;
  artifactFilename(runId): string;
  // + provider-specific (e.g. listChildActors for OpenClaw, killContainer for AgentZero)
}

const NULL_RUNTIME: XRuntime = { ... };

export function makeFakeXRuntime(overrides): XRuntime { ... }
```

Adapters expose:
- `providerId`, `cancellationSemantics`, `sandboxStrength` (identity)
- `diagnose()` (health)
- `listChildActors(runId)` override when children are non-empty
- `startTask(packet, grant)` override (lifecycle)
- `cancelTask(runId, reason)` override (provider-specific semantics)
- Helper parity methods: `localExecutionEnabled`, `credentialState`,
  `credentialBlockedReason`, `buildExecutionPrompt`, `parseCliResult`,
  `isCredentialError`, etc.

## What Phase 4 needs to do

### 4.1 — Add a dispatch seam in the host service

`browser-first/host/addon-delegation-service.mjs` is the 95 KB host
service that embeds 72 Hermes refs + 43 OpenCode refs + 27 OpenClaw refs
+ 22 AgentZero refs + 18 DeepSeek refs + smaller Aider/Pi refs inline.

Currently each `executeXDelegationStart/Status/Artifact/Cancel` function
implements the full per-provider lifecycle. **Phase 4 replaces these
implementations with calls into the corresponding adapter** that was
migrated in Phases 2–3.

The seam pattern (concrete code change for each provider):

```js
// BEFORE (Phase 3 legacy):
async function executeOpenCodeDelegationStart(payload = {}) {
  // ... 110 lines of inline CLI invocation, credential gating, status writes ...
}

// AFTER (Phase 4 cutover):
async function executeOpenCodeDelegationStart(payload = {}) {
  const adapter = openCodeAdapter();
  const packet = openCodeTaskPacket(...);
  const run = await adapter.startTask(packet, grantHandle);
  return delegationSummaryFromRun(run, ...);
}
```

Each provider block in the host service shrinks to ~20–30 lines of glue:
- Read packet markdown
- Translate host-side payload into the adapter's `TaskPacket`
- Call `adapter.startTask` / `getTask` / `events` / `cancelTask` / `collectArtifacts`
- Translate the adapter's result back into the host's markdown format
- Write the markdown via the host's existing `writeDelegationStatus` /
  `writeXResultArtifact` helpers (KEEP these — they are host glue, not
  provider lifecycle)

### 4.2 — Acceptance: ≥50% line-count reduction

`addon-delegation-service.mjs` is currently ~95 KB / ~2257 lines.
Phase 4 acceptance: the file must shrink to **≤1128 lines** (50%
reduction). The migration table's "shared host glue (KEEP)" column
defines what's preserved; everything else moves to adapters.

### 4.3 — Tests

- All migrated adapters' parity tests still pass (68 tests across 5
  providers).
- All 1197 browser-first extension tests still pass — the seam must
  preserve the host service's exact wire format.
- The conformance suite still passes for all 8 reference providers.
- Add **at least 1 new seam test per provider** that calls
  `executeXDelegationStart/Status/Artifact/Cancel` and verifies the
  result matches what the adapter alone produces (round-trip parity).

### 4.4 — Tracking + doc 14

Update `IMPLEMENTATION_TRACKING.md` row 84 to mark it `done` and link
the seam commit. Update row 85 (preserve Hermes/OpenCode compatibility
routes) to `done` since the seam is the preservation. Update row 88
(CP-5 dedup row) to reflect the lifecycle-dedup state.

Check off doc 14 Phase 4 checkboxes (the master-phased implementation
checklist):
- "Phase 4 cutover" group
- "Confirm addon-delegation-service.mjs is thin glue" checkbox
- "Run full engineer:verify gate" checkbox

### 4.5 — Run the full `engineer:verify` gate

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
npm run docs:check
npx tsc --noEmit
npx vitest run
node scripts/run-browser-first-extension-tests.mjs
npm run engineer:verify  # if it exists; otherwise run the components above
```

All gates must be green.

### 4.6 — Commit + push

One final cutover commit + push to `feat/dev-external-agent-runtimes-panel`.

## What Phase 4 must NOT do

- Do NOT touch the migrated adapters — they are the canonical author.
- Do NOT add new provider branches to the host service.
- Do NOT delete the host service's per-provider markdown I/O helpers
  (`writeDelegationStatus`, `writeXResultArtifact`, `delegationSummaryFromMarkdown`,
  `resultArtifactPathFromMarkdown`, `resolveDelegationPath`) — these
  are host glue.
- Do NOT change the wire format of `executeXDelegationStart/Status/Artifact/Cancel`
  responses — the host service is the public surface that 1197 tests
  pin.
- Do NOT introduce runtime changes via terminology changes — preserve
  every gate.

## Risks + mitigations

- **Wire-format drift**: any change to the response shape of
  `executeXDelegationStart/Status/Artifact/Cancel` breaks 1197 tests.
  Mitigation: run the full browser-first extension suite after every
  commit; bisect on failure.
- **Concurrency**: the host service may run multiple delegations in
  parallel; the adapter's `BaseHarnessProvider` state machine must
  remain thread-safe (it already is — state is keyed by `runId`).
- **Credential routing**: each provider's adapter has its own credential
  routing. Do NOT consolidate into a shared helper until Phase 5
  (out of scope for Phase 4).

## Where to start in a fresh session

```sh
cd /Users/andrewjochl/Developer/Projects/2.0.0-alpha.worktrees/feat-dev-panel
git log --oneline -10
git status
wc -l browser-first/host/addon-delegation-service.mjs
```

Then read:
- This file (Phase 4 continuation prompt)
- The migration table:
  [`CP4-LIFECYCLE-EXTRACTION-MIGRATION.md`](./CP4-LIFECYCLE-EXTRACTION-MIGRATION.md)
- The Phase 3 evidence row:
  [`IMPLEMENTATION_TRACKING.md`](./IMPLEMENTATION_TRACKING.md) row 84
- The migrated adapters (one at a time): `hermes-provider-adapter.ts`,
  `opencode-provider-adapter.ts`, `openclaw-provider-adapter.ts`,
  `agentzero-provider-adapter.ts`, `deepseek-provider-adapter.ts`

Then plan Phase 4 commits: one per provider block, ending with a
final cutover commit that updates tracking + doc 14 + verifies the
≥50% line-count reduction + pushes to `feat/dev-external-agent-runtimes-panel`.
