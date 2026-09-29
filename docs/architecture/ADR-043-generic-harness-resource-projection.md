# ADR-043: Generic Harness Resource Projection (Project + Files)

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Core and add-ons
- Decision date: 2026-09-29
- Alpha note: This decision ships the first real Generic Harness Resource
  Projection: an authorized ROS project → bounded session Project/Files
  projection. It projects ONLY the `project` and `files` families. Skills,
  Memory, ROS tool invocation, User Profile, DAR, Map, MCP, Pi credential
  P2/live inference, process spawn, PTY, and embedded/external terminals are
  NOT implemented by this decision (Skills is Phase 2C).

## Context

ADR-042 established the declarative resource request contract and the
request/grant/projection type seam, but explicitly implemented no projection.
The `filesystem` `CapabilityGrant` is coarse: it answers WHAT KIND of authority
(filesystem) and, without a projection, could be read as unrestricted
filesystem authority. A bounded session needs WHERE (which project), WHICH
OPERATIONS (the requested ∩ granted subset), and FOR THIS SESSION (identity
binding). This decision closes that gap for the two filesystem-backed families
(`project`, `files`).

## Decision

### Core invariant (unchanged)

```
RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
```

- **Request** — a manifest declaration of possible consumption; never authority.
- **Grant** — host/user authority, expressed through the EXISTING
  `CapabilityGrant` records. Capability answers WHAT KIND of authority.
- **Projection** — session-specific material/access. It answers WHERE (the
  authoritative project root), WHICH OPERATIONS (requested ∩ granted), and FOR
  THIS SESSION (identity). A projection is derived from request + existing grant
  + authoritative host project root, and can never widen the grant.

### Authoritative project/root source

The projection never creates a second project registry and never accepts a root
from the manifest, request, or caller. The host injects a single authoritative
`authorizedProject = { id, label, root }`. In the Alpha bridge, `root` is the
host-derived repository root (`repoRoot` in `run-bridge-minimal.mjs`), realpath
canonicalized before any containment decision. The projection module validates
that root against the repo convention (absolute, existing, canonicalizable
directory; not `/`, not home, not an ancestor of home) and refuses otherwise.

### Operation subset (independent enforcement)

Each operation is projected independently; the projection derives the
requested ∩ granted subset and never infers authority:

| Operation | Required |
|---|---|
| `project.read` | requested `project.read` + filesystem grant |
| `project.context` | requested `project.context` + filesystem grant |
| `files.read` | requested `files.read` + filesystem grant |
| `files.write` | requested `files.write` + filesystem grant |

Read never implies write and write never implies read. No delete, execute, or
shell operation exists. No grant ⇒ no projection; an unrequested operation is
structurally absent. Skills/memory/tools requests are not projected (Phase 2C+).

### Session projection shape

The host-owned internal projection (`HarnessSessionProjection`) carries
addon/session/project identity, the internal authorized absolute `root`/`cwd`,
the granted operation subset, and a snapshot of the backing filesystem grant.
It never carries a credential, provider, model, executable, or command. A safe
public view (`HarnessSessionProjectionView`) exposes only identity, operation
names, and projection state — internal absolute paths remain private.

### Containment

Root containment reuses the canonical symlink-aware path containment primitive
(`addons/resonant-browser-host/src/lib/path-contains.mjs`). Fail closed against:
`..` traversal, caller-supplied alternate absolute roots, sibling project access,
symlink-out escapes, NUL/newline path confusion, invalid/nonexistent roots, and
project identity mismatch. Canonicalize (realpath) before containment decisions.
No arbitrary-path resolution is exposed to manifests; the containment helper is
host-internal.

### Lifecycle and revocation

A projection is bound to add-on identity, session identity, authoritative
project identity, and current grant state. A revoked filesystem grant prevents
NEW projections and blocks reuse of an issued projection; a disabled/unbound/
wrong harness cannot create or reuse one; Session A's projection is never
reusable as Session B; a project change requires a fresh projection.

## Consequences

- The `filesystem` grant no longer implies unrestricted filesystem authority: a
  session receives only the bounded Project/Files projection for one authorized
  project.
- Projection is generic: the same seam projects Pi and a synthetic read-only
  terminal harness with no Pi-specific branch.
- No Skills, Memory, ROS tool invocation, provider/model change, credential
  change, process spawn, PTY/terminal, arbitrary manifest path, shell/execute
  operation, or unrestricted filesystem API is exported to add-ons.
- 2C (Skills) remains future; this decision does NOT claim full Resource
  Projection is complete.
