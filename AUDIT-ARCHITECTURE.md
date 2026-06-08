# AUDIT-ARCHITECTURE.md — ResonantOS vNext Architecture & Contracts Audit

**Audited:** 2026-06-08  
**Scope:** `src/core/contracts.ts`, `src/core/defaults.ts`, `src/core/policies.ts`, `src/sdk/addons/`, `docs/architecture/ADR-*.md` (37 ADRs)  
**Platform:** Tauri + React + Chromium browser-first desktop app  
**Auditor:** Architecture Audit Subagent (Analog 6)

---

## Summary

The codebase is architecturally coherent. Contracts are broad, well-typed, and generally reflect what the app implements. Policy enforcement at the Rust/Tauri boundary is real — not UI-only theater. The SDK add-on boundary is clean. Several specific issues require attention: one dead union variant, one missing interface from ADR-005, missing `systemSlots` validation, a redundant type alias, and an incomplete ADR-026 kernel migration.

**Severity summary:**

| Severity | Count |
|----------|-------|
| 🔴 High   | 2     |
| 🟡 Medium | 5     |
| 🟢 Low    | 4     |

---

## 1. Contracts vs Implementation Consistency

### ✅ PASS — Contracts broadly match implementation

`contracts.ts` is exhaustive and well-organized. All major subsystems have matching types: provider routing, compute fabric, archive operations, delegation packets, goal workspaces, add-on manifests, browser sessions, Hermes/Obsidian/OpenCode/Paperclip integration, context compaction. The type coverage is high.

`defaults.ts` correctly imports and populates all fields declared in `contracts.ts`. `buildDefaultState()` uses every major top-level interface in `ResonantShellState`.

### 🔴 ISSUE #1 — `RoutingResolutionReason.primary-unavailable` is a dead union variant

**Severity:** High (type contract misrepresents behavior)

`contracts.ts` declares:
```ts
export type RoutingResolutionReason =
  | "primary-healthy"
  | "primary-unavailable"      // ← this
  | "fallback-in-policy"
  | "resurrection-available"
  | "no-viable-route";
```

`resolveProviderRoute()` in `policies.ts` emits exactly three reasons:
- `"primary-healthy"` (primary node is ready and was used)
- `"fallback-in-policy"` (any non-primary route used, including when primary is unavailable)
- `"resurrection-available"` (local recovery node selected)
- `"no-viable-route"` (nothing resolved)

**`"primary-unavailable"` is never emitted.** When the primary is unreachable, the router immediately advances to the fallback chain and eventually returns `"fallback-in-policy"` — `"primary-unavailable"` never reaches the output. Any caller branching on this variant will never fire.

**Fix:** Remove `"primary-unavailable"` from the union, or emit it explicitly when the primary provider was tried and skipped due to `status === "missing"`.

---

### 🔴 ISSUE #2 — `ProviderCatalogTemplate` interface is missing from `contracts.ts`

**Severity:** High (ADR-005 compliance gap)

ADR-005 ("Provider Fabric & Routing") specifies a required `Provider Catalog Template` interface in its "Interfaces Constrained By This ADR" section. This interface must express:
- provider label and category
- provider type and auth method  
- default endpoint
- whether a secret or base URL is required
- execution state: `"routable-now"` / `"adapter-pending"` / `"profile-only"`
- setup note for the Engineer Agent

No such interface (`ProviderCatalogTemplate`, `ProviderSetupTemplate`, or equivalent) exists anywhere in `src/`. The search returned zero hits. The provider setup probe result (`ProviderSetupProbeResult`) captures *outcomes* but not the *catalog definition* that templates new provider profiles.

**Impact:** The Engineer Agent's "add a new provider" flow has no typed contract to work from. Manual or ad-hoc provider onboarding cannot be validated against a schema.

**Fix:** Add `ProviderCatalogTemplate` to `contracts.ts` per ADR-005 spec.

---

## 2. Policy Functions vs ADR Promises

### ✅ PASS — ADR-007 (Living Archive Boundaries): real enforcement

`canPerformArchiveAction()` in `policies.ts` correctly gates reads by scope prefix, intake writes by approved root prefixes, knowledge writes by the `canWriteKnowledgePages` boolean, and ingest requests by `canRequestIngest`. This maps cleanly to the actor policy model in `archivePolicy.actorPolicies`.

