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

ADR-042 established the declarative resource request contract but gave `skills`\n(and `tools`) no single backing capability in `HARNESS_RESOURCE_CAPABILITY`.\nADR-043 projected only the filesystem-backed families (`project`, `files`) and\nleft skills as Phase 2C. This decision closes that gap for `skills` without\ninventing a broad `skills` capability: authority flows through the existing\n`CapabilityGrant` records and the skill's own manifest metadata.

There is no separate ROS skills database/registry today. Skills are declared\ninline in reviewed add-on manifests via the SDK skill contract\n(`skills[]` → `AddOnSkillDefinition`), each referencing a host-owned\n`documentPath`. This decision therefore introduces the smallest host-owned\nsource abstraction necessary for projection (a host-injected catalog) and\nstates that limitation explicitly. `augmentorSkills` are first-party Strategist\noperating methods, not a harness skill source, and are excluded.

## Decision

### Core invariant (unchanged)

```
RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
```

- **Request** — the manifest `harnessResources.requests.skills` declaration of\n  possible consumption; never authority.
- **Grant** — host/user authority via the EXISTING `CapabilityGrant` records.
- **Projection** — session-specific material/access, bound to addon, session,\n  and authorized project identity, derived from request + existing grants +\n  the host-owned skill catalog.

### Skills authority model (no broad skills capability)

`skills` has no single backing capability; authority is resolved from existing\nhost grants and per-skill manifest metadata:

| Operation | Authority |
|---|---|
| `skills.list` | the harness session authority grant `agent-runtime` (reused; not invented) |
| `skills.read` | `skills.list` authority + a named, **eligible** skill |

- A skill's `requiredCapabilities` are descriptive metadata (what a skill needs\n  to RUN), never self-granting authority: the projection derives eligibility\n  only from granted capabilities and never mints a grant from skill metadata.
- Eligibility = every `requiredCapability` is granted. A skill with no\n  requirements is eligible whenever `agent-runtime` is granted.
- `list` authority does not imply `read`: read additionally requires the named\n  skill to be eligible and the `skills.read` operation to be requested.
- `read` does not imply `tools`/`shell`/`network`/`filesystem` authority, and a\n  projected skill cannot widen the session's capability grants (the public view\n  carries no capability authority).
- Unknown skill ids, malformed records, and ineligible skills fail closed.

### Canonical skill source

The host injects an authoritative, frozen `skillCatalog`. Records are derived\nfrom reviewed add-on manifests by `buildSkillCatalogFromManifests(manifests,\n{ sourceRoot })`, which maps each `skills[]` entry's `documentPath` to an\nabsolute source INSIDE the host-owned `sourceRoot` (absolute or lexically\nescaping paths are rejected). Each record carries `{ id, name, label,\ndescription, version, source, requiredCapabilities }`; `name` is validated\nagainst the Agent Skills name rule (1-64 lowercase-hyphen chars). `source` is\nhost-internal and never crosses the public view. This is the smallest host-owned\nsource abstraction; a canonical skills database does not yet exist.

### Host-owned staging root (CP-2C1.1)

**Staging base is injected by the host, never caller-supplied.**

- `createHarnessSkillsProjection` receives `stagingBase` (host-owned runtime base)\n  as a required parameter.
- Projection-specific staging path is derived as: `stagingBase/skills/<sessionId>`
- Caller cannot supply arbitrary staging root; this prevents path injection and\n  cleanup attacks.
- Each projection/session has a unique staging root derived from its sessionId.

**Rationale:** Prevents arbitrary path injection, ensures staging paths are\ncontained under a host-owned base, and enables targeted cleanup of only the\ncurrent projection's staging tree.

### Host-owned layout (CP-2C1.2)

**Layout is injected by the host, never caller-supplied.**

- `createHarnessSkillsProjection` receives `layout` as a parameter:
  ```
  { dir: ".pi/skills", file: "SKILL.md" }
  ```
- Default is Pi-native layout (`.pi/skills/<skill-name>/SKILL.md`).
- Synthetic harnesses may use alternate layouts (e.g., `synthetic/SKILL.yaml`) but\n  layout is ALWAYS host-injected, not manifest/caller-controlled.
- Materialization destination is computed as: `stagingRoot/layout.dir/skill.name/layout.file`

