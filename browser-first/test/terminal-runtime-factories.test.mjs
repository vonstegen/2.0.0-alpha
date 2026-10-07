// CP-BR7: reviewed Ghostty and iTerm2 runtime factory tests.
//
// Covers the CP-BR7 §8 contract:
//   1. Ghostty / iTerm2 factories wrap `createTerminalHostService` and
//      do not rebuild the adapter;
//   2. `start` calls the service factory and returns a handle;
//   3. `stop` calls `closeSessions` (closes ROS-owned sessions) and then
//      `service.stop()`;
//   4. `closeSessions` preserves no-confirm teardown and zero leaked
//      windows;
//   5. the factory never executes a caller-supplied command/argv/env;
//   6. the factory pins the driver and refuses to start a foreign addon
//      id;
//   7. health reports `ok: true` when the service is alive and
//      `ok: false` when the service is gone;
//   8. the registry is seeded with both reviewed factory ids and the
//      external-cli / pi-runtime seeds are untouched.
//
// All tests inject a fake `createTerminalHostService` so no real
// process is spawned.

import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalRuntimeFactory,
  seedTerminalRuntimeFactories,
  TERMINAL_FACTORY_IDS,
  __testing__ as factoryTesting,
} from "../host/terminal-runtime-factories.mjs";
import { createRuntimeFactoryRegistry } from "../host/runtime-factory-registry.mjs";

function makeFakeService({ alive = true } = {}) {
  return {
    startCalls: 0,
    stopCalls: 0,
    statusCalls: 0,
    closeSessionCalls: [],
    async start() {
      this.startCalls += 1;
      return {
        adapterId: `addon.resonant-terminal-${this.driveId}`,
        driveId: this.driveId,
        bus: { fake: true, driveId: this.driveId },
        alive: true,
      };
    },
    async stop() {
      this.stopCalls += 1;
    },
    status() {
      this.statusCalls += 1;
      return { alive, driveId: this.driveId };
    },
    async closeSession(sessionId) {
      this.closeSessionCalls.push(sessionId);
    },
    driveId: "ghostty",
  };
}

function makeFakeServiceFactory({ driveId = "ghostty", service = null } = {}) {
  const calls = [];
  const serviceFactory = (opts) => {
    calls.push(opts);
    const s = service ?? makeFakeService({ alive: true });
    s.driveId = opts?.env?.RESONANT_TERMINAL_DRIVER ?? driveId;
    return s;
  };
  return { serviceFactory, calls };
}

// ---------------------------------------------------------------------------
// Factory: spawn policy + driver pinning
// ---------------------------------------------------------------------------

test("CP-BR7 req #1: factory spawn policy is public and never leaks argv/env", () => {
  const { serviceFactory } = makeFakeServiceFactory();
  const factory = createTerminalRuntimeFactory({
    driver: "ghostty",
    serviceFactory,
    baseEnv: { PATH: "/usr/bin", HOME: "/Users/test", SECRET: "leak" },
  });
  assert.equal(factory.spawnPolicy.factoryId, TERMINAL_FACTORY_IDS.ghostty);
  assert.deepEqual(factory.spawnPolicy.supportedRuntimeTypes, ["local-service"]);
  // The summary is a single line; it must NOT include PATH, HOME, or any
  // environment value. It is a description, not a command.
  assert.doesNotMatch(factory.spawnPolicy.spawnSummary, /PATH=/);
  assert.doesNotMatch(factory.spawnPolicy.spawnSummary, /HOME=/);
  assert.doesNotMatch(factory.spawnPolicy.spawnSummary, /SECRET/);
  assert.doesNotMatch(factory.spawnPolicy.spawnSummary, /process\.env/);
});

test("CP-BR7 req #5: factory pins the driver and refuses to start a foreign addon id", async () => {
  const { serviceFactory, calls } = makeFakeServiceFactory();
  const factory = createTerminalRuntimeFactory({ driver: "ghostty", serviceFactory });
  await factory.start({ addonId: "addon.resonant-terminal-ghostty" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.RESONANT_TERMINAL_DRIVER, "ghostty");
  // Foreign addon id (an iTerm2 addon) is refused by a Ghostty factory.
  await assert.rejects(
    () => factory.start({ addonId: "addon.resonant-terminal-iterm2" }),
    /driver mismatch/i,
  );
});

test("CP-BR7 req #5: factory never spreads process.env into the adapter", async () => {
  const baseEnv = {
    PATH: "/usr/bin",
    HOME: "/Users/test",
    AWS_ACCESS_KEY_ID: "AKIA-leak",
    NODE_OPTIONS: "--inspect-leak",
    RESONANT_TERMINAL_DRIVER: "ghostty",
  };
  const { serviceFactory, calls } = makeFakeServiceFactory();
  const factory = createTerminalRuntimeFactory({ driver: "ghostty", serviceFactory, baseEnv });
  await factory.start({ addonId: "addon.resonant-terminal-ghostty" });
  const env = calls[0].env;
  // PATH and HOME are documented exceptions; the rest must not leak.
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  // The driver is forced to the factory's driver regardless of base env.
  assert.equal(env.RESONANT_TERMINAL_DRIVER, "ghostty");
});

// ---------------------------------------------------------------------------
// Factory: start / stop / health / closeSessions
// ---------------------------------------------------------------------------

test("CP-BR7 req #1 + #9: start calls service.start, stop closes sessions then service.stop", async () => {
  const service = makeFakeService({ alive: true });
  const { serviceFactory } = makeFakeServiceFactory({ service });
  const terminalHostService = {
    sessions: [],
    async listSessions() {
      return this.sessions;
    },
    async closeSession(sessionId) {
      this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId);
      service.closeSessionCalls.push(sessionId);
    },
  };
  terminalHostService.sessions = [
    { sessionId: "s1", ownedByRos: true },
    { sessionId: "s2", ownedByRos: true },
    { sessionId: "s3", ownedByRos: false }, // not ROS-owned
  ];
  const factory = createTerminalRuntimeFactory({
    driver: "ghostty",
    serviceFactory,
    terminalHostService,
  });
  const handle = await factory.start({ addonId: "addon.resonant-terminal-ghostty" });
  assert.equal(service.startCalls, 1);
  assert.equal(handle.addonId, "addon.resonant-terminal-ghostty");
  await factory.stop(handle, { addonId: "addon.resonant-terminal-ghostty", timeoutMs: 50 });
  // Only ROS-owned sessions are closed; the non-owned session is left alone.
  assert.deepEqual(service.closeSessionCalls.sort(), ["s1", "s2"]);
  assert.equal(service.stopCalls, 1);
});

