# Community Hub — Backend (M1 read path · M2 auth + write path · M4 moderation + erasure)

Serverless backend for the Community Hub add-on. **Vercel Functions + Neon
Postgres** (plan.md decisions).

- **M1 — public read path:** `GET /v1/events`, `GET /v1/tasks`, `GET /v1/presence`.
- **M2 — GitHub OAuth sign-in + authenticated write path:** `POST /v1/events`,
  `POST /v1/events/:id/rsvp`, `POST /v1/events/:id/checkin`,
  `POST /v1/tasks/:id/claim`, `PUT /v1/presence`, and
  `GET /v1/auth/github/{start,callback}`. Every write is auth-guarded and
  rate-limited; **anonymous writes are rejected**.
- **M4 — moderation + erasure:** `POST /v1/reports` (any member reports an
  event/task/presence entry), `POST /v1/mod/hide` (moderator-gated; hidden entries
  drop out of public reads and the target's open reports are resolved), and
  `DELETE /v1/account` (self-service account deletion + right-to-erasure, Art. VIII).
  Presence gained a `hidden` flag (`0002_moderation.sql`) so it is hideable like
  events/tasks.

Governed by [`../constitution.md`](../constitution.md) and [`../spec.md`](../spec.md).

## Layout

```
backend/
  vercel.json              # function config + /v1/* rewrites (incl. :id + auth)
  api/v1/
    {events,tasks,presence}.mjs      # GET reads (+ POST events / PUT presence)
    events/[id]/{rsvp,checkin}.mjs   # POST writes
    tasks/[id]/claim.mjs             # POST write
    reports.mjs                      # POST report an entry (M4)
    mod/hide.mjs                     # POST moderator hide (M4)
    account.mjs                      # DELETE self account + erasure (M4)
    auth/github/{start,callback}.mjs # OAuth sign-in (302 -> GitHub -> session token)
  src/
    handlers.mjs           # pure read handlers + Node response writer + body reader
    write-handlers.mjs      # pure write handlers: guardWrite pipeline + OAuth callback
    mod-handlers.mjs        # pure M4 handlers: report / hide / delete-account (guardWrite)
    auth.mjs               # HMAC session tokens + fail-closed authenticate() guard
    rate-limit.mjs          # fixed-window per-member rate limiter (injectable clock/store)
    github-oauth.mjs        # GitHub OAuth (injectable fetchImpl) + signed CSRF state
    validation.mjs          # input validators for every write body
    write-context.mjs       # per-instance repo + secret + rate-limiter singleton
    vercel-adapter.mjs      # req/res <-> pure-handler translation for write endpoints
    repository.mjs         # Repository contract + in-memory impl (reads + writes)
    sql-repository.mjs     # Neon Postgres impl (reads + writes; injected SQL executor)
    goal-mapping.mjs       # Task.status -> GoalStepStatus (FR-T3)
  db/
    migrations/0001_init.sql        # schema for all 7 entities (spec §5)
    migrations/0002_moderation.sql  # M4: presence.hidden flag + moderation indexes
    migrate.mjs            # ordered migration loader (readMigrations / applyMigrations)
    neon.mjs               # Neon Pool executor (live path; deferred creds)
    index.mjs              # createRepositoryFromEnv() — picks impl from env
  seed/
    fixtures.mjs           # deterministic seed data (incl. hidden rows)
    seed.mjs               # migrate + seed (live) / --inmemory (offline dry-run)
  test/
    read-path.test.mjs     # in-memory repo + real read handlers + row-mapper (fake db)
    auth.test.mjs          # session token mint/verify/tamper/expiry + guard (offline)
    rate-limit.test.mjs    # fixed-window limiting, per-key isolation, reset (offline)
    github-oauth.test.mjs  # OAuth flow with a FAKE fetch + CSRF state (offline)
    write-path.test.mjs    # write pipeline (401/403/400/409/429) + read reflection + real endpoints
    moderation.test.mjs    # M4: report/hide (excluded-from-reads) + erasure + real endpoints + PGlite
    sql-postgres.test.mjs  # migration DDL + read AND write SQL vs a REAL PG planner (PGlite)
```

## Auth model (M2)

- **GitHub OAuth only** (plan decision; no anonymous writes — Art. IV). The web flow:
  `start` → 302 to GitHub with a signed, expiring CSRF `state` → `callback` verifies
  state, exchanges the code, fetches the user, provisions a `Member` (stable by
  `oauth_sub`), and mints a session token.
- **Stateless session tokens.** `base64url(payload).hmac_sha256` signed with
  `COMMUNITY_HUB_AUTH_SECRET`; verified in constant time, no session table (Art. VI).
  Clients send `Authorization: Bearer <token>` — via the local bridge, never the
  extension directly (Art. II).
- **Fail closed.** Missing/forged/expired token or unknown member → 401.
- **Rate limiting on every write** (Art. VII): fixed window keyed `<route>:<memberId>`,
  429 + `Retry-After`, `X-RateLimit-*` headers on success. The **unauthenticated**
  OAuth start/callback endpoints have no member to key on, so they run a **separate
  limiter keyed by client IP** (`x-forwarded-for`) — the callback provisions a member
  and calls GitHub, so it must be throttled with zero credentials.
- **Cache policy is fail-safe.** `sendNodeResponse` defaults every response to
  `Cache-Control: no-store`; only the idempotent public GET reads
  (events/tasks/presence) opt into `public, max-age=10, stale-while-revalidate=20`.
  Session-token (OAuth callback) and mutation responses are therefore never publicly
  cacheable by a browser/back cache or shared proxy.

### Env vars (secrets from host vault / env, never committed)

| Var | Purpose |
|---|---|
| `COMMUNITY_HUB_AUTH_SECRET` | HMAC key for session tokens + OAuth state (>=16 chars) |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub OAuth app credentials |
| `GITHUB_OAUTH_REDIRECT_URI` | callback URL (optional; GitHub app default otherwise) |
| `COMMUNITY_HUB_RATE_LIMIT` / `_WINDOW_MS` | member write limit + window (default 20 / 60000) |
| `COMMUNITY_HUB_AUTH_RATE_LIMIT` / `_WINDOW_MS` | per-IP OAuth start/callback limit + window (default 10 / 60000) |

## Design

- **DB behind an adapter.** Functions depend on a `Repository` contract, never a
  driver. Two implementations return identical read shapes:
  - `createMemoryRepository` — offline test double; also the explicit local/preview
    fallback (`COMMUNITY_HUB_INMEMORY=1`).
  - `createSqlRepository(db)` — real Neon Postgres via an injected
    `{ query(text, params) }` executor.
- **Public reads exclude `hidden` rows** for events, tasks **and presence**
  (constitution Art. VII). A moderator hide flips `hidden` and resolves the target's
  open reports.
- **Right to erasure (Art. VIII):** `deleteMember` cascades a member's RSVPs,
  check-ins, task claims, and presence; reopens tasks they solely claimed; and
  de-identifies authored content (hosted events + filed reports → `NULL` via
  `ON DELETE SET NULL`). The deleted member's still-valid HMAC token then fails the
  auth guard's member lookup (401), so no session table is needed to revoke it.
- **Live attendance (`check_ins`) is counted distinctly from RSVP** (spec FR-E4).
- **Tasks carry a `goalStepStatus`** so agents can pick them up (FR-T3).
- **No fake cloud calls.** With neither `DATABASE_URL` nor `COMMUNITY_HUB_INMEMORY`
  set, the factory throws a clear config error rather than fabricating data.

## Testing the SQL for real (offline)

`0001_init.sql` and the three read queries are executed against a **real
PostgreSQL engine** — not just the JS row-mapper. `test/sql-postgres.test.mjs`
runs the migration DDL and `LIST_EVENTS/TASKS/PRESENCE_SQL` against
[PGlite](https://pglite.dev) (Postgres compiled to WASM), fully in-process with no
docker and no network. This catches SQL that the fake-executor tests cannot: a
wrong column, a broken `FILTER`/`ARRAY()` clause, or a DDL syntax error all make
`db.query` throw and the test fail. PGlite is a `devDependency`; if it is not
installed the suite **skips** that file rather than failing.

## Run

```bash
# Offline tests (no live DB, no network — runs the real SQL via PGlite):
npm install                 # installs @electric-sql/pglite (devDependency)
node --test test/*.test.mjs

# Local end-to-end dev server (OFFLINE: in-memory + shared store, no Vercel/Neon):
npm run dev:local           # serves /v1/* on 127.0.0.1:4891, prints dev tokens
# then, in another shell:
curl -s http://127.0.0.1:4891/v1/events        # public read (hidden rows excluded)
# authenticated write (token from the dev-server banner):
curl -s -X POST http://127.0.0.1:4891/v1/events/e_workshop/rsvp \
  -H "authorization: Bearer <ADA_TOKEN>" -H 'content-type: application/json' \
  -d '{"state":"going"}'
# `dev-server.mjs` mounts the real api/v1/**.mjs functions behind a router that
# mirrors vercel.json; COMMUNITY_HUB_SHARED_MEMORY=1 makes every function share one
# seeded store, so writes reflect in reads. It is a local test harness only.

# Offline seed dry-run (loads fixtures into the in-memory repo, prints counts):
node seed/seed.mjs --inmemory

# Live (needs real cloud creds — DEFERRED in this sandbox):
export DATABASE_URL="postgres://…neon…"      # from the host vault, never committed
node seed/seed.mjs --migrate-only            # apply migrations
node seed/seed.mjs                           # migrate + seed fixtures
vercel dev                                   # serve /v1/* locally
```

## Deferred (needs live cloud creds)

- Actually connecting to **Neon specifically** (`db/neon.mjs`, `@neondatabase/serverless`)
  and running migrations/seed against a real Neon branch — no `DATABASE_URL` or driver
  in this sandbox. Note the SQL/DDL itself is no longer deferred: it is exercised
  offline against a real Postgres planner (PGlite) — both the M1 reads and the M2
  write methods — so a Neon run is a driver/networking smoke test, not the first
  time the SQL meets a planner.
- A live `vercel dev` / deploy smoke test of the functions.
- A **real GitHub OAuth app** end-to-end (browser → GitHub consent → callback). The
  token exchange + user fetch are fully unit-tested offline with an injected fake
  `fetchImpl`; only the live consent round-trip needs a registered app + secrets.

## Known limitations (documented, not blocking M2)

- **Rate limiter store is per-instance in-memory.** Limits apply per warm Vercel
  Function instance, not globally. The `store` seam (`rate-limit.mjs`) makes a shared
  Neon/Upstash store a drop-in with no handler changes — deferred to a later milestone.
- **OAuth CSRF `state` is stateless** (signed + expiring, not bound to a bridge-held
  session). Binding it to the initiating bridge session is a later hardening.

The offline in-memory path is byte-for-byte identical in read shape (asserted in
`sql-postgres.test.mjs`), so handler and mapping logic are fully exercised without
cloud access.
