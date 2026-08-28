# ResonantOS Browser Architecture — Checkpoint Specification

One section per checkpoint. Each states: **entry criteria** (what must be true to
start), **owner** (suggested single accountable owner), **work items** (from doc 14,
see [IMPLEMENTATION_TRACKING.md](IMPLEMENTATION_TRACKING.md) for per-item status),
**exit gate** (falsifiable), and **parallelization** (what may build alongside).

## CP-0 — Ratify scope and vocabulary

- **Entry:** none; this is the first checkpoint.
- **Owner:** Core architecture (ADR authority).
- **Work items (doc 14 Phase 0):**
  - Adopt the browser-first definition and explicit Linux/true-OS exclusion.
  - Ratify `primary-agent` as permanently occupied by Augmentor (no `orchestrator` alias).
  - Normalize public meanings of Core, platform service, add-on, Augmentor extension, harness provider, Ground-0.
  - Record which statements amend ADR-006, ADR-018, ADR-026, ADR-010.
  - Mark current baseline vs proposed/future requirements in every new ADR.
  - Run `node scripts/validate-docs.mjs`.
- **Exit gate:** the architecture index links the accepted decisions; no runtime
  change is implied by terminology alone. The `orchestrator`-vs-`primary-agent`
  decision is recorded in [DECISIONS.md](DECISIONS.md) and ratified in the CP-0 ADR.
- **Parallelization:** serial. Vocabulary is a shared prerequisite for every later
  contract. One owner, no fan-out.

## CP-1 — Identity, task, and authority contracts

- **Entry:** CP-0 closed (vocabulary ratified).
- **Owner:** SDK contracts lead (add-on SDK owner).
- **Work items (doc 14 Phase 1):** versioned `Principal`/`PrincipalKind`;
  `DelegationRecord` with lineage + audit correlation; structured capability/resource
  scopes; task-bound temporal authority lifecycle + revocation; context envelope, task
  packet, event, result, artifact reference types; vault trust-domain, gatekeeper, and skill-version types (doc 15); compatibility projection to
  `CapabilityGrant`; serialization/migration/negative-validation tests.
- **Exit gate:** contracts represent `user → Augmentor → Hermes → tool.git` and a
  unit test proves the child cannot request a superset (see doc 08 required tests).
- **Parallelization:** type modules (`identity/`, `authority/`, `tasks/`,
  `continuity/`, `resources/`) are independent slices; see
  [WORK_BREAKDOWN.md](WORK_BREAKDOWN.md).

## CP-2 — Enforce authority at the bridge

- **Entry:** CP-1 closed (types land).
- **Owner:** Bridge/runtime lead (`browser-first/host/`).
- **Work items (doc 14 Phase 2):** opaque host-resolved grant handles; governed
  request envelope on a pilot route; validate task/principal/chain/audience/time/
  resource-scope/approval at the effect boundary; cascade revoke/expire; append-only
  audit events; prove tokens/handles never enter browser persistence/artifacts/logs;
  expand route-by-route with compatibility telemetry before removing old paths.
- **Exit gate:** integration tests reject forged identity, expired grants, sibling
  reuse, path escape, and capability widening.
- **Parallelization:** the envelope + validator core is a **single** mutation
  boundary (one owner). Route-family expansion (filesystem, archive, provider,
  browser) fans out after it. See [WORK_BREAKDOWN.md](WORK_BREAKDOWN.md).

## CP-3 — Augmentor orchestration and extensions

- **Entry:** CP-2 closed (authority floor enforced).
- **Owner:** Augmentor/orchestration lead (`src/sdk/augmentor/`, `src/modules/strategist`).
- **Work items (doc 14 Phase 3):** orchestration lifecycle + non-authority rule;
  `AugmentorExtensionManifest` discriminated class; map existing `augmentorSkills`
  without new permissions; typed invocation/result + explicit context selection;
  approval/escalation + lineage in Augmentor UI; conformance examples (skill, tool,
  connector).
- **Exit gate:** Augmentor invokes a focused extension under a task grant; Core
  independently authorizes every effect.
- **Parallelization:** runs ∥ CP-4 once CP-2 closes.

## CP-4 — Harness Provider API

- **Entry:** CP-2 closed.
- **Owner:** Harness/adapter lead (`browser-first/host/`).
- **Work items (doc 14 Phase 4):** `HarnessProviderManifest` + adapter interface;
  extract generic start/status/events/cancel/artifact from provider-specific code;
  preserve Hermes/OpenCode compatibility routes; durable status/event ordering +
  reconnect; child namespace/sandbox reporting + escalation; artifact provenance/
  evidence/verification/residual-risk; bounded context + no secret/full-memory
  forwarding.
- **Exit gate:** a fake conformance provider passes lifecycle, cancellation,
  artifact confinement, event replay, and failure tests.
- **Parallelization:** runs ∥ CP-3 once CP-2 closes. Reuses the CP-1 `tasks/` types
  and the CP-2 envelope.

## CP-5 — Migrate reference harnesses

