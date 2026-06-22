# Task Session - Issue 95

## Start

- Claimed issue #95 and moved the Project 2 card to In Progress.
- Created isolated worktree from `origin/dev`.
- Selected a narrow implementation boundary around Agent Control overlay run state and tests.

## Dependency Map

See `development/refinement-runs/issue-95-activity-pill/REGRESSION-BOUNDARY-MAP.md`.

## Test-First Work

- Added failing regression tests for plain overlay action labels in `control-run-state.test.mjs` and `agent-control-runner.test.mjs`.
- Added explicit coverage for `control_overlay` under read-only site permission in `browser-page-actions.test.mjs`.
- Pre-fix focused test failed as intended: active labels still exposed `Augmentor: ...` and `acting` phases.

## Implementation Log

- Added `control-overlay-actions.js` to hold the public overlay vocabulary.
- Updated control run state so active step overlay labels are public words while step notes/details remain detailed.
- Updated runner overlay calls so read/decide/action/verify/retry flashes use the same public vocabulary.

## Validation

- `node --test --test-concurrency=1 browser-first/test/control-run-state.test.mjs browser-first/test/browser-page-actions.test.mjs browser-first/test/agent-control-runner.test.mjs` - pass, 47/47.
- `npm run test:browser-first` - pass, 591/591.
- `npm test -- --run` - pass, 37 files, 308 tests.
- `npm run build` - pass, with Vite's existing large chunk warning.
- Dependency note: the fresh worktree needed `npm ci --prefer-offline --no-audit --no-fund`; npm emitted an EBADENGINE warning because local Node is v22.12.0 and `jsdom@29.0.2` asks for v22.13.0+ or another compatible range, but install and validation completed.
