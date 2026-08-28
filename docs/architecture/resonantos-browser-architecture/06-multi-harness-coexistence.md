# 06 — Multi-Harness Coexistence

## Requirement

ResonantOS MUST support Augmentor extensions and multiple independent harness providers concurrently. Installation, enablement, active execution, and slot ownership are separate states.

```text
                         Augmentor
                intent, routing, synthesis
                 /          |          \
       own extensions    Hermes      OpenCode/OpenClaw
                 \          |          /
                 Core task/event/resource brokers
```

## Isolation

Each active harness task receives a distinct:

- runtime principal and child namespace;
- task grant and expiration;
- workspace and artifact namespace;
- context envelope;
- resource reservation;
- event stream and cancellation token;
- audit correlation chain.

Harnesses MUST NOT share raw credentials, memory, process handles, workspaces, or capability tokens. Cooperation occurs through typed task packets, artifact references, and explicit handoffs mediated by Core.

## Scheduling semantics

- Different harnesses MAY run unrelated tasks simultaneously.
- One task MAY fan out to several harnesses when output contracts and budgets are independent.
- A task handoff creates a new delegation edge; it does not transfer the source harness's token.
- Augmentor MAY detach after dispatch and later reconstruct state from durable events.
- Cancellation MUST target a concrete task/run identity and revoke its outstanding temporal grants.
- Provider failure MUST degrade only the affected task/provider unless a shared platform dependency fails.

## Conflict controls

Concurrent write access to the same workspace requires one of: exclusive lease, isolated worktree/snapshot, or an explicit merge protocol. Shared browser sessions, external accounts, GPUs, and rate-limited model routes require resource-specific arbitration.

## User experience

The user should see executor, status, elapsed time, budget, current authority, requested escalation, artifacts, and a reliable stop control. The UI must distinguish “installed,” “enabled,” “healthy,” and “currently executing.”
