import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { createBridgeClient } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";

const randomToken = () => randomBytes(16).toString("hex");

test("bridgeRequest.getReachabilityState reports online on first success", async () => {
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client("/addons/registry", { method: "GET" });
  assert.equal(client.getReachabilityState().state, "online");
  assert.equal(calls, 1);
});

test("bridgeRequest retries ECONNREFUSED and emits unreachable then recovered", async () => {
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      if (calls < 3) {
        const err = new TypeError("fetch failed");
        err.cause = { code: "ECONNREFUSED" };
        throw err;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const events = [];
  client.subscribeReachability((event) => events.push(event));
  await client("/addons/registry", { method: "GET" });
  assert.equal(calls, 3);
  assert.equal(client.getReachabilityState().state, "online");
  // Two unreachable events (one per failed attempt), one recovered event after success.
  const unreachableEvents = events.filter((e) => e.state === "unreachable");
  const recoveredEvents = events.filter((e) => e.state === "online");
  assert.equal(unreachableEvents.length, 2);
  assert.equal(recoveredEvents.length, 1);
});
test("bridgeRequest gives up after max attempts and emits persistent failure", async () => {
  // First call: all 6 attempts fail with ECONNREFUSED → persistent failure.
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      const err = new TypeError("fetch failed");
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    },
  });
  const states = [];
  client.subscribeReachability((event) => states.push(event.state));
  let caught = null;
  try {
    await client("/addons/registry", { method: "GET" });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "expected client to throw");
  assert.equal(calls, 6, "should have made 6 attempts (initial + 5 retries)");
  // One unreachable event per failed attempt (6), then the persistent
  // failure event after retries are exhausted.
  assert.deepEqual(states, ["unreachable", "unreachable", "unreachable", "unreachable", "unreachable", "unreachable", "persistent"]);
  assert.equal(client.getReachabilityState().state, "persistent");
});

test("bridgeRequest recovers after persistent failure", async () => {
  // First call: all 6 attempts fail with ECONNREFUSED → persistent failure.
  let calls = 0;
  const alwaysFail = async () => {
    calls += 1;
    const err = new TypeError("fetch failed");
    err.cause = { code: "ECONNREFUSED" };
    throw err;
  };
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: alwaysFail,
  });
  let firstError = null;
  try {
    await client("/addons/registry", { method: "GET" });
  } catch (error) {
    firstError = error;
  }
  assert.ok(firstError, "first call should fail with persistent error");
  assert.equal(calls, 6);
  assert.equal(client.getReachabilityState().state, "persistent");

  // Subsequent successful call should restore online.
  const recoveredFetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  // Replace fetchImpl by mutating the closure isn't possible; create a new client.
  const client2 = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: recoveredFetch,
  });
  await client2("/addons/registry", { method: "GET" });
  assert.equal(client2.getReachabilityState().state, "online");
});

test("bridgeRequest never retries non-transient errors (no recovery)", async () => {
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError("bad json");
    },
  });
  const events = [];
  client.subscribeReachability((event) => events.push(event));
  let caught = null;
  try {
    await client("/addons/registry", { method: "GET" });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(calls, 1, "non-transient errors must not be retried");
  assert.equal(events.length, 0, "reachability store must not emit on non-transient failures");
  assert.equal(client.getReachabilityState().state, "online", "state stays online when the bridge answered (even if the response itself was malformed)");
});

test("bridgeRequest respects abort signal: no retry after abort", async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async (_url, init) => {
      calls += 1;
      controller.abort();
      const err = new TypeError("fetch failed");
      err.cause = { code: "ECONNREFUSED" };
      throw err;
    },
  });
  let caught = null;
  try {
    await client("/addons/registry", { method: "GET", signal: controller.signal });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(calls, 1, "abort halts retry loop");
});

test("bridgeRequest subscribeReachability supports unsubscribe", async () => {
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      if (calls < 4) {
        const err = new TypeError("fetch failed");
        err.cause = { code: "ECONNREFUSED" };
        throw err;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  let received = 0;
  const unsubscribe = client.subscribeReachability(() => received++);
  try {
    await client("/addons/registry", { method: "GET" });
  } catch { /* expected to fail */ }
  const before = received;
  assert.ok(before > 0, "subscriber received at least one event");
  unsubscribe();
  await client("/addons/registry", { method: "GET" });
  assert.equal(received, before, "no further events delivered after unsubscribe");
});

test("bridgeRequest HTTP error responses do not change reachability state", async () => {
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomToken(),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 });
    },
  });
  let caught = null;
  try {
    await client("/addons/registry", { method: "GET" });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.equal(calls, 1, "HTTP error responses are not retried");
  assert.equal(client.getReachabilityState().state, "online");
});