# ADR-044: Generic Harness Skills Projection

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-29
- Alpha note: This decision ships the Skills resource family projection: a
  host-owned session view of ROS-owned skills plus a disposable, host-owned
  Pi-native materialization planner. It projects ONLY `skills`. Memory, ROS tool
  invocation, User Profile, DAR, Map, MCP, process spawn, PTY/terminal, and live
  inference remain NOT implemented by this decision.

## Context

ADR-042 established the declarative resource request contract but gave `skills`
(and `tools`) no single backing capability in `HARNESS_RESOURCE_CAPABILITY`.
ADR-043 projected only the filesystem-backed families (`project`, `files`) and
left skills as Phase 2C. This decision closes that gap for `skills` without
inventing a broad `skills` capability: authority flows through the existing
`CapabilityGrant` records and the skill's own manifest metadata.

There is no separate ROS skills database/registry today. Skills are declared
inline in reviewed add-on manifests via the SDK skill contract
(`skills[]` → `AddOnSkillDefinition`), each referencing a host-owned
`documentPath`. This decision therefore introduces the smallest host-owned
source abstraction necessary for projection (a host-injected catalog) and
states that limitation explicitly. `augmentorSkills` are first-party Strategist
operating methods, not a harness skill source, and are excluded.

## Decision

### Core invariant (unchanged)

```
RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
```

- **Request** — the manifest `harnessResources.requests.skills` declaration of
  possible consumption; never authority.
- **Grant** — host/user authority via the EXISTING `CapabilityGrant` records.
- **Projection** — session-specific material/access, bound to addon, session,
  and authorized project identity, derived from request + existing grants +
  the host-owned skill catalog.

### Skills authority model (no broad skills capability)

`skills` has no single backing capability; authority is resolved from existing
host grants and per-skill manifest metadata:

| Operation | Authority |
|---|---|
| `skills.list` | the harness session authority grant `agent-runtime` (reused; not invented) |
| `skills.read` | `skills.list` authority + a named, **eligible** skill |

- A skill's `requiredCapabilities` are descriptive metadata (what a skill needs
  to RUN), never self-granting authority: the projection derives eligibility
  only from granted capabilities and never mints a grant from skill metadata.
- Eligibility = every `requiredCapability` is granted. A skill with no
  requirements is eligible whenever `agent-runtime` is granted.
- `list` authority does not imply `read`: read additionally requires the named
  skill to be eligible and the `skills.read` operation to be requested.
- `read` does not imply `tools`/`shell`/`network`/`filesystem` authority, and a
  projected skill cannot widen the session's capability grants (the public view
  carries no capability authority).
- Unknown skill ids, malformed records, and ineligible skills fail closed.

### Canonical skill source

The host injects an authoritative, frozen `skillCatalog`. Records are derived
from reviewed add-on manifests by `buildSkillCatalogFromManifests(manifests,
{ sourceRoot })`, which maps each `skills[]` entry's `documentPath` to an
absolute source INSIDE the host-owned `sourceRoot` (absolute or lexically
escaping paths are rejected). Each record carries `{ id, name, label,
description, version, source, requiredCapabilities }`; `name` is validated
against the Agent Skills name rule (1-64 lowercase-hyphen chars). `source` is
host-internal and never crosses the public view. This is the smallest host-owned
source abstraction; a canonical skills database does not yet exist.

### Host-owned staging root (opaque binding identity)

**Staging base is injected by the host, never caller-supplied.**

- `createHarnessSkillsProjection` receives `stagingBase` (host-owned runtime base)
  as a required parameter.
- Projection-specific staging identity is a host-derived opaque digest of the full
  session binding: `deriveStagingIdentity(addonId, sessionId, projectId)` =
  `SHA-256(addonId + NUL + sessionId + NUL + projectId)`, rendered as fixed
  lowercase hex (standard Node crypto only).
- Projection-specific staging path is derived as: `stagingBase/skills/<opaque-digest>`.
  No raw caller/session/project string is ever used as a filesystem path component.
- Caller cannot supply arbitrary staging root; this prevents path injection and
  cleanup attacks.
- Distinct bindings (addon + session + project) yield distinct staging roots; the
  same binding deterministically yields the same staging root for its lifecycle.

**Rationale:** Prevents arbitrary path injection, ensures staging paths are
contained under a host-owned base, makes traversal/absolute/slash/dot/unicode
session values inert, and enables targeted cleanup of only the current
projection's staging tree.

### Host-owned layout (CP-2C1.2)

**Layout is injected by the host, never caller-supplied.**

- `createHarnessSkillsProjection` receives `layout` as a parameter:
  ```
  { dir: ".pi/skills", file: "SKILL.md" }
  ```
- Default is Pi-native layout (`.pi/skills/<skill-name>/SKILL.md`).
- Synthetic harnesses may use alternate layouts (e.g., `synthetic/SKILL.yaml`) but
  layout is ALWAYS host-injected, not manifest/caller-controlled.
- Materialization destination is computed as: `stagingRoot/layout.dir/skill.name/layout.file`

