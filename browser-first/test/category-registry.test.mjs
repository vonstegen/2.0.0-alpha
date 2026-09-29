// SDK-CATEGORY-001: category registry, classification validation, and dynamic
// tool-panel surface discovery. Classification is a pure descriptor and must
// never grant authority, surfaces, slots, or provider credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  ADDON_CATEGORY_IDS,
  describeCategory,
  UnknownCategoryError,
  isRegisteredAddOnCategory,
} = await import("../../packages/addon-sdk/src/category-registry.ts");
const { validateAddOnManifest } = await import("../../packages/addon-sdk/src/validation.ts");
const { createAddOnToolPanelRoutes } = await import("../../packages/addon-sdk/src/surface-routing.ts");

const readJson = (p) => readFile(new URL(p, import.meta.url), "utf8").then(JSON.parse);
const pi = await readJson("../../examples/addons/pi-harness.json");
const tool = await readJson("../../examples/addons/tool-utility.json");

test("registry exposes the seven minimum categories", () => {
  for (const id of ["harness", "tool", "connector", "communication", "data-source", "ui", "service"]) {
    assert.ok(ADDON_CATEGORY_IDS.includes(id), `missing category ${id}`);
    assert.ok(isRegisteredAddOnCategory(id), `not registered: ${id}`);
  }
});

test("describeCategory returns structured, deterministic, AI-readable data", () => {
  const description = describeCategory("harness", { subtype: "coding-agent" });
  assert.equal(description.schemaVersion, "resonant-sdk/category-description/v1");
  assert.equal(description.category, "harness");
  assert.equal(description.subtype, "coding-agent");
  assert.ok(description.descriptor.purpose);
  assert.ok(description.descriptor.requiredManifestFields.includes("agentRuntime"));
  assert.ok(description.descriptor.eligibleSystemSlots.includes("primary-agent"));
  assert.ok(description.descriptor.recommendedSurfaces.includes("tool-panel"));
  assert.ok(description.descriptor.sdkModules.length > 0);
  assert.ok(description.descriptor.securityInvariants.length > 0);
  assert.ok(description.subtypeDetail, "coding-agent subtype must resolve");
  // Stable JSON serialization for agent consumption.
  const round = JSON.parse(JSON.stringify(description));
  assert.equal(round.category, "harness");
});

test("harness and tool kits are materially different", () => {
  const harness = describeCategory("harness");
  const tool = describeCategory("tool", { subtype: "utility" });
  assert.deepEqual(tool.descriptor.eligibleSystemSlots, []);
  assert.ok(harness.descriptor.eligibleSystemSlots.includes("primary-agent"));
  assert.ok(tool.descriptor.providerCredentialOptions.includes("none"));
  assert.ok(!tool.descriptor.providerCredentialOptions.includes("provider-profile"));
  assert.ok(!tool.descriptor.requiredManifestFields.includes("agentRuntime"));
  assert.notDeepEqual(
    harness.descriptor.sdkModules.map((m) => m.id),
    tool.descriptor.sdkModules.map((m) => m.id),
  );
});

test("unknown category fails closed with a deterministic error", () => {
  assert.throws(() => describeCategory("bogus"), (error) => error instanceof UnknownCategoryError && error.code === "unknown-category");
});

test("classification validates against the registry and unknown categories reject", () => {
  const good = { ...pi, classification: { category: "harness", subtype: "coding-agent" } };
  assert.equal(validateAddOnManifest(good).valid, true);
  const unknown = { ...pi, classification: { category: "bogus" } };
  const result = validateAddOnManifest(unknown);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "classification-category-unknown"));
  const badSubtype = { ...pi, classification: { category: "harness", subtype: "" } };
  assert.equal(validateAddOnManifest(badSubtype).valid, false);
});

test("missing classification is rejected with a deterministic error", () => {
  const noClassification = structuredClone(tool);
  delete noClassification.classification;
  const result = validateAddOnManifest(noClassification);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "classification-required"));
});

test("legacy top-level category cannot substitute for classification", () => {
  // A manifest that carries ONLY the obsolete top-level `category` field (no
  // classification) must fail closed; the legacy vocabulary is not a fallback.
  const legacyOnly = structuredClone(tool);
  delete legacyOnly.classification;
  legacyOnly.category = "tool";
  const result = validateAddOnManifest(legacyOnly);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "classification-required"));
  // Even an unknown legacy category string must not be interpreted as a
  // classification; the manifest is still missing classification.
  legacyOnly.category = "orchestration";
  const legacyOrchestration = validateAddOnManifest(legacyOnly);
  assert.equal(legacyOrchestration.valid, false);
  assert.ok(legacyOrchestration.issues.some((issue) => issue.code === "classification-required"));
});

test("all seven canonical categories are accepted as classification.category", () => {
  for (const id of ["harness", "tool", "connector", "communication", "data-source", "ui", "service"]) {
    const manifest = { ...tool, classification: { category: id } };
    assert.equal(validateAddOnManifest(manifest).valid, true, `expected ${id} to validate`);
  }
});

test("pi and tool manifests carry correct classification and validate", () => {
  assert.deepEqual(pi.classification, { category: "harness", subtype: "coding-agent" });
  assert.deepEqual(tool.classification, { category: "tool", subtype: "utility" });
  assert.equal(validateAddOnManifest(pi).valid, true);
  assert.equal(validateAddOnManifest(tool).valid, true);
});

