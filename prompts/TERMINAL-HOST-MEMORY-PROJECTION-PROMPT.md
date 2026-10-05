# Terminal Host — Memory Projection (ROS_MEMORY_CONTEXT) — OMP Prompt (v1)

**Handoff from AVIS → OMP (on AVIS). Read this whole document before acting.**

The env seam already delivers project (`ROS_PROJECT_ROOT` / `ROS_PROJECT_CWD`),
skills (`ROS_SKILLS_DIR`), and the provider credential. The one remaining
functional gap is **memory**: the adopted terminal must receive a scoped,
session-bound memory context the harness (Pi) can read — never raw
memory-store access.

---

## 0. Decision + invariants

Decision: memory is a **scoped projection**, like resources and skills. ROS
writes an approved, session-bound context file and exposes only its path via a
host-owned env name. The harness never receives a memory-store endpoint, a
search API token, or raw memory content on argv.

Invariants (non-negotiable):

1. Memory is projected as a **file path** (`ROS_MEMORY_CONTEXT`), never inlined
   into argv/env/command strings.
2. The context file is **0600**, **session-bound**, and **deleted on session
   termination** (reuse the W1 tracked-sessions teardown and the skills staging
   cleanup discipline).
3. Only **approved** memory enters the context — gated by the harness's
   `memoryAccess` declaration and ROS-granted authority. `archiveReadMode:
   "none"` → no memory projection (fail closed).
4. No memory content ever appears in argv, logs, bus events, or evidence.
5. Project/files/skills/memory remain grants, not inferred from terminal cwd
   (unchanged).

---

## 1. Authority — read first

- `src/core/contracts.ts` — `AddOnMemoryAccessContract`
  (`archiveReadMode: "none" | "read-only-context" | "retrieval-with-citations"`,
  `archiveWriteMode`, `citationRequired`, `directKnowledgeWriteAllowed: false`).
- `browser-first/host/memory-search.mjs` — `searchMemoryWiki({ memoryRoot,
  query, limit })` (the retrieval primitive).
- `browser-first/host/memory-host-service.mjs` — `createMemoryHostService`
  (`memoryBridgeRoutes`); how the host reads memory today.
- `browser-first/host/terminal-host-service.mjs` — `buildProjectedSessionEnv`
  (the env seam to extend), `createTerminalHostService().terminateSession` /
  `stop()` (cleanup).
- `browser-first/host/harness-resource-projection.mjs` and
  `harness-skills-projection.mjs` — the existing projection pattern to mirror.
- `browser-first/test/harness-session-environment.test.mjs`,
  `browser-first/test/pi-terminal-grant-chain.test.mjs` — must remain green.

---

## 2. Hard rules

1. `ROS_MEMORY_CONTEXT` is a **host-owned** env name; the value is an absolute
   file path, never memory content.
2. The context file is written under a reviewed staging root (0600 file, 0700
   dir), session-scoped, and cleaned up on terminate/stop.
3. `archiveReadMode: "none"` → no file, no env var (fail closed).
4. Memory content is non-secret but must still never leak into argv/logs/events.
5. Preserve all prior invariants (grant single-use, credential non-leak, F2
   split, compatibility fail-closed).
6. No merge of `feature/pi-testing-phase`; no push to `dev`/`main`/`upstream`;
   do not push until AVIS audits.

---

## 3. Phase M1 — memory projection contract + resolver · gate CP-M1

Add a host-owned contract (suggest `src/core/harness-memory-contract.ts`):

```ts
interface HarnessMemoryProjection {
  projectionId: string;         // session-bound identity
  sessionId: string;
  archiveReadMode: "none" | "read-only-context" | "retrieval-with-citations";
  path: string | null;          // context file path; null when mode === "none"
  domains: readonly string[];   // approved domains included
  expiresAt: string;            // session-scoped expiry
}
```

Add a pure resolver/splitter plus a projection builder:

- `deriveMemoryProjectionMode(access): "none" | "context" | "retrieval"` — maps
  `AddOnMemoryAccessContract.archiveReadMode` to the projection behavior.
- `buildHarnessMemoryProjection({ sessionId, memoryAccess, memoryRoot,
  approvedDomains, stagingBase, now })` — writes the context file (0600) under
  `stagingBase`, returns `HarnessMemoryProjection` with the absolute `path`.

