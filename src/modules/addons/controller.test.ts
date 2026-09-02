import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AddOnHookDefinition,
  AddOnInstallation,
  AddOnManifest,
  AddOnScriptDefinition,
  CapabilityGrant,
  InstallationStatus,
  LogicianExecutionArtifact,
  ResonantShellState,
} from "../../core/contracts";
import { buildDefaultState } from "../../core/defaults";

const runtimeMocks = vi.hoisted(() => ({
  applyProviderCredentialStatuses: vi.fn((s: unknown) => s),
  hydrateState: vi.fn(),
  loadProviderCredentialStatuses: vi.fn(),
  sideloadManifest: vi.fn(),
}));

vi.mock("../../core/runtime", () => runtimeMocks);

const logicianMocks = vi.hoisted(() => ({
  executeLogicianHook: vi.fn(),
  executeLogicianScript: vi.fn(),
}));

vi.mock("../../core/logician", () => logicianMocks);
import {
  AddOnPermissionEscalationRequired,
  AddOnRegistryIdCollisionError,
  executeSideloadManifest,
  grantAddonCapabilities,
  runAddonLogicianHook,
  runAddonLogicianScript,
  toggleAddonCapabilityGrant,
  toggleAddonInstallation,
  updateAddonConfig,
} from "./controller";

const capability = (name: CapabilityGrant["capability"]): CapabilityGrant => ({
  capability: name,
  granted: false,
  scope: name === "archive-intake-write" ? "intake-only" : "shared",
  revocationBehavior: "hard-stop",
});

const createHermesManifest = (): AddOnManifest => ({
  id: "addon.hermes",
  name: "Hermes",
  version: "0.1.0",
  publisher: "local",
  author: "test",
  category: "agent",
  description: "Hermes manifest",
  runtimeType: "local-service",
  surfaces: [],
  requestedCapabilities: [
    capability("network"),
    capability("shell"),
    capability("ui-embedding"),
    capability("providers"),
    capability("archive-read"),
    capability("archive-intake-write"),
  ],
  providerRequirements: {
    sharedProfiles: [],
    supportsPrivateCredentials: false,
  },
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false,
  },
  health: {
    strategy: "none",
  },
  installHooks: {},
  compatibility: {
    shellVersion: "^0.1.0",
    platforms: ["macOS"],
  },
});

const createMinimalManifest = (id: string, name: string): AddOnManifest => ({
  id,
  name,
  version: "0.1.0",
  publisher: "local",
  author: "test",
  category: "tool",
  description: `${name} manifest`,
  runtimeType: "ui-module",
  surfaces: [],
  requestedCapabilities: [],
  providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
  archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
  health: { strategy: "none" },
  installHooks: {},
  compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
});

const createMinimalInstallation = (addonId: string, installed: boolean, enabled: boolean, status: InstallationStatus): AddOnInstallation => ({
  addonId,
  source: "bundled",
  provenanceTier: "curated-signed",
  verificationState: "verified",
  installed,
  enabled,
  status,
  grantedCapabilities: [],
  recommendedGrantPresetIds: [],
  privateProviderProfileIds: [],
  notes: [],
});

describe("toggleAddonInstallation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("installs a previously uninstalled addon", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = createMinimalInstallation("addon.test", false, false, "available");

    toggleAddonInstallation(manifest, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].installed).toBe(true);
    expect(state.installations["addon.test"].enabled).toBe(true);
    expect(state.installations["addon.test"].status).toBe("enabled");
  });

  it("disables an enabled addon", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = createMinimalInstallation("addon.test", true, true, "enabled");

    toggleAddonInstallation(manifest, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].enabled).toBe(false);
    expect(state.installations["addon.test"].status).toBe("disabled");
  });

  it("re-enables a disabled addon", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = createMinimalInstallation("addon.test", true, false, "disabled");

    toggleAddonInstallation(manifest, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].enabled).toBe(true);
    expect(state.installations["addon.test"].status).toBe("enabled");
  });

  it("toggles the hermes channel when toggling hermes addon", () => {
    const manifest = createHermesManifest();
    let state = buildDefaultState([manifest]);
    state.channels.find((c) => c.id === "desktop-hermes")!.enabled = true;
    state.installations["addon.hermes"] = {
      ...state.installations["addon.hermes"],
      installed: true,
      enabled: true,
      status: "enabled",
    };

    toggleAddonInstallation(manifest, (updater) => {
      state = updater(state);
    });

    expect(state.channels.find((c) => c.id === "desktop-hermes")?.enabled).toBe(false);
  });

  it("silently returns when installation is missing from state", () => {
    const manifest = createMinimalManifest("addon.missing", "Missing");
    let state = buildDefaultState([]);

    toggleAddonInstallation(manifest, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.missing"]).toBeUndefined();
  });
});

