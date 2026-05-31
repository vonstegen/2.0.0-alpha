import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createAgentControlRunner } from "../resonantos-side-panel-extension/src/lib/agent-control-runner.js";
import { controlStepLabel } from "../resonantos-side-panel-extension/src/lib/agent-control-planner.js";
import { createBrowserJobScheduler } from "../resonantos-side-panel-extension/src/lib/browser-job-scheduler.js";
import { createBrowserJobStore } from "../resonantos-side-panel-extension/src/lib/browser-job-store.js";
import { createChatSessionStore } from "../resonantos-side-panel-extension/src/lib/chat-session-store.js";
import {
  mainBrowserJobSnapshot,
  renderMainBrowserJobStatus
} from "../resonantos-side-panel-extension/src/lib/main-workspace-browser-jobs.js";
import { planMainWorkspacePrompt } from "../resonantos-side-panel-extension/src/lib/main-workspace-prompt-router.js";
import { createSidePanelCommandRouter } from "../resonantos-side-panel-extension/src/lib/side-panel-command-router.js";

function memoryStorage(initial = {}) {
  const state = { ...initial };
  return {
    get: async (keys) => {
      if (!Array.isArray(keys)) return { ...state };
      return Object.fromEntries(keys.map((key) => [key, state[key]]));
    },
    set: async (payload) => {
      Object.assign(state, payload);
    },
    state
  };
}

const chatKeys = {
  activeSessionId: "activeSessionId",
  attachments: "attachments",
  forks: "forks",
  messages: "messages",
  model: "model",
  projects: "projects",
  sessions: "sessions",
  thinkingDepth: "thinkingDepth"
};

const jobKeys = {
  activeBrowserJob: "activeBrowserJob",
  browserJobs: "browserJobs",
  jobMonitorCollapsed: "jobMonitorCollapsed"
};

function createChatHarness(initial = {}) {
  let model = "minimax-m2.7";
  let thinkingDepth = "high";
  const storage = memoryStorage(initial);
  const store = createChatSessionStore({
    storage,
    storageKeys: chatKeys,
    getModel: () => model,
    getThinkingDepth: () => thinkingDepth,
    setModel: (value) => {
      model = value;
    },
    setThinkingDepth: (value) => {
      thinkingDepth = value;
    },
    isAllowedModel: () => true,
    isAllowedThinkingDepth: () => true,
    now: () => "2026-06-01T10:00:00.000Z",
    createId: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })()
  });
  return { storage, store };
}