More importantly, the Rust layer independently enforces this at the Tauri command boundary via `assert_living_archive_host_access_from_state()` and `assert_addon_capabilities_from_state()` in `src-tauri/src/host_state.rs`. The check is real: it reads the persisted state JSON, verifies `installed`, `enabled`, and each `grantedCapabilities[].granted` flag before allowing execution. Every archive write Tauri command that was inspected called this guard.

### ✅ PASS — ADR-012 (Living Archive Approval Policy): interfaces match spec

`contracts.ts` has `ArchiveApprovalTier`, `ArchiveReviewDecision`, `ArchiveReviewDecisionStatus`, `ArchiveReviewDecisionAction`, `ArchiveReviewConfidence`, `ArchiveDoctrineSensitivity`, `ArchivePromoteReviewArtifactResult`, and `ArchiveReviewArtifact` — all specified in ADR-012. The default approval policy in `defaults.ts` uses `"strategist-review"` as the default tier, with `autoApproveIntents: ["summary-refresh", "metadata-refresh"]` and human review required for doctrine-sensitive types. This matches the ADR policy mapping.

### ✅ PASS — ADR-005 (Provider Fabric): routing logic is correct

`resolveProviderRoute()` correctly implements the policy engine model: ordered provider IDs, auth tier filtering, adapter matching, locality and runtime node ranking, resurrection path, and hard fallback. The `"strict-supported-only"` fallback policy (which excludes experimental auth) and the `"core-default"` policy are both correctly differentiated. Experimental routes are visibly flagged via `authTier: "experimental"` on the profiles.

### 🟡 ISSUE #3 — ADR-026 migration is incomplete: `strategist.core` and `archive-ingest.core` are still kernel-hardcoded

**Severity:** Medium (migration debt, not a security issue)

ADR-026 explicitly states: *"This ADR supersedes the earlier assumption that the product ships with exactly four always-on core parts where Strategist and Living Archive are mandatory core systems."* Migration steps include:
- `strategist.core` → `addon.augmentor-chat` replaceable slot
- `living-archive.core` → `addon.living-archive` replaceable slot

The manifests exist (`public/addons/augmentor-chat.json`, `public/addons/living-archive.json`), complete with correct `systemSlots` entries. The slot lookup logic exists in `src/modules/shell/system-slots.ts`. **However**, `defaults.ts` still hardcodes:
```ts
agents: [
  { id: "strategist.core", trustTier: "core", ... },
  { id: "setup.core", trustTier: "core", ... },
  { id: "archive-ingest.core", trustTier: "core", ... },
  { id: "hermes.agent", trustTier: "addon", ... },  // ← add-on hardcoded as kernel default
]
```

The kernel still instantiates `archive-ingest.core` as an always-on agent, and `hermes.agent` is bundled into the default agent registry despite being an add-on. `setup.core` (the Engineer) is intentionally kernel-owned per ADR-026, which is correct.

**Fix:** Remove `archive-ingest.core` from the hardcoded agents array; it should be activated by the `addon.living-archive` slot. Remove `hermes.agent` from kernel defaults; it should appear only when the Hermes add-on is installed and enabled.

---

## 3. Capability Gates: Real Enforcement or Empty Stubs?

### ✅ PASS — The Rust enforcement layer is real and non-bypassable

`assert_addon_capabilities_from_state()` in `host_state.rs` is called on every archive Tauri command and performs three independent checks:
1. Add-on is installed (`"installed": true`)
2. Add-on is enabled (`"enabled": true`)
3. Every required capability has `granted: true` in `grantedCapabilities`

This is not UI-only gating. A caller cannot invoke an archive write Tauri command without the add-on being in the correct state. The check reads live state, not a cached boolean.

### ✅ PASS — Surface routing capability check is real

`createAddOnSurfaceDockRoutes()` in `surface-routing.ts` correctly calls `hasGrantedCapability()` before exposing a dock route. A surface with `shellNavigation.requiredCapabilities` will not appear until each capability has `granted: true` in the installation.

### ✅ PASS — Logician hook activation gates are real

