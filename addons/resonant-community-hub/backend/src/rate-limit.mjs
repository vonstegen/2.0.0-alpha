// Rate limiting for every write endpoint (constitution Art. VII — "Every write
// endpoint is rate-limited"; Non-goal: abuse controls ship in v1, not "later").
//
// Implementation: a fixed-window counter keyed by `<route>:<memberId>`. Writes are
// already members-only (auth.mjs), so the natural limit key is the member, not a
// spoofable IP. `now` is injectable so the window logic is fully deterministic
// offline (no sleeping in tests).
//
// KNOWN LIMITATION (documented, deferred): the default store is a per-instance
// in-memory Map, so limits are per warm Vercel Function instance, not global. For
// v1 single-community scale that meaningfully caps abuse from one member. A shared
// store (Neon table or Upstash Redis) is a drop-in via the `store` option and is
// deferred to a later milestone — see README. The `store` seam means swapping it
// requires no handler changes.

/**
 * @typedef {Object} RateLimitResult
 * @property {boolean} allowed
 * @property {number}  limit          max writes per window
 * @property {number}  remaining      writes left in the current window
 * @property {number}  resetAt        epoch ms when the window resets
 * @property {number}  retryAfterMs   ms until the caller may retry (0 when allowed)
 */

/**
 * Minimal store contract: get/set/delete of `{ count, resetAt }` entries. A Map
 * satisfies it; a Redis/SQL adapter can too.
 * @typedef {{ get: (k: string) => any, set: (k: string, v: any) => void, delete: (k: string) => void }} RateStore
 */

/**
 * Create a fixed-window rate limiter.
 * @param {{ limit?: number, windowMs?: number, now?: () => number, store?: RateStore }} [opts]
 */
export function createRateLimiter({ limit = 20, windowMs = 60_000, now = Date.now, store = new Map() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("rate limiter `limit` must be a positive integer.");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("rate limiter `windowMs` must be a positive number.");
  }

  /**
   * Consume one unit for `key`. Returns whether it was allowed plus header data.
   * @param {string} key
   * @returns {RateLimitResult}
   */
  function consume(key) {
    const t = now();
    const entry = store.get(key);
    // No window yet, or the previous window has fully elapsed -> start fresh.
    if (!entry || t >= entry.resetAt) {
      const resetAt = t + windowMs;
      store.set(key, { count: 1, resetAt });
      return { allowed: true, limit, remaining: limit - 1, resetAt, retryAfterMs: 0 };
    }
    if (entry.count >= limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAt: entry.resetAt,
        retryAfterMs: Math.max(0, entry.resetAt - t),
      };
    }
    entry.count += 1;
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.resetAt,
      retryAfterMs: 0,
    };
  }

  /** Peek at remaining budget without consuming (used by tests / diagnostics). */
  function remaining(key) {
    const entry = store.get(key);
    if (!entry || now() >= entry.resetAt) return limit;
    return Math.max(0, limit - entry.count);
  }

  function reset(key) {
    if (key === undefined) {
      if (typeof store.clear === "function") store.clear();
      return;
    }
    store.delete(key);
  }

  return { consume, remaining, reset, limit, windowMs };
}