**Rationale:** Prevents manifests or callers from controlling materialization\ndestination; ensures all skills are materialized in a consistent, host-controlled\nlocation.

### Projection-owned cleanup (CP-2C1.3)

**`cleanup` now requires projection + currentContext, validates ownership before deletion.**

Signature change: `cleanup(projection, currentContext)` replaces `cleanup(stagingRoot)`.

Validation chain:
1. **Projection identity**: projection exists and has valid addonId/sessionId
2. **Identity matching**: projection.addonId === currentContext.addonId
3. **Authority check**: `agent-runtime` grant present in currentContext
4. **Catalog identity**: current catalog matches projection's catalog snapshot
5. **Eligibility match**: per-skill eligibility matches projection's snapshot
6. **Staging ownership**: derived stagingRoot is validated for:
   - Containment under host-owned `stagingBase`
   - Correct sessionId in path
   - No symlink escape
   - Not a forbidden root (/, ~, /home/*, skill source, project root, other sessions)
7. **Idempotent removal**: `rm` with force:true

Forbidden roots rejected:
- `/` (filesystem root)
- `process.env.HOME` (home directory)
- `/home/*` paths
- `skillSourceRoot` (canonical skill source)
- `stagingBase/skills/<other-session-id>` (other session's staging)
- `projectRoot` (external project root)

**Rationale:** Ensures only the projection owner can dispose the staging tree,\npreventing destructive operations on unauthorized paths.

### Materialization ownership (CP-2C1.4)

**Derive staging root from projection/session identity, not caller input.**

`planMaterializationImpl` and `materializeImpl` no longer accept `stagingRoot`\nor `layout` as parameters. Instead:

1. Staging root is derived: `stagingBase/skills/<sessionId>`
2. Destination is computed: `stagingRoot/layout.dir/skill.name/layout.file`
3. Both source and destination are validated with `pathContains` for symlink escape
4. Source must be under `skillSourceRoot`
5. Destination must be under `stagingBase`

**Rationale:** Caller cannot control staging destination; prevents path injection\nand ensures all materialization occurs within host-owned boundaries.

### Native projection mechanism

Pi consumes skills natively via the Agent Skills standard\n(`@earendil-works/pi-coding-agent@0.80.3` `docs/skills.md`): a skill is a\ndirectory containing `SKILL.md`, discovered under `~/.pi/agent/skills/`,\n`~/.agents/skills/`, `.pi/skills/`, or `.agents/skills/`. `materialize` stages a\nread-eligible skill into a disposable, host-owned staging root at\n`.pi/skills/<name>/SKILL.md` (Pi-native default; layout is an option). The\nstaged `SKILL.md` prepends host-owned `name`/`description` frontmatter to the\ncanonical body, is written mode `0o644` (no executable privilege), injects no\ncredential/secret, and never mutates the canonical source. Source and\ndestination are both validated symlink-aware (`pathContains`); the destination\nis always host-derived (never a manifest/caller path). `cleanup` disposes the\nstaging root idempotently. No process is launched in Phase 2C.

### Lifecycle and revocation

`consume` re-evaluates CURRENT authority. Deny (never silent in-place downgrade)\nwhen: addon/session/project identity differs; the `agent-runtime` session grant\nwas revoked; the requested∩granted operation set diverged; the catalog identity\nchanged (skill added/removed or `version`/`source`/`requiredCapabilities`\nchanged); or per-skill eligibility flipped (a required capability granted or\nrevoked). All require a fresh projection.

## Consequences

- `skills` is projected generically: the same seam serves Pi and a synthetic\n  non-Pi harness with no `addon.pi-harness` branching.
- Skills authority never introduces a broad `skills` capability and never\n  widens a session's grants.
- No Memory, ROS tool invocation, provider/model change, credential change,\n  process spawn, PTY/terminal, arbitrary manifest destination, or unrestricted\n  filesystem API is introduced.
- The materialization planner is tested (source/destination symlink escape,\n  no-exec-bit, source immutability, disposal) but is not yet wired to a running\n  harness launch — that is later work, out of 2C scope.
- **Staging ownership is enforced**: caller cannot supply arbitrary paths;\n  cleanup is projection-scoped and validated against host-owned staging base;\n  forbidden roots are rejected.
