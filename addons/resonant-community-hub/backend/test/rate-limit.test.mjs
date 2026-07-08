// Offline unit tests for the write-path rate limiter (constitution Art. VII, X).
// Deterministic via an injected clock — no sleeping.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRateLimiter } from "../src/rate-limit.mjs";

describe("createRateLimiter (fixed window)", () => {
  test("allows up to `limit` writes then rejects with retry-after", () => {
    const clock = { t: 0 };
    const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => clock.t });
    const a = rl.consume("k");
    const b = rl.consume("k");
    const c = rl.consume("k");
    assert.deepEqual([a.allowed, b.allowed, c.allowed], [true, true, true]);
    assert.deepEqual([a.remaining, b.remaining, c.remaining], [2, 1, 0]);

    const d = rl.consume("k");
    assert.equal(d.allowed, false);
    assert.equal(d.remaining, 0);
    assert.ok(d.retryAfterMs > 0 && d.retryAfterMs <= 1000);
  });

  test("resets after the window elapses", () => {
    const clock = { t: 0 };
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => clock.t });
    assert.equal(rl.consume("k").allowed, true);
    assert.equal(rl.consume("k").allowed, false);
    clock.t += 1000; // window boundary
    assert.equal(rl.consume("k").allowed, true, "new window starts fresh");
  });

  test("isolates buckets by key (per member)", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    assert.equal(rl.consume("member:a").allowed, true);
    assert.equal(rl.consume("member:a").allowed, false);
    assert.equal(rl.consume("member:b").allowed, true, "different member has its own budget");
  });

  test("remaining() peeks without consuming", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 1000, now: () => 0 });
    assert.equal(rl.remaining("k"), 2);
    rl.consume("k");
    assert.equal(rl.remaining("k"), 1);
    assert.equal(rl.remaining("k"), 1, "peek did not consume");
  });

  test("reset(key) clears a single bucket", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    rl.consume("k");
    assert.equal(rl.consume("k").allowed, false);
    rl.reset("k");
    assert.equal(rl.consume("k").allowed, true);
  });

  test("rejects invalid config", () => {
    assert.throws(() => createRateLimiter({ limit: 0 }), /positive integer/);
    assert.throws(() => createRateLimiter({ windowMs: 0 }), /positive number/);
  });
});
