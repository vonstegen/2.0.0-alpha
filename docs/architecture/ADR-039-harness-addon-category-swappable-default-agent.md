# ADR-039: Harness Add-on Category And Swappable Default Agent

## Decision Metadata

- Decision status: Deferred
- Alpha applicability: Deferred
- Superseded by: None
- Owner: Add-on SDK
- Decision date: 2026-09-28
- Alpha note: Proposed unification of harness-style add-ons and a symmetric
  `primary-agent` swap. Not Alpha scope: Augmentor remains the `provider-fabric-v1`
  fallback until this is implemented. The existing primary-agent assignment
  (`/addons/slots/assign`) already works today and is the mechanism this ADR
  generalizes.

## Context

[ADR-026](ADR-026-minimal-kernel-replaceable-default-addons.md) is the ancestor:
the minimal kernel owns no chat product, Augmentor Chat is a **replaceable
default add-on**, and the shell models system slots (`primary-agent`,
`chat-interface`, `memory-system`, `communication-channel`) with
`addon.augmentor-chat` as the bundled `primary-agent`/`chat-interface` owner.

The runtime still implements that decision only partially:

- **Augmentor is a special-cased fallback, not an add-on.** In
  [`harness-host-service.mjs`](../../browser-first/host/harness-host-service.mjs),
  `executeBridgeChat` returns `providerHost.executeBridgeChat(payload)` when
  `governanceActivated` is false. Governance activates only after
  `assignSlot('primary-agent', …)`, so the "swap back to Augmentor" direction has
  no symmetric add-on — it is an un-assignment fallback.
- **OpenCode and Hermes are hardcoded host services, not SDK add-ons.** They are
  `execOpenCodeCli` / `execHermesCli` in
  [`addon-delegation-service.mjs`](../../browser-first/host/addon-delegation-service.mjs)
  with their own `*-runtime.mjs` discovery. There is no manifest that declares
  "this is a CLI coding harness", so building pi.dev, Claude Code, or Codex
  means either hand-wiring a new host lane or (as done for the pi.dev demo)
  wrapping the CLI behind an OpenAI-compatible HTTP endpoint and a per-harness
  `credentialBinding`.
