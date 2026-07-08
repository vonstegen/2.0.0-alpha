// Offline read-path integration tests (constitution Art. X — deterministic checks).
//
// Three layers, all offline:
//   1. In-memory Repository — counts, hidden-exclusion, ordering, opt-in presence.
//   2. Real Vercel Function handlers (api/v1/*.mjs) driven with a mock req/res and
//      COMMUNITY_HUB_INMEMORY=1 — proves the end-to-end HTTP layer works and that
//      unauthenticated reads return real seeded data (acceptance §9).
//   3. SQL Repository row-mapping — driven with a fake db executor returning
//      Postgres-shaped rows, proving snake_case->camelCase mapping + GoalStepStatus
//      without a live database.

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createMemoryRepository } from "../src/repository.mjs";
import { createSqlRepository, _sql } from "../src/sql-repository.mjs";
import { fixtures } from "../seed/fixtures.mjs";

// --- Layer 1: in-memory repository ------------------------------------------

describe("in-memory repository read path", () => {
  const repo = createMemoryRepository(fixtures());

  test("listEvents: hidden excluded, sorted by startsAt, RSVP counts correct", async () => {
    const events = await repo.listEvents();
    assert.deepEqual(events.map((e) => e.id), ["e_retro", "e_kickoff", "e_workshop"]);
    assert.ok(!events.some((e) => e.id === "e_spam"), "hidden event must not appear");

    const kickoff = events.find((e) => e.id === "e_kickoff");
    assert.deepEqual(kickoff.rsvpCounts, { going: 2, interested: 1, no: 1 });
    assert.equal(kickoff.attendanceCount, 0, "no check-ins for a future event");
    assert.equal(kickoff.hostHandle, "ada");
    assert.equal(kickoff.location, "The Commons, 5th floor");
    assert.equal(kickoff.url, null);
  });

  test("listEvents: live attendance is distinct from RSVP (FR-E4)", async () => {
    const events = await repo.listEvents();
    const retro = events.find((e) => e.id === "e_retro");
    // 2 RSVPs going, but 3 distinct check-ins (alan attended without RSVP).
    assert.deepEqual(retro.rsvpCounts, { going: 2, interested: 0, no: 0 });
    assert.equal(retro.attendanceCount, 3);
  });

  test("listTasks: hidden excluded, status-ordered, GoalStepStatus + multi-claim", async () => {
    const tasks = await repo.listTasks();
    assert.ok(!tasks.some((t) => t.id === "t_spam"), "hidden task must not appear");
    assert.deepEqual(tasks.map((t) => t.id), ["t_venue", "t_notes", "t_slides", "t_recap"]);
    assert.deepEqual(
      tasks.map((t) => t.goalStepStatus),
      ["planned", "active", "active", "completed"],
    );
    const slides = tasks.find((t) => t.id === "t_slides");
    assert.deepEqual(slides.claimedBy, ["m_kata", "m_ada"], "claims ordered by claimedAt");
  });

  test("listPresence: opt-in only, newest first, member joined", async () => {
    const presence = await repo.listPresence();
    assert.deepEqual(presence.map((p) => p.memberId), ["m_alan", "m_ada"]);
    assert.equal(presence.find((p) => p.memberId === "m_ada").displayName, "Ada L.");
    assert.equal(presence.find((p) => p.memberId === "m_alan").note, null);
    assert.ok(!presence.some((p) => p.memberId === "m_grace"), "grace set no presence");
  });
});

// --- Layer 2: real Vercel Function handlers ---------------------------------

function mockRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: "",
    setHeader(k, v) {
      this._headers[k.toLowerCase()] = v;
    },
    getHeader(k) {
      return this._headers[k.toLowerCase()];
    },
    end(body) {
      this._body = body || "";
    },
    get json() {
      return this._body ? JSON.parse(this._body) : null;
    },
  };
}

async function invoke(handler, method = "GET") {
  const res = mockRes();
  await handler({ method, url: "/", headers: {} }, res);
  return { status: res.statusCode, headers: res._headers, json: res.json };
}

