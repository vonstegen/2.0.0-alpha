// Pure handlers for the M2 authenticated write path + GitHub OAuth sign-in.
//
// Every write runs the same fail-closed pipeline (constitution Art. IV + VII):
//   1. authenticate()  — reject anonymous / bad / expired tokens with 401.
//   2. rate limit      — per member+route; reject with 429 (+ Retry-After).
//   3. validate        — reject malformed input with 400.
//   4. mutate          — call the Repository write method.
// Handlers are framework-agnostic ({ status, body, headers }); the Vercel Function
// wrappers (api/v1/**) only translate req/res, so this all runs under `node --test`.

import { authenticate, AuthError, createSessionToken } from "./auth.mjs";
import {
  OAuthError,
  signState,
  verifyState,
  deriveMemberFromGitHubUser,
} from "./github-oauth.mjs";
import {
  ValidationError,
  validateCreateEvent,
  validateRsvp,
  validateClaim,
  validatePresence,
} from "./validation.mjs";

const err = (status, code, message, headers) => ({ status, headers, body: { error: code, message } });

/**
 * Shared guard: authenticate, rate-limit, then run `mutate({ member, body, params })`.
 * Any AuthError/ValidationError thrown inside is mapped to its HTTP shape.
 *
 * @param {{ headers?: object, body?: any, params?: object }} req
 * @param {object} ctx  { repo, auth:{secret,now}, rateLimiter }
 * @param {string} route stable rate-limit bucket name, e.g. "events:rsvp"
 * @param {(args: { member: any, body: any, params: object }) => Promise<{status:number,body:object,headers?:object}>} mutate
 */
export async function guardWrite(req, ctx, route, mutate) {
  // 1. Authentication (fail closed).
  let auth;
  try {
    auth = await authenticate(req, ctx.auth);
  } catch (e) {
    if (e instanceof AuthError) return err(e.status, e.code, e.message);
    throw e;
  }

  // 2. Rate limit, keyed by member so it can't be evaded by rotating IPs.
  const decision = ctx.rateLimiter.consume(`${route}:${auth.member.id}`);
  const rateHeaders = {
    "x-ratelimit-limit": String(decision.limit),
    "x-ratelimit-remaining": String(decision.remaining),
    "x-ratelimit-reset": String(Math.ceil(decision.resetAt / 1000)),
  };
  if (!decision.allowed) {
    return err(429, "rate_limited", "Too many writes; slow down.", {
      ...rateHeaders,
      "retry-after": String(Math.ceil(decision.retryAfterMs / 1000)),
    });
  }

  // 3 + 4. Validate + mutate.
  let result;
  try {
    result = await mutate({ member: auth.member, body: req.body ?? {}, params: req.params ?? {} });
  } catch (e) {
    if (e instanceof ValidationError) return err(e.status, e.code, e.message);
    if (e instanceof AuthError) return err(e.status, e.code, e.message);
    throw e;
  }
  result.headers = { ...rateHeaders, ...(result.headers ?? {}) };
  return result;
}

// --- Write endpoints --------------------------------------------------------

/** POST /v1/events — organizers only (spec FR-E2). */
export function handleCreateEvent(req, ctx) {
  return guardWrite(req, ctx, "events:create", async ({ member, body }) => {
    if (!Array.isArray(member.roles) || !member.roles.includes("organizer")) {
      return err(403, "forbidden", "Only organizers can create events.");
    }
    const input = validateCreateEvent(body);
    const event = await ctx.repo.createEvent({ ...input, hostId: member.id });
    return { status: 201, body: { event } };
  });
}

/** POST /v1/events/:id/rsvp (spec FR-E3). */
export function handleRsvp(req, ctx) {
  return guardWrite(req, ctx, "events:rsvp", async ({ member, body, params }) => {
    const eventId = params.id;
    const event = await ctx.repo.getEventById(eventId);
    if (!event || event.hidden) return err(404, "not_found", "Event not found.");
    const { state } = validateRsvp(body);
    const rsvp = await ctx.repo.setRsvp({ eventId, memberId: member.id, state });
    return { status: 200, body: { rsvp } };
  });
}

