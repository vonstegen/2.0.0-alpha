# Terminal Host Adapter — Reconciliation with Existing SDK Contracts

- Status: Working note (groundwork for a future ADR; not a decision)
- Source session: `chatgpt-chat-sessions/20261002-chatgpt-chat-session.md`
- Source of truth: `src/core/contracts.ts`, `packages/addon-sdk/src/contracts.ts`,
  `docs/architecture/ADR-039-harness-addon-category-swappable-default-agent.md`

## Purpose

The 2026-10-02 session describes a "ROS Terminal Host Adapter": treat a terminal
(iTerm2, Ghostty, WezTerm, kitty, Apple Terminal) as a replaceable host, treat
Pi / OMP / Codex / Claude Code / Gemini / Hermes as harness add-ons, and treat
DAR as an optional event-consumer add-on. This note maps those concepts onto the
contract vocabulary the codebase already has, so we reuse rather than re-invent.

## Verdict

The session is conceptually sound but **mostly re-invents vocabulary that already
exists**, and it misses two existing anchors that are directly on point:

1. **ADR-039** already proposes the "harness" concept as `runtimeType: "harness"`
   with a `harnessRuntime` descriptor (`variant: "provider" | "cli"`). It names
   pi.dev, Claude Code, OpenCode, and Codex as `cli` harnesses — the exact list
   from the session.
2. The SDK already contains unused hooks for terminal hosting:
   `DelegationTargetRuntime = "terminal-service"` and
   `AddOnEmbeddedWorkspaceMode = "terminal"`.

The genuinely new work is narrow: a `terminal-host` capability, a Terminal Host
Contract, and a terminal-session event stream for DAR. Everything else already
has a home.

## Concept-by-concept mapping

| Session concept                                              | Existing SDK anchor                                                                                                                                  | Status                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Add-on Card                                                  | `AddOnManifest` + `AddOnRegistryEntry`                                                                                                               | Exists                                                |
| "Category: Harness"                                          | ADR-039: `runtimeType: "harness"` + `harnessRuntime`                                                                                                 | **Proposed** (ADR-039), not yet in `AddOnRuntimeType` |
| Harness (Pi/OMP/Codex/…)                                     | `harnessRuntime.variant: "cli"`; `AddOnAgentRuntimeAdapterContract` + `HarnessOperation`                                                             | Adapter exists; `harness` runtime type proposed       |
| Harness operations                                           | `HarnessOperation` = `createSession, invoke, cancel, history, status, modelCatalog, selectModel`                                                     | Exists                                                |
| Provider Profile                                             | `ProviderProfile` + manifest `providerRequirements`                                                                                                  | Exists (fully modeled)                                |
| Resources: Project / Files / Skills                          | `requestedCapabilities` (`filesystem`), `skills`, `archiveIntegration`, `systemSlots`                                                                | Exists                                                |
| Authority: brokered by ROS                                   | `CapabilityGrant`, `grantPresets`, per-addon bearer/admin tokens (P6)                                                                                | Exists                                                |
| Artifacts: DAR/CSRO                                          | `DelegationArtifactType` (`summary, markdown, diff, file-list, log, citation-bundle, diagnostic-report, verification-report, archive-intake-bundle`) | Exists                                                |
| Interface: Terminal/TUI                                      | `AddOnEmbeddedWorkspaceMode = "terminal"`, `AddOnSurfaceType`, `DelegationTargetRuntime = "terminal-service"`                                        | Vocabulary exists; no implementation                  |
| Terminal Host (iTerm2/Ghostty/…)                             | _(none)_                                                                                                                                             | **Missing**                                           |
| Terminal Host Contract / ROS Session (CREATE/ADOPT/DETACHED) | _(none)_ — only the `terminal-service` runtime enum                                                                                                  | **Missing**                                           |
| `provides` / `consumes`                                      | `requestedCapabilities` covers `consumes`; no symmetric `provides`                                                                                   | **Partial**                                           |
| DAR as optional event consumer                               | `hooks` (`AddOnHookEvent`), `archiveIntegration`, `memoryAccess`                                                                                     | Partial — no terminal/session event stream            |
| Normalized events (`session.created`, `tool.called`, …)      | `AddOnOutputFilteringMode = "structured-events"`, `AddOnHookEvent` (lifecycle only)                                                                  | Partial — no harness runtime event vocabulary         |

