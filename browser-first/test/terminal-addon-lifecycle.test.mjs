// CP-BR9 integration: the terminal add-ons are live in the extension's
// registry path. Enable/grant -> real adapter start, disable/revoke/remove
// -> stop + session close, switching stops-old-before-start-new, the
// projection reports honest status, and `Open in Terminal` reaches the same
// live service instance that enabling produced.
//
// Everything here runs through the production wiring the ROS-started bridge
// composes in run-bridge-minimal.mjs:
//
//   host registry (seeded add-ons) -> CP-BR3 resolver -> CP-BR4 reconciler
//   -> CP-BR7 terminal factories -> CP-BR9 single service owner -> the
//   facade the harness routes (`/terminal-host/*`) see.
//
// The only substitution is the terminal-host service factory: a fake
// adapter service stands in for createTerminalHostService so no real
// Ghostty/iTerm2 process is spawned. The live-process proof is
// examples/sdk-demo/terminal-host/cp-br9-live-terminal-smoke.mjs.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

import { createHarnessHostService } from "../host/harness-host-service.mjs";
import { loadTerminalAddonSeedInstallations } from "../host/terminal-addon-seed.mjs";
import { createTerminalHostServiceOwner } from "../host/terminal-host-service-owner.mjs";
import {
  createRuntimeFactoryRegistry,
  ensureReviewedRuntimeFactories,
} from "../host/runtime-factory-registry.mjs";
import { seedTerminalRuntimeFactories } from "../host/terminal-runtime-factories.mjs";
import { createHostRuntimeLifecycle } from "../host/runtime-lifecycle-host.mjs";
import { createRuntimeProjectionService } from "../host/runtime-projection-service.mjs";
import { evaluateBridgeRequestForSelfTest } from "../host/bridge-server.mjs";

const GHOSTTY = "addon.resonant-terminal-ghostty";
const ITERM2 = "addon.resonant-terminal-iterm2";
const TERMINAL_GRANT = {
  capability: "terminal-host",
  scope: "system",
  revocationBehavior: "degrade",
};

const providerHost = {
  executeProviderStatus: async () => ({ providers: [] }),
  executeBridgeChat: async () => ({}),
};

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

function memoryStore() {
  let stored = null;
  return {
    read: async () => stored,
    write: async (value) => {
      stored = structuredClone(value);
    },
  };
}

function startHealthServer() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, version: "alpha" }));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        stop: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function makePromptFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "cp-br9-prompt-"));
  const file = join(dir, "prompt.txt");
  await writeFile(file, "launch pi", { mode: 0o600 });
  t.after(() => rm(dir, { recursive: true, force: true }));
  return file;
}

/**
 * A stand-in for the service `createTerminalHostService` returns. It records
 * the lifecycle calls the factory makes and exposes the same surface the
 * factory + launch route consume: start/stop/status/closeSession/
 * launchBootstrap.
 */
function makeFakeAdapterService(driveId, { aliveAfterStart = true } = {}) {
  return {
    driveId,
    startCalls: 0,
    stopCalls: 0,
    closeSessionCalls: [],
    launchBootstrapCalls: [],
    sessions: [],
    async start() {
      this.startCalls += 1;
      return {
        adapterId: `addon.resonant-terminal-${driveId}`,
        driveId,
        bus: { driveId },
        startedAt: new Date(0).toISOString(),
      };
    },
    async stop() {
      this.stopCalls += 1;
      this.sessions = [];
    },
    status() {
      return {
        alive: aliveAfterStart && this.startCalls > this.stopCalls,
        driveId,
        adapterId: `addon.resonant-terminal-${driveId}`,
        sessions: this.sessions,
      };
    },
    async closeSession(sessionId) {
      this.closeSessionCalls.push(sessionId);
      this.sessions = this.sessions.filter((entry) => entry.sessionId !== sessionId);
    },
    async launchBootstrap(args) {
      this.launchBootstrapCalls.push(args);
      return { accepted: true, sessionId: args?.sessionId };
    },
  };
}

