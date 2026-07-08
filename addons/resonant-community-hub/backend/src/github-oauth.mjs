// GitHub OAuth sign-in (constitution Art. IV — authenticated write; plan.md
// decision: GitHub OAuth ONLY for v1, no Google/magic-link, no anonymous writes).
//
// The two-leg web flow:
//   1. /v1/auth/github/start    -> 302 to github.com/login/oauth/authorize?...&state=<signed>
//   2. /v1/auth/github/callback -> exchange ?code for an access token, fetch the
//      GitHub user, provision a Member, mint a session token (auth.mjs).
//
// The outbound calls to GitHub mirror the bridge's outbound-fetch precedent
// (browser-first/host/provider-bridge-service.mjs: `fetch` with an AbortController
// timeout). `fetchImpl` is INJECTABLE so the whole exchange is testable offline with
// a fake — no live GitHub, no network (sandbox reality). Secrets (client id/secret)
// come only from the environment / host vault, never committed (Art. VIII).
//
// CSRF: the `state` param is an HMAC-signed, short-lived nonce (signState below).
// The callback verifies the signature + freshness before trusting the code. This is
// a stateless binding suitable for v1; binding state to a bridge-held session is a
// later hardening (documented in README).

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const DEFAULT_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete sign-in

/** OAuth failures carry an HTTP status + code so the callback can fail closed. */
export class OAuthError extends Error {
  constructor(message, { status = 502, code = "oauth_error" } = {}) {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.code = code;
  }
}

// --- CSRF state token (signed, expiring) ------------------------------------

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** Sign a fresh CSRF `state` value: `base64url(nonce.exp).hmac`. */
export function signState(secret, { now = Date.now, ttlMs = DEFAULT_STATE_TTL_MS } = {}) {
  const body = `${randomBytes(12).toString("base64url")}.${now() + ttlMs}`;
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Verify a CSRF `state`: signature + not expired. Throws OAuthError on failure. */
export function verifyState(state, secret, { now = Date.now } = {}) {
  if (typeof state !== "string") {
    throw new OAuthError("Missing OAuth state.", { status: 400, code: "bad_state" });
  }
  const parts = state.split(".");
  if (parts.length !== 3) {
    throw new OAuthError("Malformed OAuth state.", { status: 400, code: "bad_state" });
  }
  const [nonce, expStr, sig] = parts;
  const body = `${nonce}.${expStr}`;
  const expected = createHmac("sha256", secret).update(body).digest();
  let provided;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    throw new OAuthError("Malformed OAuth state signature.", { status: 400, code: "bad_state" });
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new OAuthError("Invalid OAuth state signature (possible CSRF).", {
      status: 400,
      code: "bad_state",
    });
  }
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || now() > exp) {
    throw new OAuthError("OAuth state expired; restart sign-in.", { status: 400, code: "state_expired" });
  }
  return true;
}

// --- OAuth client -----------------------------------------------------------

/**
 * Read GitHub OAuth config from the environment. No defaults for secrets.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function getGitHubOAuthConfig(env = process.env) {
  const clientId = String(env.GITHUB_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = String(env.GITHUB_OAUTH_CLIENT_SECRET ?? "").trim();
  const redirectUri = String(env.GITHUB_OAUTH_REDIRECT_URI ?? "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID and " +
        "GITHUB_OAUTH_CLIENT_SECRET (host vault / env; never committed).",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

async function fetchWithTimeout(fetchImpl, url, init, { timeoutMs = 8000, label = "GitHub" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new OAuthError(`${label} request timed out.`, { code: "oauth_timeout" });
    }
    throw new OAuthError(`${label} request failed: ${err.message}`, { code: "oauth_network" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Derive a minimal, stable Member identity from a GitHub user (Art. VIII data
 * minimization: only oauthSub, handle, displayName). `oauthSub` is namespaced with
 * the provider so a future provider can't collide.
 * @param {{ id: number|string, login: string, name?: string|null }} ghUser
 */
export function deriveMemberFromGitHubUser(ghUser) {
  if (!ghUser || ghUser.id == null || !ghUser.login) {
    throw new OAuthError("GitHub user response missing id/login.", { code: "oauth_bad_user" });
  }
  return {
    oauthSub: `github|${ghUser.id}`,
    handle: String(ghUser.login),
    displayName: ghUser.name ? String(ghUser.name) : String(ghUser.login),
  };
}

/**
 * Create a GitHub OAuth client. `fetchImpl` defaults to the platform `fetch`
 * (outbound precedent) and is injected in tests.
 * @param {{ clientId: string, clientSecret: string, redirectUri?: string, fetchImpl?: typeof fetch }} config
 */
export function createGitHubOAuth({ clientId, clientSecret, redirectUri, fetchImpl = globalThis.fetch }) {
  if (!clientId || !clientSecret) {
    throw new Error("createGitHubOAuth requires clientId and clientSecret.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createGitHubOAuth requires a fetch implementation (none available).");
  }

  /** Build the authorize URL the client is redirected to (leg 1). */
  function buildAuthorizeUrl({ state, scope = "read:user" } = {}) {
    const params = new URLSearchParams({ client_id: clientId, scope, state });
    if (redirectUri) params.set("redirect_uri", redirectUri);
    params.set("allow_signup", "true");
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Exchange an authorization `code` for a GitHub access token (leg 2a). */
  async function exchangeCodeForToken(code) {
    if (!code) throw new OAuthError("Missing authorization code.", { status: 400, code: "bad_code" });
    const res = await fetchWithTimeout(
      fetchImpl,
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          ...(redirectUri ? { redirect_uri: redirectUri } : {}),
        }),
      },
      { label: "GitHub token" },
    );
    if (!res.ok) {
      throw new OAuthError(`GitHub token endpoint returned ${res.status}.`, { code: "oauth_token_http" });
    }
    const data = await res.json();
    if (data.error) {
      throw new OAuthError(`GitHub token error: ${data.error_description || data.error}.`, {
        code: "oauth_token_denied",
      });
    }
    if (!data.access_token) {
      throw new OAuthError("GitHub token response missing access_token.", { code: "oauth_token_missing" });
    }
    return data.access_token;
  }

  /** Fetch the authenticated GitHub user (leg 2b). */
  async function fetchGitHubUser(accessToken) {
    const res = await fetchWithTimeout(
      fetchImpl,
      USER_URL,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": "resonant-community-hub",
        },
      },
      { label: "GitHub user" },
    );
    if (!res.ok) {
      throw new OAuthError(`GitHub user endpoint returned ${res.status}.`, { code: "oauth_user_http" });
    }
    return res.json();
  }

  return { buildAuthorizeUrl, exchangeCodeForToken, fetchGitHubUser };
}
