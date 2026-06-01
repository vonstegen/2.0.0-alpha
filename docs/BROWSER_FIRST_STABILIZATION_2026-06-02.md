# Browser-First Stabilization Report

Date: 2026-06-02
Branch: `browser-first-preview`

## Purpose

This report is the release-scope checkpoint for the browser-first ResonantOS work. It exists to prevent drift after long implementation sessions: before pushing or releasing, compare the current worktree against this document and only ship changes that belong to the intended browser-first product boundary.

## Current Product Boundary

The active product direction is the browser-first ResonantOS app defined by `ADR-037`: a Chromium-family browser host with the ResonantOS side-panel extension, Augmentor chat, governed browser control, provider fabric, Living Archive memory flows, and add-on delegation surfaces.

The earlier desktop/Tauri vNext app remains a reference and compatibility reservoir, but it is not the release target for this branch unless a change is explicitly required by the browser-first product.

## Worktree Classification

Current dirty tree classification at the time of this report:

- `browser-first`: 42 modified, 72 untracked, 114 total. This is the primary release scope.
- `docs`: 5 modified, 2 untracked, 7 total. Include only docs that describe the browser-first product or stabilization state.
- `addons/resonant-browser-*`: 3 modified, 0 untracked, 3 total. Include only if they support the browser-first host/extension bridge.
- `electron-host`: 2 modified, 0 untracked, 2 total. Treat as experimental unless explicitly needed by the browser-first release.
- `legacy-vNext/shared`: 27 modified, 0 untracked, 27 total. Do not include in a browser-first push unless each file has a clear browser-first dependency and matching tests.

## Verified Behavior

The following checks passed on 2026-06-02:

- `node --test browser-first/test/browser-first-contract.test.mjs browser-first/test/side-panel-lifecycle-controller.test.mjs`
  - Result: passed.
  - Note: sandbox-denied localhost bridge tests were skipped by the test harness.
- `npm run test:browser-first`
  - Result: passed, 504 passed, 9 skipped.
  - Coverage includes Agent Control, browser job scheduling, approval boundaries, provider routing, governed add-on delegation, Living Archive review/promotion, move-on-import, settings, chat sessions, side-panel renderers, and browser-first contracts.
- `npm run build`
  - Result: passed.
  - Note: existing large chunk warning remains.
- `git diff --check`
  - Result: passed.
- Syntax checks on key browser-first entrypoints:
  - `browser-first/resonantos-side-panel-extension/src/side-panel.js`
  - `browser-first/resonantos-side-panel-extension/src/main-workspace.js`
  - `browser-first/host/run-browser-first.mjs`
- `git diff --check`
  - Result: passed after this report was added.
- Targeted high-confidence secret-pattern scan across changed and untracked paths.
  - Result: no high-confidence secret patterns found across 154 changed/untracked paths.
  - Note: an earlier broad regex false-positive matched the literal string `task-without-verification`; stricter key patterns did not reproduce it.
- `npm run browser-first:audit-scope`
  - Result: passed in normal mode and reported 126 browser-first include paths, 30 deferred paths, and 0 manual-review paths.
- `node scripts/browser-first-release-scope-audit.mjs --strict`
  - Result: failed as expected because deferred legacy/shared paths are still present in the worktree.
  - Meaning: strict mode should pass only after staging/splitting the browser-first release scope.
- `node scripts/browser-first-release-scope-audit.mjs --include-paths`
  - Result: emits only approved browser-first release paths, suitable for `git add --pathspec-from-file`.
- `npm run browser-first:audit-scope:staged`
  - Result: strict staged-index audit. It should pass only after the index contains approved browser-first release paths and no deferred paths.

## Architecture Health

Positive signals:

- The browser-first direction is still coherent: Augmentor lives in the side panel, the main workspace owns new-tab/full-chat surfaces, browser actions are host-mediated, and risky wallet/credential/public actions remain approval-gated.
- Large entrypoint files have been reduced by extracting host services, settings sections, action controllers, lifecycle controllers, renderers, and tests.
- Living Archive writes still follow review/promotion boundaries instead of direct trusted memory mutation.
- Delegation to Hermes/OpenCode is modeled as governed add-on work, not trusted-core agent replacement.
- Provider access remains mediated through provider fabric routes rather than raw add-on credentials.

Risks still present:

- `side-panel.js`, `main-workspace.js`, and `run-browser-first.mjs` are smaller but still large enough to become coordination bottlenecks.
- Some extracted modules are now large enough to need their own responsibility split, especially:
  - `browser-first/resonantos-side-panel-extension/src/lib/main-workspace-memory.js`
  - `browser-first/resonantos-side-panel-extension/src/lib/browser-page-actions.js`
  - `browser-first/resonantos-side-panel-extension/src/lib/settings/providers-section.js`
  - `browser-first/host/browser-first-self-test-service.mjs`
  - `browser-first/host/addon-delegation-service.mjs`
- Contract tests caught one stale implementation-coupled assertion after lifecycle extraction. This was fixed, but it shows contracts must follow stable boundaries, not exact monolith internals.
- The worktree includes legacy/shared changes that can confuse release scope if pushed with browser-first changes without review.

## Release Rules

Before the next push:

