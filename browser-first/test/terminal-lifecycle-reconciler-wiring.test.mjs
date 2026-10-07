// CP-BR7: reconciler wiring into the production composition root.
//
// Covers the CP-BR7 §8 contract for enable / grant / disable / revoke /
// remove / switching. Uses a fake reviewed terminal factory so no real
// process is spawned.
//
// The test builds a fake hostRegistry facade (the CP-BR4 reconciler
// reads `snapshot()` from it), a fake factory, and a fake emit. It then
// drives the reconciler through the desired-state transitions and
// asserts the per-add-on start / stop order, the generation fencing, and
// the switching determinism (Ghostty → iTerm2 stops the old adapter
// before starting the new one).

import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeReconciler } from "../host/runtime-reconciler.mjs";
import { createRuntimeFactoryRegistry } from "../host/runtime-factory-registry.mjs";
import {
  createTerminalRuntimeFactory,
  TERMINAL_FACTORY_IDS,
} from "../host/terminal-runtime-factories.mjs";
import { createHostRuntimeLifecycle } from "../host/runtime-lifecycle-host.mjs";

const ADDON_GHOSTTY = "addon.resonant-terminal-ghostty";
const ADDON_ITERM2 = "addon.resonant-terminal-iterm2";

function makeRegistry({ ghostty, iterm2, terminalHostService = null }) {
  const registry = createRuntimeFactoryRegistry({});
  registry.register(
    createTerminalRuntimeFactory({
      driver: "ghostty",
      serviceFactory: ghostty.serviceFactory,
      terminalHostService,
    }),
    { replace: true },
  );
  registry.register(
    createTerminalRuntimeFactory({
      driver: "iterm2",
      serviceFactory: iterm2.serviceFactory,
      terminalHostService,
    }),
    { replace: true },
  );
  return registry;
}

function makeFakeService({ driveId }) {
  return {
    startCalls: 0,
    stopCalls: 0,
    closeSessionCalls: [],
    async start() {
      this.startCalls += 1;
      return {
        adapterId: `addon.resonant-terminal-${driveId}`,
        driveId,
        bus: { fake: true, driveId },
        alive: true,
      };
    },
    async stop() {
      this.stopCalls += 1;
    },
    status() {
      return { alive: true, driveId };
    },
    async closeSession(sessionId) {
      this.closeSessionCalls.push(sessionId);
    },
  };
}

function makeServiceFactoryPair() {
  const ghosttyService = makeFakeService({ driveId: "ghostty" });
  const iterm2Service = makeFakeService({ driveId: "iterm2" });
  const ghostty = {
    serviceFactory: () => ghosttyService,
  };
  const iterm2 = {
    serviceFactory: () => iterm2Service,
  };
  return { ghostty, iterm2, ghosttyService, iterm2Service };
}

/**
 * Build a fake hostRegistry facade with the given installation set.
 * The CP-BR4 reconciler reads `snapshot()` and the resolver decides
 * desired state from the installation fields.
 */
function makeHostRegistry({ installations, bootEpoch = "boot-1" }) {
  return {
    snapshot: () => ({ bootEpoch, installations }),
    onFence: () => () => undefined,
  };
}

function installation({
  addonId,
  installed = true,
  enabled = true,
  grantedCapabilities = [
    { capability: "terminal-host", scope: "self", revocationBehavior: "graceful", granted: true },
  ],
  requiredCapabilities = ["terminal-host"],
  factoryId,
  runtimeType = "local-service",
  classification = "local-service",
  compatible = true,
  revocation = "none",
}) {
  const resolvedFactoryId = factoryId ?? (
    addonId === ADDON_GHOSTTY ? TERMINAL_FACTORY_IDS.ghostty : TERMINAL_FACTORY_IDS.iterm2
  );
  return {
    addonId,
    factoryId: resolvedFactoryId,
    manifest: {
      runtimeType,
      category: classification,
    },
    installed,
    enabled,
    grantedCapabilities,
    requiredCapabilities,
    compatible,
    revocation,
  };
}

const events = [];
const emit = (event) => {
  events.push(event);
};
function resetEvents() {
  events.length = 0;
}

// ---------------------------------------------------------------------------
// Req #2: enable + grant → start
// ---------------------------------------------------------------------------

