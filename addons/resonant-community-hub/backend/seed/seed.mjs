#!/usr/bin/env node
// Seed / migrate the Community Hub database.
//
// Usage:
//   node seed/seed.mjs                 migrate + insert fixtures (needs DATABASE_URL)
//   node seed/seed.mjs --migrate-only  run migrations only (needs DATABASE_URL)
//   node seed/seed.mjs --inmemory      OFFLINE dry-run: load fixtures into the
//                                      in-memory repo and print read-path counts.
//                                      No database required — used to smoke-test
//                                      the seed shape without live cloud creds.
//
// DEFERRED (needs live cloud creds): the DATABASE_URL branch below issues real
// SQL against Neon and cannot be exercised in this sandbox. The --inmemory path
// is fully offline and is what CI/tests run.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { fixtures } from "./fixtures.mjs";
import { createMemoryRepository } from "../src/repository.mjs";
import { readMigrations } from "../db/migrate.mjs";

const INSERTS = [
  {
    table: "members",
    rows: (f) => f.members,
    sql: "INSERT INTO members (id, handle, display_name, oauth_sub, roles, joined_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.handle, r.displayName, r.oauthSub, r.roles, r.joinedAt],
  },
  {
    table: "events",
    rows: (f) => f.events,
    sql: "INSERT INTO events (id, title, description, starts_at, ends_at, location, url, host_id, created_at, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.title, r.description, r.startsAt, r.endsAt, r.location, r.url, r.hostId, r.createdAt, r.hidden],
  },
  {
    table: "rsvps",
    rows: (f) => f.rsvps,
    sql: "INSERT INTO rsvps (id, event_id, member_id, state, updated_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.eventId, r.memberId, r.state, r.updatedAt],
  },
  {
    table: "check_ins",
    rows: (f) => f.checkIns,
    sql: "INSERT INTO check_ins (id, event_id, member_id, at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.eventId, r.memberId, r.at],
  },
  {
    table: "tasks",
    rows: (f) => f.tasks,
    sql: "INSERT INTO tasks (id, title, description, status, due_at, created_at, hidden) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.title, r.description, r.status, r.dueAt, r.createdAt, r.hidden],
  },
  {
    table: "task_claims",
    rows: (f) => f.taskClaims,
    sql: "INSERT INTO task_claims (task_id, member_id, claimed_at) VALUES ($1,$2,$3) ON CONFLICT (task_id, member_id) DO NOTHING",
    params: (r) => [r.taskId, r.memberId, r.claimedAt],
  },
  {
    table: "presence",
    rows: (f) => f.presence,
    sql: "INSERT INTO presence (member_id, status, note, updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (member_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at",
    params: (r) => [r.memberId, r.status, r.note, r.updatedAt],
  },
  {
    table: "reports",
    rows: (f) => f.reports,
    sql: "INSERT INTO reports (id, target_type, target_id, reporter_id, reason, created_at, resolved) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING",
    params: (r) => [r.id, r.targetType, r.targetId, r.reporterId, r.reason, r.createdAt, r.resolved],
  },
];

async function inMemoryDryRun() {
  const repo = createMemoryRepository(fixtures());
  const [events, tasks, presence] = await Promise.all([
    repo.listEvents(),
    repo.listTasks(),
    repo.listPresence(),
  ]);
  console.log("[seed --inmemory] fixtures loaded into in-memory repository:");
  console.log(`  members : ${repo.tables.members.length}`);
  console.log(`  events  : ${repo.tables.events.length} total, ${events.length} public (hidden excluded)`);
  console.log(`  tasks   : ${repo.tables.tasks.length} total, ${tasks.length} public (hidden excluded)`);
  console.log(`  presence: ${presence.length} opt-in rows`);
  console.log("  public read path OK.");
}

async function runAgainstDatabase({ migrateOnly }) {
  const { createNeonExecutor } = await import("../db/neon.mjs");
  const db = await createNeonExecutor();
  try {
    const migrationSql = await readMigrations();
    console.log(`[seed] applying all migrations (db/migrations/*.sql) ...`);
    await db.query(migrationSql);
    if (migrateOnly) {
      console.log("[seed] migrate-only: done.");
      return;
    }
    const f = fixtures();
    for (const spec of INSERTS) {
      const rows = spec.rows(f);
      for (const row of rows) {
        await db.query(spec.sql, spec.params(row));
      }
      console.log(`[seed] ${spec.table}: ${rows.length} rows upserted.`);
    }
    console.log("[seed] done.");
  } finally {
    await db.end();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--inmemory")) {
    await inMemoryDryRun();
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Use `node seed/seed.mjs --inmemory` for an offline dry-run, " +
        "or set DATABASE_URL (Neon) to seed the live database.",
    );
    process.exitCode = 1;
    return;
  }
  await runAgainstDatabase({ migrateOnly: args.has("--migrate-only") });
}

// Only run the CLI when executed directly (`node seed/seed.mjs ...`), not when a
// test or the SQL-parity harness imports INSERTS — otherwise the no-DATABASE_URL
// branch would set process.exitCode = 1 and poison `node --test`.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error("[seed] failed:", err.message);
    process.exitCode = 1;
  });
}

export { INSERTS };
