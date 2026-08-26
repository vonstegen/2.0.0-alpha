// Lock the Tools-rail renderer contract: dock-icon registry, dynamic button
// rendering, active-state sync, and the generic add-on surface fallback.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  dockIconSvg,
  renderAddonSurfaceWorkspace,
  renderToolsRailButtons,
  syncToolsRailActive,
} from "../resonantos-side-panel-extension/src/lib/main-workspace-tools-rail.js";

const ROUTES = [
  { addonId: "addon.living-archive", surfaceId: "living-archive-workspace", sectionId: "memory", label: "Memory Workspace", eyebrow: "Living Archive", dockIcon: "memory", order: 10 },
  { addonId: "addon.hermes", surfaceId: "hermes-workspace", sectionId: "hermes", label: "Hermes Workspace", eyebrow: "Delegation agent", dockIcon: "messaging", order: 20 },
  { addonId: "addon.deepseek-harness", surfaceId: "deepseek-harness-status", sectionId: "deepseek-harness", label: "DeepSeek Harness", eyebrow: "Agent runtime", dockIcon: "harness", order: 40 },
];

function withDom() {
  const dom = new JSDOM(`<section id="tools"></section>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  return dom.window.document.querySelector("#tools");
}

test("dockIconSvg resolves known icons and falls back for unknown", () => {
  assert.match(dockIconSvg("memory"), /<svg /);
  assert.match(dockIconSvg("harness"), /<svg /);
  assert.match(dockIconSvg("recursion"), /<svg /);
  assert.match(dockIconSvg("does-not-exist"), /<svg /); // fallback, not empty
  assert.equal(dockIconSvg("memory"), dockIconSvg("memory")); // deterministic
});

test("renderToolsRailButtons renders one button per route with workspace + label", () => {
  const container = withDom();
  const opened = [];
  renderToolsRailButtons(container, ROUTES, (sectionId) => opened.push(sectionId));

  const buttons = [...container.querySelectorAll("button.rail-project")];
  assert.equal(buttons.length, ROUTES.length);
  assert.equal(buttons[0].dataset.workspace, "memory");
  assert.equal(buttons[0].querySelector(".rail-text").textContent, "Memory Workspace");
  assert.equal(buttons[2].dataset.workspace, "deepseek-harness");
  assert.ok(buttons[2].querySelector("svg"));

  buttons[2].click();
  assert.deepEqual(opened, ["deepseek-harness"]);
});

test("syncToolsRailActive toggles active + aria-current", () => {
  const container = withDom();
  renderToolsRailButtons(container, ROUTES, () => {});
  syncToolsRailActive(container, "hermes");

  const buttons = [...container.querySelectorAll("button.rail-project")];
  assert.equal(buttons.filter((b) => b.classList.contains("active")).length, 1);
  assert.equal(buttons[1].classList.contains("active"), true);
  assert.equal(buttons[1].getAttribute("aria-current"), "page");
  assert.equal(buttons[0].getAttribute("aria-current"), null);
});

test("renderAddonSurfaceWorkspace renders surface identity without fabricating UI", () => {
  const container = withDom();
  const route = ROUTES[2];
  renderAddonSurfaceWorkspace(container, route);

  assert.match(container.textContent, /DeepSeek Harness/);
  assert.match(container.textContent, /addon\.deepseek-harness/);
  assert.match(container.textContent, /deepseek-harness-status/);
});
