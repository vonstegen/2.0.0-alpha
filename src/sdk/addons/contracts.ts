// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import type {
  AddOnAugmentorSkill,
  AddOnEngineerSetupRunbook,
  AddOnLocalServiceDefinition,
  AddOnManifest,
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
} from "../../core/contracts";

// CP-7.5.1 (Manifest Signing). Bumped from 0.1.0 to 2.0.5 — see the
// CP-7.5 continuation prompt. 7.5.2 will read this constant via the
// manifestVersionRange gate.
export const ADDON_SDK_VERSION = "2.0.5";

// CP-7.5.1 (Manifest Signing). An Ed25519 signature over the canonical JSON
// body of the manifest (recursively sorted object keys, no whitespace) with
// the `manifestSignature` key excluded from the payload. Required by the
// validator whenever the manifest's provenance.verificationState is
// "verified". Tampered or unsigned "verified" manifests are rejected.
export const MANIFEST_SIGNATURE_ALGORITHM = "ed25519" as const;

export type AddOnManifestSignature = {
  algorithm: typeof MANIFEST_SIGNATURE_ALGORITHM;
  publicKey: string;
  signature: string;
};

export type AddOnSdkManifest = AddOnManifest & {
  sdkVersion: string;
  manifestSignature?: AddOnManifestSignature;
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
  "notifications",
  "device-integration",
];

export const ADDON_SERVICE_PROTOCOLS: readonly AddOnServiceProtocol[] = [
  "stdio-json-rpc",
  "http-json",
  "websocket-json",
  "host-command",
];