describe("toggleAddonCapabilityGrant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles a capability grant from false to true", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = {
      ...createMinimalInstallation("addon.test", true, true, "enabled"),
      grantedCapabilities: [
        { capability: "network", granted: false, scope: "shared", revocationBehavior: "hard-stop" },
      ],
    };

    toggleAddonCapabilityGrant("addon.test", "network", (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].grantedCapabilities[0].granted).toBe(true);
  });

  it("toggles a capability grant from true to false", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = {
      ...createMinimalInstallation("addon.test", true, true, "enabled"),
      grantedCapabilities: [
        { capability: "network", granted: true, scope: "shared", revocationBehavior: "hard-stop" },
      ],
    };

    toggleAddonCapabilityGrant("addon.test", "network", (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].grantedCapabilities[0].granted).toBe(false);
  });

  it("silently returns when the addon installation is missing", () => {
    let state = buildDefaultState([]);

    toggleAddonCapabilityGrant("addon.nonexistent", "network", (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.nonexistent"]).toBeUndefined();
  });
});

describe("grantAddonCapabilities", () => {
  it("only grants the requested Hermes workspace capabilities", () => {
    const hermesManifest = createHermesManifest();
    let state = buildDefaultState([hermesManifest]);

    grantAddonCapabilities("addon.hermes", ["shell", "ui-embedding"], hermesManifest.requestedCapabilities, (updater) => {
      state = updater(state);
    });

    const granted = new Set(
      state.installations["addon.hermes"].grantedCapabilities
        .filter((grant) => grant.granted)
        .map((grant) => grant.capability),
    );

    expect(granted).toEqual(new Set(["shell", "ui-embedding"]));
    expect(state.channels.find((channel) => channel.id === "desktop-hermes")?.enabled).toBe(true);
  });

  it("merges missing requested capabilities into existing grants", () => {
    const hermesManifest = createHermesManifest();
    let state = buildDefaultState([hermesManifest]);
    state.installations["addon.hermes"].grantedCapabilities = [];

    grantAddonCapabilities("addon.hermes", ["shell"], hermesManifest.requestedCapabilities, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.hermes"].grantedCapabilities.length).toBeGreaterThanOrEqual(
      hermesManifest.requestedCapabilities.length,
    );
    expect(state.installations["addon.hermes"].grantedCapabilities.find((g) => g.capability === "shell")?.granted).toBe(true);
  });
});

describe("updateAddonConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges config into an existing installation", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);

    updateAddonConfig("addon.test", { apiKey: "sk-123" }, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].config).toEqual({ apiKey: "sk-123" });
  });

  it("merges additional keys into existing config", () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"].config = { existingKey: "value" };

    updateAddonConfig("addon.test", { newKey: "newValue" }, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].config).toEqual({
      existingKey: "value",
      newKey: "newValue",
    });
  });

  it("silently returns when installation is missing", () => {
    let state = buildDefaultState([]);

    updateAddonConfig("addon.missing", { key: "val" }, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.missing"]).toBeUndefined();
  });
});

