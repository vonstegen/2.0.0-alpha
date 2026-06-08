# Architecture & Code Quality Review — ResonantOS 2.0.0-alpha
**Reviewer:** Nightwatch Subagent  
**Date:** 2026-06-08  
**Scope:** ADR-026 compliance, App.tsx structure, contracts.ts, error handling, race conditions, test quality, dead code

---

## Executive Summary

The codebase is in **good shape for an alpha**. The module boundary structure is well-designed, intent citations are present, and the memory-provider broker abstraction for ADR-026 is implemented. The main weaknesses are: one genuine race condition in a chat initiator function, a partial ADR-026 violation where Living Archive–specific commands live in the kernel without a migration path, a 3,158-line monolith App.tsx carrying ~25 archive-specific state slices that should be owned by ArchiveWorkspace, and a handful of silent error swallows in browser session management.

---

## 1. ADR-026 Compliance

### ✅ What's Correct

- `memory-provider.ts` implements `MemoryProviderBroker` — a proper neutral broker interface with both `living-archive` and `http-json` adapters. Third-party memory providers can work.
- `system-slots.ts` + `applyFirstRunRecommendedAddOns` correctly enforce slot availability gating — if an ADR-026-compliant manifest exists, the slot requires a granted add-on.
- `src/App.tsx` lines 575–684 correctly skip native archive commands when a non-Living Archive provider owns the memory-system slot, routing through the broker instead.
- `assert_living_archive_host_access` in `host_state.rs` (line 197) gates every native archive command on `addon.living-archive` being installed, enabled, and holding `memory-provider` capability.
- `first-run` review and `recommendedSystemSlotManifests` are implemented per spec.
- Reference memory service at `examples/reference-memory-service.mjs` proves the broker contract works.

### ⚠️ MEDIUM — Living Archive Host Commands Live in the Kernel (ADR-026 §Implementation Consequences)

**File:** `src-tauri/src/lib.rs`, lines 957–993 and the 32 `archive_*` commands gated by `assert_living_archive_host_access`.

**Problem:** ADR-026 says: *"If a different memory add-on owns the memory-system slot, the bundled Living Archive workspace and host commands must stop rather than silently operating as core memory."* The commands stop correctly (via `assert_living_archive_host_access`), but they still live in the kernel's command registry. The kernel has `archive_runtime_status`, `archive_maintenance_cycle`, `archive_process_ingest_request`, `living_archive_memory_service_start`, `living_archive_memory_service_stop`, etc. directly in `lib.rs`. Per ADR-026's spirit — "Existing archive Rust services can remain host-mediated implementation details, but they are activated through the memory-system slot and grants" — this is compliant at runtime, but there is no migration plan or path toward these commands being under `addon.living-archive`'s ownership rather than the kernel.

**Risk:** If someone disables Living Archive and the guard changes or a bug is introduced, native archive commands could run without a real memory provider. The guard is the only separation layer.

**Recommendation:** Document explicitly that these are `addon.living-archive`'s IPC surface. Add a comment block at line 431 in `lib.rs` marking the section as "Living Archive add-on IPC boundary — requires addon.living-archive + memory-provider grant." This makes the intent machine-readable.

### ⚠️ LOW — `CoreSectionId` Hardcodes `"archive"` as a Core Section

**File:** `src/core/contracts.ts`, line 43

```typescript
export type CoreSectionId = "overview" | "strategist" | "archive" | "delegation" | "compute" | "addons" | "settings";
```

Per ADR-026, `archive` is provided by `addon.living-archive`, not by the kernel. Including `"archive"` in `CoreSectionId` contradicts this. If a user replaces Living Archive with an HTTP provider, the section should not appear as a core section. It should be a section registered by the add-on manifest.

**Severity:** LOW — functional impact is minimal since the archive workspace checks slot availability, but the type is semantically wrong.

### ⚠️ LOW — `LivingArchiveMemoryServiceStatus` / `LivingArchiveMemoryServiceResult` in Core Contracts

**File:** `src/core/contracts.ts`, lines 2579–2600

These types are Living Archive-specific service management types (PID, endpoint, memoryRoot, sessionId). They belong in `addon.living-archive`'s own types, not in the kernel contracts. The kernel should only have a generic `MemoryProviderStatus` concept.

**Impact:** Low — no runtime bug, but violates the kernel-minimal principle and adds Living Archive coupling to the contracts baseline.

---

