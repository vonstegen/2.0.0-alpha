# ADR-039: Harness Runtime Category And Central Provider Profiles

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-28
- Alpha note: The provider-profile credential mode and the host-owned resolver
  ship with this decision. The broader first-class `harness` runtime category is
  a forward direction; the current Alpha still expresses harness add-ons as
  `local-service`/`ui-module` manifests reviewed through the harness boundary.

## Context

Harness add-ons (Augmentor, Pi, OpenCode, later Claude Code/Codex) each operated
their own credential path. Augmentor resolves ResonantOS provider profiles
host-side through the provider fabric; Pi used a transitional OpenAI-compatible
adapter with an operator `env`/`file` secret binding (`credentialBinding` +
`RESONANTOS_HARNESS_BINDINGS`); OpenCode self-authenticates against its own
upstream store. This duplicated credentials per harness and split the concept of
"provider" across three mechanisms.

[ADR-026](ADR-026-minimal-kernel-replaceable-default-addons.md) established the
swappable `primary-agent` slot. [ADR-005](ADR-005-provider-fabric-routing.md)
owns provider routing. This ADR separates the concepts cleanly and makes one
host-owned provider credential/profile system serve every authorized harness.

## Decision

### Separation Of Concerns

- Harness = how the agent operates (Augmentor, Pi, OpenCode).
- Provider = the inference service (OpenRouter, OpenAI, Anthropic, a local
  OpenAI-compatible runtime).
- Model = the selected model.
- Credential = provider authentication, owned by ResonantOS Provider Profiles.
- SDK manifest = declares requirements/intent, never raw secrets.
- Host = resolves grants/profile and injects only authorized credential material.

### Credential Modes

The harness `agentRuntime` adapter declares exactly one `credentialSource`:

- `provider-profile` — ResonantOS owns/resolves the credential. The manifest
  names a non-secret binding (`credentialBinding`) and forbids an `endpoint`;
  the host derives the endpoint and credential from the approved provider
  profile. The harness receives only the minimum runtime material for the
  authorized execution.
- `self` — the harness uses its own login/auth store (OpenCode). The host
  injects no credential; `authScheme` is `none` and no binding/endpoint may be
  declared.
- `none` — local/keyless runtime. `authScheme` is `none`; no binding may be
  declared.

Legacy manifests without `credentialSource` keep the reviewed `authScheme` +
`credentialBinding` + `endpoint` rules.

### Host-Owned Resolver

The resolver is `createHarnessCredentials` (in
`browser-first/host/harness-credentials.mjs`) with a third binding `source`
form, `source: { providerProfileId }`, resolved by an injected
`resolveProviderProfileCredential` dependency. A provider-profile binding maps
the non-secret binding name to `addonId + adapterId + authScheme +
providerProfileId`; the host looks the profile up in the same store the
provider fabric uses (`allProviderProfiles()` + `readProviderSecrets()`) and
returns a scoped lease with the profile's `apiBaseUrl` and the session
credential. The lease is redacted, sanitized, and disposed on the same reviewed
T6.1 path as env/file bindings.

The registry (`bindingAllowed`) requires a provider-profile binding to satisfy
only a `credentialSource: "provider-profile"` manifest, and an env/file binding
to satisfy only a legacy manifest. A manifest cannot self-grant a profile id:
the profile id lives only in host configuration, and the exact
add-on/adapter/scheme/binding-name match is still enforced.

### Persistence Boundary

Provider **credentials** remain session-only host memory (or process
environment), exactly as Augmentor's provider fabric already operates. Provider
**profile metadata** (provider type, models, `apiBaseUrl`) may persist in
`ResonantOS_User/ProviderFabric/provider-accounts.json` as today. This decision
does not add durable secret storage; durable encrypted secret persistence is the
next credential-vault milestone, not part of this decision.

### Migration Away From Transitional Pi credentialBinding

The transitional `openai-compatible-harness` example (env/file
`credentialBinding`) remains valid for the existing harness-adapter
certification and is not modified. The new `examples/addons/pi-harness.json`
demonstrates the target form: `credentialSource: "provider-profile"` with the
non-secret binding name and no endpoint. New provider-backed harnesses must use
`provider-profile`; the env/file binding remains available for DSH-style action
tokens and the transitional compatible adapter only.

### First-Class Harness Runtime Category

A future increment may add a first-class `harness` `runtimeType` and `category`
to the SDK manifest vocabulary. The current Alpha keeps harness manifests as
`local-service`/`ui-module` and enforces authority exclusively through the
harness registry, grant gate, and binding approval; adding a category label must
not become an alternate authority channel.

## Consequences

- One Settings → Providers credential serves Augmentor and Pi (and any other
  authorized provider-profile harness) without re-entry.
- The harness cannot enumerate or retrieve arbitrary stored credentials: the
  resolver is a scoped host lookup keyed by the approved profile id.
- Revoking a harness grant fences that harness's resolution while other
  authorized harnesses continue to resolve the shared profile.
- Raw secrets never appear in manifests, argv, logs, status projections, or test
  evidence; the credential never crosses the harness boundary beyond the scoped
  lease.
