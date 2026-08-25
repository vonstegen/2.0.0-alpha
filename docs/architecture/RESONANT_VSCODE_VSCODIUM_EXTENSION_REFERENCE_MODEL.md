# VS Code / VSCodium Extension Architecture Reference Model for ResonantOS

**Status:** Architecture Reference / Design Input
**Target:** Resonant Extension Framework (REF) V0.1+
**Date:** 2026-08-25

> This document is design input, not a decision record. It maps the
>
> extension architecture and user experience of Visual Studio Code
>
> and VSCodium onto ResonantOS. The intent is to reuse architectural
>
> patterns that developers already understand — extension manifests,
>
> contribution points, extension hosts, lifecycle management,
>
> searchable extension interfaces, packaging, and SDK tooling —
>
> while adapting them to the security, AI, local-compute, and
>
> operating-environment requirements of ResonantOS.
>
> Concrete ResonantOS decisions are made in the ADR series:
>
> - ADR-018 (Add-on SDK V0) — the canonical manifest contract
> - ADR-031 (Agent Add-on SDK Lessons from Hermes) — the wire format
> - ADR-040 (Provider Fabric Boundary — External Agent Runtimes) —
>   the dispatch endpoint
>
> §22 below maps each section of this reference to the closest ADR
>
> or to open work.

## 1. Purpose

This document proposes using the extension architecture and user
experience of Visual Studio Code and VSCodium as an explicit reference
model for the ResonantOS plug-in/add-on system.

The goal is not to clone VS Code. The goal is to reuse architectural
patterns that developers already understand—extension manifests,
contribution points, extension hosts, lifecycle management, searchable
extension interfaces, packaging, and SDK tooling—while adapting them
to the security, AI, local-compute, and operating-environment
requirements of ResonantOS.

The central design principle is:

> VS Code extensions extend an editor. Resonant extensions should be
> able to extend the cognitive capabilities of the operating
> environment itself.

## 2. Why VS Code / VSCodium Is a Useful Reference

The VS Code ecosystem demonstrates several mature extension-system
concepts that map naturally to ResonantOS:

- A standardized extension manifest.
- Declarative contribution points.
- A documented developer API.
- Executable extension code isolated from the main UI process.
- Multiple extension-host environments.
- Extension discovery, installation, enable/disable, updates, and
  uninstall.
- Publisher and version metadata.
- Compatibility declarations.
- Command-line tooling for extension development and packaging.
- Separation between the open-source application/runtime and
  extension distribution infrastructure.

ResonantOS can preserve these familiar concepts while adding
stronger identity, capability, permission, trust, and AI-runtime
controls.

## 3. User-Facing Extension Interface

The ResonantOS Extensions interface should deliberately feel familiar
to users of VS Code or VSCodium.

A primary Extensions/Add-ons view should provide:

- Search.
- Installed extensions.
- Available extensions.
- Recommended extensions.
- Updates.
- Disabled extensions.
- Locally developed extensions.
- Extension detail pages.
- Enable/disable controls.
- Uninstall controls.
- Version information.
- Publisher identity.
- Compatibility information.
- Release notes.
- Runtime status.
- Permission management.
- Trust/certification status.

Example:

```text
ResonantOS
│
├── Extensions
│   ├── Installed
│   ├── Recommended
│   ├── Marketplace / Registry
│   ├── Local Development
│   └── Updates
│
└── ContextHelix
    ├── Version: 0.4.1
    ├── Publisher: Resonant Labs
    ├── Trust: Verified
    ├── Status: Running
    ├── Runtime: Local Extension Host
    ├── Permissions
    ├── Settings
    ├── Release Notes
    └── Enable / Disable / Uninstall
```

> **Status:** partially implemented. The current add-ons workspace
>
> (`browser-first/resonantos-side-panel-extension/src/lib/main-workspace-addons.js`)
>
> exposes three tabs (Installed / Discoverable / SDK) with per-row
>
> state badges, capability chips, and tool list with copy buttons.
>
> Search, marketplace, updates, and uninstall are open work tracked
>
> in §23.