1. Include `browser-first/**` changes only after `npm run test:browser-first` and `npm run build` pass.
2. Include docs only when they describe browser-first architecture, feature inventory, stabilization state, or product status.
3. Include native browser add-on files only if their tests pass and they are required by the current browser-first launcher/bridge.
4. Exclude or separately commit legacy desktop/Tauri/shared files unless their browser-first dependency is written down.
5. Do not ship credentials, generated memory, browser profile data, runtime logs, private vault contents, or `.DS_Store` artifacts.
6. Do not claim localhost bridge behavior is verified in sandboxed Codex when the test harness marks it skipped due denied binding. Use the in-process smoke tests as sandbox evidence and run live bridge tests outside the sandbox before release.
7. Do not add more UI/feature work until the staged release scope is clean or intentionally split.
8. Run `npm run browser-first:audit-scope` before staging. Stage only approved paths, then run `npm run browser-first:audit-scope:staged` before committing.

## Non-Browser-First Changes Requiring Explicit Decision

The current non-`browser-first` diff includes 37 modified tracked files outside the primary release scope. These should not be bundled into the browser-first push without an explicit reason:

- Native browser add-on bridge and tests under `addons/resonant-browser-*`.
- Browser-host experimental files under `electron-host`.
- Living Archive MCP/example files under `examples`.
- Add-on manifests under `public/addons`.
- Shared health-check scripts.
- Legacy desktop/Tauri source and tests under `src`, `src-tauri`, and `src/modules`.
- Documentation updates under `docs`.

Default decision: include docs that directly explain browser-first stabilization, include native bridge files only if the browser-first launcher requires them, and keep the legacy desktop/Tauri changes separate.

### File-Level Decisions

Include with browser-first stabilization:

| Path | Decision | Reason |
| --- | --- | --- |
| `addons/resonant-browser-host/test/browser-host.test.mjs` | Include | Browser host live tests now skip cleanly when sandbox localhost binding is denied instead of failing for an environment limitation. |
| `addons/resonant-browser-native/native_host/src/resonant_browser_native_bridge_mac.mm` | Include | CEF click dispatch now sends a mouse-move before click, matching real browser interaction more closely. |
| `addons/resonant-browser-native/native_host/src/resonant_browser_native_host.cc` | Include | Keeps browser-first new tabs pointed at the ResonantOS AI workspace and suppresses first-run/crash-restore Chromium UI. |
| `docs/FEATURE_INVENTORY_2026-05-26.md` | Include | Updates browser-first feature inventory and current Memory Bridge status. |
| `docs/PROJECT_STATUS.md` | Include | Records browser-first direction and current Living Archive/move-on-import invariants. |
| `docs/README.md` | Include | Adds browser-first guide and stabilization entrypoints. |
| `docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md` | Include | Release-scope checkpoint for this branch. |
| `docs/PRODUCT_GUIDE_BROWSER_FIRST.md` | Include | Current browser-first product guide. |
| `docs/UX_AUDIT_2026-06-01.md` | Include | Cited by native host behavior and captures browser-first UX decisions. |
| `docs/architecture/addon-skills/living-archive/SOURCE_TO_WIKI_INTAKE.md` | Include | Defines source sync and move-on-import invariants used by the browser-first Living Archive UI/host flows. |
| `scripts/browser-first-release-scope-audit.mjs` | Include | Reproducible release-scope classifier for browser-first staging. |
| `package.json` | Include | Exposes `npm run browser-first:audit-scope`. |

Defer to a separate legacy/shared commit:

| Path group | Decision | Reason |
| --- | --- | --- |
| `src/**`, `src-tauri/**`, `public/addons/**`, `scripts/**` MiniMax M3 updates | Defer | Useful model-default update, but it belongs to the desktop/shared vNext provider layer, not the browser-first release stabilization. |
| `docs/architecture/AUDIO2TOL_INTAKE_ANALYSIS.md` | Defer | Audio2TOL model example update is not core browser-first work. |
| `examples/living-archive-mcp.*` and `examples/living-archive-memory-service.*` | Defer unless releasing MCP bridge now | The injected transport and localhost-skip hardening are useful, but they are example/MCP bridge scope and should not be bundled unless the release explicitly includes MCP. |
| `electron-host/**` | Defer | Electron is experimental/deprecated for the current browser-first product direction. |

If we decide to include any deferred group, it needs its own commit message, tests, and release note.

## Recommended Commit Split

Use small commits in this order:

1. Browser-first host/service hardening and bridge capability gates.
2. Browser-first side-panel chat, Agent Control, browser jobs, and UI controllers.
3. Browser-first main workspace, rail, settings, and workspace modules.
4. Living Archive browser-first memory flows and move-on-import hardening.
5. Tests for the above slices.
6. Documentation and stabilization report.

Keep legacy desktop/Tauri compatibility changes in a separate branch or separate commit after review.

## Deterministic Staging Workflow

Use this workflow to stage the browser-first release slice without manually copying path lists:

```bash
node scripts/browser-first-release-scope-audit.mjs --include-paths > /tmp/resonantos-browser-first-paths.txt
git add --pathspec-from-file=/tmp/resonantos-browser-first-paths.txt
npm run browser-first:audit-scope:staged
npm run test:browser-first
npm run build
git diff --cached --check
```

Expected current behavior:

- The worktree audit reports deferred legacy/shared files until those are separately committed, reverted, or left unstaged.
- The staged audit should pass after only the approved path list is staged.
- The browser-first release commit should not include deferred `src/**`, `src-tauri/**`, `electron-host/**`, `examples/**`, `public/addons/**`, or non-approved docs.

## Next Stabilization Action

The next implementation action should be a staging audit:

- inspect every non-`browser-first` modified file;
- decide whether it belongs to this browser-first branch;
- either document why it belongs, commit it separately, or leave it out of the browser-first push.

Only after that should feature work resume.
