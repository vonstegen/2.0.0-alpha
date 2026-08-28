# ResonantOS Browser Architecture Package

Status: proposed target architecture
Baseline reviewed: `vonstegen/2.0.0-alpha`, `dev` mirror; tracked in-repo under
`docs/architecture/resonantos-browser-architecture/`
Scope: browser-first ResonantOS only
Adoption record: [ADR-052](../ADR-052-browser-architecture-package.md)
Adoption roadmap: [ROADMAP.md](ROADMAP.md) · Review checklists: [CHECKLISTS.md](CHECKLISTS.md)
Philosophical basis: [Augmentatism](https://augmentatism.com/) — ResonantOS stems from these ideas.

> **Baseline note:** docs 01–14 and doc 13's migration map were written against
> the `dev` mirror (PR #278, `80dcd79`). The active branch
> (`feat/dev-external-agent-runtimes-panel`, `a2fdb88`) has since landed
> caller-attributed tokens, a per-caller grants store, an append-only audit ledger,
> an external-agent-runtime dispatcher, and the ADR-051 G0-ROS blueprint. The
> planning package rebases against that state — see
> [ROADMAP.md](ROADMAP.md) "Baseline correction" and
> [IMPLEMENTATION_TRACKING.md](IMPLEMENTATION_TRACKING.md).

## Purpose

This package turns the planned SDK architecture into a set of bounded design documents and an executable migration sequence. It layers a multi-harness orchestration model over the current Chrome MV3 extension, authenticated local Node bridge, Add-on SDK V0, delegation services, memory boundaries, compute contracts, and recovery workflow.

The package is not a claim that every target contract is implemented. Each document distinguishes:

- **Current baseline**: behavior or contracts visible in the reviewed fork.
- **Target rule**: the architecture to adopt.
- **Migration implication**: the smallest path from baseline to target.

## Normative language

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe target requirements. They do not retroactively change accepted ADRs. Repository adoption should occur through new or amended ADRs and focused implementation changes.

## System boundary

```text
User
  |
Browser extension / shell
  |
Augmentor (fused native orchestration harness — not an add-on)
  |-- Augmentor extensions
  |-- Harness providers: Hermes, OpenClaw, OpenCode, future harnesses
  |-- System add-ons
  |
ResonantOS SDK and Core policy boundary
  |-- identity, delegation, capabilities, memory trust, resources, audit
  |
Authenticated local Node bridge
  |
Host-mediated providers, processes, files, browser controls, and services
```

## Document map

1. [Scope and browser boundary](01-scope-and-browser-boundary.md)
2. [Core, platform service, and add-on boundary](02-core-platform-addon-boundary.md)
3. [Augmentor native orchestrator](03-augmentor-native-orchestrator.md)
4. [Augmentor extension model](04-augmentor-extension-model.md)
5. [AI harness provider model](05-ai-harness-provider-model.md)
6. [Multi-harness coexistence](06-multi-harness-coexistence.md)
7. [Identity, delegation, and authority](07-identity-delegation-authority.md)
8. [Capability inheritance and task scope](08-capability-inheritance-task-scope.md)
9. [Memory, context, and trusted continuity](09-memory-context-trusted-continuity.md)
10. [Ground-0 recovery](10-ground-0-recovery.md)
11. [Resource governance](11-resource-governance.md)
12. [SDK and API implications](12-sdk-api-implications.md)
13. [Current repository migration map](13-current-repo-migration-map.md)
14. [Master phased implementation checklist](14-master-phased-implementation-checklist.md)
15. [Identity and continuity vault](15-identity-continuity-vault.md)

## Planning package

These documents turn the target rules (01–15) into an executable adoption plan:

16. [Adoption roadmap](ROADMAP.md) — checkpoint order (CP-0 … CP-9), gates, rebased status
17. [Checkpoint specification](CHECKPOINTS.md) — per-checkpoint entry criteria, exit gates, owners, dependencies
18. [Implementation tracking](IMPLEMENTATION_TRACKING.md) — doc-14 checklist items mapped to live repo status
19. [Work breakdown](WORK_BREAKDOWN.md) — subagent wave/work-package decomposition with cross-slice contracts
20. [Decision register](DECISIONS.md) — open questions with options, tradeoffs, and recommendations
21. [Documentation plan](DOCUMENTATION_PLAN.md) — forward documentation set and checkpoint ADR plan
22. [Contracts reference](CONTRACTS.md) — canonical identity/authority/task/adapter/envelope schemas
23. [Review checklists](CHECKLISTS.md) — gate-review and reviewer checklists
24. [Threat model and known limitations](THREAT_MODEL.md) — CP-9 security posture and deliberately deferred work

## Foundational decisions

- ResonantOS is a browser-first AI operating environment, not a Linux distribution.
- Augmentor is the permanent, fused orchestration harness; ResonantOS Core authorizes; harnesses govern their internal execution.
- Augmentor extensions and full harness providers are different SDK classes.
- Multiple harnesses may execute concurrently under independent task grants.
- No child agent, tool, connector, or plug-in may exceed its parent authority.
- Delegation authority is identity-bound, task-scoped, time-bounded, revocable, and auditable.
- Context sharing is explicit; trusted-memory promotion remains host-governed.
- Identity, history, skills, and continuity are mediated by a Core-owned vault and gatekeeper; no actor receives them merely because it is installed or enabled.
- Ground-0 preserves trusted identity and history while disabling optional executable state.
- Resource reservations and cost policy are authorization inputs, not after-the-fact telemetry.

## Adoption order

Start with terminology and ADR ratification, then introduce additive contract types, enforce them at bridge routes, migrate Hermes/OpenCode as reference harness providers, add concurrency/resource governance, and only then declare Ground-0 and the public SDK stable. The master checklist contains entry and exit gates for each phase.

## Explicitly out of scope

A Linux distribution, kernel, init system, native desktop environment, bootloader, distro recovery mode, or system-wide package manager is not part of this package. A future “Resonance OS” or true-OS project must have a separate repository, threat model, ADR set, and roadmap.
