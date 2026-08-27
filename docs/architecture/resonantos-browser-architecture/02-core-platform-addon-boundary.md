# 02 — Core, Platform Service, and Add-on Boundary

## Decision rule

A responsibility belongs in Core only when removing or replacing it would break authorization, trusted continuity, auditability, lifecycle safety, or recovery. Privileged implementation belongs in a platform service. User-selectable behavior belongs in an add-on.

| Layer | Owns | Must not own |
| --- | --- | --- |
| Core | principal registry, policy evaluation, grants, delegation lineage, task lifecycle, audit/event log, Ground-0 policy, provider/credential mediation rules | add-on-specific planning, vendor runtime internals, raw UI composition |
| Platform service | filesystem/process/network/browser/provider operations; route validation; secret custody; runtime supervision | policy invention, user-intent interpretation, implicit grants |
| Add-on | workflow, tools, UI, connectors, optional runtime, domain behavior | bridge authentication, credential vault, trusted-memory promotion, grant issuance |

## Core services

The target Core contains logically stable brokers rather than hard-coded products:

- identity and delegation broker;
- capability and approval broker;
- task/event broker;
- provider and credential broker;
- memory-provider broker and trust-promotion gate;
- resource governor;
- add-on registry/lifecycle supervisor;
- audit and continuity snapshot service;
- Ground-0 state controller and minimal Engineer console.

These may share a process in the Alpha. “Service” denotes ownership and contract, not a microservice requirement.

## Replaceability

ADR-026 correctly makes primary agent, chat interface, memory system, and communication channel replaceable slots. The target architecture preserves that rule while naming Augmentor as the native recommended orchestration implementation. Therefore:

- Augmentor is canonical in behavior and SDK integration, but SHOULD remain replaceable as a `primary-agent` provider.
- The Resonant Engineer and minimal recovery console remain Core-owned.
- A harness provider does not automatically become the primary agent; explicit slot selection is required.

## Placement test

For each new behavior, ask:

1. Does safety or recovery fail if the user disables it? If yes, consider Core.
2. Does it touch a privileged resource? If yes, implement the effect in a platform service.
3. Is it vendor/domain/workflow-specific? If yes, keep it in an add-on or adapter.
4. Can the same contract serve two providers? If yes, place the shape in Core/SDK, but keep execution with its owner.
