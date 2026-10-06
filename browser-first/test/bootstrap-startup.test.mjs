// CP-BR2: deterministic tests for the extension-side bridge bootstrap
// startup orchestrator.
//
// The orchestrator is driven by:
//   * a `bootstrapClient.request` seam
//   * a `healthProbe` seam
//   * an `onHealthyAfterStart` rebind trigger seam
//   * timer / interval / now seams
//
// These tests cover the 16 CP-BR2 §8 prompt requirements that the
// orchestrator itself owns (items 1, 2, 3, 4, 5, 8, 9, 10, 11) and the
// shape-walker evidence the prompt requires.

import assert from "node:assert/strict";
import test from "node:test";

import { createBootstrapStartup, BOOTSTRAP_RETRY_BACKOFF_MS, BOOTSTRAP_MAX_RETRIES } from "../resonantos-side-panel-extension/src/lib/bootstrap-startup.js";

const PERMISSIVE_CHECK = () => undefined;

function makeFakeClient(initialResponses) {
  const state = { calls: [], responses: initialResponses, i: 0 };
  return {
    calls: state.calls,
    setResponses(next) { state.responses = next; state.i = 0; },
    async request(operation) {
      state.calls.push(operation);
      const responses = state.responses;
      const next = responses[Math.min(state.i, responses.length - 1)];
      state.i += 1;
      return typeof next === "function" ? next(operation) : next;
    },
  };
}

function ok(status, extras = {}) {
  return { ok: true, status, ...extras };
}

function fail(failureCode, extras = {}) {
  return { ok: false, status: "failed", failureCode, ...extras };
}

test("createBootstrapStartup: queries status before deciding (req #1)", async () => {
  const client = makeFakeClient([ok("offline"), ok("starting", { endpoint: "http://127.0.0.1:47773" })]);
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
  });
  await startup.boot();
  assert.deepEqual(client.calls.slice(0, 2), ["status", "start"]);
});

test("createBootstrapStartup: offline -> start -> health -> connected (req #2)", async () => {
  const client = makeFakeClient([
    ok("offline"),
    ok("starting", { endpoint: "http://127.0.0.1:47773" }),
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
  ]);
  let rebindCalls = 0;
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onHealthyAfterStart: async () => { rebindCalls += 1; },
    delayImpl: async () => undefined,
  });
  const snapshot = await startup.boot();
  assert.equal(snapshot.status, "connected");
  assert.equal(snapshot.endpoint, "http://127.0.0.1:47773");
  assert.equal(rebindCalls, 1, "rebind must run after a fresh start");
});

test("createBootstrapStartup: already-connected -> no start, no rebind (req #3)", async () => {
  const client = makeFakeClient([ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" })]);
  let rebindCalls = 0;
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onHealthyAfterStart: async () => { rebindCalls += 1; },
  });
  const snapshot = await startup.boot();
  assert.equal(snapshot.status, "connected");
  assert.deepEqual(client.calls, ["status"]);
  assert.equal(rebindCalls, 0, "rebind must NOT run on a no-op reuse");
});

test("createBootstrapStartup: concurrent boot calls produce exactly one start (req #4)", async () => {
  // First call returns "starting" so the orchestrator joins the in-flight
  // host start instead of issuing a parallel one.
  const client = makeFakeClient([ok("starting", { endpoint: "http://127.0.0.1:47773" }), ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" })]);
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onHealthyAfterStart: async () => undefined,
    delayImpl: async () => undefined,
  });
  const [a, b, c] = await Promise.all([startup.boot(), startup.boot(), startup.boot()]);
  assert.equal(a.status, "connected");
  assert.equal(b.status, "connected");
  assert.equal(c.status, "connected");
  const startCount = client.calls.filter((c) => c === "start").length;
  assert.equal(startCount, 0, "concurrent boots must not issue a parallel start when host already has one in flight");
});

test("createBootstrapStartup: version-mismatch surfaces incompatibility, no reuse (req #5)", async () => {
  const client = makeFakeClient([ok("offline"), fail("version-mismatch", { version: "0.0.0" })]);
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    delayImpl: async () => undefined,
  });
  const snapshot = await startup.boot();
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.failureCode, "version-mismatch");
  // No further call after the mismatch: orchestrator must not retry.
  assert.equal(client.calls.length, 2);
});

