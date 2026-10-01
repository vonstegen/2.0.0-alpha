// Pi-native TUI host service: route actions, the SSE subscription contract, and
// the regression for the never-ending-stream bug. The bridge writer
// (bridge-server.mjs writeBridgeEventStream) ends a response ONLY through
// subscription.close() -> transport.terminate(); close() must therefore
// terminate even after complete(), or a normally exited session leaves the
// client hanging on an open response.
import assert from "node:assert/strict";
import test from "node:test";
import { createPiNativeTuiHostService, createPiTuiStreamSubscription } from "../host/pi-native-tui-host-service.mjs";

test("close() terminates the transport after complete() (stream always ends)", () => {
  const sub = createPiTuiStreamSubscription();
  const terminated = [];
  sub.attachTransport({ terminate: (code) => terminated.push(code) });
  sub.push({ type: "pi.tui.data", sessionId: "s", data: "render" });
  sub.push({ type: "pi.tui.exit", sessionId: "s", evidence: { exitCode: 0 } });
  sub.complete();
  sub.close("runtime-unavailable");
  assert.deepEqual(terminated, ["runtime-unavailable"]);
});

test("iterator drains pushed frames in order, then returns done", async () => {
  const sub = createPiTuiStreamSubscription();
  sub.push({ type: "pi.tui.data", sessionId: "s", data: "a" });
  sub.push({ type: "pi.tui.exit", sessionId: "s", evidence: { exitCode: 1 } });
  sub.complete();
  const iterator = sub.events[Symbol.asyncIterator]();
  assert.deepEqual(await iterator.next(), { value: { type: "pi.tui.data", sessionId: "s", data: "a" }, done: false });
  assert.deepEqual(await iterator.next(), { value: { type: "pi.tui.exit", sessionId: "s", evidence: { exitCode: 1 } }, done: false });
  assert.deepEqual(await iterator.next(), { done: true });
});

test("push() is rejected once completed or closed", () => {
  const sub = createPiTuiStreamSubscription();
  assert.equal(sub.push({ type: "pi.tui.data", sessionId: "s", data: "a" }), true);
  sub.complete();
  assert.equal(sub.push({ type: "pi.tui.data", sessionId: "s", data: "b" }), false);
  const sub2 = createPiTuiStreamSubscription();
  sub2.close("runtime-unavailable");
  assert.equal(sub2.push({ type: "pi.tui.data", sessionId: "s", data: "b" }), false);
});

test("close() sets the terminal code, terminates, and unblocks the iterator", async () => {
  const sub = createPiTuiStreamSubscription();
  const terminated = [];
  sub.attachTransport({ terminate: (code) => terminated.push(code) });
  const next = sub.events[Symbol.asyncIterator]().next();
  sub.close("runtime-unavailable");
  assert.equal(sub.terminalCode, "runtime-unavailable");
  assert.deepEqual(terminated, ["runtime-unavailable"]);
  assert.deepEqual(await next, { done: true });
});

test("overflow triggers the overflow handler and closes the subscription", () => {
  const sub = createPiTuiStreamSubscription({ maxQueueBytes: 16 });
  let overflowed = false;
  sub.overflowHandler = () => { overflowed = true; };
  sub.push({ type: "pi.tui.data", sessionId: "s", data: "x".repeat(40) });
  assert.equal(overflowed, true);
  assert.equal(sub.terminalCode, "runtime-unavailable");
  assert.equal(sub.push({ type: "pi.tui.data", sessionId: "s", data: "y" }), false);
});

test("tui routes: create wires the session, actions forward, dispose revokes", async () => {
  const starts = [];
  const writes = [];
  const resizes = [];
  const cancels = [];
  const { piNativeTuiRoutes } = createPiNativeTuiHostService({
    piNativeSessionService: {
      startSession: async (input) => {
        starts.push(input);
        return {
          projection: { redacted: true },
          handle: {
            write: (text) => writes.push(text),
            resize: (cols, rows) => resizes.push([cols, rows]),
            cancel: () => cancels.push(true),
          },
        };
      },
    },
    issuePiProjection: async () => ({ projection: { ok: true } }),
    manifest: { id: "addon.pi-harness" },
  });
  const byPath = new Map(piNativeTuiRoutes.map((route) => [`${route.method} ${route.path}`, route]));

  const create = byPath.get("POST /pi-native/tui-session");
  const created = await create.handler({ providerProfileId: "openai-compatible-ros-openrouter-test-api", selectedModel: "anthropic/claude-sonnet-4.5", cols: 100, rows: 30 });
  assert.equal(created.ok, true);
  assert.equal(typeof created.sessionId, "string");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].providerProfileId, "openai-compatible-ros-openrouter-test-api");
  assert.equal(starts[0].cols, 100);
  assert.equal(starts[0].rows, 30);
  // The projection is host-issued per session; the raw plan never appears.
  assert.deepEqual(created.projection, { redacted: true });

  await byPath.get("POST /pi-native/tui-session/input").handler({ sessionId: created.sessionId, input: "hello" });
  assert.deepEqual(writes, ["hello"]);
  await byPath.get("POST /pi-native/tui-session/resize").handler({ sessionId: created.sessionId, cols: 90, rows: 26 });
  assert.deepEqual(resizes, [[90, 26]]);
  await byPath.get("POST /pi-native/tui-session/cancel").handler({ sessionId: created.sessionId });
  assert.deepEqual(cancels, [true]);

  // Events route serves the session's subscription only while it exists.
  const events = byPath.get("GET /pi-native/tui-session/events");
  const subscription = await events.handler({}, { url: `/pi-native/tui-session/events?sessionId=${created.sessionId}` });
  assert.equal(typeof subscription.push, "function");
  await assert.rejects(() => events.handler({}, { url: "/pi-native/tui-session/events?sessionId=missing" }), { code: "permission-denied" });
  assert.deepEqual(await events.handler({}, { url: "/pi-native/tui-session/events?sessionId=missing", selfTest: true }).catch(() => null), null);

  await byPath.get("POST /pi-native/tui-session/dispose").handler({ sessionId: created.sessionId });
  await assert.rejects(() => events.handler({}, { url: `/pi-native/tui-session/events?sessionId=${created.sessionId}` }), { code: "permission-denied" });
  assert.throws(() => byPath.get("POST /pi-native/tui-session/cancel").handler({ sessionId: created.sessionId }), { code: "permission-denied" });
});

test("tui routes: invalid resize payload and missing profile fail closed", async () => {
  const { piNativeTuiRoutes } = createPiNativeTuiHostService({
    piNativeSessionService: {
      startSession: async () => ({ projection: {}, handle: { write: () => {}, resize: () => {}, cancel: () => {} } }),
    },
    issuePiProjection: async () => ({ projection: { ok: true } }),
    manifest: { id: "addon.pi-harness" },
  });
  const byPath = new Map(piNativeTuiRoutes.map((route) => [`${route.method} ${route.path}`, route]));
  await assert.rejects(() => byPath.get("POST /pi-native/tui-session").handler({}), { code: "invalid-event" });
  const created = await byPath.get("POST /pi-native/tui-session").handler({ providerProfileId: "p" });
  assert.throws(
    () => byPath.get("POST /pi-native/tui-session/resize").handler({ sessionId: created.sessionId, cols: 1.5, rows: 10 }),
    { code: "invalid-event" },
  );
});