## 2. App.tsx Complexity — 3,158 Lines

### ⚠️ HIGH — Archive State Monolith in Root Component

The single `App` component in `src/App.tsx` owns:
- **25 archive-specific state slices** (lines 352–380): `archiveStatus`, `archiveSearchResult`, `archiveDocument`, `archiveQueue`, `archiveReviewArtifacts`, `archiveProcessResult`, `archiveReviewDecisionResult`, `archivePromotionResult`, `archiveMaintenanceResult`, `archiveAiMemoryBuildResult`, `archiveAiMemoryBuildJobs`, `archiveBackgroundResult`, `archiveLintResult`, `archiveSemanticLintResult`, `archiveTolBundles`, `archiveTolBundleResult`, `archiveSourceScanBusy`, `archiveSourceScanResult`, `archiveImportedLibraries`, `archiveClassificationReview`, `archiveReorganisationPlan`, `archiveLibraryImportResult`, `archiveLibraryPreflightResult`, `archiveProbeBusy`, `archiveProbeResult`
- **~15 archive action handlers**: `runArchiveMaintenance`, `runArchiveHealthLint`, `runArchiveSemanticHealthLint`, `refreshArchiveTolBundles`, `runArchiveIngestProbe`, `runArchiveLibraryPreflight`, `runArchiveLibraryImport`, `startArchivePreflightAugmentorSession`, `sendLivingArchiveAgentMessage`, `runArchiveReviewDecision`, `runArchivePromotion`, `runApprovedArchivePromotion`, `refreshArchiveRuntime`, `refreshArchiveQueue`, `refreshArchiveImportedLibraries`
- **201 total `const`/`let` declarations** in the main function body

**Viable extraction without redesign:**

1. **`useArchiveWorkspaceState` hook** (medium effort): Lift the ~25 archive state slices + auto-load effects (lines 570–601) + all archive action handlers into a single custom hook. `App.tsx` passes the hook result to `ArchiveWorkspace`. This alone removes ~600 lines from `App.tsx` and makes `ArchiveWorkspace` truly self-contained.

2. **`useProviderDiagnosticsState` hook** (low effort): Encapsulate `providerDiagnostics`, `providerDiagnosticsBusy`, and the diagnostics refresh handler.

3. **`useChatRailState` hook** (medium effort): Encapsulate `composer`, `chatBusy`, `chatRunPhase`, `chatRunEvents`, `chatNotice`, `activeChatRunTokenRef`, `selectedChatModel`, `thinkingDepth`, `attachments`, `dictating`, and all send handlers. This is already partially done via `modules/chat/controller.ts`.

### ⚠️ MEDIUM — Dead Imports / Unused Code Not Present, But Lazy-Loading Structure Is Correct

All workspace imports use `React.lazy()` — correct. No dead components found. The lazy loading pattern is well-applied and consistent across all 12 workspace surfaces.

### ✅ No Obvious Dead Code in App.tsx

No commented-out blocks, no TODO/FIXME/HACK markers anywhere in the codebase.

---

## 3. contracts.ts — 2,917 Lines (Note: Not 74K — file counts correctly)

### ⚠️ MEDIUM — Module-Specific Types in Core Contracts

`contracts.ts` (2,917 lines, 345 exports) contains types that belong in their modules:

| Types | Where They Belong |
|-------|------------------|
| `ObsidianVaultStatus`, `ObsidianNoteSummary`, `ObsidianNotePayload`, `ObsidianVaultIndex` (lines 1040–1130) | `modules/obsidian/contracts.ts` |
| `HermesInstallStatus`, `HermesChatResult`, `HermesDashboardStatus`, `HermesInventory`, `HermesGatewayStatus` (lines 724–800) | `modules/hermes/contracts.ts` |
| `BrowserWorkspaceTabState`, `BrowserControlledSessionState`, `BrowserWorkspaceState` (lines 2490–2512) | `modules/browser/contracts.ts` |
| `TerminalRunCommandResult`, `TerminalPtySessionResult` (lines 2878–2894) | `modules/terminal/contracts.ts` |
| `PaperclipStatus`, `PaperclipServiceResult`, `PaperclipDashboardSnapshot` (lines 2557–2636) | `modules/paperclip/contracts.ts` |
| `LivingArchiveMemoryServiceStatus`, `LivingArchiveMemoryServiceResult` (lines 2579–2600) | `addons/living-archive/contracts.ts` |

