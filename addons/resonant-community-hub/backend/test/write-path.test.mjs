// Offline integration tests for the M2 authenticated write path.
//
// Two layers, both offline (constitution Art. IV, VII, X):
//   1. Pure write handlers over a SHARED in-memory repo with an injected clock —
//      proves the fail-closed pipeline (anon 401, role 403, validation 400,
//      rate-limit 429, event-window 409) AND that a write is reflected in the
//      public read path (shared-source proof, acceptance §9).
//   2. The REAL Vercel Function entrypoints (api/v1/**) driven with mock req/res
//      and COMMUNITY_HUB_INMEMORY=1 — proves the HTTP wrappers reject anonymous
//      callers and enforce the method guards end to end.

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createMemoryRepository } from "../src/repository.mjs";
import { createRateLimiter } from "../src/rate-limit.mjs";
import { createSessionToken } from "../src/auth.mjs";
import { signState } from "../src/github-oauth.mjs";
import { fixtures } from "../seed/fixtures.mjs";
import {
  handleCreateEvent,
  handleRsvp,
  handleCheckin,
  handleClaimTask,
  handleSetPresence,
  handleAuthCallback,
} from "../src/write-handlers.mjs";

const SECRET = "write-path-secret-16-plus-chars";
// A clock inside the kickoff window (2026-07-20 18:00–20:30Z) so check-in is live.
const NOW = Date.parse("2026-07-20T18:30:00.000Z");

const fakeOAuth = {
  buildAuthorizeUrl: ({ state }) => `https://github.com/login/oauth/authorize?state=${state}`,
  exchangeCodeForToken: async (code) => `gho_${code}`,
  fetchGitHubUser: async () => ({ id: 555, login: "newbie", name: "New Bie" }),
};

function makeCtx({ limit = 100 } = {}) {
  const now = () => NOW;
  const repo = createMemoryRepository(fixtures(), { now });
  const rateLimiter = createRateLimiter({ limit, windowMs: 60_000, now });
  const ctx = { repo, auth: { secret: SECRET, repo, now }, rateLimiter, oauth: fakeOAuth };
  return { ctx, repo, now };
}

function tokenFor(sub, roles = []) {
  return createSessionToken({ sub, handle: sub, roles }, SECRET, { now: () => NOW });
}
const authed = (token, body = {}, params = {}) => ({ headers: { authorization: `Bearer ${token}` }, body, params });

describe("write path: authentication (constitution Art. IV — no anonymous writes)", () => {
  test("every write rejects an anonymous caller with 401", async () => {
    const { ctx } = makeCtx();
    const anon = { headers: {}, body: {}, params: { id: "e_kickoff" } };
    for (const h of [handleCreateEvent, handleRsvp, handleCheckin, handleClaimTask, handleSetPresence]) {
      const res = await h(anon, ctx);
      assert.equal(res.status, 401, `${h.name} must reject anon`);
      assert.equal(res.body.error, "auth_required");
    }
  });

  test("rejects an invalid/forged token", async () => {
    const { ctx } = makeCtx();
    const res = await handleRsvp(
      { headers: { authorization: "Bearer not.a.valid.token" }, body: { state: "going" }, params: { id: "e_kickoff" } },
      ctx,
    );
    assert.equal(res.status, 401);
  });
});

describe("write path: create event (organizers only, FR-E2)", () => {
  test("non-organizer is forbidden (403)", async () => {
    const { ctx } = makeCtx();
    const res = await handleCreateEvent(authed(tokenFor("m_alan"), { title: "x", startsAt: "2026-08-01T10:00:00Z", url: "https://e.x" }), ctx);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "forbidden");
  });

  test("organizer creates an event and it appears in the public read", async () => {
    const { ctx, repo } = makeCtx();
    const res = await handleCreateEvent(
      authed(tokenFor("m_ada", ["organizer"]), {
        title: "New Planning Session",
        startsAt: "2026-08-01T10:00:00Z",
        endsAt: "2026-08-01T11:00:00Z",
        url: "https://meet.example.org/plan",
      }),
      ctx,
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.event.hostId, "m_ada");
    assert.equal(res.body.event.hostHandle, "ada");
    const events = await repo.listEvents();
    assert.ok(events.some((e) => e.title === "New Planning Session"), "created event is publicly listed");
  });

  test("invalid input is rejected with 400", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_ada", ["organizer"]);
    // missing title
    let res = await handleCreateEvent(authed(token, { startsAt: "2026-08-01T10:00:00Z", url: "https://e.x" }), ctx);
    assert.equal(res.status, 400);
    // missing both location and url
    res = await handleCreateEvent(authed(token, { title: "t", startsAt: "2026-08-01T10:00:00Z" }), ctx);
    assert.equal(res.status, 400);
  });
});

