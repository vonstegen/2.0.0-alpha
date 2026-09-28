# T3 — Workspace Install Handler Contract

## Finding
Making `executeWorkspaceAddonInstall` mandatory exposed stale host-service constructions.

## Decision
Keep the handler required. Missing implementations fail fast. Keep the route capability-gated.

## Evidence
A regression lock verifies the required handler and route wiring. Later browser-host and full browser-first runs remain green.

## Status
CLOSED.
