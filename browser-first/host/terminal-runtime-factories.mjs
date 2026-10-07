// CP-BR7: reviewed Ghostty and iTerm2 runtime factories.
//
// These factories are the first production proof of the generic runtime
// lifecycle (CP-BR3/CP-BR4). They wrap the existing
// `createTerminalHostService` from `terminal-host-service.mjs` — they do
// NOT rebuild the Ghostty/iTerm2 adapters. The factory body owns the
// per-add-on terminal service instance; the reconciler owns lifecycle
// ordering and generation fencing.
//
// Hard rules (CP-BR7 §7):
//   - No caller-supplied executable / argv / cwd / env / path / endpoint.
//   - The factory pins the driver and `RESONANT_TERMINAL_DRIVER` per
//     factory id; the spawn policy never reads the ambient process env
//     for driver selection.
//   - `closeSessions` closes ROS-owned terminal sessions before the
//     factory reports stopped. The factory does not leak windows
//     (preserves the XH4/XH5 zero-leaked-windows invariant).
//   - Lifecycle events / projection stay non-secret (no PID / path /
//     argv / env / token).
//   - Classification is not lifecycle authority.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §13 (CP-BR7), ADR-040, ADR-047.

import { createTerminalHostService } from "./terminal-host-service.mjs";

const KNOWN_DRIVERS = new Set(["ghostty", "iterm2"]);

// ---------------------------------------------------------------------------
// Public factory ids
// ---------------------------------------------------------------------------

export const TERMINAL_FACTORY_IDS = Object.freeze({
  ghostty: "com.resonantos.factory.terminal-host.ghostty",
  iterm2: "com.resonantos.factory.terminal-host.iterm2",
});

// ---------------------------------------------------------------------------
// Spawn policy summary (public; never includes executable / argv / cwd / env)
// ---------------------------------------------------------------------------

