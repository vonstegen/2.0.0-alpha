// Offline unit tests for the session-token auth guard (constitution Art. IV, X).
// No network, no DB — pure crypto + the in-memory repository.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AuthError,
  createSessionToken,
  verifySessionToken,
  extractBearerToken,
  getAuthSecret,
  authenticate,
} from "../src/auth.mjs";
import { createMemoryRepository } from "../src/repository.mjs";

const SECRET = "test-secret-at-least-16-chars-long";

describe("session token mint + verify", () => {
  test("round-trips a valid token", () => {
    const token = createSessionToken({ sub: "m_ada", handle: "ada", roles: ["organizer"] }, SECRET);
    const payload = verifySessionToken(token, SECRET);
    assert.equal(payload.sub, "m_ada");
    assert.equal(payload.handle, "ada");
    assert.deepEqual(payload.roles, ["organizer"]);
    assert.ok(payload.exp > payload.iat);
  });

  test("rejects a tampered payload (signature mismatch)", () => {
    const token = createSessionToken({ sub: "m_ada" }, SECRET);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "m_evil", exp: Date.now() + 1e6 }), "utf8").toString("base64url");
    assert.throws(() => verifySessionToken(`${forged}.${sig}`, SECRET), (e) => e instanceof AuthError && e.code === "bad_signature");
  });

  test("rejects a token signed with a different secret", () => {
    const token = createSessionToken({ sub: "m_ada" }, "another-secret-16-chars-xx");
    assert.throws(() => verifySessionToken(token, SECRET), (e) => e instanceof AuthError);
  });

  test("rejects an expired token", () => {
    const clock = { t: 1_000_000 };
    const token = createSessionToken({ sub: "m_ada" }, SECRET, { now: () => clock.t, ttlMs: 1000 });
    clock.t += 2000; // advance past expiry
    assert.throws(
      () => verifySessionToken(token, SECRET, { now: () => clock.t }),
      (e) => e instanceof AuthError && e.code === "token_expired",
    );
  });

  test("rejects malformed tokens", () => {
    for (const bad of ["", "no-dot", "a.b.c.d", 42, null]) {
      assert.throws(() => verifySessionToken(bad, SECRET), (e) => e instanceof AuthError);
    }
  });
});

describe("getAuthSecret", () => {
  test("throws when secret is missing or too short", () => {
    assert.throws(() => getAuthSecret({}), /COMMUNITY_HUB_AUTH_SECRET/);
    assert.throws(() => getAuthSecret({ COMMUNITY_HUB_AUTH_SECRET: "short" }), /too short/);
  });
  test("returns a valid secret", () => {
    assert.equal(getAuthSecret({ COMMUNITY_HUB_AUTH_SECRET: SECRET }), SECRET);
  });
});

describe("extractBearerToken", () => {
  test("parses Authorization header case-insensitively", () => {
    assert.equal(extractBearerToken({ authorization: "Bearer abc.def" }), "abc.def");
    assert.equal(extractBearerToken({ Authorization: "bearer xyz" }), "xyz");
    assert.equal(extractBearerToken({}), null);
    assert.equal(extractBearerToken({ authorization: "Basic zzz" }), null);
  });
});

describe("authenticate guard (fail closed)", () => {
  const repo = createMemoryRepository({
    members: [{ id: "m_ada", handle: "ada", displayName: "Ada", oauthSub: "github|1", roles: [], joinedAt: "2026-01-01T00:00:00.000Z" }],
  });

  test("rejects anonymous requests (no token) with 401 auth_required", async () => {
    await assert.rejects(
      authenticate({ headers: {} }, { secret: SECRET, repo }),
      (e) => e instanceof AuthError && e.status === 401 && e.code === "auth_required",
    );
  });

  test("rejects a valid signature whose member no longer exists", async () => {
    const token = createSessionToken({ sub: "m_ghost" }, SECRET);
    await assert.rejects(
      authenticate({ headers: { authorization: `Bearer ${token}` } }, { secret: SECRET, repo }),
      (e) => e instanceof AuthError && e.code === "unknown_member",
    );
  });

  test("accepts a valid token and returns the live member", async () => {
    const token = createSessionToken({ sub: "m_ada", handle: "ada" }, SECRET);
    const { member } = await authenticate({ headers: { authorization: `Bearer ${token}` } }, { secret: SECRET, repo });
    assert.equal(member.id, "m_ada");
    assert.equal(member.handle, "ada");
  });
});