/**
 * Compose the production wiring over an in-memory registry store.
 */
async function makeWorld(t, { store = memoryStore(), aliveAfterStart = true } = {}) {
  const owner = createTerminalHostServiceOwner();
  const facade = owner.facade({ fallback: null });
  const svc = await createHarnessHostService({
    env: {},
    store,
    providerHost,
    terminalHost: facade,
    seedInstallations: await loadTerminalAddonSeedInstallations(),
  });
  t.after(() => svc.close());

  // The reconcile driver below is explicit, so the registry fence hook is
  // left unwired: a fire-and-forget fence reconcile would race the
  // awaited reconcile and make call-ordering assertions non-deterministic.
  const factoryCalls = [];
  const services = new Map();
  const serviceFactory = (options) => {
    // `createTerminalHostService` takes `addonId` as a nullary function;
    // the reviewed factory pins it per add-on. Resolve it the same way the
    // real service does.
    const addonId = typeof options?.addonId === "function" ? options.addonId() : options?.addonId;
    factoryCalls.push({ phase: "construct", addonId, options });
    const driveId = options?.env?.RESONANT_TERMINAL_DRIVER ?? "unknown";
    const service = makeFakeAdapterService(driveId, { aliveAfterStart });
    services.set(addonId, service);
    const start = service.start.bind(service);
    service.start = async () => {
      factoryCalls.push({ phase: "start", addonId, driveId });
      return start();
    };
    const stop = service.stop.bind(service);
    service.stop = async () => {
      factoryCalls.push({ phase: "stop", addonId, driveId });
      return stop();
    };
    return service;
  };

  const factoryRegistry = createRuntimeFactoryRegistry({});
  ensureReviewedRuntimeFactories(factoryRegistry, { observers: new Map() });
  seedTerminalRuntimeFactories(factoryRegistry, {
    serviceFactory,
    baseEnv: {},
    terminalHostService: null,
    serviceOwner: owner,
  });

  const events = [];
  let projectionSink = null;
  const lifecycle = createHostRuntimeLifecycle({
    factoryRegistry,
    hostRegistry: svc.registry,
    emit: (event) => {
      events.push(event);
      projectionSink?.(event);
    },
  });
  const projection = createRuntimeProjectionService({
    hostRegistry: svc.registry,
    reconciler: lifecycle.reconciler,
    bridgeStatus: {
      snapshot: () => ({
        status: facade.service.status().alive || !owner.ownerAddonId() ? "connected" : "degraded",
        version: "alpha",
        endpoint: "http://127.0.0.1:47773",
        publicEndpoint: "http://127.0.0.1:47773",
        startedAt: new Date(0).toISOString(),
        uptimeSeconds: 0,
        instanceId: "bridge-test",
        bootEpoch: String(svc.registry.snapshot().bootEpoch ?? ""),
      }),
    },
    sessionCounts: { getSessionsByRuntime: () => ({ activeSessionCount: 0 }) },
  });
  projectionSink = (event) => projection.recordEvent(event);

  const call = (url, body = {}, overrides = {}) => {
    const method = url.startsWith("/terminal-host/status") || url.startsWith("/addons/registry")
      ? "GET"
      : "POST";
    const route = svc.harnessRoutes.find((entry) => entry.path === url.split("?")[0]);
    return evaluateBridgeRequestForSelfTest({
      method,
      url,
      body,
      routes: svc.harnessRoutes,
      bridgeToken: "bridge-token",
      bridgeCapabilityTokens: tokens,
      listenerPort: 47773,
      headers: {
        host: "127.0.0.1:47773",
        "x-resonantos-bridge-token": "bridge-token",
        "x-resonantos-bridge-capability-token": tokens[route?.requiredCapability],
      },
      rawHeaders: ["Host", "127.0.0.1:47773"],
      ...overrides,
    });
  };

  // Mutations go through the same routes the extension calls, then the
  // reconcile the production fence hook would have triggered is awaited.
  const settle = async () => {
    await lifecycle.reconciler.reconcile();
  };
  const setEnabled = async (addonId, enabled) => {
    const result = await call("/addons/enabled", {
      addonId,
      enabled,
      expectedRevision: svc.registry.snapshot().revision,
    });
    assert.equal(result.status, 200, `enable ${addonId}: ${JSON.stringify(result.payload)}`);
    await settle();
  };
  const setGrant = async (addonId, granted) => {
    const result = await call("/addons/grants", {
      addonId,
      grants: [{ ...TERMINAL_GRANT, granted }],
      consent: true,
      expectedRevision: svc.registry.snapshot().revision,
    });
    assert.equal(result.status, 200, `grant ${addonId}: ${JSON.stringify(result.payload)}`);
    await settle();
  };
  const remove = async (addonId) => {
    const result = await call("/addons/remove", { addonId });
    assert.equal(result.status, 200, `remove ${addonId}: ${JSON.stringify(result.payload)}`);
    await settle();
  };
  const activate = async (addonId) => {
    await setEnabled(addonId, true);
    await setGrant(addonId, true);
  };
  const statusOf = (addonId) =>
    projection.snapshot().runtimeList.find((entry) => entry.addonId === addonId)?.status ?? null;

  await settle(); // boot reconcile, exactly as the composition root does

  return {
    svc,
    owner,
    facade,
    lifecycle,
    projection,
    events,
    factoryCalls,
    services,
    call,
    settle,
    setEnabled,
    setGrant,
    remove,
    activate,
    statusOf,
  };
}