/** POST /v1/events/:id/checkin — live attendance, only within the event window (FR-E4). */
export function handleCheckin(req, ctx) {
  return guardWrite(req, ctx, "events:checkin", async ({ member, params }) => {
    const eventId = params.id;
    const event = await ctx.repo.getEventById(eventId);
    if (!event || event.hidden) return err(404, "not_found", "Event not found.");
    const t = ctx.auth.now ? ctx.auth.now() : Date.now();
    const startsAt = Date.parse(event.startsAt);
    // Attendance is distinct from RSVP: only allowed during the live window.
    const graceMs = 15 * 60 * 1000; // allow check-in from 15m before start
    const endsAt = event.endsAt ? Date.parse(event.endsAt) : startsAt + 4 * 60 * 60 * 1000;
    if (t < startsAt - graceMs || t > endsAt + graceMs) {
      return err(409, "event_not_live", "Check-in is only open during the event window.");
    }
    const checkin = await ctx.repo.checkIn({ eventId, memberId: member.id });
    return { status: 200, body: { checkin } };
  });
}

/** POST /v1/tasks/:id/claim — claim / un-claim (spec FR-T2). */
export function handleClaimTask(req, ctx) {
  return guardWrite(req, ctx, "tasks:claim", async ({ member, body, params }) => {
    const taskId = params.id;
    const { action } = validateClaim(body);
    const task = await ctx.repo.claimTask({ taskId, memberId: member.id, action });
    if (!task) return err(404, "not_found", "Task not found.");
    return { status: 200, body: { task } };
  });
}

/** PUT /v1/presence — set or clear own opt-in presence (spec FR-P1). */
export function handleSetPresence(req, ctx) {
  return guardWrite(req, ctx, "presence:set", async ({ member, body }) => {
    const input = validatePresence(body);
    if (input.clear) {
      const res = await ctx.repo.clearPresence(member.id);
      return { status: 200, body: { presence: null, cleared: res.cleared } };
    }
    const presence = await ctx.repo.setPresence({
      memberId: member.id,
      status: input.status,
      note: input.note,
    });
    return { status: 200, body: { presence } };
  });
}

// --- GitHub OAuth sign-in ---------------------------------------------------

/**
 * GET /v1/auth/github/start — redirect the client to GitHub's authorize page with
 * a signed, expiring CSRF `state` (plan: GitHub OAuth only, no anonymous writes).
 */
export function handleAuthStart(req, ctx) {
  const state = signState(ctx.auth.secret, { now: ctx.auth.now });
  const location = ctx.oauth.buildAuthorizeUrl({ state });
  return { status: 302, headers: { location }, body: { redirect: location } };
}

/**
 * GET /v1/auth/github/callback — verify state, exchange the code, provision the
 * Member (FR-A2), and mint a session token. Returns JSON for v1; M3 wires the
 * redirect that hands the token back to the local bridge.
 */
export async function handleAuthCallback(req, ctx) {
  const { code, state } = req.params ?? {};
  try {
    verifyState(state, ctx.auth.secret, { now: ctx.auth.now });
    const accessToken = await ctx.oauth.exchangeCodeForToken(code);
    const ghUser = await ctx.oauth.fetchGitHubUser(accessToken);
    const identity = deriveMemberFromGitHubUser(ghUser);
    const { member, created } = await ctx.repo.provisionMember(identity);
    const token = createSessionToken(
      { sub: member.id, handle: member.handle, roles: member.roles },
      ctx.auth.secret,
      { now: ctx.auth.now },
    );
    return {
      status: 200,
      body: {
        token,
        member: { id: member.id, handle: member.handle, displayName: member.displayName, roles: member.roles },
        created,
      },
    };
  } catch (e) {
    if (e instanceof OAuthError) return err(e.status, e.code, e.message);
    if (e instanceof AuthError) return err(e.status, e.code, e.message);
    throw e;
  }
}
