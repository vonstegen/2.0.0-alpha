# Define: Issue 100 Branch Compact State

## Outcome

A branched browser-first chat session keeps the same compact memory package and source references that the parent had at branching time.

## Non-Goals

- Do not redesign compact memory extraction.
- Do not alter React app `contextMemoryStates` behavior.
- Do not change provider routing prompts.
- Do not change project or session list UI behavior.

## Invariants

- Existing session fork behavior remains intact: fork title starts with `Fork:`, project context is retained, pinned state resets to false, active session changes to the fork.
- Invalid messages continue to be filtered by the existing message validator.
- Compact metadata is copied as storage data, not recomputed from visible messages.

