# 15 — Identity and Continuity Vault

## Definition

The Identity and Continuity Vault is a protected ResonantOS Core service that
retains the durable identity of the user and Augmentor, preserves approved skills
and trusted continuity, and acts as the **gatekeeper** for what identity, history,
skills, and continuity data other parts of ResonantOS may read.

The raw continuity store does **not** belong to Augmentor. Augmentor uses it; Core
owns it. This keeps the user's identity and continuity outside the execution layer,
so they survive an Augmentor upgrade, a Ground-0 entry, or the failure of a
higher-level Augmentor module.

## Trust domains

The vault stores data in separate trust domains:

| Domain | Contents |
| --- | --- |
| User identity | stable profile, preferences, approved personal context |
| Augmentor identity | role, version, operating principles, native capabilities |
| Trusted continuity | important history, projects, decisions, long-lived context |
| Augmentor core skills | approved native skills and operating methods (versioned) |
| User-defined skills | workflows/preferences the user intentionally preserves |
| Delegation history | which harness did what, under whose authority |
| Recovery checkpoints | last-known-good identity/memory/configuration state |

Secrets and capability tokens are references or vault state, never continuity
payloads (doc 09).

## Continuity gatekeeper

The vault exposes a **Continuity Gatekeeper** that mediates every context, skill,
and identity read. No add-on, harness, agent, model, or tool receives identity,
history, skills, or continuity data merely because it is installed or enabled.

Effective context is the intersection:

```text
effective_context =
  requested_context
  ∩ actor_permissions
  ∩ task_scope
  ∩ user_policy
  ∩ trust_level
```

A harness asking for "context for project X" receives bounded project context, not
the user's entire history, all preferences, other projects' memory, or Augmentor's
private operating state. This is **information least privilege**, not just
filesystem least privilege.

## Skills are versioned and tiered

Skills are versioned and split into two tiers:

```text
Augmentor core skills       (loaded by Ground-0)
  identity-continuity@1.0
  recovery@1.2
  delegation@1.4
  capability-awareness@1.1

Optional Augmentor skills   (loaded only in normal mode)
  research@3.2
  coding@2.7
  browser-workflow@4.1
```

Ground-0 loads only the approved core skill set; normal mode may load the rest. A
broken or malicious optional skill cannot poison the recovery environment.

System-orchestration skills — identity reconciliation, Ground-0 recovery, system
orchestration policy, continuity management — are Core/Augmentor-only and are
never delegated to a third-party harness.

## Ground-0 reload path

Ground-0 restores state from the vault in order:

```text
ROS Core
  → Identity and Continuity Vault
      → user identity
      → Augmentor identity
      → trusted continuity checkpoint
      → approved core skills
      → last-known-good configuration
  → minimal Augmentor kernel
```

The minimal Augmentor kernel wakes up already knowing who it is, who the user is,
the trusted state of their relationship, the important active projects, and how to
recover the rest of ResonantOS.

## Constitutional rule

No add-on, harness, agent, model, or tool receives identity, history, skills, or
continuity data merely because it is installed or enabled. Access is mediated by
ResonantOS Core according to actor identity, task scope, trust, and user policy.

## Placement

This is a Core service, alongside identity, policy, capability, audit, and recovery
(doc 02). It is not an add-on and not owned by Augmentor.