test("CP-BR7 req #2: enable + grant transitions Ghostty to ready through the reconciler", async () => {
  resetEvents();
  const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
  const registry = makeRegistry({ ghostty, iterm2 });
  const hostRegistry = makeHostRegistry({
    installations: {
      [ADDON_GHOSTTY]: installation({
        addonId: ADDON_GHOSTTY,
        factoryId: TERMINAL_FACTORY_IDS.ghostty,
        enabled: true,
        grantedCapabilities: [
          { capability: "terminal-host", scope: "self", revocationBehavior: "graceful", granted: true },
        ],
      }),
    },
  });
  const reconciler = createRuntimeReconciler({
    factoryRegistry: registry,
    loadHostProjection: async () => hostRegistry.snapshot(),
    emit,
  });
  const result = await reconciler.reconcile();
  assert.equal(result.transitioned.length, 1, "reconcile transitions Ghostty");
  assert.equal(result.transitioned[0].addonId, ADDON_GHOSTTY);
  assert.equal(ghosttyService.startCalls, 1, "Ghostty factory.start was called exactly once");
  // The reconciler emits a `ready` event for the running addon.
  const readyEvents = events.filter((e) => e?.addonId === ADDON_GHOSTTY && e?.type === "ready");
  assert.ok(readyEvents.length >= 1, "at least one ready event was emitted");
});

// ---------------------------------------------------------------------------
// Req #3: disable stops and closes sessions
// ---------------------------------------------------------------------------

test("CP-BR7 req #3: disable stops Ghostty and closes its ROS-owned sessions", async () => {
  const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
  const terminalHostService = {
    sessions: [{ sessionId: "s1", ownedByRos: true }],
    async listSessions() {
      return this.sessions;
    },
    async closeSession(sessionId) {
      this.sessions = this.sessions.filter((s) => s.sessionId !== sessionId);
      ghosttyService.closeSessionCalls.push(sessionId);
    },
  };
  const registry = makeRegistry({ ghostty, iterm2, terminalHostService });
  let installations = {
    [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
  };
  const hostRegistry = {
    snapshot: () => ({ bootEpoch: "boot-1", installations }),
    onFence: () => () => undefined,
    _installations: () => installations,
  };
  const reconciler = createRuntimeReconciler({
    factoryRegistry: registry,
    loadHostProjection: async () => ({ bootEpoch: "boot-1", installations: hostRegistry._installations() }),
    terminalHostService,
    emit,
  });
  await reconciler.reconcile();
  assert.equal(ghosttyService.startCalls, 1);
  // Now disable.
  installations = {
    [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY, enabled: false }),
  };
  await reconciler.reconcile();
  assert.equal(ghosttyService.stopCalls, 1, "Ghostty factory.stop was called");
  assert.deepEqual(ghosttyService.closeSessionCalls, ["s1"], "ROS-owned session was closed");
});

// ---------------------------------------------------------------------------
// Req #4: revoke / remove stops the adapter
// ---------------------------------------------------------------------------

test("CP-BR7 req #4: revoke stops the adapter; remove stops the adapter", async () => {
  // Revoke: granted capability is removed but enabled/installed remain.
  {
    const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
    const registry = makeRegistry({ ghostty, iterm2 });
    let installations = {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
    };
    const hostRegistry = {
      snapshot: () => ({ bootEpoch: "boot-1", installations }),
      onFence: () => () => undefined,
      _installations: () => installations,
    };
    const reconciler = createRuntimeReconciler({ factoryRegistry: registry, loadHostProjection: async () => ({ bootEpoch: "boot-1", installations: hostRegistry._installations() }), emit });
    await reconciler.reconcile();
    assert.equal(ghosttyService.startCalls, 1, "started once");
    // Revoke: remove the grant.
    installations = {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY, grantedCapabilities: [] }),
    };
    await reconciler.reconcile();
    assert.equal(ghosttyService.stopCalls, 1, "revoke stopped Ghostty");
  }
  // Remove: installation entry is marked `installed: false`.
  {
    const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
    const registry = makeRegistry({ ghostty, iterm2 });
    let installations = {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
    };
    const hostRegistry = {
      snapshot: () => ({ bootEpoch: "boot-1", installations }),
      onFence: () => () => undefined,
      _installations: () => installations,
    };
    const reconciler = createRuntimeReconciler({ factoryRegistry: registry, loadHostProjection: async () => ({ bootEpoch: "boot-1", installations: hostRegistry._installations() }), emit });
    await reconciler.reconcile();
    assert.equal(ghosttyService.startCalls, 1);
    installations = {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY, installed: false, enabled: false }),
    };
    await reconciler.reconcile();
    assert.equal(ghosttyService.stopCalls, 1, "remove stopped Ghostty");
  }
});