- **Entry:** CP-4 closed (adapter + conformance fake).
- **Owner:** Provider integration leads (Hermes, OpenCode, OpenClaw).
- **Work items (doc 14 Phase 5):** migrate Hermes to the generic adapter; migrate
  OpenCode with workspace lease/isolation; validate OpenClaw (structurally different)
  against the same contract; keep installs/config intact and approval-gate install;
  verify assistant-only output filtering + deterministic smoke tests; verify archive
  reads scoped/cited, writes intake-only; remove duplicated provider lifecycle logic
  only after parity tests pass.
- **Exit gate:** at least three provider shapes use the contract with no
  vendor-specific authority exceptions.
- **Parallelization:** three provider migrations are independent slices against the
  CP-4 adapter; see [WORK_BREAKDOWN.md](WORK_BREAKDOWN.md).

## CP-6 — Multi-harness concurrency and resource governor

- **Entry:** CP-5 closed (multiple providers share the adapter).
- **Owner:** Resource governor lead (`src/sdk/resources/`, compute fabric).
- **Work items (doc 14 Phase 6):** per-task budgets/reservations; global/per-harness
  concurrency limits + fair scheduling; workspace/browser/GPU/provider-route/
  external-account leases; child usage rolls into parent budget with hard ceilings;
  priority/queue/preemption/checkpoint/budget-exhaustion events; reserve capacity for
  interactive Augmentor + Ground-0; integrate with ADR-032 compute jobs without
  duplicating execution; UI shows executor/budget/usage/status/stop.
- **Exit gate:** Hermes and OpenCode run concurrently without workspace/grant leakage;
  cancellation and budget exhaustion are deterministic.
- **Parallelization:** runs ∥ CP-7, CP-8 after CP-5.

## CP-7 — Trusted continuity and context exchange

- **Entry:** CP-5 closed.
- **Owner:** Memory/continuity lead (`src/core/context-memory`, ADR-016).
- **Work items (doc 14 Phase 7):** typed context envelopes (provenance, sensitivity,
  freshness, purpose, retention); link task/delegation events into ADR-016 compact
  state; last-known-good continuity snapshot; separate harness checkpoints from
  trusted continuity; Core-owned Identity & Continuity Vault (trust domains, versioned skills) + Continuity Gatekeeper enforcing effective-context (doc 15); route returned knowledge through artifact review/intake;
  redaction/export/retention/deletion tests; provider-switch + restart reconstruction
  without raw secret/capability persistence.
- **Exit gate:** Augmentor resumes and explains a delegated task after restart using
  trusted host state; the harness receives only its bounded context.
- **Parallelization:** runs ∥ CP-6, CP-8 after CP-5.

## CP-8 — Ground-0 state

- **Entry:** CP-5 closed (runtimes exist to disable/quarantine).
- **Owner:** Recovery lead (`src/modules/recovery`, `src/sdk/recovery/`).
- **Work items (doc 14 Phase 8):** Core-owned Ground-0 state machine + transition
  audit; known-good manifest/config set with integrity check; on entry revoke active
  temporal grants + stop/quarantine optional runs; disable harnesses/extensions/
  hooks/scripts/channels/background jobs/archive ingest; preserve identity/audit/
  history/continuity snapshot/recovery hints read-only; reload Ground-0 from the vault (user identity + Augmentor identity + continuity checkpoint + approved core skills → minimal Augmentor kernel); connect the Engineer recovery
  ladder beneath Ground-0; re-enable in dependency order with health checks + fresh
  grants; manual-entry/crash-loop/corrupt-state/interrupted-recovery/rollback tests.
- **Exit gate:** recovery succeeds with every optional add-on disabled; no
  pre-recovery executable authority survives exit.
- **Parallelization:** runs ∥ CP-6, CP-7 after CP-5. Builds on the ADR-051 fused-core
  encoding already present.

## CP-9 — SDK stabilization and release readiness

- **Entry:** CP-6, CP-7, CP-8 all closed.
- **Owner:** SDK/release lead.
- **Work items (doc 14 Phase 9):** protocol versions, compatibility matrix, capability
  glossary, deprecation policy; manifest templates for all three extension classes;
  conformance suite + reference adapters; threat-model confused deputy, token theft,
  path escape, event spoofing, memory poisoning, resource exhaustion, recovery
  persistence; complete security pipeline + browser-first tests + docs checks +
  pre-release scan; document known limitations + deferred Compute Fabric features;
  declare stable only after migration telemetry + recovery drills pass.
- **Exit gate:** SDK documented, versioned, enforced at privileged effects, validated
  across multiple harnesses, and recoverable through Ground-0.

## Dependency summary table

| CP | Depends on | Parallel with |
| --- | --- | --- |
| CP-0 | — | — |
| CP-1 | CP-0 | — |
| CP-2 | CP-1 | — |
| CP-3 | CP-2 | CP-4 |
| CP-4 | CP-2 | CP-3 |
| CP-5 | CP-4 | — |
| CP-6 | CP-5 | CP-7, CP-8 |
| CP-7 | CP-5 | CP-6, CP-8 |
| CP-8 | CP-5 | CP-6, CP-7 |
| CP-9 | CP-6, CP-7, CP-8 | — |
