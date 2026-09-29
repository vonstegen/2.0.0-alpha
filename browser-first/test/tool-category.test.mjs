// SDK-CATEGORY-001 adversarial boundary: the tool category and classification
// describe identity/type but never grant authority. Slot, capability, binding,
// and provider-profile authority all remain host-owned and fail closed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHarnessRegistry } from "../host/harness-registry.mjs";

const readJson = (p) => readFile(new URL(p, import.meta.url), "utf8").then(JSON.parse);
const tool = await readJson("../../examples/addons/tool-utility.json");
const pi = await readJson("../../examples/addons/pi-harness.json");

function memoryStore() {
  let document = null;
  return { read: async () => structuredClone(document), write: async (value) => { document = structuredClone(value); } };
}
const open = (store, bindings = []) => createHarnessRegistry({
  store,
  reviewedAdapterIds: ["openai-compatible-v1"],
  bindings,
});

test("tool reference add-on installs and enables but cannot obtain primary-agent", async () => {
  const registry = await open(memoryStore());
  await registry.install(tool, { enabled: true });
  assert.ok(registry.snapshot().installations["addon.tool-utility"]);
  await assert.rejects(
    registry.assignSlot("primary-agent", "addon.tool-utility", { expectedGeneration: 0 }),
    { code: "permission-denied" },
    "a tool with no agentRuntime/systemSlots must never be assignable to primary-agent",
  );
});

test("classification harness without agentRuntime grants no primary-agent authority", async () => {
  // classification alone is identity; it never provisions agent-runtime.
  const spoof = structuredClone(tool);
  spoof.classification = { category: "harness", subtype: "coding-agent" };
  const registry = await open(memoryStore());
  await registry.install(spoof, { enabled: true });
  await assert.rejects(
    registry.assignSlot("primary-agent", "addon.tool-utility", { expectedGeneration: 0 }),
    { code: "permission-denied" },
    "classification=harness must not make a non-harness add-on primary-agent eligible",
  );
});

test("provider-profile escalation fails closed without an approved binding regardless of classification", async () => {
  // A tool-labeled manifest that still declares a provider-profile runtime does
  // not bypass the binding gate: without an approved host binding, install is
  // denied. Classification can neither grant nor hide authority.
  const spoof = structuredClone(pi);
  spoof.classification = { category: "tool", subtype: "utility" };
  // harnessResources is category-gated to `harness`; strip it so this test
  // isolates the provider-profile binding gate rather than manifest validation.
  delete spoof.harnessResources;
  const noBinding = await open(memoryStore());
  await assert.rejects(noBinding.install(spoof, { enabled: true }), { code: "permission-denied" });
});

test("slot escalation: a non-reviewed adapter is never primary-agent eligible", async () => {
  const spoof = structuredClone(pi);
  spoof.classification = { category: "harness", subtype: "coding-agent" };
  // reviewedAdapterIds is empty: even with a matching approved binding, the
  // adapter is unreviewed so primary-agent stays refused (fail closed).
  const registry = await createHarnessRegistry({
    store: memoryStore(),
    reviewedAdapterIds: [],
    bindings: [{
      name: "openai.compatible", addonId: "addon.pi-harness", adapterId: "openai-compatible-v1",
      authScheme: "bearer", providerProfile: true,
    }],
  });
  // An unreviewed adapter fails closed at install (the binding gate is part of
  // install validation, so it can never reach the slot-assignment path).
  await assert.rejects(
    registry.install(spoof, { enabled: true }),
    { code: "permission-denied" },
    "unreviewed adapter must not install as a provider-profile harness even when classification is otherwise valid",
  );
});

test("unknown classification category makes the manifest invalid (fail-closed)", async () => {
  const { validateAddOnManifest } = await import("../../packages/addon-sdk/src/validation.ts");
  const bad = structuredClone(tool);
  bad.classification = { category: "does-not-exist" };
  assert.equal(validateAddOnManifest(bad).valid, false);
});
