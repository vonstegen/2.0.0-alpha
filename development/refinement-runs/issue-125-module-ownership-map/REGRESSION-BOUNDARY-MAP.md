# Regression Boundary Map

## Upstream Dependencies

- Issue #125 acceptance criteria.
- `docs/architecture/ADR-002-modular-codebase.md` for module and shell-composition rules.
- `docs/architecture/ADR-003-engineering-standards.md` for architecture-doc update rules.
- Current `src/modules/` directory inventory.
- Current browser-first host boundary under `browser-first/host/`.
- Current contributor process in `CONTRIBUTING.md`.

## Downstream Dependents

- Contributors adding modules under `src/modules/`.
- Contributors moving ownership out of `App.tsx`.
- Reviewers checking PRs for module-boundary drift.
- Architecture readers following `docs/README.md`.
- CI/local validation that should catch missing or stale module ownership docs.

## Intended Write Scope

- `docs/architecture/MODULE-OWNERSHIP.md`
- `docs/README.md`
- `CONTRIBUTING.md`
- `scripts/module-ownership-doc.test.mjs`
- issue-loop artifacts under `development/*/issue-125-module-ownership-map/`

## Non-Goals

- Do not refactor modules.
- Do not update stale Tauri-era code references outside the new ownership doc unless they are needed for navigation.
- Do not change app behavior, provider routing, host services, or generated build output.

## Focused Test Plan

Add `scripts/module-ownership-doc.test.mjs` before creating the ownership doc. The test should assert:

- `docs/architecture/MODULE-OWNERSHIP.md` exists.
- every current directory under `src/modules/` is named in the ownership table.
- the doc includes data-flow and host-boundary sections.
- `CONTRIBUTING.md` points PR authors to the ownership map for module additions or ownership changes.

The pre-fix baseline should fail because the new ownership document does not exist yet.

