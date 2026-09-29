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
  AddOnHarnessProviderConnectionContract,
  AddOnHarnessResourceRequestContract,
  HarnessCredentialDelivery,
  HarnessResourceFamily,
  HarnessResourceGrant,
  HarnessResourceOperation,
  HarnessResourceProjection,
  AddOnScriptDefinition,
  AddOnSkillDefinition,
  AddOnToolDefinition,
  AddOnWorkflowBoundary,
  Capability,
  CapabilityGrant,
} from "../../../src/core/contracts";
export {
  ADDON_CAPABILITIES,
  HARNESS_CREDENTIAL_DELIVERY_MECHANISMS,
  HARNESS_PROVIDER_PROTOCOLS,
  HARNESS_RESOURCE_FAMILIES,
  HARNESS_RESOURCE_OPERATIONS,
  ADDON_SDK_VERSION,
  ADDON_SERVICE_PROTOCOLS,
  type AddOnManifestSource,
  type AddOnManifestValidationResult,
  type AddOnSdkManifest,
  type AddOnValidationIssue,
  type HarnessCredentialDeliveryMechanism,
} from "./contracts";
export { createAddOnRegistryEntry, createAddOnRegistrySnapshot } from "./registry";
export type { AddOnRegistryBuildInput, AddOnRegistryEntryOptions, AddOnRegistrySnapshot } from "./registry";
export { createAddOnSurfaceDockRoutes, createAddOnToolPanelRoutes } from "./surface-routing";
export type { AddOnSurfaceDockRoute, AddOnToolPanelRoute } from "./surface-routing";
export { assertValidAddOnManifest, validateAddOnManifest } from "./validation";
export {
  HARNESS_RESOURCE_CAPABILITY,
  createHarnessResourceProjection,
  normalizeHarnessResourceRequest,
  resolveHarnessResourceGrants,
} from "./harness-resources";
export type { HarnessResourceNormalizationIssue, HarnessResourceNormalizationResult } from "./harness-resources";
export {
  ADDON_CATEGORY_IDS,
  ADDON_CATEGORY_REGISTRY,
  CATEGORY_DESCRIPTION_SCHEMA,
  UnknownCategoryError,
  describeCategory,
  getAddOnCategoryDescriptor,
  isRegisteredAddOnCategory,
  listAddOnCategories,
} from "./category-registry";
export type {
  AddOnCategoryDescriptor,
  CategoryArtifactRef,
  CategoryDescription,
  CategorySdkModule,
  CategorySubtypeDescriptor,
  SdkComponentStatus,
} from "./category-registry";
