# ADR-055: External Agent Runtime Boundary — ADR-056 ↔ #321 Reconciliation

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: ADR-053 (architectural home), ADR-018 (SDK contract)
- Amends: ADR-053 (multi-harness boundary), ADR-026 (system-slot ownership), ADR-018 (add-on SDK contract)
- Owner: Core architecture + maintainer (joint)
- Decision date: 2026-09-02
- Companion doc: [TOM-FEEDBACK-CROSS-REFERENCE.md](./resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md) (decision 2)

## Context

The maintainer's framework-stack feedback (Tom's `ResonantOS-Andrew-Overlap-Gap-Alignment.pdf`) flagged a reconciliation question between two docs:

1. **ADR-056** ("Provider Fabric Boundary for External Agent Runtimes," status *Deferred*) — the maintainer's policy doc stating that external agent runtimes (DeepSeek Harness, Agent Zero, OpenCode) are local-service add-ons that never hold raw provider credentials, never choose their own routing, and execute only within the host-mediated service boundary. **ADR-056 does not exist in this repo** (only ADR-001 through ADR-054 are on disk at the time of this decision).

2. **Issue #321** — the concrete enforcement mechanism: a bridge-authenticated reverse proxy in front of `opencode serve` on a randomized ephemeral port, with a session-scoped attributed event bus. #321 lives on the maintainer's dev branch.

3. **Issue #320** — the current *violation* of the boundary (the unauthenticated opencode server that holds no auth and is directly reachable, bypassing host mediation) which #321 closes.

This ADR is the **in-repo governance anchor** for that boundary. It adopts the maintainer's ADR-056 policy as the policy floor (because the policy is sound), points the policy at this repo's ADR-053 (multi-harness architecture, already accepted and the canonical multi-harness boundary doc) as the architectural home, and resolves one important contradiction the maintainer's feedback revealed.

## The one contradiction

Tom's feedback correctly notes that the SDK shape treats `primary-agent` as a replaceable system slot (an add-on could claim it with the agent-delegation capability). **That reading is correct as far as the SDK contract goes** (`ADR-018` add-on SDK V0 §"Why" lists `addon.augmentor-chat` providing `primary-agent` as an example path), **but it is overridden in this repo by ADR-053**, which permanently occupies the `primary-agent` slot to Augmentor:

> "Augmentor is not an add-on, Harness Provider, or replaceable `primary-agent` integrated harness **Augmentor** and pins the `primary-agent` slot to it." — ADR-053

ADR-026 ("Minimal Kernel And Replaceable Default Add-ons") is **superseded on this specific point** by ADR-053:

> "Superseded by: ADR-053 (primary-agent slot)" — ADR-026 metadata

So in this repo the `primary-agent` system slot is **not replaceable by an add-on**. The SDK contract still allows the manifest slot claim (because ADR-018 predates ADR-053 and ADR-018 is the SDK contract), but the runtime enforces Augmentor's permanent occupation. A re-authored Manolo Augmentor (per Tom's SDK eval) can become the **user-facing Augmentor experience** by porting its browser tools onto `AddOnToolDefinition` and integrating with the existing Augmentor kernel — not by claiming `primary-agent`.

## Decision

### The policy floor (from ADR-056, restated)

External agent runtimes — including DeepSeek Harness, Agent Zero, OpenCode, OpenClaw, Hermes, Pi, Aider, and any future harness — are **local-service add-ons** with these guarantees:

