# HARNESS-RESOURCE-PROJECTION-RND-001

## Generic ROS Resource Projection for Harness Add-ons

A harness consumes a governed **session projection** of ROS resources. Classification is descriptive; resource declarations are requests; the host remains authority.

### Flow

Harness request -> ROS Resource Broker -> identity/grants/project/policy/availability -> Session Resource Projection -> Harness Provisioner -> Pi.

### Initial resource families

**Provider:** compatible Provider Profile/model metadata plus scoped credential delivery. Never raw credential values.

**Project:** active project identity and authorized cwd/root.

**Files:** Pi native file tools operate only within the host-authorized project/root and harness boundary.

**Memory:** current ROS already has capability-gated search/read seams. Pi should initially receive only `memory.search` and `memory.read`. No direct trusted-memory mutation.

**Tools:** expose an allowlisted subset of bounded ROS tools/connectors without replacing Pi native tools.

**Skills:** skills are assets, not add-ons. Define the projection/adaptation contract; prove one only if a current certified seam exists.

**User Profile / DAR / Map:** define future seams only unless a current stable read contract exists.

### Target SDK semantics

```yaml
resources:
  requests:
    - resource: provider
      operations: [model-select]
    - resource: project
      operations: [read]
    - resource: files
      operations: [read, write]
    - resource: memory
      operations: [search, read]
    - resource: skills
      operations: [list, read]
    - resource: tools
      operations: [list, invoke]
```

This MUST NOT self-grant authority and must remain compatible with a future universal provides/requires fabric.

### Session projection

A projection should identify harness/session/project, provider/model metadata, scoped credential reference, file roots/operations, memory scope, selected skills/tools, projection version and audit correlation. Only granted + available resources are present.

### Pi reference

Both External Terminal and Embedded PTY MUST receive the same logical resource projection.

Pi keeps native read/edit/write/bash semantics while ROS supplies governed provider, memory, selected skills/tools and project context.

### Security

Resource request != grant. Projection is per harness/session/project. No raw credentials. Memory reference proof is read/search oriented. Skills grant no authority. Tool calls retain their own capability checks. Project scope cannot be widened by Pi. Harness A cannot use Harness B's projection. Revocation fences access. Unknown resources/operations fail closed.

### #57 scope

MUST: Provider Profile/model, project/cwd, project-scoped Pi tools/files, real TUI, same projection for A+B.

SHOULD if current stable seams permit: memory search/read, one harmless ROS tool, one skill/resource adaptation.

DEFINE ONLY: user profile, DAR/artifacts, Map, future connector/resource bus.
