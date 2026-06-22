# Issue 125 Refinement: Module Ownership Map

## Ticket

- Issue: https://github.com/ResonantOS/2.0.0-alpha/issues/125
- Title: docs: Module ownership architecture map for codebase
- Claim: assigned to `vrondelli`; Project 2 status moved to In Progress.

## Refined Problem

The repository has module-splitting rules in ADR-002 and an older `MODULE_MAP.md`, but issue #125 asks for a current repo-level ownership artifact named `docs/architecture/MODULE-OWNERSHIP.md`. The new artifact must make ownership auditable for contributors as code continues moving out of `App.tsx`.

## Evidence

- `docs/architecture/ADR-002-modular-codebase.md` requires domain modules and says module-to-module dependencies should go through `src/core/` contracts or props.
- `docs/architecture/ADR-003-engineering-standards.md` requires docs updates when ownership or architecture changes.
- `docs/architecture/MODULE_MAP.md` already contains useful ownership material but references `src-tauri/src`, which is absent in this browser-first checkout.
- Current module directories under `src/modules/`: addons, archive, browser, chat, compute, delegation, hermes, obsidian, opencode, overview, paperclip, recovery, settings, shell, strategist.
- Current host boundary lives mainly under `browser-first/host/`, plus add-on host material under `addons/resonant-browser-host/`; `src-tauri/src/` is not present in this branch.

## Acceptance

- Create `docs/architecture/MODULE-OWNERSHIP.md`.
- List every module under `src/modules/` with responsibilities.
- Show module data-flow rules and shared-state ownership.
- Document current IPC/host boundaries, including the absence of `src-tauri/src/` in this checkout.
- Update contributor PR checklist guidance so module additions/ownership moves update the ownership map.
- Add a deterministic doc contract test that fails while the ownership doc is missing and passes after the doc/checklist are present.