// ---------------------------------------------------------------------------
// Enable / grant -> real adapter
// ---------------------------------------------------------------------------

test("CP-BR9 req #2: enable alone starts nothing; the terminal-host grant starts the adapter", async (t) => {
  const world = await makeWorld(t);
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  assert.equal(world.facade.service.status().alive, false);

  await world.setEnabled(GHOSTTY, true);
  assert.equal(world.owner.ownerAddonId(), null, "no grant -> no runtime");
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  assert.equal(world.services.size, 0, "the factory is never called without authority");

  await world.setGrant(GHOSTTY, true);
  assert.equal(world.owner.ownerAddonId(), GHOSTTY);
  assert.equal(world.statusOf(GHOSTTY), "ready");
  const service = world.services.get(GHOSTTY);
  assert.equal(service.startCalls, 1);
  assert.equal(world.facade.service.status().alive, true);
  assert.equal(world.facade.service.status().driveId, "ghostty");
  assert.equal(world.facade.service.status().adapterId, GHOSTTY);

  // Re-reconciling the same generation is a no-op: no second spawn.
  await world.settle();
  await world.settle();
  assert.equal(service.startCalls, 1);
  assert.equal(world.services.size, 1);
});

test("CP-BR9 req #2: the reconciler emits public lifecycle events for the start", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const kinds = world.events.map((event) => event.type ?? event.event ?? event.kind);
  assert.ok(kinds.includes("start_requested"), `saw ${JSON.stringify(kinds)}`);
  assert.ok(kinds.includes("ready"), `saw ${JSON.stringify(kinds)}`);
  for (const event of world.events) {
    const serialized = JSON.stringify(event);
    assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{8,}/);
    assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i);
    assert.doesNotMatch(serialized, /RESONANT_TERMINAL_HOST_BRIDGE/);
  }
});

// ---------------------------------------------------------------------------
// Disable / revoke / remove -> stop
// ---------------------------------------------------------------------------

test("CP-BR9 req #3: disable stops the adapter and closes only ROS-owned sessions", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const service = world.services.get(GHOSTTY);
  service.sessions = [
    { sessionId: "s1", ownedByRos: true },
    { sessionId: "s2", ownedByRos: true },
    { sessionId: "s3", ownedByRos: false },
  ];

  await world.setEnabled(GHOSTTY, false);
  assert.equal(world.owner.ownerAddonId(), null);
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  assert.equal(service.stopCalls, 1);
  assert.deepEqual([...service.closeSessionCalls].sort(), ["s1", "s2"]);
  assert.equal(world.facade.service.status().alive, false);
});

