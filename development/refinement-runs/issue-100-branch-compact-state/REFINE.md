# Issue 100 Refinement: Branch Compact State

## Ticket

- Issue: https://github.com/ResonantOS/2.0.0-alpha/issues/100
- Title: feat: Context compaction - chat branching must copy compact state and source references
- Claim: assigned to `vrondelli`; Project 2 status moved to In Progress.

## Refined Problem

When a browser-first chat session is branched, the new branch must carry the parent session's compact memory package, including compacted user intent, decisions, tasks, artifact references, and source references. Branching must not keep only visible messages because compacted history may have moved older user intent out of the visible transcript.

## Evidence

- `src/core/context-memory.ts` already copies React app compact memory states for forked conversation threads.
- `src/App.test.tsx` already covers provider requests from a branched compacted React thread.
- `browser-first/resonantos-side-panel-extension/src/lib/chat-session-store.js` normalizes browser-first sessions into a fixed set of fields and previously dropped session-level compact metadata during hydration and branch creation.
- `browser-first/test/chat-session-store.test.mjs` covered session forks and message forks but not compact memory metadata.

## Acceptance

- Add a deterministic browser-first regression test that fails if a branched session loses compact memory.
- Preserve compact memory and source/reference metadata for both whole-session branch and branch-from-message paths.
- Keep scope bounded to browser-first chat session persistence/branching.

