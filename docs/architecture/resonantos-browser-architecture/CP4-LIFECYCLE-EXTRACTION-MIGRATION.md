# CP-4 Lifecycle Extraction — Migration Table

Status: **Phase 1 artifact** (planning; no code changes yet).
Branch: `feat/dev-external-agent-runtimes-panel` at `985d568`.
Tracking row: [IMPLEMENTATION_TRACKING.md](../../architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md) row 84 (`Extract generic start/status/events/cancel/artifact`).

The host-side delegation service
[`browser-first/host/addon-delegation-service.mjs`](../../../browser-first/host/addon-delegation-service.mjs)
(95 KB, **2257 lines**) embeds per-provider lifecycle logic directly in
`createAddonDelegationService`. The destination generic adapter

The destination generic adapter
[`src/sdk/harnesses/base-harness-provider.ts`](../../../src/sdk/harnesses/base-harness-provider.ts)
(`BaseHarnessProvider`) already implements the full start / status / events /
cancel / artifact surface (137 lines, single abstract base), and
[`src/sdk/harnesses/reference-providers.ts`](../../../src/sdk/harnesses/reference-providers.ts)
already ships per-provider reference adapters (`HermesProviderAdapter`,
`OpenCodeProviderAdapter`, `OpenClawProviderAdapter`, `AgentZeroProviderAdapter`,
`DeepSeekHarnessProviderAdapter`, `PiProviderAdapter`, `AiderProviderAdapter`)
— but **the host service does not call them**. They are a parallel reality:
the legacy host service is the authority; the SDK adapters are shape stubs
that the conformance suite gates but that nobody dispatches through.

Per-provider block count in the host service:

| Provider | Token references in `addon-delegation-service.mjs` | Lines per major function |
|---|---|---|
| Hermes | 72 | ~100 for `executeHermesDelegationRun`, ~50 for `executeHermesStatus`, smaller for status/artifact/cancel |
| OpenCode | 43 | ~100 for `executeOpenCodeDelegationRun`, ~50 for `executeOpenCodeStatus`, smaller for status/artifact/cancel |
| Engineer | 3 (small — only appears in target validation list) | n/a |

The host service's 5-function pattern per provider is identical in shape;
the per-provider difference is concentrated in credential resolution, the
CLI invocation, the result-parsing heuristic, and the dashboard side-effects.

## Destination contract (what `BaseHarnessProvider` already provides)

```ts
abstract class BaseHarnessProvider implements HarnessProviderAdapter {
  abstract readonly providerId: string;
  abstract readonly cancellationSemantics: HarnessCancellationSemantics;
  abstract readonly sandboxStrength: HarnessSandboxStrength;

  abstract diagnose(): Promise<HarnessHealth>;
  listChildActors(runId: string): Promise<HarnessChildDescriptor[]>;  // default []

  startTask(packet: TaskPacket, grant: GrantHandle): Promise<HarnessRun>;
  getTask(runId: string): Promise<HarnessRunState>;
  events(runId: string, cursor?: string): AsyncIterable<TaskEvent>;
  cancelTask(runId: string, reason: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ArtifactRef[]>;

  // conformance drivers
  recordArtifact(runId, artifact): void;
  complete(runId, artifacts?): void;
  fail(runId, detail): void;
  emitProgress(runId, detail): void;
}
```

Every method except `diagnose` and `listChildActors` is **already implemented
generically**. Provider adapters must only:

1. Encode their `providerId`, `cancellationSemantics`, `sandboxStrength`.
2. Implement `diagnose()` for the provider's health check.
3. Override `listChildActors(runId)` if the provider has child actors
   (OpenClaw only, per doc 05).
4. Drive the legacy runtime by overriding `startTask` — that's the seam where
   per-provider lifecycle behavior lives.

## Migration table

Columns:
- **Symbol** — the legacy function or helper in `addon-delegation-service.mjs`.
- **Generic counterpart** — the method on `BaseHarnessProvider` or its subclass.
- **Provider** — which provider the symbol is currently scoped to (Hermes / OpenCode / Engineer / shared).
- **Blast radius** — `low` (local helper, no external I/O), `medium` (touches CLI invocation + filesystem), `high` (touches credential resolution + cross-process state).
- **Cost** — rough estimate (S = small, M = medium, L = large).
- **Migration** — `drop` (delete, generic covers it), `lift` (move logic to subclass override), `thin` (keep as host glue, no provider branching).

### Per-provider run paths

