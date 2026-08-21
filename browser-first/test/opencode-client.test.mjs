import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpencodeHttpClient,
  ensureOpencodeServer,
  opencodeServerHealthy
} from "../host/opencode-client.mjs";

const okRes = (body = "{}") => ({ ok: true, status: 200, text: async () => body });
const errRes = (status = 500, body = "nope") => ({ ok: false, status, text: async () => body });
const opencodeDoc = (paths = {}) => ({ paths });
const sessionDoc = opencodeDoc({
  "/session": { get: {}, post: {} },
  "/session/{sessionID}": { delete: {}, patch: {} },
  "/session/{sessionID}/message": { get: {}, post: {} },
  "/session/{sessionID}/prompt_async": { post: {} },
  "/session/{sessionID}/abort": { post: {} },
  "/session/{sessionID}/diff": { get: {} },
  "/session/{sessionID}/permissions/{permissionID}": { post: {} },
  "/agent": { get: {} }
});

test("opencodeServerHealthy is true only when the /doc probe succeeds", async () => {
  assert.equal(await opencodeServerHealthy({ fetchImpl: async () => okRes(), baseUrl: "http://x" }), true);
  assert.equal(await opencodeServerHealthy({ fetchImpl: async () => errRes(503), baseUrl: "http://x" }), false);
  assert.equal(await opencodeServerHealthy({ fetchImpl: async () => { throw new Error("conn refused"); }, baseUrl: "http://x" }), false);
});

test("ensureOpencodeServer reuses a healthy server and does not spawn", async () => {
  let spawns = 0;
  const result = await ensureOpencodeServer({
    fetchImpl: async () => okRes(),
    spawnImpl: () => { spawns += 1; return { kill() {} }; },
    command: "/bin/opencode"
  });
  assert.equal(spawns, 0);
  assert.equal(result.spawned, false);
  assert.match(result.baseUrl, /^http:\/\/127\.0\.0\.1:4096$/);
});

test("ensureOpencodeServer spawns and waits for readiness when the server is down", async () => {
  let health = 0;
  let spawned = null;
  const result = await ensureOpencodeServer({
    // First probe (pre-spawn) fails; after spawn it becomes healthy on the 2nd poll.
    fetchImpl: async () => (++health >= 3 ? okRes() : errRes(503)),
    spawnImpl: (cmd, args, opts) => { spawned = { cmd, args, opts }; return { kill() {} }; },
    command: "/bin/opencode",
    cwd: "/repo/root",
    sleep: async () => {},
    pollMs: 1,
    maxWaitMs: 1000
  });
  assert.ok(spawned, "spawned a server");
  assert.deepEqual(spawned.args, ["serve", "--hostname", "127.0.0.1", "--port", "4096"]);
  assert.equal(spawned.opts.cwd, "/repo/root");
  assert.equal(result.spawned, true);
  assert.equal(result.directory, "/repo/root");
});

test("ensureOpencodeServer refuses to start without a resolved command", async () => {
  await assert.rejects(
    () => ensureOpencodeServer({ fetchImpl: async () => errRes(503), command: "", spawnImpl: () => ({}) }),
    /not available to start/
  );
});

test("the http client uses OpenAPI-derived async prompt and exact permission shape", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/session")) return okRes(JSON.stringify({ id: "s1" }));
    return okRes("{}");
  };
  const client = createOpencodeHttpClient({
    fetchImpl,
    baseUrl: "http://127.0.0.1:4096",
    directory: "",
    apiDoc: sessionDoc
  });

  const session = await client.createSession("test");
  assert.equal(session.id, "s1");

  await client.prompt("s1", "run tests", { agent: "build" });
  await client.replyPermission("s1", "p1", { approved: true, remember: true });

  assert.deepEqual(calls[0], { url: "http://127.0.0.1:4096/session", method: "POST", body: { title: "test" } });
  assert.deepEqual(calls[1], {
    url: "http://127.0.0.1:4096/session/s1/prompt_async",
    method: "POST",
    body: { parts: [{ type: "text", text: "run tests" }], agent: "build" }
  });
  assert.deepEqual(calls[2], {
    url: "http://127.0.0.1:4096/session/s1/permissions/p1",
    method: "POST",
    body: { response: "always" }
  });
});

test("the http client falls back to sync prompt when prompt_async is absent from the doc", async () => {
  const calls = [];
  const client = createOpencodeHttpClient({
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return okRes("{}");
    },
    baseUrl: "http://127.0.0.1:4096",
    directory: "",
    apiDoc: opencodeDoc({ "/session/{sessionID}/message": { post: {} } })
  });
  await client.prompt("s1", "sync fallback");
  assert.deepEqual(calls[0], {
    url: "http://127.0.0.1:4096/session/s1/message",
    method: "POST",
    body: { parts: [{ type: "text", text: "sync fallback" }] }
  });
});

test("the http client shapes parity endpoints and pins directory query params", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes("/agent")) return okRes(JSON.stringify([{ name: "build" }]));
    if (url.includes("/diff")) return okRes(JSON.stringify([{ path: "a.txt", hunks: [] }]));
    return okRes("{}");
  };
  const client = createOpencodeHttpClient({
    fetchImpl,
    baseUrl: "http://127.0.0.1:4096",
    directory: "/repo/root",
    apiDoc: sessionDoc
  });

  await client.createSession("Pinned");
  await client.listSessions();
  await client.messages("ses_1");
  await client.sessionDiff("ses_1");
  await client.abort("ses_1");
  await client.rename("ses_1", "Renamed");
  await client.remove("ses_1");
  await client.archive("ses_1", 12345);
  await client.listAgents();

  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:4096/session?directory=%2Frepo%2Froot", method: "POST", body: { title: "Pinned" } },
    { url: "http://127.0.0.1:4096/session?directory=%2Frepo%2Froot", method: "GET", body: null },
    { url: "http://127.0.0.1:4096/session/ses_1/message?directory=%2Frepo%2Froot", method: "GET", body: null },
    { url: "http://127.0.0.1:4096/session/ses_1/diff?directory=%2Frepo%2Froot", method: "GET", body: null },
    { url: "http://127.0.0.1:4096/session/ses_1/abort?directory=%2Frepo%2Froot", method: "POST", body: null },
    { url: "http://127.0.0.1:4096/session/ses_1?directory=%2Frepo%2Froot", method: "PATCH", body: { title: "Renamed" } },
    { url: "http://127.0.0.1:4096/session/ses_1?directory=%2Frepo%2Froot", method: "DELETE", body: null },
    { url: "http://127.0.0.1:4096/session/ses_1?directory=%2Frepo%2Froot", method: "PATCH", body: { time: { archived: 12345 } } },
    { url: "http://127.0.0.1:4096/agent?directory=%2Frepo%2Froot", method: "GET", body: null }
  ]);
});

test("the http client rejects on a non-ok response", async () => {
  const client = createOpencodeHttpClient({ fetchImpl: async () => errRes(500, "boom"), baseUrl: "http://x", directory: "" });
  await assert.rejects(() => client.createSession(), /failed: 500/);
});
