import assert from "node:assert/strict";
import test from "node:test";

import { createMainWorkspaceActionController } from "../resonantos-side-panel-extension/src/lib/main-workspace-action-controller.js";

function createHarness(overrides = {}) {
  const events = [];
  const commandInput = { value: overrides.prompt ?? "" };
  let busy = false;
  let pendingWorkspaceAction = null;
  let activeWorkspace = "answer";
  const messages = [
    { role: "user", content: "previous question" },
    { role: "assistant", content: "previous answer" }
  ];
  const browserPageActions = {
    detectWalletState: async () => {
      events.push(["wallet-status"]);
      return { ok: true };
    },
    prepareDaoWorkflowGuidance: async (goal) => events.push(["dao-guide", goal]),
    saveCurrentPageToArchive: async () => {
      events.push(["save-page"]);
      return { ok: true, reviewRequestPath: "REVIEW/page.md" };
    },
    saveResearchTrailToArchive: async (body) => {
      events.push(["save-trail", body]);
      return { ok: true, reviewRequestPath: "REVIEW/trail.md" };
    },
    saveSelectionToArchive: async () => {
      events.push(["save-selection"]);
      return { ok: true, reviewRequestPath: "REVIEW/selection.md" };
    },
    saveWalletDaoAuditToArchive: async (goal) => events.push(["dao-audit", goal]),
    summarizeCurrentPageToArchive: async () => {
      events.push(["save-summary"]);
      return { ok: true, reviewRequestPath: "REVIEW/summary.md" };
    }
  };
  const controller = createMainWorkspaceActionController({
    addMessage: async (role, content, options = {}) => {
      events.push(["message", role, content, options]);
      messages.push({ role, content, ...options });
    },
    bridgeRequest: async (route, request = {}) => {
      events.push(["bridge", route, request.body ?? null]);
      if (route === "/augmentor/chat") {
        return { content: "assistant reply", usage: { tokens: 4 } };
      }
      if (route === "/addons/delegate") {
        return { id: "task-1", path: "Tasks/task-1.md", target: request.body.target };
      }
      if (route === "/addons/delegation/start") {
        return { ok: true, status: "completed", artifact: { summary: "done" } };
      }
      if (route === "/addons/draft") {
        return { id: "draft-1", path: "Drafts/draft-1.md" };
      }
      return {};
    },
    browserPageActions,
    chatSessionStore: {
      addMessage: async (role, content, options = {}) => {
        events.push(["store-message", role, content, options]);
      },
      getMessages: () => messages
    },
    chromeApi: {
      storage: {
        local: {
          set: async (payload) => events.push(["storage-set", payload])
        }
      },
      tabs: {
        update: async (payload) => events.push(["tab-update", payload])
      }
    },
    commandInput,
    composerController: {
      resetUndoStack: (value) => events.push(["reset-undo", value])
    },
    composerNotice: {},
    getBusy: () => busy,
    getModel: () => "MiniMax 2.7",
    getPersonalizationSettings: () => ({ augmentor: { systemPrompt: "custom prompt" } }),
    getThinkingDepth: () => "high",
    openMemoryReviewQueue: () => events.push(["open-review"]),
    openSidebar: async () => events.push(["open-sidebar"]),
    persistActiveWorkspace: async () => events.push(["persist-workspace"]),
    renderAll: () => events.push(["render-all"]),
    setActiveWorkspace: (workspace) => {
      activeWorkspace = workspace;
      events.push(["workspace", workspace]);
    },
    setComposerBusy: (next) => {
      busy = Boolean(next);
      events.push(["busy", busy]);
    },
    setPendingWorkspaceAction: (action) => {
      pendingWorkspaceAction = action;
      events.push(["pending-workspace-action", action]);
    },
    updateConnectionLine: (status) => events.push(["status", status])
  });
  return { commandInput, controller, events, getActiveWorkspace: () => activeWorkspace, getPendingWorkspaceAction: () => pendingWorkspaceAction };
}

test("main workspace action controller runs provider chat with current model, depth, and system prompt", async () => {
  const harness = createHarness({ prompt: "explain the strategy" });

  await harness.controller.handleSubmit({ preventDefault() {} });

  const chatCall = harness.events.find((event) => event[0] === "bridge" && event[1] === "/augmentor/chat");
  assert.equal(chatCall[2].model, "MiniMax 2.7");
  assert.equal(chatCall[2].thinkingDepth, "high");
  assert.equal(chatCall[2].systemPrompt, "custom prompt");
  assert.equal(harness.commandInput.value, "");
  assert.ok(harness.events.some((event) => event[0] === "message" && event[1] === "assistant" && event[2] === "assistant reply"));
  assert.deepEqual(harness.events.at(-1), ["busy", false]);
});

test("main workspace action controller routes browser work into sidebar control mode", async () => {
  const harness = createHarness({ prompt: "go to https://resonantos.com and summarize it" });

  await harness.controller.handleSubmit({ preventDefault() {} });

  assert.ok(harness.events.some((event) => event[0] === "storage-set" && event[1].augmentorPendingSidebarPrompt.prompt.includes("/control")));
  assert.ok(harness.events.some((event) => event[0] === "tab-update" && event[1].url === "https://resonantos.com/"));
  assert.ok(harness.events.some((event) => event[0] === "open-sidebar"));
});

test("main workspace action controller opens memory and opencode workspaces with pending actions", async () => {
  const memory = createHarness({ prompt: "/memory augmentatism" });
  await memory.controller.handleSubmit({ preventDefault() {} });
  assert.equal(memory.getActiveWorkspace(), "memory");
  assert.deepEqual(memory.getPendingWorkspaceAction(), { workspace: "memory", query: "augmentatism" });

  const opencode = createHarness({ prompt: "/opencode inspect tests" });
  await opencode.controller.handleSubmit({ preventDefault() {} });
  assert.equal(opencode.getActiveWorkspace(), "opencode");
  assert.deepEqual(opencode.getPendingWorkspaceAction(), { workspace: "opencode", mission: "inspect tests" });
});

test("main workspace action controller delegates natural Hermes work through governed add-on route", async () => {
  const harness = createHarness({ prompt: "ask Hermes to research the add-on strategy" });

  await harness.controller.handleSubmit({ preventDefault() {} });

  const delegateCall = harness.events.find((event) => event[0] === "bridge" && event[1] === "/addons/delegate");
  assert.deepEqual(delegateCall[2], { target: "hermes", mission: "research the add-on strategy" });
  assert.ok(harness.events.some((event) => event[0] === "message" && /Boundary: the add-on receives/.test(event[2])));
});
