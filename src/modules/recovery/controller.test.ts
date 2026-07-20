import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultState } from "../../core/defaults";
import type { RecoveryRouteCandidate } from "../../core/contracts";

const createEngineerThreadMock = vi.fn((state) => state);

vi.mock("../../core/chat", () => ({
  createEngineerThread: createEngineerThreadMock,
}));

const noop = vi.fn();

describe("setRecoveryMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enables recovery mode, reconfigures the engineer agent, and logs entry", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: typeof state) => typeof state) => {
      state = updater(state);
    };

    const setChatNotice = vi.fn();
    const setAgentActivityLabel = vi.fn();
    const setSelectedChatModel = vi.fn();

    const { setRecoveryMode } = await import("./controller");
    setRecoveryMode(true, updateRuntimeState, setChatNotice, setAgentActivityLabel, setSelectedChatModel);

    expect(state.recoverySession.active).toBe(true);
    expect(state.recoverySession.lastNormalThreadId).toBe(state.uiPreferences.activeChatThreadId);
    expect(state.recoverySession.changeLog.some((entry) => entry.includes("Entered recovery mode"))).toBe(true);
    expect(state.recoverySession.checklist[0].status).toBe("active");
    expect(state.agents.find((a) => a.id === state.recoverySession.engineerAgentId)?.providerProfileId).toBe("shared-local");
    expect(createEngineerThreadMock).toHaveBeenCalled();
    expect(setChatNotice).toHaveBeenCalledWith(expect.stringContaining("Recovery mode active"));
    expect(setAgentActivityLabel).toHaveBeenCalledWith(expect.stringContaining("Awaiting recovery start"));
    expect(setSelectedChatModel).toHaveBeenCalledWith("");
  });

  it("disables recovery mode, restores the last normal thread, and logs exit", async () => {
    let state = buildDefaultState([]);
    state.recoverySession.active = true;
    state.recoverySession.lastNormalThreadId = "thread-previous";
    const updateRuntimeState = (updater: (current: typeof state) => typeof state) => {
      state = updater(state);
    };

    const { setRecoveryMode } = await import("./controller");
    setRecoveryMode(false, updateRuntimeState, noop, noop, noop);

    expect(state.recoverySession.active).toBe(false);
    expect(state.uiPreferences.activeChatThreadId).toBe("thread-previous");
    expect(state.recoverySession.changeLog.some((entry) => entry.includes("Exited recovery mode"))).toBe(true);
  });
});

describe("promoteRecoveryRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes the engineer agent to the candidate route and updates the checklist", async () => {
    let state = buildDefaultState([]);
    state.recoverySession.active = true;
    const updateRuntimeState = (updater: (current: typeof state) => typeof state) => {
      state = updater(state);
    };

    const candidate: RecoveryRouteCandidate = {
      id: "candidate-1",
      providerId: "provider-openai",
      providerLabel: "OpenAI",
      runtimeNodeId: "node-openai",
      runtimeNodeLabel: "OpenAI Cloud",
      runtimeKind: "cloud",
      model: "gpt-4o",
      credentialConfigured: true,
      reachable: true,
      promotable: true,
      recommended: true,
      reason: "Primary cloud route is healthy",
    };

    const { promoteRecoveryRoute } = await import("./controller");
    promoteRecoveryRoute(candidate, updateRuntimeState, noop, noop, noop);

    const engineer = state.agents.find((a) => a.id === state.recoverySession.engineerAgentId);
    expect(engineer?.providerProfileId).toBe("provider-openai");
    expect(engineer?.fallbackProviderProfileId).toBe("shared-local");
    expect(state.recoverySession.changeLog.some((entry) => entry.includes("promote_route"))).toBe(true);
    expect(state.recoverySession.checklist.find((s) => s.id === "better-brain")?.status).toBe("complete");
    expect(state.recoverySession.checklist.find((s) => s.id === "promote")?.status).toBe("complete");
  });

  it("activates deep-diagnosis when promote is complete and deep-diagnosis is pending", async () => {
    let state = buildDefaultState([]);
    state.recoverySession.active = true;
    const deepStep = state.recoverySession.checklist.find((s) => s.id === "deep-diagnosis");
    if (deepStep) deepStep.status = "pending";

    const updateRuntimeState = (updater: (current: typeof state) => typeof state) => {
      state = updater(state);
    };

    const candidate: RecoveryRouteCandidate = {
      id: "candidate-2",
      providerId: "provider-local",
      providerLabel: "Local",
      runtimeNodeId: "node-local",
      runtimeNodeLabel: "Local Runtime",
      runtimeKind: "local",
      model: "gemma-4-26b",
      credentialConfigured: true,
      reachable: true,
      promotable: true,
      recommended: true,
      reason: "Local recovery route",
    };

    const { promoteRecoveryRoute } = await import("./controller");
    promoteRecoveryRoute(candidate, updateRuntimeState, noop, noop, noop);

    expect(state.recoverySession.checklist.find((s) => s.id === "deep-diagnosis")?.status).toBe("active");
  });
});