**Rationale:** Prevents manifests or callers from controlling materialization
destination; ensures all skills are materialized in a consistent, host-controlled
location.

### Projection-owned cleanup (CP-2C1.3)

**`cleanup` now requires projection + currentContext, validates ownership before deletion.**

Signature change: `cleanup(projection, currentContext)` replaces `cleanup(stagingRoot)`.

Validation chain:
1. **Projection identity**: projection exists and has valid addonId/sessionId
2. **Identity matching**: projection.addonId === currentContext.addonId,
   projection.sessionId === currentContext.sessionId, and
   projection.project.id === currentContext.authorizedProject.id
3. **Authority check**: `agent-runtime` grant present in currentContext
4. **Catalog identity**: current catalog matches projection's catalog snapshot
5. **Eligibility match**: per-skill eligibility matches projection's snapshot
6. **Staging identity derivation**: derive the opaque staging identity from THIS
   projection's binding (addonId + sessionId + projectId), never from caller input
7. **Exact structural ownership**: canonical owned staging path === canonical
   expected staging path (never a substring/prefix identity test), and that exact
   path is strictly contained under `stagingBase/skills`
8. **Protected roots**: reject exact equality with filesystem root `/`, actual
   home root, authorized project root, canonical skill source root, and
   `stagingBase` itself
9. **Symlink escape**: read-only symlink-resolved containment must not redirect
   outside the owned staging tree
10. **Idempotent removal**: `rm` of ONLY that exact owned tree with `force:true`

Protected roots rejected (exact equality only, never blanket prefix/substring):
- `/` (filesystem root)
- `process.env.HOME` (home directory itself — sub-paths under the home directory,
  e.g. a host-owned state dir under `/home/<user>/...`, remain allowed when
  structurally contained and not equal to a protected root)
- `skillSourceRoot` (canonical skill source)
- `stagingBase` (host staging base itself)
- `projectRoot` (authorized project root, when provided)

**Rationale:** Ensures only the projection owner can dispose the staging tree,
preventing destructive operations on unauthorized paths. Ownership is structural
and exact; no raw session identity is used as a path component and no blanket
`/home` rejection is applied.

### Materialization ownership (CP-2C1.4)

**Derive staging root from projection/session identity, not caller input.**

`planMaterializationImpl` and `materializeImpl` no longer accept `stagingRoot`
or `layout` as parameters. Instead:

1. Staging root is derived from the projection's opaque binding identity:
   `stagingBase/skills/<opaque-digest>` (the SAME root as cleanup)
2. Destination is computed: `stagingRoot/layout.dir/skill.name/layout.file`;
   the validated skill name is the only skill-derived path component, and dir/file
   are host-injected layout
3. Both source and destination are validated with `pathContains` for symlink escape
4. Source must be under `skillSourceRoot`
5. Destination must be strictly inside THIS projection's owned staging root
   (never equal to it, and not merely somewhere under `stagingBase`)

**Rationale:** Caller cannot control staging destination; prevents path injection
and ensures all materialization occurs within host-owned boundaries.

### Native projection mechanism

Pi consumes skills natively via the Agent Skills standard
(`@earendil-works/pi-coding-agent@0.80.3` `docs/skills.md`): a skill is a
directory containing `SKILL.md`, discovered under `~/.pi/agent/skills/`,
`~/.agents/skills/`, `.pi/skills/`, or `.agents/skills/`. `materialize` stages a
read-eligible skill into a disposable, host-owned staging root at
`.pi/skills/<name>/SKILL.md` (Pi-native default; layout is an option). The
staged `SKILL.md` prepends host-owned `name`/`description` frontmatter to the
canonical body, is written mode `0o644` (no executable privilege), injects no
credential/secret, and never mutates the canonical source. Source and
destination are both validated symlink-aware (`pathContains`); the destination
is always host-derived (never a manifest/caller path). `cleanup` disposes the
staging root idempotently. No process is launched in Phase 2C.

### Lifecycle and revocation

`consume` re-evaluates CURRENT authority. Deny (never silent in-place downgrade)
when: addon/session/project identity differs; the `agent-runtime` session grant
was revoked; the requested∩granted operation set diverged; the catalog identity
changed (skill added/removed or `version`/`source`/`requiredCapabilities`
changed); or per-skill eligibility flipped (a required capability granted or
revoked). All require a fresh projection.

## Consequences

- `skills` is projected generically: the same seam serves Pi and a synthetic
  non-Pi harness with no `addon.pi-harness` branching.
- Skills authority never introduces a broad `skills` capability and never
  widens a session's grants.
- No Memory, ROS tool invocation, provider/model change, credential change,
  process spawn, PTY/terminal, arbitrary manifest destination, or unrestricted
  filesystem API is introduced.
- The materialization planner is tested (source/destination symlink escape,
  no-exec-bit, source immutability, disposal) but is not yet wired to a running
  harness launch — that is later work, out of 2C scope.
- **Staging ownership is enforced**: caller cannot supply arbitrary paths;
  cleanup is projection-scoped and validated against host-owned staging base;
  forbidden roots are rejected.
