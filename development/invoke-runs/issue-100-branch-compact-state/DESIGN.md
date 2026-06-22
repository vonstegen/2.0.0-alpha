# Design: Issue 100 Branch Compact State

## Design Choice

Preserve compact metadata as explicit session metadata in the browser-first chat session store.

## Data Surface

Use `compactState` as the browser-first session field for structured compact memory. The field may contain the same shape used elsewhere by context memory:

- `userIntent`
- `decisions`
- `openTasks`
- `artifacts`
- `sourceReferences`
- `preservedRecentMessageIds`
- checksum/source range data

Preserve standalone `sourceReferences` as well when present, so older or alternate storage records with references outside `compactState` do not lose them during normalization.

## Copy Rule

When creating a forked session from either a whole session or a message:

- copy the parent session's compact metadata at branch time
- deep clone the metadata so later edits to parent or branch do not alias each other
- persist the forked metadata with the new session

