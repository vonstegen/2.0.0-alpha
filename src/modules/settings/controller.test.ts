import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultState } from "../../core/defaults";
import type { ResonantShellState } from "../../core/contracts";

const runtimeMocks = vi.hoisted(() => ({
  requestProviderDiagnostics: vi.fn(),
  saveProviderSecret: vi.fn(),
  requestProviderSmokeTest: vi.fn(),
  requestLivingArchiveMemoryServiceStatus: vi.fn(),
  requestLivingArchiveMemoryServiceStart: vi.fn(),
  requestLivingArchiveMemoryServiceStop: vi.fn(),
  requestProviderSetupProbe: vi.fn(),
}));

vi.mock("../../core/runtime", () => runtimeMocks);

const findProviderTemplateMock = vi.fn();
vi.mock("./provider-templates", () => ({
  findProviderTemplate: (...args: unknown[]) => findProviderTemplateMock(...args),
}));

const updateWorkloadStrategyMock = vi.fn();
const routeFromOptionKeyMock = vi.fn();
vi.mock("../../core/model-strategy", () => ({
  updateWorkloadStrategy: (...args: unknown[]) => updateWorkloadStrategyMock(...args),
  routeFromOptionKey: (...args: unknown[]) => routeFromOptionKeyMock(...args),
}));

const applyProviderDiagnosticsMock = vi.fn((state, _reports) => state);
vi.mock("../../core/policies", () => ({
  applyProviderDiagnostics: applyProviderDiagnosticsMock,
}));

const errorMessageOf = (_error: unknown, fallback: string) => fallback;

describe("updateProviderProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the primary model of a provider", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { updateProviderProfile } = await import("./controller");
    const profileId = state.providers[0].id;
    updateProviderProfile(profileId, "primaryModel", "gpt-5", updateRuntimeState);

    expect(state.providers.find((p) => p.id === profileId)?.primaryModel).toBe("gpt-5");
  });

  it("updates the status of a provider", async () => {
    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { updateProviderProfile } = await import("./controller");
    const profileId = state.providers[0].id;
    updateProviderProfile(profileId, "status", "error", updateRuntimeState);

    expect(state.providers.find((p) => p.id === profileId)?.status).toBe("error");
  });
});

describe("updateModelWorkloadStrategyRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls routeFromOptionKey and updateWorkloadStrategy when a route is found", async () => {
    const route = { providerProfileId: "provider-test", model: "gpt-4o" };
    routeFromOptionKeyMock.mockReturnValue(route);

    let state = buildDefaultState([]);
    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      state = updater(state);
    };

    const { updateModelWorkloadStrategyRoute } = await import("./controller");
    updateModelWorkloadStrategyRoute("strategy-test", "option-key", updateRuntimeState);

    expect(routeFromOptionKeyMock).toHaveBeenCalledWith(expect.anything(), "option-key");
    expect(updateWorkloadStrategyMock).toHaveBeenCalled();
  });

  it("does nothing when routeFromOptionKey returns undefined", async () => {
    routeFromOptionKeyMock.mockReturnValue(undefined);

    const { updateModelWorkloadStrategyRoute } = await import("./controller");
    updateModelWorkloadStrategyRoute("strategy-test", "invalid-key", vi.fn());

    expect(updateWorkloadStrategyMock).not.toHaveBeenCalled();
  });
});

