// Lock the rail renderer contract: dock-icon registry, dynamic menu buttons,
// active-state sync, and the rail-menu workspace (harness sub-tool-rail +
// grouped memory/tools route lists).

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  dockIconSvg,
  renderRailMenuWorkspace,
  renderToolsRailButtons,
  syncToolsRailActive,
} from "../resonantos-side-panel-extension/src/lib/main-workspace-tools-rail.js";

const MENUS = [
  {
    menuId: "memory",
    kind: "memory",
    label: "Memory",
    dockIcon: "memory",
    order: 10,
    routes: [
      { addonId: "addon.living-archive", surfaceId: "living-archive-workspace", sectionId: "memory", label: "Memory Workspace", eyebrow: "Living Archive", dockIcon: "memory", order: 10 },
    ],
  },
  {
    menuId: "hermes",
    kind: "harness",
    label: "Hermes",
    dockIcon: "messaging",
    order: 20,
    routes: [
      { addonId: "addon.hermes", surfaceId: "hermes-workspace", sectionId: "hermes", label: "Hermes Workspace", eyebrow: "Delegation agent", dockIcon: "messaging", order: 20 },
    ],
    tools: [
      { name: "hermes.start", description: "Start a delegation.", requiredCapabilities: ["agent-delegation"], requiresHumanApproval: true },
      { name: "hermes.status", description: "Query delegation status.", requiredCapabilities: [], requiresHumanApproval: false },
    ],
  },
  {
    menuId: "deepseek-harness",
    kind: "harness",
    label: "DeepSeek Harness",
    dockIcon: "harness",
    order: 40,
    routes: [
      { addonId: "addon.deepseek-harness", surfaceId: "deepseek-harness-status", sectionId: "deepseek-harness", label: "DeepSeek Harness", eyebrow: "Agent runtime", dockIcon: "harness", order: 40 },
    ],
    tools: [
      { name: "deepseek_harness.run_task", description: "Run a task.", requiredCapabilities: ["agent-delegation"], requiresHumanApproval: true },
    ],
  },
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

test("renderToolsRailButtons renders one button per menu with menuId + label", () => {
  const container = withDom();
  const opened = [];
  renderToolsRailButtons(container, MENUS, (menuId) => opened.push(menuId));

  const buttons = [...container.querySelectorAll("button.rail-project")];
  assert.equal(buttons.length, MENUS.length);
  assert.equal(buttons[0].dataset.workspace, "memory");
  assert.equal(buttons[0].querySelector(".rail-text").textContent, "Memory");
  assert.equal(buttons[2].dataset.workspace, "deepseek-harness");
  assert.ok(buttons[2].querySelector("svg"));

  buttons[2].click();
  assert.deepEqual(opened, ["deepseek-harness"]);
});

test("syncToolsRailActive toggles active + aria-current", () => {
  const container = withDom();
  renderToolsRailButtons(container, MENUS, () => {});
  syncToolsRailActive(container, "hermes");

  const buttons = [...container.querySelectorAll("button.rail-project")];
  assert.equal(buttons.filter((b) => b.classList.contains("active")).length, 1);
  assert.equal(buttons[1].classList.contains("active"), true);
  assert.equal(buttons[1].getAttribute("aria-current"), "page");
  assert.equal(buttons[0].getAttribute("aria-current"), null);
});

test("renderRailMenuWorkspace renders a harness sub-tool-rail with gates + caps", () => {
  const container = withDom();
  renderRailMenuWorkspace(container, MENUS[1]); // Hermes harness

  assert.match(container.textContent, /Hermes/);
  assert.match(container.textContent, /Harness/);

  const rows = [...container.querySelectorAll(".harness-tool-row")];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].querySelector("code").textContent, "hermes.start");
  assert.equal(rows[0].querySelector(".harness-tool-gate").textContent, "approval required");
  assert.equal(rows[0].querySelector(".harness-tool-gate").dataset.tone, "gated");
  assert.equal(rows[0].querySelector(".harness-tool-cap").textContent, "agent-delegation");

  // Non-gated tool renders the auto tone and no capability chips.
  assert.equal(rows[1].querySelector(".harness-tool-gate").textContent, "auto");
  assert.equal(rows[1].querySelector(".harness-tool-cap"), null);
});

test("renderRailMenuWorkspace renders a grouped route list for memory", () => {
  const container = withDom();
  renderRailMenuWorkspace(container, MENUS[0]); // Memory menu

  assert.match(container.textContent, /Memory/);

  const rows = [...container.querySelectorAll(".menu-route-row")];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector("strong").textContent, "Memory Workspace");
  assert.match(rows[0].querySelector("small").textContent, /Living Archive/);
  assert.match(rows[0].querySelector("small").textContent, /addon\.living-archive/);
});