## 4. Permissions Must Be First-Class

ResonantOS should improve on the conventional editor-extension model
by making capabilities and permissions highly visible.

An extension detail page might show:

```text
ContextHelix
────────────

Publisher: Resonant Labs
Version: 0.4.1
Trust: Verified

Permissions

✓ Read conversation context
✓ Store local memory
✓ Query local models
○ Internet access
○ Operating-system shell
○ File-system write access
○ External AI APIs

[ Manage Permissions ]

Runtime
Local Extension Host

Status
● Running
```

Installation must not imply unrestricted authority.

ResonantOS should distinguish at least:

1. Package installation.
2. Extension identity.
3. Trust level.
4. Declared capabilities.
5. User-granted permissions.
6. Runtime/host assignment.
7. Active execution.

This distinction is particularly important for privileged bridge
operations. Privileged requests should be attributable to the
specific extension identity making the request rather than relying on
broadly reusable bridge credentials.

> **Status:** partially implemented. ADR-018 separates `requestedCapabilities`,
> `grantedCapabilities`, and `deniedCapabilities` per tool. The bridge
> dispatcher (`browser-first/host/external-agent-runtime-dispatcher.mjs`)
> enforces per-caller grants via `bridge-grants-store.mjs`. The
> extension-side caller-attribution work landed in this session via
> `X-ResonantOS-Bridge-Caller-Id`. Per-extension-identity caller ids
> (rather than the current `__extension__` / `dev-roundtrip` placeholders)
> are open work.

## 5. Resonant Extension Manifest

VS Code's manifest model provides a useful starting point. ResonantOS
should define its own manifest rather than making the SDK dependent on
VS Code.

> **Format note:** the canonical ResonantOS manifest is JSON (see
> ADR-018 and the working examples under `examples/addons/`). The
> YAML shape below is illustrative only; the deployed manifests must
> validate against `validateAddOnManifest` from
> `src/sdk/addons/validation.ts`.

Illustrative manifest (deployed JSON shape, abridged from
`examples/addons/addon.deepseek-harness.json`):

```json
{
  "id": "addon.deepseek-harness",
  "name": "DeepSeek Harness",
  "version": "0.1.0",
  "author": "vonstegen",
  "category": "integration",
  "sdkVersion": "0.1.0",
  "runtimeType": "agent-addon",
  "surfaces": [],
  "requestedCapabilities": [
    { "capability": "network",   "scope": "self",   "justification": "talks to upstream DeepSeek API" },
    { "capability": "providers", "scope": "shared",  "justification": "delegation surfaces in Augmentor" },
    { "capability": "agent-delegation", "scope": "self", "justification": "tool dispatch" }
  ],
  "providerRequirements": {
    "sharedProfiles": ["openai-compatible-deepseek"],
    "allowExperimentalAuth": false
  },
  "archiveIntegration": { "readMode": "none", "writeMode": "none" },
  "health":  { "command": "deepseek_harness.status", "intervalSeconds": 60 },
  "service": { "protocol": "http-json", "entrypoint": "http://127.0.0.1:3080" },
  "tools": [
    {
      "name": "deepseek_harness.run_task",
      "requiredCapabilities": ["network", "providers"],
      "inputSchema":  { "type": "object", "properties": { "messages": { "type": "array" } } }
    }
  ]
}
```

The schema is machine-validatable today (`validateAddOnManifest`) and
versioned via `sdkVersion`.

## 6. Contribution Points

One of the strongest concepts to adopt from VS Code is declarative
contribution points.

Instead of allowing every extension to manipulate arbitrary internal
application state, an extension declares the surfaces and capabilities
it contributes.

Potential ResonantOS contribution points include:

```text
commands
panels
views
settings
menus
notifications
themes

aiTools
aiAgents
skills
modelProviders
memoryProviders
contextProviders
connectorProviders
automationProviders
```

