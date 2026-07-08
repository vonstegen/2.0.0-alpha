// Offline unit tests for GitHub OAuth (plan: GitHub OAuth only). The outbound
// calls to GitHub are driven with a FAKE fetch — no network, no live GitHub.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  OAuthError,
  createGitHubOAuth,
  signState,
  verifyState,
  deriveMemberFromGitHubUser,
  getGitHubOAuthConfig,
} from "../src/github-oauth.mjs";

const SECRET = "oauth-state-secret-16-plus-chars";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

describe("OAuth CSRF state", () => {
  test("signs and verifies a fresh state", () => {
    const state = signState(SECRET);
    assert.equal(verifyState(state, SECRET), true);
  });

  test("rejects a tampered / wrong-secret state", () => {
    const state = signState(SECRET);
    assert.throws(() => verifyState(state, "different-secret-16-chars"), (e) => e instanceof OAuthError);
    assert.throws(() => verifyState("a.b.c", SECRET), (e) => e instanceof OAuthError && e.code === "bad_state");
  });

  test("rejects an expired state", () => {
    const clock = { t: 1_000_000 };
    const state = signState(SECRET, { now: () => clock.t, ttlMs: 1000 });
    clock.t += 5000;
    assert.throws(
      () => verifyState(state, SECRET, { now: () => clock.t }),
      (e) => e instanceof OAuthError && e.code === "state_expired",
    );
  });
});

describe("deriveMemberFromGitHubUser", () => {
  test("maps id/login/name to minimal identity", () => {
    const m = deriveMemberFromGitHubUser({ id: 42, login: "octocat", name: "The Octocat" });
    assert.deepEqual(m, { oauthSub: "github|42", handle: "octocat", displayName: "The Octocat" });
  });
  test("falls back displayName to login when name is null", () => {
    const m = deriveMemberFromGitHubUser({ id: 7, login: "mona", name: null });
    assert.equal(m.displayName, "mona");
  });
  test("throws on a malformed user", () => {
    assert.throws(() => deriveMemberFromGitHubUser({ login: "no-id" }), (e) => e instanceof OAuthError);
  });
});

describe("createGitHubOAuth with a fake fetch", () => {
  const config = { clientId: "cid", clientSecret: "csecret", redirectUri: "https://hub.example/api/v1/auth/github/callback" };

  test("buildAuthorizeUrl includes client_id, scope, state, redirect_uri", () => {
    const oauth = createGitHubOAuth({ ...config, fetchImpl: async () => jsonResponse({}) });
    const url = new URL(oauth.buildAuthorizeUrl({ state: "st8" }));
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "cid");
    assert.equal(url.searchParams.get("state"), "st8");
    assert.equal(url.searchParams.get("scope"), "read:user");
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  });

  test("exchangeCodeForToken posts to GitHub and returns the access token", async () => {
    const calls = [];
    const oauth = createGitHubOAuth({
      ...config,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ access_token: "gho_abc", token_type: "bearer" });
      },
    });
    const token = await oauth.exchangeCodeForToken("code123");
    assert.equal(token, "gho_abc");
    assert.equal(calls[0].url, "https://github.com/login/oauth/access_token");
    assert.equal(calls[0].init.method, "POST");
    assert.match(calls[0].init.body, /code123/);
  });

  test("exchangeCodeForToken surfaces GitHub error responses", async () => {
    const oauth = createGitHubOAuth({
      ...config,
      fetchImpl: async () => jsonResponse({ error: "bad_verification_code", error_description: "expired" }),
    });
    await assert.rejects(oauth.exchangeCodeForToken("x"), (e) => e instanceof OAuthError && e.code === "oauth_token_denied");
  });

  test("exchangeCodeForToken rejects a non-2xx HTTP status", async () => {
    const oauth = createGitHubOAuth({ ...config, fetchImpl: async () => jsonResponse({}, { ok: false, status: 500 }) });
    await assert.rejects(oauth.exchangeCodeForToken("x"), (e) => e instanceof OAuthError && e.code === "oauth_token_http");
  });

  test("fetchGitHubUser sends the bearer token and returns the profile", async () => {
    let seenAuth;
    const oauth = createGitHubOAuth({
      ...config,
      fetchImpl: async (url, init) => {
        seenAuth = init.headers.authorization;
        return jsonResponse({ id: 99, login: "dev", name: "Dev" });
      },
    });
    const user = await oauth.fetchGitHubUser("gho_abc");
    assert.equal(user.login, "dev");
    assert.equal(seenAuth, "Bearer gho_abc");
  });
});

describe("getGitHubOAuthConfig", () => {
  test("throws when client id/secret are absent", () => {
    assert.throws(() => getGitHubOAuthConfig({}), /GitHub OAuth is not configured/);
  });
  test("reads config from env", () => {
    const cfg = getGitHubOAuthConfig({ GITHUB_OAUTH_CLIENT_ID: "a", GITHUB_OAUTH_CLIENT_SECRET: "b" });
    assert.equal(cfg.clientId, "a");
    assert.equal(cfg.clientSecret, "b");
  });
});
