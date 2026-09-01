# Prompt: Resume <WORKSTREAM> — <DATE>

**Branch:** `<branch-name>`
**Worktree:** `<absolute path>`
**Last synced HEAD:** `<short SHA>`
**PR:** `#<number>`

## Workstream snapshot

- Goal: <one sentence>
- Constraints (non-negotiable):
  1. ...
  2. ...
  3. ...
- Last commits on this branch:
  ```
  <sha> <subject>
  <sha> <subject>
  <sha> <subject>
  ```
- Uncommitted WIP (DO NOT COMMIT):
  - `<file>` — reason
- Blocked on human:
  - <item> — owner / when

## Current state

- Tracking doc: `<path>` — rows touched: ...
- Doc 14 checklist: rows touched: ...
- Tests: `<command>` → `<result>`
- `docs:check` → green / red
- `engineer:verify` → green / red (or which subset was last run)

## Goal for this session

<What "done" means for this session. State it concretely.>

## Acceptance

- [ ] ...
- [ ] `npm run docs:check` green
- [ ] `<other gate>` green

## Steps

```bash
cd <worktree-path>
git status --short
git log --oneline -1
git fetch -q origin
# <work>
```

## Risks

- ...

## Out of scope

- ...