## What already exists (do not rebuild)

All in `src/core/contracts.ts` unless noted:

- `Capability` (14 values) — lines 4–18
- `CapabilityGrant` (`{ capability, granted, scope, revocationBehavior }`) — 250–255
- `RevocationBehavior` = `hard-stop | degrade | hide-surface` — 21
- `AddOnManifest` (full: `requestedCapabilities`, `providerRequirements`,
  `systemSlots`, `archiveIntegration`, `service`, `tools`, `delegation`,
  `embeddedWorkspace`, `agentRuntime`, `memoryAccess`, `skills`, `connectors`,
  `scripts`, `hooks`, `smokeTests`, `compatibility`, `agents`) — 619–690
- `AddOnRuntimeType` = `ui-module | embedded-module | local-service | agent-addon | channel-addon` — 22
- `AddOnCategory` = `agent | channel | memory | security | knowledge | tool | integration | orchestration` — 34–42
- `HarnessOperation` — 519
- `AddOnAgentRuntimeAdapterContract` (`adapterId`, `authScheme`, `credentialBinding`,
  `supportedOperations`, `contextRoleFidelity`, `toolCallbacks`) — 522–531
- `AddOnAgentRuntimeContract` (the manifest `agentRuntime` field; a union of a
  legacy contract and `AddOnAgentRuntimeAdapterContract`) — 605–608
- `ProviderProfile` — 725+
- `DelegationTargetRuntime` — 138–144 (contains `terminal-service`)
- `AddOnEmbeddedWorkspaceMode` — 468 (contains `terminal`)
- `AddOnDelegationContract` — 292–299
- `AddOnHookEvent` (lifecycle hooks) — 352–360
- `DelegationArtifactType` — 145–154

Plus `packages/addon-sdk/src/contracts.ts`:

- `ADDON_CAPABILITIES` — 62–77
- `HARNESS_OPERATIONS` — 86–88
- `AddOnSdkManifest` (manifest superset) — 26–43

## What the session over-invents

1. **`provides` / `consumes`.** Only `consumes` exists (`requestedCapabilities`).
   `provides` is currently implicit: an add-on "provides" whatever it declares
   (`tools`, `skills`, `surfaces`, `systemSlots`, `delegation`). Adding an
   explicit generic `provides` graph is unnecessary for the harness case —
   ADR-039's `harnessRuntime.tools` + `systemSlots` already express it.

2. **"Category: Harness".** ADR-039 makes "harness" a _runtime type_, not an
   `AddOnCategory`. Category should stay `agent` (or `tool`). Do not add a
   `harness` category.

3. **DAR artifact taxonomy.** DAR should consume `DelegationArtifactType` values
   and persist through `archiveIntegration` (intake write scopes) rather than
   invent a new artifact schema. The session's "DAR/CSRO" already maps onto
   `archive-intake-bundle` + `Living Archive`.

4. **Terminal host is the only genuinely new runtime concept.** Everything else
   (harness, provider, resources, authority, artifacts) already has a home.

## The Add-on Independence Principle already has enforcement vocabulary

The session's rule — _an add-on SHALL consume via contracts, and removal of an
optional add-on SHALL NOT break unrelated capabilities_ — is already expressible
through:

- `CapabilityGrant.scope` (`none | self | workspace | shared | system | intake-only`)
- `RevocationBehavior` (`hard-stop | degrade | hide-surface`)
- `RuntimeIsolationBoundary` + `AddOnRuntimeIsolation.supportsDegradedMode`

