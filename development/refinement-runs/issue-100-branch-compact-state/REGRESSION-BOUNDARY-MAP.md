# Regression Boundary Map

## Upstream Dependencies

- GitHub Issue #100 defines the required behavior and closure condition.
- Browser-first session persistence API:
  - `createChatSessionStore`
  - `normalizeSession`
  - `hydrate`
  - `persist`
- Session branch entry points:
  - `forkSession`
  - `forkFromMessage`
- Existing compact memory contract from `src/core/context-memory.ts`:
  - `userIntent`
  - `decisions`
  - `openTasks`
  - `artifacts`
  - source message/reference fields

## Downstream Dependencies

- Browser-first side-panel chat history and branch actions.
- Stored session snapshots read from extension storage.
- Provider routing that depends on the branch's context state after old messages are compacted away.
- Existing session/project behavior:
  - titles
  - project assignment
  - pin reset on fork
  - archived/unread state
  - active session switching

## Test-First Regression Boundary

Created focused coverage in `browser-first/test/chat-session-store.test.mjs` before implementation:

- Hydrate a source session with compact memory.
- Branch the whole session.
- Assert the forked active session contains the same compacted intent, decisions, tasks, artifact refs, and source refs.
- Assert the persisted storage payload contains the same compact state.
- Branch from a message.
- Assert the message fork also carries the same compact state.

This isolates the fix to browser-first session metadata preservation and avoids widening the task into React thread compaction, provider routing, UI layout, or unrelated persistence behavior.

