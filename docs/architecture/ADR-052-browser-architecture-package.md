# ADR-052: Browser Architecture Package (Proposed Target Architecture)

## Decision Metadata

- Decision status: Proposed
- Alpha applicability: Deferred
- Superseded by: None (adopts a documentation package; amends ADR-006, ADR-018,
  ADR-026, and ADR-010 only through the checkpoint ADRs listed below)
- Owner: Core architecture
- Decision date: 2026-08-27

## Decision

The **ResonantOS Browser Architecture Package** is adopted as the proposed
target architecture for browser-first ResonantOS. The package lives at
`docs/architecture/resonantos-browser-architecture/` and contains 14 design
documents plus a README, an adoption roadmap with checkpoints, and review
checklists.

Adoption means:

1. The package's document set is the canonical description of the target
   multi-harness architecture (Augmentor as native orchestrator, harness
   providers, identity/delegation chains, task-scoped authority, resource
   governance, Ground-0 recovery).
2. The package's master phased checklist (doc 14) is the implementation order;
   the [roadmap](resonantos-browser-architecture/ROADMAP.md) tracks it as
   checkpoints CP-0 through CP-9 with exit gates.
3. Terminology and runtime behavior change only through the checkpoint ADRs,
   not through this package directly. The package is a design document set,
   **not a runtime authority**.

## What is explicitly not adopted today

- No runtime change to the Alpha surface: the Chrome MV3 extension plus the
  authenticated local Node bridge remains the only required runtime.
- No SDK type additions from doc 12 (principals, delegation records, task
  packets, envelopes) are normative until the CP-1 ADR lands.
- No change to `primary-agent` versus an `orchestrator` alias until CP-0
  ratifies one vocabulary.
- No Ground-0 state machine change until the CP-8 ADR lands; `src/modules/recovery`
  remains the recovery workflow.

## Relationship to the G0-ROS blueprint (ADR-051)

ADR-051 remains the accepted encoding of the fused core, the Ground-0
invariant, and the category → rail-destination mapping. The package is
consistent with it: doc 10's Ground-0 recovery builds on the same invariant,
and doc 02's Core/platform-service/add-on split matches the shell/harness/agent
vocabulary. Where they differ, ADR-051 wins until a checkpoint ADR amends it.

## Adoption path

Checkpoint ADRs ratify package content in dependency order (see the roadmap):

1. Browser-first multi-harness architecture and terminology (CP-0).
2. Principal/delegation chain and task-scoped temporal authority (CP-1, CP-2).
3. Augmentor extension and harness provider SDK contracts (CP-3, CP-4).
4. Ground-0 state and executable-state quarantine (CP-8).
5. Concurrent resource governance (CP-6).

Each checkpoint ADR records which existing ADRs it amends and carries the
standard decision-status and Alpha-applicability metadata.

## Why

The current ADR set and the SDK implementation have grown provider-specific
delegation paths (Hermes, OpenCode), a broad `CapabilityGrant` model, and
recovery logic that predates the multi-harness direction. Without a bounded,
phased target, each addition re-derives authority, task, and memory rules
ad hoc. The package supplies that target without disturbing the working
system: it is read-only documentation until checkpoints close.

## Rules

- The package's normative language (`MUST`/`MUST NOT`) applies to the target
  architecture, not retroactively to accepted ADRs or shipped Alpha behavior.
- Checkpoint gates close only with the evidence defined in doc 14 and the
  review checklists.
- No checkpoint ADR may be merged before its prerequisites' gates close.
- Documentation validation (`node scripts/validate-docs.mjs`) must pass with
  every checkpoint ADR.

## Related

- [Package index](resonantos-browser-architecture/README.md)
- [Adoption roadmap](resonantos-browser-architecture/ROADMAP.md)
- [Review checklists](resonantos-browser-architecture/CHECKLISTS.md)
- [ADR-051: ROS Architecture Blueprint](ADR-051-ros-architecture-blueprint.md)
