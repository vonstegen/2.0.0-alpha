// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
//
// CP-9 manifest templates for the three extension classes (doc 12 §Manifest
// evolution). Each template yields a valid, class-consistent manifest with
// safe-by-default policies (fail-closed, host-mediated, no extra authority).

import type {
  AddOnManifest,
  AugmentorExtensionKind,
  Capability,
  HarnessCancellationSemantics,
  HarnessSandboxStrength,
} from "../core/contracts";
import type { AugmentorExtensionManifest } from "./augmentor";
import type { HarnessProviderManifest } from "./harnesses";

export function createAugmentorExtensionTemplate(input: {
  id: string;
  version: string;
  kind: AugmentorExtensionKind;
  requiredCapabilities?: Capability[];
  workflowPhases?: string[];
  approvalGates?: string[];
}): AugmentorExtensionManifest {
  return {
    extensionClass: "augmentor-extension",
    id: input.id,
    version: input.version,
    kind: input.kind,
    compatible: { augmentorVersions: ["^0.1.0"], sdkVersions: ["^0.1.0"] },
    requiredTools: [],
    requiredCapabilities: input.requiredCapabilities ?? [],
    workflowPhases: input.workflowPhases ?? [],
    approvalGates: input.approvalGates ?? [],
    contextPolicy: { read: [], write: [] },
    verificationHooks: [],
    failureBehavior: "fail-closed",
    revocationBehavior: "cancel",
    auditLogRequired: true,
    producesDelegationPackets: false,
  };
}

export function createHarnessProviderTemplate(input: {
  id: string;
  version: string;
  adapterProtocol: string;
  cancellationSemantics?: HarnessCancellationSemantics;
  sandboxStrength?: HarnessSandboxStrength;
}): HarnessProviderManifest {
  return {
    extensionClass: "harness-provider",
    id: input.id,
    version: input.version,
    adapterProtocol: input.adapterProtocol,
    taskContract: {},
    eventContract: {},
    resultContract: {},
    childActorPolicy: {},
    contextPolicy: {},
    resourceHints: {},
    cancellationSemantics: input.cancellationSemantics ?? "cancel",
    sandboxStrength: input.sandboxStrength ?? "host-mediated",
  };
}

export function createSystemAddonTemplate(input: {
  id: string;
  name: string;
  version: string;
}): AddOnManifest {
  return {
    id: input.id,
    name: input.name,
    version: input.version,
    publisher: "local",
    author: "Resonant Alpha",
    category: "tool",
    description: `${input.name} (system add-on).`,
    runtimeType: "ui-module",
    extensionClass: "system-addon",
    surfaces: [],
    requestedCapabilities: [],
    providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
    archiveIntegration: {
      readScopes: [],
      intakeWriteScopes: [],
      canRequestIngest: false,
      canWriteKnowledgePages: false,
    },
    health: { strategy: "none" },
    installHooks: {},
    compatibility: { shellVersion: "^0.1.0", platforms: ["macOS", "linux", "windows"] },
  };
}
