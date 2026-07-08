// Offline tests for the M4 moderation + erasure path.
//
// Coverage (constitution Art. VII moderation + Art. VIII erasure; spec §9):
//   1. Pure handlers over a SHARED in-memory repo with an injected clock:
//      - reports: member 201, anon 401, bad target 400, missing target 404, rate-limit 429
//      - hide: moderator hides event/task/presence -> EXCLUDED from public reads;
//        non-moderator 403; missing target 404; hiding resolves open reports
//      - erasure: deleteMember cascades writes, reopens sole-claimed tasks,
//        de-identifies authored content, and invalidates the member's token
//   2. The REAL Vercel Function entrypoints (api/v1/**) — auth + method guards.
//   3. A real Postgres planner (PGlite) block — hide/report/delete SQL + parity.

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { createMemoryRepository } from "../src/repository.mjs";
import { createSqlRepository } from "../src/sql-repository.mjs";
import { createRateLimiter } from "../src/rate-limit.mjs";
import { createSessionToken } from "../src/auth.mjs";
import { fixtures } from "../seed/fixtures.mjs";
import { handleRsvp } from "../src/write-handlers.mjs";
import { handleCreateReport, handleHideEntry, handleDeleteAccount } from "../src/mod-handlers.mjs";

const SECRET = "moderation-secret-16-plus-chars";
const NOW = Date.parse("2026-07-08T12:00:00.000Z");

function makeCtx({ limit = 100 } = {}) {
  const now = () => NOW;
  const repo = createMemoryRepository(fixtures(), { now });
  const rateLimiter = createRateLimiter({ limit, windowMs: 60_000, now });
  const ctx = { repo, auth: { secret: SECRET, repo, now }, rateLimiter };
  return { ctx, repo, now };
}
function tokenFor(sub, roles = []) {
  return createSessionToken({ sub, handle: sub, roles }, SECRET, { now: () => NOW });
}
const authed = (token, body = {}) => ({ headers: { authorization: `Bearer ${token}` }, body });

// --- reports (FR-M2) --------------------------------------------------------

describe("moderation: reports (any member can report; Art. VII)", () => {
  test("a member reports an event -> 201 with a persisted, unresolved report", async () => {
    const { ctx, repo } = makeCtx();
    const res = await handleCreateReport(authed(tokenFor("m_alan"), { targetType: "event", targetId: "e_kickoff", reason: "off-topic" }), ctx);
    assert.equal(res.status, 201);
    assert.equal(res.body.report.targetId, "e_kickoff");
    assert.equal(res.body.report.reporterId, "m_alan");
    assert.equal(res.body.report.resolved, false);
    assert.ok(repo.tables.reports.some((r) => r.id === res.body.report.id));
  });

  test("presence entries are reportable (keyed by member id)", async () => {
    const { ctx } = makeCtx();
    const res = await handleCreateReport(authed(tokenFor("m_alan"), { targetType: "presence", targetId: "m_ada" }), ctx);
    assert.equal(res.status, 201);
    assert.equal(res.body.report.reason, null);
  });

  test("anonymous report is rejected 401 (no anonymous writes, Art. IV)", async () => {
    const { ctx } = makeCtx();
    const res = await handleCreateReport({ headers: {}, body: { targetType: "event", targetId: "e_kickoff" } }, ctx);
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "auth_required");
  });

  test("bad target type -> 400; unknown target id -> 404", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_alan");
    assert.equal((await handleCreateReport(authed(token, { targetType: "member", targetId: "m_ada" }), ctx)).status, 400);
    assert.equal((await handleCreateReport(authed(token, { targetType: "event", targetId: "does_not_exist" }), ctx)).status, 404);
  });

  test("reports are rate-limited (Art. VII — every write endpoint)", async () => {
    const { ctx } = makeCtx({ limit: 1 });
    const token = tokenFor("m_alan");
    assert.equal((await handleCreateReport(authed(token, { targetType: "event", targetId: "e_kickoff" }), ctx)).status, 201);
    const second = await handleCreateReport(authed(token, { targetType: "event", targetId: "e_kickoff" }), ctx);
    assert.equal(second.status, 429);
    assert.ok(second.headers["retry-after"]);
  });
});

// --- hide (FR-M2) : the acceptance-criteria "disappear from public reads" -----

