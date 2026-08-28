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
- identity and continuity vault and context gatekeeper;
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

ADR-026 makes chat interface, memory system, and communication channel replaceable slots. The `primary-agent` slot is the exception: it is permanently occupied by Augmentor (ADR-053), the fused native orchestration harness. Therefore:

- Augmentor is a permanent, fused component — not an add-on, not a replaceable `primary-agent` provider.
- The Resonant Engineer and minimal recovery console remain Core-owned.
- A harness provider can never become or displace the primary agent; slot selection applies only to the remaining replaceable slots.

## Placement test

For each new behavior, ask:

1. Does safety or recovery fail if the user disables it? If yes, consider Core.
2. Does it touch a privileged resource? If yes, implement the effect in a platform service.
3. Is it vendor/domain/workflow-specific? If yes, keep it in an add-on or adapter.
4. Can the same contract serve two providers? If yes, place the shape in Core/SDK, but keep execution with its owner.
