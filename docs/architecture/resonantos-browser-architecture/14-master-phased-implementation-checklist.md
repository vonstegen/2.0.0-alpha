# 14 — Master Phased Implementation Checklist

This checklist is ordered to preserve the current working system. Each phase has an exit gate; do not make later behavior normative before the gate passes.

## Phase 0 — Ratify scope and vocabulary

- [ ] Adopt the browser-first definition and explicit Linux/true-OS exclusion.
- [ ] Decide whether `primary-agent` is the orchestration slot or add a compatible `orchestrator` alias.
- [ ] Normalize public meanings of Core, platform service, add-on, Augmentor extension, harness provider, and Ground-0.
- [ ] Record which statements amend ADR-006, ADR-018, ADR-026, and ADR-010.
- [ ] Mark current baseline versus proposed/future requirements in every new ADR.
- [ ] Run repository documentation validation.

**Exit gate:** architecture index links the accepted decisions; no runtime change is implied by terminology alone.

## Phase 1 — Add identity, task, and authority contracts

- [ ] Add versioned `Principal` and principal-kind types.
- [ ] Add delegation records with parent lineage and audit correlation.
- [ ] Add structured capability/resource scopes.
- [ ] Add task-bound, temporal authority lifecycle and revocation semantics.
- [ ] Add context envelope, task packet, event, result, and artifact reference types.
- [ ] Preserve a compatibility projection to existing `CapabilityGrant` and delegation UI types.
- [ ] Add serialization, migration, and negative validation tests.

**Exit gate:** contracts can represent `user → Augmentor → Hermes → tool.git` and prove that the child cannot request a superset.

## Phase 2 — Enforce authority at the bridge

- [ ] Introduce opaque host-resolved grant handles.
- [ ] Add governed request envelopes to a small pilot route.
- [ ] Validate task, principal, delegation chain, audience, time, resource scope, and approval at the effect boundary.
- [ ] Cascade revoke/expire on task cancellation and parent revocation.
- [ ] Emit append-only audit events for request, decision, effect, denial, and cancellation.
- [ ] Prove tokens/handles do not enter browser persistence, artifacts, or logs.
- [ ] Expand enforcement route-by-route with compatibility telemetry before removing old paths.

**Exit gate:** integration tests reject forged identity, expired grants, sibling reuse, path escape, and capability widening.

## Phase 3 — Formalize Augmentor orchestration and extensions

- [ ] Publish the Augmentor orchestration lifecycle and non-authority rule.
- [ ] Add `AugmentorExtensionManifest` as a discriminated extension class.
- [ ] Map existing `augmentorSkills` without granting new permissions.
- [ ] Implement typed invocation/result and explicit context selection.
- [ ] Surface approval/escalation and delegation lineage in Augmentor UI.
- [ ] Add conformance examples for one skill, one tool, and one connector extension.

**Exit gate:** Augmentor can invoke a focused extension using a task grant and Core independently authorizes every effect.

## Phase 4 — Extract the Harness Provider API

- [ ] Add `HarnessProviderManifest` and adapter interface.
- [ ] Extract generic start/status/events/cancel/artifact behavior from provider-specific delegation code.
- [ ] Preserve Hermes/OpenCode compatibility routes during migration.
- [ ] Define durable status/event ordering and reconnect behavior.
- [ ] Define child namespace/sandbox reporting and escalation requests.
- [ ] Add artifact provenance, evidence, verification, and residual-risk fields.
- [ ] Require bounded context and prohibit secret/full-memory forwarding.

**Exit gate:** a fake conformance provider passes lifecycle, cancellation, artifact confinement, event replay, and failure tests.

## Phase 5 — Migrate reference harnesses

- [ ] Migrate Hermes to the generic adapter and manifest class.
- [ ] Migrate OpenCode and enforce workspace lease/isolation semantics.
- [ ] Validate OpenClaw or another structurally different harness against the same contract.
- [ ] Keep existing installs/configuration intact and approval-gate installation.
- [x] Verify assistant-only output filtering and deterministic smoke tests.
- [ ] Verify archive reads are scoped/cited and writes remain intake-only.
- [ ] Remove duplicated provider-specific lifecycle logic only after parity tests pass.

