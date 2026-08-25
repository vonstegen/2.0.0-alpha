# ADR-050: Native Tool Fabric and Add-on Tool Surfaces (Two-Tier Model)

## Decision Metadata

- Decision status: Accepted
- Alpha applicability: Partial
- Superseded by: None
- Owner: Add-on SDK + Delegation
- Decision date: 2026-08-25
- Alpha note: Two tiers are formally distinguished by name, identity, isolation boundary, and dispatch routing. Add-on tool surface is implemented and dispatched today. Native tool surface is a typed taxonomy with no executor yet; this ADR locks the namespacing and identity rules so the eventual executor slot does not collide with addon tools.
- Cross-reference: ADR-015 (Native Tool Fabric first sketched here);
  ADR-018 §"Capabilities" + `src/core/contracts.ts:147` `NativeToolCapability`;
  ADR-018 §"Tools" + `src/core/contracts.ts:292` `AddOnToolDefinition`;
  ADR-038 (add-on runtime identity `id@publisher:version`);
  ADR-041 (add-on isolation boundary + worker-key rebind);
  ADR-032 §"Runner.* / compute.*" (extended native tool vocabulary).

## Decision

ResonantOS exposes tools to agents through **two parallel tiers** that
share capability vocabulary but are otherwise disjoint in name,
identity, isolation, and dispatch routing:

| Axis | Native tool | Add-on tool |
| --- | --- | --- |
| **Vocabulary** | `NativeToolCapability` union, ~35 dotted names in namespaces `research.*`, `browser.*`, `filesystem.*`, `process.*`, `provider.*`, `archive.*`, `delegation.*`, `addon.*`, `runner.*` (ADR-015 / ADR-032) | addon-chosen `name: string` declared in `AddOnManifest.tools[]: AddOnToolDefinition[]` (ADR-018) |
| **Identity** | "host" — no publisher; built into the ResonantOS host process / Rust service | `id@publisher:version` triple (ADR-038) |
| **Isolation** | host process; future Rust-core services per ADR-018 | addon worker keyed by `workerKey` (ADR-041) |
| **Where granted** | `Capability`-level grants in the addon's `requestedCapabilities` gate whether an addon can request a native tool at all | by `name` within the addon's own `tools` array; addon-attributed bridge callers route via the dispatcher |
| **Dispatched today** | No — only typed taxonomy | Yes — `/external-agent-runtime/delegate`, `/addons/delegate` |
| **Audit row format** | `native.{capability}` source; attribution = `host`, caller = the addon's `id@publisher:version` triple | `addon.{name}` source; attribution = `id@publisher:version`, tool = `addon_name` |

The two tiers are **never interchangeable**. An addon's `tools[*].name`
MUST NOT collide with any name in the `NativeToolCapability` union or
its namespace prefixes (see "Namespacing" below); a native-tool
request from inside an addon-run delegation MUST route through the
host bridge dispatcher and never execute inside the addon worker.

## Why

ADR-015 sketched native tools alongside the add-on catalog but didn't
pin the namespacing, identity, or routing rules. With add-on SDK
contracts now stable (ADR-018 + ADR-038 + ADR-041 + ADR-042), the
boundary between host-owned "native" tools and addon-declared
"add-on" tools is structurally enforceable; this ADR writes down the
rules so the future native-tool executor slots in cleanly without
breaking the addon surface.

Three independent forces all point at the same two-tier split:

1. **Trust boundary.** Native tools are trusted; addons are not. Any
   callable surface that crosses that boundary must be mediated
   (ADR-018 §"Capabilities" + the `Capability` grant store). Sharing
   one unified namespace would let an addon's `tools[*].name = "filesystem.read"`
   shadow a host-owned `filesystem.read` and confuse both audit and
   capability scoping.
2. **Identity and isolation.** ADR-038's `id@publisher:version` is
   per-addon; ADR-041's worker-key spans the lifetime of one addon
   install. A native tool has no publisher and runs in the host
   process; reusing the addon worker's identity surface would force
   a "system" publisher and break worker-key rebind semantics.