function createControlHarness() {
  const events = [];
  const reports = [];
  let currentRun = null;
  let lastSnapshot = {
    title: "News Fixture",
    url: "https://news.example/",
    text: "Before search",
    controls: [{ ref: "search-1", text: "Search" }]
  };
  const snapshots = [
    lastSnapshot,
    {
      title: "News Fixture",
      url: "https://news.example/search",
      text: "World news results loaded",
      controls: [{ ref: "result-1", text: "Top story" }]
    },
    {
      title: "News Fixture",
      url: "https://news.example/search",
      text: "World news results loaded",
      controls: [{ ref: "result-1", text: "Top story" }]
    }
  ];
  let decisionIndex = 0;
  const decisions = [
    { status: "continue", thought: "Search the news page", action: { type: "click", text: "Search" } },
    { status: "done", thought: "News result page is visible", doneSummary: "Found the current news page." }
  ];

  const runner = createAgentControlRunner({
    addMessage: async (role, content) => events.push(["message", role, content]),
    appendControlStep: (step) => {
      currentRun.steps.push({ ...step, state: "pending" });
      return currentRun.steps.length - 1;
    },
    approvalBoundaryForStep: () => "safe",
    controlStepLabel,
    createBrowserJob: async ({ goal, planner, summary }) => {
      const job = {
        id: "job-acceptance",
        goal,
        pageLock: {
          tabId: 7,
          siteKey: "news.example",
          url: "https://news.example/",
          reason: "Agent Control acceptance test"
        },
        planner,
        summary
      };
      events.push(["job-created", job]);
      return job;
    },
    executeControlStep: async (step) => {
      events.push(["execute", step.type, step.text ?? step.ref ?? ""]);
      return { ok: true, clickedText: step.text ?? "" };
    },
    finishControlRun: (status, artifact = null) => {
      currentRun.status = status;
      if (artifact) currentRun.artifacts.push(artifact);
      events.push(["finish", status]);
    },
    getActiveJobId: () => currentRun?.id ?? "",
    getCurrentControlRun: () => currentRun,
    getLastSnapshot: () => lastSnapshot,
    observeControlPage: async () => {
      lastSnapshot = snapshots.shift() ?? lastSnapshot;
      events.push(["observe", lastSnapshot.text]);
      return lastSnapshot;
    },
    renderControlMonitor: () => events.push(["render"]),
    requestNextControlAction: async (request) => {
      events.push(["planner", request.goal, request.history.length]);
      return decisions[decisionIndex++] ?? { status: "done", doneSummary: "Done." };
    },
    saveControlReportToArchive: async (results, status) => {
      reports.push({ results, status });
      return { path: `BrowserFirst/AgentControl/${status}.md` };
    },
    setActivity: (...args) => events.push(["activity", ...args]),
    setPageControlOverlay: async (...args) => events.push(["overlay", ...args]),
    setPendingApproval: (approval) => events.push(["approval", approval]),
    setStatus: (status) => events.push(["status", status]),
    sleep: async () => undefined,
    startControlRun: ({ goal, plan }) => {
      currentRun = {
        id: "job-acceptance",
        artifacts: Array.isArray(plan.artifacts) ? plan.artifacts : [],
        goal,
        pageLock: plan.pageLock,
        planner: plan.source,
        status: "running",
        steps: Array.isArray(plan.steps) ? plan.steps : [],
        summary: plan.summary
      };
      events.push(["start", goal]);
    },
    taskConsentForStep: async () => null,
    updateBrowserJob: async (jobId, patch) => events.push(["job-updated", jobId, patch]),
    updateControlRunArtifacts: (artifacts) => {
      currentRun.artifacts = artifacts;
    },
    updateControlStep: (index, state, note = "", details = {}) => {
      currentRun.steps[index] = {
        ...currentRun.steps[index],
        details: { ...(currentRun.steps[index]?.details ?? {}), ...details },
        note,
        state
      };
      events.push(["step", index, state, note]);
    }
  });

  return {
    events,
    reports,
    router: createSidePanelCommandRouter({
      bindMentionedTab: async () => events.push(["bind"]),
      runControlCommand: runner.runControlCommand,
      runChatTurn: async () => events.push(["chat-fallback"]),
      cancelBrowserJob: async () => undefined,
      approveControlPreflight: async () => undefined,
      continueBrowserJob: async () => undefined,
      clickActivePageText: async () => undefined,
      denyControlPreflight: async () => undefined,
      detectActivePageForms: async () => undefined,
      explainStructuredPageEditBoundary: async () => undefined,
      handleWalletBoundary: async () => undefined,
      openBrowserUrl: async () => undefined,
      pauseBrowserJob: async () => undefined,
      prepareDaoWorkflowGuidance: async () => undefined,
      resumeBrowserJob: async () => undefined,
      runBrowserCommand: async () => undefined,
      runCapabilitiesCommand: async () => undefined,
      runDelegateCommand: async () => undefined,
      runDelegationsCommand: async () => undefined,
      runDraftAddonCommand: async () => undefined,
      runGoalCommand: async () => undefined,
      runHermesStatusCommand: async () => undefined,
      runHistorySearchCommand: async () => undefined,
      runJobsCommand: async () => undefined,
      runMemorySearchCommand: async () => undefined,
      runNaturalDelegationCommand: async () => undefined,
      reportBrowserJob: async () => undefined,
      runSitePermissionCommand: async () => undefined,
      runStatusCommand: async () => undefined,
      runWalletStatusCommand: async () => undefined,
      saveWalletDaoAuditToArchive: async () => undefined,
      saveIntake: async () => undefined,
      scrollActivePage: async () => undefined,
      searchBrowser: async () => undefined,
      summarizeSnapshot: async () => undefined,
      typeIntoActivePage: async () => undefined
    }),
    run: () => currentRun
  };
}

