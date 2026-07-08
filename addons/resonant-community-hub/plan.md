# Community Hub — Technical Plan

- Derived from [`spec.md`](./spec.md); governed by [`constitution.md`](./constitution.md).
- Plan version: 0.1.0 · 2026-07-07

> This plan translates the spec into buildable technical decisions and a task
> breakdown. The decisions below were **confirmed 2026-07-07** and are no longer
> defaults; changing one now requires a spec/plan amendment.

## Decisions (confirmed 2026-07-07)

| Area | Decision | Rationale |
|---|---|---|
| Serverless platform | **Vercel Functions** | The environment already carries Vercel tooling/skills; lowest-friction deploys and previews. |
| Managed DB | **Neon Postgres** | Serverless Postgres, branchable, pairs cleanly with Vercel. |
| Auth | **GitHub OAuth only (v1)** | Dev-leaning community; strong identity, low friction. No magic-link/Google in v1. No anonymous writes (constitution Art. IV). |
| Communities in v1 | **Single global community** | Ship the loop first; multi-community is a later schema/route addition. |
| Sync | **Polling, ~20s** | Constitution Art. VI — localhost bridge cannot receive webhooks. |
| Token storage | **Host vault / user-config scope** | Per-user secret never committed; connector `configScope: host-vault`. |

No platform/auth/scope decisions remain open for M1–M2.

## Architecture (build view)

```
extension UI (src/modules/community-hub)          <- M3
      │  bridge RPC
local-service host (addons/resonant-community-hub/src)  <- M3, proxies + polls
      │  HTTPS (outbound, like provider-bridge-service.mjs)
Community API  (backend/ — Vercel Functions)      <- M1/M2
      │
Neon Postgres  (backend/db — schema + migrations) <- M1
```

## Milestone → task breakdown

### M0 — Scaffold  ✅ (this change)
- [x] Plugin dir `addons/resonant-community-hub/`
- [x] `constitution.md`, `spec.md`, `CLAUDE.md`, `README.md`, `plan.md`
- [x] Draft manifest `examples/addons/community-hub.json` — passes `validateAddOnManifest` (zero issues)
- [x] Validation test case in `src/sdk/addons/public-manifests.test.ts`

### M1 — Backend read path  ✅
- [x] `backend/` scaffold (Vercel Functions project) + `package.json`
- [x] DB schema + migrations for `Member, Event, Rsvp, CheckIn, Task, Presence, Report` (spec §5) — `backend/db/migrations/0001_init.sql`
- [x] `GET /v1/events`, `GET /v1/tasks`, `GET /v1/presence` (public reads, with counts) — `backend/api/v1/`
- [x] Seed script + fixtures for local/preview — `backend/seed/` (offline `--inmemory` dry-run)
- [x] Read-path integration tests — `backend/test/` (`node --test`, offline; 14 tests green)
- DB behind a `Repository` adapter (in-memory test double + Neon SQL impl). Live Neon connect/seed + `vercel dev` deferred (no cloud creds in sandbox).

### M2 — Auth + write path  ✅
- [x] GitHub OAuth sign-in (`/v1/auth/github/start` + `/callback`) behind an injectable `fetchImpl`; `Member` provisioning (`provisionMember`, stable by `oauth_sub`) — `backend/src/github-oauth.mjs`, `backend/api/v1/auth/github/*`
- [x] `POST /v1/events` (organizer-gated), `POST /v1/events/:id/rsvp`, `POST /v1/events/:id/checkin` (live-window guard, distinct from RSVP)
- [x] `POST /v1/tasks/:id/claim` (claim/unclaim + status transition), `PUT /v1/presence` (set/clear, opt-in)
- [x] Stateless HMAC session tokens + fail-closed auth guard; **anonymous writes rejected 401** (Art. IV) — `backend/src/auth.mjs`
- [x] Rate limiting on **every** write, keyed per-member, 429 + `Retry-After` (Art. VII) — `backend/src/rate-limit.mjs`
- [x] Auth + rate-limit + OAuth + write-path unit/integration tests (offline; 60 M2 tests) — `backend/test/{auth,rate-limit,github-oauth,write-path}.test.mjs`; SQL writes also exercised against a real Postgres planner (PGlite) in `sql-postgres.test.mjs`
- Write methods live behind the same `Repository` adapter (memory + Neon SQL impls). Live Neon/`vercel dev` + a real GitHub OAuth app remain deferred (no cloud creds in sandbox).

