// Stateless session auth for the Community Hub write path (constitution Art. IV —
// "public read, authenticated write"; no anonymous writes).
//
// Design: after GitHub OAuth (see github-oauth.mjs) provisions a Member, the
// backend mints an HMAC-signed session token. Clients (the local bridge, never the
// extension directly — Art. II) send it as `Authorization: Bearer <token>` on every
// write. Verification is stateless: no session table, no DB round-trip to check a
// token's signature, so it scales across stateless Vercel Functions (Art. VI).
//
// The token is `base64url(json).base64url(hmac_sha256(json))`. The signature is
// verified in constant time; the payload carries `sub` (member id), `handle`,
// `iat`, and `exp`. Everything here is pure Node crypto — fully offline-testable.
//
// Secret handling (Art. VIII; plan: token storage = host vault / env, never
// committed): the HMAC key comes only from COMMUNITY_HUB_AUTH_SECRET in the
// environment. No default, no fallback — misconfiguration fails loud.

import { createHmac, timingSafeEqual } from "node:crypto";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Auth failures carry an HTTP status + machine code so handlers can fail closed. */
export class AuthError extends Error {
  /** @param {string} message @param {{ status?: number, code?: string }} [opts] */
  constructor(message, { status = 401, code = "unauthorized" } = {}) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

const encode = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
const decode = (str) => JSON.parse(Buffer.from(str, "base64url").toString("utf8"));

function hmac(data, secret) {
  return createHmac("sha256", secret).update(data).digest();
}

/**
 * Resolve the HMAC secret from the environment. No default — a missing secret is a
 * configuration error, not a soft fallback (never sign tokens with a known key).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getAuthSecret(env = process.env) {
  const secret = String(env.COMMUNITY_HUB_AUTH_SECRET ?? "").trim();
  if (secret.length < 16) {
    throw new Error(
      "COMMUNITY_HUB_AUTH_SECRET is missing or too short (need >=16 chars). " +
        "Provide it via the host vault / environment; never commit it.",
    );
  }
  return secret;
}

/**
 * Mint a signed session token for a provisioned member.
 * @param {{ sub: string, handle?: string, roles?: string[] }} claims
 * @param {string} secret
 * @param {{ now?: () => number, ttlMs?: number }} [opts]
 */
export function createSessionToken(claims, secret, { now = Date.now, ttlMs = SEVEN_DAYS_MS } = {}) {
  if (!claims || typeof claims.sub !== "string" || !claims.sub) {
    throw new Error("createSessionToken requires a claims.sub (member id).");
  }
  const issued = now();
  const payload = {
    sub: claims.sub,
    handle: claims.handle ?? null,
    roles: Array.isArray(claims.roles) ? claims.roles : [],
    iat: issued,
    exp: issued + ttlMs,
  };
  const body = encode(payload);
  const sig = hmac(body, secret).toString("base64url");
  return `${body}.${sig}`;
}

/**
 * Verify a session token's signature + expiry. Throws AuthError on any problem
 * (fail closed). Returns the decoded payload on success.
 * @param {unknown} token
 * @param {string} secret
 * @param {{ now?: () => number }} [opts]
 */
export function verifySessionToken(token, secret, { now = Date.now } = {}) {
  if (typeof token !== "string" || token.indexOf(".") === -1) {
    throw new AuthError("Malformed session token.", { code: "bad_token" });
  }
  const dot = token.indexOf(".");
  const body = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expected = hmac(body, secret);
  let provided;
  try {
    provided = Buffer.from(providedSig, "base64url");
  } catch {
    throw new AuthError("Malformed session token signature.", { code: "bad_token" });
  }
  // Constant-time compare; length guard first (timingSafeEqual throws on mismatch).
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AuthError("Invalid session token signature.", { code: "bad_signature" });
  }
  let payload;
  try {
    payload = decode(body);
  } catch {
    throw new AuthError("Corrupt session token payload.", { code: "bad_token" });
  }
  if (typeof payload.exp !== "number" || now() > payload.exp) {
    throw new AuthError("Session token expired.", { code: "token_expired" });
  }
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new AuthError("Session token missing subject.", { code: "bad_token" });
  }
  return payload;
}

/** Pull the bearer token out of request headers, or null if absent. */
export function extractBearerToken(headers = {}) {
  const raw = headers.authorization ?? headers.Authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : null;
}

/**
 * Authenticate a write request. Fail closed: no token, bad token, expired token,
 * or unknown member all throw AuthError. On success returns the live member row.
 *
 * @param {{ headers?: Record<string, string> }} req
 * @param {{ secret: string, repo: { getMemberById: (id: string) => Promise<any> }, now?: () => number }} ctx
 * @returns {Promise<{ member: any, token: object }>}
 */
export async function authenticate(req, { secret, repo, now = Date.now }) {
  const token = extractBearerToken(req?.headers ?? {});
  if (!token) {
    throw new AuthError("Authentication required: writes are members-only.", {
      code: "auth_required",
    });
  }
  const payload = verifySessionToken(token, secret, { now });
  const member = await repo.getMemberById(payload.sub);
  if (!member) {
    throw new AuthError("No member matches this token (was the account deleted?).", {
      code: "unknown_member",
    });
  }
  return { member, token: payload };
}
