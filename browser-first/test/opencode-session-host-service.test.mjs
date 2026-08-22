import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpencodeSessionHandlers,
  createOpencodeSessionHostService
} from "../host/opencode-session-host-service.mjs";

test("the service exposes the session routes with runtime-control capability", () => {
  const noop = () => ({ ok: true });
  const { opencodeSessionRoutes } = createOpencodeSessionHostService({
    executeOpenCodeSessionStart: noop,
    executeOpenCodeSessionPrompt: noop,
    executeOpenCodeSessionPermission: noop,
    executeOpenCodeSessionStop: noop,
    executeOpenCodeSessionsList: noop,
    executeOpenCodeSessionMessages: noop,
    executeOpenCodeSessionAbort: noop,
    executeOpenCodeSessionDiff: noop,
    executeOpenCodeSessionRename: noop,
    executeOpenCodeSessionDelete: noop,
    executeOpenCodeSessionArchive: noop,
    executeOpenCodeAgentsList: noop
  });
  assert.deepEqual(
    opencodeSessionRoutes.map((r) => `${r.method} ${r.path}`),
    [
      "POST /opencode/session/start",
      "POST /opencode/session/prompt",
      "POST /opencode/session/permission",
      "POST /opencode/session/stop",
      "POST /opencode/sessions/list",
      "POST /opencode/session/messages",
      "POST /opencode/session/abort",
      "POST /opencode/session/diff",
      "POST /opencode/session/rename",
      "POST /opencode/session/delete",
      "POST /opencode/session/archive",
      "POST /opencode/agents/list"
    ]
  );
  const capabilities = new Map(opencodeSessionRoutes.map((r) => [`${r.method} ${r.path}`, r.requiredCapability]));
  assert.equal(capabilities.get("POST /opencode/session/start"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/prompt"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/permission"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/stop"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/abort"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/rename"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/delete"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/session/archive"), "addon-runtime-control");
  assert.equal(capabilities.get("POST /opencode/sessions/list"), "addon-runtime-read");
  assert.equal(capabilities.get("POST /opencode/session/messages"), "addon-runtime-read");
  assert.equal(capabilities.get("POST /opencode/session/diff"), "addon-runtime-read");
  assert.equal(capabilities.get("POST /opencode/agents/list"), "addon-runtime-read");
});

test("the service throws if a handler is missing", () => {
  assert.throws(() => createOpencodeSessionHostService({}), /missing handler/);
});

function fakeClient(calls) {
  return {
    createSession: async () => { calls.push(["create"]); return { id: "s1" }; },
    prompt: async (id, text, opts) => calls.push(["prompt", id, text, opts]),
    replyPermission: async (id, pid, decision) => calls.push(["reply", id, pid, decision]),
    abort: async (id) => calls.push(["abort", id]),
    sessionDiff: async (id) => { calls.push(["diff", id]); return [{ path: "a.txt", hunks: [] }]; },
    rename: async (id, title) => { calls.push(["rename", id, title]); return { id, title }; },
    remove: async (id) => { calls.push(["delete", id]); return true; },
    archive: async (id, archived) => { calls.push(["archive", id, archived]); return { id, time: { archived } }; },
    listAgents: async () => { calls.push(["agents"]); return [{ name: "build" }]; },
    eventUrl: () => "http://127.0.0.1:4096/event"
  };
}

test("start ensures the server once, creates a session, and returns its id + event url", async () => {
  const calls = [];
  let ensured = 0;
  let clientOptions = null;
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => { ensured += 1; return { baseUrl: "http://127.0.0.1:4096", directory: "/repo/root" }; },
    createClient: (_baseUrl, options) => { clientOptions = options; return fakeClient(calls); }
  });

  const start = await handlers.executeOpenCodeSessionStart();
  assert.deepEqual(start, { ok: true, sessionId: "s1", eventUrl: "http://127.0.0.1:4096/event", baseUrl: "http://127.0.0.1:4096" });
  assert.deepEqual(clientOptions, { directory: "/repo/root" });

  // A second call reuses the memoized client — server ensured only once.
  await handlers.executeOpenCodeSessionPrompt({ body: { sessionId: "s1", text: "go", agent: "build" } });
  assert.equal(ensured, 1);
  assert.deepEqual(calls.at(-1), ["prompt", "s1", "go", { agent: "build", model: undefined }]);
});

