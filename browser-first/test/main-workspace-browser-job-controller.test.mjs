import assert from "node:assert/strict";
import test from "node:test";

import { createMainWorkspaceBrowserJobController } from "../resonantos-side-panel-extension/src/lib/main-workspace-browser-job-controller.js";

const storageKeys = {
  activeBrowserJob: "activeBrowserJob",
  browserJobs: "browserJobs",
  pendingSidebarPrompt: "pendingSidebarPrompt"
};

function createMemoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    data,
    async get(keys) {
      if (!Array.isArray(keys)) return { ...data };
      return Object.fromEntries(keys.map((key) => [key, data[key]]));
    },
    async set(values) {
      Object.assign(data, values);
    }
  };
}

test("main workspace browser job controller opens the full monitor through sidebar prompt", async () => {
  const storage = createMemoryStorage();
  const events = [];
  const controller = createMainWorkspaceBrowserJobController({
    now: () => "2026-05-31T10:00:00.000Z",
    openSidebar: async () => events.push("sidebar"),
    storage,
    storageKeys
  });

  await controller.openMonitor();

  assert.deepEqual(storage.data.pendingSidebarPrompt, {
    createdAt: "2026-05-31T10:00:00.000Z",
    prompt: "/jobs"
  });
  assert.deepEqual(events, ["sidebar"]);
});

test("main workspace browser job controller focuses a durable browser job", async () => {
  const storage = createMemoryStorage();
  const events = [];
  const controller = createMainWorkspaceBrowserJobController({
    afterChange: () => events.push("render"),
    now: () => "2026-05-31T10:01:00.000Z",
    openSidebar: async () => events.push("sidebar"),
    storage,
    storageKeys
  });

  const result = await controller.focusJob({ id: "job-123", goal: "Find a booking slot" });

  assert.equal(result, true);
  assert.equal(storage.data.activeBrowserJob, "job-123");
  assert.deepEqual(storage.data.pendingSidebarPrompt, {
    createdAt: "2026-05-31T10:01:00.000Z",
    prompt: "/jobs focus job-123"
  });
  assert.deepEqual(events, ["render", "sidebar"]);
});

test("main workspace browser job controller cancels non-terminal jobs and releases page locks", async () => {
  const storage = createMemoryStorage({
    activeBrowserJob: "job-a",
    browserJobs: [
      {
        id: "job-a",
        goal: "Search for news",
        pageLock: { siteKey: "news.example", tabId: 5 },
        status: "running"
      },
      {
        id: "job-b",
        goal: "Completed task",
        pageLock: null,
        status: "completed"
      }
    ]
  });
  const events = [];
  const controller = createMainWorkspaceBrowserJobController({
    addSystemMessage: async (message) => events.push(["system", message]),
    afterChange: () => events.push(["render"]),
    now: () => "2026-05-31T10:02:00.000Z",
    storage,
    storageKeys
  });

  const result = await controller.cancelJob({ id: "job-a", goal: "Search for news" });

  assert.equal(result, true);
  assert.equal(storage.data.activeBrowserJob, "job-a");
  assert.deepEqual(storage.data.browserJobs[0], {
    id: "job-a",
    goal: "Search for news",
    completedAt: "2026-05-31T10:02:00.000Z",
    pageLock: null,
    status: "cancelled",
    updatedAt: "2026-05-31T10:02:00.000Z"
  });
  assert.deepEqual(events, [
    ["system", "Stopped browser job job-a: Search for news"],
    ["render"]
  ]);
});

test("main workspace browser job controller does not rewrite terminal jobs", async () => {
  const storage = createMemoryStorage({
    browserJobs: [{
      id: "job-a",
      goal: "Already blocked",
      pageLock: { siteKey: "wallet.example", tabId: 9 },
      status: "blocked"
    }]
  });
  const events = [];
  const controller = createMainWorkspaceBrowserJobController({
    addSystemMessage: async (message) => events.push(message),
    afterChange: () => events.push("render"),
    storage,
    storageKeys
  });

  const result = await controller.cancelJob({ id: "job-a", goal: "Already blocked" });

  assert.equal(result, false);
  assert.equal(storage.data.browserJobs[0].status, "blocked");
  assert.deepEqual(events, []);
});
