# ResonantOS Browser Architecture — Implementation Tracking

This is doc 14's master checklist, re-expressed as a **tracked status matrix**
against the current branch (`feat/dev-external-agent-runtimes-panel`, `a2fdb88`;
canonical repo HEAD `701ee36`). It is the single place that answers "what is done,
what is seeded, what is untouched."

## Status key

| Status | Meaning |
| --- | --- |
| `done` | Target behavior present and tested at the described contract level |
| `seeded` | A foundation exists (token/auth/audit/encoding) but is **not** the full target contract |
| `in-progress` | Under active change on the current branch |
| `not-started` | No work beyond pre-existing baseline |

Every `seeded` row names the existing artifact and the gap to the target, so work
 resumes from the artifact instead of re-deriving it.

## Future chat prompts

Prompts for new chat sessions live in `prompts/` at the repo root. They let a
fresh session resume work without re-deriving context.

- [`prompts/_template-continuation-prompt.md`](../../../prompts/_template-continuation-prompt.md) — fill-in skeleton (workstream / branch / state / acceptance / steps).
- [`prompts/cp4-generic-lifecycle-extraction.md`](../../../prompts/cp4-generic-lifecycle-extraction.md) — ready-to-run prompt for CP-4 generic lifecycle extraction.

## Phase 0 — Ratify scope and vocabulary (CP-0) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Adopt browser-first definition + Linux/true-OS exclusion | `done` | ADR-053 accepted (browser-first + Linux/true-OS exclusion) |
| Decide `primary-agent` vs `orchestrator` alias | `done` | Resolved — `primary-agent` permanently occupied by Augmentor (ADR-053); tracked in [DECISIONS.md](DECISIONS.md) (D-1) |
| Normalize public meanings (Core, platform service, add-on, extension, provider, Ground-0) | `done` | ADR-053 terminology table |
| Record which statements amend ADR-006/018/026/010 | `done` | ADR-053 Amends table records amendment targets; actual amendments execute in CP-3/CP-4 and CP-8 |
| Mark baseline vs proposed in every new ADR | `in-progress` | ADR-053 carries the metadata; 4 remaining checkpoint ADRs pending |
| Run repository documentation validation | `done` | `node scripts/validate-docs.mjs` passes |

## Phase 1 — Identity, task, and authority contracts (CP-1) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Versioned `Principal` / `PrincipalKind` | `done` | `src/sdk/identity/index.ts` exports `Principal`, `PrincipalKind`, `DelegationRecord`, `DelegationChainRef` |
| Delegation records with parent lineage + audit correlation | `done` | `DelegationRecord` carries `root/parent/childPrincipalId` + `revokedAt`; `DelegationChainRef` models the chain |
| Structured capability/resource scopes | `done` | `src/sdk/authority/index.ts` `ScopedCapability` (action, `resourceSelectors`, `operations`, `limits`, time window) |
| Task-bound temporal authority lifecycle + revocation | `done` | `ScopedCapability` `notBefore`/`expiresAt`/`idleTimeoutMs` + `RevocationBehaviorKind`; `AuthorityGrant.status` lifecycle (runtime cascade is CP-2) |
| Context envelope, task packet, event, result, artifact types | `done` | `src/sdk/tasks/index.ts` (`TaskPacket`, `TaskStatus`, `TaskEvent`, `HarnessResult`, `ArtifactRef`), `src/sdk/continuity/index.ts` (`ContextEnvelope`) |
| Vault trust-domain + gatekeeper + skill-version types (`TrustDomain`, `ContinuityGatekeeperDecision`, `SkillVersionRef`) | `done` | `src/sdk/continuity/index.ts` (doc 15) |
| Compatibility projection to `CapabilityGrant` | `done` | `toLegacyGrant()` in `src/sdk/authority/index.ts` |
| Serialization, migration, negative-validation tests | `done` | JSON round-trip (`tasks.test.ts`), superset-denial + projection (`authority.test.ts`); 11 tests pass |