test("CP-BR9 req #4: revoking the terminal-host grant stops the adapter", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const service = world.services.get(GHOSTTY);

  await world.setGrant(GHOSTTY, false);
  assert.equal(world.owner.ownerAddonId(), null);
  assert.equal(service.stopCalls, 1);
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  // The add-on stays installed and enabled; only authority was withdrawn.
  const installation = world.svc.registry.snapshot().installations[GHOSTTY];
  assert.equal(installation.enabled, true);
  assert.equal(installation.grantedCapabilities.every((grant) => grant.granted === false), true);
});

test("CP-BR9 req #4: removing a running add-on stops it and drops it from the projection", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const service = world.services.get(GHOSTTY);

  await world.remove(GHOSTTY);
  assert.equal(service.stopCalls, 1, "a removed installation is stopped, never leaked");
  assert.equal(world.owner.ownerAddonId(), null);
  assert.equal(world.svc.registry.snapshot().installations[GHOSTTY], undefined);
  assert.equal(world.statusOf(GHOSTTY), null, "removed add-on leaves the runtime list");
  assert.equal(world.lifecycle.reconciler.listActive().length, 0);
});

// ---------------------------------------------------------------------------
// Switching: one terminal at a time, stop-old-before-start-new
// ---------------------------------------------------------------------------

test("CP-BR9 req #5: the documented switch (disable, then enable) stops the old adapter first", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  await world.setEnabled(GHOSTTY, false);
  await world.activate(ITERM2);

  assert.equal(world.owner.ownerAddonId(), ITERM2);
  assert.equal(world.facade.service.status().driveId, "iterm2");
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  assert.equal(world.statusOf(ITERM2), "ready");

  const phases = world.factoryCalls.map((entry) => `${entry.phase}:${entry.addonId}`);
  const ghosttyStop = phases.indexOf(`stop:${GHOSTTY}`);
  const iterm2Construct = phases.indexOf(`construct:${ITERM2}`);
  assert.ok(ghosttyStop >= 0 && iterm2Construct >= 0, phases.join(" | "));
  assert.ok(ghosttyStop < iterm2Construct, `stop-old-before-start-new: ${phases.join(" | ")}`);
});

