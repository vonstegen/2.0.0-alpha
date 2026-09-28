// Intent citation: docs/architecture/ADR-039-harness-runtime-provider-profiles.md
// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md
//
// Canonical, extensible SDK category registry. A category describes WHAT an
// add-on is and which SDK material a developer/harness should consult to build
// it. Classification is a pure descriptor: nothing here grants authority,
// capabilities, slots, surfaces, or provider credentials. Authority remains
// host-owned (registry grant gate + slot assignment + provider resolver).

import type { AddOnSurfaceType, SystemSlotId } from "../../../src/core/contracts";

export type SdkComponentStatus = "implemented" | "planned";

export interface CategorySdkModule {
  id: string;
  label: string;
  status: SdkComponentStatus;
  note?: string;
}

export interface CategoryArtifactRef {
  path: string;
  status: SdkComponentStatus;
  note?: string;
}

export interface CategorySubtypeDescriptor {
  purpose: string;
  notes?: string[];
}

export interface AddOnCategoryDescriptor {
  /** Registry key, e.g. "harness". */
  id: string;
  label: string;
  /** Human + machine readable purpose of the category. */
  purpose: string;
  /** Recommended (never enforced) runtime families; classification is orthogonal to runtimeType. */
  recommendedRuntimeFamilies: string[];
  /** Recommended (never granted) surfaces. */
  recommendedSurfaces: AddOnSurfaceType[];
  /** Eligible (never granted) system slots. */
  eligibleSystemSlots: SystemSlotId[];
  /** Manifest fields required by this category beyond the universal core. */
  requiredManifestFields: string[];
  /** Manifest fields optional/recommended for this category. */
  optionalManifestFields: string[];
  /** Credential/provider options applicable to this category. */
  providerCredentialOptions: string[];
  /** Security invariants a compliant add-on in this category must preserve. */
  securityInvariants: string[];
  /** SDK modules relevant to this category, with truthful implementation status. */
  sdkModules: CategorySdkModule[];
  /** Security profiles relevant to this category. */
  securityProfiles: string[];
  /** Reference templates. */
  templates: CategoryArtifactRef[];
  /** Reference examples. */
  examples: CategoryArtifactRef[];
  /** Relevant test suites. */
  testSuites: CategoryArtifactRef[];
  /** Documentation paths. */
  docs: string[];
  /** Known subtypes. Open: not an exhaustive enum. */
  subtypes: Record<string, CategorySubtypeDescriptor>;
}

export const CATEGORY_DESCRIPTION_SCHEMA = "resonant-sdk/category-description/v1" as const;

const UNIVERSAL_REQUIRED = [
  "id", "name", "version", "author", "category", "description", "runtimeType",
  "surfaces", "requestedCapabilities", "providerRequirements", "archiveIntegration",
  "health", "installHooks", "compatibility",
] as const;

const UNIVERSAL_OPTIONAL = [
  "sdkVersion", "classification", "provenance", "grantPresets", "runtimeIsolation",
  "systemSlots", "service", "tools", "delegation", "install", "audit",
  "embeddedWorkspace", "agentRuntime", "memoryAccess", "smokeTests",
] as const;

