// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
// Intent citation: docs/architecture/ADR-053-browser-first-multi-harness-architecture.md
//
// CP-3 Augmentor extension contracts. An Augmentor extension is a bounded
// skill/tool/connector/workflow/model-adapter/memory-view that runs inside
// Augmentor's orchestration loop (doc 04). It never brings its own
// general-purpose planning/runtime loop — that is a harness provider (CP-4).
//
// The boundary that matters: an extension's declared capabilities are a
// *request* to Core, never a grant (ADR-053 — Core governs authority;
// Augmentor governs orchestration). The effective capability set is the
// intersection of the task grant and the extension's declaration (doc 08).
//
// Manifest-shape types (`ExtensionClass`, `AugmentorExtensionKind`,
// `AugmentorExtensionDefinition`, `AugmentorExtensionFailureBehavior`) live in
// core/contracts (the manifest home); they are re-exported here for the SDK
// barrel. This module adds the SDK-facing invocation/result contracts and the
// compatibility projection.

import type {
  AddOnAugmentorSkill,
  AugmentorExtensionDefinition,
  Capability,
} from "../../core/contracts";
import type { ScopedCapability } from "../authority";
import type { ArtifactRef } from "../tasks";

// Re-export the manifest-shape types so `src/sdk` surfaces the full
// extension contract from one barrel.
export type {
  AugmentorExtensionDefinition,
  AugmentorExtensionFailureBehavior,
  AugmentorExtensionKind,
  ExtensionClass,
} from "../../core/contracts";

// SDK-facing first-class extension declaration: the manifest definition plus
// identity/version and the class discriminant.
export type AugmentorExtensionManifest = AugmentorExtensionDefinition & {
  extensionClass: "augmentor-extension";
  id: string;
  version: string;
};

// Non-authority rule. Instructions do not grant authority.
export const AUGMENTOR_NON_AUTHORITY_RULE =
  "Augmentor orchestrates; Core governs. An extension's declared capabilities are requests, never grants; instructions never grant authority.";

// Explicit, bounded context selection (doc 04: the extension "receives only
// explicitly selected context"). References only — never raw credentials or
// full memory.
export interface AugmentorContextSelection {
  documentPaths: string[];
  memoryScopes?: string[];
  toolOutputs?: string[];
  artifactRefs?: ArtifactRef[];
}

// Invocation lifecycle (doc 04 execution model: task -> invocation -> grant ->
// host-mediated call -> result/evidence).
export type AugmentorExtensionLifecycle =
  | "planned"
  | "awaiting-approval"
  | "running"
  | "awaiting-evidence"
  | "completed"
  | "failed"
  | "revoked";

// A single extension invocation, running under an identity subordinate to
// Augmentor for the active task. `input` is validated against the extension's
// `inputSchema` at runtime, not here.
export interface AugmentorExtensionInvocation {
  invocationId: string;
  extensionId: string;
  kind: import("../../core/contracts").AugmentorExtensionKind;
  taskId: string;
  delegationId: string;
  principalId: string;
  context: AugmentorContextSelection;
  input: unknown;
  pendingApprovalGates: string[];
  lifecycle: AugmentorExtensionLifecycle;
}

// Typed result + evidence. `evidence` is untrusted until the extension's
// deterministic `verificationHooks` pass.
export interface AugmentorExtensionResult {
  invocationId: string;
  extensionId: string;
  status: "ok" | "failed" | "needs-approval";
  output?: unknown;
  evidence: ArtifactRef[];
  actionsTaken: string[];
  approvedGates: string[];
  auditCorrelationId: string;
}

// Effective capability set = intersection of the task grant and the
// extension's declared request (doc 08). Declared capabilities outside the
// grant are dropped, never widened. This is the pure predicate behind the
// CP-3 exit gate: Core independently authorizes every effect.
export function effectiveCapabilities(
  grant: readonly ScopedCapability[],
  requested: readonly Capability[],
): Capability[] {
  const granted = new Set(grant.map((scope) => scope.action));
  return requested.filter((capability) => granted.has(capability));
}

function slugify(path: string): string {
  const slug = path
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug.length > 0 ? slug : "skill";
}

// Compatibility projection: re-express an existing `AddOnAugmentorSkill`
// (doc 04 evolution) as a first-class `AugmentorExtensionManifest` of kind
// "skill" without adding any permission. `requiredCapabilities` is copied
// verbatim — the mapping introduces no new authority.
export function toAugmentorExtension(
  skill: AddOnAugmentorSkill,
  parent: { id: string; version: string },
): AugmentorExtensionManifest {
  return {
    extensionClass: "augmentor-extension",
    id: `${parent.id}:${slugify(skill.documentPath)}`,
    version: parent.version,
    kind: "skill",
    compatible: {
      augmentorVersions: ["^0.1.0"],
      sdkVersions: ["^0.1.0"],
    },
    requiredTools: [...skill.requiredTools],
    requiredCapabilities: [...skill.requiredCapabilities],
    inputSchema: { expectedInputs: [...skill.expectedInputs] },
    outputSchema: { expectedOutputs: [...skill.expectedOutputs] },
    workflowPhases: [...skill.workflowPhases],
    approvalGates: [...skill.approvalGates],
    contextPolicy: { read: [skill.documentPath], write: [] },
    verificationHooks: [],
    failureBehavior: "fail-closed",
    revocationBehavior: "cancel",
    auditLogRequired: skill.auditLogRequired,
    producesDelegationPackets: skill.producesDelegationPackets,
  };
}