test("CP-BR9 req #5: a second terminal enabled while one is live is refused, then retried on release", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  // Operator error: enable the sibling without disabling the incumbent.
  await world.activate(ITERM2);
  assert.equal(world.owner.ownerAddonId(), GHOSTTY, "the incumbent keeps the singleton");
  assert.equal(world.statusOf(GHOSTTY), "ready");
  assert.equal(
    world.statusOf(ITERM2),
    "failed",
    "the refused start reports failed, never a registry-derived ready",
  );
  // The factory refuses the spawn before the service is even constructed:
  // the singleton gate fires at the top of `start()`. No process is
  // created and the reconciler records a failed result with no handle.
  assert.equal(
    world.factoryCalls.filter((c) => c.addonId === ITERM2).length,
    0,
    "refused start never spawns the adapter",
  );
  assert.equal(world.lifecycle.reconciler._peek(ITERM2)?.handle ?? null, null);

  // Releasing the incumbent lets the pending add-on retry without a new
  // authority transaction.
  await world.setEnabled(GHOSTTY, false);
  assert.equal(world.owner.ownerAddonId(), ITERM2);
  assert.equal(world.statusOf(GHOSTTY), "inactive");
  assert.equal(world.statusOf(ITERM2), "ready");
  // The retry constructed a fresh service and started it.
  const iterm2Constructs = world.factoryCalls.filter((c) => c.phase === "construct" && c.addonId === ITERM2);
  const iterm2Starts = world.factoryCalls.filter((c) => c.phase === "start" && c.addonId === ITERM2);
  assert.equal(iterm2Constructs.length, 1);
  assert.equal(iterm2Starts.length, 1);
  assert.equal(world.services.get(ITERM2).startCalls, 1, "the retry produced a fresh service");
  assert.equal(world.services.get(ITERM2).stopCalls, 0);

  const phases = world.factoryCalls.map((entry) => `${entry.phase}:${entry.addonId}`);
  const ghosttyStop = phases.indexOf(`stop:${GHOSTTY}`);
  const iterm2Start = phases.lastIndexOf(`start:${ITERM2}`);
  assert.ok(ghosttyStop >= 0 && iterm2Start >= 0, phases.join(" | "));
  assert.ok(ghosttyStop < iterm2Start, `family lock ordering: ${phases.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// Projection surface (CP-BR5 §5.4)
// ---------------------------------------------------------------------------

test("CP-BR9 req #5.4: both terminal add-ons surface in the projection with honest status", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const snapshot = world.projection.snapshot();
  const byId = new Map(snapshot.runtimeList.map((entry) => [entry.addonId, entry]));
  assert.equal(byId.size >= 2, true, "both seeded add-ons are projected");
  for (const addonId of [GHOSTTY, ITERM2]) {
    const entry = byId.get(addonId);
    assert.ok(entry, `${addonId} is projected`);
    assert.equal(entry.runtimeType, "local-service");
    assert.equal(typeof entry.generation, "number");
    assert.equal(typeof entry.activeSessionCount, "number");
  }
  assert.equal(byId.get(GHOSTTY).status, "ready");
  assert.equal(byId.get(ITERM2).status, "inactive");
  assert.equal(snapshot.bridgeOverview.status, "connected");
  // The projection is public by construction: no secret-shaped values.
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /sk-[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(serialized, /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i);
  assert.doesNotMatch(serialized, /RESONANT_TERMINAL_HOST_BRIDGE/);
});

// ---------------------------------------------------------------------------
// Spawn policy (CP-BR7 req #5 / CP-BR9 §7)
// ---------------------------------------------------------------------------

test("CP-BR9 req #7: the factory call carries only a pinned env and the add-on id", async (t) => {
  const world = await makeWorld(t);
  await world.activate(GHOSTTY);
  const construct = world.factoryCalls.find((entry) => entry.phase === "construct");
  assert.ok(construct, "the factory constructed a service");
  assert.deepEqual(Object.keys(construct.options).sort(), ["addonId", "env"]);
  // `createTerminalHostService` takes addonId as a nullary function;
  // the reviewed factory pins it per add-on. The real contract.
  assert.equal(typeof construct.options.addonId, "function");
  assert.equal(construct.addonId, GHOSTTY);
  // Driver is pinned by the reviewed factory; nothing caller-supplied rides along.
  assert.deepEqual(Object.keys(construct.options.env), ["RESONANT_TERMINAL_DRIVER"]);
  assert.equal(construct.options.env.RESONANT_TERMINAL_DRIVER, "ghostty");
  // No executable, argv, or cwd rides in. The adapter resolves its own
  // binary per the reviewed spawn policy.
  assert.equal(construct.options.command, undefined);
  assert.equal(construct.options.argv, undefined);
  assert.equal(construct.options.cwd, undefined);
});

// ---------------------------------------------------------------------------
// Open in Terminal reaches the same live service (CP-BR9 §2 + §8)
// ---------------------------------------------------------------------------

test("CP-BR9 req #6: the launch route refuses until the add-on is enabled, granted, and live", async (t) => {
  const health = await startHealthServer();
  t.after(() => health.stop());
  const world = await makeWorld(t);
  const promptPath = await makePromptFile(t);
  const launch = (addonId = GHOSTTY) =>
    world.call("/terminal-host/launch", {
      agentId: "pi",
      terminalAddonId: addonId,
      promptPath,
      options: { bridgeEndpoint: health.endpoint },
    });

  // Installed, not enabled, not granted.
  let result = await launch();
  assert.equal(result.status, 200, "typed rejections travel as 200 ok:false");
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "capability-not-granted");

  // Enabled, still not granted.
  await world.setEnabled(GHOSTTY, true);
  result = await launch();
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "capability-not-granted");

  // Granted and live: the route reaches the adapter the reconciler started.
  await world.setGrant(GHOSTTY, true);
  const service = world.services.get(GHOSTTY);
  result = await launch();
  assert.equal(result.status, 200);
  if (result.payload.ok) {
    assert.equal(service.launchBootstrapCalls.length, 1,
      "launch runs on the same service instance enable produced");
    assert.equal(typeof result.payload.launchId, "string");
  } else {
    // The only environment-dependent branch: no reviewed `pi` install on
    // this host. Every other rejection is a real failure.
    assert.equal(result.payload.reason, "executable-unavailable",
      `unexpected launch rejection: ${JSON.stringify(result.payload)}`);
  }

  // The sibling add-on is not the live owner: its launch is refused.
  const sibling = await launch(ITERM2);
  assert.equal(sibling.payload.ok, false);
  assert.equal(sibling.payload.reason, "capability-not-granted");
});

test("CP-BR9 req #6: a dead adapter fails the launch closed instead of launching into nothing", async (t) => {
  const health = await startHealthServer();
  t.after(() => health.stop());
  const world = await makeWorld(t, { aliveAfterStart: false });
  const promptPath = await makePromptFile(t);
  await world.activate(GHOSTTY);
  // The start reports not-alive, so the reconciler never leaves a ready
  // record and the owner holds nothing.
  assert.equal(world.statusOf(GHOSTTY), "failed");
  assert.equal(world.owner.ownerAddonId(), null);

  const result = await world.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: GHOSTTY,
    promptPath,
    options: { bridgeEndpoint: health.endpoint },
  });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-not-running");
});

test("CP-BR9 req #8: /terminal-host/status reports the live adapter through the same owner", async (t) => {
  const world = await makeWorld(t);
  let status = await world.call("/terminal-host/status");
  assert.equal(status.status, 200);
  assert.equal(status.payload.connected, false);

  await world.activate(GHOSTTY);
  status = await world.call("/terminal-host/status");
  assert.equal(status.payload.connected, true);
  const surface = status.payload.surfaces.find((entry) => entry.adapterId === GHOSTTY);
  assert.ok(surface, "the enabled add-on is surfaced");
  assert.equal(surface.compatible, true);
  assert.equal(surface.connected, true);
  const sibling = status.payload.surfaces.find((entry) => entry.adapterId === ITERM2);
  assert.equal(sibling.connected, false, "only one terminal is live at a time");
});

// ---------------------------------------------------------------------------
// Restore after bridge restart (CP-BR4 req #11 through the seeded add-ons)
// ---------------------------------------------------------------------------

test("CP-BR9 req #9: a restart re-starts the enabled+granted add-on exactly once", async (t) => {
  const store = memoryStore();
  const first = await makeWorld(t, { store });
  await first.activate(GHOSTTY);
  assert.equal(first.owner.ownerAddonId(), GHOSTTY);
  await first.lifecycle.reconciler.stopAll();
  await first.svc.close();

  const second = await makeWorld(t, { store });
  assert.equal(second.owner.ownerAddonId(), GHOSTTY, "restore starts the add-on on boot");
  assert.equal(second.services.get(GHOSTTY).startCalls, 1, "exactly one spawn on restore");
  assert.equal(second.statusOf(GHOSTTY), "ready");
  assert.equal(second.statusOf(ITERM2), "inactive");
  // The restored boot is a different bridge identity but the same consent.
  const installation = second.svc.registry.snapshot().installations[GHOSTTY];
  assert.equal(installation.enabled, true);
  assert.ok(installation.grantedCapabilities.some((grant) => grant.capability === "terminal-host" && grant.granted));
});