| Symbol | Generic counterpart | Provider | Blast | Cost | Migration |
|---|---|---|---|---|---|
| `executeHermesDelegationStart` (≈L100–200) | `HermesProviderAdapter.startTask` | Hermes | high | L | **lift** — credentials + CLI invocation move to subclass; status state machine stays on `BaseHarnessProvider` |
| `executeHermesDelegationStatus` (≈L50) | `BaseHarnessProvider.getTask` + `collectArtifacts` | Hermes | medium | S | **thin** — adapter delegates to base, host reads markdown packet only for the summary block |
| `executeHermesDelegationArtifact` (≈L40) | `BaseHarnessProvider.collectArtifacts` | Hermes | medium | S | **thin** — adapter delegates to base, host reads artifact markdown |
| `executeHermesDelegationCancel` (≈L30) | `BaseHarnessProvider.cancelTask` | Hermes | medium | S | **thin** — adapter delegates to base, host writes cancelled status to the packet |
| `executeHermesDelegationList` (≈L40) | `BaseHarnessProvider.getTask` per delegation | Hermes | low | S | **thin** — host lists packets, adapter resolves summary per packet |
| `executeOpenCodeDelegationStart` (≈L100–200) | `OpenCodeProviderAdapter.startTask` | OpenCode | high | L | **lift** — workspace path + CLI invocation move to subclass; OpenCode's `finish-atomic` semantics already enforced via `cancellationSemantics: "finish-atomic"` |
| `executeOpenCodeDelegationStatus` | `BaseHarnessProvider.getTask` | OpenCode | medium | S | **thin** |
| `executeOpenCodeDelegationArtifact` | `BaseHarnessProvider.collectArtifacts` | OpenCode | medium | S | **thin** |
| `executeOpenCodeDelegationCancel` | `BaseHarnessProvider.cancelTask` | OpenCode | medium | S | **thin** |
| `executeOpenCodeStatus` (≈L50) | `OpenCodeProviderAdapter.diagnose` | OpenCode | medium | M | **lift** — runtime command discovery moves to `diagnose()` |
| `executeHermesStatus` (≈L50) | `HermesProviderAdapter.diagnose` | Hermes | medium | M | **lift** — profile home + command discovery + dashboard status moves to `diagnose()` |

### Per-provider helpers (Hermes)

| Symbol | Generic counterpart | Blast | Cost | Migration |
|---|---|---|---|---|
| `hermesProvider` (L938) | constructor argument on `HermesProviderAdapter` | medium | S | **lift** — pass provider in via adapter config |
| `hermesModel` (L948) | constructor argument on `HermesProviderAdapter` | medium | S | **lift** |
| `hermesProviderCredentialState` (L964) | `diagnose()` body | medium | S | **lift** — credentials are diagnose-time concern |
| `hermesProviderCredentialBlockedReason` (L978) | moved into `HermesProviderAdapter.startTask` blocked-path | low | S | **lift** |
| `hermesRuntimeProviderConfig` (L992) | constructor argument on `HermesProviderAdapter` | low | S | **lift** |
| `hermesCommand` (external dep) | `HermesProviderAdapter.diagnose()` | low | S | **lift** |
| `hermesHome` (external dep) | constructor argument | low | S | **lift** |
| `deterministicHermesResult` (L861) | moved into `HermesProviderAdapter.startTask` deterministic branch | low | S | **lift** |
| `parseHermesCliResult` (L911) | moved into `HermesProviderAdapter.startTask` cli branch | medium | M | **lift** — must preserve the unresolved-tool-call detection |
| `buildHermesExecutionPrompt` (L887) | moved into `HermesProviderAdapter.startTask` cli branch | low | S | **lift** |
| `runHermesCliDelegation` (≈L100) | moved into `HermesProviderAdapter.startTask` cli branch | high | L | **lift** — preserves the credential-error-blocked recovery path |
| `writeHermesResultArtifact` (≈L60) | `BaseHarnessProvider.recordArtifact` | low | S | **thin** — adapter calls `recordArtifact`, host writes markdown |
| `executeHermesDashboardStatus` / `Start` / `Stop` | side-effecting host functions; **NOT** a generic adapter concern | high | L | **keep** — dashboard is host glue, not provider lifecycle |
| `hermesProviderCredentialBlockedReason` env-hint logic | stays as helper, called from adapter | low | S | **thin** |

### Per-provider helpers (OpenCode)

| Symbol | Generic counterpart | Blast | Cost | Migration |
|---|---|---|---|---|
| `currentOpenCodeRuntime` (L399) | `OpenCodeProviderAdapter.diagnose()` | medium | M | **lift** — runtime command discovery |
| `openCodeProviderForModel` (L422) | constructor argument on `OpenCodeProviderAdapter` | low | S | **lift** |
| `openCodeModel` (L429) | constructor argument on `OpenCodeProviderAdapter` | low | S | **lift** |
| `openCodeProviderEnvKeys` (L440) | constructor argument | low | S | **lift** |
| `providerEnvKeysPresent` (L323) | `HermesProviderAdapter.diagnose()` + `OpenCodeProviderAdapter.diagnose()` shared helper | low | S | **lift** into shared base helper (kept in the .mjs, no duplication) |
| `deterministicOpenCodeResult` | moved into `OpenCodeProviderAdapter.startTask` deterministic branch | low | S | **lift** |
| `runOpenCodeCliDelegation` | moved into `OpenCodeProviderAdapter.startTask` cli branch | high | L | **lift** |
| `writeOpenCodeResultArtifact` | `BaseHarnessProvider.recordArtifact` | low | S | **thin** |
| `resolveOpenCodeWorkspacePath` | constructor argument / adapter field | medium | M | **lift** — workspace path is OpenCode-specific |
| `providerSecretCandidates` / `secretForProvider` / `providerEnvFromSecrets` / `providerCredential` | moved into `BaseHarnessProvider` shared helper (no provider branching) | low | S | **lift** into shared module — currently has provider env-key knowledge; the refactor should remove per-provider branches |