test("unsafe surface icon and unknown surface type reject", () => {
  const badIcon = { ...tool, surfaces: [{ id: "x", type: "tool-panel", label: "X", icon: "../evil", requiredCapabilities: [] }] };
  const r1 = validateAddOnManifest(badIcon);
  assert.equal(r1.valid, false);
  assert.ok(r1.issues.some((issue) => issue.code === "surface-icon-unsafe"));
  const badType = { ...tool, surfaces: [{ id: "x", type: "arbitrary-html", label: "X", requiredCapabilities: [] }] };
  const r2 = validateAddOnManifest(badType);
  assert.equal(r2.valid, false);
  assert.ok(r2.issues.some((issue) => issue.code === "unknown-enum"));
});

test("surface requiredCapabilities must be declared in requestedCapabilities (no self-grant)", () => {
  const escalated = { ...tool, surfaces: [{ id: "x", type: "tool-panel", label: "X", requiredCapabilities: ["agent-runtime"] }] };
  const result = validateAddOnManifest(escalated);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === "surface-unrequested-capability"));
});

const installation = (overrides = {}) => ({
  addonId: "addon.pi-harness",
  name: "Pi Harness",
  classification: { category: "harness", subtype: "coding-agent" },
  installed: true,
  enabled: true,
  grantedCapabilities: [{ capability: "agent-runtime", granted: true, scope: "system", revocationBehavior: "hard-stop" }],
  disabledOperations: [],
  hiddenSurfaceIds: [],
  surfaces: [],
  agentRuntime: null,
  providerProfileConfigured: null,
  ...overrides,
});

test("tool-panel route appears only when installed + enabled + authorized", () => {
  const projection = { installations: { "addon.pi-harness": installation() } };
  const routes = createAddOnToolPanelRoutes([pi], projection);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].label, "Pi");
  assert.equal(routes[0].icon, "pi");
});

test("classification alone never creates a surface route", () => {
  // A manifest with classification but NO surfaces yields no tool-panel route.
  const bare = { ...pi, surfaces: [] };
  const routes = createAddOnToolPanelRoutes([bare], { installations: { "addon.pi-harness": installation() } });
  assert.deepEqual(routes, []);
});

test("ungranted, disabled, and hidden surfaces never produce a route", () => {
  const ungranted = createAddOnToolPanelRoutes([pi], { installations: { "addon.pi-harness": installation({ grantedCapabilities: [] }) } });
  assert.deepEqual(ungranted, []);
  const disabled = createAddOnToolPanelRoutes([pi], { installations: { "addon.pi-harness": installation({ enabled: false }) } });
  assert.deepEqual(disabled, []);
  const hidden = createAddOnToolPanelRoutes([pi], { installations: { "addon.pi-harness": installation({ hiddenSurfaceIds: ["pi-tool-panel"] }) } });
  assert.deepEqual(hidden, []);
});

test("tool add-on cannot receive harness-only surface authority", () => {
  // A tool surface with empty requiredCapabilities appears on install+enable,
  // but the tool manifest declares no agent-runtime and no primary-agent slot.
  assert.equal(tool.agentRuntime, undefined);
  assert.equal(tool.systemSlots, undefined);
  assert.deepEqual(tool.classification, { category: "tool", subtype: "utility" });
  const toolInstallation = {
    addonId: "addon.tool-utility",
    name: "Utility Tool",
    classification: { category: "tool", subtype: "utility" },
    installed: true,
    enabled: true,
    grantedCapabilities: [],
    disabledOperations: [],
    hiddenSurfaceIds: [],
    surfaces: [],
    agentRuntime: null,
    providerProfileConfigured: null,
  };
  const routes = createAddOnToolPanelRoutes([tool], { installations: { "addon.tool-utility": toolInstallation } });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].label, "Utility");
});

test("harness category discovery surfaces the Harness Resource Request contract", () => {
  const description = describeCategory("harness");
  const module = description.descriptor.sdkModules.find((m) => m.id === "harness-resource-request");
  assert.ok(module, "harness-resource-request SDK module must be described");
  assert.equal(module.status, "implemented");
  assert.ok(description.descriptor.optionalManifestFields.includes("harnessResources"));
  assert.ok(
    description.descriptor.securityInvariants.some((line) => line.includes("RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION")),
    "invariants must state request != grant != projection",
  );
  assert.ok(
    description.descriptor.securityInvariants.some((line) => line.includes("Phase 2B+")),
    "invariants must state projection adapters are not yet implemented",
  );
  assert.ok(
    description.descriptor.docs.some((path) => path.includes("ADR-042")),
    "harness docs must reference the resource request ADR",
  );
});

test("the canonical Pi reference manifest declares resources and validates", () => {
  assert.ok(pi.harnessResources, "Pi must declare harnessResources");
  assert.equal(validateAddOnManifest(pi).valid, true, "Pi reference manifest must validate");
  for (const family of ["project", "files", "skills", "memory", "tools"]) {
    assert.ok(Array.isArray(pi.harnessResources.requests[family]), `Pi must declare the ${family} family`);
  }
});
