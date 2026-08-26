// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

export type {
  AddOnAugmentorSkill,
  AddOnArtifactReference,
  AddOnConnectorDefinition,
  AddOnHookDefinition,
  AddOnEngineerSetupRunbook,
  AddOnRegistryEntry,
  AddOnRegistryReviewState,
  AddOnRegistrySource,
  AddOnManifest,
  AddOnScriptDefinition,
  AddOnSkillDefinition,
  AddOnToolDefinition,
  AddOnWorkflowBoundary,
  Capability,
  CapabilityGrant,
} from "../../core/contracts";
export {
  ADDON_CAPABILITIES,
  ADDON_SDK_VERSION,
  ADDON_SERVICE_PROTOCOLS,
  type AddOnManifestSource,
  type AddOnManifestValidationResult,
  type AddOnSdkManifest,
  type AddOnValidationIssue,
} from "./contracts";
export { createAddOnRegistryEntry, createAddOnRegistrySnapshot } from "./registry";
export type { AddOnRegistryBuildInput, AddOnRegistryEntryOptions, AddOnRegistrySnapshot } from "./registry";
export {
  ADDON_CATEGORY_BLUEPRINT,
  ADDON_RUNTIME_TYPE_BLUEPRINT,
  G0_HARNESS_TOOL_CATALOG,
  G0_HARNESS_TOOL_NAMES,
  GROUND_ZERO_INVARIANT,
  ROS_ARCHITECTURE_VOCABULARY,
  ROS_FUSED_CORE,
  ROS_SCOPING,
  railMenuKindForCategory,
} from "./architecture";
export type { AddOnCategoryBlueprint, AddOnRailMenuKind, AddOnRuntimeTypeBlueprint, G0HarnessTool } from "./architecture";
export {
  createAddOnRailMenus,
  createAddOnSurfaceDockRoutes,
  createRosHarnessMenu,
  createShellRailMenus,
  ROS_HARNESS_MENU_ID,
} from "./surface-routing";
export type {
  AddOnRailMenu,
  AddOnSurfaceDockRoute,
  NativeToolRailEntry,
  NativeToolSupersede,
} from "./surface-routing";
export { assertValidAddOnManifest, validateAddOnManifest } from "./validation";
