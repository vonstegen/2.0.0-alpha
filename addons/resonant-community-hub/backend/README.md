# Community Hub — Backend (M1: read path)

Serverless backend for the Community Hub add-on. **Vercel Functions + Neon
Postgres** (plan.md decisions). This milestone (M1) ships the **public read path**
only: `GET /v1/events`, `GET /v1/tasks`, `GET /v1/presence`. Auth and writes are M2.

Governed by [`../constitution.md`](../constitution.md) and [`../spec.md`](../spec.md).

## Layout

```
backend/
  vercel.json              # function config + /v1/* rewrites
  api/v1/{events,tasks,presence}.mjs   # Vercel Function entrypoints (GET only)
  src/
    handlers.mjs           # pure { status, body } handlers + Node response writer
    repository.mjs         # Repository contract + in-memory impl + read-shaping
    sql-repository.mjs     # Neon Postgres impl (injected SQL executor)
    goal-mapping.mjs       # Task.status -> GoalStepStatus (FR-T3)
  db/
    migrations/0001_init.sql   # schema for all 7 entities (spec §5)
    neon.mjs               # Neon Pool executor (live path; deferred creds)
    index.mjs              # createRepositoryFromEnv() — picks impl from env
  seed/
    fixtures.mjs           # deterministic seed data (incl. hidden rows)
    seed.mjs               # migrate + seed (live) / --inmemory (offline dry-run)
  test/
    read-path.test.mjs     # in-memory repo + real handlers + row-mapper (fake db)
    sql-postgres.test.mjs  # migration DDL + all 3 queries vs a REAL PG planner (PGlite)
```

## Design

- **DB behind an adapter.** Functions depend on a `Repository` contract, never a
  driver. Two implementations return identical read shapes:
  - `createMemoryRepository` — offline test double; also the explicit local/preview
    fallback (`COMMUNITY_HUB_INMEMORY=1`).
  - `createSqlRepository(db)` — real Neon Postgres via an injected
    `{ query(text, params) }` executor.
- **Public reads exclude `hidden` rows** (constitution Art. VII).
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
  offline against a real Postgres planner (PGlite), so a Neon run is a
  driver/networking smoke test, not the first time the SQL meets a planner.
- A live `vercel dev` / deploy smoke test of the functions.

The offline in-memory path is byte-for-byte identical in read shape (asserted in
`sql-postgres.test.mjs`), so handler and mapping logic are fully exercised without
cloud access.
