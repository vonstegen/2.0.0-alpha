# ADR-042: Generic Harness Resource Request Contract

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-29
- Alpha note: This decision ships the declarative `harnessResources` manifest
  contract, its validation, and the request/grant/projection type seam. It is
  the schema/contract foundation for Phase 2 Resource Projection. It implements
  NO resource access, projection adapter, or session material: those are Phase
  2B+.

## Context

A harness add-on (Pi, Hermes, Grok Build, Claude Code, Gemini CLI, Codex-class)
needs to declare which ResonantOS resources it *may* consume during a session —
the project workspace, files, skills, memory, and tools — so the host can plan,
review, and (in later phases) project only the granted subset. Until now there
was no generic vocabulary for that declaration: `requestedCapabilities`
expresses capability authority, `harnessProviderConnection` expresses provider
compatibility, and neither expresses *which resources a session needs*.

## Decision

### Core invariant

```
RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
```

- **Request** — a manifest declaration of *possible* resource consumption. It
  never grants authority.
- **Grant** — host/user authority, expressed through the EXISTING
  `CapabilityGrant` records (`registry.grantedCapabilities`). No competing
  grant system is introduced.
- **Projection** — session-specific material/access. Phase 2B+; this decision
  types the seam only.

### Contract (descriptive, never authority)

A harness may declare a `harnessResources` block:

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

Initial Phase 2 resource families and their finite operation vocabularies:

| Family | Operations |
|---|---|
| `project` | `read`, `context` |
| `files` | `read`, `write` |
| `skills` | `list`, `read` |
| `memory` | `search`, `read` |
| `tools` | `list`, `invoke` |

A request names allowlisted operations only. It may never carry:

- arbitrary filesystem paths;
- credential fields or env-variable names;
- command strings or arbitrary tool executable names;
- raw tool command declarations;
- provider/model declarations (those stay under `harnessProviderConnection`).

### Category gating

`harnessResources` is category-gated to the `harness` category. A resource
declaration on any other category is rejected by validation and is never
elevated into an authority channel.

### Grant reuse

Resource authority is expressed through the existing `CapabilityGrant`
vocabulary. The SDK provides a pure authority mapping
(`HARNESS_RESOURCE_CAPABILITY`) from family to backing capability where a
clean capability exists:

- `project` → `filesystem`
- `files` → `filesystem`
- `memory` → `archive-read`

`skills` and `tools` have no single backing capability; their authority flows
through the manifest's own skill/tool `requiredCapabilities` and is resolved in
Phase 2B+. Families without a backing capability, and any operation whose
backing capability is absent or denied, fail closed.

## Consequences

- The contract is orthogonal to classification (ADR-046), capability, and
  provider (ADR-041); it is descriptive and grants nothing.
- Validation bounds the block to `requests` + the five families + finite
  operation vocabularies and rejects unknown fields, so no credential/endpoint/
  executable/path channel can ride through it.
- Unknown families/operations and ungranted resources fail closed.
- No filesystem IO, memory invocation, tool execution, skill copying, process
  spawn, PTY, or provider/model change is introduced by this decision.
