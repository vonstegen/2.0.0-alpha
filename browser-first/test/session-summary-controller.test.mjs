import assert from "node:assert/strict";
import test from "node:test";

import { createSessionSummaryController } from "../resonantos-side-panel-extension/src/lib/session-summary-controller.js";
import { loadSessionSummaryArtifact } from "../resonantos-side-panel-extension/src/lib/session-summary-store.js";

function createHarness(overrides = {}) {
  const events = [];
  const store = new Map();
  const tabs = overrides.tabs ?? [
    { id: 1, title: "Alpha", url: "https://alpha.test/" },
    { id: 2, title: "Beta", url: "https://beta.test/" },
    { id: 3, title: "Internal", url: "chrome://settings/" }
  ];
  const chrome = {
    tabs: {
      query: async () => tabs
    },
    storage: {
      local: {
        get: async (key) => store.has(key) ? { [key]: store.get(key) } : {},
        set: async (patch) => { for (const [k, v] of Object.entries(patch)) store.set(k, v); },
        remove: async (key) => { store.delete(key); }
      }
    }
  };
  const controller = createSessionSummaryController({
    chrome,
    isReadableBrowserTab: (tab) => /^https?:\/\//i.test(String(tab?.url ?? "")),
    addMessage: async (role, content) => events.push(["message", role, content]),
    setStatus: (status) => events.push(["status", status])
  });
  return { controller, events, chrome };
}

test("session summary controller saves a reviewable artifact from the open readable tabs on /session", async () => {
  const harness = createHarness();

  const result = await harness.controller.runSessionCommand("summary");

  assert.equal(result.ok, true);
  assert.equal(result.artifact.kind, "session-summary");
  assert.equal(result.artifact.included.length, 2, "only readable tabs are included");
  assert.equal(result.artifact.included[0].title, "Alpha");
  assert.equal(result.artifact.included[1].url, "https://beta.test/");
  assert.equal(result.artifact.included.some((t) => "text" in t), false, "no raw page content persisted");
  assert.ok(harness.events.some((e) => e[0] === "message" && /Session summary saved \(2 tab/.test(e[2])));
  assert.ok(harness.events.some((e) => e[0] === "status" && e[1] === "Session summary saved"));
});

test("session summary controller persists the artifact across a simulated reload", async () => {
  const harness = createHarness();
  await harness.controller.runSessionCommand("");

  // A fresh load (simulating an extension reload) restores the artifact.
  const restored = await loadSessionSummaryArtifact(harness.chrome);
  assert.equal(restored.kind, "session-summary");
  assert.equal(restored.included.length, 2);
  assert.equal(restored.trigger, "explicit-command");
});

test("session summary controller restores a context line on hydrate when an artifact exists", async () => {
  const harness = createHarness();
  await harness.controller.runSessionCommand("summary");

  const artifact = await harness.controller.restoreSessionContext();
  assert.equal(artifact.kind, "session-summary");
  assert.ok(harness.events.some((e) => e[0] === "message" && /Restored session context/.test(e[2]) && /2 tab/.test(e[2])));
});

test("session summary controller does not post a restore line when no artifact exists", async () => {
  const harness = createHarness();
  const artifact = await harness.controller.restoreSessionContext();
  assert.equal(artifact, null);
  assert.equal(harness.events.some((e) => e[0] === "message" && /Restored session context/.test(e[2])), false);
});

test("session summary controller deletes the artifact on /session clear and the deletion survives a reload", async () => {
  const harness = createHarness();
  await harness.controller.runSessionCommand("summary");
  assert.ok(await loadSessionSummaryArtifact(harness.chrome));

  const result = await harness.controller.runSessionCommand("clear");
  assert.equal(result.ok, true);
  assert.equal(result.deleted, true);
  assert.ok(harness.events.some((e) => e[0] === "message" && /Session summary deleted/.test(e[2]) && /will not reappear after reload/.test(e[2])));
  // Deletion honored across a reload (storage is the source of truth).
  assert.equal(await loadSessionSummaryArtifact(harness.chrome), null);
});

test("session summary controller queries the current window only (Tom's scope)", async () => {
  // Tom's review: `chrome.tabs.query({})` captures every open http(s) tab in
  // the browser, persisting unrelated personal tabs. The fix scopes to
  // `currentWindow: true` so other windows' tabs are never captured.
  const queryArgs = [];
  const events = [];
  const store = new Map();
  const chrome = {
    tabs: {
      query: async (filter) => {
        queryArgs.push(filter);
        return [{ id: 1, title: "Alpha", url: "https://alpha.test/" }];
      }
    },
    storage: {
      local: {
        get: async (key) => store.has(key) ? { [key]: store.get(key) } : {},
        set: async (patch) => { for (const [k, v] of Object.entries(patch)) store.set(k, v); },
        remove: async (key) => { store.delete(key); }
      }
    }
  };
  const controller = createSessionSummaryController({
    chrome,
    isReadableBrowserTab: (tab) => /^https?:\/\//i.test(String(tab?.url ?? "")),
    addMessage: async (role, content) => events.push(["message", role, content]),
    setStatus: () => {}
  });
  await controller.runSessionCommand("summary");
  assert.equal(queryArgs.length, 1);
  assert.equal(queryArgs[0].currentWindow, true, "currentWindow: true scoping applied");
});

test("session summary controller surfaces save failures as a user-visible message (Tom's major #4)", async () => {
  const events = [];
  const chrome = {
    tabs: {
      query: async () => [{ id: 1, title: "Alpha", url: "https://alpha.test/" }]
    },
    storage: {
      local: {
        get: async () => { throw new Error("quota exceeded"); },
        set: async () => { throw new Error("quota exceeded"); },
        remove: async () => { throw new Error("quota exceeded"); }
      }
    }
  };
  const controller = createSessionSummaryController({
    chrome,
    isReadableBrowserTab: (tab) => /^https?:\/\//i.test(String(tab?.url ?? "")),
    addMessage: async (role, content) => events.push(["message", role, content]),
    setStatus: () => {}
  });

  const saveResult = await controller.runSessionCommand("summary");
  assert.equal(saveResult.ok, false, "save returns ok:false on storage failure");
  assert.ok(events.some((e) => e[0] === "message" && /Session summary save failed/.test(e[2]) && /quota exceeded/.test(e[2])));

  const restoreResult = await controller.restoreSessionContext();
  assert.equal(restoreResult, null, "restore returns null on storage failure");
  assert.ok(events.some((e) => e[0] === "message" && /Session summary load failed/.test(e[2])));

  const clearResult = await controller.runSessionCommand("clear");
  assert.equal(clearResult.ok, false, "clear returns ok:false on storage failure");
  assert.ok(events.some((e) => e[0] === "message" && /Session summary deletion failed/.test(e[2])));
});
