# ResonantOS Browser Architecture Package

Status: proposed target architecture
Baseline reviewed: `vonstegen/2.0.0-alpha`, `dev` mirror; now tracked in-repo under
`docs/architecture/resonantos-browser-architecture/`
Scope: browser-first ResonantOS only
Adoption record: [ADR-052](../ADR-052-browser-architecture-package.md)
Adoption roadmap: [ROADMAP.md](ROADMAP.md) · Review checklists: [CHECKLISTS.md](CHECKLISTS.md)

## Purpose

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
Augmentor (native, replaceable primary-agent implementation)
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

## Foundational decisions

- ResonantOS is a browser-first AI operating environment, not a Linux distribution.
- Augmentor orchestrates; ResonantOS Core authorizes; harnesses govern their internal execution.
- Augmentor extensions and full harness providers are different SDK classes.
- Multiple harnesses may execute concurrently under independent task grants.
- No child agent, tool, connector, or plug-in may exceed its parent authority.
- Delegation authority is identity-bound, task-scoped, time-bounded, revocable, and auditable.
- Context sharing is explicit; trusted-memory promotion remains host-governed.
- Ground-0 preserves trusted identity and history while disabling optional executable state.
- Resource reservations and cost policy are authorization inputs, not after-the-fact telemetry.

## Adoption order

Start with terminology and ADR ratification, then introduce additive contract types, enforce them at bridge routes, migrate Hermes/OpenCode as reference harness providers, add concurrency/resource governance, and only then declare Ground-0 and the public SDK stable. The master checklist contains entry and exit gates for each phase.

## Explicitly out of scope

A Linux distribution, kernel, init system, native desktop environment, bootloader, distro recovery mode, or system-wide package manager is not part of this package. A future “Resonance OS” or true-OS project must have a separate repository, threat model, ADR set, and roadmap.