### M3 — Add-on client  ✅
- [x] `addons/resonant-community-hub/src/` local-service host: outbound Community API proxy (`api-client.mjs`), session-token vault (`token-vault.mjs`), policy layer (`community-host.mjs`), ~20s poller (`poller.mjs`), loopback http-json server (`http-server.mjs`), entrypoint (`index.mjs`)
- [x] `src/modules/community-hub/` shell surfaces: events feed (RSVP + check-in) + tasks board (`CommunityHubWorkspace.tsx`), presence rail (`PresenceRail.tsx`), pure view-model (`community-view-model.ts`), bridge client (`community-bridge.ts`), CSS
- [x] Wire tools `community.*` through the host, writes approval-gated (agent-initiated writes need `approved:true`; user surface writes tagged `source:"user"`) + fail-closed write auth (no token ⇒ refused, never sent anonymously)
- [x] Promote manifest `examples/addons/community-hub.json` → `public/addons/community-hub.json` (+ `index.json` + `dev-index.json`; provenance bumped to `curated-signed`/`verified` for the bundled catalog)
- Tests: host proxy + poller under `node --test` (35 green); view-model + bridge under vitest (16 green); `public-manifests.test.ts` still green. Live loopback bind is exercised where the sandbox permits (guarded skip otherwise). Live Neon/Vercel + a real GitHub OAuth app remain deferred (no cloud creds in sandbox).

### M4 — Moderation + erasure  ✅
- [x] `POST /v1/reports` (any member), `POST /v1/mod/hide` + `POST /v1/mod/unhide` (both moderator-gated); hidden entries excluded from public reads. Presence gained a `hidden` flag (`db/migrations/0002_moderation.sql`) so it is hideable like events/tasks (Art. VII); hiding also resolves the target's open reports — `backend/src/mod-handlers.mjs`, `backend/api/v1/{reports,mod/hide,mod/unhide}.mjs`
- [x] Moderator hides are **sticky** and reversible **only** by a moderator (Art. VII): `setPresence` no longer clears `hidden` on a member self-write (that let a reported member reappear at will); the single reversal path is `POST /v1/mod/unhide`, which flips `hidden=false` for events/tasks/presence alike — both repositories + `handleUnhideEntry`
- [x] `DELETE /v1/account` — self-service account deletion + write erasure (FR-A3, Art. VIII): cascades RSVPs/check-ins/claims/presence, reopens sole-claimed tasks, de-identifies authored content (hosted events + filed reports → null), and the member's still-valid HMAC token then fails the auth guard's member lookup (401) — `backend/api/v1/account.mjs`, `deleteMember` in both repositories
- [x] Ordered migration loader (`db/migrate.mjs`) so seed / live Neon / offline PGlite all apply `0001` + `0002`; moderation + erasure tests offline (`node --test`), including a real-Postgres (PGlite) parity block. Live Neon + `vercel dev` remain deferred (no cloud creds in sandbox).

### M5 — Agent bridge  ✅
- [x] Map `Task` ↔ `GoalWorkspace` step / `GoalStepStatus` — shell-side `src/modules/community-hub/community-goal-bridge.ts` builds real `GoalStep`/`GoalWorkspace` values via the core factories (`createGoalStep`/`createGoalWorkspace` in `src/core/goal-workspace.ts`), with a deterministic reversible step id (`goal-step-community::<taskId>`) so writes round-trip. Forward map `open→planned / claimed→active / done→completed`; reverse `active→claim / planned→unclaim` (completed/blocked/cancelled have no v1 write path and are refused, not mis-mapped).
- [x] Approval-gated agent writes via `delegation.acceptsTasks` — host-side `addons/resonant-community-hub/src/agent-bridge.mjs` configures itself from the manifest `delegation` contract: refuses task types the manifest doesn't declare and all writes when `acceptsTasks:false`; enforces `requiresHumanApprovalBeforeExecution` (unapproved agent write → 403 `approval_required`), then dispatches through `community-host.mjs` as `source:"agent", approved:true` so the host's own approval gate (Art. V) **and** fail-closed token guard (Art. IV) also apply.
- Tests: `test/agent-bridge.test.mjs` (node --test, 16) — mapping, contract gate, approval gate, and an end-to-end block through the **real** community-host (approved write reaches the client with the member token; anonymous write blocked 401; host gate still fires if the bridge is bypassed). `src/modules/community-hub/community-goal-bridge.test.ts` (vitest, 10) — mapping ties to the real core primitives (`buildGoalWorkspaceStatus`/`updateGoalStepStatus` consume the projected workspace unchanged). No new cloud creds required; nothing deferred for M5.

## Verification per milestone
Each milestone is done only when the matching acceptance criteria in `spec.md` §9
pass. Manifest changes keep `public-manifests.test.ts` green.

## Risks
- **Public writes + abuse** — mitigated by required sign-in + rate limits + report/hide in v1.
- **Polling load** — cap client interval; serve reads from cache/CDN where possible.
- **Secret handling** — tokens only in host vault; never in committed config or the extension.