**Exit gate:** at least three provider shapes use the contract without vendor-specific authority exceptions.

## Phase 6 — Multi-harness concurrency and resource governor

- [ ] Add per-task resource budgets and reservations.
- [ ] Add global/per-harness concurrency limits and fair scheduling.
- [ ] Add workspace, browser-session, GPU, provider-route, and external-account leases.
- [ ] Roll child usage into parent budget and enforce hard ceilings.
- [ ] Add priority, queue, preemption, checkpoint, and budget-exhaustion events.
- [ ] Reserve capacity for interactive Augmentor and Ground-0.
- [ ] Integrate with ADR-032 Compute Jobs where applicable; do not duplicate execution.
- [ ] Show executor, budget, usage, status, and stop controls in the UI.

**Exit gate:** Hermes and OpenCode can run concurrently without workspace/grant leakage; cancellation and budget exhaustion are deterministic.

## Phase 7 — Trusted continuity and context exchange

- [ ] Implement typed context envelopes with provenance, sensitivity, freshness, purpose, and retention.
- [ ] Link task/delegation events into ADR-016 compact state.
- [ ] Implement a last-known-good continuity snapshot.
- [ ] Separate harness checkpoints from trusted continuity.
- [ ] Route all returned knowledge through artifact review/intake.
- [x] Add redaction, export, retention, and deletion tests.
- [ ] Verify provider switching and restart reconstruction without raw secret or capability persistence.

**Exit gate:** Augmentor can resume and explain a delegated task after restart using trusted host state, while the harness receives only its bounded context.

## Phase 8 — Ground-0 state

- [ ] Add Core-owned Ground-0 state machine and transition audit.
- [ ] Define and integrity-check the known-good manifest/config set.
- [ ] On entry, revoke active temporal grants and stop/quarantine optional runs.
- [ ] Disable harnesses, extensions, hooks/scripts, channels, background jobs, and archive ingest.
- [ ] Preserve identity, audit/history, continuity snapshot, and recovery hints read-only.
- [ ] Connect the existing Engineer recovery ladder beneath Ground-0.
- [ ] Re-enable components in dependency order with health checks and fresh grants.
- [ ] Add manual entry, crash-loop, corrupt-state, interrupted-recovery, and rollback tests.

**Exit gate:** recovery succeeds with every optional add-on disabled, and no pre-recovery executable authority survives exit.

## Phase 9 — SDK stabilization and release readiness

- [ ] Publish protocol versions, compatibility matrix, capability glossary, and deprecation policy.
- [ ] Ship manifest templates for all three extension classes.
- [ ] Ship the provider/extension conformance suite and reference adapters.
- [ ] Threat-model confused deputy, token theft, path escape, event spoofing, memory poisoning, resource exhaustion, and recovery persistence.
- [ ] Complete security pipeline, browser-first tests, shared tests/build, docs checks, pre-release scan, and final Alpha verification appropriate to touched code.
- [ ] Document known limitations and deferred Compute Fabric features.
- [ ] Declare stable only after migration telemetry and recovery drills meet acceptance criteria.

**Exit gate:** the SDK is documented, versioned, enforced at privileged effects, validated across multiple harnesses, and recoverable through Ground-0.

## Cross-phase non-negotiables

- [ ] Never broaden the Alpha runtime beyond extension + authenticated local bridge without a separate decision.
- [ ] Never make provenance, enablement, UI state, a skill, or Augmentor judgment an authority grant.
- [ ] Never expose raw credentials or reusable grant material to add-on UI/runtime artifacts.
- [ ] Never allow direct trusted-memory writes from harnesses.
- [ ] Never allow a child actor to exceed parent/task authority or budget.
- [ ] Never conflate preserved history with executable state during recovery.
- [ ] Keep all Linux/true-OS work in a separate future project.