test("permission reply forwards the decision to the client", async () => {
  const calls = [];
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://x" }),
    createClient: () => fakeClient(calls)
  });
  await handlers.executeOpenCodeSessionPermission({ body: { sessionId: "s1", permissionId: "p1", decision: { approved: true } } });
  assert.deepEqual(calls.at(-1), ["reply", "s1", "p1", { approved: true }]);
});

test("prompt and permission validate their inputs", async () => {
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://x" }),
    createClient: () => fakeClient([])
  });
  await assert.rejects(() => handlers.executeOpenCodeSessionPrompt({ body: { sessionId: "", text: "" } }), /requires sessionId and text/);
  await assert.rejects(() => handlers.executeOpenCodeSessionPermission({ body: { sessionId: "s1" } }), /requires sessionId and permissionId/);
});

test("abort, diff, rename, delete, archive, and agents list forward to the client", async () => {
  const calls = [];
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://x" }),
    createClient: () => fakeClient(calls)
  });

  assert.deepEqual(await handlers.executeOpenCodeSessionAbort({ body: { sessionId: "ses_1" } }), { ok: true });
  assert.deepEqual(await handlers.executeOpenCodeSessionDiff({ body: { sessionId: "ses_1" } }), { ok: true, diff: [{ path: "a.txt", hunks: [] }] });
  assert.deepEqual(await handlers.executeOpenCodeSessionRename({ body: { sessionId: "ses_1", title: "New title" } }), { ok: true, session: { id: "ses_1", title: "New title" } });
  assert.deepEqual(await handlers.executeOpenCodeSessionDelete({ body: { sessionId: "ses_1" } }), { ok: true, deleted: true });
  assert.deepEqual(await handlers.executeOpenCodeSessionArchive({ body: { sessionId: "ses_1", archived: 12345 } }), { ok: true, session: { id: "ses_1", time: { archived: 12345 } } });
  assert.deepEqual(await handlers.executeOpenCodeAgentsList(), { ok: true, agents: [{ name: "build" }] });

  assert.deepEqual(calls, [
    ["abort", "ses_1"],
    ["diff", "ses_1"],
    ["rename", "ses_1", "New title"],
    ["delete", "ses_1"],
    ["archive", "ses_1", 12345],
    ["agents"]
  ]);
});

test("new parity handlers validate required inputs", async () => {
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://x" }),
    createClient: () => fakeClient([])
  });
  await assert.rejects(() => handlers.executeOpenCodeSessionAbort({ body: {} }), /abort requires sessionId/);
  await assert.rejects(() => handlers.executeOpenCodeSessionDiff({ body: {} }), /diff requires sessionId/);
  await assert.rejects(() => handlers.executeOpenCodeSessionRename({ body: { sessionId: "ses_1", title: "" } }), /rename requires sessionId and title/);
  await assert.rejects(() => handlers.executeOpenCodeSessionDelete({ body: {} }), /delete requires sessionId/);
  await assert.rejects(() => handlers.executeOpenCodeSessionArchive({ body: {} }), /archive requires sessionId/);
});

test("sessions list returns normalized sessions plus server urls", async () => {
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://127.0.0.1:9999" }),
    createClient: () => ({
      listSessions: async () => [
        { id: "ses_1", title: "A", time: { created: 5, updated: 9 } },
        { sessionID: "", title: "dropped" }
      ],
      eventUrl: () => "http://127.0.0.1:9999/event"
    })
  });
  const result = await handlers.executeOpenCodeSessionsList();
  assert.equal(result.ok, true);
  assert.equal(result.baseUrl, "http://127.0.0.1:9999");
  assert.equal(result.eventUrl, "http://127.0.0.1:9999/event");
  assert.deepEqual(result.sessions, [{ id: "ses_1", title: "A", created: 5, updated: 9 }]);
});

test("session messages requires an id and passes history through", async () => {
  const handlers = createOpencodeSessionHandlers({
    ensureServer: async () => ({ baseUrl: "http://x" }),
    createClient: () => ({ messages: async (id) => [{ info: { id: "m1" }, forSession: id }] })
  });
  await assert.rejects(() => handlers.executeOpenCodeSessionMessages({ body: {} }), /requires sessionId/);
  const result = await handlers.executeOpenCodeSessionMessages({ body: { sessionId: "ses_9" } });
  assert.equal(result.ok, true);
  assert.equal(result.messages[0].forSession, "ses_9");
});