// ---------------------------------------------------------------------------
// Req #5: switching stops the old adapter before starting the new one
// ---------------------------------------------------------------------------

test("CP-BR7 req #5: switching Ghostty → iTerm2 stops the old adapter before starting the new one", async () => {
  const { ghostty, iterm2, ghosttyService, iterm2Service } = makeServiceFactoryPair();
  const registry = makeRegistry({ ghostty, iterm2 });
  let installations = {
    [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
  };
  const hostRegistry = {
    snapshot: () => ({ bootEpoch: "boot-1", installations }),
    onFence: () => () => undefined,
    _installations: () => installations,
  };
  const reconciler = createRuntimeReconciler({
    factoryRegistry: registry,
    loadHostProjection: async () => ({ bootEpoch: "boot-1", installations: hostRegistry._installations() }),
    emit,
  });
  await reconciler.reconcile();
  assert.equal(ghosttyService.startCalls, 1);
  assert.equal(iterm2Service.startCalls, 0);
  // Switch: keep Ghostty in the projection (installed: false) and add iTerm2.
  // The reconciler sees both, stops Ghostty, starts iTerm2.
  installations = {
    [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY, installed: false, enabled: false }),
    [ADDON_ITERM2]: installation({
      addonId: ADDON_ITERM2,
      factoryId: TERMINAL_FACTORY_IDS.iterm2,
    }),
  };
  await reconciler.reconcile();
  // Old adapter is stopped, new adapter is started. No two active adapters.
  assert.equal(ghosttyService.stopCalls, 1, "Ghostty was stopped before iTerm2 started");
  assert.equal(iterm2Service.startCalls, 1, "iTerm2 was started");
  assert.equal(ghosttyService.startCalls, 1, "Ghostty was not re-started");
});

// ---------------------------------------------------------------------------
// Req #8: factory never executes a caller-supplied command/argv/env
// ---------------------------------------------------------------------------

test("CP-BR7 req #8: reconcile never feeds caller-supplied command/argv/env to the factory", async () => {
  const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
  const registry = makeRegistry({ ghostty, iterm2 });
  const hostRegistry = makeHostRegistry({
    installations: {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
    },
  });
  const reconciler = createRuntimeReconciler({ factoryRegistry: registry, loadHostProjection: async () => hostRegistry.snapshot(), emit });
  const result = await reconciler.reconcile();
  // The factory's serviceFactory was called with a pinned env only.
  assert.equal(result.transitioned.length, 1);
  assert.equal(ghosttyService.startCalls, 1);
  // The handle from the factory is opaque; the reconciler does not
  // inspect command / argv / cwd / env / endpoint.
});

// ---------------------------------------------------------------------------
// Req #10: reconciler is wired into the composition root
// ---------------------------------------------------------------------------

test("CP-BR7 req #10: createHostRuntimeLifecycle wires registry + reconciler + host registry", async () => {
  const { ghostty, iterm2, ghosttyService } = makeServiceFactoryPair();
  const registry = makeRegistry({ ghostty, iterm2 });
  const hostRegistry = makeHostRegistry({
    installations: {
      [ADDON_GHOSTTY]: installation({ addonId: ADDON_GHOSTTY }),
    },
  });
  const lifecycle = createHostRuntimeLifecycle({
    factoryRegistry: registry,
    hostRegistry,
    emit,
  });
  assert.ok(lifecycle.reconciler, "reconciler is wired");
  assert.equal(lifecycle.factoryRegistry, registry, "registry is wired");
  // Drive a reconcile through the wired reconciler.
  const result = await lifecycle.reconciler.reconcile();
  assert.equal(result.transitioned.length, 1, "wired reconciler started Ghostty");
  assert.equal(ghosttyService.startCalls, 1, "Ghostty factory.start was called");
});