The first group resembles conventional application extension points.

The second group is where ResonantOS becomes an AI-native extension
platform.

For example:

- `modelProviders` could register local or remote model backends.
- `memoryProviders` could expose systems such as ContextHelix.
- `contextProviders` could supply relevant project/user context.
- `aiTools` could expose callable functions to models or agents.
- `aiAgents` could register specialized cognitive workers.
- `connectorProviders` could connect external applications or services.
- `automationProviders` could add event- or schedule-driven capabilities.

> **Status:** `commands` (slash-command routing via
> `side-panel-command-router.js`), `panels` (workspace tabs in
> `main-workspace.js`), and `aiTools` (the bridge dispatcher path)
> are implemented. The remaining contribution points are open work
> in §23.

## 7. Resonant Extension SDK

A dedicated SDK should expose stable APIs instead of allowing
extensions to depend directly on ResonantOS internals.

Illustrative TypeScript:

```typescript
import * as resonant from "@resonantos/sdk";

export function activate(ctx: resonant.ExtensionContext) {
  ctx.commands.register(
    "contextHelix.search",
    async () => {
      const result = await ctx.memory.search(
        "Resonant Extension Framework"
      );
      ctx.ui.showResult(result);
    }
  );
}
```

The SDK should act as both a developer contract and a security
boundary.

Potential SDK namespaces include:

```text
resonant.commands
resonant.ui
resonant.context
resonant.memory
resonant.models
resonant.filesystem
resonant.network
resonant.connectors
resonant.automations
resonant.identity
resonant.permissions
resonant.runtime
```

Access to a namespace or operation should remain subject to the
extension's declared and granted capabilities.

> **Status:** the bridge dispatcher is the de-facto SDK surface for
> `aiTools` today. The npm-published `@resonantos/sdk` does not yet
> exist; the bridge client
> (`browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`)
> is the in-process client. A formal `@resonantos/sdk` package is
> §23 open work.

## 8. Multiple Extension Hosts

VS Code's multiple-host architecture is especially relevant to
ResonantOS.

ResonantOS should consider multiple execution environments rather
than a single universal extension runtime.

### Web Host

For browser-safe extensions with minimal privilege.

Typical capabilities:

- UI contributions.
- Browser APIs.
- Sandboxed context operations.
- Remote API calls when permitted.

### Local Host

For extensions requiring access to local machine resources.

Typical capabilities:

- Local models.
- Approved filesystem access.
- Hardware discovery.
- Local services.
- Local databases.

### AI Host

A specialized environment for AI-native contributions.

Typical capabilities:

- AI tools.
- Agents.
- Context providers.
- Memory providers.
- Model orchestration.

This could initially be a logical security/runtime category rather
than a separate physical process if implementation simplicity requires
it.

### Remote Host

For workloads or services executed elsewhere.

Typical capabilities:

- Cloud AI.
- Remote compute.
- Enterprise services.
- Remote development environments.

### System Host

For highly privileged extensions.

Typical capabilities:

- Operating-system integration.
- Shell/process management.
- Device control.
- Sensitive bridge operations.

Access should require explicit approval and stronger trust
requirements.

> **Status:** partially conceptualized. The current runtime shape is
> a single `bridge` process hosting every addon; addon manifests
> declare a `runtimeType` (one of `ui-module`, `embedded-module`,
> `local-service`, `agent-addon`, `channel-addon`) but the dispatcher
> doesn't gate on host category. Host separation is open work
> (§23).

## 9. Host Selection

Extensions may declare a preferred runtime, but ResonantOS should
retain final authority over placement.

Example:

```yaml
runtime:
  preferredHost: local

permissions:
  - model.local.invoke
  - filesystem.project.read
```

ResonantOS evaluates:

- Declared host.
- Requested capabilities.
- Trust level.
- User permissions.
- Platform support.
- Available hardware.
- Security policy.
- Enterprise policy.
- Compatibility.

