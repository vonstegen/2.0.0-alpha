# 05 — AI Harness Provider Model

## Definition

A Harness Provider integrates a complete external AI execution environment—such as Hermes, OpenClaw, OpenCode, or a future harness—without requiring ResonantOS to absorb its internal architecture.

A provider consists of a manifest, adapter, runtime supervisor, task protocol, event protocol, artifact protocol, health contract, and policy declarations. The external harness may have its own planners, agents, tools, plug-ins, models, and memory, but all effects visible outside its sandbox remain governed by ResonantOS.

## Required provider operations

- `discover` / `diagnose`
- `install` or attach to an existing installation
- `startTask`
- `getTask`
- `subscribeEvents` or durable polling equivalent
- `requestEscalation`
- `cancelTask`
- `collectArtifacts`
- `shutdown` / `degrade`

Optional operations include pause/resume, checkpoint/restore, task handoff, model selection, and child-actor enumeration.

## Task packet

A task packet MUST include:

- task ID, issuer, executor, and delegation-chain reference;
- user intent, success criteria, non-goals, and output contract;
- bounded context references with sensitivity and freshness;
- requested capabilities and resource budget;
- workspace/artifact roots;
- approval policy, deadline, and expiration;
- cancellation channel and audit correlation ID.

It MUST NOT contain raw provider credentials, unconstrained filesystem paths, all user memory, or unrelated conversation history.

## Result contract

A harness returns status, summary, artifacts, evidence, actions taken, verification, residual risks, cost/resource usage, approval requests, and child-actor audit references. Results are untrusted inputs until verified or promoted through the appropriate boundary.

## Containment rule

The adapter MUST translate every child effect into a host-mediated call with the current identity chain and task grant. A harness that cannot expose or constrain its child operations must run in a sandbox whose outer boundary enforces the same result.

## Reference migrations

Hermes should be the reference for general delegated agent work. OpenCode should be the reference for coding/workspace tasks. OpenClaw should validate that the contract is not vendor-specific before the API is declared stable.
