import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultState } from "../../core/defaults";
import type { ResonantShellState } from "../../core/contracts";

const createStrategistThreadMock = vi.fn((state, _input) => state);

vi.mock("../../core/chat", () => ({
  createStrategistThread: createStrategistThreadMock,
}));

describe("renameStrategistIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the custom name and updates the strategist agent display name", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { renameStrategistIdentity } = await import("./controller");
    renameStrategistIdentity("Athena", updateRuntimeState);

    expect(state.strategistIdentity.customName).toBe("Athena");
    expect(state.agents.find((a) => a.id === "strategist.core")?.displayName).toBe("Athena");
  });

  it("resets to default display name when given an empty string", async () => {
    let state = buildDefaultState([]);
    state.strategistIdentity.customName = "Athena";
    const agent = state.agents.find((a) => a.id === "strategist.core");
    if (agent) agent.displayName = "Athena";
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { renameStrategistIdentity } = await import("./controller");
    renameStrategistIdentity("", updateRuntimeState);

    expect(state.strategistIdentity.customName).toBeUndefined();
    expect(state.agents.find((a) => a.id === "strategist.core")?.displayName).toBe(state.strategistIdentity.defaultName);
  });
});

describe("activateChatThread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets the active chat thread and resets composer, notice, and attachments", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };
    const setComposer = vi.fn();
    const setChatNotice = vi.fn();
    const setAttachments = vi.fn();

    const { activateChatThread } = await import("./controller");
    activateChatThread("thread-test", updateRuntimeState, setComposer, setChatNotice, setAttachments);

    expect(state.uiPreferences.activeChatThreadId).toBe("thread-test");
    expect(setComposer).toHaveBeenCalledWith("");
    expect(setChatNotice).toHaveBeenCalledWith(null);
    expect(setAttachments).toHaveBeenCalledWith([]);
  });
});

describe("createNewStrategistChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new strategist thread via createStrategistThread", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };
    const activeChannel = state.channels.find((c) => c.id === "desktop-main") ?? null;

    const { createNewStrategistChat } = await import("./controller");
    createNewStrategistChat({
      state,
      activeChannel,
      updateRuntimeState,
      setComposer: vi.fn(),
      setAttachments: vi.fn(),
      setChatNotice: vi.fn(),
    });

    expect(createStrategistThreadMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ channelId: "desktop-main" }),
    );
  });

  it("returns early when recovery mode is active", async () => {
    const state = buildDefaultState([]);
    state.recoverySession.active = true;

    const { createNewStrategistChat } = await import("./controller");
    createNewStrategistChat({
      state,
      activeChannel: null,
      updateRuntimeState: vi.fn(),
      setComposer: vi.fn(),
      setAttachments: vi.fn(),
      setChatNotice: vi.fn(),
    });

    expect(createStrategistThreadMock).not.toHaveBeenCalled();
  });
});

describe("toggleStrategistChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles a channel from enabled to disabled", async () => {
    let state = buildDefaultState([]);
    const channel = state.channels.find((c) => c.id === "desktop-main")!;
    channel.enabled = true;
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { toggleStrategistChannel } = await import("./controller");
    toggleStrategistChannel("desktop-main", updateRuntimeState);

    expect(channel.enabled).toBe(false);
  });

  it("toggles a channel from disabled to enabled", async () => {
    let state = buildDefaultState([]);
    const channel = state.channels.find((c) => c.id === "desktop-main")!;
    channel.enabled = false;
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { toggleStrategistChannel } = await import("./controller");
    toggleStrategistChannel("desktop-main", updateRuntimeState);

    expect(channel.enabled).toBe(true);
  });
});