- **The SDK already has most of the vocabulary but no "harness" category.**
  [`src/core/contracts.ts`](../../src/core/contracts.ts) defines
  `AddOnRuntimeType` (`ui-module | embedded-module | local-service | agent-addon |
channel-addon`), `AddOnServiceProtocol` (`stdio-json-rpc | http-json |
websocket-json | host-command` — `stdio-json-rpc` is exactly pi.dev's RPC), plus
  `agentRuntime`, `systemSlots`, and `delegation`. What is missing is a category
  that maps to the _OpenCode architecture_: a tools tab, scoped-env bridging, an
  execution-enable gate, and sandbox isolation.

[ADR-006](ADR-006-addon-runtime-sdk.md) and [ADR-018](ADR-018-addon-sdk-v0.md)
define the manifest contract. [ADR-021](ADR-021-opencode-addon-hosted-service.md)
and [ADR-031](ADR-031-agent-addon-sdk-lessons-from-hermes.md) are the delegation
precedent. [ADR-038](ADR-038-guardian-engineer-core-only-invariants.md) fixes the
boundary vocabulary this decision must respect: **first-party does not imply
privileged**, and author requests are structurally separate from host grants.

## Decision

### One harness category

Add a first-class `runtimeType: "harness"` and a declarative
`harnessRuntime` descriptor. A harness is any agent runtime that can own the
`primary-agent` slot. It has two variants that differ only in how the runtime is
reached:

```jsonc
{
  "runtimeType": "harness",
  "systemSlots": [ { "id": "primary-agent", "role": "alternative-provider", "replaceable": true } ],
  "harnessRuntime": {
    "variant": "provider" | "cli",
    "adapterId": "provider-fabric-v1" | "stdio-json-rpc" | "host-command",
    "commandDiscovery": "fixed-install-root" | "none", // never ambient PATH
    "tools": ["read", "write", "edit", "bash"],
    "envScope": ["PATH", "PI_HOME"],                 // mirrors env-clear
    "credentialSetup": "self-auth" | "provider-profiles" | "binding",
    "executionGating": "explicit-enable"
  }
}
```

| Variant    | Backend                           | Credentials                       | Spawn? | Examples                             |
| ---------- | --------------------------------- | --------------------------------- | ------ | ------------------------------------ |
| `provider` | `provider-fabric-v1`              | Provider Profiles (host-mediated) | no     | Augmentor                            |
| `cli`      | `stdio-json-rpc` / `host-command` | self-auth + scoped env            | yes    | pi.dev, Claude Code, OpenCode, Codex |

This retires the per-harness `credentialBinding` + `RESONANTOS_HARNESS_BINDINGS`
path in favor of the same credential model OpenCode already uses: the CLI
self-authenticates, and any provider key flows from **Settings → Providers**
(`readProviderSecrets()`, session-only) through a scoped env allowlist.

### Augmentor as a default-owner add-on

Promote the provider-fabric backend into a bundled first-party manifest
`addon.augmentor-chat` (`harnessRuntime.variant: "provider"`,
`adapterId: "provider-fabric-v1"`). At first run — consistent with ADR-026's
first-run rule — it is installed, granted, and assigned `primary-agent`, so
`governanceActivated` is true from the start and Augmentor is a peer add-on, not
a fallback. The `!governanceActivated` fallback in `executeBridgeChat` becomes a
recovery-only path (a missing/broken owner), not the normal Augmentor path.

### Two orthogonal axes: enabled (multi) vs. primary agent (single)

"On/off" is **not** single-choice. Two independent controls exist:

| Axis             | Operation (route)                                               | Cardinality | Effect                                                                                       |
| ---------------- | --------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| Enable / disable | `setEnabled` (`/addons/enabled`)                                | many        | Each enabled harness is running: it gets a tools tab, a workspace, and a delegation surface. |
| Primary agent    | `assignSlot('primary-agent', addonId)` (`/addons/slots/assign`) | exactly one | The default chat brain the governed chat routes through.                                     |

So **multiple harnesses can run simultaneously**: Augmentor, pi.dev, Claude
Code, OpenCode, and Codex can all be enabled at once, each with its own tools
tab and delegation surface, while exactly one of them owns `primary-agent`.
This is already how OpenCode and Hermes coexist today (both delegatable, neither
required to be the primary agent); the change is making every harness the same
kind of add-on instead of hardcoding the delegation lanes.

Install, grant, and uninstall remain single-shot lifecycle operations:

| User action                | Registry operation (route)                      |
| -------------------------- | ----------------------------------------------- |
| Install (does nothing yet) | `install` (`/addons/install`)                   |
| Grant capabilities         | `setGrants` (`/addons/grants`, `consent: true`) |
| Uninstall                  | `remove` (`/addons/remove`)                     |

A new **Agent/Harness picker** wires these together: toggles for enable/disable
(multi), a selector for the primary agent (single), plus grant/revoke and
uninstall. Because Augmentor is itself a harness add-on, the primary-agent swap
is symmetric:

- activate `addon.pi` → pi.dev owns `primary-agent`;
- activate `addon.augmentor-chat` → Augmentor owns it again;
- `replaceable: false` (per `harness-policy.mjs`) still lets an incumbent refuse
  replacement.

### Security boundary

- **Provider secrets remain session-only** (`Settings → Providers` or env), never
  persisted by the Alpha host, and cross only as a scoped env allowlist
  (`env-clear`) — the model OpenCode already demonstrates.
- **`cli` harnesses self-authenticate** (`pi auth`, `opencode auth login`,
  `codex login`) so the bridge does not hold the CLI's provider key.
- **Spawn is fixed-root and gated.** The `cli` variant reuses the exact controls
  OpenCode/Hermes already enforce: `fixed-install-root` discovery (never ambient
  `PATH`), `sandbox-exec` isolation, an `env-clear` allowlist, and an
  `explicit-enable` execution gate. Making `cli` a first-class SDK category
  **does** move the privileged spawn path into third-party manifest territory;
  this ADR therefore requires the `cli` variant to be validated and enforced
  through the same security-pipeline record as `opencode-cli`, not a generic
  `command` string.
- **First-party implies nothing** (ADR-038): `addon.augmentor-chat` and
  `addon.pi` use the identical request/grant/slot path.

## Not Decided

- Exact `harnessRuntime` field names and whether `cli` uses `stdio-json-rpc`
  (spawn) or an operator-started loopback endpoint; both are expressible.
- The picker UX (a single "Agent" selector vs. a tab per harness) and how it
  coexists with the existing delegation workspace.
- Whether Claude Code, Codex, and pi.dev ship as bundled catalog entries or are
  sideloaded examples.
- The request/grant type separation from ADR-038 is a prerequisite but is tracked
  separately, not implemented by this ADR.

## Consequences

- Augmentor stops being a fallback and becomes a replaceable default, completing
  ADR-026 for the `primary-agent` slot.
- Third-party harnesses get the same scoped, reviewed path OpenCode has, instead
  of ad-hoc wrappers or per-harness bindings.
- The pi.dev demo's HTTP wrapper + `credentialBinding` is retired in favor of the
  `harness` manifest.
- The security-pipeline runtime records (`env-clear`, fixed roots, spawn) must
  grow one entry per `cli` harness, and the SDK validator must reject ambient
  `PATH`/`command` and `granted: true` requests for harnesses.
- Recovery (ADR-038) must still work with no model and no active harness, so the
  Engineer/Guardian console cannot depend on `addon.augmentor-chat` being
  enabled.

## Migration

1. Add `harness` to `AddOnRuntimeType` and `harnessRuntime` to the SDK contract,
   with validator rejection tests (no ambient command, no self-grant).
2. Ship `addon.augmentor-chat` as a bundled, default-owner harness manifest.
3. Re-express OpenCode (and later Hermes) as `cli` harness manifests; keep their
   existing boundary code as the host enforcement layer.
4. Re-express `addon.pi` as a `cli` harness manifest and remove the
   `openai-compatible-v1` wrapper and `RESONANTOS_HARNESS_BINDINGS` binding.
5. Add the Agent/Harness picker over the existing install/enable/grant/assign
   routes.
6. Add the `env-clear` + fixed-root security-pipeline records for each `cli`
   harness before it can be enabled.