describe("moderation: hide excludes an entry from public reads (spec §9)", () => {
  test("moderator hides an event -> it disappears from GET /v1/events", async () => {
    const { ctx, repo } = makeCtx();
    assert.ok((await repo.listEvents()).some((e) => e.id === "e_kickoff"), "visible before hide");
    const res = await handleHideEntry(authed(tokenFor("m_grace", ["moderator"]), { targetType: "event", targetId: "e_kickoff" }), ctx);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.hidden, { targetType: "event", targetId: "e_kickoff" });
    assert.ok(!(await repo.listEvents()).some((e) => e.id === "e_kickoff"), "excluded after hide");
  });

  test("moderator hides a task -> it disappears from GET /v1/tasks", async () => {
    const { ctx, repo } = makeCtx();
    const res = await handleHideEntry(authed(tokenFor("m_grace", ["moderator"]), { targetType: "task", targetId: "t_venue" }), ctx);
    assert.equal(res.status, 200);
    assert.ok(!(await repo.listTasks()).some((t) => t.id === "t_venue"));
  });

  test("moderator hides a presence entry -> it disappears from GET /v1/presence", async () => {
    const { ctx, repo } = makeCtx();
    assert.ok((await repo.listPresence()).some((p) => p.memberId === "m_ada"), "visible before hide");
    const res = await handleHideEntry(authed(tokenFor("m_grace", ["moderator"]), { targetType: "presence", targetId: "m_ada" }), ctx);
    assert.equal(res.status, 200);
    assert.ok(!(await repo.listPresence()).some((p) => p.memberId === "m_ada"), "excluded after hide");
  });

  test("hiding resolves the target's open reports", async () => {
    const { ctx, repo } = makeCtx();
    const token = tokenFor("m_grace", ["moderator"]);
    // Two members report the same event -> 2 open reports.
    await handleCreateReport(authed(tokenFor("m_alan"), { targetType: "event", targetId: "e_workshop" }), ctx);
    await handleCreateReport(authed(tokenFor("m_kata"), { targetType: "event", targetId: "e_workshop" }), ctx);
    const res = await handleHideEntry(authed(token, { targetType: "event", targetId: "e_workshop" }), ctx);
    assert.equal(res.body.resolvedReports, 2);
    assert.ok(repo.tables.reports.filter((r) => r.targetId === "e_workshop").every((r) => r.resolved));
  });

  test("non-moderator is forbidden (403); missing target is 404; anon is 401", async () => {
    const { ctx } = makeCtx();
    // organizer role is not moderator
    assert.equal((await handleHideEntry(authed(tokenFor("m_ada", ["organizer"]), { targetType: "event", targetId: "e_kickoff" }), ctx)).status, 403);
    assert.equal((await handleHideEntry(authed(tokenFor("m_grace", ["moderator"]), { targetType: "event", targetId: "ghost" }), ctx)).status, 404);
    assert.equal((await handleHideEntry({ headers: {}, body: { targetType: "event", targetId: "e_kickoff" } }, ctx)).status, 401);
  });

  test("re-setting presence after a hide clears the hide (fresh opt-in)", async () => {
    const { ctx, repo } = makeCtx();
    await handleHideEntry(authed(tokenFor("m_grace", ["moderator"]), { targetType: "presence", targetId: "m_ada" }), ctx);
    assert.ok(!(await repo.listPresence()).some((p) => p.memberId === "m_ada"));
    await repo.setPresence({ memberId: "m_ada", status: "back online", note: null });
    assert.ok((await repo.listPresence()).some((p) => p.memberId === "m_ada"), "re-set presence is visible again");
  });
});

// --- erasure (FR-A3 / Art. VIII) --------------------------------------------