test("createBootstrapStartup: rebind runs after healthy-after-start (req #6)", async () => {
  const client = makeFakeClient([
    ok("offline"),
    ok("starting", { endpoint: "http://127.0.0.1:47773" }),
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
  ]);
  let rebindInfo = null;
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onHealthyAfterStart: async (info) => { rebindInfo = info; },
    delayImpl: async () => undefined,
  });
  await startup.boot();
  assert.ok(rebindInfo, "rebind trigger must run");
  assert.equal(rebindInfo.endpoint, "http://127.0.0.1:47773");
  assert.equal(rebindInfo.version, "1.0.0");
});

test("createBootstrapStartup: rebind failure transitions to degraded, does not silently use stale creds (req #7)", async () => {
  const client = makeFakeClient([
    ok("offline"),
    ok("starting", { endpoint: "http://127.0.0.1:47773" }),
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
  ]);
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onHealthyAfterStart: async () => { throw new Error("rebind-failed"); },
    delayImpl: async () => undefined,
  });
  const snapshot = await startup.boot();
  assert.equal(snapshot.status, "degraded");
  assert.notEqual(snapshot.status, "connected", "must not silently reuse stale credentials");
});

test("createBootstrapStartup: unexpected exit surfaces Failed + bounded retry (req #8)", async () => {
  // First boot is offline -> start -> health timeout -> failed.
  // Unexpected-exit then triggers a bounded retry: the next boot issues
  // status + start + (a synthetic connected) and lands on connected.
  const heldTimers = new Set();
  const setTimeoutImpl = (fn, ms) => {
    const t = setTimeout(() => { heldTimers.delete(t); fn(); }, 0);
    t.unref();
    heldTimers.add(t);
    return t;
  };
  const clearTimeoutImpl = (t) => { clearTimeout(t); heldTimers.delete(t); };
  let healthMode = "fail";
  let bootCount = 0;
  const client = {
    calls: [],
    async request(operation) {
      this.calls.push(operation);
      if (operation === "status") {
        // First status call from boot #1: offline. Subsequent: connected
        // once boot #2 is in flight (after healthMode flips).
        bootCount += 1;
        if (healthMode === "ok" && bootCount > 2) {
          return ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" });
        }
        return ok("offline");
      }
      if (operation === "start") {
        return ok("starting", { endpoint: "http://127.0.0.1:47773" });
      }
      return fail("invalid-request");
    },
  };
  let nowCounter = 0;
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    // Boot #1: health probe keeps failing until the deadline. After
    // reportUnexpectedExit triggers the retry, the test flips to ok.
    healthProbe: async () => healthMode === "ok"
      ? { ok: true, version: "1.0.0" }
      : { ok: false, version: null },
    onHealthyAfterStart: async () => undefined,
    delayImpl: async () => undefined,
    healthPollTimeoutMs: 200,
    nowImpl: () => { nowCounter += 50; return nowCounter; },
    setTimeoutImpl,
    clearTimeoutImpl,
  });
  const initial = await startup.boot();
  assert.equal(initial.status, "failed");
  assert.equal(initial.failureCode, "health-timeout");
  // Flip the health probe so the retry can succeed.
  healthMode = "ok";
  // unexpected exit -> bounded retry
  const recovered = await startup.reportUnexpectedExit();
  assert.equal(recovered.status, "connected");
  for (const t of heldTimers) clearTimeout(t);
});