describe("runAddonLogicianScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a logician script and appends the verification artifact", async () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    const installation = createMinimalInstallation("addon.test", true, true, "enabled");
    const script: AddOnScriptDefinition = {
      id: "script-test",
      name: "Test Script",
      description: "A test script",
      commandRef: "scripts/test.sh",
      runPolicy: "on-demand",
      deterministic: true,
      requiredCapabilities: [],
      producesArtifacts: [],
      requiresHumanApproval: false,
    };
    const artifact: LogicianExecutionArtifact = {
      id: "artifact-1",
      addonId: "addon.test",
      kind: "script",
      targetId: "script-test",
      label: "Test Script",
      commandRef: "scripts/test.sh",
      status: "passed",
      summary: "Script passed",
      detail: "",
      requiredCapabilities: [],
      missingCapabilities: [],
      producedArtifacts: [],
      startedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:00:01.000Z",
      durationMs: 1000,
      evidence: {},
    };
    logicianMocks.executeLogicianScript.mockResolvedValue(artifact);
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = {
      ...state.installations["addon.test"],
      installed: true,
      enabled: true,
      status: "enabled",
    };

    const result = await runAddonLogicianScript(manifest, installation, script, (updater) => {
      state = updater(state);
    });

    expect(logicianMocks.executeLogicianScript).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, installation, script, humanInitiated: true }),
    );
    expect(result).toEqual(artifact);
    expect(state.installations["addon.test"].status).toBe("enabled");
  });

  it("sets installation status to degraded when script fails", async () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    const installation = createMinimalInstallation("addon.test", true, true, "enabled");
    const script: AddOnScriptDefinition = {
      id: "script-fail",
      name: "Fail Script",
      description: "A failing script",
      commandRef: "scripts/fail.sh",
      runPolicy: "on-demand",
      deterministic: true,
      requiredCapabilities: [],
      producesArtifacts: [],
      requiresHumanApproval: false,
    };
    const artifact: LogicianExecutionArtifact = {
      id: "artifact-fail",
      addonId: "addon.test",
      kind: "script",
      targetId: "script-fail",
      label: "Fail Script",
      commandRef: "scripts/fail.sh",
      status: "failed",
      summary: "Script failed",
      detail: "exit code 1",
      requiredCapabilities: [],
      missingCapabilities: [],
      producedArtifacts: [],
      startedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:00:01.000Z",
      durationMs: 500,
      evidence: {},
    };
    logicianMocks.executeLogicianScript.mockResolvedValue(artifact);
    let state = buildDefaultState([manifest]);
    state.installations["addon.test"] = {
      ...state.installations["addon.test"],
      installed: true,
      enabled: true,
      status: "enabled",
    };

    await runAddonLogicianScript(manifest, installation, script, (updater) => {
      state = updater(state);
    });

    expect(state.installations["addon.test"].status).toBe("degraded");
  });
});

describe("runAddonLogicianHook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes a logician hook and appends the verification artifact", async () => {
    const manifest = createMinimalManifest("addon.test", "Test Addon");
    const installation = createMinimalInstallation("addon.test", true, true, "enabled");
    const hook: AddOnHookDefinition = {
      id: "hook-test",
      event: "after-install",
      handlerRef: "hooks/after-install.sh",
      requiredCapabilities: [],
      failurePolicy: "warn",
    };
    const artifact: LogicianExecutionArtifact = {
      id: "artifact-hook",
      addonId: "addon.test",
      kind: "hook",
      targetId: "hook-test",
      label: "Test Hook",
      commandRef: "hooks/post-install.sh",
      status: "passed",
      summary: "Hook passed",
      detail: "",
      requiredCapabilities: [],
      missingCapabilities: [],
      producedArtifacts: [],
      startedAt: "2026-07-20T00:00:00.000Z",
      completedAt: "2026-07-20T00:00:01.000Z",
      durationMs: 200,
      evidence: {},
    };
    logicianMocks.executeLogicianHook.mockResolvedValue(artifact);
    let state = buildDefaultState([manifest]);

    const result = await runAddonLogicianHook(manifest, installation, hook, (updater) => {
      state = updater(state);
    });

    expect(logicianMocks.executeLogicianHook).toHaveBeenCalledWith(
      expect.objectContaining({ manifest, installation, hook, humanInitiated: true }),
    );
    expect(result).toEqual(artifact);
  });
});

