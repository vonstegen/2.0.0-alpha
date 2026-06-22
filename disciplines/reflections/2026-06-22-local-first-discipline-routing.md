# Local-First Discipline Routing Reflection

## Workflow Reflect Result

- Scope: discipline-governance and github-project-issue-loop
- Signals analyzed: 7
- Thresholds triggered: severe-gap
- Patterns found: 2
- Proposals generated: 3 high-priority
- Report: disciplines/reflections/2026-06-22-local-first-discipline-routing.md
- Reflection state: unchanged
- Recommended next action: targeted update

## Context

During the GitHub issue-loop cleanup on 2026-06-22, five open ResonantOS pull
requests were corrected to remove raw `development/` issue-loop packages from
their committed surfaces. A framework-level Arcanum discipline was then opened
before a local ResonantOS discipline existed. The user corrected that route:
the discipline should be created inside ResonantOS first, and only then
generalized to Arcanum when appropriate.

## Signals

- User correction: local ResonantOS discipline should precede Arcanum promotion.
- PR #185 cleanup: removed unpromoted issue-loop development package.
- PR #186 cleanup: removed unpromoted issue-loop development package.
- PR #187 cleanup: removed unpromoted issue-loop development package.
- PR #188 cleanup: removed unpromoted issue-loop development package.
- PR #189 cleanup: removed unpromoted issue-loop development package.
- Arcanum PR #5 opened with a generalized discipline before local catalog state existed.

## Patterns Found

1. ResonantOS already had scattered local guidance for product PR scope, but no
   local discipline catalog to make the rule explicit.
2. Discipline-governance's target-local output rule can be misapplied when the
   runtime skill itself comes from Arcanum and the consuming repository lacks a
   local discipline surface.

## Proposed Iterations

1. Create a ResonantOS local discipline catalog and card for the development
   package promotion gate.
2. Add local validation so the discipline can be checked before PR publication.
3. Update Arcanum's generalized discipline and discipline-governance behavior to
   say consuming repositories should be checked or given a local discipline
   surface before framework promotion.

## Rejected Changes

- Do not commit raw issue-loop run packages as evidence for this reflection.
  The durable evidence is the local card, PR cleanup, and validation result.
- Do not move all ResonantOS discipline ownership into Arcanum. Arcanum can hold
  the reusable pattern, but ResonantOS owns its local PR scope.

## Decision

Targeted update. Add the local ResonantOS discipline first, then amend the
Arcanum promotion to preserve local-first routing.
