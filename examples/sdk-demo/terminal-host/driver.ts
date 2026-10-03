// ResonantOS terminal-host driver selector (Phase 1.5 Step A / TH-7b).
//
// `RESONANT_TERMINAL_DRIVER` chooses which terminal host implementation
// Phase 2's lifecycle test and the replaceability proof drive. The selector
// is the single switch consumed by:
//   - examples/sdk-demo/tests/terminal-host-live.test.ts (Phase 2)
//   - examples/sdk-demo/tests/terminal-host-replaceability.test.ts (Phase 2)
//   - browser-first/host/terminal-host-service.mjs (Phase 1.5 Step B)
//
// Allowed values: 'in-memory' (default), 'iterm2', 'ghostty'. Unknown
// values throw at import time so a misconfigured CI run fails before
// any test code runs.

import type {
  ProvenanceFidelity,
  RosTerminalSession,
  RosTerminalSessionState,
  TerminalHostAdapterContract,
  TerminalSessionEntryMode,
  TerminalTelemetryEvent,
} from "../../../src/core/terminal-host-contract";

export type TerminalDriverId = "in-memory" | "iterm2" | "ghostty";

const ALLOWED_DRIVERS: Record<TerminalDriverId, true> = {
  "in-memory": true,
  iterm2: true,
  ghostty: true,
};

const DEFAULT_DRIVER: TerminalDriverId = "in-memory";

export class TerminalDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalDriverError";
  }
}

function isAllowed(value: string): value is TerminalDriverId {
  return Object.hasOwn(ALLOWED_DRIVERS, value);
}

/**
 * Resolve the active driver id from `process.env.RESONANT_TERMINAL_DRIVER`.
 * Default: "in-memory" (CI without iTerm2/Ghostty stays green). Unknown
 * values throw a `TerminalDriverError` so the failure is loud and early.
 */
export function resolveTerminalDriver(env: NodeJS.ProcessEnv = process.env): TerminalDriverId {
  const raw = env.RESONANT_TERMINAL_DRIVER;
  if (raw === undefined || raw === "") return DEFAULT_DRIVER;
  if (isAllowed(raw)) return raw;
  throw new TerminalDriverError(
    `RESONANT_TERMINAL_DRIVER must be one of: in-memory, iterm2, ghostty. Got: ${JSON.stringify(raw)}`,
  );
}

/**
 * Uniform shape for both drivers. The in-memory implementation lives in
 * `./in-memory-host.ts` (createInMemoryTerminalHost). The iTerm2 driver
 * arrives in Phase 2 and is wired here.
 */
export interface TerminalHostDriver {
  readonly id: TerminalDriverId;
  readonly adapter: TerminalHostAdapterContract;
  onTelemetry(listener: (event: TerminalTelemetryEvent) => void): () => void;
  createSession(args: {
    id: string;
    entryMode: TerminalSessionEntryMode;
    provenanceFidelity: ProvenanceFidelity;
  }): RosTerminalSession;
  attach(id: string): RosTerminalSession;
  run(id: string): RosTerminalSession;
  detach(id: string, reason?: string): RosTerminalSession;
  terminate(id: string): RosTerminalSession;
  get(id: string): RosTerminalSession;
  list(): RosTerminalSession[];
  shutdown?(): Promise<void> | void;
}

export type DriverFactory = (id: TerminalDriverId) => TerminalHostDriver;

/**
 * Create a driver instance by id. Phase 2 lifecycle tests call this once in
 * `beforeAll` and `it.skip` when the driver is "in-memory" unless the test
 * opts in. The factory is supplied by the test (or by a runner) so the
 * `terminal-host-service.mjs` runtime doesn't have to live inside vitest.
 */
export function createDriver(id: TerminalDriverId, factory: DriverFactory): TerminalHostDriver {
  if (!isAllowed(id)) {
    throw new TerminalDriverError(`createDriver: unknown driver id ${JSON.stringify(id)}`);
  }
  return factory(id);
}

// Re-export the state-machine alias so Phase 2 tests don't have to import
// from src/core/terminal-host-contract directly.
export type { RosTerminalSessionState };
