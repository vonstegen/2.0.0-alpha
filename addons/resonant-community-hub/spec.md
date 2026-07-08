# Community Hub — Specification

- **Plugin:** `addon.community-hub` (Community Hub)
- **Path:** `addons/resonant-community-hub/`
- **Spec version:** 0.1.0 (draft) · 2026-07-07
- **Governed by:** [`constitution.md`](./constitution.md) — the constitution overrides this spec on conflict.
- **Supersedes:** [ResonantOS/2.0.0-alpha#238](https://github.com/ResonantOS/2.0.0-alpha/issues/238) (Plane-backed team task board)

---

## 1. Summary

A **public community hub** delivered as a ResonantOS add-on. Members "check in" to
see when the community is hosting events, claim and track community tasks, and
share lightweight presence. The shared data lives in a **custom serverless
backend + managed DB** (the source of truth); each member runs the add-on locally
and reaches the backend through their local bridge.

This supersedes the Plane-backed *team* task board (#238): it is public,
events-centric, and custom-hosted rather than an internal Plane client.

## 2. Goals & non-goals

**Goals**
- Anyone can browse upcoming community events and open community tasks.
- Signed-in members can RSVP, check in to live events, sign up for tasks, and set presence.
- ResonantOS agents can surface and act on community tasks via `GoalWorkspace`.
- Zero self-hosting of a VPS; serverless + managed DB.

**Non-goals (v1)** — see constitution "Non-negotiable non-goals": no anonymous
writes, no server push dependency, no VPS baseline, no auto real-world actions,
no writes into trusted Living Archive pages.

## 3. Personas & scenarios

- **Visitor (unauthenticated):** installs the add-on, browses the events feed and
  task board read-only.
- **Member (authenticated):** signs in once (OAuth/magic-link), RSVPs to an event,
  checks in when it starts, claims a "help run the meetup" task, sets presence to
  "prepping slides."
- **Organizer (member):** creates events and tasks; sees RSVP/attendance counts.
- **Moderator (member + role):** hides abusive entries, handles reports.

## 4. Functional requirements

### 4.1 Events (RSVP + attendance)
- FR-E1: Anyone can list upcoming/past events (public read).
- FR-E2: Organizers can create/edit/cancel events (title, description, start/end, location or URL, host).
- FR-E3: Members can **RSVP** (going / interested / not going); counts are visible.
- FR-E4: During an event window, members can **check in** (live attendance); attendance is distinct from RSVP.

### 4.2 Community tasks (sign-up)
- FR-T1: Anyone can list community tasks (public read).
- FR-T2: Members can **claim / un-claim** a task and mark progress (open → claimed → done).
- FR-T3: Tasks map to `GoalStepStatus` so agents can pick them up (planned/active/blocked/completed).

### 4.3 Presence
- FR-P1: Members can set an **opt-in** presence status + short note; it is revocable.
- FR-P2: A presence strip shows who is currently around and what they're working on.

### 4.4 Identity & access
- FR-A1: Reads are public; **writes require sign-in** (GitHub OAuth in v1).
- FR-A2: First sign-in provisions a `Member` (handle, display name, OAuth sub).
- FR-A3: A member can delete their account and associated writes (erasure).

### 4.5 Moderation
- FR-M1: Every write endpoint is rate-limited.
- FR-M2: Any event/task/presence entry can be **reported**; moderators can **hide** it.

## 5. Data model (managed DB)

```
Member   { id, handle, displayName, oauthSub, roles[], joinedAt }
Event    { id, title, description, startsAt, endsAt, location|url, hostId, createdAt, hidden }
Rsvp     { id, eventId, memberId, state: going|interested|no, updatedAt }
CheckIn  { id, eventId, memberId, at }                 # live attendance
Task     { id, title, description, status: open|claimed|done, claimedBy[], dueAt, hidden }
Presence { memberId, status, note, updatedAt }          # opt-in, one row per member
Report   { id, targetType, targetId, reporterId, reason, createdAt, resolved }
```

## 6. API surface (serverless, versioned `/v1`)

Stateless functions; polling clients.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/v1/events` | public | List events (+ RSVP/attendance counts) |
| POST | `/v1/events` | member (organizer) | Create event |
| POST | `/v1/events/:id/rsvp` | member | Set RSVP state |
| POST | `/v1/events/:id/checkin` | member | Live attendance check-in |
| GET | `/v1/tasks` | public | List tasks |
| POST | `/v1/tasks/:id/claim` | member | Claim / un-claim / progress |
| GET | `/v1/presence` | public | Current presence strip |
| PUT | `/v1/presence` | member | Set/clear own presence |
| POST | `/v1/reports` | member | Report an entry |
| POST | `/v1/mod/hide` | moderator | Hide an entry |
| DELETE | `/v1/account` | member | Delete own account + erase writes (FR-A3) |
| POST | `/v1/auth/*` | — | OAuth/magic-link sign-in |

All write endpoints: rate-limited, auth-guarded, input-validated.

## 7. ResonantOS add-on shape

- **Runtime:** `local-service` (bridge proxies the public API — CSP) **+** a
  `ui-module` "Community Hub" surface.
- **Category:** `integration`.
- **Capabilities requested:** `network`, `notifications`, `agent-delegation`. (Least-privilege:
  `ui-embedding` is **not** requested — a `local-service` add-on with `page`/`panel`/`rail`
  surfaces renders in the shell and does not expose an `embedded-pane`, so the SDK does not
  require it. Add it only if an `embedded-pane` surface is introduced.)
- **Surfaces:** events feed (RSVP + check-in), tasks board (sign-up), presence strip
  — with `shellNavigation` dock metadata.
- **Connector:** type `api` → the Community backend (`baseUrl` configurable).
- **Tools** (writes `requiresHumanApproval: true` when agent-initiated):
  `community.list_events`, `community.rsvp`, `community.checkin`,
  `community.list_tasks`, `community.claim_task`, `community.set_presence`,
  `community.report`.
- **Manifest:** draft at `examples/addons/community-hub.json` (sideload) →
  curated `public/addons/community-hub.json` + `public/addons/index.json`.
- **Sync:** poll `GET` endpoints (~15–30s) and reconcile into the local view.

## 8. Non-functional requirements

- **Hosting:** serverless functions + managed DB (Turso/libSQL or Neon Postgres).
- **Security:** GitHub OAuth (v1); secrets in host vault, never committed; per-user
  token stored via host-vault/user-config scope.
- **Privacy:** minimal PII; presence opt-in; erasure supported.
- **Abuse:** rate limits + report/hide in v1.
- **Availability:** read path should serve from cache/degrade if the DB is slow.

## 9. Acceptance criteria

- [ ] `examples/addons/community-hub.json` sideloads and passes `validateAddOnManifest()`.
- [ ] Unauthenticated add-on lists real events, tasks, and presence (public read).
- [ ] A member can sign in once and RSVP; the count updates for other members on next poll.
- [ ] Live check-in records attendance distinct from RSVP within an event window.
- [ ] A member can claim a task; it maps to a `GoalStepStatus` an agent can read.
- [ ] Setting/clearing presence works and is opt-in.
- [ ] Write endpoints reject anonymous callers and are rate-limited.
- [ ] Reported entries can be hidden by a moderator and disappear from public reads.
- [ ] Two ResonantOS instances see the same hub state (shared-source proof).
- [ ] All add-on API traffic flows through the local bridge (never the extension directly).

## 10. Milestones

1. **M0 — Scaffold:** this dir, constitution, spec, CLAUDE.md, validated draft manifest.
2. **M1 — Backend read path:** events/tasks/presence GET + managed DB + seed data.
3. **M2 — Auth + write path:** sign-in, RSVP, check-in, task claim, presence, rate limits.
4. **M3 — Add-on UI:** Community Hub surfaces wired through the bridge, polling sync.
5. **M4 — Moderation + erasure:** report/hide, account deletion.
6. **M5 — Agent bridge:** tasks ↔ `GoalWorkspace`, approval-gated agent writes.

## 11. Resolved decisions (2026-07-07)

Previously-open questions, now settled (see `plan.md` §Decisions):

- **Auth:** GitHub OAuth only for v1 (no Google, no magic-link).
- **Backend:** Vercel Functions + Neon Postgres.
- **Scope:** single global community for v1 (multi-community deferred).

## 12. References

- [`constitution.md`](./constitution.md)
- Add-on SDK: `docs/architecture/ADR-018-addon-sdk-v0.md`, `src/sdk/addons/`
- PM primitive: `src/core/goal-workspace.ts`, `src/core/contracts.ts`
- Local-service precedent: `addons/resonant-browser-host/`
- Bridge outbound precedent: `browser-first/host/provider-bridge-service.mjs`
- Superseded: ResonantOS/2.0.0-alpha#238
