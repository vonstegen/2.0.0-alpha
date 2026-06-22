# Refinement Run Manifest: issue-93-settings-strict-hierarchy

## Source

- GitHub issue: https://github.com/ResonantOS/2.0.0-alpha/issues/93
- Project board: ResonantOS project 2, view 1
- Assigned operator: @me via `gh issue edit 93 -R ResonantOS/2.0.0-alpha --add-assignee @me`

## Objective

Enforce the Settings hierarchy required by issue 93:

- Top-level settings: Profile, Providers, Memory, Browser Control, Add-ons, Privacy.
- Advanced/Diagnostics: route internals, raw provider metadata, runtime nodes, logs, diagnostics.
- Each section starts with the most likely user action or status check.

## Arcanum Route

- `refine`: convert the ticket into scoped context, constraints, and implementation handoff.
- `invoke define/design/plan`: materialize the governed implementation contract before mutation.
- `task-session`: execute one bounded work package and capture verification evidence.
- `domainspec-subagents-strategy`: consulted for dispatch governance. No live subagent dispatch was run because this ticket was an implementation task; the strategy only permits live dispatch for `research`, `review`, and `experiment`, while `code` and `plan` are reserved/non-dispatch lanes.

## Status

- Refinement status: complete
- Invoke package status: complete
- Task-session status: complete
- PR status: pending at artifact creation time
