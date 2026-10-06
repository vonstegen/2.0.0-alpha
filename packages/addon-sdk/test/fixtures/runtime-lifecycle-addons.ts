// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §4
// and CP-BR3. Deterministic fixture add-ons for the four families.
//
// These manifests are validated by the SDK validator in
// `runtime-lifecycle.test.ts` (req #15). They carry no secrets, no
// filesystem paths, no PIDs, and no env values.

import type { AddOnManifest } from "../../../../src/core/contracts";

const baseProviderRequirements = {
  sharedProfiles: [],
  supportsPrivateCredentials: false,
  recommendedPrimaryModel: undefined,
  recommendedFallbackModel: undefined,
  preferredRuntimeKinds: undefined,
  allowExperimentalAuth: false,
  fallbackPolicyId: undefined,
} as const;

const baseArchiveIntegration = {
  readScopes: [],
  intakeWriteScopes: [],
  canRequestIngest: false,
  canWriteKnowledgePages: false,
} as const;

const baseInstallHooks = {
  onInstall: undefined,
  onEnable: undefined,
  onUpgrade: undefined,
} as const;

const baseHealth = {
  strategy: "static",
} as const;

const baseCompatibility = {
  shellVersion: "2.0.0-alpha",
  platforms: ["darwin"],
} as const;

const baseSurfaces = [
  {
    id: "primary",
    type: "panel" as const,
    label: "Primary",
    description: "Primary surface for the CP-BR3 fixture add-on.",
    scope: "self" as const,
  },
];

/** A local-service add-on — requires a runtime process to function. */
export const localServiceAddon: AddOnManifest = {
  id: "addon.local-service-fixture",
  name: "Local Service Fixture",
  version: "0.1.0",
  author: "ResonantOS Fixtures",
  category: "tool",
  description: "Deterministic local-service fixture for CP-BR3.",
  runtimeType: "local-service",
  surfaces: baseSurfaces,
  requestedCapabilities: [
    {
      capability: "filesystem",
      scope: "self",
      revocationBehavior: "hard-stop",
      granted: false,
    },
  ],
  providerRequirements: baseProviderRequirements,
  archiveIntegration: baseArchiveIntegration,
  installHooks: baseInstallHooks,
  health: baseHealth,
  compatibility: baseCompatibility,
};

/** An agent-addon — a hosted agent runtime, requires a runtime process. */
export const agentAddon: AddOnManifest = {
  id: "addon.agent-addon-fixture",
  name: "Agent Add-on Fixture",
  version: "0.1.0",
  author: "ResonantOS Fixtures",
  category: "agent",
  description: "Deterministic agent-addon fixture for CP-BR3.",
  runtimeType: "agent-addon",
  surfaces: baseSurfaces,
  requestedCapabilities: [
    {
      capability: "agent-runtime",
      scope: "workspace",
      revocationBehavior: "hard-stop",
      granted: false,
    },
  ],
  providerRequirements: baseProviderRequirements,
  archiveIntegration: baseArchiveIntegration,
  installHooks: baseInstallHooks,
  health: baseHealth,
  compatibility: baseCompatibility,
};

/** A UI-only add-on — never produces a runtime process. */
export const uiModuleAddon: AddOnManifest = {
  id: "addon.ui-module-fixture",
  name: "UI Module Fixture",
  version: "0.1.0",
  author: "ResonantOS Fixtures",
  category: "knowledge",
  description: "Deterministic UI-only fixture for CP-BR3.",
  runtimeType: "ui-module",
  surfaces: baseSurfaces,
  requestedCapabilities: [
    {
      capability: "ui-embedding",
      scope: "self",
      revocationBehavior: "hide-surface",
      granted: false,
    },
  ],
  providerRequirements: baseProviderRequirements,
  archiveIntegration: baseArchiveIntegration,
  installHooks: baseInstallHooks,
  health: baseHealth,
  compatibility: baseCompatibility,
};

/**
 * A connector-classified add-on. classification.category is `integration`
 * while runtimeType is `local-service`. The category-independence test
 * compares this against the local-service fixture above: the resolver's
 * decision must be identical for the two when authority is identical,
 * because classification never branches the outcome.
 */
export const connectorAddon: AddOnManifest = {
  id: "addon.connector-local-service-fixture",
  name: "Connector Local Service Fixture",
  version: "0.1.0",
  author: "ResonantOS Fixtures",
  category: "integration",
  description: "Deterministic connector-classified local-service fixture for CP-BR3.",
  runtimeType: "local-service",
  surfaces: baseSurfaces,
  requestedCapabilities: [
    {
      capability: "filesystem",
      scope: "self",
      revocationBehavior: "hard-stop",
      granted: false,
    },
  ],
  providerRequirements: baseProviderRequirements,
  archiveIntegration: baseArchiveIntegration,
  installHooks: baseInstallHooks,
  health: baseHealth,
  compatibility: baseCompatibility,
};

/**
 * A twin of `localServiceAddon` whose only difference is the category.
 * Used by the category-independence test to assert that swapping
 * classification never changes the resolver's decision.
 */
export const categoryTwinAddon: AddOnManifest = {
  ...localServiceAddon,
  id: "addon.local-service-category-twin",
  category: "security",
};
