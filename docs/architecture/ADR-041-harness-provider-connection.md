# ADR-041: Generic Harness Provider Connection Contract

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-28
- Alpha note: The descriptive `harnessProviderConnection` manifest block and its
  host-owned discovery/filtering ship with this decision. It is the reusable
  External SDK facility that generalizes ADR-039 provider profiles to ANY
  authorized harness add-on; Pi is the first reference consumer, not a
  Pi-specific selector or resolver.

## Context

ADR-039 made one host-owned provider-profile credential system serve every
authorized harness, but the manifest could only declare a single
`credentialSource` and a non-secret `credentialBinding`. A harness could not
declare *which* provider/protocol families it can actually consume, nor *how* it
can receive a credential (host runtime adapter vs. session-scoped environment
vs. self-auth vs. none). Without that declaration, host discovery could not
filter the shared provider catalog to the profiles/models a specific installed,
enabled, and authorized harness is actually compatible with.

## Decision

### Contract (descriptive, never authority)

A harness may declare a `harnessProviderConnection` block on its manifest:

```jsonc
{
  "harnessProviderConnection": {
    "consumesProviderProfiles": true,
    "providerProtocols": ["openai-compatible"],
    "credentialDelivery": ["runtime-adapter", "session-environment"],
    "modelSelection": true
  }
}
```

- `consumesProviderProfiles` — whether the harness can consume ROS Provider
  Profiles through host mediation.
- `providerProtocols` — compatible protocol/API families from the canonical
  `ProviderProtocolFamily` vocabulary (`openai-compatible`,
  `minimax-compatible`, `ollama`). Descriptive only: declaring a protocol grants
  no access to any profile. Provider identity/type is a separate concept
  (`ProviderType`) from protocol/API compatibility (`ProviderProtocolFamily`);
  a harness declares the protocol it speaks, never a vendor.
- `credentialDelivery` — supported credential delivery mechanisms in host
  preference order: `runtime-adapter`, `session-environment`, `self-auth`,
  `none`.
- `modelSelection` — whether the harness supports host-mediated model selection
  (consistent with `agentRuntime.supportsModelSelection`).

### Credential delivery preference order

The host maps a provider profile to the safest mechanism the harness actually
supports:

1. `runtime-adapter` — host/runtime credential API delivers the scoped lease at
   execution time (ADR-039's `createHarnessCredentials` path).
2. `session-environment` — session-scoped child environment variables.
3. `self-auth` — the harness owns its own login/auth store; the host injects no
   credential.
4. Durable duplicated secret is NOT allowed without a separate approved
   architecture decision.

### Discovery

Host-owned discovery returns ONLY Provider Profiles/models compatible with the
specific installed/enabled/authorized harness and its declared
`providerProtocols` + `credentialDelivery`. The harness never enumerates raw
credentials or arbitrary provider secrets; UI/control surfaces receive
metadata/status only (profile identity/label, compatible models, configured
boolean, availability/health where supported).

## Amendment (1.1B): protocol vocabulary, not provider identity

The original `providerFamilies` field reused the mixed `ProviderType`
vocabulary, which bundles vendor identity (`openai`, `anthropic`, `google`,
`minimax`), wire protocol (`openai-compatible`), deployment locality (`local`),
and an escape hatch (`custom`). That conflates *who the provider is* with *what
API protocol the harness can speak*.

This decision is amended so the descriptive declaration names only the audited
protocol/API vocabulary (`ProviderProtocolFamily`):

- The canonical field is `providerProtocols: ProviderProtocolFamily[]`.
- `ProviderProtocolFamily` is `openai-compatible | minimax-compatible | ollama`,
  grounded one-to-one in the host execution adapters; `anthropic`, `google`, and
  `custom` have no host adapter today and are not protocol families.
- `ProviderType` remains the separate provider identity/type vocabulary and is
  unchanged.
- The legacy `providerFamilies` field is rejected by validation; there is no
  production add-on ecosystem to preserve an alias for.

The host-owned discovery and runtime-adapter matching still compare the
declared field against provider *identity* and are migrated to the protocol
vocabulary (`deriveProviderProtocol`) in 1.1C; this decision does not yet claim
that migration is complete.

## Consequences

- The contract is orthogonal to classification (`ADR-040`), runtime, surface,
  capability, and slot authority; it is descriptive and grants nothing.
- Validation bounds the block to the four declared fields and rejects unknown
  fields, so no credential/endpoint/executable channel can ride through it.
- Incompatible provider families are filtered at discovery; harness A cannot
  resolve harness B's provider authority (per-harness binding + grant gate
  still enforced).
- Revoking a harness grant fences that harness's discovery while other
  authorized harnesses continue to resolve the shared profile.
