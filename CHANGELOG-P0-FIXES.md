# CHANGELOG-P0-FIXES.md

This changelog records key fixes and validations completed for the ResonantOS 2.0.0-alpha workspace.

## Summary of Changes - June 8, 2026

### 1. Verification of Main Workspace Default Page Configuration (Task 1)

* **Objective:** Ensure that opening a new tab/window defaults to opening the ResonantOS main workspace (Augmentor chat/`"answer"` workspace) rather than a blank page.
* **Findings & Validation:**
  * Checked `browser-first/resonantos-side-panel-extension/manifest.json`. Verified that `chrome_url_overrides.newtab` is correctly configured to point to `src/main-workspace.html`.
  * Checked `browser-first/resonantos-side-panel-extension/src/main-workspace.js`. Verified that on startup, `hydrateActiveWorkspace` correctly reads from `chrome.storage.local`. If no deep link hash is present (e.g. on opening a new tab/window), `!requestedDeepLink` evaluates to `true`, forcing the active workspace to fallback safely to `"answer"` (representing the Augmentor main workspace) and ensures a fresh active chat session exists.
  * Verified that `browser-first/host/browser-profile-service.mjs` configures the Chromium profile preference file (`Preferences`) to set `chrome_url_overrides.newtab` pointing to the extension's unpacked main workspace page.
  * Confirmed that no blank page occurs under any standard startup conditions. Both the extension's manifest-level overrides and runtime-level routing are perfectly aligned.

### 2. Elimination of Dead Union Variant in `RoutingResolutionReason` (Task 2)

* **Objective:** Remove the dead union variant `"primary-unavailable"` from `RoutingResolutionReason` in `src/core/contracts.ts` (as identified in `AUDIT-ARCHITECTURE.md` Issue #1).
* **Changes Made:**
  * Modified `src/core/contracts.ts` to remove `"primary-unavailable"` from the `RoutingResolutionReason` union definition.
  * Verified that `resolveProviderRoute()` in `src/core/policies.ts` only emits `"primary-healthy"`, `"fallback-in-policy"`, `"resurrection-available"`, and `"no-viable-route"`. The `"primary-unavailable"` variant was dead code and is now safely removed.
  * Performed a complete codebase audit to confirm that no other files or tests referenced `"primary-unavailable"` or expected it to be handled inside any branching logic.
  * Executed TypeScript compiler type-checking (`npx tsc --noEmit`) to guarantee code type-safety after the type removal.
  * Executed Vitest test suite (`npm run test`) to ensure all 296 unit/integration tests continue to pass successfully.