describe("write path: RSVP (FR-E3)", () => {
  test("updates state and the public count reflects it on next read", async () => {
    const { ctx, repo } = makeCtx();
    // grace currently RSVP'd 'no' to kickoff (going:2). Switch to 'going' -> going:3, no:0.
    const res = await handleRsvp(authed(tokenFor("m_grace"), { state: "going" }, { id: "e_kickoff" }), ctx);
    assert.equal(res.status, 200);
    const kickoff = (await repo.listEvents()).find((e) => e.id === "e_kickoff");
    assert.deepEqual(kickoff.rsvpCounts, { going: 3, interested: 1, no: 0 });
  });

  test("rejects an invalid state (400) and a missing event (404)", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_grace");
    assert.equal((await handleRsvp(authed(token, { state: "maybe" }, { id: "e_kickoff" }), ctx)).status, 400);
    assert.equal((await handleRsvp(authed(token, { state: "going" }, { id: "nope" }), ctx)).status, 404);
    // hidden events are not writable either
    assert.equal((await handleRsvp(authed(token, { state: "going" }, { id: "e_spam" }), ctx)).status, 404);
  });
});

describe("write path: live check-in, distinct from RSVP (FR-E4)", () => {
  test("check-in during the window increments attendance without touching RSVP", async () => {
    const { ctx, repo } = makeCtx();
    const before = (await repo.listEvents()).find((e) => e.id === "e_kickoff");
    assert.equal(before.attendanceCount, 0);
    const res = await handleCheckin(authed(tokenFor("m_grace"), {}, { id: "e_kickoff" }), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.body.checkin.created, true);
    const after = (await repo.listEvents()).find((e) => e.id === "e_kickoff");
    assert.equal(after.attendanceCount, 1);
    assert.deepEqual(after.rsvpCounts, before.rsvpCounts, "RSVP counts unchanged by check-in");
  });

  test("check-in is idempotent (second call does not double-count)", async () => {
    const { ctx, repo } = makeCtx();
    const token = tokenFor("m_grace");
    await handleCheckin(authed(token, {}, { id: "e_kickoff" }), ctx);
    const res = await handleCheckin(authed(token, {}, { id: "e_kickoff" }), ctx);
    assert.equal(res.body.checkin.created, false);
    const after = (await repo.listEvents()).find((e) => e.id === "e_kickoff");
    assert.equal(after.attendanceCount, 1);
  });

  test("check-in outside the event window is rejected (409)", async () => {
    const { ctx } = makeCtx();
    // e_retro is a past event (May 2026); NOW is July -> not live.
    const res = await handleCheckin(authed(tokenFor("m_grace"), {}, { id: "e_retro" }), ctx);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "event_not_live");
  });
});

describe("write path: task claim (FR-T2 / FR-T3)", () => {
  test("claim moves open->claimed and exposes an active GoalStepStatus", async () => {
    const { ctx, repo } = makeCtx();
    const res = await handleClaimTask(authed(tokenFor("m_alan"), { action: "claim" }, { id: "t_venue" }), ctx);
    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, "claimed");
    assert.equal(res.body.task.goalStepStatus, "active");
    assert.ok(res.body.task.claimedBy.includes("m_alan"));
    const venue = (await repo.listTasks()).find((t) => t.id === "t_venue");
    assert.equal(venue.status, "claimed");
  });

  test("unclaiming the last claimer returns the task to open", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_alan");
    await handleClaimTask(authed(token, { action: "claim" }, { id: "t_venue" }), ctx);
    const res = await handleClaimTask(authed(token, { action: "unclaim" }, { id: "t_venue" }), ctx);
    assert.equal(res.body.task.status, "open");
    assert.equal(res.body.task.goalStepStatus, "planned");
  });

  test("claiming a missing task is 404; bad action is 400", async () => {
    const { ctx } = makeCtx();
    const token = tokenFor("m_alan");
    assert.equal((await handleClaimTask(authed(token, { action: "claim" }, { id: "ghost" }), ctx)).status, 404);
    assert.equal((await handleClaimTask(authed(token, { action: "explode" }, { id: "t_venue" }), ctx)).status, 400);
  });
});

describe("write path: presence (opt-in + revocable, FR-P1)", () => {
  test("set then clear presence, reflected in the public strip", async () => {
    const { ctx, repo } = makeCtx();
    const token = tokenFor("m_grace");
    const set = await handleSetPresence(authed(token, { status: "reviewing", note: "PRs" }), ctx);
    assert.equal(set.status, 200);
    assert.equal(set.body.presence.status, "reviewing");
    assert.ok((await repo.listPresence()).some((p) => p.memberId === "m_grace"));

    const clear = await handleSetPresence(authed(token, { clear: true }), ctx);
    assert.equal(clear.body.cleared, true);
    assert.ok(!(await repo.listPresence()).some((p) => p.memberId === "m_grace"), "presence removed");
  });
});