test("acceptance: fresh main chat routes current-news request into Agent Control instead of provider chat", async () => {
  const chat = createChatHarness({
    [chatKeys.activeSessionId]: "old-session",
    [chatKeys.sessions]: [{
      id: "old-session",
      title: "Old browser task",
      workspaceId: "answer",
      messages: [{ id: "old-message", role: "user", content: "old browser task" }]
    }]
  });
  await chat.store.hydrate();
  const fresh = await chat.store.ensureFreshSession();

  assert.notEqual(fresh.id, "old-session");
  assert.equal(chat.store.getMessages().length, 0);

  const prompt = "hey what's the most important news in the world today?";
  await chat.store.addMessage("user", prompt);
  const plan = planMainWorkspacePrompt(prompt);
  assert.equal(plan.action, "control");

  const control = createControlHarness();
  await control.router.respondToCommand(`/control ${prompt}`);

  assert.equal(control.events.some((event) => event[0] === "chat-fallback"), false);
  assert.equal(control.run().status, "completed");
  assert.deepEqual(control.run().steps.map((step) => step.state), ["completed"]);
  assert.ok(control.events.some((event) => event[0] === "job-created" && event[1].pageLock.siteKey === "news.example"));
  assert.ok(control.events.some((event) => event[0] === "message" && /Agent Control Mode completed/.test(event[2])));
  assert.equal(control.reports.at(-1).status, "completed");
});

test("acceptance: parallel browser jobs run only when their page locks and capacity allow it", async () => {
  const storage = memoryStorage({
    [jobKeys.activeBrowserJob]: "approval-job",
    [jobKeys.browserJobs]: [
      {
        id: "approval-job",
        goal: "Review DAO form",
        status: "approval",
        pendingApproval: {
          reason: "Public submit requires human approval.",
          step: { type: "click", text: "Submit proposal" },
          stepIndex: 0
        },
        pageLock: { tabId: 1, siteKey: "dao.example", url: "https://dao.example/" }
      },
      {
        id: "queued-locked",
        goal: "Continue DAO task",
        status: "queued",
        pageLock: { tabId: 2, siteKey: "dao.example", url: "https://dao.example/vote" }
      },
      {
        id: "queued-open",
        goal: "Read docs task",
        status: "queued",
        pageLock: { tabId: 3, siteKey: "docs.example", url: "https://docs.example/" }
      }
    ],
    [jobKeys.jobMonitorCollapsed]: false
  });
  const store = createBrowserJobStore({
    storage,
    storageKeys: jobKeys,
    now: () => "2026-06-01T10:00:00.000Z"
  });
  await store.hydrate();

  const scheduler = createBrowserJobScheduler({
    browserJobStore: store,
    maxConcurrent: 2,
    runJob: async (job) => ({ ok: true, jobId: job.id })
  });
  const result = await scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(result.startedJobs.map((job) => job.id), ["queued-open"]);
  assert.equal(store.findJob("queued-open").status, "completed");
  assert.equal(store.findJob("queued-locked").status, "queued");
  assert.equal(store.findJob("approval-job").status, "approval");

  const snapshot = mainBrowserJobSnapshot({
    activeJobId: store.getActiveJobId(),
    jobs: store.getJobs(),
    maxConcurrent: 2
  });
  assert.equal(snapshot.focusedJob.id, "approval-job");
  assert.equal(snapshot.approvalJobs.length, 1);
  assert.equal(snapshot.scheduler.lockBlockedQueued[0].id, "queued-locked");

  const dom = new JSDOM("<section></section>");
  const rendered = renderMainBrowserJobStatus({
    activeJobId: store.getActiveJobId(),
    container: dom.window.document.querySelector("section"),
    jobs: store.getJobs(),
    maxConcurrent: 2,
    onFocusJob: () => undefined,
    onOpenMonitor: () => undefined,
    onCancelFocused: () => undefined
  });
  assert.equal(rendered.approvalJobs.length, 1);
  assert.match(dom.window.document.body.textContent, /Approval required|approval card|Public submit requires human approval/);
});
