// ResonantOS terminal-host bridge wiring (Phase 1.5 Step B — integration).
//
// Extracted from run-bridge-minimal.mjs so the wire-up is unit-testable
// without spinning up the entire bridge. The bridge calls
// `installTerminalHostBridge({ env })` after `harnessService` is built
// and `uninstallTerminalHostBridge(handle)` on shutdown.
//
// Behavior:
//   - Default: no-op (no spawn, no globalThis mutation). Production
//     bridge runs are unchanged.
//   - RESONANT_TERMINAL_HOST_BRIDGE=1: construct the service via
//     createTerminalHostService, start it, expose the bus on
//     `globalThis.__rosTerminalHostBus__` and the service on
//     `globalThis.__rosTerminalHostService__`. The driver's
//     RESONANT_TERMINAL_DRIVER (in-memory | iterm2 | ghostty) selects
//     the implementation; each live driver spawns its adapter from
//     the adapter's own fixed directory.

import { createTerminalHostService } from "./terminal-host-service.mjs";

const GLOBAL_BUS_KEY = "__rosTerminalHostBus__";
const GLOBAL_SERVICE_KEY = "__rosTerminalHostService__";
const ENV_FLAG = "RESONANT_TERMINAL_HOST_BRIDGE";

/**
 * @param {{ env?: NodeJS.ProcessEnv, globalThis?: any, serviceFactory?: typeof createTerminalHostService, logger?: (event: object) => void }} [options]
 * @returns {Promise<{ enabled: boolean, service: ReturnType<typeof createTerminalHostService> | null, started: { adapterId: string, bus: unknown, driveId: string } | null }>}
 */
export async function installTerminalHostBridge(options = {}) {
  const env = options.env ?? process.env;
  const target = options.globalThis ?? globalThis;
  const factory = options.serviceFactory ?? createTerminalHostService;
  const logger = options.logger ?? ((event) => console.log(JSON.stringify(event)));
  if (env[ENV_FLAG] !== "1") return { enabled: false, service: null, started: null };
  const service = factory({ env });
  const started = await service.start();
  target[GLOBAL_BUS_KEY] = started.bus;
  target[GLOBAL_SERVICE_KEY] = service;
  logger({ event: "terminal_host.bridge_started", driveId: started.driveId, addonId: started.adapterId });
  return { enabled: true, service, started };
}

/**
 * @param {{ service?: ReturnType<typeof createTerminalHostService> | null, globalThis?: any }} options
 */
export async function uninstallTerminalHostBridge(options = {}) {
  const target = options.globalThis ?? globalThis;
  const service = options.service ?? target[GLOBAL_SERVICE_KEY] ?? null;
  if (service) {
    await service.stop().catch(() => undefined);
  }
  delete target[GLOBAL_BUS_KEY];
  delete target[GLOBAL_SERVICE_KEY];
}

export const __testing__ = { GLOBAL_BUS_KEY, GLOBAL_SERVICE_KEY, ENV_FLAG };