**Impact:** Every module that imports one type from `contracts.ts` pulls the entire file. While TypeScript tree-shakes at compile time, the developer ergonomics are poor — you cannot isolate module types without reading 2,917 lines.

### ⚠️ LOW — Potentially Unused Structural Types

`ContextFact`, `ContextPreference`, `ContextTask`, `ContextArtifactRef`, `ContextRisk`, `ContextQuestion` (lines 2711–2759) are sub-types of `ContextMemoryState`. They are only referenced within `contracts.ts` itself (in `ContextMemoryState`'s fields). They are used in `context-memory.test.ts` for constructing test data but no production code constructs these typed objects directly. They are data-structure definitions for the compaction format — legitimate, but worth documenting as such.

---

## 4. Error Handling — 5 Critical Code Paths

### Path 1: Provider Execution (Chat Streaming)

**Files:** `src/core/runtime.ts` lines 307–345, `src/modules/chat/controller.ts` lines 639–930

**✅ Good:**
- `requestProviderServiceChatCompletionStream` properly `unlisten()`s in a `finally` block (runtime.ts line 342). No event listener leak.
- Streaming fallback to non-streaming on stream error is implemented (controller.ts lines 869–876).
- The outer try/catch in `executeChatTurn` (controller.ts line 919) catches all provider failures and surfaces them as failed messages, not crashes.

**⚠️ MEDIUM — Non-streaming fallback swallows stream errors on stale runs:**
```typescript
// controller.ts line 869
.catch((streamError) => {
  if (streamedReply || !isRunCurrent(runToken)) {
    throw streamError;  // re-throw if run is stale or already has content
  }
  // otherwise, falls back silently
  return nonStreamingRequest();
})
```
If a partial stream delivers some content then fails, `streamedReply` is truthy and the error is re-thrown — correct. But if the stream fails immediately with zero content, the fallback runs silently without logging. There is no visibility into which route is being used or why the fallback was triggered.

### Path 2: Archive Ingest

**File:** `src/modules/archive/controller.ts` lines 1048–1125

**✅ Good:**
- `setArchiveQueueBusy(false)` is in a `finally` block — busy state always clears.
- `errorMessageOf` is consistently used across all archive handlers.

**⚠️ MEDIUM — `Promise.all` in background cycle loses partial results on any failure:**

```typescript
// controller.ts line 1109
const [queue, artifacts] = await Promise.all([memoryProvider.reviewQueue(), memoryProvider.reviewArtifacts()]);
```
If `reviewQueue()` succeeds but `reviewArtifacts()` throws (or vice versa), both are lost. The cycle result was already written to state (`setArchiveBackgroundResult(result)`) before this `Promise.all`. The user would see a chat notice about the failure but not know the background cycle itself succeeded.

**Recommendation:** Use `Promise.allSettled()` with fallback to empty arrays on individual failures, or wrap each in its own try/catch.

### Path 3: Delegation

**File:** `src/modules/chat/controller.ts` lines 265–300 (`/delegate` command path)

**✅ Good:**
- `validateDelegationPacket` runs before `requestCreateTaskWorkspace` — validation errors are surfaced as command failures, not API failures.
- The delegation workspace creation error propagates to the outer catch correctly.

**⚠️ LOW — No distinction between validation failure and IPC failure at the user surface:**
Both a bad packet (validation) and a failed workspace creation (IPC error) produce a `failed` chat message with the same `failed` phase marker. The user cannot tell whether re-trying would help. No recommendation to surface these differently unless this is an intentional UX choice.

### Path 4: Recovery

**File:** `src/modules/recovery/controller.ts`

**✅ Clean:** `setRecoveryMode` and `promoteRecoveryRoute` are pure state mutation functions. No async operations, no error paths. All error handling is inherited from `executeChatTurn`'s outer try/catch when recovery runs use the chat turn infrastructure. No issues.

### Path 5: Browser Session Management

**File:** `src/modules/browser/BrowserWorkspace.tsx`

**⚠️ HIGH — Silent error suppression in native webview operations:**

```typescript
// BrowserWorkspace.tsx line 319
void resize?.(bounds).catch(() => undefined);
// line 334
void hostCallbacksRef.current.onHideLiveWebview?.().catch(() => undefined);
// line 340
void hostCallbacksRef.current.onHideNativeWebview?.().catch(() => undefined);
// line 348
void hostCallbacksRef.current.onHideNativeWebview().catch(() => undefined);
// line 224
.catch(() => undefined); // on navigation
```

Five `.catch(() => undefined)` calls silently discard native webview errors. If the native webview fails to show/hide/resize, the UI will be in an inconsistent state (e.g., native webview still showing behind the workspace) with no user feedback and no log entry.

**Recommendation:** At minimum, replace `.catch(() => undefined)` with `.catch((e) => console.warn("Browser native op failed:", e))` so diagnostics are possible. For show/open operations, surface to chat notice.

---

## 5. Race Conditions

### 🔴 HIGH — `startArchivePreflightAugmentorSession` Bypasses `claimChatRun` Guard

**File:** `src/App.tsx`, lines 1450–1453

```typescript
const runToken = `chat-run-${threadId}-${Date.now()}`;
activeChatRunTokenRef.current = runToken;  // line 1451: direct write, bypasses guard
await executeChatTurn({ ... });
```

All other callers (`sendStrategistMessage`, `sendLivingArchiveAgentMessage`) use `claimChatRun(activeChatRunTokenRef, threadId)` which is a synchronous ref check. This function writes directly to the ref.

**Why it matters:** `chatBusy` (React state) is checked first (line ~1403), but React state is asynchronous — if two calls arrive in the same event loop tick, both can pass the `chatBusy` check before either sets it to `true` via `setChatBusy(true)` inside `executeChatTurn`. The `activeChatRunTokenRef` is a `useRef` that updates synchronously, which is exactly why `claimChatRun` exists and is used elsewhere.

**Fix:** Replace lines 1450–1453 with:
```typescript
const runToken = claimChatRun(activeChatRunTokenRef, threadId);
if (!runToken) {
  setChatNotice("Another agent turn is already running.");
  return;
}
```
And replace the release at line 1474 with `releaseChatRun(activeChatRunTokenRef, runToken)`.

### ⚠️ MEDIUM — Archive Background Cycle Has No Programmatic Concurrent-Call Guard

**File:** `src/App.tsx`, `runArchiveMaintenance` at line 1174

`runArchiveBackgroundCycle` sets `archiveQueueBusy(true)`, which disables the UI button (`ArchiveReviewDesk.tsx` line 112, `disabled={archiveQueueBusy}`). This is UI-layer protection only. No programmatic guard prevents a concurrent invocation if triggered programmatically (e.g., from an agent tool, a keyboard shortcut, or a timing edge case where state hasn't propagated yet).

**Recommendation:** Add an early return:
```typescript
const runArchiveMaintenance = async () => {
  if (archiveQueueBusy) return;
  // ...
};
```

### ✅ Runtime State Subscription Race Handled Correctly

`App.tsx` lines 424–444: Uses `cancelled` flag + `unlisten()` pattern for cleanup on unmount. The race between async subscription setup and component unmount is handled correctly.

---

## 6. Test Quality — 10 Files Reviewed

### ✅ Behavior-Focused, Well-Structured Tests

| File | What It Tests | Quality |
|------|--------------|---------|
| `run-guard.test.ts` | Concurrent claim prevention, stale token rejection | ✅ Behavioral, clear intent |
| `provider-service.test.ts` | Route resolution with real state shapes | ✅ Behavioral — tests routing logic not internals |
| `system-slots.test.ts` | ADR-026 first-run slot gating | ✅ Directly validates architectural spec |
| `delegation.test.ts` | Packet validation rules, rendering, edge cases | ✅ Thorough — covers vague missions, missing fields, risky approvals |
| `policies.test.ts` | Archive action policy, provider routing | ✅ Clean behavior tests |
| `memory-provider.test.ts` | Broker resolution with Living Archive vs HTTP-JSON | ✅ Tests broker abstraction correctly |
| `context-memory.test.ts` | Compaction, branching, state consistency | ✅ Non-trivial logic well-covered |

### ⚠️ Tests That Over-Test Implementation Details

**`controller.test.ts` (chat), line 372:**
```typescript
it("commits the user message and Hermes placeholder before the Hermes bridge resolves", async () => {
```
This test verifies the *order of state commits* before an async bridge resolves. This is implementation detail testing — it tests how the state is committed internally, not what the user sees. If the internal commit ordering is refactored (e.g., commit both messages atomically), this test breaks even though behavior is preserved.

**`controller.test.ts` line 444:** Similar pattern — tests timing of placeholder vs bridge resolution.

### ⚠️ Coverage Gaps

**Missing test coverage:**

1. **`startArchivePreflightAugmentorSession` concurrency behavior** — the race condition described in §5 has no test.
2. **Archive `Promise.all` partial failure** — no test for `reviewQueue()` succeeding while `reviewArtifacts()` fails.
3. **Browser session silent error swallows** — no test verifying webview hide/show failures are at least logged.
4. **Memory provider HTTP-JSON degradation paths** — `memory-provider.test.ts` tests the happy path but not what happens when the HTTP endpoint is unreachable mid-operation.
5. **`merge_safe_state_fields` in lib.rs** — the whitelist that protects security fields from renderer overwrite has no Rust test. This is a security-critical function.

---

## 7. Dead Code

**No dead code found.** The codebase is notably clean:
- No TODO/FIXME/HACK/TEMP comments anywhere in `src/`
- No commented-out code blocks
- All lazy-loaded workspace components are reachable from `navItems` and add-on dock routes
- No unused exports visible in the core modules

**Potential cleanup items (not dead, but worth noting):**

- `ContextFact`, `ContextPreference`, `ContextTask`, `ContextArtifactRef`, `ContextRisk`, `ContextQuestion` in `contracts.ts` are only used as sub-types of `ContextMemoryState`. They are valid but could use a doc comment explaining they're the context compaction format, since nothing instantiates them directly in production code.

---

## Summary Table

| # | Finding | Severity | File | Line(s) |
|---|---------|---------|------|---------|
| 1 | `startArchivePreflightAugmentorSession` bypasses `claimChatRun` guard | 🔴 HIGH | `src/App.tsx` | 1450–1453 |
| 2 | Browser native webview silent error swallows (.catch(() => undefined) ×5) | 🔴 HIGH | `src/modules/browser/BrowserWorkspace.tsx` | 224, 319, 334, 340, 348 |
| 3 | 25 archive state slices + handlers in root App component | ⚠️ HIGH | `src/App.tsx` | 352–380, ~1080–1250 |
| 4 | Living Archive host commands in kernel without migration path/comment (ADR-026) | ⚠️ MEDIUM | `src-tauri/src/lib.rs` | 431–503, 957–993 |
| 5 | `Promise.all` in background cycle loses partial results on any failure | ⚠️ MEDIUM | `src/modules/archive/controller.ts` | 1109 |
| 6 | Archive background cycle lacks programmatic concurrent-call guard | ⚠️ MEDIUM | `src/App.tsx` | 1174 |
| 7 | Module-specific types (Obsidian, Hermes, Browser, Terminal, Paperclip) in core contracts.ts | ⚠️ MEDIUM | `src/core/contracts.ts` | Various |
| 8 | Streaming fallback runs silently without logging route change reason | ⚠️ MEDIUM | `src/modules/chat/controller.ts` | 869–876 |
| 9 | `CoreSectionId` includes `"archive"` as a core section (ADR-026 semantic violation) | ⚠️ LOW | `src/core/contracts.ts` | 43 |
| 10 | `LivingArchiveMemoryServiceStatus/Result` types in kernel contracts, not add-on | ⚠️ LOW | `src/core/contracts.ts` | 2579–2600 |
| 11 | Controller tests over-test state commit ordering (implementation details) | ⚠️ LOW | `src/modules/chat/controller.test.ts` | 372, 444 |
| 12 | `merge_safe_state_fields` security whitelist has no Rust unit test | ⚠️ LOW | `src-tauri/src/lib.rs` | 185–213 |
| 13 | Missing tests: preflight concurrency, partial archive failure, HTTP memory degradation | ⚠️ LOW | Various test files | — |

---

## Priority Fixes Before Release

1. **🔴 Fix the `claimChatRun` bypass in `startArchivePreflightAugmentorSession`** (1-line fix with 2-line release). This is a real concurrent-invocation bug.
2. **🔴 Replace silent `.catch(() => undefined)` in BrowserWorkspace.tsx** with at minimum a `console.warn`. Silent webview failures cause invisible UI state corruption.
3. **⚠️ Add early-return guard in `runArchiveMaintenance`** checking `archiveQueueBusy` before proceeding.
4. **⚠️ Replace `Promise.all` with `Promise.allSettled`** in the background cycle's queue/artifacts fetch.
5. **⚠️ Add comment block in `lib.rs`** marking the Living Archive IPC boundary to document the migration intent per ADR-026.