const SPAWN_SUMMARY = Object.freeze({
  ghostty: "Reviewed local-service factory for the Ghostty terminal adapter (pinned driver; no caller command, argv, or env).",
  iterm2: "Reviewed local-service factory for the iTerm2 terminal adapter (pinned driver; no caller command, argv, or env).",
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the factory id from the addon id. The registry is keyed by
 * factory id, but the reconciler dispatches by `addonId`; we need a
 * stable mapping from `addonId` to the driver.
 */
function driverForAddonId(addonId) {
  if (addonId === "addon.resonant-terminal-ghostty") return "ghostty";
  if (addonId === "addon.resonant-terminal-iterm2") return "iterm2";
  return null;
}

function factoryIdForDriver(driver) {
  if (driver === "ghostty") return TERMINAL_FACTORY_IDS.ghostty;
  if (driver === "iterm2") return TERMINAL_FACTORY_IDS.iterm2;
  throw new TypeError(`Unknown terminal driver: ${String(driver)}`);
}

/**
 * Build a minimal pinned environment for the terminal adapter. The
 * factory never inherits the ambient `process.env`; it sets only the
 * keys the adapter is documented to need (the existing
 * `ADAPTER_ENV_ALLOWLIST` plus the driver). PATH / HOME are documented
 * exceptions (PATH is required for runtime resolution; HOME is used by
 * the iTerm2 Python API to locate its socket under the user home).
 *
 * This mirrors the existing `terminal-host-service.mjs` allowlist; the
 * factory repeats it here so the spawn policy is fully host-coded and
 * does not depend on ambient process state.
 */
function buildPinnedEnv({ driver, baseEnv = {} }) {
  const allowlist = ["PATH", "HOME"];
  const env = {};
  for (const key of allowlist) {
    if (typeof baseEnv[key] === "string" && baseEnv[key].length > 0) {
      env[key] = baseEnv[key];
    }
  }
  env.RESONANT_TERMINAL_DRIVER = driver;
  return env;
}

/**
 * Close any ROS-owned terminal sessions tracked by the service before
 * the factory reports `stopped`. The factory does not leak windows.
 */
async function closeServiceSessions(service, { addonId, now, terminalHostService }) {
  // Prefer the production service's session list when available; tests
  // inject a fake `terminalHostService` that exposes `listSessions()`
  // and `closeSession(id)`. The real service exposes `status()` which
  // carries a session list.
  if (terminalHostService && typeof terminalHostService.listSessions === "function") {
    const sessions = await terminalHostService.listSessions();
    for (const session of sessions) {
      if (session?.ownedByRos !== true) continue;
      if (typeof terminalHostService.closeSession === "function") {
        await terminalHostService.closeSession(session.sessionId);
      }
    }
    return { closed: sessions.length, addonId };
  }
  if (service && typeof service.status === "function") {
    const snap = service.status();
    const sessions = Array.isArray(snap?.sessions) ? snap.sessions : [];
    for (const session of sessions) {
      if (session?.ownedByRos !== true) continue;
      if (typeof service.closeSession === "function") {
        try {
          await service.closeSession(session.sessionId);
        } catch {
          // No-confirm teardown: never throw from cleanup.
        }
      }
    }
    return { closed: sessions.length, addonId };
  }
  return { closed: 0, addonId };
}

// ---------------------------------------------------------------------------
// Factory builder
// ---------------------------------------------------------------------------

/**
 * Build a single CP-BR4 RuntimeFactory that wraps
 * `createTerminalHostService`. The factory is what the CP-BR4
 * reconciler looks up by `factoryId`. The factory body owns:
 *   - the driver (Ghostty or iTerm2)
 *   - the per-add-on terminal service instance
 *   - the closeSessions semantics
 *
 * @param {{
 *   driver: "ghostty" | "iterm2",
 *   serviceFactory?: typeof createTerminalHostService,
 *   baseEnv?: NodeJS.ProcessEnv,
 *   terminalHostService?: {
 *     listSessions: () => Promise<ReadonlyArray<{ sessionId: string, ownedByRos?: boolean }>>,
 *     closeSession: (sessionId: string) => Promise<void>,
 *   },
 *   now?: () => number,
 *   closeTimeoutMs?: number,
 * }} options
 */
export function createTerminalRuntimeFactory(options) {
  if (!options || typeof options !== "object") {
    throw new TypeError("createTerminalRuntimeFactory requires an options object");
  }
  const { driver } = options;
  if (!KNOWN_DRIVERS.has(driver)) {
    throw new TypeError(`createTerminalRuntimeFactory: driver must be 'ghostty' or 'iterm2' (got ${JSON.stringify(driver)})`);
  }
  const serviceFactory = options.serviceFactory ?? createTerminalHostService;
  const baseEnv = options.baseEnv ?? {};
  const terminalHostService = options.terminalHostService ?? null;
  const now = options.now ?? (() => Date.now());
  const closeTimeoutMs = options.closeTimeoutMs ?? 2_000;
  const factoryId = factoryIdForDriver(driver);

  /**
   * Per-add-on service instance. The factory owns the lifecycle of one
   * terminal service per `addonId`; the reconciler passes the handle
   * back into stop / health / degrade / closeSessions.
   */
  const perAddon = new Map();

  return {
    spawnPolicy: {
      factoryId,
      supportedRuntimeTypes: ["local-service"],
      spawnSummary: SPAWN_SUMMARY[driver],
    },
    async start({ addonId }) {
      // Find or create the per-add-on service. The factory id is fixed;
      // the driver is fixed; the env is host-pinned.
      const driverForAddon = driverForAddonId(addonId);
      if (!driverForAddon || driverForAddon !== driver) {
        throw new Error(`Terminal factory ${factoryId} cannot start addon ${JSON.stringify(addonId)} (driver mismatch)`);
      }
      const pinnedEnv = buildPinnedEnv({ driver, baseEnv });
      const service = serviceFactory({ env: pinnedEnv, addonId });
      const started = await service.start();
      const handle = {
        factoryId,
        addonId,
        driveId: started.driveId,
        adapterId: started.adapterId,
        bus: started.bus,
        service,
        startedAt: now(),
        ownedByRos: true,
      };
      perAddon.set(addonId, handle);
      return handle;
    },
    async stop(handle, { addonId, timeoutMs = closeTimeoutMs }) {
      const instance = perAddon.get(addonId) ?? handle;
      if (!instance || !instance.service) return;
      // CP-BR7 §5.3 / §5.7: close ROS-owned sessions before stopping.
      // The no-confirm Ghostty teardown is preserved (close never throws).
      await closeServiceSessions(instance.service, {
        addonId,
        now,
        terminalHostService,
      }).catch(() => undefined);
      try {
        await Promise.race([
          instance.service.stop(),
          new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
        ]);
      } finally {
        perAddon.delete(addonId);
      }
    },
    async health(handle, { addonId, timeoutMs = 1_500 }) {
      const instance = perAddon.get(addonId) ?? handle;
      if (!instance || !instance.service) {
        return { ok: false, publicDetail: "terminal-not-running" };
      }
      try {
        const snap = instance.service.status();
        return { ok: snap?.alive === true, publicDetail: snap?.driveId ?? driver };
      } catch {
        return { ok: false, publicDetail: "terminal-health-error" };
      }
    },
    async degrade(handle, { addonId, publicReason }) {
      const instance = perAddon.get(addonId) ?? handle;
      if (!instance) {
        // Even when the live service is gone, surface a degraded handle
        // so the reconciler can record the transition.
        return { factoryId, addonId, degraded: true, publicReason };
      }
      return { ...instance, degraded: true, publicReason };
    },
    async closeSessions(handle, { addonId }) {
      const instance = perAddon.get(addonId) ?? handle;
      if (!instance) return;
      await closeServiceSessions(instance.service, {
        addonId,
        now,
        terminalHostService,
      }).catch(() => undefined);
    },
    __driver: driver,
    __perAddon: perAddon,
  };
}

// ---------------------------------------------------------------------------
// Registry seeding
// ---------------------------------------------------------------------------

/**
 * Seed the supplied registry with the two CP-BR7 reviewed terminal
 * factories (Ghostty + iTerm2). This replaces the CP-BR4 no-op seed
 * for `com.resonantos.factory.terminal-host-service`; the existing
 * `external-cli-terminal` and `pi-runtime` seeds are left untouched.
 *
 * The factories are registered under two new ids:
 *   - `com.resonantos.factory.terminal-host.ghostty`
 *   - `com.resonantos.factory.terminal-host.iterm2`
 *
 * The registry is expected to have been created by
 * `createRuntimeFactoryRegistry`. Existing entries are replaced
 * (idempotent).
 */
export function seedTerminalRuntimeFactories(registry, options = {}) {
  if (!registry || typeof registry.register !== "function") {
    throw new TypeError("seedTerminalRuntimeFactories requires a registry with .register()");
  }
  const serviceFactory = options.serviceFactory ?? null;
  const baseEnv = options.baseEnv ?? {};
  const terminalHostService = options.terminalHostService ?? null;
  const now = options.now ?? undefined;

  registry.register(
    createTerminalRuntimeFactory({
      driver: "ghostty",
      serviceFactory: serviceFactory ?? undefined,
      baseEnv,
      terminalHostService,
      now,
    }),
    { replace: true },
  );
  registry.register(
    createTerminalRuntimeFactory({
      driver: "iterm2",
      serviceFactory: serviceFactory ?? undefined,
      baseEnv,
      terminalHostService,
      now,
    }),
    { replace: true },
  );

  return {
    seeded: ["ghostty", "iterm2"],
    factoryIds: {
      ghostty: TERMINAL_FACTORY_IDS.ghostty,
      iterm2: TERMINAL_FACTORY_IDS.iterm2,
    },
  };
}

// ---------------------------------------------------------------------------
// Public exports for tests
// ---------------------------------------------------------------------------

export const __testing__ = {
  buildPinnedEnv,
  closeServiceSessions,
  driverForAddonId,
  factoryIdForDriver,
  KNOWN_DRIVERS,
};
