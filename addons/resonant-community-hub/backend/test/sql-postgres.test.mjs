// SQL read-path integration test against a REAL Postgres query planner.
//
// Why this exists (review finding, linus): the fake-executor tests in
// read-path.test.mjs match on `text === _sql.LIST_*_SQL` by string identity and
// return hand-authored rows. That exercises the JS snake_case->camelCase mapper,
// never the SQL itself — a typo in a column, a broken FILTER clause, or a syntax
// error in 0001_init.sql would sail through green. "managed DB" is half of M1 and
// was entirely unverified.
//
// This test closes that gap WITHOUT live cloud creds by running the migration DDL
// and all three read queries against PGlite: the real PostgreSQL engine compiled
// to WASM. It is the actual Postgres planner (COUNT(*) FILTER, ARRAY(subquery),
// timestamptz, TEXT[] all behave as on Neon), running fully offline and
// deterministically in-process. If 0001_init.sql or any of LIST_EVENTS_SQL /
// LIST_TASKS_SQL / LIST_PRESENCE_SQL is malformed or references a wrong column,
// db.exec / db.query throws and this test fails.
//
// Degradation: if @electric-sql/pglite is not installed (it is a devDependency),
// the suite skips rather than fails, so `node --test` stays green in environments
// that have not installed dev deps. A truly live check against a Neon preview
// branch remains deferred (needs DATABASE_URL + cloud creds) — see README.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { createSqlRepository } from "../src/sql-repository.mjs";
import { createMemoryRepository } from "../src/repository.mjs";
import { fixtures } from "../seed/fixtures.mjs";
import { INSERTS } from "../seed/seed.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "..", "db", "migrations", "0001_init.sql");

// Load the real embedded Postgres. If it is absent, skip (don't fail) so the
// deterministic offline suite still passes without dev deps installed.
let PGlite = null;
let loadError = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch (err) {
  loadError = err;
}

const skip = PGlite
  ? false
  : `@electric-sql/pglite not installed (${loadError?.code ?? "unknown"}); ` +
    "run `npm install` in backend/ to exercise the real SQL planner";

describe("SQL read path against a real Postgres planner (PGlite)", { skip }, () => {
  let db;
  let repo;

  before(async () => {
    db = await PGlite.create();
    // 1. Run the ACTUAL migration DDL — throws on any SQL syntax/typo error.
    await db.exec(await readFile(MIGRATION, "utf8"));
    // 2. Seed with the real INSERT statements from seed.mjs against the real schema.
    const f = fixtures();
    for (const spec of INSERTS) {
      for (const row of spec.rows(f)) {
        await db.query(spec.sql, spec.params(row));
      }
    }
    // 3. Drive the production SQL repository against the real planner.
    repo = createSqlRepository({ query: (text, params) => db.query(text, params) });
  });

  after(async () => {
    if (db) await db.close();
  });

  test("migration + LIST_EVENTS_SQL: hidden excluded, startsAt order, FILTER counts, distinct attendance", async () => {
    const events = await repo.listEvents();
    // Hidden e_spam excluded (WHERE e.hidden = false); ORDER BY starts_at ASC.
    assert.deepEqual(events.map((e) => e.id), ["e_retro", "e_kickoff", "e_workshop"]);

    const kickoff = events.find((e) => e.id === "e_kickoff");
    // COUNT(*) FILTER (WHERE state = ...) actually evaluated by Postgres.
    assert.deepEqual(kickoff.rsvpCounts, { going: 2, interested: 1, no: 1 });
    assert.equal(kickoff.attendanceCount, 0);
    assert.equal(kickoff.hostHandle, "ada"); // LEFT JOIN members h
    assert.equal(kickoff.location, "The Commons, 5th floor");
    assert.equal(kickoff.url, null);
    assert.equal(kickoff.startsAt, "2026-07-20T18:00:00.000Z"); // timestamptz -> ISO

    const retro = events.find((e) => e.id === "e_retro");
    // 2 RSVPs going, but 3 distinct check-ins (COUNT(DISTINCT member_id)) — FR-E4.
    assert.deepEqual(retro.rsvpCounts, { going: 2, interested: 0, no: 0 });
    assert.equal(retro.attendanceCount, 3);
  });

  test("LIST_TASKS_SQL: hidden excluded, status ordering, ARRAY() claim aggregation, GoalStepStatus", async () => {
    const tasks = await repo.listTasks();
    assert.ok(!tasks.some((t) => t.id === "t_spam"), "hidden task excluded");
    assert.deepEqual(tasks.map((t) => t.id), ["t_venue", "t_notes", "t_slides", "t_recap"]);
    assert.deepEqual(
      tasks.map((t) => t.goalStepStatus),
      ["planned", "active", "active", "completed"],
    );
    const slides = tasks.find((t) => t.id === "t_slides");
    // ARRAY(SELECT ... ORDER BY claimed_at) returns a real Postgres text[].
    assert.deepEqual(slides.claimedBy, ["m_kata", "m_ada"]);
  });

  test("LIST_PRESENCE_SQL: opt-in only, newest first, member JOIN, null note passthrough", async () => {
    const presence = await repo.listPresence();
    assert.deepEqual(presence.map((p) => p.memberId), ["m_alan", "m_ada"]);
    assert.ok(!presence.some((p) => p.memberId === "m_grace"), "grace set no presence");
    assert.equal(presence.find((p) => p.memberId === "m_ada").displayName, "Ada L.");
    assert.equal(presence.find((p) => p.memberId === "m_alan").note, null);
  });

  test("SQL repository output is byte-identical to the in-memory reference", async () => {
    // The strongest cross-check: the real-Postgres path and the hand-written
    // in-memory semantics must not drift. If the SQL computes anything differently
    // from repository.mjs, this deep-equal fails.
    const mem = createMemoryRepository(fixtures());
    assert.deepEqual(await repo.listEvents(), await mem.listEvents());
    assert.deepEqual(await repo.listTasks(), await mem.listTasks());
    assert.deepEqual(await repo.listPresence(), await mem.listPresence());
  });
});
