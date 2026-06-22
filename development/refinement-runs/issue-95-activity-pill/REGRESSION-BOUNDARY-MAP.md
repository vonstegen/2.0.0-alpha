# Regression Boundary Map

## Issue

- Repository: ResonantOS/2.0.0-alpha
- Issue: #95 - Browser control overlay activity pill plain language
- Branch/worktree: `issue-95-activity-pill` at `/home/vrondelli/projects/workspace-resonant/2.0.0-alpha-issue-95-activity-pill`
- Base branch: `origin/dev`

## Intended Fix

- Target behavior: Agent Control keeps the page overlay active for the full run and updates the bottom pill with stable, plain current-action words instead of planner/run-state phrasing.
- Intended write scope: `control-run-state.js`, `agent-control-runner.js`, a small shared overlay action mapper if needed, focused browser-first tests, and development run artifacts.
- Non-goals: no planner strategy changes, no permission policy changes, no monitor layout redesign, no report/schema migration, no browser host changes, no unrelated settings or archive work.

## Upstream Dependencies

- Callers/routes:
  - `createAgentControlRunner()` calls `setPageControlOverlay()` for read, act, verify, retry, blocked, and finish states.
  - `createControlRunState()` owns `startControlRun()`, `updateControlStep()`, and `finishControlRun()`.
  - `createBrowserPageActions()` sends `control_overlay` messages to the content script.
- Data contracts/state:
  - Browser job `steps`, `status`, `artifacts`, `pageLock`, and `timing` must remain unchanged.
  - Step `details.action`, `details.phase`, `note`, and planner history must keep existing detailed labels for monitor/report use.
  - Content script accepts `{type:"control_overlay", active, label, phase}` and routes to `setControlSessionOverlay()`.
- Configuration/feature flags:
  - Site permission modes allow `control_overlay` even under `read-only`; this must not regress.
- Generated or canonical sources:
  - No generated source or mirror is affected.
- Existing tests:
  - `browser-first/test/control-run-state.test.mjs`
  - `browser-first/test/agent-control-runner.test.mjs`
  - `browser-first/test/browser-page-actions.test.mjs`
  - full `npm run test:browser-first`

## Downstream Dependents

- UI/API surfaces:
  - In-page activity pill and page border overlay.
  - Side-panel control monitor and job monitor should keep detailed action trace.
  - Main workspace active browser job status strip should keep job state semantics.
- External consumers:
  - Browser job persistence and saved control reports consume step details, not the public pill label.
- Generated mirrors/artifacts:
  - None.
- CI/release jobs:
  - `npm test -- --run`, `npm run test:browser-first`, `npm run build`.
- Docs/help/onboarding:
  - `docs/UX_AUDIT_2026-06-01.md` requirement becomes implemented behavior.

## Test-First Plan

- Regression test to create/update/reuse:
  - Update `control-run-state.test.mjs` to expect plain active overlay labels while preserving detailed blocked labels.
  - Add `control-run-state.test.mjs` coverage for the action vocabulary mapping across read/click/type/wait/open/search/switch_tab/inspect/forms/tabs/scroll.
  - Add `browser-page-actions.test.mjs` coverage that `setPageControlOverlay()` sends `control_overlay` even when the site permission is read-only.
- Expected pre-fix behavior:
  - Active step labels include "Augmentor: <step label>: <note>" and phases such as `acting`/`navigating` that the content overlay falls back to `working`.
  - The read-only control overlay path is important but currently implicit.
- Adjacent behavior that must not change:
  - Step notes/details in monitor and reports stay detailed.
  - Blocked and cancelled overlays still include enough context.
  - Delayed overlay release still prevents flicker on short runs.
- Focused validation command:
  - `node --test --test-concurrency=1 browser-first/test/control-run-state.test.mjs browser-first/test/browser-page-actions.test.mjs browser-first/test/agent-control-runner.test.mjs`
- Broader validation command:
  - `npm run test:browser-first`
  - `npm test -- --run`
  - `npm run build`

## Scope Containment Check

- Changed files match intended scope: pass
- Upstream behavior preserved: pass - runner and run-state tests cover the overlay call path while preserving step notes/details.
- Downstream behavior preserved: pass - browser page action test keeps the read-only `control_overlay` permission exception covered; browser-first suite and build passed.
- Expansion rationale, if any: added `control-overlay-actions.js` to keep runner and run-state vocabulary in one place.

## Result

- Status: pass
- Evidence:
  - Pre-fix focused test failed on active overlay labels still using `Augmentor: ...` and `acting` phases.
  - Focused validation passed: `node --test --test-concurrency=1 browser-first/test/control-run-state.test.mjs browser-first/test/browser-page-actions.test.mjs browser-first/test/agent-control-runner.test.mjs` - 47/47.
  - Browser-first validation passed: `npm run test:browser-first` - 591/591.
  - Repo validation passed: `npm test -- --run` - 37 files, 308 tests.
  - Build passed: `npm run build`.
- Follow-up: none.
