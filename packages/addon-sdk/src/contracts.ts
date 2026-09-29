// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import type {
  AddOnAugmentorSkill,
  AddOnEngineerSetupRunbook,
  AddOnLocalServiceDefinition,
  AddOnManifest,
  AddOnHarnessProviderConnectionContract,
  AddOnHarnessResourceRequestContract,
  AddOnAgentRuntimeContract,
  AddOnAuditContract,
  AddOnConnectorDefinition,
  AddOnEmbeddedWorkspaceContract,
  AddOnHookDefinition,
  AddOnInstallContract,
  AddOnMemoryAccessContract,
  AddOnScriptDefinition,
  AddOnServiceProtocol,
  AddOnSkillDefinition,
  AddOnDeterministicSmokeTest,
  AddOnToolDefinition,
  AddOnWorkflowBoundary,
  Capability,
  HarnessCredentialDelivery,
  ProviderProtocolFamily,
  HarnessResourceFamily,
  HarnessResourceOperation,
} from "../../../src/core/contracts";

export const ADDON_SDK_VERSION = "0.1.0";

export type AddOnSdkManifest = AddOnManifest & {
  sdkVersion: string;
  service?: AddOnLocalServiceDefinition;
  tools?: AddOnToolDefinition[];
  workflowBoundaries?: AddOnWorkflowBoundary[];
  skills?: AddOnSkillDefinition[];
  connectors?: AddOnConnectorDefinition[];
  scripts?: AddOnScriptDefinition[];
  hooks?: AddOnHookDefinition[];
  engineerSetup?: AddOnEngineerSetupRunbook;
  augmentorSkills?: AddOnAugmentorSkill[];
  install?: AddOnInstallContract;
  audit?: AddOnAuditContract;
  embeddedWorkspace?: AddOnEmbeddedWorkspaceContract;
  agentRuntime?: AddOnAgentRuntimeContract;
  memoryAccess?: AddOnMemoryAccessContract;
  smokeTests?: AddOnDeterministicSmokeTest[];
};

export type AddOnManifestSource = "bundled" | "sideload";

export type AddOnValidationSeverity = "error" | "warning";

export type AddOnValidationIssue = {
  severity: AddOnValidationSeverity;
  code: string;
  path: string;
  message: string;
};

export type AddOnManifestValidationResult = {
  valid: boolean;
  manifestId?: string;
  issues: AddOnValidationIssue[];
};

export const ADDON_CAPABILITIES: readonly Capability[] = [
  "filesystem",
  "archive-read",
  "archive-intake-write",
  "chat-interface",
  "memory-provider",
  "providers",
  "shell",
  "network",
  "ui-embedding",
  "browser-control",
  "agent-delegation",
  "agent-runtime",
  "notifications",
  "device-integration",
];

export const ADDON_SERVICE_PROTOCOLS: readonly AddOnServiceProtocol[] = [
  "stdio-json-rpc",
  "http-json",
  "websocket-json",
  "host-command",
];

export const HARNESS_OPERATIONS = [
  "createSession", "invoke", "cancel", "history", "status", "modelCatalog", "selectModel",
] as const satisfies readonly import("../../../src/core/contracts").HarnessOperation[];

// Descriptive credential delivery mechanisms a harness can declare for the
// generic Harness Provider Connection (host owns the actual delivery).
export const HARNESS_CREDENTIAL_DELIVERY_MECHANISMS = ["runtime-adapter", "session-environment", "self-auth", "none"] as const satisfies readonly HarnessCredentialDelivery[];
export type HarnessCredentialDeliveryMechanism = (typeof HARNESS_CREDENTIAL_DELIVERY_MECHANISMS)[number];

// Canonical protocol/API-compatibility vocabulary a harness can declare
// (descriptive; never grants access to a profile). Mirrors the core
// `ProviderProtocolFamily` union so the SDK never re-declares values that can
// drift. Provider identity/type is a separate vocabulary (ProviderType).
export const HARNESS_PROVIDER_PROTOCOLS = ["openai-compatible", "minimax-compatible", "ollama"] as const satisfies readonly ProviderProtocolFamily[];

// Generic Harness Resource Request (Phase 2A). A request names allowlisted
// operations only; it never carries a path, credential, command, tool
// executable, provider, or model, and it never grants authority. Provider/model
// stays under the separate Harness Provider Connection contract.
export const HARNESS_RESOURCE_FAMILIES = ["project", "files", "skills", "memory", "tools"] as const satisfies readonly HarnessResourceFamily[];

// Per-family operation allowlists. Each family maps to a finite, closed
// vocabulary; validation rejects any operation outside its family's list.
export const HARNESS_RESOURCE_OPERATIONS: Readonly<Record<HarnessResourceFamily, readonly HarnessResourceOperation[]>> = Object.freeze({
  project: ["read", "context"],
  files: ["read", "write"],
  skills: ["list", "read"],
  memory: ["search", "read"],
  tools: ["list", "invoke"],
});

export { HARNESS_PUBLIC_ERROR_MESSAGES } from "../../../src/core/contracts.ts";
