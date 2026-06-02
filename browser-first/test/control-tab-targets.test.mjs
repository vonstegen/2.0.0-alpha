import assert from "node:assert/strict";
import test from "node:test";

import { createControlTabTargets } from "../resonantos-side-panel-extension/src/lib/control-tab-targets.js";

function createHarness({
  allTabs = [],
  controlledTabId = null,
  currentWindowTabs = [],
  getTab = () => null,
  updateTab = null,
} = {}) {
  const events = [];
  let selectedControlledTabId = controlledTabId;
  let snapshotCleared = 0;
  const chromeApi = {
    tabs: {
      create: async (payload) => {
        events.push(["create", payload]);
        return { id: 99, url: payload.url, active: Boolean(payload.active) };
      },
      get: async (tabId) => {
        events.push(["get", tabId]);
        return getTab(tabId);
      },
      query: async (query) => {
        events.push(["query", query]);
        return query.currentWindow ? currentWindowTabs : allTabs;
      },
      update: async (tabId, payload) => {
        events.push(["update", tabId, payload]);
        return updateTab ? updateTab(tabId, payload) : { id: tabId, url: payload.url, active: Boolean(payload.active) };
      },
    },
  };
  const targets = createControlTabTargets({
    chromeApi,
    clearPageSnapshot: () => {
      snapshotCleared += 1;
    },
    getControlledTabId: () => selectedControlledTabId,
    isReadableBrowserTab: (tab) => typeof tab?.url === "string" && /^https?:\/\//i.test(tab.url),
    setControlledTabId: (tabId) => {
      selectedControlledTabId = tabId;
      events.push(["set-controlled", tabId]);
    },
  });
  return {
    events,
    getControlledTabId: () => selectedControlledTabId,
    getSnapshotCleared: () => snapshotCleared,
    targets,
  };
}

test("control tab targets prefer the existing readable controlled tab", async () => {
  const harness = createHarness({
    controlledTabId: 7,
    getTab: () => ({ id: 7, url: "https://example.com", active: false }),
  });

  const tab = await harness.targets.currentReadableControlTab();

  assert.equal(tab.id, 7);
  assert.equal(harness.getControlledTabId(), 7);
  assert.deepEqual(harness.events, [["get", 7]]);
});

test("control tab targets clear stale controlled tabs and select active readable window tab", async () => {
  const harness = createHarness({
    controlledTabId: 7,
    currentWindowTabs: [
      { id: 1, url: "chrome-extension://resonantos/src/side-panel.html", active: true },
      { id: 2, url: "https://resonantos.com", active: true },
    ],
    getTab: () => ({ id: 7, url: "chrome://extensions", active: false }),
  });

  const tab = await harness.targets.currentReadableControlTab();

  assert.equal(tab.id, 2);
  assert.equal(harness.getControlledTabId(), 2);
  assert.deepEqual(harness.events, [
    ["get", 7],
    ["set-controlled", null],
    ["query", { currentWindow: true }],
    ["set-controlled", 2],
  ]);
});

test("control tab targets update an existing readable tab when navigation is requested", async () => {
  const harness = createHarness({
    currentWindowTabs: [{ id: 4, url: "https://old.example", active: true }],
  });

  const tab = await harness.targets.ensureControlTabForUrl("https://new.example");

  assert.deepEqual(tab, { id: 4, url: "https://new.example", active: true });
  assert.equal(harness.getControlledTabId(), 4);
  assert.equal(harness.getSnapshotCleared(), 1);
  assert.ok(harness.events.some((event) => event[0] === "update" && event[1] === 4));
});

test("control tab targets create a readable tab when no browser target exists", async () => {
  const harness = createHarness();

  const tab = await harness.targets.ensureControlTabForUrl("https://resonantos.com");

  assert.deepEqual(tab, { id: 99, url: "https://resonantos.com", active: true });
  assert.equal(harness.getControlledTabId(), 99);
  assert.equal(harness.getSnapshotCleared(), 1);
  assert.ok(harness.events.some((event) => event[0] === "create"));
});
