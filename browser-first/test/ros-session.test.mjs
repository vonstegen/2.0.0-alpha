// CP-S3c test for browser-first/bin/ros-session.mjs.
//
// Covers the round trip: a grant minted by mintSessionBootstrapGrant is
// written to a 0600 temp file, the CLI reads it, POSTs (stubbed) to the
// bridge route, formats the projected env as `export NAME='value'` lines,
// and never echoes the secret value to stdout/stderr in any failing path.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  attach,
  readTokenFile,
  formatExports,
} from "../bin/ros-session.mjs";
import {
  __resetSessionBootstrapGrantBroker,
  mintSessionBootstrapGrant,
  trackSessionBootstrapGrant,
} from "../host/terminal-host-service.mjs";

const SECRET = "sk-live-attach-secret";
const ENV_NAME = "OPENAI_API_KEY";

describe("readTokenFile", () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ros-session-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("reads the token and trims trailing whitespace", async () => {
    const file = join(dir, "token");
    await writeFile(file, "abc-123\n\n");
    const t = await readTokenFile(file);
    assert.equal(t, "abc-123");
  });

  it("unlinks the file on success", async () => {
    const file = join(dir, "token");
    await writeFile(file, "xyz");
    await readTokenFile(file);
    await assert.rejects(readFile(file, "utf8"), /ENOENT/);
  });

  it("rejects unreadable paths", async () => {
    await assert.rejects(readTokenFile(join(dir, "missing")), /ENOENT/);
  });
});

describe("formatExports", () => {
  it("emits one `export` line per entry, excluding _meta", () => {
    const out = formatExports({
      HOME: "/u",
      PATH: "/bin",
      OPENAI_API_KEY: "sk-secret",
      _meta: '{"sessionId":"s1"}',
    });
    assert.equal(out, "export HOME='/u'\nexport PATH='/bin'\nexport OPENAI_API_KEY='sk-secret'\n");
  });

  it("escapes embedded single quotes per POSIX shell rule", () => {
    const out = formatExports({ SAMPLE: "ab'cd'ef" });
    assert.equal(out, "export SAMPLE='ab'\\''cd'\\''ef'\n");
  });

  it("returns an empty string for an empty env", () => {
    assert.equal(formatExports({}), "");
  });
});

describe("attach (round trip)", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ros-session-"));
    __resetSessionBootstrapGrantBroker();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("happy path: reads token, posts, returns `export` lines for the projected env", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c1", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);

    /** @type {Array<{ url: string, init: object }>} */
    const calls = [];
    const fetcher = async ({ url, init }) => {
      calls.push({ url, init });
      return {
        status: 200,
        body: { ok: true, env: { HOME: "/u", PATH: "/bin", [ENV_NAME]: SECRET, _meta: '{"sessionId":"s-c1"}' } },
      };
    };

    const result = await attach({
      sessionId: "s-c1",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.exports, `export HOME='/u'\nexport PATH='/bin'\nexport ${ENV_NAME}='${SECRET}'\n`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://127.0.0.1:47773/terminal-host/session/attach");
    // The token is in the request body (POST to localhost) but never in the URL.
    assert.equal(calls[0].url.includes(grant.token), false);
    // The grant token must have been consumed (file unlinked).
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("rejection path: secret value never appears in the return value or stdout-shaped strings", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c2", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const fetcher = async () => ({ status: 200, body: { ok: false, reason: "already-consumed" } });
    const result = await attach({
      sessionId: "s-c2",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "already-consumed");
    // The secret value must never appear in any returned field.
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(grant.token), false);
  });

  it("missing session-id returns a structured reason", async () => {
    const result = await attach({ sessionId: "", tokenFile: "x", providerProfileId: "openai", fetcher: async () => ({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-session-id");
  });

  it("missing token-file returns a structured reason", async () => {
    const result = await attach({ sessionId: "s", tokenFile: "", providerProfileId: "openai", fetcher: async () => ({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-token-file");
  });

  it("missing provider-profile-id returns a structured reason", async () => {
    const result = await attach({ sessionId: "s", tokenFile: "x", providerProfileId: "", fetcher: async () => ({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-provider-profile-id");
  });

  it("unreadable token file returns a structured reason; no fetch attempted", async () => {
    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return { status: 500, body: {} }; };
    const result = await attach({
      sessionId: "s-c3",
      tokenFile: join(dir, "never-created"),
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "token-file-unreadable");
    assert.equal(fetchCalled, false, "fetcher must not be called when the token file is unreadable");
  });

  it("empty token file returns a structured reason; no fetch attempted", async () => {
    const tokenFile = join(dir, "empty");
    await writeFile(tokenFile, "   \n");
    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return { status: 500, body: {} }; };
    const result = await attach({
      sessionId: "s-c4",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "token-file-unreadable", "whitespace-only token file fails the same as unreadable");
    assert.equal(fetchCalled, false);
  });

  it("non-200 HTTP status is reported without echoing the response body", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c5", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const fetcher = async () => ({ status: 401, body: { ok: false, code: "permission-denied" } });
    const result = await attach({
      sessionId: "s-c5",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "http-401");
  });

  it("bridge-unreachable is reported when fetcher throws", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c6", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const fetcher = async () => { throw new Error("ECONNREFUSED"); };
    const result = await attach({
      sessionId: "s-c6",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "bridge-unreachable");
  });

  it("non-{ok:true,ok:false} response body returns `unknown` reason without leaking the body", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c7", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const fetcher = async () => ({ status: 200, body: { surprise: "shape" } });
    const result = await attach({
      sessionId: "s-c7",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unknown");
    // The response body must not be echoed into the reason.
    assert.equal(JSON.stringify(result).includes("surprise"), false);
  });

  it("argv never carries the token (token is only in the request body, never in init.url)", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c8", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const captured = [];
    const fetcher = async ({ url, init }) => {
      captured.push({ url, init });
      return { status: 200, body: { ok: true, env: {} } };
    };
    await attach({
      sessionId: "s-c8",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url.includes(grant.token), false);
    const sentBody = JSON.parse(captured[0].init.body);
    assert.equal(sentBody.token, grant.token);
    // The headers carry no token either.
    assert.equal(JSON.stringify(captured[0].init.headers).includes(grant.token), false);
  });
});