describe("Vercel Function handlers (COMMUNITY_HUB_INMEMORY)", () => {
  let events, tasks, presence;

  before(async () => {
    process.env.COMMUNITY_HUB_INMEMORY = "1";
    delete process.env.DATABASE_URL;
    // Import AFTER env is set so the lazy repo factory picks the in-memory path.
    ({ default: events } = await import("../api/v1/events.mjs"));
    ({ default: tasks } = await import("../api/v1/tasks.mjs"));
    ({ default: presence } = await import("../api/v1/presence.mjs"));
  });

  test("GET /v1/events returns seeded public events", async () => {
    const { status, json, headers } = await invoke(events);
    assert.equal(status, 200);
    assert.equal(json.events.length, 3);
    assert.match(headers["cache-control"], /max-age=10/);
  });

  test("GET /v1/tasks returns seeded public tasks", async () => {
    const { status, json } = await invoke(tasks);
    assert.equal(status, 200);
    assert.equal(json.tasks.length, 4);
  });

  test("GET /v1/presence returns opt-in presence", async () => {
    const { status, json } = await invoke(presence);
    assert.equal(status, 200);
    assert.equal(json.presence.length, 2);
  });

  test("an unsupported method is rejected with 405 + Allow header", async () => {
    // POST is now the M2 create route, so probe with DELETE (still unsupported).
    const { status, headers, json } = await invoke(events, "DELETE");
    assert.equal(status, 405);
    assert.equal(headers["allow"], "GET, POST");
    assert.equal(json.error, "method_not_allowed");
  });
});

// --- Layer 3: SQL repository row-mapping (fake executor) ---------------------

function fakeDb(rowsByQuery) {
  return {
    async query(text) {
      if (text === _sql.LIST_EVENTS_SQL) return { rows: rowsByQuery.events };
      if (text === _sql.LIST_TASKS_SQL) return { rows: rowsByQuery.tasks };
      if (text === _sql.LIST_PRESENCE_SQL) return { rows: rowsByQuery.presence };
      throw new Error("unexpected query");
    },
  };
}

describe("SQL repository maps Postgres rows to the public read shape", () => {
  const repo = createSqlRepository(
    fakeDb({
      events: [
        {
          id: "e1",
          title: "T",
          description: null,
          starts_at: new Date("2026-07-20T18:00:00Z"),
          ends_at: null,
          location: "here",
          url: null,
          host_id: "m1",
          host_handle: "ada",
          created_at: new Date("2026-06-30T09:00:00Z"),
          going: "2", // Postgres COUNT returns bigint as string
          interested: "1",
          no: "0",
          attendance: "3",
        },
      ],
      tasks: [
        {
          id: "t1",
          title: "task",
          description: null,
          status: "claimed",
          due_at: null,
          created_at: new Date("2026-07-01T09:00:00Z"),
          claimed_by: ["m_a", "m_b"],
        },
      ],
      presence: [
        {
          member_id: "m1",
          handle: "ada",
          display_name: "Ada L.",
          status: "around",
          note: null,
          updated_at: new Date("2026-07-07T14:00:00Z"),
        },
      ],
    }),
  );

  test("events: counts coerced to numbers, timestamps to ISO", async () => {
    const [e] = await repo.listEvents();
    assert.deepEqual(e.rsvpCounts, { going: 2, interested: 1, no: 0 });
    assert.equal(e.attendanceCount, 3);
    assert.equal(e.hostHandle, "ada");
    assert.equal(e.startsAt, "2026-07-20T18:00:00.000Z");
  });

  test("tasks: goalStepStatus derived, claimed_by passthrough", async () => {
    const [t] = await repo.listTasks();
    assert.equal(t.goalStepStatus, "active");
    assert.deepEqual(t.claimedBy, ["m_a", "m_b"]);
  });

  test("presence: member fields mapped", async () => {
    const [p] = await repo.listPresence();
    assert.equal(p.displayName, "Ada L.");
    assert.equal(p.updatedAt, "2026-07-07T14:00:00.000Z");
  });

  test("rejects a db executor without query()", () => {
    assert.throws(() => createSqlRepository({}), /query\(text, params\)/);
  });
});