describe("executeRefreshProviderDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes diagnostics and commits state", async () => {
    const reports = [{ providerId: "p1", providerLabel: "Provider 1" }];
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue(reports);
    applyProviderDiagnosticsMock.mockImplementation((state) => state);

    const snapshot = {
      state: buildDefaultState([]),
      bundled: [],
      sideloaded: [],
    };
    const commitReadyState = vi.fn();
    const setProviderDiagnosticsBusy = vi.fn();
    const setActiveProviderProbeId = vi.fn();
    const setProviderDiagnostics = vi.fn();
    const setSettingsNotice = vi.fn();

    const { executeRefreshProviderDiagnostics } = await import("./controller");
    await executeRefreshProviderDiagnostics({
      snapshot,
      commitReadyState,
      updateRuntimeState: vi.fn(),
      setProviderDiagnosticsBusy,
      setActiveProviderProbeId,
      setProviderDiagnostics,
      setSettingsNotice,
      errorMessageOf,
    });

    expect(runtimeMocks.requestProviderDiagnostics).toHaveBeenCalled();
    expect(applyProviderDiagnosticsMock).toHaveBeenCalled();
    expect(commitReadyState).toHaveBeenCalled();
    expect(setProviderDiagnosticsBusy).toHaveBeenCalledWith(false);
  });

  it("handles errors gracefully", async () => {
    runtimeMocks.requestProviderDiagnostics.mockRejectedValue(new Error("network failure"));

    const snapshot = { state: buildDefaultState([]), bundled: [], sideloaded: [] };
    const setSettingsNotice = vi.fn();

    const { executeRefreshProviderDiagnostics } = await import("./controller");
    await executeRefreshProviderDiagnostics({
      snapshot,
      commitReadyState: vi.fn(),
      updateRuntimeState: vi.fn(),
      setProviderDiagnosticsBusy: vi.fn(),
      setActiveProviderProbeId: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Failed to probe provider diagnostics.");
  });
});

describe("executeProviderSmokeTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs a smoke test for an existing provider", async () => {
    const state = buildDefaultState([]);
    const providerId = state.providers[0].id;
    runtimeMocks.requestProviderSmokeTest.mockResolvedValue({ summary: "All good" });

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setProviderSmokeResults = vi.fn();

    const { executeProviderSmokeTest } = await import("./controller");
    await executeProviderSmokeTest({
      snapshot,
      providerId,
      setProviderSmokeBusyId: vi.fn(),
      setProviderSmokeResults,
      setSettingsNotice: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestProviderSmokeTest).toHaveBeenCalled();
    expect(setProviderSmokeResults).toHaveBeenCalled();
  });

  it("shows a notice when the provider is not found", async () => {
    const state = buildDefaultState([]);
    const snapshot = { state, bundled: [], sideloaded: [] };
    const setSettingsNotice = vi.fn();

    const { executeProviderSmokeTest } = await import("./controller");
    await executeProviderSmokeTest({
      snapshot,
      providerId: "nonexistent",
      setProviderSmokeBusyId: vi.fn(),
      setProviderSmokeResults: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Provider nonexistent was not found.");
    expect(runtimeMocks.requestProviderSmokeTest).not.toHaveBeenCalled();
  });
});

describe("executeRefreshMemoryServiceStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and sets the memory service status", async () => {
    const status = { status: "running", statusDetail: "Service is running" };
    runtimeMocks.requestLivingArchiveMemoryServiceStatus.mockResolvedValue(status);
    const setMemoryServiceStatus = vi.fn();
    const setSettingsNotice = vi.fn();

    const { executeRefreshMemoryServiceStatus } = await import("./controller");
    await executeRefreshMemoryServiceStatus({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus,
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setMemoryServiceStatus).toHaveBeenCalledWith(status);
    expect(setSettingsNotice).toHaveBeenCalledWith("Service is running");
  });
});