describe("write path: rate limiting (constitution Art. VII — every write is limited)", () => {
  test("the (limit+1)th write in a window is rejected with 429 + Retry-After", async () => {
    const { ctx } = makeCtx({ limit: 2 });
    const token = tokenFor("m_grace");
    const call = () => handleRsvp(authed(token, { state: "going" }, { id: "e_kickoff" }), ctx);
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    const third = await call();
    assert.equal(third.status, 429);
    assert.equal(third.body.error, "rate_limited");
    assert.ok(third.headers["retry-after"]);
  });

  test("the limit is per-member (one member's limit does not affect another)", async () => {
    const { ctx } = makeCtx({ limit: 1 });
    const grace = () => handleRsvp(authed(tokenFor("m_grace"), { state: "going" }, { id: "e_kickoff" }), ctx);
    const alan = () => handleRsvp(authed(tokenFor("m_alan"), { state: "going" }, { id: "e_kickoff" }), ctx);
    assert.equal((await grace()).status, 200);
    assert.equal((await grace()).status, 429);
    assert.equal((await alan()).status, 200, "alan has his own budget");
  });

  test("successful writes carry X-RateLimit headers", async () => {
    const { ctx } = makeCtx({ limit: 5 });
    const res = await handleRsvp(authed(tokenFor("m_grace"), { state: "going" }, { id: "e_kickoff" }), ctx);
    assert.equal(res.headers["x-ratelimit-limit"], "5");
    assert.equal(res.headers["x-ratelimit-remaining"], "4");
  });
});

describe("write path: GitHub OAuth callback provisions a member + issues a usable token", () => {
  test("callback provisions a new member and the minted token authorizes a write", async () => {
    const { ctx, repo } = makeCtx();
    const state = signState(SECRET, { now: () => NOW });
    const res = await handleAuthCallback({ params: { code: "abc", state } }, ctx);
    assert.equal(res.status, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.member.handle, "newbie");
    assert.ok((await repo.getMemberById(res.body.member.id)), "member persisted");

    // Use the freshly minted session token to perform a write.
    const rsvp = await handleRsvp(authed(res.body.token, { state: "interested" }, { id: "e_workshop" }), ctx);
    assert.equal(rsvp.status, 200);
  });

  test("callback rejects a bad CSRF state (400) before calling GitHub", async () => {
    const { ctx } = makeCtx();
    const res = await handleAuthCallback({ params: { code: "abc", state: "forged.state.sig" } }, ctx);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "bad_state");
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
  let eventsEndpoint, rsvpEndpoint, presenceEndpoint, getWriteContext;

  before(async () => {
    process.env.COMMUNITY_HUB_INMEMORY = "1";
    process.env.COMMUNITY_HUB_AUTH_SECRET = SECRET;
    process.env.COMMUNITY_HUB_RATE_LIMIT = "1000";
    delete process.env.DATABASE_URL;
    ({ default: eventsEndpoint } = await import("../api/v1/events.mjs"));
    ({ default: rsvpEndpoint } = await import("../api/v1/events/[id]/rsvp.mjs"));
    ({ default: presenceEndpoint } = await import("../api/v1/presence.mjs"));
    ({ getWriteContext } = await import("../src/write-context.mjs"));
  });

  test("POST /v1/events without a token -> 401 (anonymous write rejected)", async () => {
    const res = await call(eventsEndpoint, { method: "POST", body: { title: "x" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "auth_required");
  });

  test("GET /v1/events still serves the public read path (200)", async () => {
    const res = await call(eventsEndpoint, { method: "GET" });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.events));
  });

  test("POST /v1/events/:id/rsvp with a valid token mutates the shared repo", async () => {
    const token = createSessionToken({ sub: "m_ada", handle: "ada", roles: ["organizer"] }, SECRET);
    const res = await call(rsvpEndpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: { state: "no" },
      query: { id: "e_kickoff" },
    });
    assert.equal(res.status, 200);
    // Read back through the SAME (singleton) write-context repo -> reflection.
    const { repo } = await getWriteContext();
    const kickoff = (await repo.listEvents()).find((e) => e.id === "e_kickoff");
    // m_ada was 'going'; now 'no'. going 2->1, no 1->2.
    assert.deepEqual(kickoff.rsvpCounts, { going: 1, interested: 1, no: 2 });
  });

  test("GET on a write-only route -> 405 with Allow header", async () => {
    const res = await call(rsvpEndpoint, { method: "GET", query: { id: "e_kickoff" } });
    assert.equal(res.status, 405);
    assert.equal(res.headers["allow"], "POST");
  });

  test("PUT /v1/presence without a token -> 401", async () => {
    const res = await call(presenceEndpoint, { method: "PUT", body: { status: "around" } });
    assert.equal(res.status, 401);
  });
});
