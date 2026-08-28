import { describe, expect, it } from "vitest";
import type { AddOnManifest, ChannelDefinition, ConversationThread } from "../../core/contracts";
import { buildDefaultState } from "../../core/defaults";
import {
  buildShellViewModel,
  channelAllowedByOwningAddon,
  resolveActiveProviderForSelection,
  resolveSelectableChatModelsForSelection,
} from "./selectors";

describe("resolveActiveProviderForSelection", () => {
  it("returns undefined when state is null", () => {
    expect(resolveActiveProviderForSelection(null, "")).toBeUndefined();
  });

  it("returns shared-local provider for Hermes agent thread", () => {
    const state = buildDefaultState([]);
    const hermesThread = state.conversationThreads.find((t) => t.owningAgentId === "hermes.agent");
    if (!hermesThread) return;

    const provider = resolveActiveProviderForSelection(state, "", hermesThread.id);
    expect(provider?.id).toBe("shared-local");
  });
});

describe("channelAllowedByOwningAddon", () => {
  it("returns true when the channel has no owning addon", () => {
    const state = buildDefaultState([]);
    const channel: ChannelDefinition = {
      id: "desktop-main",
      type: "desktop",
      label: "Main",
      owningAgentId: "strategist.core",
      strategistIdentityId: "strategist.identity",
      enabled: true,
      sessionMode: "shared-identity",
      workspaceId: "ws-main",
      metadata: {},
    };
    expect(channelAllowedByOwningAddon(state, channel)).toBe(true);
  });

  it("returns false when the owning addon is disabled", () => {
    const state = buildDefaultState([]);
    state.installations["addon.companion"] = {
      addonId: "addon.companion",
      source: "bundled",
      provenanceTier: "curated-signed",
      verificationState: "verified",
      installed: true,
      enabled: false,
      status: "disabled",
      grantedCapabilities: [],
      recommendedGrantPresetIds: [],
      privateProviderProfileIds: [],
      notes: [],
    };
    const channel: ChannelDefinition = {
      id: "desktop-companion",
      type: "desktop",
      label: "Companion",
      owningAgentId: "addon.companion",
      strategistIdentityId: "strategist.identity",
      enabled: true,
      sessionMode: "isolated-session",
      workspaceId: "ws-companion",
      metadata: { addonId: "addon.companion" },
    };
    expect(channelAllowedByOwningAddon(state, channel)).toBe(false);
  });
});

describe("buildShellViewModel", () => {
  it("filters manifests by search query", () => {
    const state = buildDefaultState([]);
    const bundled: AddOnManifest[] = [
      {
        id: "addon.alpha",
        name: "Alpha Addon",
        version: "0.1.0",
        publisher: "local",
        author: "test",
        category: "tool",
        description: "UI tools",
        runtimeType: "ui-module",
        surfaces: [],
        requestedCapabilities: [],
        providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
        archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
        health: { strategy: "none" },
        installHooks: {},
        compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
      },
      {
        id: "addon.beta",
        name: "Beta Service",
        version: "0.1.0",
        publisher: "local",
        author: "test",
        category: "agent",
        description: "Background agent service",
        runtimeType: "local-service",
        surfaces: [],
        requestedCapabilities: [],
        providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
        archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
        health: { strategy: "none" },
        installHooks: {},
        compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
      },
    ];

    const withMatch = buildShellViewModel({
      state,
      bundled,
      sideloaded: [],
      deferredSearch: "alpha",
      selectedAddonId: "",
      composer: "",
      attachments: [],
      selectedChatModel: "",
    });
    expect(withMatch.filteredManifests).toHaveLength(1);
    expect(withMatch.filteredManifests[0].id).toBe("addon.alpha");
  });

  it("returns all manifests when search is empty", () => {
    const state = buildDefaultState([]);
    const bundled: AddOnManifest[] = [
      {
        id: "addon.one",
        name: "One",
        version: "0.1.0",
        publisher: "local",
        author: "test",
        category: "agent",
        description: "",
        runtimeType: "agent-addon",
        surfaces: [],
        requestedCapabilities: [],
        providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
        archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
        health: { strategy: "none" },
        installHooks: {},
        compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
      },
    ];

    const vm = buildShellViewModel({
      state,
      bundled,
      sideloaded: [],
      deferredSearch: "",
      selectedAddonId: "",
      composer: "",
      attachments: [],
      selectedChatModel: "",
    });
    expect(vm.filteredManifests).toHaveLength(1);
    expect(vm.allManifests).toHaveLength(1);
  });

  it("reports recovery mode active", () => {
    const state = buildDefaultState([]);
    state.recoverySession.active = true;

    const vm = buildShellViewModel({
      state,
      bundled: [],
      sideloaded: [],
      deferredSearch: "",
      selectedAddonId: "",
      composer: "",
      attachments: [],
      selectedChatModel: "",
    });

    expect(vm.recoveryModeActive).toBe(true);
    expect(vm.strategistRecoveryActive).toBe(true);
  });
});

describe("Hermes chat model selection", () => {
  it("uses Hermes' configured local model instead of the generic agent route", () => {
    const state = buildDefaultState([]);
    state.installations["addon.hermes"] = {
      ...state.installations["addon.hermes"],
      installed: true,
      enabled: true,
      status: "enabled",
      config: {
        ...(state.installations["addon.hermes"]?.config ?? {}),
        hermesModel: "gemma-4-26b-a4b-q4_k_m.gguf",
        hermesAvailableModels: ["gemma-4-26b-a4b-q4_k_m.gguf"],
      },
    };
    const hermesThread =
      state.conversationThreads.find((thread) => thread.owningAgentId === "hermes.agent") ??
      ({
        id: "thread-hermes-selector-test",
        title: "Hermes selector test",
        owningAgentId: "hermes.agent",
        workspaceId: "workspace-hermes",
        channelId: "desktop-hermes",
        summary: "",
        messages: [],
      } satisfies ConversationThread);
    state.conversationThreads = [hermesThread, ...state.conversationThreads.filter((thread) => thread.id !== hermesThread.id)];
    state.uiPreferences.activeChatThreadId = hermesThread.id;

    const selectable = resolveSelectableChatModelsForSelection(state, hermesThread.id);
    const viewModel = buildShellViewModel({
      state,
      bundled: [],
      sideloaded: [],
      deferredSearch: "",
      selectedAddonId: "",
      composer: "",
      attachments: [],
      selectedChatModel: "",
    });

    expect(selectable).toEqual(["gemma-4-26b-a4b-q4_k_m.gguf"]);
    expect(viewModel.activeChatModel).toBe("gemma-4-26b-a4b-q4_k_m.gguf");
  });
});
