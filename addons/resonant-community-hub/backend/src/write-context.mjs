// Build the write-path context (repo + auth secret + rate limiter [+ OAuth client])
// once per warm Vercel instance. The rate limiter is a module-level singleton so
// its in-memory window survives across invocations on the same instance (per-
// instance limitation is documented in rate-limit.mjs / README).

import { createRepositoryFromEnv } from "../db/index.mjs";
import { getAuthSecret } from "./auth.mjs";
import { createRateLimiter } from "./rate-limit.mjs";
import { getGitHubOAuthConfig, createGitHubOAuth } from "./github-oauth.mjs";

let repoPromise;
let rateLimiter;
let authRateLimiter;

function buildRateLimiter(env) {
  const limit = Number.parseInt(env.COMMUNITY_HUB_RATE_LIMIT ?? "", 10);
  const windowMs = Number.parseInt(env.COMMUNITY_HUB_RATE_WINDOW_MS ?? "", 10);
  return createRateLimiter({
    limit: Number.isFinite(limit) && limit > 0 ? limit : 20,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  });
}

// Separate limiter for the UNauthenticated OAuth endpoints (start/callback).
// These have no member to key on, so they are keyed by client IP (see
// write-handlers.rateLimitOAuth) and tuned tighter than member writes — the
// callback both provisions a member row and burns GitHub token/user quota, so
// it must be throttled without any credentials (constitution Art. VII, spec §9).
function buildAuthRateLimiter(env) {
  const limit = Number.parseInt(env.COMMUNITY_HUB_AUTH_RATE_LIMIT ?? "", 10);
  const windowMs = Number.parseInt(env.COMMUNITY_HUB_AUTH_RATE_WINDOW_MS ?? "", 10);
  return createRateLimiter({
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
  });
}

/** Context for the mutating write endpoints (no OAuth client needed). */
export async function getWriteContext(env = process.env) {
  repoPromise ??= createRepositoryFromEnv(env);
  const repo = await repoPromise;
  const secret = getAuthSecret(env);
  rateLimiter ??= buildRateLimiter(env);
  return { repo, auth: { secret, repo, now: Date.now }, rateLimiter };
}

/** Context for the OAuth sign-in endpoints (adds the GitHub client + IP limiter). */
export async function getOAuthContext(env = process.env) {
  const base = await getWriteContext(env);
  const oauth = createGitHubOAuth(getGitHubOAuthConfig(env));
  authRateLimiter ??= buildAuthRateLimiter(env);
  return { ...base, oauth, authRateLimiter };
}

/** Reset module singletons — test hook so suites don't leak repo/limiter state. */
export function _resetWriteContext() {
  repoPromise = undefined;
  rateLimiter = undefined;
  authRateLimiter = undefined;
}