describe("erasure: account deletion cascades writes + invalidates the token", () => {
  test("deleting m_alan removes their writes and reopens a sole-claimed task", async () => {
    const { ctx, repo } = makeCtx();
    // m_alan solely claimed t_notes (status 'claimed' in fixtures).
    assert.equal((await repo.listTasks()).find((t) => t.id === "t_notes").status, "claimed");

    const res = await handleDeleteAccount(authed(tokenFor("m_alan")), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.body.deleted, true);
    assert.deepEqual(res.body.erased, { rsvps: 2, checkIns: 1, taskClaims: 1, presence: 1 });

    // Member gone; personal writes gone.
    assert.equal(await repo.getMemberById("m_alan"), null);
    assert.ok(!repo.tables.rsvps.some((r) => r.memberId === "m_alan"));
    assert.ok(!repo.tables.checkIns.some((c) => c.memberId === "m_alan"));
    assert.ok(!repo.tables.taskClaims.some((c) => c.memberId === "m_alan"));
    // Sole claim removed -> task reopens (done is sticky, this one was 'claimed').
    assert.equal((await repo.listTasks()).find((t) => t.id === "t_notes").status, "open");
  });

  test("the deleted member's token no longer authorizes writes (401 unknown_member)", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_alan");
    // A write works before deletion.
    assert.equal((await handleRsvp({ headers: { authorization: `Bearer ${token}` }, body: { state: "going" }, params: { id: "e_kickoff" } }, ctx)).status, 200);
    // Delete the account with that same token.
    assert.equal((await handleDeleteAccount({ headers: { authorization: `Bearer ${token}` }, body: {} }, ctx)).status, 200);
    // The still-well-formed token now fails the member lookup.
    const after = await handleRsvp({ headers: { authorization: `Bearer ${token}` }, body: { state: "no" }, params: { id: "e_kickoff" } }, ctx);
    assert.equal(after.status, 401);
    assert.equal(after.body.error, "unknown_member");
  });

  test("deleting an organizer de-identifies hosted events + clears their presence", async () => {
    const { ctx, repo } = makeCtx();
    // m_ada hosts e_kickoff + e_retro, has presence, co-claims t_slides with m_kata.
    const res = await handleDeleteAccount(authed(tokenFor("m_ada", ["organizer"])), ctx);
    assert.equal(res.body.deleted, true);
    const events = await repo.listEvents();
    const kickoff = events.find((e) => e.id === "e_kickoff");
    assert.equal(kickoff.hostId, null, "hosted event de-identified (ON DELETE SET NULL)");
    assert.equal(kickoff.hostHandle, null);
    assert.ok(!(await repo.listPresence()).some((p) => p.memberId === "m_ada"));
    // t_slides still has m_kata claiming -> stays 'claimed'.
    assert.equal((await repo.listTasks()).find((t) => t.id === "t_slides").status, "claimed");
  });

  test("filed reports are de-identified (reporter -> null), not deleted", async () => {
    const { ctx, repo } = makeCtx();
    // m_alan files a report, then deletes their account.
    await handleCreateReport(authed(tokenFor("m_alan"), { targetType: "event", targetId: "e_kickoff", reason: "spam" }), ctx);
    await handleDeleteAccount(authed(tokenFor("m_alan")), ctx);
    const report = repo.tables.reports.find((r) => r.targetId === "e_kickoff" && r.reason === "spam");
    assert.ok(report, "report retained for moderation history");
    assert.equal(report.reporterId, null, "reporter de-identified");
  });
});

// --- Layer 2: real Vercel Function entrypoints ------------------------------

function mockRes() {
  return {
    statusCode: 200,
    _headers: {},
    _body: "",
    setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
    getHeader(k) { return this._headers[k.toLowerCase()]; },
    end(b) { this._body = b || ""; },
    get json() { return this._body ? JSON.parse(this._body) : null; },
  };
}
async function call(endpoint, { method = "GET", headers = {}, body, query = {} } = {}) {
  const res = mockRes();
  await endpoint({ method, headers, body, query }, res);
  return { status: res.statusCode, headers: res._headers, json: res.json };
}