describe("executeSaveProviderSecret", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves a non-empty secret and sets credential status to configured", async () => {
    const state = buildDefaultState([]);
    const profileId = state.providers[0].id;
    runtimeMocks.saveProviderSecret.mockResolvedValue(undefined);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    applyProviderDiagnosticsMock.mockImplementation((s) => s);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const commitReadyState = vi.fn();
    const updateRuntimeState = vi.fn((updater) => {
      updater(snapshot.state);
    });
    const setProviderDrafts = vi.fn();
    const setSettingsNotice = vi.fn();

    const { executeSaveProviderSecret } = await import("./controller");
    await executeSaveProviderSecret({
      snapshot,
      profileId,
      secret: "sk-abc123",
      commitReadyState,
      updateRuntimeState,
      setProviderDrafts,
      setSettingsNotice,
      setProviderDiagnosticsBusy: vi.fn(),
      setActiveProviderProbeId: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.saveProviderSecret).toHaveBeenCalledWith(profileId, "sk-abc123");
    expect(commitReadyState).toHaveBeenCalled();
    expect(setProviderDrafts).toHaveBeenCalled();
    expect(setSettingsNotice).toHaveBeenCalledWith("Provider secret saved.");
  });

  it("saves an empty secret and sets credential status to missing", async () => {
    const state = buildDefaultState([]);
    const profileId = state.providers[0].id;
    runtimeMocks.saveProviderSecret.mockResolvedValue(undefined);
    runtimeMocks.requestProviderDiagnostics.mockResolvedValue([]);
    applyProviderDiagnosticsMock.mockImplementation((s) => s);

    const snapshot = { state, bundled: [], sideloaded: [] };
    const setSettingsNotice = vi.fn();

    const { executeSaveProviderSecret } = await import("./controller");
    await executeSaveProviderSecret({
      snapshot,
      profileId,
      secret: "",
      commitReadyState: vi.fn(),
      updateRuntimeState: vi.fn(),
      setProviderDrafts: vi.fn(),
      setSettingsNotice,
      setProviderDiagnosticsBusy: vi.fn(),
      setActiveProviderProbeId: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Provider secret cleared.");
  });

  it("reports error on failure", async () => {
    runtimeMocks.saveProviderSecret.mockRejectedValue(new Error("save error"));

    const snapshot = { state: buildDefaultState([]), bundled: [], sideloaded: [] };
    const setSettingsNotice = vi.fn();

    const { executeSaveProviderSecret } = await import("./controller");
    await executeSaveProviderSecret({
      snapshot,
      profileId: "provider-test",
      secret: "sk-abc",
      commitReadyState: vi.fn(),
      updateRuntimeState: vi.fn(),
      setProviderDrafts: vi.fn(),
      setSettingsNotice,
      setProviderDiagnosticsBusy: vi.fn(),
      setActiveProviderProbeId: vi.fn(),
      setProviderDiagnostics: vi.fn(),
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Failed to save provider secret.");
  });
});

describe("updateModelWorkloadStrategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to updateWorkloadStrategy via the state updater", async () => {
    const state = buildDefaultState([]);
    let captured: unknown;

    const updateRuntimeState = (updater: (current: ResonantShellState) => ResonantShellState) => {
      captured = updater(state);
    };

    const { updateModelWorkloadStrategy } = await import("./controller");
    updateModelWorkloadStrategy("strategy-test", { primaryRoute: { providerProfileId: "p1", model: "gpt-4o" } }, updateRuntimeState);

    expect(updateWorkloadStrategyMock).toHaveBeenCalledWith(
      state,
      "strategy-test",
      expect.objectContaining({ primaryRoute: { providerProfileId: "p1", model: "gpt-4o" } }),
    );
  });
});

