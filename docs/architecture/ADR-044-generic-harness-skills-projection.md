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

### Session projection shape

`createHarnessSkillsProjection({ authorizedProject, skillCatalog,
skillSourceRoot, listCapability })` returns:

- `project({ addonId, sessionId, request, grantedCapabilities })` — denies
  (`no-skills-request`, `skills-not-authorized`) or issues a projection.
- `consume(...)` — re-evaluates CURRENT authority (identity, session grant,
  operation set, catalog identity, eligibility) and denies
  `projection-identity-mismatch` / `skills-not-authorized` / `projection-stale`.
- `publicView` / `listSkills` — safe metadata only: identity
  (`id`/`name`/`label`/`description`/`version`) + `status`
  (`eligible`/`unavailable`). No source path, credential, requiredCapabilities,
  backing grant, or command.
- `readSkill` / `planMaterialization` / `materialize` / `cleanup` — host-internal
  read/materialization boundary (never exported to add-ons).

The internal projection snapshot carries the request authority basis, the
`agent-runtime` grant snapshot, the catalog (including source paths), and the
eligibility map — none of which cross the public view.

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
