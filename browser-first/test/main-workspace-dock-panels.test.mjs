import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

import { renderDockControl, renderDockPermissions } from "../resonantos-side-panel-extension/src/lib/main-workspace-dock-panels.js";

function dom(html) {
  const d = new JSDOM(`<!doctype html>${html}`).window.document;
  return d;
}

test("main-workspace.html surfaces dock panels + chat history from the main-tab rail", async () => {
  const html = await readFile(
    path.resolve(import.meta.dirname, "..", "resonantos-side-panel-extension", "src", "main-workspace.html"),
    "utf8"
  );
  const d = new JSDOM(html).window.document;
  const required = ["rail-new-chat", "dock-tab-control", "dock-tab-jobs", "dock-tab-permissions", "rail-resize", "rail-tab-workspaces-items", "rail-tab-search-items"];
  for (const id of required) {
    assert.ok(d.getElementById(id), `main-workspace.html is missing #${id}`);
  }
  // Projects/Chats live inside the Workspaces tab; search lives in the Search tab.
  assert.ok(d.querySelector("#rail-tab-workspaces-items #rail-project-list"), "Projects list must live in the Workspaces tab");
  assert.ok(d.querySelector("#rail-tab-workspaces-items #rail-chat-list"), "Chats list must live in the Workspaces tab");
  assert.ok(d.querySelector("#rail-tab-search-items #rail-search-input"), "Search input must live in the Search tab");
  assert.equal(d.getElementById("chats-panel"), null, "the legacy Chats panel must be removed");

  // Dock tabs (control/jobs/permissions) are folded into the rail; the top-bar
  // dock and the Chats dock tab are gone, and new-chat lives in the Chat tab.
  assert.equal(d.getElementById("dock-tabs"), null, "the top-bar dock must be removed");
  assert.equal(d.getElementById("new-chat"), null, "the dock new-chat button must be removed");
  assert.ok(d.querySelector(".workspace-rail #dock-tab-control"), "Control must live in the rail");
  assert.ok(d.querySelector(".workspace-rail #dock-tab-jobs"), "Jobs must live in the rail");
  assert.ok(d.querySelector(".workspace-rail #dock-tab-permissions"), "Permissions must live in the rail");
  assert.equal(d.getElementById("dock-tab-chats"), null, "the Chats dock tab must be removed (folded into Workspaces)");
  assert.ok(d.querySelector(".workspace-rail #rail-new-chat"), "new-chat must live in the rail's Chat tab");
  assert.ok(d.getElementById("rail-resize"), "the rail must have a resize handle");
  assert.equal(d.getElementById("dock-tab-site"), null, "the Site tab is removed from the main panel");
  assert.equal(d.getElementById("site-permission-panel"), null, "the orphaned Site panel is removed");
});

test("renderDockPermissions lists stored grants and drops the ask-before-action default", () => {
  const d = dom(`<strong id="t"></strong><ol id="l"></ol>`);
  const list = d.querySelector("#l");
  const title = d.querySelector("#t");
  const count = renderDockPermissions(list, title, {
    "nfl.com": "trusted-for-safe-actions",
    "example.com": "read-only",
    "skip.com": "ask-before-action"
  }, { document: d });

  assert.equal(count, 2, "ask-before-action is a default, not a stored grant");
  assert.equal(title.textContent, "2 browser grants");
  const rows = [...list.querySelectorAll("li")];
  assert.deepEqual(rows.map((r) => r.querySelector("strong").textContent), ["example.com", "nfl.com"]);
  assert.match(rows[1].querySelector("small").textContent, /trusted-for-safe-actions/);
});

test("renderDockPermissions fires onReset with the site key", () => {
  const d = dom(`<strong id="t"></strong><ol id="l"></ol>`);
  const resets = [];
  renderDockPermissions(d.querySelector("#l"), d.querySelector("#t"), { "nfl.com": "read-only" }, {
    document: d,
    onReset: (key) => resets.push(key)
  });
  d.querySelector("#l li button").dispatchEvent(new d.defaultView.Event("click"));
  assert.deepEqual(resets, ["nfl.com"]);
});

test("renderDockPermissions shows an empty state with no grants", () => {
  const d = dom(`<strong id="t"></strong><ol id="l"></ol>`);
  renderDockPermissions(d.querySelector("#l"), d.querySelector("#t"), {}, { document: d });
  assert.equal(d.querySelector("#t").textContent, "No stored browser grants");
  assert.equal(d.querySelectorAll("#l li").length, 0);
});

test("renderDockControl renders the current run's steps via the shared step-list", () => {
  const d = dom(`<strong id="ct"></strong><span id="cs"></span><div id="cl"></div>`);
  const els = { titleEl: d.querySelector("#ct"), statusEl: d.querySelector("#cs"), stepListEl: d.querySelector("#cl") };
  renderDockControl(els, {
    goal: "go to fifa.com and click on news",
    status: "running",
    steps: [
      { label: "Open fifa.com", state: "completed" },
      { label: "Click News", state: "active" }
    ]
  }, { document: d });

  assert.equal(d.querySelector("#ct").textContent, "go to fifa.com and click on news");
  assert.equal(d.querySelector("#cs").textContent, "running");
  assert.equal(d.querySelectorAll("#cl .step-list-item").length, 2);
  assert.equal(d.querySelector("#cl .step-list-pill-text").textContent, "1 of 2");
});

test("renderDockControl shows an idle state when there is no run", () => {
  const d = dom(`<strong id="ct"></strong><span id="cs"></span><div id="cl"></div>`);
  const els = { titleEl: d.querySelector("#ct"), statusEl: d.querySelector("#cs"), stepListEl: d.querySelector("#cl") };
  renderDockControl(els, null, { document: d });
  assert.equal(d.querySelector("#ct").textContent, "No active browser task");
  assert.equal(d.querySelector("#cs").textContent, "idle");
  assert.equal(d.querySelectorAll("#cl .step-list-item").length, 0);
});