describe("executeStartMemoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts the memory service and refreshes status", async () => {
    const startResult = {
      sessionId: "session-1",
      endpoint: "http://localhost:9090",
      alreadyRunning: false,
    };
    const status = { status: "running", statusDetail: "Service started" };
    runtimeMocks.requestLivingArchiveMemoryServiceStart.mockResolvedValue(startResult);
    runtimeMocks.requestLivingArchiveMemoryServiceStatus.mockResolvedValue(status);

    const { executeStartMemoryService } = await import("./controller");
    await executeStartMemoryService({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus: vi.fn(),
      setMemoryServiceLastResult: vi.fn(),
      setSettingsNotice: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestLivingArchiveMemoryServiceStart).toHaveBeenCalled();
  });

  it("shows already-running notice when service was already started", async () => {
    const startResult = {
      sessionId: "session-1",
      endpoint: "http://localhost:9090",
      alreadyRunning: true,
    };
    runtimeMocks.requestLivingArchiveMemoryServiceStart.mockResolvedValue(startResult);
    runtimeMocks.requestLivingArchiveMemoryServiceStatus.mockResolvedValue({});

    const setSettingsNotice = vi.fn();

    const { executeStartMemoryService } = await import("./controller");
    await executeStartMemoryService({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus: vi.fn(),
      setMemoryServiceLastResult: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith(expect.stringContaining("already running"));
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestLivingArchiveMemoryServiceStart.mockRejectedValue(new Error("start error"));
    const setSettingsNotice = vi.fn();

    const { executeStartMemoryService } = await import("./controller");
    await executeStartMemoryService({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus: vi.fn(),
      setMemoryServiceLastResult: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Failed to start Living Archive memory service.");
  });
});

describe("executeStopMemoryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stops the memory service and refreshes status", async () => {
    const stopResult = { sessionId: "session-1", endpoint: "http://localhost:9090" };
    runtimeMocks.requestLivingArchiveMemoryServiceStop.mockResolvedValue(stopResult);
    runtimeMocks.requestLivingArchiveMemoryServiceStatus.mockResolvedValue({});

    const { executeStopMemoryService } = await import("./controller");
    await executeStopMemoryService({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus: vi.fn(),
      setMemoryServiceLastResult: vi.fn(),
      setSettingsNotice: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestLivingArchiveMemoryServiceStop).toHaveBeenCalled();
  });

  it("reports error on failure", async () => {
    runtimeMocks.requestLivingArchiveMemoryServiceStop.mockRejectedValue(new Error("stop error"));
    const setSettingsNotice = vi.fn();

    const { executeStopMemoryService } = await import("./controller");
    await executeStopMemoryService({
      setMemoryServiceBusy: vi.fn(),
      setMemoryServiceStatus: vi.fn(),
      setMemoryServiceLastResult: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Failed to stop Living Archive memory service.");
  });
});

describe("executeCreateProviderProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when template is not found", async () => {
    findProviderTemplateMock.mockReturnValue(undefined);
    const setSettingsNotice = vi.fn();

    const { executeCreateProviderProfile } = await import("./controller");
    await executeCreateProviderProfile({
      templateId: "nonexistent",
      label: "Test",
      updateRuntimeState: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith("Provider template nonexistent was not found.");
  });

  it("returns early when template requires a base URL but none is provided", async () => {
    findProviderTemplateMock.mockReturnValue({
      id: "openai",
      label: "OpenAI",
      providerType: "openai",
      requiresBaseUrl: true,
      defaultApiBaseUrl: "",
      requiresSecret: true,
      authMethod: "api-key",
      authTier: "supported",
      allowedModels: ["gpt-4o"],
      primaryModel: "gpt-4o",
      fallbackModel: "gpt-4o-mini",
      modelContext: [],
      consumerScopes: ["chat"],
      initialStatus: "missing",
      credentialStatus: "missing",
      runtimeKind: "cloud",
      runtimeLocality: "remote",
      initialRuntimeHealthState: "unavailable",
      deployableOnDemand: false,
      executionState: "stopped",
      note: "Requires API key",
    });
    const setSettingsNotice = vi.fn();

    const { executeCreateProviderProfile } = await import("./controller");
    await executeCreateProviderProfile({
      templateId: "openai",
      label: "My OpenAI",
      updateRuntimeState: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith(expect.stringContaining("API base URL"));
  });

  it("returns early when template requires a secret but none is provided", async () => {
    findProviderTemplateMock.mockReturnValue({
      id: "openai",
      label: "OpenAI",
      providerType: "openai",
      requiresBaseUrl: true,
      defaultApiBaseUrl: "https://api.openai.com",
      requiresSecret: true,
      authMethod: "api-key",
      authTier: "supported",
      allowedModels: ["gpt-4o"],
      primaryModel: "gpt-4o",
      fallbackModel: "gpt-4o-mini",
      modelContext: [],
      consumerScopes: ["chat"],
      initialStatus: "missing",
      credentialStatus: "missing",
      runtimeKind: "cloud",
      runtimeLocality: "remote",
      initialRuntimeHealthState: "unavailable",
      deployableOnDemand: false,
      executionState: "stopped",
      note: "Requires API key",
    });
    const setSettingsNotice = vi.fn();

    const { executeCreateProviderProfile } = await import("./controller");
    await executeCreateProviderProfile({
      templateId: "openai",
      label: "My OpenAI",
      apiBaseUrl: "https://api.openai.com",
      updateRuntimeState: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith(expect.stringContaining("credential"));
  });

  it("creates a provider profile, runs setup probe, and updates state", async () => {
    findProviderTemplateMock.mockReturnValue({
      id: "ollama",
      label: "Ollama",
      providerType: "openai-compatible",
      requiresBaseUrl: false,
      defaultApiBaseUrl: "http://localhost:11434",
      requiresSecret: false,
      authMethod: "local-runtime",
      authTier: "supported",
      allowedModels: ["gemma-4-26b"],
      primaryModel: "gemma-4-26b",
      fallbackModel: "gemma-4-9b",
      modelContext: [],
      consumerScopes: ["chat"],
      initialStatus: "ready",
      credentialStatus: "configured",
      runtimeKind: "local",
      runtimeLocality: "device",
      initialRuntimeHealthState: "ready",
      deployableOnDemand: true,
      executionState: "started",
      note: "Local engine running",
    });
    const setupProbeResult = {
      discoveredModels: ["gemma-4-26b", "gemma-4-9b"],
      recommendedPrimaryModel: "gemma-4-26b",
      recommendedFallbackModel: "gemma-4-9b",
      endpoint: "http://localhost:11434",
      summary: "Probe succeeded",
      setupState: "routable-now",
      source: "openai-compatible-models",
      detail: "All good",
    };
    runtimeMocks.requestProviderSetupProbe.mockResolvedValue(setupProbeResult);

    const updateRuntimeState = vi.fn();
    const setSettingsNotice = vi.fn();

    const { executeCreateProviderProfile } = await import("./controller");
    await executeCreateProviderProfile({
      templateId: "ollama",
      label: "Local Ollama",
      updateRuntimeState,
      setSettingsNotice,
      errorMessageOf,
    });

    expect(runtimeMocks.requestProviderSetupProbe).toHaveBeenCalled();
    expect(updateRuntimeState).toHaveBeenCalled();
    expect(setSettingsNotice).toHaveBeenCalledWith(expect.stringContaining("was added"));
  });
});

describe("executeSetupProviderProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports error when provider is not found", async () => {
    const snapshot = { state: buildDefaultState([]), bundled: [], sideloaded: [] };
    const setSettingsNotice = vi.fn();

    const { executeSetupProviderProfile } = await import("./controller");
    await executeSetupProviderProfile({
      snapshot,
      profileId: "nonexistent",
      updateRuntimeState: vi.fn(),
      setSettingsNotice,
      errorMessageOf,
    });

    expect(setSettingsNotice).toHaveBeenCalledWith(expect.stringContaining("missing"));
  });

  it("re-runs the setup probe and updates provider and runtime node", async () => {
    const state = buildDefaultState([]);
    const provider = state.providers[0];
    const runtimeNode = state.runtimeNodes.find((n) => n.providerProfileId === provider.id);
    const snapshot = { state, bundled: [], sideloaded: [] };
    const setupProbeResult = {
      discoveredModels: ["gpt-4o", "gpt-4o-mini"],
      recommendedPrimaryModel: "gpt-4o",
      recommendedFallbackModel: "gpt-4o-mini",
      endpoint: "https://api.openai.com",
      summary: "Re-probe succeeded",
      setupState: "routable-now",
      source: "openai-compatible-models",
      detail: "All healthy",
    };
    runtimeMocks.requestProviderSetupProbe.mockResolvedValue(setupProbeResult);
    const updateRuntimeState = vi.fn();

    const { executeSetupProviderProfile } = await import("./controller");
    await executeSetupProviderProfile({
      snapshot,
      profileId: provider.id,
      updateRuntimeState,
      setSettingsNotice: vi.fn(),
      errorMessageOf,
    });

    expect(runtimeMocks.requestProviderSetupProbe).toHaveBeenCalled();
    expect(updateRuntimeState).toHaveBeenCalled();
  });
});
