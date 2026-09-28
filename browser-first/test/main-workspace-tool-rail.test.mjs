// SDK-CATEGORY-001: dynamic right-side tool rail discovery + rendering.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  computeToolRailEntries,
  renderAddOnToolWorkspace,
  renderToolRail,
} from "../resonantos-side-panel-extension/src/lib/main-workspace-tool-rail.js";

const installation = (overrides = {}) => ({
  addonId: "addon.pi-harness",
  name: "Pi Harness",
  classification: { category: "harness", subtype: "coding-agent" },
  installed: true,
  enabled: true,
  grantedCapabilities: [{ capability: "agent-runtime", granted: true, scope: "system", revocationBehavior: "hard-stop" }],
  disabledOperations: [],
  hiddenSurfaceIds: [],
  surfaces: [{ id: "pi-tool-panel", type: "tool-panel", label: "Pi", icon: "pi", requiredCapabilities: ["agent-runtime"] }],
  agentRuntime: { adapterId: "openai-compatible-v1", credentialSource: "provider-profile", credentialBinding: "openai.compatible", chatAuthorLabel: "Pi", supportsModelSelection: true, modelSelection: { source: "runtime-audit", currentModelField: "currentModel", selectable: true } },
  providerProfileConfigured: true,
  ...overrides,
});

test("computeToolRailEntries derives entries from declared surfaces, not hard-coded ids", () => {
  const projection = { installations: { "addon.pi-harness": installation() } };
  const entries = computeToolRailEntries(projection);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, "Pi");
  assert.equal(entries[0].addonId, "addon.pi-harness");
  // The same projection shape discovers a second, unrelated add-on with no code change.
  const second = installation({ addonId: "addon.other", name: "Other Tool", classification: { category: "tool", subtype: "utility" }, grantedCapabilities: [], agentRuntime: null, providerProfileConfigured: null, surfaces: [{ id: "other-tool", type: "tool-panel", label: "Other", icon: "", requiredCapabilities: [] }] });
  const two = computeToolRailEntries({ installations: { "addon.pi-harness": installation(), "addon.other": second } });
  assert.deepEqual(two.map((e) => e.label).sort(), ["Other", "Pi"]);
});

test("disable, revoke, and remove all drop the rail entry (lifecycle)", () => {
  const enabled = computeToolRailEntries({ installations: { "addon.pi-harness": installation() } });
  assert.equal(enabled.length, 1);
  const disabled = computeToolRailEntries({ installations: { "addon.pi-harness": installation({ enabled: false }) } });
  assert.deepEqual(disabled, []);
  const revoked = computeToolRailEntries({ installations: { "addon.pi-harness": installation({ grantedCapabilities: [] }) } });
  assert.deepEqual(revoked, []);
  const removed = computeToolRailEntries({ installations: {} });
  assert.deepEqual(removed, []);
});

test("renderToolRail writes host labels as text, never markup", () => {
  const dom = new JSDOM(`<nav id="rail"></nav>`);
  const doc = dom.window.document;
  const container = doc.querySelector("#rail");
  const entries = [{ addonId: "addon.evil", surfaceId: "s", label: "<img src=x onerror=alert(1)>", icon: "", classification: "tool", hasAgentRuntime: false }];
  const count = renderToolRail(container, entries, { document: doc });
  assert.equal(count, 1);
  assert.equal(container.querySelectorAll("button").length, 1);
  assert.equal(container.querySelector("img"), null, "label must never be interpreted as markup");
  assert.match(container.textContent, /<img src=x/);
});

test("renderAddOnToolWorkspace exposes harness status without any secret material", () => {
  const dom = new JSDOM(`<section id="panel"></section>`);
  const doc = dom.window.document;
  const container = doc.querySelector("#panel");
  const inst = installation();
  renderAddOnToolWorkspace(container, { installation: inst, slots: { "primary-agent": { addonId: null, generation: 0, available: false } }, document: doc });
  const text = container.textContent;
  assert.match(text, /Pi Harness/);
  assert.match(text, /harness \/ coding-agent/);
  assert.match(text, /provider-profile/);
  assert.match(text, /openai\.compatible/);   // non-secret binding name is visible
  assert.match(text, /configured/);            // boolean credential status, no secret value
  assert.match(text, /available/);             // primary-agent not yet assigned
  // The credential-configured row renders a boolean label, never a token.
  assert.doesNotMatch(text, /reuse-canary-credential/);
  assert.equal(container.querySelector(".primary-agent-assign") !== null, true, "harness should offer a primary-agent control");
});

test("tool add-on panel shows no harness-only controls", () => {
  const dom = new JSDOM(`<section id="panel"></section>`);
  const doc = dom.window.document;
  const container = doc.querySelector("#panel");
  const toolInst = installation({ addonId: "addon.tool-utility", name: "Utility", classification: { category: "tool", subtype: "utility" }, grantedCapabilities: [], agentRuntime: null, providerProfileConfigured: null });
  renderAddOnToolWorkspace(container, { installation: toolInst, slots: {}, document: doc });
  assert.match(container.textContent, /tool \(no agent runtime\)/);
  assert.equal(container.querySelector(".primary-agent-assign"), null, "tool add-on must not expose primary-agent control");
});