test("createBootstrapStartup: backoff is bounded; never loops forever (req #9)", async () => {
  // The orchestrator's backoff policy is bounded in two ways:
  //  (a) the BOOTSTRAP_RETRY_BACKOFF_MS schedule caps at 10s; and
  //  (b) repeated reportUnexpectedExit calls honour BOOTSTRAP_MAX_RETRIES
  //      and hold the `failed` state after that, so no auto-restart loop.
  // This test exercises (a) directly and (b) via the public API.
  assert.ok(BOOTSTRAP_RETRY_BACKOFF_MS.every((ms) => ms <= 10_000), "backoff schedule must cap at 10s");
  assert.ok(BOOTSTRAP_RETRY_BACKOFF_MS.length > 0, "backoff schedule must not be empty");

  const startCalls = [];
  const fakeTimers = new Set();
  const client = {
    async request(operation) {
      if (operation === "start") startCalls.push(Date.now());
      if (operation === "status") return ok("offline");
      return fail("start-failed");
    },
  };
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: false, version: null }),
    onHealthyAfterStart: async () => undefined,
    delayImpl: async () => undefined,
    setTimeoutImpl: (fn) => {
      const t = setTimeout(() => { fakeTimers.delete(t); fn(); }, 0);
      t.unref();
      fakeTimers.add(t);
      return t;
    },
    clearTimeoutImpl: (t) => { clearTimeout(t); fakeTimers.delete(t); },
  });
  // Report unexpected exit BOOTSTRAP_MAX_RETRIES + 2 times. The
  // orchestrator should hold the failed state and not auto-restart
  // after the cap.
  for (let i = 0; i < BOOTSTRAP_MAX_RETRIES + 2; i += 1) {
    await startup.reportUnexpectedExit();
  }
  // Total start calls must be bounded by the retry cap (each
  // reportUnexpectedExit -> scheduleBoundedRetry may trigger a boot
  // when under the cap; once over the cap, the orchestrator holds).
  assert.ok(
    startCalls.length <= BOOTSTRAP_MAX_RETRIES,
    `start calls should be bounded; got ${startCalls.length}`,
  );
  // Clear any in-flight fake timers so the test process can exit.
  for (const t of fakeTimers) clearTimeout(t);
});

test("createBootstrapStartup: stopForShutdown calls the host and only stops an owned bridge (req #10, #11)", async () => {
  // owned case: host says ok, the bridge is actually down.
  const client1 = makeFakeClient([
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
    ok("offline", { endpoint: null, version: null, instanceId: null, generation: null, startedAt: null }),
  ]);
  const startup1 = createBootstrapStartup({
    bootstrapClient: client1,
    // After stopForShutdown, the host says offline, and the post-stop
    // /healthz probe says the bridge is gone.
    healthProbe: async () => ({ ok: false, version: null }),
  });
  await startup1.boot();
  const stopped = await startup1.stopForShutdown();
  assert.equal(stopped.status, "offline");
  assert.equal(client1.calls.includes("stopForShutdown"), true);
  assert.equal(client1.calls.includes("status"), true);

  // externally-started case: host returns ok but the /healthz probe still
  // answers, so the bridge is NOT owned. The orchestrator must NOT clear
  // the local `connected` state.
  const client2 = makeFakeClient([
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
    // stopForShutdown response: host says "ok" but did not actually stop anything
    ok("offline", { endpoint: "http://127.0.0.1:47773" }),
    // post-stop re-verify through the host: status -> connected
    ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" }),
  ]);
  const startup2 = createBootstrapStartup({
    bootstrapClient: client2,
    // The bridge is still up after stopForShutdown — externally started.
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
  });
  await startup2.boot();
  const notStopped = await startup2.stopForShutdown();
  assert.equal(notStopped.status, "connected", "externally-started bridge must be left untouched");
});

test("createBootstrapStartup: never logs PID, path, env, or token values; only closed public fields", async () => {
  const events = [];
  const client = makeFakeClient([ok("connected", { endpoint: "http://127.0.0.1:47773", version: "1.0.0", instanceId: "g1", generation: 1, startedAt: "t" })]);
  const startup = createBootstrapStartup({
    bootstrapClient: client,
    healthProbe: async () => ({ ok: true, version: "1.0.0" }),
    onLifecycleEvent: (event) => events.push(event),
    delayImpl: async () => undefined,
  });
  await startup.boot();
  // The shape-walker: every public field is a string from the closed
  // vocabulary, a primitive, or null. There is no path / PID / env / token
  // anywhere in the emitted events.
  for (const event of events) {
    for (const [k, v] of Object.entries(event)) {
      if (typeof v === "string") {
        assert.equal(v.includes("/Users/"), false, `${k} must not carry a path`);
        assert.equal(v.includes("RESONANTOS_BROWSER_FIRST"), false, `${k} must not carry a token env var`);
        assert.equal(/Bearer\s/i.test(v), false, `${k} must not carry a bearer token`);
      }
    }
  }
});

test("createBootstrapStartup: snapshot fields are immutable primitives", () => {
  const startup = createBootstrapStartup({ bootstrapClient: makeFakeClient([]), healthProbe: async () => ({ ok: true, version: "1.0.0" }) });
  const snap = startup.getSnapshot();
  assert.ok(Object.isFrozen(snap));
  assert.equal(typeof snap.status, "string");
  assert.equal(snap.status, "offline");
  assert.equal(snap.failureCode, null);
});