describe("real Vercel entrypoints (COMMUNITY_HUB_INMEMORY) enforce auth + method guards", () => {
  let reportsEndpoint, hideEndpoint, accountEndpoint, getWriteContext;

  before(async () => {
    process.env.COMMUNITY_HUB_INMEMORY = "1";
    process.env.COMMUNITY_HUB_AUTH_SECRET = SECRET;
    process.env.COMMUNITY_HUB_RATE_LIMIT = "1000";
    delete process.env.DATABASE_URL;
    ({ default: reportsEndpoint } = await import("../api/v1/reports.mjs"));
    ({ default: hideEndpoint } = await import("../api/v1/mod/hide.mjs"));
    ({ default: accountEndpoint } = await import("../api/v1/account.mjs"));
    ({ getWriteContext } = await import("../src/write-context.mjs"));
  });

  test("POST /v1/reports without a token -> 401", async () => {
    const res = await call(reportsEndpoint, { method: "POST", body: { targetType: "event", targetId: "e_kickoff" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "auth_required");
  });

  test("GET /v1/reports -> 405 (write-only) with Allow header", async () => {
    const res = await call(reportsEndpoint, { method: "GET" });
    assert.equal(res.status, 405);
    assert.equal(res.headers["allow"], "POST");
  });

  test("POST /v1/mod/hide without a token -> 401", async () => {
    const res = await call(hideEndpoint, { method: "POST", body: { targetType: "event", targetId: "e_kickoff" } });
    assert.equal(res.status, 401);
  });

  test("POST /v1/mod/hide with a non-moderator token -> 403", async () => {
    const token = createSessionToken({ sub: "m_alan", handle: "alan", roles: [] }, SECRET);
    const res = await call(hideEndpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { targetType: "event", targetId: "e_kickoff" } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, "forbidden");
  });

  test("POST /v1/mod/hide with a moderator token hides in the shared repo", async () => {
    const token = createSessionToken({ sub: "m_grace", handle: "grace", roles: ["moderator"] }, SECRET);
    const res = await call(hideEndpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: { targetType: "task", targetId: "t_recap" } });
    assert.equal(res.status, 200);
    const { repo } = await getWriteContext();
    assert.ok(!(await repo.listTasks()).some((t) => t.id === "t_recap"), "hidden in the singleton repo");
  });

  test("DELETE /v1/account without a token -> 401; GET -> 405", async () => {
    assert.equal((await call(accountEndpoint, { method: "DELETE" })).status, 401);
    const getRes = await call(accountEndpoint, { method: "GET" });
    assert.equal(getRes.status, 405);
    assert.equal(getRes.headers["allow"], "DELETE");
  });
});

// --- Layer 3: real Postgres planner (PGlite) --------------------------------

let PGlite = null;
let loadError = null;
try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch (err) {
  loadError = err;
}
const skip = PGlite
  ? false
  : `@electric-sql/pglite not installed (${loadError?.code ?? "unknown"}); run \`npm install\` in backend/`;

describe("M4 moderation + erasure against a real Postgres planner (PGlite)", { skip }, () => {
  let db;
  let repo;
  let mem;
  const now = () => NOW;

  async function freshDb() {
    const { applyMigrations } = await import("../db/migrate.mjs");
    const { INSERTS } = await import("../seed/seed.mjs");
    const d = await PGlite.create();
    await applyMigrations(d); // includes 0002_moderation (presence.hidden)
    const f = fixtures();
    for (const spec of INSERTS) {
      for (const row of spec.rows(f)) await d.query(spec.sql, spec.params(row));
    }
    return d;
  }

  before(async () => {
    db = await freshDb();
    repo = createSqlRepository({ query: (t, p) => db.query(t, p) }, { now });
    mem = createMemoryRepository(fixtures(), { now });
  });
  after(async () => {
    if (db) await db.close();
  });

  test("0002 migration added presence.hidden and it defaults false (parity read)", async () => {
    assert.deepEqual(await repo.listPresence(), await mem.listPresence());
  });

  test("hideEntry(presence): UPDATE ... hidden=true removes it from LIST_PRESENCE_SQL", async () => {
    const before = await repo.listPresence();
    assert.ok(before.some((p) => p.memberId === "m_ada"));
    const res = await repo.hideEntry({ targetType: "presence", targetId: "m_ada" });
    assert.equal(res.found, true);
    assert.ok(!(await repo.listPresence()).some((p) => p.memberId === "m_ada"));
  });

  test("hideEntry(event) resolves open reports (RETURNING count)", async () => {
    await repo.createReport({ targetType: "event", targetId: "e_workshop", reporterId: "m_alan", reason: "x" });
    await repo.createReport({ targetType: "event", targetId: "e_workshop", reporterId: "m_kata", reason: "y" });
    const res = await repo.hideEntry({ targetType: "event", targetId: "e_workshop" });
    assert.equal(res.found, true);
    assert.equal(res.resolvedReports, 2);
    assert.ok(!(await repo.listEvents()).some((e) => e.id === "e_workshop"));
  });

  test("hideEntry(missing) -> found:false, no reports touched", async () => {
    const res = await repo.hideEntry({ targetType: "task", targetId: "ghost" });
    assert.equal(res.found, false);
    assert.equal(res.resolvedReports, 0);
  });

  test("deleteMember cascade matches the in-memory reference (task reopen + counts)", async () => {
    // Use fresh, isolated dbs so earlier hides don't interfere.
    const d = await freshDb();
    const sqlRepo = createSqlRepository({ query: (t, p) => d.query(t, p) }, { now });
    const memRepo = createMemoryRepository(fixtures(), { now });
    try {
      const sqlRes = await sqlRepo.deleteMember("m_alan");
      const memRes = await memRepo.deleteMember("m_alan");
      assert.deepEqual(sqlRes.erased, memRes.erased);
      assert.deepEqual(sqlRes.erased, { rsvps: 2, checkIns: 1, taskClaims: 1, presence: 1 });
      // t_notes (sole claim by m_alan) reopens in BOTH; lists are byte-identical.
      assert.deepEqual(await sqlRepo.listTasks(), await memRepo.listTasks());
      assert.equal((await sqlRepo.listTasks()).find((t) => t.id === "t_notes").status, "open");
      // Member truly gone; hosted events untouched (m_alan hosts none).
      assert.equal(await sqlRepo.getMemberById("m_alan"), null);
      // Deleting again is a no-op.
      assert.equal((await sqlRepo.deleteMember("m_alan")).deleted, false);
    } finally {
      await d.close();
    }
  });

  test("deleteMember de-identifies hosted events (host_id -> NULL) via ON DELETE SET NULL", async () => {
    const d = await freshDb();
    const sqlRepo = createSqlRepository({ query: (t, p) => d.query(t, p) }, { now });
    try {
      await sqlRepo.deleteMember("m_ada"); // hosts e_kickoff + e_retro
      const kickoff = (await sqlRepo.listEvents()).find((e) => e.id === "e_kickoff");
      assert.equal(kickoff.hostId, null);
      assert.equal(kickoff.hostHandle, null);
    } finally {
      await d.close();
    }
  });
});