The operating environment then chooses whether and where the
extension may execute.

> **Status:** not implemented. The current bridge is a single-process
> runtime; addon manifests have no `preferredHost` field. This is
> open work (§23).

## 10. Trust Model

The extension framework should support progressive trust without
preventing users from developing their own extensions.

A possible hierarchy is:

```text
Personal / Local
       ↓
Developer
       ↓
Verified
       ↓
Approved
       ↓
System
```

### Personal / Local

User-created or locally installed extension.

The user accepts responsibility, but the extension still operates
through the standard SDK, manifest, capability, and permission system.

### Developer

Associated with a registered developer identity but not necessarily
reviewed for official distribution.

### Verified

Publisher identity and package provenance have been verified.

### Approved

Extension has passed the ResonantOS review/certification process
for supported distribution.

### System

Reserved for highly trusted first-party or system-integrated
components with privileged capabilities.

Trust level and permission level should remain separate concepts.
A verified publisher should not automatically receive unrestricted
machine access.

> **Status:** not implemented. The manifest's `provenance` field
> currently accepts `bundled` / `sideloaded` / `marketplace` but
> ResonantOS has no enforcement beyond validation. Trust hierarchy
> is open work (§23).

## 11. Extension Lifecycle

The runtime should implement an explicit lifecycle:

```text
Discover
   ↓
Inspect
   ↓
Install
   ↓
Validate Manifest
   ↓
Check Compatibility
   ↓
Review Permissions
   ↓
Assign Trust
   ↓
Select Extension Host
   ↓
Activate
   ↓
Run
   ↓
Suspend / Disable
   ↓
Update
   ↓
Revalidate
   ↓
Uninstall
```

Updates should trigger compatibility and permission checks when
relevant.

An update that requests new capabilities should require explicit
review rather than silently inheriting additional authority.

> **Status:** partially implemented. `validateAddOnManifest` runs at
> bridge startup; the per-caller grants store enforces runtime
> capability checks at dispatch time. Install/Update/Uninstall and
> revalidate-on-update are open work (§23).

## 12. Registry Must Be Separate From the Framework

The technical extension framework should not depend on a single
marketplace.

The architecture should separate:

```text
Resonant Extension Framework
│
├── SDK
├── Runtime
├── Manifest
├── Permission System
├── Package Format
├── Extension Hosts
└── Compatibility Rules

        separate from

Resonant Registry / Marketplace
```

This allows:

- ResonantOS official registry.
- Enterprise/private registries.
- Research registries.
- Development/local installation.
- Potential compatible third-party registries.

This separation also prevents marketplace policy from becoming
inseparable from the underlying technical architecture.

> **Status:** followed. The bridge loads manifests from
> `examples/addons/` and `public/addons/` directly; no marketplace
> coupling exists in the bridge runtime.

## 13. Package Format

A Resonant extension should be distributable as a deterministic
package.

Illustrative package:

```text
my-extension.rxp
│
├── resonant.yaml
├── dist/
│   └── index.js
├── assets/
├── README.md
├── CHANGELOG.md
├── LICENSE
└── signature/
```

The package system should eventually support:

- Manifest validation.
- Content hashes.
- Package signatures.
- Publisher identity.
- Reproducible packaging where practical.
- Compatibility metadata.
- Permission declarations.
- Dependency declarations.
- Provenance information.

> **Open:** no `.rxp` package format is defined today. Addons ship as
> bare JSON manifests + bundled JS. Signing is not implemented.
> Tracked in §23.

## 14. Developer CLI

The development workflow should feel familiar to developers who have
used VS Code tooling.

Example:

```text
$ resonant extension create

? Extension name: My Memory Provider
? Template:
  > AI Tool
    Context Provider
    Memory Provider
    Model Provider
    UI Extension
    Full Extension

Created my-memory-provider/

$ resonant extension dev
✓ Manifest valid
✓ Permissions valid
✓ Compatibility valid

Starting Resonant Extension Host...

$ resonant extension test

$ resonant extension package

my-memory-provider-0.1.0.rxp

$ resonant extension publish
```

