# ADR-053: Browser-First Multi-Harness Architecture And Terminology

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Deferred
- Superseded by: None (amends ADR-006, ADR-018, ADR-026, and ADR-010 only through
  the checkpoint ADRs listed below; see [Amends](#amends))
- Owner: Core architecture
- Decision date: 2026-08-27

## Decision

ResonantOS is a **browser-first, local-bridge-mediated AI operating environment**.
The only required Alpha runtime remains a Chrome Manifest V3 extension plus an
authenticated Node bridge bound to the local host. "Operating environment" means
coordination across agents, add-ons, memory, providers, browser surfaces, and host
capabilities; it does not mean ResonantOS owns the host kernel or base operating
system.

This ADR ratifies the terminology and constitutional boundary of the [Browser
Architecture Package](resonantos-browser-architecture/README.md) (adopted as
documentation by ADR-052). It makes **no runtime change**; it is the vocabulary and
governance floor that the later checkpoint ADRs build on.

### Constitutional statements

- **The user is sovereign.**
- **ResonantOS Core governs authority** — "what is permitted".
- **Augmentor permanently governs AI orchestration** — "what should happen".
- **Harness Providers govern their own internal execution** within the authority delegated to them — "how to do it".

### Authority vs orchestration

```text
                  USER
                    │
                    ▼
             RESONANTOS CORE            (authority layer — "what is permitted?")
                    │
                    ▼
               AUGMENTOR                (orchestration layer — "what should happen?")
                    │
                    ▼
              AI HARNESSES              (execution layer — "how do I do it?")
```

Augmentor is **not** the root security authority. Core owns identity, policy,
capability, audit, and recovery. A compromised or malfunctioning orchestrator must
never become effectively root.

### Augmentor is a permanent, fused component

**Augmentor is not an add-on, Harness Provider, or replaceable `primary-agent`
provider.** It is a permanent, fused component of ResonantOS and the authoritative
orchestration harness inside the ResonantOS environment.

This aligns with ADR-051, which already declares the integrated harness "fused to
the shell — not a plug-in, not even a bundled add-on." ADR-053 names that
integrated harness **Augmentor** and pins the `primary-agent` slot to it.

Augmentor's extensions are add-ons. External harnesses are add-ons. Augmentor
itself is part of the permanent architecture.

### Orchestration primacy

**Augmentor has permanent orchestration primacy within the ResonantOS AI
environment.** It owns, end to end: user intent intake → task interpretation →
context assembly → capability discovery → execution routing → harness selection →
delegation → progress coordination → result synthesis → continuity with the user.

A third-party harness may contain its own planner, agents, tools, and plugins, and
may be very powerful. Its authority exists **inside the job/environment Augmentor
and Core establish for it**. Augmentor does not micromanage a harness, and a
harness does not become ResonantOS's orchestrator merely because it orchestrates
its own internals.

### Two levels of orchestration

| Level | Owner | Scope |
| --- | --- | --- |
| System Orchestration | Augmentor (exclusively) | intent, routing, delegation, synthesis across the environment |
| Harness Orchestration | each Harness Provider | its own plan, agents, tools, plugins, internal loop |

This prevents the word "orchestrator" from becoming ambiguous.

### Terminology (normative meanings)

| Term | Meaning |
| --- | --- |
| ResonantOS Core | Non-optional policy, identity, lifecycle, audit, and recovery authority |
| Browser shell | MV3 extension surfaces and shell-owned navigation |
| Platform service | Host-mediated implementation behind an authenticated route |
| Augmentor | Permanent, fused native ResonantOS AI orchestration harness; occupies the `primary-agent` role and cannot be displaced, replaced, or reassigned by an add-on or harness provider |
| Augmentor extension | Focused capability or workflow used within Augmentor |
| Harness provider | Adapter for a complete external AI harness with its own loop, tools, and agents |
| System add-on | Capability (memory, browser, channel, compute) that is neither of the above |
| Ground-0 | Minimum known-good browser/bridge state for recovery; includes Core, Augmentor, user identity, and trusted continuity |
| Host OS | macOS, Windows, or Linux beneath ResonantOS |

### Slot decision (D-1)

`primary-agent` remains the stable system-slot id. The slot is **permanently
occupied by Augmentor**. Its role is system-wide AI orchestration. Harness
Providers may execute and internally orchestrate their own work, but they cannot
claim, replace, alias, or displace the ResonantOS `primary-agent` role.

No `orchestrator` alias is introduced. ADR-051's vocabulary term `orchestrator`
("coordinates multiple agents") describes the role, not a new slot.

### Naming decision (D-2)

"Augmentor" is the canonical name of the fused orchestration harness. `strategist`
remains the shell section id (`CoreSectionId: "strategist"`); it is not renamed. No
module rename, no re-export shims. This is a naming-continuity decision, not an
authority claim.

### Ground-0 contains a minimal Augmentor kernel

Because Augmentor is fused, Ground-0 **must contain Augmentor** — but only a
**minimal Augmentor kernel**, not the full normal Augmentor. The known-good floor
is: Core + minimal Augmentor kernel + user identity + Augmentor identity + trusted
continuity/history + capability/policy system + recovery + a minimal model route.

The Ground-0 Augmentor kernel is restricted to: identify the user, explain system
state, inspect failures, disable/quarantine components, restore known-good
configuration, access trusted continuity, choose a safe model route, and restart
normal operation. Higher-level Augmentor functionality — plugins, harness
integrations, research/coding tools, external connectors, complex workflows — is
disabled or quarantined. Recovery stays independent of the complex components most
likely to have caused the failure. Formalized in the CP-8 ADR (ADR-010 amendment).

### Boundary rules

- Every privileged effect crosses a named, authenticated, capability-gated host route.
- UI visibility, enablement, a prompt, or an Augmentor decision does not itself authorize an operation.
- Provider secrets, browser credentials, filesystem roots, and external-account authority remain host-mediated.
- The local bridge defaults to loopback and rejects unauthenticated requests.
- A harness provider cannot become or displace the primary agent; the `primary-agent` role is permanently Augmentor.
- Augmentor does not govern authority; Core does. Orchestration primacy is not security primacy.

### Explicit exclusion

A Linux distribution, kernel, init system, native desktop environment, bootloader,
distro recovery mode, or system-wide package manager is out of scope. A future
"Resonance OS" project must have a separate repository, threat model, ADR set, and
roadmap.

## Amends

This ADR records the amendment targets; the checkpoint ADRs execute them:

| Amended | By | Change |
| --- | --- | --- |
| ADR-026 | ADR-053 (this) | `primary-agent` slot is permanently occupied by Augmentor (not a replaceable provider); `chat-interface` and `memory-system` remain replaceable slots |
| ADR-006 | CP-3/CP-4 ADR | add extension classes (`augmentor-extension`, `harness-provider`, `system-addon`), the nested authority rule, and temporal/task grant semantics |
| ADR-018 | CP-3/CP-4 ADR | define `AugmentorExtensionManifest` and `HarnessProviderAdapter` protocols; typed task/event/result/resource contracts |
| ADR-010 | CP-8 ADR | introduce Ground-0 state beneath the recovery ladder; Ground-0 contains Augmentor; quarantine optional executable state |

Nothing in this ADR retroactively changes the accepted statements of those ADRs.
Supersession metadata is applied only when the corresponding checkpoint ADR lands.

## Why

The current ADR set describes Augmentor both as a fused integrated harness
(ADR-051) and as a replaceable `primary-agent` provider (ADR-026). This ADR is a
**deliberate architectural evolution** from replaceable `primary-agent` semantics
to permanent Augmentor orchestration primacy — not a naming cleanup. Treating
Augmentor as "just another provider" would let a third-party harness displace the
orchestration layer, collapsing the distinction between system orchestration and
harness orchestration. Augmentor is permanent and fused (a minimal kernel at
Ground-0); Core remains the authority floor; harnesses remain autonomous inside
their granted task envelopes.

## Rules

- `primary-agent` is permanently occupied by Augmentor; no add-on or harness provider may claim, replace, alias, or displace it.
- Augmentor is not an add-on and not a replaceable provider; it is a permanent, fused component.
- Core governs authority; Augmentor governs orchestration; harnesses govern their own internal execution.
- `strategist` remains a shell section id; it is not the agent implementation's name.
- Terminology and constitution imply no runtime change; runtime behavior changes only through the checkpoint ADRs.
- Ground-0 must contain a minimal Augmentor kernel; higher-level Augmentor functionality and optional executable state are quarantined.
- The fused Augmentor core contains only identity continuity, user interaction, orchestration recovery, diagnostics, capability-aware delegation, and restoration of normal operation; specialized execution remains in replaceable extensions or harness providers.
- Documentation validation (`node scripts/validate-docs.mjs`) must pass with this ADR.

## Related

- [ADR-052: Browser Architecture Package](ADR-052-browser-architecture-package.md)
- [ADR-051: ROS Architecture Blueprint](ADR-051-ros-architecture-blueprint.md)
- [Browser Architecture Package](resonantos-browser-architecture/README.md)
- [Decision register](resonantos-browser-architecture/DECISIONS.md)