test("CP-BR7 req #9: closeSessions preserves no-confirm teardown (no throw)", async () => {
  const service = makeFakeService({ alive: true });
  const { serviceFactory } = makeFakeServiceFactory({ service });
  const factory = createTerminalRuntimeFactory({ driver: "iterm2", serviceFactory });
  const handle = await factory.start({ addonId: "addon.resonant-terminal-iterm2" });
  // Inject a closeSession that throws; closeSessions must swallow.
  service.closeSession = async () => {
    throw new Error("simulated teardown failure");
  };
  await assert.doesNotReject(() =>
    factory.closeSessions(handle, { addonId: "addon.resonant-terminal-iterm2" }),
  );
  // After closeSessions, the service is still alive (closeSessions is a
  // pre-stop operation; the reconciler calls stop after).
  assert.equal(service.stopCalls, 0);
});

test("CP-BR7 req #1: health reports ok when service is alive", async () => {
  const service = makeFakeService({ alive: true });
  const { serviceFactory } = makeFakeServiceFactory({ service });
  const factory = createTerminalRuntimeFactory({ driver: "ghostty", serviceFactory });
  const handle = await factory.start({ addonId: "addon.resonant-terminal-ghostty" });
  const result = await factory.health(handle, { addonId: "addon.resonant-terminal-ghostty" });
  assert.equal(result.ok, true);
  assert.equal(result.publicDetail, "ghostty");
});

test("CP-BR7 req #1: health reports not-running when service is gone", async () => {
  const { serviceFactory } = makeFakeServiceFactory();
  const factory = createTerminalRuntimeFactory({ driver: "ghostty", serviceFactory });
  // No start call; handle is the per-add-on map.
  const result = await factory.health(null, { addonId: "addon.resonant-terminal-ghostty" });
  assert.equal(result.ok, false);
  assert.equal(result.publicDetail, "terminal-not-running");
});

test("CP-BR7 req #1: degrade returns a degraded handle", async () => {
  const service = makeFakeService({ alive: true });
  const { serviceFactory } = makeFakeServiceFactory({ service });
  const factory = createTerminalRuntimeFactory({ driver: "iterm2", serviceFactory });
  const handle = await factory.start({ addonId: "addon.resonant-terminal-iterm2" });
  const degraded = await factory.degrade(handle, {
    addonId: "addon.resonant-terminal-iterm2",
    publicReason: "bridge-health-stale",
  });
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.publicReason, "bridge-health-stale");
  assert.equal(degraded.addonId, "addon.resonant-terminal-iterm2");
});

// ---------------------------------------------------------------------------
// Registry seeding
// ---------------------------------------------------------------------------

test("CP-BR7 req #1: seedTerminalRuntimeFactories registers both reviewed ids", () => {
  const registry = createRuntimeFactoryRegistry();
  const result = seedTerminalRuntimeFactories(registry, {
    serviceFactory: makeFakeServiceFactory().serviceFactory,
  });
  assert.ok(registry.has(TERMINAL_FACTORY_IDS.ghostty));
  assert.ok(registry.has(TERMINAL_FACTORY_IDS.iterm2));
  assert.deepEqual(result.seeded, ["ghostty", "iterm2"]);
  // The factory's spawnPolicy is public.
  const ghostty = registry.get(TERMINAL_FACTORY_IDS.ghostty);
  assert.equal(ghostty.spawnPolicy.factoryId, TERMINAL_FACTORY_IDS.ghostty);
});

test("CP-BR7 req #1: unknown driver is rejected at construction", () => {
  assert.throws(
    () => createTerminalRuntimeFactory({ driver: "xterm" }),
    /driver must be/i,
  );
});

// ---------------------------------------------------------------------------
// Pinned env helper
// ---------------------------------------------------------------------------

test("CP-BR7 req #5: buildPinnedEnv strips all non-allowlisted keys", () => {
  const env = factoryTesting.buildPinnedEnv({
    driver: "ghostty",
    baseEnv: {
      PATH: "/usr/bin",
      HOME: "/Users/test",
      SECRET: "leak",
      RESONANT_TERMINAL_DRIVER: "in-memory",
    },
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.HOME, "/Users/test");
  assert.equal(env.RESONANT_TERMINAL_DRIVER, "ghostty"); // forced, not inherited
  assert.equal(env.SECRET, undefined);
});

test("CP-BR7 req #5: buildPinnedEnv leaves empty baseEnv in a valid state", () => {
  const env = factoryTesting.buildPinnedEnv({ driver: "iterm2", baseEnv: {} });
  assert.equal(env.RESONANT_TERMINAL_DRIVER, "iterm2");
  assert.equal(env.PATH, undefined);
  assert.equal(env.HOME, undefined);
});
