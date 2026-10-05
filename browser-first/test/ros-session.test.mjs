// CP-S3c + CP-S5H1 + CP-S5H3 test for browser-first/bin/ros-session.mjs.
//
// Covers the round trip: a grant minted by mintSessionBootstrapGrant is
// written to a 0600 temp file, the CLI reads it, POSTs (stubbed or
// real-loopback) to the bridge route, formats the projected env as
// `export NAME='value'` lines, and never echoes the secret value to
// stdout/stderr in any failing path. The native-fetch contract and the
// --auth-file / --error-file seams are exercised end-to-end via subprocess.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";

import {
  attach,
  readTokenFile,
  readAuthFile,
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

  // Build a REAL Response so the production `response.json()` decode path is
  // exercised exactly as native fetch would behave.
  const jsonResponse = (payload, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

  // Native-semantics fetch spy: captures positional (url, init) separately.
  const fetchingSpy = (responder) => {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, init });
      return responder(url, init);
    };
    return { calls, fetcher };
  };

  it("happy path: reads token, posts, returns `export` lines for the projected env", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c1", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);

    const { calls, fetcher } = fetchingSpy(async () =>
      jsonResponse({ ok: true, env: { HOME: "/u", PATH: "/bin", [ENV_NAME]: SECRET, _meta: '{"sessionId":"s-c1"}' } }));

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
    assert.equal(typeof calls[0].url, "string");
    assert.equal(calls[0].url, "http://127.0.0.1:47773/terminal-host/session/attach");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].url.includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("rejection path: secret value never appears in the return value or stdout-shaped strings", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c2", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { fetcher } = fetchingSpy(async () => jsonResponse({ ok: false, reason: "already-consumed" }));
    const result = await attach({
      sessionId: "s-c2",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, "already-consumed");
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("missing session-id returns a structured reason", async () => {
    const result = await attach({ sessionId: "", tokenFile: "x", providerProfileId: "openai", fetcher: async () => jsonResponse({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-session-id");
  });

  it("missing token-file returns a structured reason", async () => {
    const result = await attach({ sessionId: "s", tokenFile: "", providerProfileId: "openai", fetcher: async () => jsonResponse({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-token-file");
  });

  it("missing provider-profile-id returns a structured reason", async () => {
    const result = await attach({ sessionId: "s", tokenFile: "x", providerProfileId: "", fetcher: async () => jsonResponse({}) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "missing-provider-profile-id");
  });

  it("unreadable token file returns a structured reason; no fetch attempted", async () => {
    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return jsonResponse({}, 500); };
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
    const fetcher = async () => { fetchCalled = true; return jsonResponse({}, 500); };
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
    const { fetcher } = fetchingSpy(async () => jsonResponse({ ok: false, code: "permission-denied" }, 401));
    const result = await attach({
      sessionId: "s-c5",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "http-401");
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
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
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("malformed JSON body fails closed with invalid-response and no body echo", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c7", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { fetcher } = fetchingSpy(async () =>
      new Response(`not-json-{${grant.token}`, { status: 200, headers: { "content-type": "application/json" } }));
    const result = await attach({
      sessionId: "s-c7",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid-response");
    assert.equal(JSON.stringify(result).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("non-{ok:true,ok:false} response body returns `unknown` reason without leaking the body", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c8", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { fetcher } = fetchingSpy(async () => jsonResponse({ surprise: "shape" }));
    const result = await attach({
      sessionId: "s-c8",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "unknown");
    assert.equal(JSON.stringify(result).includes("surprise"), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("argv never carries the token (token is only in the request body, never in init.url)", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c9", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { calls, fetcher } = fetchingSpy(async () => jsonResponse({ ok: true, env: {} }));
    await attach({
      sessionId: "s-c9",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.includes(grant.token), false);
    const sentBody = JSON.parse(calls[0].init.body);
    assert.equal(sentBody.token, grant.token);
    assert.equal(JSON.stringify(calls[0].init.headers).includes(grant.token), false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("project-scoped attach sends the projection request + authority basis", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c10", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { calls, fetcher } = fetchingSpy(async () => jsonResponse({ ok: true, env: {} }));
    const result = await attach({
      sessionId: "s-c10",
      tokenFile,
      providerProfileId: "openai",
      project: { root: "/tmp/example" },
      fetcher,
    });
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    const sentBody = JSON.parse(calls[0].init.body);
    assert.deepEqual(sentBody.request, { requests: { project: ["read"], skills: ["list", "read"] } });
    assert.deepEqual(sentBody.grantedCapabilities, [
      { capability: "filesystem", granted: true },
      { capability: "agent-runtime", granted: true },
    ]);
    assert.deepEqual(sentBody.project, { root: "/tmp/example" });
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("project-less attach sends no projection request (credential-only path)", async () => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: "s-c11", purpose: "attach" }));
    const tokenFile = join(dir, "tok");
    await writeFile(tokenFile, grant.token);
    const { calls, fetcher } = fetchingSpy(async () => jsonResponse({ ok: true, env: {} }));
    await attach({
      sessionId: "s-c11",
      tokenFile,
      providerProfileId: "openai",
      fetcher,
    });
    assert.equal(calls.length, 1);
    const sentBody = JSON.parse(calls[0].init.body);
    assert.equal("request" in sentBody, false);
    assert.equal("grantedCapabilities" in sentBody, false);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });
});

describe("readAuthFile", () => {
  let dir;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "ros-session-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("returns baseUrl/bridgeToken/controlCapabilityToken from a valid JSON file", async () => {
    const file = join(dir, "auth.json");
    await writeFile(file, JSON.stringify({ baseUrl: "http://127.0.0.1:47773", bridgeToken: "bt", controlCapabilityToken: "ct" }));
    const auth = await readAuthFile(file);
    assert.deepEqual(auth, { baseUrl: "http://127.0.0.1:47773", bridgeToken: "bt", controlCapabilityToken: "ct" });
    await assert.rejects(readFile(file), /ENOENT/);
  });

  it("omits missing string fields rather than echoing undefined", async () => {
    const file = join(dir, "auth.json");
    await writeFile(file, JSON.stringify({ baseUrl: "http://127.0.0.1:47773" }));
    const auth = await readAuthFile(file);
    assert.deepEqual(auth, { baseUrl: "http://127.0.0.1:47773" });
  });

  it("rejects malformed JSON with AUTH_FILE_MALFORMED", async () => {
    const file = join(dir, "auth.json");
    await writeFile(file, "not-json");
    await assert.rejects(readAuthFile(file), { code: "AUTH_FILE_MALFORMED" });
  });

  it("rejects non-object JSON with AUTH_FILE_MALFORMED", async () => {
    const file = join(dir, "auth.json");
    await writeFile(file, JSON.stringify([1, 2]));
    await assert.rejects(readAuthFile(file), { code: "AUTH_FILE_MALFORMED" });
  });

  it("rejects missing files with AUTH_FILE_UNREADABLE", async () => {
    await assert.rejects(readAuthFile(join(dir, "missing")), { code: "AUTH_FILE_UNREADABLE" });
  });
});

describe("ros-session CLI (subprocess end-to-end with --auth-file + --error-file)", () => {
  const CLI = fileURLToPath(new URL("../bin/ros-session.mjs", import.meta.url));
  let dir;
  let server;
  let baseUrl;
  let bridgeToken;
  let controlToken;
  let observed;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "ros-session-cli-")));
    __resetSessionBootstrapGrantBroker();
    bridgeToken = "bt-" + Math.random().toString(36).slice(2);
    controlToken = "ct-" + Math.random().toString(36).slice(2);
    observed = [];
    server = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        observed.push({ url: req.url, method: req.method, headers: req.headers, body });
        const auth = req.headers["x-resonantos-bridge-token"];
        const cap = req.headers["x-resonantos-bridge-capability-token"];
        if (auth !== bridgeToken) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, code: "OPENCODE_BRIDGE_UNAUTHORIZED" }));
          return;
        }
        if (cap !== controlToken) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, code: "OPENCODE_CAPABILITY_REQUIRED" }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, env: { OPENAI_API_KEY: SECRET } }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
    __resetSessionBootstrapGrantBroker();
    await rm(dir, { recursive: true, force: true });
  });

  const writeTokenFile = async (sessionId) => {
    const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId, purpose: "attach" }));
    const tokenFile = join(dir, `tok-${sessionId}`);
    await writeFile(tokenFile, grant.token, { mode: 0o600 });
    return { grant, tokenFile };
  };
  const writeAuthFile = async (overrides = {}) => {
    const authFile = join(dir, "auth.json");
    const payload = {
      baseUrl, bridgeToken, controlCapabilityToken: controlToken,
      ...overrides,
    };
    await writeFile(authFile, JSON.stringify(payload), { mode: 0o600 });
    return authFile;
  };
  const runCli = (args) => new Promise((resolve) => {
    const proc = spawn(process.execPath, ["--experimental-strip-types", CLI, ...args], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => (stdout += c.toString()));
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  it("happy path: --auth-file delivers baseUrl + tokens without tokens in argv or logs", async () => {
    const sessionId = "cli-ok";
    const { grant, tokenFile } = await writeTokenFile(sessionId);
    const authFile = await writeAuthFile();
    const errorFile = join(dir, "err.json");
    const { code, stdout } = await runCli([
      "attach", "--session-id", sessionId, "--token-file", tokenFile,
      "--provider-profile-id", "openai", "--auth-file", authFile, "--error-file", errorFile,
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /^export OPENAI_API_KEY='sk-live-attach-secret'\n$/m);
    await assert.rejects(readFile(errorFile), /ENOENT/);
    await assert.rejects(readFile(authFile), /ENOENT/);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].headers["x-resonantos-bridge-token"], bridgeToken);
    assert.equal(observed[0].headers["x-resonantos-bridge-capability-token"], controlToken);
    assert.equal(observed[0].body.includes(grant.token), true);
  });

  it("failure: writes structured --error-file and exits non-zero; secrets absent", async () => {
    const sessionId = "cli-401";
    const { grant, tokenFile } = await writeTokenFile(sessionId);
    const authFile = await writeAuthFile({ bridgeToken: "wrong-bt" });
    const errorFile = join(dir, "err.json");
    const { code, stderr } = await runCli([
      "attach", "--session-id", sessionId, "--token-file", tokenFile,
      "--provider-profile-id", "openai", "--auth-file", authFile, "--error-file", errorFile,
    ]);
    assert.equal(code, 1);
    const errPayload = JSON.parse(await readFile(errorFile, "utf8"));
    assert.equal(errPayload.event, "ros-session.error");
    assert.equal(errPayload.reason, "http-401");
    assert.equal(JSON.stringify(errPayload).includes(grant.token), false);
    assert.equal(JSON.stringify(errPayload).includes(SECRET), false);
    assert.equal(stderr.includes(grant.token), false);
    assert.equal(stderr.includes(SECRET), false);
    await assert.rejects(readFile(authFile), /ENOENT/);
    await assert.rejects(readFile(tokenFile), /ENOENT/);
  });

  it("malformed --auth-file fails BEFORE consuming the token file", async () => {
    const sessionId = "cli-bad-auth";
    const { tokenFile } = await writeTokenFile(sessionId);
    const authFile = join(dir, "auth.json");
    await writeFile(authFile, "not-json", { mode: 0o600 });
    const errorFile = join(dir, "err.json");
    const { code, stderr } = await runCli([
      "attach", "--session-id", sessionId, "--token-file", tokenFile,
      "--provider-profile-id", "openai", "--auth-file", authFile, "--error-file", errorFile,
    ]);
    assert.equal(code, 1);
    const errPayload = JSON.parse(await readFile(errorFile, "utf8"));
    assert.equal(errPayload.reason, "auth-file-malformed");
    assert.equal((await stat(tokenFile)).isFile(), true);
    assert.equal(stderr.includes(SECRET), false);
    assert.equal(observed.length, 0, "no attach request issued on auth-file failure");
  });
});
