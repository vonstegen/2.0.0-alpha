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
| Provider/credential | `agentRuntime.credentialSource` | WHAT inference/auth it needs |

Classification never grants authority. A harness may be CLI or local-service;
runtime is orthogonal.

## Minimal compliant manifest

A manifest needs (beyond the universal core — `id`, `name`, `version`, `author`,
`category`, `description`, `runtimeType`, `surfaces`, `requestedCapabilities`,
`providerRequirements`, `archiveIntegration`, `health`, `installHooks`,
`compatibility`):

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

## Reference add-ons

- `examples/addons/pi-harness.json` — `harness`/`coding-agent`, provider-profile
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
