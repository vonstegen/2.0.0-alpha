// Phase 1.5 Step B integration tests for the terminal-host bridge wiring.
// Validates: default off, opt-in via env var, globalThis exposure, and
// that uninstall is idempotent + safe.

import assert from "node:assert/strict";
import test from "node:test";
import {
  installTerminalHostBridge,
  uninstallTerminalHostBridge,
  __testing__,
} from "../host/terminal-host-bridge-wiring.mjs";

function freshGlobal() {
  return {};
}

test("installTerminalHostBridge is a no-op when the env flag is not set", async () => {
  const globalObj = freshGlobal();
  const logs = [];
  const result = await installTerminalHostBridge({
    env: {},
    globalThis: globalObj,
    logger: (event) => logs.push(event),
  });
  assert.equal(result.enabled, false);
  assert.equal(result.service, null);
  assert.equal(result.started, null);
  assert.equal(globalObj[__testing__.GLOBAL_BUS_KEY], undefined);
  assert.equal(logs.length, 0);
  await uninstallTerminalHostBridge({ globalThis: globalObj });
});

test("installTerminalHostBridge composes the in-memory bus when the flag + driver are set", async () => {
  const globalObj = freshGlobal();
  const logs = [];
  const result = await installTerminalHostBridge({
    env: { RESONANT_TERMINAL_HOST_BRIDGE: "1", RESONANT_TERMINAL_DRIVER: "in-memory" },
    globalThis: globalObj,
    logger: (event) => logs.push(event),
  });
  assert.equal(result.enabled, true);
  assert.ok(result.service, "service must be present");
  assert.equal(result.started?.driveId, "in-memory");
  const bus = globalObj[__testing__.GLOBAL_BUS_KEY];
  assert.ok(bus, "bus must be exposed on globalThis");
  assert.equal(bus, result.started?.bus);
  assert.equal(globalObj[__testing__.GLOBAL_SERVICE_KEY], result.service);
  assert.equal(logs[0]?.event, "terminal_host.bridge_started");
  assert.equal(logs[0]?.driveId, "in-memory");

  // The exposed bus is real: a publish is observable to a consumer
  let observed = null;
  const subscription = bus.subscribe();
  (async () => {
    const { value } = await subscription.next();
    observed = value;
  })();
  bus.publish({ turnId: "test", type: "terminal.session.started", data: { sessionId: "s1", at: "2026-10-02T00:00:00.000Z" } });
  await new Promise((r) => setImmediate(r));
  assert.equal(observed?.type, "terminal.session.started");

  await uninstallTerminalHostBridge({ globalThis: globalObj, service: result.service });
  assert.equal(globalObj[__testing__.GLOBAL_BUS_KEY], undefined);
  assert.equal(globalObj[__testing__.GLOBAL_SERVICE_KEY], undefined);
});

test("installTerminalHostBridge surfaces the bus key on globalThis (the in-tree consumer path)", async () => {
  const globalObj = freshGlobal();
  const { GLOBAL_BUS_KEY } = __testing__;
  assert.equal(GLOBAL_BUS_KEY, "__rosTerminalHostBus__", "key is the documented public handle for downstream consumers");
  await installTerminalHostBridge({
    env: { RESONANT_TERMINAL_HOST_BRIDGE: "1", RESONANT_TERMINAL_DRIVER: "in-memory" },
    globalThis: globalObj,
  });
  assert.ok(globalObj[GLOBAL_BUS_KEY]);
  await uninstallTerminalHostBridge({ globalThis: globalObj });
});

test("uninstallTerminalHostBridge is idempotent and safe to call without a service", async () => {
  const globalObj = freshGlobal();
  await uninstallTerminalHostBridge({ globalThis: globalObj });
  await uninstallTerminalHostBridge({ globalThis: globalObj, service: null });
  // no throw
  assert.equal(globalObj[__testing__.GLOBAL_BUS_KEY], undefined);
});

test("installTerminalHostBridge rejects unknown driver values", async () => {
  const globalObj = freshGlobal();
  await assert.rejects(
    () => installTerminalHostBridge({
      env: { RESONANT_TERMINAL_HOST_BRIDGE: "1", RESONANT_TERMINAL_DRIVER: "ghostty" },
      globalThis: globalObj,
    }),
    /RESONANT_TERMINAL_DRIVER/,
  );
});
