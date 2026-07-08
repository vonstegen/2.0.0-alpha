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

### M2 — Auth + write path
- [ ] GitHub OAuth sign-in; `Member` provisioning
- [ ] `POST /v1/events`, `/events/:id/rsvp`, `/events/:id/checkin`
- [ ] `POST /v1/tasks/:id/claim`, `PUT /v1/presence`
- [ ] Rate limiting on all writes; anonymous writes rejected (Art. IV, VII)
- [ ] Auth + rate-limit unit tests

### M3 — Add-on client
- [ ] `addons/resonant-community-hub/src/` local-service host: bridge RPC + outbound Community API proxy + poller
- [ ] `src/modules/community-hub/` shell surfaces: events feed (RSVP + check-in), tasks board, presence rail
- [ ] Wire tools `community.*` through the host (writes approval-gated)
- [ ] Promote manifest `examples/addons/community-hub.json` → `public/addons/community-hub.json` + `index.json`

### M4 — Moderation + erasure
- [ ] `POST /v1/reports`, `POST /v1/mod/hide`; hidden entries excluded from public reads
- [ ] Account deletion + write erasure (Art. VIII)

### M5 — Agent bridge
- [ ] Map `Task` ↔ `GoalWorkspace` step / `GoalStepStatus` (`src/core/goal-workspace.ts`)
- [ ] Approval-gated agent writes via `delegation.acceptsTasks`

## Verification per milestone
Each milestone is done only when the matching acceptance criteria in `spec.md` §9
pass. Manifest changes keep `public-manifests.test.ts` green.

## Risks
- **Public writes + abuse** — mitigated by required sign-in + rate limits + report/hide in v1.
- **Polling load** — cap client interval; serve reads from cache/CDN where possible.
- **Secret handling** — tokens only in host vault; never in committed config or the extension.
