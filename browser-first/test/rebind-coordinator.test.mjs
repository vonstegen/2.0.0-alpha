// CP-BR2: deterministic tests for the rebind coordinator (the "healthy
// after start" trigger that flows through one shared owner instead of
// three parallel rebind chains in background/side-panel/main-workspace).

import assert from "node:assert/strict";
import test from "node:test";

import { createRebindCoordinator } from "../resonantos-side-panel-extension/src/lib/rebind-coordinator.js";

function makeDeps(overrides = {}) {
  const calls = { resolveBridgeConfig: 0, detectLoopbackBridge: 0, createBridgeClient: 0, createRawBridgeFetch: 0, initCapabilityTokens: 0 };
  let configIndex = 0;
  const nextConfig = () => {
    configIndex += 1;
    return { bridgeUrl: `http://127.0.0.1:4777${configIndex}`, bridgeToken: `tok-${configIndex}`, source: "test" };
  };
  return {
    calls,
    deps: {
      resolveBridgeConfig: async () => {
        calls.resolveBridgeConfig += 1;
        return nextConfig();
      },
      detectLoopbackBridge: async (cfg) => {
        calls.detectLoopbackBridge += 1;
        return { ...cfg, source: "loopback:test" };
      },
      createBridgeClient: (cfg) => {
        calls.createBridgeClient += 1;
        return () => `bridgeRequest:${cfg.bridgeUrl}`;
      },
      createRawBridgeFetch: (cfg) => {
        calls.createRawBridgeFetch += 1;
        return () => `rawFetch:${cfg.bridgeUrl}`;
      },
      initCapabilityTokens: async () => {
        calls.initCapabilityTokens += 1;
        return { ok: true };
      },
      ...overrides,
    },
  };
}

test("rebind-coordinator: rebind runs the full chain and notifies subscribers", async () => {
  const { calls, deps } = makeDeps();
  const coord = createRebindCoordinator(deps);
  const events = [];
  coord.subscribe((event) => events.push(event));
  const result = await coord.rebind({ source: "test" });
  assert.equal(result.ok, true);
  assert.deepEqual(events, [{
    source: "test",
    ok: true,
    config: { bridgeUrl: "http://127.0.0.1:47771", bridgeToken: "tok-1", source: "loopback:test" },
    bridgeRequest: result.bridgeRequest,
    rawFetch: result.rawFetch,
  }]);
  assert.equal(calls.resolveBridgeConfig, 1);
  assert.equal(calls.detectLoopbackBridge, 1);
  assert.equal(calls.createBridgeClient, 1);
  assert.equal(calls.createRawBridgeFetch, 1);
  assert.equal(calls.initCapabilityTokens, 1);
});

test("rebind-coordinator: concurrent rebind calls share the same in-flight chain", async () => {
  const { calls, deps } = makeDeps();
  const coord = createRebindCoordinator(deps);
  const [a, b, c] = await Promise.all([coord.rebind(), coord.rebind(), coord.rebind()]);
  assert.equal(a.bridgeRequest, b.bridgeRequest);
  assert.equal(b.bridgeRequest, c.bridgeRequest);
  assert.equal(calls.resolveBridgeConfig, 1, "concurrent calls must join one in-flight rebind");
  assert.equal(calls.initCapabilityTokens, 1);
});

test("rebind-coordinator: initCapabilityTokens failure surfaces a public failure event", async () => {
  const { calls, deps } = makeDeps({
    initCapabilityTokens: async () => { throw new Error("rebind-failed"); },
  });
  const coord = createRebindCoordinator(deps);
  const events = [];
  coord.subscribe((event) => events.push(event));
  const result = await coord.rebind();
  assert.equal(result.ok, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].ok, false);
  assert.match(events[0].error.message, /rebind-failed/);
});

test("rebind-coordinator: subscriber exceptions do not poison the channel", async () => {
  const { deps } = makeDeps();
  const coord = createRebindCoordinator(deps);
  const received = [];
  coord.subscribe(() => { throw new Error("subscriber-broken"); });
  coord.subscribe((event) => received.push(event));
  const result = await coord.rebind();
  assert.equal(result.ok, true);
  assert.equal(received.length, 1);
});

test("rebind-coordinator: returns a working unsubscribe function", async () => {
  const { deps } = makeDeps();
  const coord = createRebindCoordinator(deps);
  const received = [];
  const unsubscribe = coord.subscribe((event) => received.push(event));
  unsubscribe();
  await coord.rebind();
  assert.equal(received.length, 0);
});

test("rebind-coordinator: re-fetches the generated config when refreshGenerated is true", async () => {
  const { calls, deps } = makeDeps();
  const coord = createRebindCoordinator(deps);
  await coord.rebind({ refreshGenerated: true });
  assert.equal(calls.resolveBridgeConfig, 1);
  // The first config is bridgeUrl=http://127.0.0.1:47771. The next rebind
  // should produce a different config (the test dep increments per call).
  await coord.rebind({ refreshGenerated: true });
  assert.equal(calls.resolveBridgeConfig, 2);
  assert.notEqual(
    (await coord.rebind({ refreshGenerated: true })).config.bridgeUrl,
    undefined,
  );
});