### Shared host glue (KEEP — no per-provider branching today)

| Symbol | Migration |
|---|---|
| `executeDelegationRecord` (L481) | **keep** — packet generation is provider-agnostic |
| `executeDelegationList` (L773) | **keep** — host lists, adapter resolves summary |
| `executeAddonDraftRecord` (L552) | **keep** — drafts are not provider lifecycle |
| `executeAddonDraftList` (L750) | **keep** |
| `executeAddonsStatus` (assumed top-level) | **keep** — aggregate status, calls into each adapter's `diagnose()` |
| `executeAddonExecutionSettingsGet/Update` (assumed) | **keep** — settings are host glue |
| `writeDelegationStatus` / `failDelegationAfterRunning` (L831/L843) | **keep** — host-side markdown status helpers |
| `delegationSummaryFromMarkdown` / `resultArtifactPathFromMarkdown` (L731/L710) | **keep** — host markdown readers |
| `resolveDelegationPath` / `resolveDraftPath` (L672/L681) | **keep** — path safety, no provider branching |
| `addonLocalCliExecutionEnabled` (L664) | **keep** — settings lookup; the per-provider branches in it (`addon === "hermes"` / `addon === "opencode"`) collapse to `provider: string` lookup via the adapter registry |
| `readAddonExecutionSettings` / `writeAddonExecutionSettings` / `appendAddonGovernanceAuditEntry` (L638/L648/L657) | **keep** — settings + audit |
| `clientReachableProxyUrl` / `clientReachableHost` / `clientReachableUrl` (L347/L363/L455) | **keep** — URL plumbing |
| `discoverBundledAddonManifests` / `modeForManifest` / `trustLabelFor` / `createAddOnSurfaceDockRoutes` / `createAddOnRailMenus` / `createRosHarnessMenu` / `createShellRailMenus` (L41–L244) | **keep** — manifest + UI surface glue |
| `redactCliText` / `redactPathForDiagnostics` (L329 + external) | **keep** — redaction utilities |
| `defaultAddonExecutionSettings` / `normalizeAddonExecutionSettings` (L618/L627) | **keep** — settings shape |

## Lowest-blast-radius provider to migrate first

**HermesProviderAdapter** — chosen because:

1. It has the **largest surface** (72 references, ~10 helpers), which means
   the migration pattern is established once and OpenCode follows.
2. Its `cancellationSemantics: "cancel"` (not `finish-atomic`) gives the
   adapter the most generic shape to validate against.
3. Its run path (`runHermesCliDelegation`) is the **most heavily tested**
   (`addon-delegation-service-error-handling.test.mjs` covers the
   credential-error-blocked recovery path).
4. OpenCode's `finish-atomic` semantics interact with the workspace lease
   (CP-5 row "OpenCode workspace lease enforcement"); deferring OpenCode
   until Phase 3 lets CP-5's workspace-lease work land first as a single
   commit if it surfaces.

## What this migration does NOT change

- `addon-delegation-host-service.mjs` (the 16 KB route registry) — already
  route-shaped, no provider branching inside.
- `addon-delegation-service.mjs`'s `addonDelegationRoutes` array — unchanged.
- The 7.4 KB sibling test (`addon-delegation-host-service.test.mjs`) — unchanged.
- The 27 KB sibling test (`addon-delegation-service-error-handling.test.mjs`)
  — must continue to pass; we extend with new parity tests rather than rewriting.
- `run-bridge-minimal.mjs` — unchanged.

## Risks

1. **Status/event ordering.** `BaseHarnessProvider` guarantees ordering
   through its `appendEvent` private method. The legacy service writes
   packet status directly to markdown; the new path must keep both in sync.
2. **`resumeBridge` ≠ `restartProvider`.** `BaseHarnessProvider` has no
   `resumeBridge` — that lives on the host service. Don't fold them.
3. **Per-provider `cancelTask` overrides.** Some providers override the
   cancel timeout. Preserve the override; do not silently move it to the
   generic default.
4. **Workspace lease interaction.** OpenCode's lease is enforced by the
   legacy service. Migration must keep the lease check or move it to the
   adapter (tracked separately under CP-5 "workspace lease enforcement").
5. **Hermes' dashboard side-effects.** `executeHermesDashboardStatus`/`Start`/`Stop`
   are NOT provider lifecycle — they stay as host glue. Do not accidentally
   fold them into the adapter.
6. **CLI result parsing.** Hermes' `parseHermesCliResult` detects unresolved
   provider tool-call markup and throws. That detection MUST stay — losing
   it would let a provider leak raw `<tool_call>` text into a result artifact.

## Out of scope

- CP-5 live transport migrations (Hermes CLI live key, OpenCode workspace
  lease, OpenClaw live key) — those gate Phase 4.
- Any change to `feat/tab-referencing` (REF workstream).
- Any change to `browser-first/release/**`.