`degrade` and `hide-surface` are the existing mechanisms for "DAR removed ⇒ Pi
still works." No new normative machinery is required; the principle should be
stated against these existing types rather than as a fresh concept.

## What is genuinely new (the real build list)

1. **`terminal-host` capability** — new entry in `Capability`.
2. **Terminal Host Contract** — the session/launch/adopt API surface (recommendation #2).
3. **`RosTerminalSession` state model** — `CREATE / ADOPT / DETACHED / RUNNING / TERMINATED`.
4. **Terminal-host adapter descriptor** — a terminal mirror of
   `AddOnAgentRuntimeAdapterContract`.
5. **Harness runtime event vocabulary** — `session.created`, `tool.called`,
   `artifact.created`, etc. (distinct from lifecycle `AddOnHookEvent`).
6. **DAR as optional event consumer** — a subscription model over the event stream,
   persisting typed `DelegationArtifactType` artifacts through `archiveIntegration`.

## Concrete translation: the session's "Add-on Card"

The session (lines 66–75) proposes an ADD-ON CARD with fields
`Category / Interface / Harness / Terminal / Provider / Resources / Authority / Artifacts`.
The equivalent already-expressible manifest is:

```jsonc
{
  "id": "addon.pi",
  "runtimeType": "harness", // ADR-039 (proposed); today: "local-service"
  "category": "agent",
  "harnessRuntime": {
    "variant": "cli", // ADR-039 (proposed)
    "adapterId": "stdio-json-rpc",
    "commandDiscovery": "fixed-install-root",
    "tools": ["read", "write", "edit", "bash"],
    "envScope": ["PATH", "PI_HOME"],
    "credentialSetup": "self-auth",
    "executionGating": "explicit-enable",
  },
  "requestedCapabilities": [
    {
      "capability": "filesystem",
      "granted": false,
      "scope": "workspace",
      "revocationBehavior": "degrade",
    },
    {
      "capability": "providers",
      "granted": false,
      "scope": "system",
      "revocationBehavior": "degrade",
    },
    // terminal-host: NEW, not yet in Capability
  ],
  "providerRequirements": {
    "sharedProfiles": ["openrouter-claude"],
    "supportsPrivateCredentials": true,
  },
  "embeddedWorkspace": {
    "surfaceId": "pi-terminal",
    "mode": "terminal", // already a valid AddOnEmbeddedWorkspaceMode
    "autoStart": false,
    "settingsVisibility": "collapsed",
    "requiredCapabilities": ["terminal-host"], // NEW capability
  },
  "delegation": {
    "acceptsTasks": true,
    "taskTypes": ["code-change", "bug-fix", "design"],
    "artifactReturnTypes": ["diff", "file-list", "verification-report"],
    "defaultTargetRuntime": "terminal-service", // already a valid enum value
    "requiresHumanApprovalBeforeExecution": true,
  },
  "archiveIntegration": {
    "readScopes": [],
    "intakeWriteScopes": ["delegation-artifacts"],
    "canRequestIngest": true,
    "canWriteKnowledgePages": false,
  },
}
```

Key observation: **only `terminal-host` and the `harnessRuntime`/`harness`
runtime type are new.** Every other field in the card already maps to a
shipping type.

## Next steps (priority order)

1. ✅ **This reconciliation** (done here).
2. ✅ **Terminal Host Contract** — concrete types in
   [`src/core/terminal-host-contract.ts`](../../src/core/terminal-host-contract.ts)
   and [`ADR-040`](ADR-040-terminal-host-adapter-contract.md).
3. ✅ Add `terminal-host` to `Capability` and `ADDON_CAPABILITIES`.
4. ✅ Scope DAR provenance — `ProvenanceFidelity` (`structured` | `telemetry` |
   `observation`) in the contract + ADR-040 "DAR provenance fidelity" section.
5. ✅ Wire auth — ADR-040 "Authorization model": adapter daemon uses per-addon
   bearer/admin (P6), harness self-auth (ADR-039 `cli`), and a new
   `SessionBootstrapGrant` for `ros-session attach`.
