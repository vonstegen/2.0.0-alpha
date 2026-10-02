import { describe, expect, it } from "vitest";
import {
  TerminalDriverError,
  createDriver,
  resolveTerminalDriver,
  type TerminalDriverId,
  type TerminalHostDriver,
} from "../terminal-host/driver";

const baseAdapter = {
  adapterVersion: 1,
  transport: "local-ipc" as const,
  supportedOperations: ["createSession"] as const,
  capabilities: ["launch" as const],
  feedbackChannel: "event-stream" as const,
};

function fakeDriver(id: TerminalDriverId): TerminalHostDriver {
  return {
    id,
    adapter: { ...baseAdapter, adapterId: id },
    onTelemetry: () => () => {},
    createSession: () => {
      throw new Error("not implemented in fake");
    },
    attach: () => {
      throw new Error("not implemented in fake");
    },
    run: () => {
      throw new Error("not implemented in fake");
    },
    detach: () => {
      throw new Error("not implemented in fake");
    },
    terminate: () => {
      throw new Error("not implemented in fake");
    },
    get: () => {
      throw new Error("not implemented in fake");
    },
    list: () => [],
  };
}

describe("RESONANT_TERMINAL_DRIVER selector", () => {
  it("defaults to in-memory when the env var is unset or empty", () => {
    expect(resolveTerminalDriver({})).toBe("in-memory");
    expect(resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: "" })).toBe("in-memory");
    expect(resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: undefined })).toBe("in-memory");
  });

  it("accepts 'in-memory' and 'iterm2'", () => {
    expect(resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: "in-memory" })).toBe("in-memory");
    expect(resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: "iterm2" })).toBe("iterm2");
  });

  it("rejects unknown values with TerminalDriverError", () => {
    expect(() => resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: "ghostty" })).toThrow(
      TerminalDriverError,
    );
    expect(() => resolveTerminalDriver({ RESONANT_TERMINAL_DRIVER: "Ghostty" })).toThrow(
      /RESONANT_TERMINAL_DRIVER/,
    );
  });

  it("createDriver rejects unknown ids and passes allowed ids to the factory", () => {
    expect(() => createDriver("ghostty" as TerminalDriverId, fakeDriver)).toThrow(
      TerminalDriverError,
    );
    const inMemory = createDriver("in-memory", fakeDriver);
    expect(inMemory.id).toBe("in-memory");
    expect(inMemory.adapter.adapterId).toBe("in-memory");
    const iterm2 = createDriver("iterm2", fakeDriver);
    expect(iterm2.id).toBe("iterm2");
    expect(iterm2.adapter.adapterId).toBe("iterm2");
  });
});
