# ResonantOS Browser Architecture — Work Breakdown (multi-subagent build plan)

This document decomposes [ROADMAP.md](ROADMAP.md) into **work packages (WP)** sized
for independent subagents, grouped into **waves**. It states the cross-slice
contracts up front so parallel agents build against one interface and do not
negotiate interfaces mid-flight.

## Conventions

- One WP = one file cluster + its tests + its conformance examples. A WP is the
  smallest unit an agent owns end-to-end.
- **`∥`** marks WPs that may run concurrently. Anything not marked `∥` is
  serialized behind its dependency.
- **Integration owners** (one per wave) own the shared mutation boundary and merge
  slices; sibling agents coordinate through `hub` before touching a shared file.
- Contracts live in `src/sdk/<module>/` as versioned `import type`-only modules
  during CP-1; no runtime code is required until CP-2.
- No WP runs project-wide validation. Each agent runs only its own targeted tests;
  the wave's integrator runs `verify:alpha` once at the end.

## Shared contracts (state up front; every agent imports these)

The module layout from doc 12, expanded with ownership and the concrete schemas
from [CONTRACTS.md](CONTRACTS.md):

```text
src/sdk/
  identity/    Principal, PrincipalKind, DelegationRecord, DelegationChainRef
  authority/   ScopedCapability, AuthorityGrant, AuthorityRequest, ApprovalDecision
  tasks/       TaskPacket, TaskStatus, TaskEvent, HarnessResult, ArtifactRef
  augmentor/   AugmentorExtensionManifest, extension invocation/result
  harnesses/   HarnessProviderManifest, HarnessProviderAdapter, HarnessChildDescriptor
  resources/   ResourceBudget, ResourceReservation, UsageReport, ResourceLease
  continuity/  ContextEnvelope, ContinuitySnapshotRef, TrustDomain, ContinuityGatekeeperDecision, SkillVersionRef
  recovery/    GroundZeroState, GroundZeroTransition, QuarantineRecord
```

- **Naming contract:** each module exports a single `index.ts` barrel; every type is
  `export type`; no module imports another module's runtime (types only in CP-1).
- **Compatibility contract:** `CapabilityGrant` remains in `src/core/contracts.ts` as
  the UI/backward-compatible view; the richer grant lives in `authority/`. One
  projection function `toLegacyGrant()` is owned by the CP-1 integrator, not by any
  slice.
- **Envelope contract (CP-2):** `GovernedRequest<T>` per doc 12; the validator core
  owns `grantHandle` resolution + chain/time/scope/audience checks. Route slices call
  it; they do not re-implement it.
- **Adapter contract (CP-4):** `HarnessProviderAdapter` per doc 12. Provider
  migrations (CP-5) implement it; the conformance fake (CP-4) is the test oracle.

## Wave 0 — CP-0 vocabulary and ADR ratification

Serial. One integrator (Core architecture owner).

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-0a | `docs/architecture/README.md`, 5 new checkpoint ADRs | Ratify terminology; record amendments to ADR-006/018/026/010; close [DECISIONS.md](DECISIONS.md) D-1 | `validate-docs.mjs` passes; index links accepted decisions; no runtime change |

## Wave 1 — CP-1 contract modules (parallel after WP-0a)

Five type slices `∥`, one integrator after. No shared files.

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-1a | `src/sdk/identity/` | `Principal`, `PrincipalKind`, `DelegationRecord`, `DelegationChainRef` + serialization tests | Types + tests represent the full chain `user → Augmentor → Hermes → tool.git` |
| WP-1b | `src/sdk/authority/` | `ScopedCapability`, `AuthorityGrant`, `AuthorityRequest`, `ApprovalDecision`, temporal lifecycle + revocation | Doc 08 "required tests" pass (subset ok, superset denied, no sibling leak, cascade) |
| WP-1c | `src/sdk/tasks/` | `TaskPacket`, `TaskStatus`, `TaskEvent`, `HarnessResult`, `ArtifactRef` | Packet rejects raw credentials/unconstrained paths/full memory (doc 05 task-packet rules) |
| WP-1d | `src/sdk/continuity/` | `ContextEnvelope`, `ContinuitySnapshotRef`, `TrustDomain`, `ContinuityGatekeeperDecision`, `SkillVersionRef` + retention/redaction fields | Envelope carries provenance/sensitivity/freshness/purpose/retention (doc 09); gatekeeper models the effective-context intersection (doc 15) |
| WP-1e | `src/sdk/resources/` | `ResourceBudget`, `ResourceReservation`, `UsageReport`, `ResourceLease` (types only) | Budgets model priority/deadline/concurrency/ceilings (doc 11) |
| WP-1f | integrator | `toLegacyGrant()` projection; wire barrels into `src/sdk/index`; add migration + negative-validation tests | `user → Augmentor → Hermes → tool.git` compiles and is provably non-widening |

## Wave 2 — CP-2 bridge enforcement (envelope core serial, then routes ∥)

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-2a (serial) | `browser-first/host/governed-request.mjs` | `GovernedRequest<T>` envelope; grant-handle resolution; chain/audience/time/scope/approval validator; cascade revoke; audit event emission | Unit: forged identity, expired grant, audience mismatch, path escape all rejected |
| WP-2b ∥ | filesystem + archive routes | Wrap effects in WP-2a envelope | Route rejects mismatched task/root/principal |
| WP-2c ∥ | provider + model routes | Wrap effects in WP-2a envelope | Route rejects sibling token reuse |
| WP-2d ∥ | browser-control + external-account routes | Wrap effects in WP-2a envelope | Route rejects capability widening |
| WP-2e ∥ | redaction test harness | Extend `bridge-redact-audit.mjs` + add negative persistence tests | Tokens/handles provably absent from browser storage/artifacts/logs |
| WP-2f | integrator | Route-by-route compatibility telemetry; remove old paths only after telemetry parity | CP-2 exit gate integration suite green |