`assessLogicianHookActivation()` independently checks install state, enabled state, and per-capability grants via `missingLogicianCapabilities()`. It also blocks hooks from referencing scripts that require human approval (enforced by `"hook-handler-requires-human-approval"` validation error).

### 🟡 ISSUE #4 — `isCapabilityGranted()` is largely unused in TypeScript tool handlers

**Severity:** Medium

`policies.ts` exports `isCapabilityGranted()`. It is used in exactly one TypeScript file: `browser-tools.ts`. Most non-archive, non-browser core TypeScript tools (delegation, context compaction, goal workspace, model strategy, etc.) do not call `isCapabilityGranted()` before executing.

The primary safety net for these operations is the Rust Tauri boundary — which is adequate. But the TS-layer tool functions (e.g., those in `delegation.ts`, `chat.ts`, `compute-fabric.ts`) could be called server-side or in tests without the Tauri boundary, and capability gating would not apply.

**Recommendation:** Either document explicitly that TS-layer tools are not the enforcement point (enforcement is Rust-only), or add `isCapabilityGranted` guards consistently in the TS tool layer for defense-in-depth.

---

## 4. Kernel / Add-on Boundary

### ✅ PASS — SDK boundary is clean

The `src/sdk/addons/` module imports only from `../../core/contracts` (type imports, no runtime values). No SDK file imports from Tauri internals, host services, or module controllers. JSON manifests in `public/addons/` are pure data with no imports. The SDK is a pure validation and data-shaping layer — no kernel internals leak into it.

### ✅ PASS — Add-on manifests cannot claim trusted archive writes

Validation in `validation.ts` hard-blocks any manifest with `archiveIntegration.canWriteKnowledgePages === true`:
```
"Add-ons cannot claim trusted Living Archive knowledge-page write authority."
```

`AddOnMemoryAccessContract.directKnowledgeWriteAllowed` is typed as the literal `false` (not `boolean`), and validation enforces `!== false` as a blocking error. This is not advisory — it's a hard `error` severity that prevents validation from passing.

### 🟡 ISSUE #5 — `systemSlots` field on `AddOnManifest` has no validation in `validation.ts`

**Severity:** Medium

`AddOnManifest` declares an optional `systemSlots` array, and ADR-026 defines how slot membership must work. But `validateAddOnManifest()` in `validation.ts` never validates `systemSlots`. A manifest can declare:
```json
{ "systemSlots": [{ "id": "invalid-slot", "role": "default-provider", "replaceable": "yes" }] }
```
...and pass validation without error.

The slot machinery in `src/modules/shell/system-slots.ts` does use these values at runtime, but bad `systemSlots` entries are silently ignored rather than rejected at install time.

**Fix:** Add `systemSlots` validation: check that each `id` is in `SystemSlotId`, `role` is a valid enum, and boolean fields are booleans.

---

## 5. Type Mismatches and Dead Interfaces

### 🟡 ISSUE #6 — `AddOnSdkManifest` re-declares all optional fields already on `AddOnManifest`

**Severity:** Medium (type hygiene)

`src/sdk/addons/contracts.ts` defines:
```ts
export type AddOnSdkManifest = AddOnManifest & {
  sdkVersion: string;
  service?: AddOnLocalServiceDefinition;
  tools?: AddOnToolDefinition[];
  workflowBoundaries?: ...
  // ... 14 more fields
};
```

Every one of the re-declared optional fields (`service`, `tools`, `workflowBoundaries`, `skills`, `connectors`, `scripts`, `hooks`, `engineerSetup`, `augmentorSkills`, `install`, `audit`, `embeddedWorkspace`, `agentRuntime`, `memoryAccess`, `smokeTests`) is **already optional on `AddOnManifest`**. The intersection type adds nothing beyond making `sdkVersion` required.

This creates confusion: it implies `AddOnSdkManifest` fields are *different* from `AddOnManifest`, but they are structurally identical. The codebase uses `AddOnManifest` everywhere anyway.

