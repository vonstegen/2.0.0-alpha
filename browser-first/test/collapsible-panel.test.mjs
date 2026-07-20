import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createCollapsiblePanel } from "../resonantos-side-panel-extension/src/lib/collapsible-panel.js";

function setup(initial = {}) {
  const dom = new JSDOM(`<section id="p"><button id="t">Hide</button></section>`);
  const section = dom.window.document.getElementById("p");
  const toggle = dom.window.document.getElementById("t");
  const store = { ...initial };
  const storage = {
    get: async (key) => (key in store ? { [key]: store[key] } : {}),
    set: async (obj) => { Object.assign(store, obj); }
  };
  return { dom, section, toggle, storage, store };
}

test("collapsible panel renders expanded by default on bind", () => {
  const { section, toggle, storage } = setup();
  const panel = createCollapsiblePanel({ section, toggle, storage, storageKey: "k" });

  panel.bind();

  assert.equal(section.dataset.collapsed, "false");
  assert.equal(toggle.textContent, "Hide");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.isCollapsed(), false);
});

test("clicking the toggle flips the collapse state, label, and data attribute", () => {
  const { section, toggle, storage } = setup();
  const panel = createCollapsiblePanel({ section, toggle, storage, storageKey: "k" });
  panel.bind();

  toggle.click();
  assert.equal(section.dataset.collapsed, "true");
  assert.equal(toggle.textContent, "Show");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  toggle.click();
  assert.equal(section.dataset.collapsed, "false");
  assert.equal(toggle.textContent, "Hide");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("collapse state persists to storage", async () => {
  const { storage, store } = setup();
  const panel = createCollapsiblePanel({ storage, storageKey: "k" });

  await panel.setCollapsed(true);

  assert.equal(store.k, true);
});

test("hydrate applies the stored collapsed state", async () => {
  const { section, toggle, storage } = setup({ k: true });
  const panel = createCollapsiblePanel({ section, toggle, storage, storageKey: "k" });

  await panel.hydrate();

  assert.equal(section.dataset.collapsed, "true");
  assert.equal(toggle.textContent, "Show");
  assert.equal(panel.isCollapsed(), true);
});

test("collapsible panel tolerates missing storage and elements", async () => {
  const panel = createCollapsiblePanel({ storageKey: "k" });
  // Should not throw with no section/toggle/storage wired.
  panel.bind();
  await panel.hydrate();
  assert.equal(await panel.toggleCollapsed(), true);
});