3. **Dispatch routing.** The bridge dispatcher already routes
   addon-attributed calls through the addon worker (ADR-041). A
   native tool call from an agent must route through the bridge to
   the host, never to the addon worker; if a single namespace shared
   both, dispatch would have to inspect the call to decide where it
   goes, and a malicious addon could attempt to confuse it.

## Namespacing

### Native tool names

Native tool names live in the `NativeToolCapability` union and follow
a **dotted prefix** convention:

```
research.* | browser.* | filesystem.* | process.* | provider.*
archive.* | delegation.* | addon.*  | runner.* | compute.*
```

Names are **closed**: only values listed in `NativeToolCapability` are
valid; adding a new native tool requires extending the union and
landing an ADR. This is the same posture as `Capability`.

### Add-on tool names

Add-on tool names live in the addon's `tools: AddOnToolDefinition[]`
array. Each name is a free-form `string` fielded by the addon author,
but **collides with the native surface** in two documented cases:

1. **Direct shadow.** `addon.tools[*].name === <native capability>`.
   Example: an addon declaring `tools[*].name = "filesystem.read"`
   shadows the host-owned `filesystem.read` native capability and
   would confuse both audit and capability scoping.
2. **Reserved literals.** A small set of literal names that are too
   likely to be picked by accident and too dangerous to alias:
   `"fs"`, `"shell"`, `"exec"`, `"wallet"`.

The validator MUST reject category 1 with error code
`tool-name-collides-with-native` and category 2 with
`tool-name-reserved`. This rule is implemented in
`src/sdk/addons/validation.ts` and operates against the
`packages/addon-sdk-testing/src/native-tool-prefixes.mjs` shared
list. The validator integration test suite covers each branch
(direct-shadow, reserved-literal, allowed-prefix-similar
names).
The list of native capabilities and reserved literals is exposed as
a single module
(`packages/addon-sdk-testing/src/native-tool-prefixes.mjs`) so the
validator, the bridge, and any future tooling share one source of
truth. Native-tool additions require the same union edit + ADR that
adding a native tool does.

**Out of scope today:** a dotted-prefix shadow rule (e.g. forbidding
`"browser.start"` because the future might add a `browser.start`
native tool) is intentionally NOT enforced. The risk of future
native tools growing into an addon's existing prefix is mitigated
by:

- The closed `NativeToolCapability` union being reviewed per ADR;
- ADR-018 §"Capabilities" requiring every native capability to
  appear with an explicit union edit, not silently; and
- A future ADR may add a stricter prefix-shadow check if confusion
  becomes a real problem in the field.

Until then, addon tools that share a prefix with a future native
tool need a follow-up rename when the native capability is
introduced.

### Add-on workspace / surface names
Surface names (`AddOnSurface.id`) and grant preset names
(`AddOnGrantPreset.id`) follow the same collision rule today by
virtue of unique-id checks; this ADR does not change them but
records the parallel.

## Identity

| Surface | Identity at runtime |
| --- | --- |
| Native tool | `host` (no publisher). Audit row's `callerId = host`. |
| Add-on tool call | `id@publisher:version` (ADR-038). Audit row's `callerId = id@publisher:version`. |
| Native tool invoked *from* an addon's delegation | audit row's `callerId = id@publisher:version` (the addon initiated it); the row's `source = native.{capability}`; the row's `attributedTo = host` (the executor that ran). |

Cross-tier calls (add-on delegation step invoking a native tool)
appear as a **single audit row** with both `callerId` (the originating
addon) and `source = native.<cap>` (the executor that ran). The
audit row also records the `bridgedFrom = id@publisher:version` and
`bridgedTo = host`. This is exactly the row format the
`bridge-audit-ledger.mjs` already supports (per ADR-040 §7).

## Isolation

- Native tools **always** run in the host process (today's Node
  bridge; future Rust services per ADR-018). They never execute
  inside an addon worker.
- Add-on tools **always** run in their owning addon's worker
  (ADR-041 §"Worker rebind lifecycle"). They never execute in the
  host process.
