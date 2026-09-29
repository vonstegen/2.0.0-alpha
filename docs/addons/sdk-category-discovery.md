# SDK Category Discovery — AI Developer Guide

An AI coding harness can describe what kind of add-on it is building and receive
the applicable SDK contracts, surfaces, security guidance, templates, examples,
and tests — without ingesting the whole ResonantOS repository.

## Ask the SDK

```bash
node scripts/resonant-sdk.mjs describe-category harness
node scripts/resonant-sdk.mjs describe-category harness --subtype coding-agent --compact
node scripts/resonant-sdk.mjs list-categories
```

Or the library API (Node, TypeScript type-stripping):

```js
import { describeCategory } from "./packages/addon-sdk/src/category-registry.ts";
const kit = describeCategory("tool", { subtype: "utility" });
```

Output is deterministic JSON (`resonant-sdk/category-description/v1`) with:

- `purpose` — what the category is
- `requiredManifestFields` / `optionalManifestFields`
- `recommendedRuntimeFamilies` — HOW (orthogonal, never enforced)
- `recommendedSurfaces` — WHERE (never granted)
- `eligibleSystemSlots` — WHAT role (never granted)
- `providerCredentialOptions` — inference/auth modes
- `securityInvariants`
- `sdkModules`, `templates`, `examples`, `testSuites`, `docs` — each with
  truthful `implemented`/`planned` status

## The six dimensions (never conflate them)

| Dimension | Field | Meaning |
|---|---|---|
| Classification | `classification` | WHAT it is (identity/type) |
| Runtime | `runtimeType` | HOW it executes |
| Surfaces | `surfaces` | WHERE it appears |
| Capabilities | `requestedCapabilities` | WHAT authority it requests |
| System slots | `systemSlots` | WHAT ResonantOS role it may occupy |
| Provider/credential | `agentRuntime.credentialSource` + `harnessProviderConnection` | WHAT inference/auth it needs and which provider families it can consume |

Classification never grants authority. A harness may be CLI or local-service;
runtime is orthogonal.

## Generic Harness Provider Connection

A harness that consumes ROS Provider Profiles declares a descriptive
`harnessProviderConnection` block. It is metadata/status only and grants no
provider access:

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

- `consumesProviderProfiles` — whether the harness consumes ROS Provider
  Profiles via host mediation.
- `providerProtocols` — compatible protocol/API families from the canonical
  `ProviderProtocolFamily` vocabulary (`openai-compatible`,
  `minimax-compatible`, `ollama`); descriptive, never grants access to a
  profile. Provider identity/type (`ProviderType`) is a separate concept from
  protocol/API compatibility.
- `credentialDelivery` — supported delivery mechanisms in host preference order:
  `runtime-adapter`, `session-environment`, `self-auth`, `none`. Only
  `runtime-adapter` is implemented in the Alpha; declaring an unsupported-only
  list fails closed.
- `modelSelection` — whether the harness supports host-mediated model selection.

Host-owned discovery returns ONLY profiles/models compatible with the specific
installed/enabled/authorized harness and its declared `providerProtocols`; a
harness never enumerates raw credentials or arbitrary provider secrets.
Declaring an incompatible family is rejected at resolution, not just discovery.

## Minimal compliant manifest

A manifest needs the universal core — `id`, `name`, `version`, `author`,
`classification`, `description`, `runtimeType`, `surfaces`,
`requestedCapabilities`, `providerRequirements`, `archiveIntegration`, `health`,
`installHooks`, `compatibility`:

```jsonc
{
  "id": "addon.tool-utility",
  "classification": { "category": "tool", "subtype": "utility" },
  "surfaces": [
    { "id": "utility-tool-panel", "type": "tool-panel", "label": "Utility",
      "icon": "utility", "requiredCapabilities": [] }
  ]
  // no agentRuntime, no systemSlots, no provider-profile
}
```

A `tool-panel` surface appears in the right rail only when the add-on is
installed + enabled + authorized. `icon` is a safe kebab-case identifier, never a
path/URL/markup. `requiredCapabilities` must already be declared in
`requestedCapabilities` — a surface request can never self-grant.

## Generic Harness Resource Request

A harness that consumes ROS resources declares a descriptive
`harnessResources` block. It states possible resource consumption and grants
no access:

```jsonc
{
  "harnessResources": {
    "requests": {
      "project": ["read", "context"],
      "files": ["read", "write"],
      "skills": ["list", "read"],
      "memory": ["search", "read"],
      "tools": ["list", "invoke"]
    }
  }
}
```

- Initial resource families/operations: `project` (`read`, `context`), `files`
  (`read`, `write`), `skills` (`list`, `read`), `memory` (`search`, `read`),
  `tools` (`list`, `invoke`).
- `RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION`: a request
  declares possible need and never grants authority; grants are host-owned
  `CapabilityGrant` records; projection adapters are Phase 2B+ and are **not
  yet implemented**.
- Provider Connection (`harnessProviderConnection`) remains separate; provider/
  model is never declared inside `harnessResources`.
- The block is category-gated to `harness`; unknown families/operations and
  ungranted resources fail closed.

Do not treat resource access as complete: Phase 2A ships the contract,
validation, and the type seam only.

## Reference add-ons

- `examples/addons/pi-harness.json` — `harness`/`coding-agent`, provider-profile via `harnessProviderConnection` (openai-compatible family, runtime-adapter delivery)
- `examples/addons/tool-utility.json` — `tool`/`utility`, no privileged authority

## Security invariants

- request describes intent; host determines authority
- classification describes identity/type, not authority
- first-party does not imply privileged
- no manifest self-grant
- no raw secret in manifest/argv/log/status
- provider profile resolution remains host-owned and scoped
- surface request does not imply surface grant
- no arbitrary HTML/script/command surface injection
- host controls supported surface renderer types
- disabled/revoked/uninstalled add-ons cannot retain active privileged surface behavior
- category/subtype values cannot bypass capability/runtime validation
- unknown category/subtype behavior is deterministic/fail-closed where authority is concerned