const _ADDON_CATEGORY_REGISTRY: readonly AddOnCategoryDescriptor[] = [
  {
    id: "harness",
    label: "Harness",
    purpose:
      "A coding-agent / assistant runtime that executes inference turns through a host-owned adapter. The host owns credential resolution, capability grants, and the primary-agent slot.",
    recommendedRuntimeFamilies: ["cli", "local-service", "ui-module"],
    recommendedSurfaces: ["tool-panel", "workspace"],
    eligibleSystemSlots: ["primary-agent", "chat-interface"],
    requiredManifestFields: ["agentRuntime"],
    optionalManifestFields: ["systemSlots", "embeddedWorkspace", "modelSelection"],
    providerCredentialOptions: ["provider-profile", "self", "none"],
    securityInvariants: [
      "Classification describes identity/type, never grants authority.",
      "No manifest self-grant; capability, slot, and surface grants are host-owned.",
      "No raw secret in manifest/argv/log/status; provider-profile resolution is host-owned and scoped.",
      "Provider-profile credential binding names a non-secret host binding; the manifest never proposes an endpoint.",
      "Revocation fences one harness without breaking shared-profile peers.",
      "primary-agent execution requires a reviewed adapter + approved binding + granted agent-runtime.",
    ],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented", note: "packages/addon-sdk/src/validation.ts" },
      { id: "harness-runtime", label: "Harness runtime contract", status: "implemented", note: "browser-first/host/harness-adapter-contract.mjs" },
      { id: "provider-profile", label: "Provider Profile integration", status: "implemented", note: "browser-first/host/harness-credentials.mjs" },
      { id: "primary-agent-slot", label: "primary-agent slot eligibility", status: "implemented", note: "browser-first/host/harness-registry.mjs" },
      { id: "tool-panel-surface", label: "tool-panel/workspace surface discovery", status: "implemented", note: "packages/addon-sdk/src/surface-routing.ts" },
      { id: "session-tool-permissions", label: "Session/tool permission guidance", status: "implemented", note: "browser-first/host/harness-boundary.mjs" },
      { id: "execution-boundary", label: "Execution/security boundary", status: "implemented", note: "browser-first/host/harness-boundary.mjs" },
    ],
    securityProfiles: ["harness-execution", "provider-profile-credential"],
    templates: [
      { path: "examples/addons/pi-harness.json", status: "implemented" },
      { path: "examples/addons/openai-compatible-harness.json", status: "implemented" },
    ],
    examples: [
      { path: "browser-first/host/harness-examples/provider-chat-demo.json", status: "implemented" },
      { path: "browser-first/host/harness-examples/deepseek-harness.json", status: "implemented" },
    ],
    testSuites: [
      { path: "browser-first/test/harness-manifest.test.mjs", status: "implemented" },
      { path: "browser-first/test/harness-credentials.test.mjs", status: "implemented" },
      { path: "browser-first/test/harness-provider-profile-reuse.test.mjs", status: "implemented" },
    ],
    docs: [
      "docs/architecture/ADR-039-harness-runtime-provider-profiles.md",
      "docs/architecture/ADR-026-minimal-kernel-replaceable-default-addons.md",
      "docs/addons/harness-adapter-demo.md",
    ],
    subtypes: {
      "coding-agent": {
        purpose: "An AI coding agent that submits turns through a host-owned inference runtime (e.g. Pi, Augmentor).",
      },
    },
  },
  {
    id: "tool",
    label: "Tool",
    purpose:
      "A bounded utility that performs a discrete operation and returns structured input/output. A tool receives no agent-runtime authority, no provider-profile resolution, and no primary-agent eligibility by virtue of being a tool.",
    recommendedRuntimeFamilies: ["local-service", "ui-module", "embedded-module"],
    recommendedSurfaces: ["tool-panel", "page", "panel"],
    eligibleSystemSlots: [],
    requiredManifestFields: [],
    optionalManifestFields: ["tools", "service", "embeddedWorkspace", "smokeTests"],
    providerCredentialOptions: ["none"],
    securityInvariants: [
      "Classification describes identity/type, never grants authority.",
      "Tool category grants no harness execution, primary-agent slot, or provider-profile resolution.",
      "Tool invocation is bounded by declared input/output schemas and host capability grants.",
      "No arbitrary HTML/script/command surface injection; host owns the renderer.",
    ],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented", note: "packages/addon-sdk/src/validation.ts" },
      { id: "tool-invocation", label: "Tool invocation/input/output contract", status: "implemented", note: "packages/addon-sdk/src/contracts.ts (AddOnToolDefinition)" },
      { id: "tool-panel-surface", label: "UI surface options (tool-panel)", status: "implemented", note: "packages/addon-sdk/src/surface-routing.ts" },
      { id: "capability-declaration", label: "Capability declaration guidance", status: "implemented", note: "packages/addon-sdk/src/validation.ts" },
    ],
    securityProfiles: ["bounded-tool-execution"],
    templates: [
      { path: "examples/addons/tool-utility.json", status: "implemented" },
    ],
    examples: [
      { path: "examples/addons/recursive-mas.json", status: "planned", note: "Runtime add-on example; not a minimal tool reference." },
    ],
    testSuites: [
      { path: "browser-first/test/tool-category.test.mjs", status: "implemented" },
    ],
    docs: [
      "docs/architecture/ADR-018-addon-sdk-v0.md",
      "docs/architecture/ADR-006-addon-runtime-sdk.md",
    ],
    subtypes: {
      utility: {
        purpose: "A single-purpose harmless utility (reference add-on for the tool category).",
      },
    },
  },
  {
    id: "connector",
    label: "Connector",
    purpose: "An integration adapter that bridges an external application/API (MCP server, app connector, filesystem).",
    recommendedRuntimeFamilies: ["local-service", "host-command"],
    recommendedSurfaces: ["panel", "tool-panel"],
    eligibleSystemSlots: [],
    requiredManifestFields: [],
    optionalManifestFields: ["connectors", "service", "install"],
    providerCredentialOptions: ["none", "self"],
    securityInvariants: ["Classification describes identity/type, never grants authority.", "Connector credentials remain host-vault or addon-private; no manifest secret."],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented" },
      { id: "connector-contract", label: "Connector definition contract", status: "implemented", note: "packages/addon-sdk/src/contracts.ts (AddOnConnectorDefinition)" },
    ],
    securityProfiles: ["connector-scoped-config"],
    templates: [],
    examples: [],
    testSuites: [],
    docs: ["docs/architecture/ADR-018-addon-sdk-v0.md"],
    subtypes: {},
  },
  {
    id: "communication",
    label: "Communication",
    purpose: "A channel/communication add-on (email, chat bridge) that drafts and — with human approval — sends or schedules packets.",
    recommendedRuntimeFamilies: ["channel-addon", "local-service"],
    recommendedSurfaces: ["channel", "panel", "tool-panel"],
    eligibleSystemSlots: ["communication-channel"],
    requiredManifestFields: [],
    optionalManifestFields: ["connectors", "delegation"],
    providerCredentialOptions: ["none", "self"],
    securityInvariants: ["Classification describes identity/type, never grants authority.", "Sending/scheduling remains human-approval gated; draft-only by default."],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented" },
      { id: "channel-runtime", label: "Channel runtime contract", status: "planned", note: "No first-class channel execution module yet." },
    ],
    securityProfiles: ["human-approval-gated-send"],
    templates: [],
    examples: [],
    testSuites: [],
    docs: ["docs/architecture/ADR-018-addon-sdk-v0.md"],
    subtypes: {},
  },
  {
    id: "data-source",
    label: "Data Source",
    purpose: "A read-only or intake-scoped knowledge/memory source that feeds the archive through host APIs.",
    recommendedRuntimeFamilies: ["local-service", "host-command"],
    recommendedSurfaces: ["panel", "embedded-pane"],
    eligibleSystemSlots: ["memory-system"],
    requiredManifestFields: [],
    optionalManifestFields: ["memoryAccess", "archiveIntegration"],
    providerCredentialOptions: ["none"],
    securityInvariants: ["Classification describes identity/type, never grants authority.", "Direct trusted knowledge writes remain blocked; intake is host-gated."],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented" },
      { id: "memory-access", label: "Memory access contract", status: "implemented", note: "packages/addon-sdk/src/contracts.ts (AddOnMemoryAccessContract)" },
    ],
    securityProfiles: ["archive-intake-gated"],
    templates: [],
    examples: [{ path: "examples/addons/reference-memory.json", status: "implemented" }],
    testSuites: [],
    docs: ["docs/architecture/ADR-018-addon-sdk-v0.md"],
    subtypes: {},
  },
  {
    id: "ui",
    label: "UI",
    purpose: "A pure presentation surface/theme with no privileged execution.",
    recommendedRuntimeFamilies: ["ui-module", "embedded-module"],
    recommendedSurfaces: ["page", "panel", "tool-panel"],
    eligibleSystemSlots: [],
    requiredManifestFields: [],
    optionalManifestFields: ["embeddedWorkspace"],
    providerCredentialOptions: ["none"],
    securityInvariants: ["Classification describes identity/type, never grants authority.", "Host owns the renderer; no arbitrary HTML/script injection."],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented" },
      { id: "ui-embedding", label: "UI embedding contract", status: "implemented", note: "packages/addon-sdk/src/contracts.ts (AddOnEmbeddedWorkspaceContract)" },
    ],
    securityProfiles: ["host-owned-renderer"],
    templates: [],
    examples: [],
    testSuites: [],
    docs: ["docs/architecture/ADR-018-addon-sdk-v0.md"],
    subtypes: {},
  },
  {
    id: "service",
    label: "Service",
    purpose: "A background/local service that exposes host-mediated operations without a user-facing chat surface.",
    recommendedRuntimeFamilies: ["local-service", "host-command"],
    recommendedSurfaces: ["background-task-monitor", "tool-panel"],
    eligibleSystemSlots: [],
    requiredManifestFields: [],
    optionalManifestFields: ["service", "health", "install", "audit"],
    providerCredentialOptions: ["none", "self"],
    securityInvariants: ["Classification describes identity/type, never grants authority.", "Loopback-only by default; egress is capability-gated."],
    sdkModules: [
      { id: "manifest-validation", label: "Core manifest/validation contract", status: "implemented" },
      { id: "local-service", label: "Local service contract", status: "implemented", note: "packages/addon-sdk/src/contracts.ts (AddOnLocalServiceDefinition)" },
    ],
    securityProfiles: ["host-mediated-service"],
    templates: [],
    examples: [{ path: "examples/addons/recursive-mas.json", status: "implemented" }],
    testSuites: [],
    docs: ["docs/architecture/ADR-030-recursive-mas-runtime-addon.md"],
    subtypes: {},
  },
];