Possible commands:

```text
resonant extension create
resonant extension dev
resonant extension validate
resonant extension test
resonant extension permissions
resonant extension package
resonant extension inspect
resonant extension publish
```

> **Status:** partly implemented via the `bench/` scripts we just
> landed. Current host-side commands (from `package.json`):
>
> ```text
> npm run bench:up           # build + start the bench (docker compose)
> npm run bench:roundtrip    # dispatch every discovered tool through
>                            # the live dispatcher
> npm run bench:down         # stop + remove the container
> npm run bench:reset        # wipe volume + rebuild from scratch
> npm run bench:panel        # open the dev panel in your browser
> ```
>
> The proposed `resonant extension *` namespace should subsume the
> `bench:*` scripts once the formal SDK exists. ADR-018 already
> recommends a `validate:manifest` script as the entry point for
> `resonant extension validate`.

## 15. Recommended Developer Templates

The SDK should provide templates for common extension classes:

1. UI Extension
2. AI Tool
3. AI Agent
4. Context Provider
5. Memory Provider
6. Model Provider
7. Connector
8. Automation Provider
9. Local System Integration
10. Full Extension

This lowers the barrier to building AI-native functionality.

> **Open:** no `resonant extension create` scaffolding exists today.
> The `bench/stub.mjs` OpenAI-compatible stub and the roundtrip script
> cover the AI-tool and full-extension shapes informally. Tracked in
> §23.

## 16. Architectural Boundary

The following rule should guide implementation:

> Extensions request capabilities through the Resonant Extension API;
> they do not receive implicit access to ResonantOS internals.

Conceptually:

```text
Extension
    │
    ▼
Resonant Extension SDK
    │
    ▼
Extension Host
    │
    ▼
Capability Broker
    │
    ├── Identity check
    ├── Trust check
    ├── Permission check
    ├── Policy check
    └── Audit / attribution
    │
    ▼
Privileged ResonantOS Service
```

Every privileged operation should therefore have an attributable
caller.

> **Status:** partially implemented. The bridge dispatcher enforces
> per-caller grants; the Phase 3.5 grant store mints tokens that
> bind callerId inside the HMAC-signed payload. Audit rows are
> recorded per dispatch. Identity is currently coarse (callerId is a
> short string; production launchers should use a richer identity
> object). Tracked in §23.

## 17. Relationship to the Existing ResonantOS Add-on Work

This reference model should be used to review and refine the existing
Resonant Extension Framework rather than replacing the work already
completed.

In particular, it should inform decisions around:

- Manifest consolidation.
- Capability vocabulary.
- Caller-attributed bridge authorization.
- Executable third-party extension surfaces.
- SDK package structure.
- Compatibility enforcement.
- Sideload/local-development policy.
- Signing and certification.
- Registry architecture.
- Developer CLI.
- Runtime isolation.
- Extension-host selection.
- UI/UX for add-on discovery and management.

## 18. Recommended Near-Term Architecture

For V0.1, avoid implementing every possible host and contribution
type.

A practical initial architecture is:

```text
ResonantOS UI
     │
     ▼
Extension Manager
     │
     ├── Manifest Validator
     ├── Compatibility Validator
     ├── Permission Manager
     └── Package Manager
     │
     ▼
Extension Host
     │
     ▼
Capability Broker
     │
     ├── Context
     ├── Local Model
     ├── Storage
     ├── Approved Filesystem
     └── Approved Network
```

Initial contribution points could be limited to:

```text
commands
views
settings
aiTools
modelProviders
memoryProviders
contextProviders
```

Additional contribution points and specialized hosts can be introduced
after the security and lifecycle model is proven.

> **Status:** partial overlap. The current add-ons workspace ships
> `commands` (slash commands), `views` (workspace tabs), and `aiTools`
> (bridge dispatcher). The Extension Manager, Package Manager, and
> Extension Host isolation are not implemented. Tracked in §23.

