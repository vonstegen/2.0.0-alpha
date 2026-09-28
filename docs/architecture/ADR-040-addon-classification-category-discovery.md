# ADR-040: Add-on Classification, Category Registry, And Dynamic Surface Discovery

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-28
- Alpha note: The classification registry, category discovery, and dynamic
  tool-panel surface routing ship with this decision. `classification` is the
  single canonical classification contract; the legacy top-level `category`
  field and its closed enum were removed (SDK-CATEGORY-001A) and are not
  advisory compatibility state.

## Context

Add-on manifests described *what* an add-on was with a coarse, closed `category`
enum (`agent`, `tool`, `channel`, ...) that mixed identity with runtime, surface,
capability, slot, and provider concerns. A developer or AI coding harness had to
ingest the whole repository to know which SDK contracts, surfaces, security
profiles, templates, and tests apply to a given kind of add-on. The right-hand
tool rail could not be built dynamically: every tool entry would have to be
hard-coded (Pi, OpenCode, Claude, ...), which is a maintenance and security
anti-pattern.

## Decision

### Six Orthogonal Dimensions

These are explicitly NOT conflated:

1. **Classification** — WHAT is the add-on? (`classification.category` + `classification.subtype`)
2. **Runtime** — HOW does it execute? (`runtimeType`)
3. **Surfaces** — WHERE does it appear? (`surfaces`)
4. **Capabilities** — WHAT authority does it request? (`requestedCapabilities`)
5. **System slots** — WHAT ResonantOS role may it occupy? (`systemSlots`)
6. **Provider/credential** — WHAT inference/auth resources does it need? (`agentRuntime.credentialSource`)

Classification describes identity/type and **never** grants authority by
itself. Runtime is orthogonal: a harness may be CLI, local-service, or
ui-module; classification never forces a runtime.

### Manifest Shape

```jsonc
{
  "classification": { "category": "harness", "subtype": "coding-agent" },
  "runtimeType": "local-service",
  "surfaces": [
    { "id": "pi-tool-panel", "type": "tool-panel", "label": "Pi", "icon": "pi",
      "requiredCapabilities": ["agent-runtime"] },
    { "id": "pi-workspace", "type": "workspace", "label": "Pi Workspace",
      "requiredCapabilities": ["agent-runtime"] }
  ]
  // ...
}
```

`classification` is REQUIRED on every manifest and `classification.category` is
validated against the extensible category registry
(`packages/addon-sdk/src/category-registry.ts`); a missing or unknown category
fails validation. `classification.subtype` is an open string — no global
exhaustive subtype enum is required. There is no legacy top-level `category`
field; classification is the single canonical contract.

### Category Registry

Seven minimum categories: `harness`, `tool`, `connector`, `communication`,
`data-source`, `ui`, `service`. Each descriptor states (does not grant):

- recommended runtime families (never enforced)
- recommended surfaces (never granted)
- eligible system slots (never granted)
- relevant SDK modules, with truthful `implemented`/`planned` status
- relevant security profiles/invariants
- reference templates, examples, test suites, documentation paths
- known subtypes (open, advisory)

### Machine Discovery

`resonant-sdk describe-category <category>` (`node scripts/resonant-sdk.mjs`)
and the library API `describeCategory()` return deterministic JSON
(`resonant-sdk/category-description/v1`) suitable for AI-harness consumption.
`harness` and `tool` return demonstrably different kits: harness exposes
primary-agent eligibility + provider-profile + harness execution; tool exposes
none of those.

### Dynamic Tool Rail

A `tool-panel` surface becomes a right-rail entry only when the add-on is
**installed + enabled + authorized** (every `requiredCapabilities` granted), and
the surface is not hidden. Classification alone never creates an entry; the
manifest must still explicitly request the surface and the host must still
validate/grant/authorize it. No add-on id is hard-coded in the rail. The host
owns rendering (textContent only, no arbitrary HTML/script injection).

## Consequences

- Classification spoofing, unknown categories, surface spoofing (unsafe icon),
  and slot/provider escalation all fail closed (validated + tested).
- Disabling/revoking/removing an add-on drops its rail entry on the next
  projection refresh.
- The legacy `category` enum and top-level manifest field were removed
  (SDK-CATEGORY-001A). Every valid manifest MUST declare `classification`;
  there is no fallback to the removed legacy vocabulary.
