# Define: Issue 125 Module Ownership Map

## Outcome

Create a current, reviewable module ownership contract for the browser-first product branch.

## Done Criteria

- The document lists every `src/modules/*` directory.
- It separates shell state, module controllers, shared contracts, and host boundaries.
- It names the current browser-first host boundary and explains that `src-tauri/src/` is absent in this branch.
- Contributor PR guidance requires updating the ownership map when modules are added or ownership moves.
- A focused doc contract test passes.

## Non-Goals

- No runtime behavior changes.
- No module refactors.
- No replacement of ADR-002 or ADR-003.

