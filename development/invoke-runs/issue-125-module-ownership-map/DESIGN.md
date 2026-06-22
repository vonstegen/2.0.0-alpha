# Design: Issue 125 Module Ownership Map

## Shape

Use a concise Markdown ownership table for `src/modules/*`, followed by data-flow and host-boundary sections. Keep `MODULE_MAP.md` as historical/deep context and make `MODULE-OWNERSHIP.md` the current contributor-facing contract.

## Test Design

The doc contract test discovers module directories from disk rather than hardcoding the current set. This makes the test fail when a future module is added without updating the ownership map.

## Host Boundary Design

The issue names `src-tauri/src/`, but this browser-first branch does not contain that directory. The new doc records that absence explicitly and maps the active host/IPC equivalent:

- `browser-first/host/`
- `browser-first/resonantos-side-panel-extension/src/lib/bridge-client.js`
- `addons/resonant-browser-host/`