## Phase 2 — Enforce authority at the bridge (CP-2) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Opaque host-resolved grant handles | `done` | `bridge-governed-authority.mjs` `mintGrant()` issues a 24-byte random `grantHandle`; resolved in-memory, never self-contained |
| Governed request envelope on a pilot route | `done` | `dispatchGovernedExternalAgentRuntime()` + `/external-agent-runtime/governed-delegate` route; integration test (4 cases) proves deny-before-effect |
| Validate task/principal/chain/audience/time/scope/approval at effect | `done` | task/delegation/subject/audience/time/scope + full principal-chain lineage walk (`recordDelegation` + `validateDelegationChain`) + `approvalCondition` terms |
| Cascade revoke/expire on cancellation + parent revocation | `done` | `revokeTask()` + `revokeDescendants()` (BFS over principal lineage) + time-based expiry in `validateGovernedRequest()` |
| Append-only audit events (request/decision/effect/denial/cancel) | `done` | `bridge-governed-authority.mjs` emits `request`/`decision`/`effect`/`denial`/`cancel` to the ledger sink |
| Prove tokens/handles never enter browser persistence/artifacts/logs | `done` | module never emits handle/token (test); `bridge-redact-audit.mjs` routes `grantHandle`/`token` through the redactor |
| Expand route-by-route with compatibility telemetry | `done` | `route-enforcement-telemetry.mjs` (`classifyRouteEnforcement`/`collectRouteEnforcementTelemetry`) reports governed vs legacy vs ungated + a `migrationComplete` flag; the two pilot routes are `enforcement: "governed"`; launcher emits the baseline in the `governed_runtime_ready` boot log; 4 tests + a drill |

## Phase 3 — Augmentor orchestration and extensions (CP-3) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Sever `addon.augmentor-chat` slots (D-9): drop `primary-agent`, keep `chat-interface` | `done` | `public/addons/augmentor-chat.json` provides only `chat-interface`; `validation.ts` rejects `primary-agent` claims (`system-slot-reserved`) |
| Reconcile `addon.augmentor-chat` agents + agent-delegation | `done` | removed `agents` array (`augmentor.agent`, addon trust tier, `workspaceBehavior: primary`) and the dead `agent-delegation` capability; neither was consumed (no `delegation` contract) |
| Orchestration lifecycle + non-authority rule | `done` | `AUGMENTOR_NON_AUTHORITY_RULE`, `AugmentorExtensionLifecycle`, `effectiveCapabilities()` (type-level; host enforcement lands with CP-2 route expansion) |
| `AugmentorExtensionManifest` discriminated class + strict-combo validation | `done` | `src/sdk/augmentor/index.ts` types + `AddOnManifest.extensionClass`/`augmentorExtension`; `validation.ts` enforces combos (rejects `harness-provider` until CP-4, missing/mismatched declaration); 7 tests |
| Map existing `augmentorSkills` without new permissions | `done` | `toAugmentorExtension()` re-expresses `AddOnAugmentorSkill` → kind `skill`, carrying `requiredCapabilities` verbatim |
| Typed invocation/result + explicit context selection | `done` | `AugmentorExtensionInvocation`, `AugmentorExtensionResult`, `AugmentorContextSelection` (references only, never raw context) |
| Governed extension invocation at the effect boundary | `done` | `augmentor-extension-dispatcher.mjs` (`dispatchGovernedAugmentorExtension`) + `POST /augmentor/extension/invoke`; 6 tests prove task-grant admission + `capability-not-granted`/forged/expired denial + per-effect authorization |
| Approval/escalation + lineage in Augmentor UI | `done` | `augmentor-approval-lineage.ts` pure selectors (`flattenDelegationChain`, `buildLineageSteps`, `pendingApprovalItems`, `escalateInvocation`) + `StrategistWorkspace` "Lineage &amp; Approval" panel; 6 selector tests + 1 render test |
| Conformance examples (skill, tool, connector) | `done` | all three (`examples/addons/addon.augmentor-{skill,tool,connector}-example.json`) + `augmentor-extension-conformance.test.ts` (7 tests) |

