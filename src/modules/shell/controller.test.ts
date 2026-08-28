// Intent citation: docs/architecture/ADR-002-modular-codebase.md

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AddOnManifest } from "../../core/contracts";
import { buildDefaultState } from "../../core/defaults";

const runtimeMocks = vi.hoisted(() => ({
  applyProviderCredentialStatuses: vi.fn((state) => state),
  hydrateState: vi.fn(),
  loadBundledManifests: vi.fn(),
  loadProviderCredentialStatuses: vi.fn(),
  loadSideloadedManifests: vi.fn(),
  requestLocalRuntimeStatus: vi.fn(),
  requestRecoveryRouteCandidates: vi.fn(),
}));

vi.mock("../../core/runtime", () => runtimeMocks);

describe("shell boot controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.loadBundledManifests.mockResolvedValue([]);
    runtimeMocks.loadSideloadedManifests.mockResolvedValue([]);
    runtimeMocks.loadProviderCredentialStatuses.mockResolvedValue([]);
  });

  it("preserves the persisted active workspace instead of forcing Home on boot", async () => {
    const state = buildDefaultState([]);
    state.uiPreferences.activeSection = "archive";
    runtimeMocks.hydrateState.mockResolvedValue(state);

    const { loadInitialShellState } = await import("./controller");
    const booted = await loadInitialShellState();

    expect(booted.state.uiPreferences.activeSection).toBe("archive");
  });

  it("loads recovery runtime snapshot with status and candidates", async () => {
    const state = buildDefaultState([]);
    const status = { recoveryModelRunning: true, modelVersion: "0.1.0" };
    const candidates = [{ providerId: "shared-local", providerLabel: "Local", runtimeNodeLabel: "Local Runtime", model: "gemma-4-26b" }];
    runtimeMocks.requestLocalRuntimeStatus.mockResolvedValue(status);
    runtimeMocks.requestRecoveryRouteCandidates.mockResolvedValue(candidates);

    const { loadRecoveryRuntimeSnapshot } = await import("./controller");
    const result = await loadRecoveryRuntimeSnapshot(state);

    expect(result.status).toEqual(status);
    expect(result.candidates).toEqual(candidates);
    expect(runtimeMocks.requestLocalRuntimeStatus).toHaveBeenCalledWith(
      state.providers.find((p) => p.id === "shared-local")?.primaryModel ?? "batiai/gemma4-e2b:q4",
    );
    expect(runtimeMocks.requestRecoveryRouteCandidates).toHaveBeenCalledTimes(1);
  });

  it("applies first-run recommended addons by enabling selected manifests", async () => {
    const manifests: AddOnManifest[] = [
      {
        id: "addon.augmentor-chat",
        name: "Augmentor Chat",
        version: "0.1.0",
        publisher: "local",
        author: "test",
        category: "agent",
        description: "Chat UI",
        runtimeType: "agent-addon",
        surfaces: [],
        requestedCapabilities: [],
        systemSlots: [{ id: "chat-interface", role: "default-provider", replaceable: true, recommended: true }],
        providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
        archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
        health: { strategy: "none" },
        installHooks: {},
        compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
      },
    ];
    const state = buildDefaultState(manifests);

    const { applyFirstRunRecommendedAddOns } = await import("./controller");
    const result = applyFirstRunRecommendedAddOns(state, manifests, ["addon.augmentor-chat"]);

    expect(result.uiPreferences.recommendedAddOnsReviewed).toBe(true);
    const installation = result.installations["addon.augmentor-chat"];
    expect(installation.installed).toBe(true);
    expect(installation.enabled).toBe(true);
    expect(installation.status).toBe("enabled");
  });

  it("skips non-recommended addons during first-run setup", async () => {
    const manifests: AddOnManifest[] = [
      {
        id: "custom-addon",
        name: "Custom",
        version: "0.1.0",
        publisher: "local",
        author: "test",
        category: "tool",
        description: "Custom Addon",
        runtimeType: "ui-module",
        surfaces: [],
        requestedCapabilities: [],
        providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
        archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
        health: { strategy: "none" },
        installHooks: {},
        compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
      },
    ];
    const state = buildDefaultState(manifests);

    const { applyFirstRunRecommendedAddOns } = await import("./controller");
    const result = applyFirstRunRecommendedAddOns(state, manifests, ["custom-addon"]);

    expect(result.uiPreferences.recommendedAddOnsReviewed).toBe(true);
    expect(result.installations["custom-addon"]?.installed).toBe(false);
  });

  it("marks recommended addons as reviewed", async () => {
    const state = buildDefaultState([]);
    const { markFirstRunRecommendedAddOnsReviewed } = await import("./controller");
    const result = markFirstRunRecommendedAddOnsReviewed(state);

    expect(result.uiPreferences.recommendedAddOnsReviewed).toBe(true);
    expect(result).not.toBe(state);
  });
});