**Fix:** Simplify to `type AddOnSdkManifest = AddOnManifest & { sdkVersion: string }`, or just add `sdkVersion?: string` to `AddOnManifest` directly (it's already optional there) and remove the separate type.

### 🟢 ISSUE #7 — `Gx10LlamaSwitchRequest` and `ComputeRemoteProbeRequest` use hardcoded literal node ID unions

**Severity:** Low (brittleness)

```ts
export interface Gx10LlamaSwitchRequest {
  modelId: "Qwen3.6-35B-A3B-Q4_K_M.gguf" | "Qwen3.6-27B-Q4_K_M.gguf";
}
export interface ComputeRemoteProbeRequest {
  nodeId: "compute-gx10" | "compute-nas-backup";
}
```

These encode specific node identities and model filenames into the public contract layer. When the fleet changes (new nodes, updated models), `contracts.ts` requires a breaking change. This is operational data masquerading as a type contract.

**Fix:** Widen to `string` and validate at the runtime/Tauri layer against the current `computeFabric.nodes` roster.

### 🟢 ISSUE #8 — `hermes.agent` in `defaults.ts` has an `archiveIntakeWriteScope` not reflected in `archivePolicy.actorPolicies`

**Severity:** Low (data inconsistency)

`defaults.ts` defines:
```ts
{ id: "hermes.agent", archiveIntakeWriteScopes: ["LivingArchive/INTAKE/hermes"], ... }
```

But `archivePolicy.actorPolicies` in the same file has no matching `actorId: "hermes.agent"` entry. The archive policy only covers `strategist.core`, `archive-ingest.core`, `addon.openclaw`, and `addon.audio2tol`. Hermes has an intake scope declared in its `AgentDefinition` but no corresponding `ArchiveActorPolicy` enforcement record. `canPerformArchiveAction()` returns `false` for any Hermes actor ID.

This is a secondary consequence of Issue #3 (incomplete ADR-026 migration). Hermes should use `actorId: "addon.hermes"` consistent with the add-on actor policy model, and an `ArchiveActorPolicy` entry should be added.

### 🟢 ISSUE #9 — `ProviderProfile.authTier` for cloud providers is `"experimental"` in defaults, not `"supported"`

**Severity:** Low (documentation / trust posture)

Both `shared-minimax` and `shared-openai` in `defaults.ts` are configured with `authTier: "experimental"` and `credentialStatus: "missing"`. This is intentional for a first-run state where credentials haven't been configured. However, `AuthTier` is declared as `"supported" | "experimental" | "unavailable"` — and `"experimental"` implies undocumented/reverse-engineered auth per ADR-005.

OpenAI and MiniMax both use documented public APIs, so `"supported"` would be the correct tier once credentials are configured. The default `"experimental"` posture means first-run routing will be `allowExperimentalAuth: true` even for straightforward API key flows.

**Note:** This appears intentional as a conservative pre-configuration stance, but the label may confuse future operators reading the state.

---

## 6. ADR Coverage Gaps (Non-Code Items)

The following ADR-specified items were searched for in the codebase and not found, indicating planned but unimplemented functionality:

| ADR | Specified Item | Status |
|-----|---------------|--------|
| ADR-005 | `ProviderCatalogTemplate` interface | ❌ Missing — see Issue #2 |
| ADR-026 | First-run flow asking user to enable recommended defaults | 🟡 `recommendedAddOnsReviewed` flag exists in state; shell controller marks it true on enable — minimal implementation present |
| ADR-026 | Floating chat window (detached from shell) | ❌ Not found in contracts or UI modules |
| ADR-026 | Degradation prompt when no `memory-system` slot is active | 🟡 `resolveMemoryProviderBroker()` in `memory-provider.ts` returns a `"No active memory provider"` error; no user-visible prompt flow found |
| ADR-023 | `AddOnRegistryReviewState: "approved"` promotion path | 🟡 Type exists; no promotion workflow found |

---

## Conclusion

The architecture is sound. The core contracts are consistent with implementation. Real enforcement exists at the Tauri boundary for archive writes and add-on capability gates. The SDK boundary is clean — no add-on code reaches into kernel internals. The major actionable items are:

1. **Fix `"primary-unavailable"` dead union variant** — either emit it or remove it
2. **Add `ProviderCatalogTemplate` to contracts** — required by ADR-005, missing
3. **Complete ADR-026 migration** — remove `archive-ingest.core` and `hermes.agent` from kernel agent defaults
4. **Add `systemSlots` validation** — currently unvalidated in `validation.ts`
5. **Simplify `AddOnSdkManifest`** — it re-declares all optional fields already on `AddOnManifest`