## 19. Key Design Decisions to Resolve

Before implementation is considered stable, the framework should
explicitly decide:

1. What is the canonical extension manifest?
2. What is the canonical capability vocabulary?
3. How is an extension assigned a unique runtime identity?
4. How are privileged bridge calls attributed to that identity?
5. What is the minimum isolation boundary for executable extensions?
6. Which contribution points are supported in V0.1?
7. Which extension hosts are real processes versus logical categories?
8. How are local/self-developed extensions authorized?
9. What changes when an extension moves from local to verified or approved?
10. How are new permissions handled during updates?
11. What compatibility rules are enforced at install and update time?
12. What package/signing format is canonical?
13. How independent is the registry protocol from the official marketplace?

> **Status:** see §23 for a proposed ADR queue that resolves these one
> at a time.

## 20. Recommendation

Adopt VS Code/VSCodium as an explicit architectural reference for
the Resonant Extension Framework, with deliberate divergence in four
areas:

1. **Capability security:** Every privileged action must be tied to
   extension identity and permission.
2. **AI-native contribution points:** Models, memory, context, tools,
   agents, connectors, and automations should be first-class extension
   surfaces.
3. **Heterogeneous execution:** Browser, local, AI, remote, and
   system workloads may require different hosts and security
   boundaries.
4. **Registry independence:** The extension framework and package
   format should remain usable independently of the official Resonant
   marketplace.

The VS Code model provides a mature developer and user experience to
learn from. ResonantOS can use that foundation to create an extension
system designed specifically for an AI operating environment.

## 21. Reference Material

Primary architectural references for follow-up engineering review:

- Visual Studio Code Extension API documentation
- VS Code Extension Manifest documentation
- VS Code Contribution Points documentation
- VS Code Extension Host documentation
- VS Code Web Extensions documentation
- VSCodium project and extension-registry architecture

These references should be treated as design precedents, not
normative dependencies. The Resonant Extension Framework should
remain its own API, package format, security model, and runtime
contract.

---

## 22. Cross-check Against Existing ADR-018 / ADR-031 / ADR-040 + This Session

The reference model maps to the deployed codebase as follows:

| Section    | Topic                              | Status                  | Where it lives                                         |
|------------|------------------------------------|-------------------------|--------------------------------------------------------|
| §3         | User-facing extension interface    | Partial — three tabs    | `main-workspace-addons.js`                             |
| §4         | Permissions first-class            | Partial                 | `bridge-grants-store.mjs`, `external-agent-runtime-dispatcher.mjs` |
| §5         | Canonical manifest                 | Done (JSON, ADR-018)    | `src/sdk/addons/validation.ts`, `examples/addons/*.json` |
| §6         | Contribution points                | Partial — 3 of ~14      | `side-panel-command-router.js`, `bridge dispatcher`     |
| §7         | SDK                                | Partial — bridge client  | `lib/bridge-client.js`                                  |
| §8         | Multiple extension hosts           | Conceptual               | `runtimeType` enum in ADR-018                          |
| §9         | Host selection                     | Not implemented         | —                                                      |
| §10        | Trust hierarchy                    | Not implemented         | `provenance` field in ADR-018 only                      |
| §11        | Lifecycle                          | Partial                 | `validateAddOnManifest` at startup; runtime grant checks |
| §12        | Registry independence             | Done (in spirit)        | Bridge loads manifests directly from disk               |
| §13        | Package format (`.rxp`)           | Not implemented         | —                                                      |
| §14        | Developer CLI                      | Partial                 | `npm run bench:*`; `npm run validate:manifest`         |
| §15        | Developer templates                | Not implemented         | `bench/stub.mjs` is informal AI-tool scaffolding        |
| §16        | Capability broker + audit          | Done (caller attribution) | `bridge-grants-store.mjs`, `bridge-audit-ledger.mjs` |
| §17        | Refine, don't replace             | Followed                | —                                                      |
| §18        | Initial contribution set           | Partial                 | `commands`, `views`, `aiTools` shipped                  |
| §19        | Design decisions                   | See §23                 | —                                                      |