- They **never hold raw provider credentials** (the host's provider-fabric bridge mediates all credential access).
- They **never choose their own routing** (the host's bridge holds the routing decision per ADR-040).
- They execute **only within the host-mediated service boundary** (every effect crosses a named, authenticated, capability-gated host route — per ADR-053 §"Constitutional statements").

### The architectural home

This boundary is **already captured by ADR-053** (Browser-First Multi-Harness Architecture And Terminology). ADR-055 is the **policy statement** that names the boundary; ADR-053 is the **architectural home** that defines what the boundary means in this codebase. ADR-018 (Add-on SDK V0) is the **contract** that add-ons must satisfy to live inside the boundary; ADR-040 (Provider Fabric Boundary) is the **enforcement mechanism** that keeps the boundary real at the provider-fabric layer.

The maintainer's ADR-056 (when it lands in this repo, presumably as a new ADR with its own number, possibly re-using 056) **supersedes nothing** in this repo's governance — it is a complementary policy doc that fills a gap the maintainer noticed (the lack of an explicit "external agent runtimes are local-service add-ons" statement). ADR-055 + ADR-053 together cover the same ground with this repo's terminology.

### The enforcement primitive (Tom's #321)

#321 (bridge-authenticated reverse proxy in front of `opencode serve` on a randomized ephemeral port, with a session-scoped attributed event bus) is the **first concrete enforcement primitive** for this policy floor. The CP-5 cutover (commits `ca9441e` … `9c19d9b` on `feat/cp5-phase5-reference-harnesses`) provides a **partial implementation** of #321's intent: `opencodeRuntimeDispatch` validates the CP-2 governed envelope, acquires a workspace lease (Phase 5 row 99), drives the real `opencode serve` session through `createOpencodeHttpClient` + `ensureOpencodeServer`, and audits every dispatch decision. The randomized ephemeral port + reverse proxy are the next step (Tom's workstream).

### The corollary: OpenCode + OpenClaw already on this branch

CP-5 row 99 (OpenCode + workspace lease) and CP-5 row 100 (OpenClaw real MCP gateway transport) are the **first two provider-class adapters** wired into the governed-envelope path with this policy floor. Both pass the policy floor tests:

- **OpenCode** (`browser-first/host/opencode-client.mjs` + `browser-first/host/opencode-client.mjs` + `workspace-lease.mjs` lease gate): credentials never leave the bridge, routing is host-mediated, effects cross capability-gated routes.
- **OpenClaw** (`browser-first/host/openclaw-gateway-client.mjs`): the OpenClaw adapter's `openclawGatewayRuntimeDispatch` validates the CP-2 governed envelope, then forwards to a real MCP gateway which is the child-actor authority (per `openclaw-gateway-e2e.test.mjs`). The gateway is the only authority path for the child actor; the bridge still owns request attestation.

The five remaining reference adapters (Hermes, AgentZero, DeepSeekHarness, Pi, Aider) all dispatch through `hostCommandRuntimeDispatch` or `governedRuntimeDispatch` — both go through the CP-2 governed envelope before any host-mediated effect. They satisfy the policy floor by construction.

## Why

This ADR closes the reconciliation thread Tom opened in `ResonantOS-Andrew-Overlap-Gap-Alignment.pdf`. Without it, the maintainer's ADR-056 and this repo's ADR-053 sit as parallel statements of the same boundary — readers to one would not know about the other. ADR-055 is the joint statement: the policy lives in this repo, the architectural home is this repo, the SDK contract is this repo, and the enforcement primitive is shared between the maintainer's #321 and the CP-5 partial implementation.

## Rules

- **The boundary is the architectural floor.** Every harness-provider dispatch (OpenCode, OpenClaw, Hermes, AgentZero, DeepSeekHarness, Pi, Aider) goes through the CP-2 governed envelope **before** any host-mediated effect.
- **Credentials never leave the bridge.** The provider-fabric bridge holds all provider credentials; harnesses receive only `providerProfileId` references and `routingDecisionId` references.
- **Routing is host-mediated.** The bridge holds the routing decision (ADR-040); harnesses cannot choose their own routing.
- **Effects cross capability-gated host routes.** Every privileged effect (`start`, `status`, `events`, `cancel`, `collectArtifacts`) is a named, authenticated, capability-gated route — not a raw IPC channel.
- **The `primary-agent` slot is not an add-on target.** It is permanently occupied by Augmentor (ADR-053). The SDK's `primary-agent` slot claim is a contract artifact; the runtime enforces Augmentor's permanent occupation.
- **Workspace leases are the next layer of the boundary.** Phase 6 will unify the workspace lease from CP-5 row 99 with the four other `LeaseKind`s (browser, GPU, provider-route, external-account) under `src/sdk/resources/index.ts`. Until then, the workspace lease is the only enforced `LeaseKind`; the others are policy-only.

## Amends

- ADR-053: adds the explicit "external agent runtimes are local-service add-ons" policy floor (this ADR §"The policy floor"). The architectural home is unchanged.
- ADR-026: this ADR is the first explicit statement in this repo that `primary-agent` is **not** replaceable by an add-on, despite the SDK contract allowing the manifest claim. ADR-026 was already superseded on this point by ADR-053; ADR-055 makes the supersession explicit and prevents future SDK contributors from re-reading ADR-018 in isolation and concluding `primary-agent` is replaceable.
- ADR-018: does not amend; the SDK contract still allows the `primary-agent` slot claim. The runtime enforces Augmentor's permanent occupation independently.

## What this ADR is NOT

- Not a denial of Tom's work on #320/#321/#326. Those are the maintainer's security track; this ADR is the in-repo governance anchor for the boundary they enforce. The work is on the maintainer's side and the partial implementation is on this side; ADR-055 ties them together.
- Not a re-authorization of Manolo's Augmentor. A re-authored Manolo Augmentor can integrate with the existing Augmentor kernel (the user-facing Augmentor experience), but it cannot claim `primary-agent` and become the kernel's main agent.
- Not a renaming or replacement of ADR-053. ADR-053 stays the architectural home; ADR-055 is the policy statement that names the boundary.
- Not a guarantee that the maintainer's ADR-056 will be adopted verbatim when it lands. ADR-055 covers the same ground with this repo's terminology; ADR-056 (when it lands) is a complementary doc, not a competing one.

## References

- [ADR-053: Browser-First Multi-Harness Architecture And Terminology](./ADR-053-browser-first-multi-harness-architecture.md) — architectural home
- [ADR-026: Minimal Kernel And Replaceable Default Add-ons](./ADR-026-minimal-kernel-replaceable-default-addons.md) — superseded on `primary-agent`
- [ADR-018: Add-on SDK V0](./ADR-018-addon-sdk-v0.md) — SDK contract
- [ADR-005: Provider Fabric Routing](./ADR-005-provider-fabric-routing.md) and [ADR-032: ResonantOS Compute Fabric](./ADR-032-resonantos-compute-fabric.md) — provider-fabric + compute-fabric enforcement layers
- [TOM-FEEDBACK-CROSS-REFERENCE.md](./resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md) — decision 2 reconciliation context
- CP-5 Phase 5 prompt: [CP5-PHASE5-CONTINUATION.md](./resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md) — partial implementation of #321 on intent (workspace lease, governed envelope, real opencode/openclaw dispatch)
- CP-6 prompt: drafted in chat, not yet persisted to disk. The next step on this repo's side is to unify the workspace lease from CP-5 row 99 with the four other `LeaseKind`s (browser, GPU, provider-route, external-account) under `src/sdk/resources/index.ts`.