export const ADDON_CATEGORY_REGISTRY: readonly AddOnCategoryDescriptor[] = Object.freeze(_ADDON_CATEGORY_REGISTRY);

export const ADDON_CATEGORY_IDS = ADDON_CATEGORY_REGISTRY.map((category) => category.id);

export function isRegisteredAddOnCategory(category: string): boolean {
  return ADDON_CATEGORY_REGISTRY.some((entry) => entry.id === category);
}

export function getAddOnCategoryDescriptor(id: string): AddOnCategoryDescriptor | undefined {
  return ADDON_CATEGORY_REGISTRY.find((entry) => entry.id === id);
}

export function listAddOnCategories(): Array<{ id: string; label: string; purpose: string }> {
  return ADDON_CATEGORY_REGISTRY.map(({ id, label, purpose }) => ({ id, label, purpose }));
}

export interface CategoryDescription {
  schemaVersion: typeof CATEGORY_DESCRIPTION_SCHEMA;
  category: string;
  subtype: string | null;
  descriptor: AddOnCategoryDescriptor;
  // Subtype resolved against the descriptor's open subtype map (may be absent
  // even for a valid subtype: subtypes are advisory, not an exhaustive enum).
  subtypeDetail: CategorySubtypeDescriptor | null;
}

export class UnknownCategoryError extends Error {
  readonly code = "unknown-category";
  constructor(category: string) {
    super(`Unknown SDK category "${category}". Registered categories: ${ADDON_CATEGORY_IDS.join(", ")}.`);
    this.name = "UnknownCategoryError";
  }
}

export function describeCategory(category: string, options: { subtype?: string } = {}): CategoryDescription {
  const descriptor = getAddOnCategoryDescriptor(category);
  if (!descriptor) throw new UnknownCategoryError(category);
  const subtype = options.subtype ? String(options.subtype) : null;
  return {
    schemaVersion: CATEGORY_DESCRIPTION_SCHEMA,
    category,
    subtype,
    descriptor,
    subtypeDetail: subtype && Object.hasOwn(descriptor.subtypes, subtype) ? descriptor.subtypes[subtype] : null,
  };
}

export { UNIVERSAL_OPTIONAL, UNIVERSAL_REQUIRED };
