# ADR-051: ROS Architecture Blueprint (G0-ROS Core + Add-on Boundary)

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Applies
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-08-26

## Decision

G0-ROS (Ground-0 ResonantOS) is a **fused core** plus **pluggable add-ons**. The
fused core is shipped by the ROS dev team and cannot be separated or removed;
add-ons plug in at the add-on boundary, which is the *only* separable boundary.

This blueprint extends ADR-018 (Add-on SDK V0) with the architecture model
that the SDK encodes.

This blueprint is the single source of truth for what G0-ROS is, what an
add-on is, and how the two relate. It is encoded, consumed, and validated in
`src/sdk/addons/architecture.ts` (with a plain-`.mjs` host mirror), so an
add-on author's manifest is checked against the *correct* architecture rather
than an ad-hoc shape.

## The Blueprint

### Vocabulary

The taxonomy. "Agent = model + harness." Anything that is not the model is
either the **harness** (the agent's runtime) or the **shell** (the platform).

| Term | Definition |
|---|---|
| shell | The runtime and control plane: hosts workspaces and the fused core (integrated harness + system memory + recovery), the global harness/add-on registry, auth, and cross-workspace orchestration. Not itself a harness or an add-on. |
| harness | The runtime scaffolding around a model: loop, tools, state, context, controls, memory/session persistence. |
| agent | A model plus its harness — the thing that acts. |
| tool | A discrete capability. |
| orchestrator | Coordinates multiple agents. |
| project | The unit of work inside a workspace: files/build targets/deliverable, active agent configuration, project-scoped tools/skills/add-ons, private working memory, sandbox/permission profile. |
| workspace | The higher-level container and isolation boundary: groups projects and holds what they share — registered harnesses, shared tools/memory, provider/model configs, permission defaults. A domain boundary (a client, a line of business, a research area). |
| memory | State and context persistence. Working memory belongs to the harness; system memory and the recovery return point belong to the shell. |

### Scoping hierarchy

Shell → Workspace → Project. Each level owns a different slice of the resource
surface and adds an isolation boundary; deeper levels inherit from shallower
ones. Harnesses register once at shell/workspace level; projects activate or
mount the ones they need rather than re-registering them.

| Level | Owns |
|---|---|
| **Shell** | Fused core (integrated harness + system memory + recovery), global harness/add-on registry, auth, cross-workspace orchestration. |
| **Workspace** | Registered harnesses, shared tools, shared memory, provider/model configs, permission defaults. |
| **Project** | Active agent configuration, project-scoped tools/skills/add-ons, private working memory, file mounts, sandbox rules. |

### The fused core (non-removable, always-on)

```
G0-ROS core = shell (sections) + integrated harness + system memory + recovery
```

- **Shell sections** (`CoreSectionId`): overview, strategist, archive,
  delegation, compute, addons, settings. Always present.
- **Integrated harness**: the shell's own agent (model + harness). Its display
  name is user-owned via personalization; the role is fixed and non-removable.
  It is fused to the shell — not a plug-in, not even a bundled add-on.
- **System memory** (`GoalMemoryRefKind: "system-memory"`): the shell's
  self-structure (System Architecture Memory), cited by delegation and injected
  into the agent's context.
- **Recovery** (`recoverySession` / `lastNormalThreadId`): the crash-recovery
  return point, driven by a local-model engineer agent so it works even when
  external providers are down.

### The add-on boundary (the only separable boundary)

An add-on plugs into the fused core via `surfaces`, `tools`, `capabilities`,
and `systemSlots`. Add-ons can be lost without losing the system; the core
cannot.

### Ground-0 invariant

> The fused core is self-sufficient: strip away every add-on and external
> provider, and the remaining shell + integrated harness + system memory +
> recovery restores to a known-good state. **Ground-0 = base = fallback.**

### Category → rail destination

`category` is *what an add-on is*; it decides the rail destination.
`runtimeType` is *how an add-on runs*; it never decides the destination.

| Category | What it is | Rail destination |
|---|---|---|
| `agent` | an agent (model + harness) you open into | own top-level harness menu |
| `memory` | a memory provider filling the `memory-system` slot | Memory menu |
| `channel` / `security` / `knowledge` / `tool` / `integration` / `orchestration` | everything else | Tools menu |

### Runtime type (orthogonal to category)

`runtimeType` is *how an add-on runs*; it is orthogonal to `category` (*what
an add-on is*) and never decides the rail destination. A memory add-on may run
behind the agent-delegation interface (R-Awareness: `agent-addon` + `memory`),
just as an agent may run as an embedded module (OpenCode: `embedded-module` +
`agent`).

## Why

Without a single blueprint, the SDK's types, the manifest validation, and the
rail layout drift apart. The taxonomy (shell vs harness vs agent), the fused
core, the category → rail-destination mapping, and the Ground-0 invariant would
each be re-derived ad hoc. Encoding them once — and consuming that declaration
from the resolver and the validator — keeps the manifest shape, the rail
layout, and the recovery fallback consistent with one architecture.

## Rules

- The fused core is non-removable and always on; it is not an add-on and not a
  `bundled-core` add-on (that tier is for shipped add-ons such as Living
  Archive).
- The add-on boundary is the only separable boundary.
- `category` (what it is) decides the rail destination; `runtimeType` (how it
  runs) does not. The two axes are orthogonal: neither implies the other.
- The canonical mapping lives in `src/sdk/addons/architecture.ts`; the host
  mirror in `browser-first/host/addon-delegation-service.mjs` must stay in sync.

## G0 harness tool loop

The fused core's integrated harness ships a *minimal* tool loop — only what it
needs to serve Ground-0 operation, not the full native-tool surface (37
`NativeToolCapability` entries, which also span the shell's platform functions).

`G0_HARNESS_TOOL_CATALOG` (13 entries) is the harness's own loop: `research.*`
(2), `browser.session`, `filesystem.*` (3), `process.safe_command`, `provider.*`
(2), `archive.*` (3), and `delegation.create_packet`. Excluded: `addon.*`
(shell add-on management), `runner.*` (compute fabric), and the remaining
`delegation.*` (orchestrator mechanics). Bundled add-ons such as RecursiveMAS
are add-ons, not part of the fused harness.

## ROS Harness rail menu + native-tool supersede

The shell leads the rail with a fused-core `ros-harness` menu (kind `harness`,
always first) listing that tool loop. An add-on tool may declare
`coversNativeTool: <NativeToolCapability>` to claim equivalence to a G0 tool;
when the add-on is installed and enabled, that G0 tool is flagged
`supersededBy` and grayed out in the rail (still visible, de-emphasized). This
is the *allowed* form of native-tool takeover — ADR-050's reserved-name
shadowing stays forbidden; equivalence is declared, not shadowed.

The resolver (`createRosHarnessMenu` / `createShellRailMenus`), the host mirror,
and the validator (`tool-covers-native-invalid`) all consume
`G0_HARNESS_TOOL_CATALOG` and `NativeToolCapability`.