**Scope note:** implement `read-only-context` fully. For
`retrieval-with-citations`, return a projection with `path: null` and a
documented `"not-yet-implemented"`-style non-secret marker (do not fake
retrieval). `none` → no file, no projection. This keeps the seam real while
deferring retrieval to a follow-up.

**CP-M1 gate:** unit tests:

- `none` → no file, `path: null`;
- `read-only-context` → 0600 file exists, content is a subset of approved
  memory (no unapproved domain leaks in);
- the file is under the staging root and session-scoped;
- `retrieval-with-citations` → `path: null` + non-secret marker;
- content never appears in the returned projection object (only the path).

`STOP AND REPORT` here.

---

## 4. Phase M2 — wire `ROS_MEMORY_CONTEXT` into the env seam · gate CP-M2

Extend `buildProjectedSessionEnv` (or the attach env path) so the projected env
includes memory when the harness declares it.

Requirements:

1. Accept `memoryAccess` + `memoryRoot` + `approvedDomains` inputs (defaulting
   to `none` / empty).
2. Call `buildHarnessMemoryProjection`; when `path` is non-null, add
   `ROS_MEMORY_CONTEXT: <path>` to the returned env.
3. `meta` carries only `projectionId` / `archiveReadMode` / `domains` — never
   the path or content (keep `meta` non-secret; the path is non-secret but
   keep it out of `meta` for consistency with the token/auth discipline).
4. The route + CLI chain (already flowing through `buildProjectedSessionEnv`)
   benefits automatically; no separate route change.

**CP-M2 gate:** a test proves `buildProjectedSessionEnv` emits
`ROS_MEMORY_CONTEXT` pointing at an existing 0600 file only when
`archiveReadMode` is `read-only-context`, and omits it when `none`.

`STOP AND REPORT` here.

---

## 5. Phase M3 — cleanup + end-to-end · gate CP-M3

1. Wire memory-context cleanup into `terminateSession` / `stop()` (the W1
   tracked-sessions teardown) — delete the session's context file alongside the
   token/auth/skills staging cleanup.
2. Extend `pi-terminal-grant-chain.test.mjs` (or the real-chain test) so the
   full grant → attach → projected-env path includes `ROS_MEMORY_CONTEXT` when
   memory is declared, and asserts the file exists (0600) during the session
   and is removed after `stop()`/`terminateSession`.

**CP-M3 gate:** after teardown, the context file is gone (no leak), and the env
contained `ROS_MEMORY_CONTEXT` only when memory was declared + granted.

`STOP AND REPORT` here.

---

## 6. Commands

```bash
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
npx tsc --noEmit
npx vitest run
npx vitest run --config examples/sdk-demo/vitest.config.ts
node --experimental-strip-types --test \
  browser-first/test/harness-session-environment.test.mjs \
  browser-first/test/pi-terminal-grant-chain.test.mjs \
  browser-first/test/pi-terminal-adapter.test.mjs \
  browser-first/test/external-cli-harness-xh1-xh2.test.mjs \
  browser-first/test/harness-terminal-compatibility-xh3.test.mjs \
  browser-first/test/ros-session.test.mjs \
  browser-first/test/ros-session-http-integration.test.mjs \
  browser-first/test/terminal-host-launch-bootstrap.test.mjs \
  browser-first/test/terminal-host-grant-broker.test.mjs \
  browser-first/test/terminal-host-session-manager.test.mjs \
  examples/sdk-demo/terminal-host/ghostty/adapter.test.mjs
```

Report counts by label: core / demo / browser-first.

---

## 7. Verification discipline + STOP AND REPORT

Re-run every gate yourself; report counts by label. Never trust a green number
you did not produce.

---

## 8. Out of scope (do not build here)

- `retrieval-with-citations` (a real retrieval endpoint/token) — deferred; the
  projection returns a non-secret not-yet marker for it.
- Memory *write* path (`archiveWriteMode`) — out of scope; this prompt is
  read-only context projection only.
- Registry discovery (XH4), the "Open in Terminal" UI, additional harness
  policies, Linux adapters — later phases.

Suggested commits:

1. `feat(terminal-host): add harness memory projection (read-only context)`
2. `feat(terminal-host): wire ROS_MEMORY_CONTEXT into the projected env seam`
3. `test(terminal-host): memory projection + cleanup through the real chain`
4. `docs(terminal-host): capture memory-projection prompt` (include this prompt).

Report explicitly when memory projection is complete, then the functional demo
(terminal + Pi + credentials + skills + memory) is fully assembled.