describe("executeSideloadManifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when sideload path is empty", async () => {
    const setReadyState = vi.fn();
    const setSelectedAddonId = vi.fn();
    const setSideloadPath = vi.fn();
    const setErrorState = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "",
      bundled: [],
      sideloaded: [],
      setReadyState,
      setSelectedAddonId,
      setSideloadPath,
      setErrorState,
      errorMessageOf: (_e, fallback) => fallback,
    });

    expect(runtimeMocks.sideloadManifest).not.toHaveBeenCalled();
    expect(setReadyState).not.toHaveBeenCalled();
    expect(setSideloadPath).not.toHaveBeenCalled();
  });

  it("sideloads a manifest, hydrates state, and calls setters", async () => {
    const manifest = createMinimalManifest("addon.sideloaded", "Sideloaded");
    runtimeMocks.sideloadManifest.mockResolvedValue(manifest);
    runtimeMocks.hydrateState.mockResolvedValue(buildDefaultState([manifest]));
    runtimeMocks.loadProviderCredentialStatuses.mockResolvedValue([]);

    const setReadyState = vi.fn();
    const setSelectedAddonId = vi.fn();
    const setSideloadPath = vi.fn();
    const setErrorState = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/addon.json",
      bundled: [],
      sideloaded: [],
      setReadyState,
      setSelectedAddonId,
      setSideloadPath,
      setErrorState,
      errorMessageOf: (_e, fallback) => fallback,
    });

    expect(runtimeMocks.sideloadManifest).toHaveBeenCalledWith("/path/to/addon.json");
    expect(runtimeMocks.hydrateState).toHaveBeenCalled();
    expect(runtimeMocks.loadProviderCredentialStatuses).toHaveBeenCalled();
    expect(runtimeMocks.applyProviderCredentialStatuses).toHaveBeenCalled();
    expect(setReadyState).toHaveBeenCalled();
    expect(setSelectedAddonId).toHaveBeenCalledWith("addon.sideloaded");
    expect(setSideloadPath).toHaveBeenCalledWith("");
    expect(setErrorState).not.toHaveBeenCalled();
  });

  it("calls setErrorState on failure", async () => {
    runtimeMocks.sideloadManifest.mockRejectedValue(new Error("invalid manifest"));

    const setErrorState = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/bad.json",
      bundled: [],
      sideloaded: [],
      setReadyState: vi.fn(),
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState,
      errorMessageOf: (_e, fallback) => fallback,
    });

    expect(setErrorState).toHaveBeenCalledWith("Failed to sideload manifest.");
  });

  // CP-7.5.4 (Cross-manifest id-collision detection).
  it("rejects a sideload that collides with a bundled entry when forceOverride is false", async () => {
    const bundled = [createHermesManifest()]; // addon.hermes / local
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    const setReadyState = vi.fn();
    // Mirror the real App.tsx errorMessageOf so the underlying error.message
    // is preserved (not just the fallback).
    const errorMessageOf = (e: unknown, fallback: string) =>
      e instanceof Error ? e.message : fallback;

    let captured: unknown = null;
    try {
      await executeSideloadManifest({
        sideloadPath: "/path/to/hermes.json",
        bundled,
        sideloaded: [],
        setReadyState,
        setSelectedAddonId: vi.fn(),
        setSideloadPath: vi.fn(),
        setErrorState,
        errorMessageOf,
      });
    } catch (error) {
      captured = error;
    }

    expect(setReadyState).not.toHaveBeenCalled();
    // CP-7.5.4 follow-on: typed error must escape so App.tsx can
    // catch it and surface the §7.5.4 install-conflict prompt.
    expect(captured).toBeInstanceOf(AddOnRegistryIdCollisionError);
    const collision = captured as AddOnRegistryIdCollisionError;
    expect(collision.collidingAddonKey).toBe("addon.hermes@local");
    expect(collision.catalog).toBe("bundled");
    expect(collision.message).toContain("addon.hermes@local");
    expect(collision.message).toContain("bundled catalog");
    expect(collision.message).toContain("forceOverride=true");
    expect(setErrorState).not.toHaveBeenCalled();
  });

  it("accepts a sideload that collides with a bundled entry when forceOverride is true", async () => {
    const bundled = [createHermesManifest()];
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    const setReadyState = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/hermes.json",
      bundled,
      sideloaded: [],
      setReadyState,
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState,
      errorMessageOf: (_e, fallback) => fallback,
      forceOverride: true,
    });

    expect(setErrorState).not.toHaveBeenCalled();
    expect(setReadyState).toHaveBeenCalled();
  });

  it("rejects a sideload that collides with an existing sideloaded entry", async () => {
    const existing = createHermesManifest();
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    const setReadyState = vi.fn();
    const errorMessageOf = (e: unknown, fallback: string) =>
      e instanceof Error ? e.message : fallback;

    let captured: unknown = null;
    try {
      await executeSideloadManifest({
        sideloadPath: "/path/to/hermes.json",
        bundled: [],
        sideloaded: [existing],
        setReadyState,
        setSelectedAddonId: vi.fn(),
        setSideloadPath: vi.fn(),
        setErrorState,
        errorMessageOf,
      });
    } catch (error) {
      captured = error;
    }

    expect(setReadyState).not.toHaveBeenCalled();
    expect(captured).toBeInstanceOf(AddOnRegistryIdCollisionError);
    const collision = captured as AddOnRegistryIdCollisionError;
    expect(collision.catalog).toBe("sideloaded");
    expect(collision.message).toContain("sideloaded catalog");
    expect(setErrorState).not.toHaveBeenCalled();
  });

  // CP-7.5.4 follow-on: the collision error must be a typed
  // AddOnRegistryIdCollisionError so the host UI (App.tsx) can
  // catch it and surface the §7.5.4 install-conflict prompt
  // (per ADR-039). The error message, addon key, existing
  // name + version, and catalog must be preserved on the typed
  // instance.
  it("throws AddOnRegistryIdCollisionError when a sideload collides with a bundled entry", async () => {
    const bundled = [createHermesManifest()]; // addon.hermes / local
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    let captured: unknown = null;
    try {
      await executeSideloadManifest({
        sideloadPath: "/path/to/hermes.json",
        bundled,
        sideloaded: [],
        setReadyState: vi.fn(),
        setSelectedAddonId: vi.fn(),
        setSideloadPath: vi.fn(),
        setErrorState,
        errorMessageOf: (e, fallback) => (e instanceof Error ? e.message : fallback),
      });
    } catch (error) {
      captured = error;
    }

    // The typed error must escape the controller (it is the contract
    // the host UI's `handleSideload` catch relies on). The flat
    // banner path (setErrorState) must NOT be triggered.
    expect(captured).toBeInstanceOf(AddOnRegistryIdCollisionError);
    const collision = captured as AddOnRegistryIdCollisionError;
    expect(collision.collidingAddonKey).toBe("addon.hermes@local");
    expect(collision.catalog).toBe("bundled");
    expect(collision.existingName).toBe("Hermes");
    expect(collision.existingVersion).toBe("0.1.0");
    expect(collision.message).toContain("addon.hermes@local");
    expect(collision.message).toContain("bundled catalog");
    expect(setErrorState).not.toHaveBeenCalled();
  });

  it("throws AddOnRegistryIdCollisionError when a sideload collides with an existing sideloaded entry", async () => {
    const existing = createHermesManifest();
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    let captured: unknown = null;
    try {
      await executeSideloadManifest({
        sideloadPath: "/path/to/hermes.json",
        bundled: [],
        sideloaded: [existing],
        setReadyState: vi.fn(),
        setSelectedAddonId: vi.fn(),
        setSideloadPath: vi.fn(),
        setErrorState,
        errorMessageOf: (e, fallback) => (e instanceof Error ? e.message : fallback),
      });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(AddOnRegistryIdCollisionError);
    const collision = captured as AddOnRegistryIdCollisionError;
    expect(collision.collidingAddonKey).toBe("addon.hermes@local");
    expect(collision.catalog).toBe("sideloaded");
    expect(setErrorState).not.toHaveBeenCalled();
  });

  // CP-7.5.5 (permission-diff wiring). The sideload path calls
  // applyPermissionDiffGate before hydrating state; a fresh install with
  // non-empty requestedCapabilities must surface a typed error so the
  // host UI can prompt per ADR-039.
  it("throws AddOnPermissionEscalationRequired when a fresh sideload introduces non-empty requestedCapabilities", async () => {
    // No existing sideloaded manifest with this id@publisher; sideloaded is
    // empty. The new manifest has non-empty requestedCapabilities — §7.5.5
    // treats a fresh install's capability set as a hard change that needs
    // human approval (per ADR-039).
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    const setReadyState = vi.fn();
    const errorMessageOf = (e: unknown, fallback: string) =>
      e instanceof Error ? e.message : fallback;

    let captured: unknown = null;
    try {
      await executeSideloadManifest({
        sideloadPath: "/path/to/hermes.json",
        bundled: [],
        sideloaded: [],
        setReadyState,
        setSelectedAddonId: vi.fn(),
        setSideloadPath: vi.fn(),
        setErrorState,
        errorMessageOf,
      });
    } catch (error) {
      captured = error;
    }

    // The typed error must escape the controller; the flat banner
    // path (setErrorState) must NOT be triggered.
    expect(captured).toBeInstanceOf(AddOnPermissionEscalationRequired);
    const escalation = captured as AddOnPermissionEscalationRequired;
    expect(escalation.hardChanges.length).toBeGreaterThan(0);
    expect(escalation.message).toContain("hard change");
    expect(setErrorState).not.toHaveBeenCalled();
    expect(setReadyState).not.toHaveBeenCalled();
  });

  it("accepts a fresh sideload with non-empty requestedCapabilities when forceOverride is set (the human-approved path)", async () => {
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const setErrorState = vi.fn();
    const setReadyState = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/hermes.json",
      bundled: [],
      sideloaded: [],
      setReadyState,
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState,
      errorMessageOf: (_e, fallback) => fallback,
      forceOverride: true,
    });

    expect(setErrorState).not.toHaveBeenCalled();
    expect(setReadyState).toHaveBeenCalled();
  });

  // CP-7.5.4 / §7.5.5 (ADR-039 audit-ledger, deferred piece). The
  // controller emits an `AddOnInstallAuditRecord` (minus id/createdAt)
  // on every successful install, tagged by which gate was bypassed.
  it("records a collision-shadow-approved audit row when forceOverride shadows a bundled entry", async () => {
    const bundled = [createHermesManifest()];
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const recordAddonInstallAudit = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/hermes.json",
      bundled,
      sideloaded: [],
      setReadyState: vi.fn(),
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState: vi.fn(),
      errorMessageOf: (_e, fallback) => fallback,
      forceOverride: true,
      recordAddonInstallAudit,
    });

    expect(recordAddonInstallAudit).toHaveBeenCalledTimes(1);
    expect(recordAddonInstallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        addonKey: "addon.hermes@local",
        outcome: "collision-shadow-approved",
        hardChangeCount: 0,
        existingName: "Hermes",
        existingVersion: "0.1.0",
        catalog: "bundled",
        incomingPath: "/path/to/hermes.json",
      }),
    );
  });

  it("records a permission-escalation-approved audit row when forceOverride bypasses the diff gate", async () => {
    runtimeMocks.sideloadManifest.mockResolvedValue(createHermesManifest());

    const recordAddonInstallAudit = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/hermes.json",
      bundled: [],
      sideloaded: [],
      setReadyState: vi.fn(),
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState: vi.fn(),
      errorMessageOf: (_e, fallback) => fallback,
      forceOverride: true,
      recordAddonInstallAudit,
    });

    expect(recordAddonInstallAudit).toHaveBeenCalledTimes(1);
    expect(recordAddonInstallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        addonKey: "addon.hermes@local",
        outcome: "permission-escalation-approved",
        hardChangeCount: 0,
        hardChangePaths: [],
      }),
    );
  });

  it("records an installed audit row for a plain sideload with no gate", async () => {
    const manifest = createMinimalManifest("addon.sideloaded", "Sideloaded");
    runtimeMocks.sideloadManifest.mockResolvedValue(manifest);
    runtimeMocks.hydrateState.mockResolvedValue(buildDefaultState([manifest]));
    runtimeMocks.loadProviderCredentialStatuses.mockResolvedValue([]);

    const recordAddonInstallAudit = vi.fn();

    await executeSideloadManifest({
      sideloadPath: "/path/to/addon.json",
      bundled: [],
      sideloaded: [],
      setReadyState: vi.fn(),
      setSelectedAddonId: vi.fn(),
      setSideloadPath: vi.fn(),
      setErrorState: vi.fn(),
      errorMessageOf: (_e, fallback) => fallback,
      recordAddonInstallAudit,
    });

    expect(recordAddonInstallAudit).toHaveBeenCalledTimes(1);
    expect(recordAddonInstallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        addonKey: "addon.sideloaded@local",
        outcome: "installed",
        hardChangeCount: 0,
        existingName: undefined,
        existingVersion: undefined,
      }),
    );
  });
});
