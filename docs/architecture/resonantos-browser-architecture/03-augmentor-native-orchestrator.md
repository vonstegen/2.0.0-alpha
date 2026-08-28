# 03 — Augmentor as Native Orchestrator

## Role

Augmentor is the native ResonantOS-aware orchestrator. It interprets user intent, decomposes work, selects an eligible execution path, requests bounded authority, delegates, monitors events, synthesizes results, and communicates with the user.

The governing separation is:

```text
Augmentor:      What work should happen, and who should do it?
ResonantOS Core: Is this actor allowed to do it now, within this scope?
Harness:         How should the authorized work be executed internally?
```

## Responsibilities

Augmentor MUST:

- preserve the user's stated goal, rationale, and success criteria;
- build typed task/delegation packets rather than forward ambient conversation state;
- select among its own extensions and installed harness providers using declared capabilities and health;
- expose cost, external-action, destructive-action, and identity-sensitive approval gates;
- subscribe to progress and wake on material events rather than continuously supervise;
- merge returned artifacts only through their owning review/intake boundaries;
- make delegation lineage visible to the user.

Augmentor MUST NOT:

- issue its own capability grants;
- forward raw secrets or its full memory by default;
- bypass the host because a harness reports that it needs access;
- silently convert a task into a broader or permanent grant;
- treat harness output as trusted memory or verified truth.

## Orchestration lifecycle

`interpret → plan → choose executor → request authority → dispatch → observe → handle escalation → verify → synthesize → close`

Core may authorize a task so the harness continues asynchronously without Augmentor in the hot path. Augmentor receives durable events and can reattach after restart or provider change.

## Relationship to harness providers

Augmentor is the permanent system orchestrator; it is not a replaceable slot (ADR-053). A harness provider is a second-level orchestrator inside its own task envelope: it plans, routes, and executes its own work, but it cannot displace or alias Augmentor. There is no third-party "primary agent" — the `primary-agent` role is permanently Augmentor. Harness providers use the same SDK contracts for delegation, but they never inherit Augmentor's identity or grants.