- A cross-tier call (an addon's delegation invoking a native tool)
  is **not** an addon-worker reload; it is the dispatcher forwarding
  to the host process with the originating `id@publisher:version`
  preserved as the audit row's `callerId`.

## Capability gating

Add-ons cannot call native tools directly. Two indirections must
hold:

1. The addon must declare its `requestedCapabilities` such that the
   relevant `Capability` is granted (e.g. `filesystem` for
   `filesystem.read`). This is ADR-018 §"Capabilities" + the bridge
   grants store.
2. The addon's **declared** `tools` array exposes a single callable
   method that, when invoked, causes the bridge dispatcher to call
   the native tool on the addon's behalf. The native tool's name
   MUST NOT appear in `tools[*].name` (per "Namespacing" above).
   Instead, the addon's tool declares a high-level verb (e.g.
   `"reading_room.fetch_doc"`) whose implementation forwards to the
   bridge with the addon's identity.

An add-on tool that bypasses the bridge (calls the host process
directly from inside its worker) is a contract violation; the
isolation rule above is enforced by the dispatcher's call surface,
not by addon behavior.

## Validation

- `NativeToolCapability` is unchanged; this ADR documents it.
- `AddOnToolDefinition.name` collision check (categories 1 + 2 above)
  is **implemented** as of the same commit that lands this ADR's
  validator integration. The shared list lives in
  `packages/addon-sdk-testing/src/native-tool-prefixes.mjs`.
- vitest: every prior test stays green (543/543). A new
  `packages/addon-sdk-testing/test/native-tool-prefixes.test.ts`
  exercises the reserved-prefix + reserved-literal list against
  curated declarations. A new
  `packages/addon-sdk-testing/test/native-tool-validator-integration.test.ts`
  walks every bundled addon manifest through the production
  validator and asserts none of them trip the new error codes; an
  additional case asserts a synthetic fixture that *does* use
  `tools[*].name = "filesystem.read"` is rejected with the
  `tool-name-collides-with-native` error code.

## Open work (delegated to follow-up)

- **DONE: Reserved-prefix / reserved-literal enforcement.** Two new
  error codes (`tool-name-collides-with-native`,
  `tool-name-reserved`) live in `validateAddOnManifest`. Both the
  unit tests and the bundled-addon integration test pass.
- **Native tool executor.** A separate ADR lands when the executor
  is wired into the bridge dispatcher (today: nothing; the slot is
  empty per ADR-015 §"Native Tool Fabric").
- **Cross-tier audit row.** The dispatcher already emits one row per
  addon-delegation step; a follow-up confirms the
  `bridgedFrom` / `bridgedTo` fields land as separate columns once
  any native tool is actually invoked.
- **Dotted-prefix shadow rule.** Out of scope today; a future ADR
  may add it if confusion becomes a real problem in the field (see
  "Namespacing" above).
- **Native tool authorization surfaces.** When the executor lands,
  the host service contract that gates per-call authorization (which
  addons may call which native tools, with which scopes) lands in
  a separate ADR.
## Rules

- Native tool names = the `NativeToolCapability` union; closed,
  ADR-only extension.
- Add-on tool names = opaque strings, never colliding with native
  names per "Namespacing" above.
- Native tools always execute in the host process / future Rust
  service; addon tools always execute in the addon worker.
- Cross-tier calls are mediated by the bridge dispatcher and emit
  one audit row attributing both sides.
- A reserved-literal list (`"fs"`, `"shell"`, …) MUST reject any
  add-on tool declaration with that name.

## Why this ADR is its own record

ADR-015 is the right ancestor — it sketched the native-vs-addon split
in §"Native Tool Fabric" + the Augmentor/Engineer posture sections.
But ADR-015 is a posture document (450 lines, broad scope) and predates
ADR-018's `Capability` contract, ADR-038's identity triple, ADR-041's
worker key, and ADR-032's runner.* vocabulary extensions. ADR-050
sharpens those four into namespacing + identity + isolation +
gating rules so the validator and dispatcher have a single source of
truth when they're updated.

Out of scope (delegated to ADR-018 / ADR-038 / ADR-041 / ADR-015):
- The native tool executor itself (ADR-015 left a slot).
- The host-Rust bridge that lowers `NativeToolCapability` to
  privileged operations (ADR-018 §Alpha key).
- The full runner.* / compute.* vocabulary (ADR-032 + future ADRs).