## Phase 4 — Harness Provider API (CP-4) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| `HarnessProviderManifest` + adapter interface | `done` | `src/sdk/harnesses/index.ts` exports `HarnessProviderManifest`, `HarnessProviderAdapter`, `HarnessHealth`/`HarnessRun`/`HarnessRunState`, `HarnessChildDescriptor`, `GrantHandle`; `AddOnManifest.harnessProvider` field added |
| Conformance fake provider + exit-gate tests | `done` | `fake-harness-provider.ts` (`FakeHarnessProvider`) + 5 tests: lifecycle, cancellation, artifact confinement, event replay, failure — the CP-4 exit gate |
| Extract generic start/status/events/cancel/artifact | `done` | Phase 1 doc [`CP4-LIFECYCLE-EXTRACTION-MIGRATION.md`](CP4-LIFECYCLE-EXTRACTION-MIGRATION.md) + Phase 2 [`hermes-provider-adapter.ts`](../../../src/sdk/harnesses/hermes-provider-adapter.ts) (17 parity tests) + Phase 3 [`opencode-provider-adapter.ts`](../../../src/sdk/harnesses/opencode-provider-adapter.ts) (18 parity tests, `finish-atomic` cancel, workspace-root enforcement, JSON-stream CLI parsing) + [`openclaw-provider-adapter.ts`](../../../src/sdk/harnesses/openclaw-provider-adapter.ts) (11 parity tests, `quarantine` cancel + forensic-survival, gateway child enumeration) + [`agentzero-provider-adapter.ts`](../../../src/sdk/harnesses/agentzero-provider-adapter.ts) (10 parity tests, `can…
| Preserve Hermes/OpenCode compatibility routes | `done` | Phase 4 cutover — [`CP4-PHASE4-CUTOVER-CONTINUATION.md`](CP4-PHASE4-CUTOVER-CONTINUATION.md) + bridge seam [`addon-delegation-adapter-bridge.mjs`](../../../browser-first/host/addon-delegation-adapter-bridge.mjs) (1036 lines, canonical author of Hermes + OpenCode lifecycles) + `addon-delegation-service.mjs` reduced to 1660 lines; 4 new seam parity tests + 1197/1197 pre-existing extension tests still pass; the legacy `executeXDelegationStart/Status/Artifact/Cancel` public surface is preserved byte-identical via bridge delegation |
| Durable status/event ordering + reconnect | `not-started` | — |
| Child namespace/sandbox reporting + escalation | `not-started` | — |
| Artifact provenance/evidence/verification/residual-risk | `seeded` | `ArtifactReturn`, `DelegationVerificationRequirement` exist; not the full result contract |
| Bounded context + no secret/full-memory forwarding | `seeded` | `ContextMemoryState`/compaction exist; no `ContextEnvelope` enforcement at dispatch |

## Phase 5 — Migrate reference harnesses (CP-5) — *in-progress*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Shared conformance suite + seven reference adapters | `done` | `conformance.ts` (`runHarnessProviderConformance`) + `BaseHarnessProvider` + `Fake/Hermes/OpenCode/OpenClaw/AgentZero/DeepSeekHarness/Pi/Aider` adapters; 5 gate checks × 8 providers pass — seven shapes use one contract, no vendor-specific authority exception |
| Bridge-side adapters wire real diagnose + governed dispatch | `done` | `harness-provider-adapters.mjs`: 7 factories (`create{Hermes,OpenCode,OpenClaw,AgentZero,DeepSeekHarness,Pi,Aider}ProviderAdapter`); `governedRuntimeDispatch` builds a `GovernedRequest` from `(TaskPacket, grantHandle)` and defers authority to `dispatchGovernedExternalAgentRuntime` (no per-caller path); 10 tests incl. forged-subject denial + fail-closed without authority |
| Bundle six harness-provider manifests | `done` | `public/addons/{openclaw,opencode,agentzero,deepseek-harness,pi,aider}.json` declare `extensionClass: "harness-provider"` + `harnessProvider`; OpenClaw/OpenCode migrated in place, 4 new; `index.json` registers all six; D-10 |
| Migrate Hermes to generic adapter | `in-progress` | real diagnose + dispatch wired; end-to-end (live CLI + Cordis) and `addon-delegation-service.mjs` lifecycle dedup pending — see Phase 5 continuation prompt [`CP5-PHASE5-CONTINUATION.md`](CP5-PHASE5-CONTINUATION.md) |
| Migrate OpenCode + workspace lease/isolation | `in-progress` | `opencodeRuntimeDispatch` validates the governed envelope then drives a real `opencode serve` session (`ensureOpencodeServer` + `createOpencodeHttpClient`) — structurally distinct from Cordis; workspace lease enforcement + dedup pending |
| Validate OpenClaw against the contract | `in-progress` | runtime-gateway shape passes shared conformance; real gateway transport pending |
| Keep installs/config intact; approval-gate install | `not-started` | — |
| Assistant-only output filtering + deterministic smoke tests | `done` | `filterHarnessOutput` (parity seam, `src/sdk/harnesses/output-filtering.ts`) maps `assistant-reply-only`/`structured-events`/`raw-log` over `HarnessOutputRecord`s; 4 deterministic tests incl. `expectedOutputPattern` vs filtered output |
| Archive reads scoped/cited; writes intake-only | `in-progress` | `archive-promotion-guards.mjs` etc. present; per-harness parity pending |
| Remove duplicated provider lifecycle logic after parity | `done` | Phase 4 cutover — [`browser-first/host/addon-delegation-adapter-bridge.mjs`](../../../browser-first/host/addon-delegation-adapter-bridge.mjs) is the canonical author of the Hermes + OpenCode lifecycles; `addon-delegation-service.mjs` no longer inlines credential gating, CLI invocation, env scoping, or result parsing for either provider (only host-side glue: markdown status writes, artifact I/O, route dispatch) |

## Phase 6 — Multi-harness concurrency + resource governor (CP-6) — *in-progress*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Per-task resource budgets/reservations | `done` | `src/sdk/resources/index.ts`: structured `ResourceUsage` + tightened `ResourceBudget` (`estimated`/`hardCeiling`), `ResourceReservation` (`amount: number`) |
| Global/per-harness concurrency + fair scheduling | `done` | `admissionDecision` (admit/queue/reject) + `FairShareAccount` / `fairShareDeficit` / `fairShareRank` (under-share principals schedule before over-share; zero allocation ranks last) |
| Workspace/browser/GPU/provider-route/external-account leases | `done` | `LeaseKind` + `ResourceLease.resourceId` + `leaseConflicts` (same kind + resource + one exclusive) + `leaseActive` (expiry) |
| Child usage rolls up into parent budget + hard ceilings | `done` | `rollUpChildUsage` + `remainingBudget` + `isBudgetExhausted` — deterministic roll-up with exceeded-dimension reporting |
| Priority/queue/preemption/checkpoint/budget-exhaustion events | `done` | `GovernorEvent` (admitted/queued/rejected/preempted/checkpointed/budget-exhausted) + `admissionEvent` overloads (admit/queue/reject → typed event) |
| Reserve capacity for interactive Augmentor + Ground-0 | `done` | `ReservedCapacity` (`interactive-augmentor` | `ground-zero`) + `optionalWorkHeadroom` (remaining headroom minus the reserved amount; fully-reserved dimensions omitted) |
| Integrate with ADR-032 compute jobs (no duplication) | `seeded` | ADR-032 + `src/core/compute-fabric.ts` types exist; deferred, per doc 13 |
| UI: executor/budget/usage/status/stop | `not-started` | — |

## Phase 7 — Trusted continuity and context exchange (CP-7) — *in-progress*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Typed context envelopes (provenance/sensitivity/freshness/purpose/retention) | `done` | `src/sdk/continuity/index.ts` `ContextEnvelope`/`ContextFact` (now domain-labeled) |
| Link task/delegation events into ADR-016 compact state | `done` | `ContextDelegationRef` (core/contracts.ts) + `delegationRefs?: ContextDelegationRef[]` on `ContextMemoryState`; `buildDeterministicCompactState`/`compactThreadContext` accept `readonly ContextDelegationRef[]`, plumbed into the `context-compacted` transcript event payload; `copyCompactStatesForFork` carries refs across forks; `formatCompactStateForPrompt` renders `harness:task@completedAt`; 7 tests in `context-memory.test.ts` |
| Last-known-good continuity snapshot | `done` | `ContinuitySnapshot` + `reconstructLastKnownGood` (integrity-verified, most-recent-good) |
| Separate harness checkpoints from trusted continuity | `not-started` | — |
| Route returned knowledge through artifact review/intake | `in-progress` | Living Archive intake boundaries + `archive-review-service.mjs` present |
| Redaction/export/retention/deletion tests | `done` | `exportContinuity` (redacted portable envelope), `applyRetentionPolicy` (`recordedAt` window), `deleteFacts` (audit-preserving deletion) + 3 tests in `continuity.test.ts` |
| Provider-switch/restart reconstruction without secret persistence | `done` | `reconstructTask` rebuilds task + last harness from delegation history (audit summaries, never credentials) |
| Identity & Continuity Vault + Continuity Gatekeeper | `done` | `mediateContextRead` (effective-context intersection) + `reloadGroundZeroKernel` (core skills only); Core-owned, doc 15 |

## Phase 8 — Ground-0 state (CP-8) — *done*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Core-owned Ground-0 state machine + transition audit | `done` | `src/sdk/recovery/index.ts` `GroundZeroSnapshot`/`GroundZeroTransition` + `enterGroundZero`/`reEnableFromGroundZero`; bridge plain-JS mirror `browser-first/host/ground-zero.mjs`; `src/modules/recovery` becomes a consumer |
| Known-good manifest/config set + integrity check | `done` | `KnownGoodSet` + `serializeKnownGoodSet`/`verifyKnownGoodSet` (SDK `src/sdk/recovery`) + bridge mirror `createKnownGoodSet`/`verifyKnownGoodSet` (SHA-256); the service verifies the frozen fused-core baseline (`ROS_FUSED_CORE` sections + integrated harness) on entry and fails closed on tamper |
| On entry: revoke temporal grants + quarantine optional runs | `done` | `enterGroundZero` revokes all grants + quarantines optional items (no pre-recovery authority survives); tested |
| Disable harnesses/extensions/hooks/scripts/channels/background/ingest | `done` | bridge-side `ground-zero-service.mjs` revokes every active grant + marks the surface disabled (7 harness adapters + extension effect + archive ingest); hooks/scripts/channels/background-jobs have no runtime component yet (modeled as `QuarantineKind`, disabled at the authority level) |
| Preserve identity/audit/history/continuity/recovery-hints read-only | `done` | entry is non-destructive: identity/continuity live in the vault, audit in the append-only ledger (revocation appends `cancel` events); the recovery snapshot is exposed read-only via `GET /ground-zero/status` |
| Ground-0 vault-reload (identity + continuity checkpoint + core skills → minimal Augmentor kernel) | `done` | `reloadGroundZeroKernel` (CP-7, `src/sdk/continuity`) — core-skill tier only |
| Connect Engineer recovery ladder beneath Ground-0 | `done` | `driveRecoveryLadder(state, ladder, at)` (SDK `src/sdk/recovery` + bridge mirror) — the ADR-010 ladder activates/resets to phase 1 on Ground-0 entry and hands off (report complete) on exit; `lastNormalThreadId` preserved; idempotent |
| Re-enable in dependency order + health checks + fresh grants | `done` | `reEnableFromGroundZero` — ordered, health-checked, fresh grants (never old); the exit `healthCheck` is now the real `createHarnessHealthCheck` (async `adapter.diagnose()` → `status === "ok"`), not a constant-true stub |
| Manual/crash-loop/corrupt-state/interrupted-recovery/rollback tests | `done` | `browser-first/test/ground-zero.test.mjs` (9 tests) + `ground-zero-service.test.mjs` (6 tests) + drills (6 checks) exercise the machine and the runtime consumer; async health-check resolution tested via `createHarnessHealthCheck` (ok/degraded/unavailable/throw/missing) |

## Phase 9 — SDK stabilization and release readiness (CP-9) — *in-progress*

| Item | Status | Evidence / gap |
| --- | --- | --- |
| Protocol versions, compatibility matrix, capability glossary, deprecation policy | `done` | `src/sdk/versioning.ts` (caret-semver, per-protocol matrix) + `src/sdk/glossary.ts` (13-capability glossary + deprecation map); 8 tests |
| Manifest templates for all three extension classes | `done` | `src/sdk/templates.ts` (`createAugmentorExtensionTemplate` / `createHarnessProviderTemplate` / `createSystemAddonTemplate`) |
| Conformance suite + reference adapters | `done` | CP-4 `runHarnessProviderConformance` + CP-5 `FakeHarnessProvider` + `Hermes/OpenCode/OpenClaw` adapters |
| Threat model (confused deputy, token theft, path escape, event spoofing, memory poisoning, resource exhaustion, recovery persistence) | `done` | `THREAT_MODEL.md` maps all 7 threats to the governed envelope/opaque handle/path-check/gatekeeper/budget/Ground-0 mechanisms |
| Security pipeline + browser-first tests + docs checks + pre-release scan | `done` | `verify.yml` now gates: type-check + SDK vitest + `test:browser-first` (1192) + drills + `validate-docs` + security-pipeline `--certify` + `pre-release:scan`; `repo:hygiene` + `test:docs` (228) green; `/tool` `/addon` command reference restored |
| Document known limitations + deferred Compute Fabric | `done` | `THREAT_MODEL.md` §Known limitations (live transport, ADR-032 node execution, recovery drills, slot hardening) |
| Declare stable after migration telemetry + recovery drills | `not-started` | — |

## Cleanup items found during review (out of doc 14, still required)

These are stale-citation / hygiene issues surfaced while mapping the current branch;
track them so they do not re-enter via the package docs.

| Item | Evidence | Action |
| --- | --- | --- |
| Stale ADR citations in dispatcher | `external-agent-runtime-dispatcher.mjs` cites `ADR-040-provider-fabric-boundary-external-agent-runtimes.md` and `ADR-038-ref-extension-framework.md`; neither exists (ADR-038 is `addon-runtime-identity.md`) | Re-point to real ADRs during CP-4 extraction |
| ADR numbering gaps | No ADR-040, ADR-044..049 in `docs/architecture/` | Confirm superseded/renamed before CP-0 ADR ratification |
| Doc 13 baseline drift | Doc 13 written against `dev` mirror `80dcd79`; current branch is ahead (see ROADMAP baseline correction) | Re-verify cited paths at CP-0; do not treat doc 13 as the live crosswalk |