## Wave 3 — CP-3 ∥ CP-4 (parallel after CP-2)

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-3a | `src/sdk/augmentor/` | `AugmentorExtensionManifest` + discriminated `extensionClass` | Manifest validates for skill/tool/connector kinds |
| WP-3b | `src/sdk/augmentor/` + `src/modules/strategist` | Typed invocation/result; explicit context selection; no ambient authority | Extension runs under a task grant; Core authorizes every effect |
| WP-3c | Augmentor UI | Surface approval/escalation + delegation lineage | Lineage visible; approval attaches to exact request/scope |
| WP-4a | `src/sdk/harnesses/` | `HarnessProviderManifest` + `HarnessProviderAdapter` | Adapter matches [CONTRACTS.md](CONTRACTS.md) interface |
| WP-4b | `browser-first/host/` | Durable task/event/result protocol; reconnect; child namespace/sandbox reporting; escalation | Event ordering + replay survive restart |
| WP-4c | conformance fake | Fake provider passes lifecycle/cancel/confinement/replay/failure | CP-4 exit gate |

## Wave 4 — CP-5 reference-harness migrations (parallel after CP-4)

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-5a | `hermes-runtime.mjs` + `hermes.json` | Implement adapter; mark `extensionClass: harness-provider`; keep compatibility route | Hermes passes conformance |
| WP-5b | `opencode-runtime.mjs` + `opencode.json` | Implement adapter; workspace lease/isolation; coding result contract | OpenCode passes conformance |
| WP-5c | `openclaw.json` + new adapter | Implement structurally-different provider against same contract | Proves contract not vendor-specific |

## Wave 5 — CP-6 ∥ CP-7 ∥ CP-8 (parallel after CP-5)

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-6a | `src/sdk/resources/` + governor | Budgets, reservations, per-harness/global concurrency, leases | Roll-up + hard ceilings enforced |
| WP-6b | scheduler | Priority, queue, preemption, checkpoint, budget-exhaustion events; Ground-0 reserve | Deterministic cancellation + exhaustion |
| WP-6c | UI | Executor/budget/usage/status/stop controls | Visible live authority + stop |
| WP-7a | `src/sdk/continuity/` + bridge | Typed context envelopes enforced at dispatch | Harness receives only bounded context |
| WP-7b | snapshot service | Last-known-good continuity snapshot + ADR-016 event linking | Restart reconstruction without secret persistence |
| WP-7c | intake routing | Route returned knowledge through artifact review/intake | No direct trusted-memory write |
| WP-7d | `src/sdk/continuity/` + vault service | Identity & Continuity Vault (trust domains, versioned skills) + Continuity Gatekeeper enforcing effective-context | No actor reads identity/history/skills beyond policy+scope+trust |
| WP-8a | `src/sdk/recovery/` + vault | Ground-0 state machine + transition audit; reload minimal Augmentor kernel from the vault (identity + continuity checkpoint + core skills) | State transitions audited; Ground-0 wakes with identity + continuity |
| WP-8b | quarantine | Known-good manifest set + integrity check; revoke grants; quarantine optional runs | No pre-recovery authority survives exit |
| WP-8c | `src/modules/recovery/` | Drive ADR-010 ladder beneath Ground-0; manual/crash-loop/corrupt/rollback tests | CP-8 exit gate |

## Wave 6 — CP-9 stabilization (serial; one integrator)

| WP | Target | Change | Acceptance |
| --- | --- | --- | --- |
| WP-9a | SDK docs + versioning | Protocol versions, compatibility matrix, glossary, deprecation policy, manifest templates | Stable declaration justified by telemetry |
| WP-9b | conformance suite + threat model | Reusable conformance tests; threat model (confused deputy, token theft, path escape, event spoofing, memory poisoning, exhaustion, recovery persistence) | CP-9 exit gate |

## Integration and coordination

- **Fan-out limits:** Wave 1 max 5 concurrent; Wave 2 routes max 4; Wave 5 max 10
  (group by owner). Respect the session cap; excess queues.
- **Serialized mutation boundary per wave** is named in the table (WP-1f, WP-2f).
  Sibling WPs never edit the integrator's files.
- **Cross-slice handoff** uses `local://<module>-contract.md` artifacts: each WP-1x
  writes its barrel signature; downstream waves read the contract, never the
  implementation, until integration.
- **Validation discipline:** no agent runs `verify:alpha` or `validate-docs.mjs`
  mid-flight; each runs its own `node --test` targets. The integrator runs the full
  gate at wave close and records it in ROADMAP's gate evidence log.

## Suggested first dispatch

1. **WP-0a** (serial) — close CP-0; this unblocks everything.
2. On CP-0 close, dispatch **WP-1a..WP-1e** in one `tasks[]` batch with the shared
   naming/envelope contracts above; then **WP-1f**.
3. Repeat wave-by-wave, holding each wave's integrator until its slices settle.
