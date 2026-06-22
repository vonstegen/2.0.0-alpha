# Issue 95 Refinement

## Source

- Repository: ResonantOS/2.0.0-alpha
- Issue: #95, "feat: Browser control overlay - activity pill must show current action in plain language"
- Project: ResonantOS 2.0.0-alpha readiness
- Claimed by: vrondelli
- Status at claim: TODO -> In Progress

## Problem

Agent Control already has a persistent page overlay and a bottom activity pill, but the current run-state labels can expose implementation-shaped phrases such as "Augmentor: Clicking Reserve: ..." instead of the issue's user-facing action vocabulary. The desired pill language is plain and stable: reading, clicking, typing, verifying, and waiting for you.

The issue also asks that the overlay stay active for the full control run rather than only per step. Existing run-state coverage already protects delayed release and old-release suppression. This run should preserve that behavior while tightening the action vocabulary.

## Relevant Evidence

- `docs/UX_AUDIT_2026-06-01.md` calls out the exact UX requirement.
- `browser-first/resonantos-side-panel-extension/src/lib/control-run-state.js` owns run start, step updates, finish, and overlay lifecycle.
- `browser-first/resonantos-side-panel-extension/src/lib/control-overlay.js` owns the page pill rendering and phase-to-label fallback.
- `browser-first/resonantos-side-panel-extension/src/lib/agent-control-runner.js` sends per-action overlay updates during observe/act/verify.
- Existing tests cover control run lifecycle and runner overlay phases.

## Refined Target

Make Agent Control overlay updates use a stable public action vocabulary for active step states while preserving durable step labels, monitor details, browser job state, and report detail.

## Acceptance

- Active run start keeps the session overlay on for the run.
- Active step overlay labels use plain action words:
  - read/inspect/forms/tabs -> "reading"
  - click/scroll/open/search/switch_tab -> "clicking"
  - type -> "typing"
  - wait/approval-blocked states -> "waiting for you" where applicable
  - verify overlay calls remain "verifying"
- Blocked/failed/cancelled overlay states stay recognizable and include useful context.
- Focused tests prove the label vocabulary and the read-only-safe overlay command path.
- Existing browser-first tests and full TypeScript build pass.