This document is a roadmap. ADR-018 is the only fully-shipped
decision record today; ADR-031 and ADR-040 cover adjacent concerns.

---

## 23. Open Decisions — Proposed ADR Queue

The 13 design decisions in §19 map to proposed ADRs as follows.
Each ADR is small enough to land in one session. The order
prioritizes decisions that gate implementation.

### 23.1 Manifest consolidation — gate by ADR-018 (DONE)

ADR-018 already commits to a JSON manifest. This document
acknowledges that decision; no separate ADR needed. **No work.**

### 23.2 Canonical capability vocabulary — gate by ADR-018 (DONE)

ADR-018 §Capabilities defines 13 capabilities. ADR-031 extends with
`agent-delegation`. The bridge dispatcher enforces them. **No work.**

### 23.3 Unique runtime identity — needs ADR

A `addon.<id>@<publisher>` triple. Publisher ID comes from a future
identity service (out of scope here). **Open.**

### 23.4 Caller-attributed bridge authorization — partially done

The bridge dispatcher uses HMAC-signed tokens that bind callerId
inside the payload. The `dev-roundtrip` / `__extension__` shortcuts
in the minimal launcher should be replaced with a real per-extension
caller id once §23.3 lands. **Mostly done; tighten later.**

### 23.5 Minimum isolation boundary — needs ADR

Today every addon runs in the same Node process as the bridge, in
the same OS process, with the same privileges. For trust levels
above `Personal / Local`, this is insufficient. Proposal: per-host
process isolation (or worker_threads) gated by trust level. **Open.**

### 23.6 Contribution points in V0.1 — partially done

`commands`, `views`, `aiTools` shipped. The rest are open work. **Open.**

### 23.7 Real processes vs logical categories — needs ADR

The §8 host taxonomy (Web / Local / AI / Remote / System) is
conceptual today. Until a host is a real process with its own
trust boundary, the categories are labels. **Open.**

### 23.8 Local/self-developed extensions authorized — partially done

Sideloaded manifests are accepted by the validator today. The
runtime grants are minted by the launcher for known callers;
self-developed callers need an authorization path. **Partly done;
open.**

### 23.9 Trust-level transitions — needs ADR

What changes when an extension moves from Personal → Developer →
Verified → Approved → System? Permission scope, host assignment,
audit retention, sign-off requirements. **Open.**

### 23.10 New permissions on update — needs ADR

A diff in `requestedCapabilities` between v1 and v2 of an addon
should require explicit user review, not silent inheritance. **Open.**

### 23.11 Compatibility rules — partially done

`compatibility.minShellVersion` and `compatibility.blockedShells` are
declared in the manifest and validated. Cross-addon compatibility
(e.g. shared capability conflicts) is not. **Partly done.**

### 23.12 Package format (`.rxp`) — needs ADR

The doc proposes `.rxp` with a manifest, dist, assets, signature.
Signing strategy (per-publisher Ed25519 vs per-package hash) is
undecided. **Open.**

### 23.13 Registry independence — DONE (in spirit)

Bridge loads manifests directly from disk; no marketplace coupling.
A future registry would conform to the SDK contract from §7. **No
work; revisited when a registry ships.**

### Recommended next-session order

The smallest coherent slice is:

1. §23.3 (runtime identity) — one ADR.
2. §23.9 (trust transitions) — one ADR.
3. §23.10 (new-permission review) — one ADR.
4. §23.5 (isolation boundary) — one ADR.

Together these resolve the four most consequential decisions still
open and gate §23.6 (which contribution points), §23.7 (which hosts
are real), and §23.12 (package format).

---

This document is intentionally non-decisional. The ADRs listed in
§23 are where the actual commitments live.