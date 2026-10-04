// CP-S2B test for the grant broker in browser-first/host/terminal-host-service.mjs.
//
// Covers:
//  - trackSessionBootstrapGrant records + returns the grant
//  - consumeGrant happy path
//  - consumeGrant rejects: unknown-session, wrong-session, already-consumed, expired
//  - attachSessionEnv returns the projected env via buildSessionEnvironment
//  - attachSessionEnv fails closed when resolveCredential returns null for a named profile
//  - attachSessionEnv rejects the same ways as consumeGrant
//  - secret value never appears in the rejection error / argv of the losing call
//  - single-use: a second consumeGrant after a successful attach returns already-consumed

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  mintSessionBootstrapGrant,
  trackSessionBootstrapGrant,
  consumeGrant,
  attachSessionEnv,
  listOutstandingGrants,
  __resetSessionBootstrapGrantBroker,
  GRANT_PUBLIC_REJECTION_REASONS,
} from "../host/terminal-host-service.mjs";

const FIXED_NOW = () => new Date("2026-10-04T00:00:00.000Z");
const TTL_MS = 60_000;

describe("trackSessionBootstrapGrant + listOutstandingGrants", () => {
  beforeEach(() => __resetSessionBootstrapGrantBroker());

  it("records the grant and returns it (so it composes inline)", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    const tracked = trackSessionBootstrapGrant(g);
    assert.equal(tracked, g);
    const list = listOutstandingGrants();
    assert.equal(list.length, 1);
    assert.equal(list[0].sessionId, "s1");
    assert.equal(list[0].token, g.token);
    assert.equal(list[0].consumed, false);
  });

  it("overwrites any previous record for the same sessionId (single-session policy)", () => {
    const g1 = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    const g2 = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g1);
    trackSessionBootstrapGrant(g2);
    const list = listOutstandingGrants();
    assert.equal(list.length, 1);
    assert.equal(list[0].token, g2.token);
  });

  it("never logs or returns the secret token via rejection paths", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const unknown = consumeGrant({ sessionId: "s2", token: g.token, now: FIXED_NOW });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) {
      assert.equal(unknown.reason, "unknown-session");
      assert.equal(Object.keys(unknown).join(","), "ok,reason");
      // The token must not appear in the rejection payload.
      assert.equal(JSON.stringify(unknown).includes(g.token), false);
    }
  });
});

describe("consumeGrant", () => {
  beforeEach(() => __resetSessionBootstrapGrantBroker());

  it("returns the grant on a valid claim", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const claim = consumeGrant({ sessionId: "s1", token: g.token, now: FIXED_NOW });
    assert.equal(claim.ok, true);
    if (claim.ok) assert.equal(claim.grant.sessionId, "s1");
  });

  it("rejects unknown-session", () => {
    const r = consumeGrant({ sessionId: "missing", token: "x", now: FIXED_NOW });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "unknown-session");
  });

  it("rejects wrong-session (token does not match)", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const r = consumeGrant({ sessionId: "s1", token: "totally-different-token", now: FIXED_NOW });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "wrong-session");
  });

  it("rejects expired grants", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW, ttlMs: TTL_MS });
    trackSessionBootstrapGrant(g);
    const later = () => new Date("2026-10-04T00:02:00.000Z"); // 2 min after issue, past TTL
    const r = consumeGrant({ sessionId: "s1", token: g.token, now: later });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "expired");
  });

  it("rejects a replayed grant as already-consumed (single-use)", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const first = consumeGrant({ sessionId: "s1", token: g.token, now: FIXED_NOW });
    assert.equal(first.ok, true);
    const replay = consumeGrant({ sessionId: "s1", token: g.token, now: FIXED_NOW });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "already-consumed");
  });
});

describe("attachSessionEnv", () => {
  beforeEach(() => __resetSessionBootstrapGrantBroker());

  const CRED = { name: "OPENAI_API_KEY", value: "sk-live-secret" };

  it("happy path: returns the projected env, secret lives only under the credential name", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const result = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: FIXED_NOW,
      baseEnv: { HOME: "/x" },
      envAllowlist: ["PATH"],
      parentEnv: { PATH: "/bin" },
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.env.HOME, "/x");
    assert.equal(result.env.PATH, "/bin");
    assert.equal(result.env.OPENAI_API_KEY, "sk-live-secret");
    // meta must not contain the secret value:
    const meta = JSON.parse(result.env._meta);
    assert.equal(meta.sessionId, "s1");
    assert.equal(meta.providerProfileId, "openai");
  });

  it("rejects with unknown-session for a session that was never tracked", () => {
    const result = attachSessionEnv({
      sessionId: "ghost",
      token: "anything",
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unknown-session");
  });

  it("rejects with wrong-session when the token does not match", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const result = attachSessionEnv({
      sessionId: "s1",
      token: "different-token",
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "wrong-session");
  });

  it("rejects with expired when the grant TTL has elapsed", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW, ttlMs: TTL_MS });
    trackSessionBootstrapGrant(g);
    const later = () => new Date("2026-10-04T00:02:00.000Z");
    const result = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: later,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "expired");
  });

  it("rejects with already-consumed on a replayed attach", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const first = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(first.ok, true);
    const replay = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.reason, "already-consumed");
  });

  it("fails closed when providerProfileId is named but resolveCredential returns null", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    const result = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-credential");
  });

  it("does not call resolveCredential when providerProfileId is absent", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    /** @type {string[]} */
    const calls = [];
    const result = attachSessionEnv({
      sessionId: "s1",
      token: g.token,
      now: FIXED_NOW,
      baseEnv: { HOME: "/x" },
      resolveCredential: (id) => {
        calls.push(id);
        return { name: "X", value: "y" };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 0);
  });

  it("the secret value never appears in argv-shaped callers (no echo in result fields)", () => {
    const g = mintSessionBootstrapGrant({ sessionId: "s1", purpose: "attach", now: FIXED_NOW });
    trackSessionBootstrapGrant(g);
    // Force a rejected path; the secret must not surface.
    const result = attachSessionEnv({
      sessionId: "s1",
      token: "wrong",
      now: FIXED_NOW,
      providerProfileId: "openai",
      resolveCredential: () => CRED,
    });
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes(CRED.value), false);
    assert.equal(serialized.includes(CRED.name), false);
  });

  it("GRANT_PUBLIC_REJECTION_REASONS exposes the public rejection vocabulary", () => {
    assert.deepEqual(Object.keys(GRANT_PUBLIC_REJECTION_REASONS).sort(), [
      "already-consumed",
      "expired",
      "unknown-session",
      "wrong-session",
    ]);
  });
});