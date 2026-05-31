import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  mainBrowserJobSnapshot,
  renderMainBrowserJobStatus
} from "../resonantos-side-panel-extension/src/lib/main-workspace-browser-jobs.js";

test("main workspace browser jobs summarize focused and queued Agent Control work", () => {
  const snapshot = mainBrowserJobSnapshot({
    activeJobId: "job-a",
    jobs: [
      {
        id: "job-a",
        goal: "Find booking slot",
        status: "running",
        pageLock: { tabId: 7, siteKey: "booking.example", url: "https://booking.example/" },
        steps: [
          { label: "Read page", state: "completed", type: "read" },
          { label: "Click slot", state: "active", type: "click" }
        ]
      },
      {
        id: "job-b",
        goal: "Research docs",
        status: "queued",
        pageLock: { tabId: 8, siteKey: "docs.example", url: "https://docs.example/" }
      }
    ],
    maxConcurrent: 2
  });

  assert.equal(snapshot.activeCount, 2);
  assert.deepEqual(snapshot.approvalJobs, []);
  assert.equal(snapshot.focusedJob.id, "job-a");
  assert.deepEqual(snapshot.scheduler.runnableQueued.map((job) => job.id), ["job-b"]);
});

test("main workspace browser jobs prioritize approval jobs when no active focus exists", () => {
  const snapshot = mainBrowserJobSnapshot({
    jobs: [
      {
        id: "job-running",
        goal: "Read background docs",
        status: "running",
        pageLock: { tabId: 4, siteKey: "docs.example", url: "https://docs.example/" }
      },
      {
        id: "job-approval",
        goal: "Review booking submit",
        status: "approval",
        pendingApproval: {
          reason: "Public submit requires human review.",
          step: { type: "click", text: "Book slot" }
        },
        pageLock: { tabId: 9, siteKey: "booking.example", url: "https://booking.example/" }
      }
    ],
    maxConcurrent: 2
  });

  assert.equal(snapshot.activeCount, 2);
  assert.deepEqual(snapshot.approvalJobs.map((job) => job.id), ["job-approval"]);
  assert.equal(snapshot.focusedJob.id, "job-approval");
});

test("main workspace browser jobs do not focus a completed active id while work remains active", () => {
  const snapshot = mainBrowserJobSnapshot({
    activeJobId: "job-done",
    jobs: [
      {
        id: "job-done",
        goal: "Finished task",
        status: "completed",
        pageLock: null
      },
      {
        id: "job-running",
        goal: "Still running",
        status: "running",
        pageLock: { tabId: 9, siteKey: "active.example", url: "https://active.example/" }
      }
    ],
    maxConcurrent: 2
  });

  assert.equal(snapshot.focusedJob.id, "job-running");
  assert.equal(snapshot.activeCount, 1);
});

test("main workspace browser jobs render monitor, focus, and stop controls", () => {
  const dom = new JSDOM(`<section id="jobs"></section>`);
  const events = [];
  const container = dom.window.document.querySelector("#jobs");

  const snapshot = renderMainBrowserJobStatus({
    activeJobId: "job-a",
    container,
    jobs: [{
      id: "job-a",
      goal: "Find booking slot",
      status: "approval",
      pageLock: { tabId: 7, siteKey: "booking.example", url: "https://booking.example/" },
      steps: [
        { label: "Read page", state: "completed", type: "read" },
        {
          label: "Submit form",
          state: "blocked",
          type: "click",
          details: {
            actionRetry: "precise-ref-retry",
            verificationRetry: "settle-reread"
          }
        }
      ]
    }],
    onCancelFocused: (job) => events.push(["cancel", job.id]),
    onFocusJob: (job) => events.push(["focus", job.id]),
    onOpenMonitor: () => events.push(["monitor"]),
    onPauseFocused: (job) => events.push(["pause", job.id])
  });

  assert.equal(snapshot.focusedJob.id, "job-a");
  assert.equal(container.hidden, false);
  assert.equal(container.dataset.status, "approval");
  assert.match(container.textContent, /Needs approval · Find booking slot/);
  assert.match(container.textContent, /1 active/);
  assert.match(container.textContent, /booking\.example · tab 7/);
  assert.match(container.textContent, /Awaiting approval/);
  assert.match(container.textContent, /Recovery: rechecked: settle-reread · retried: precise-ref-retry/);

  [...container.querySelectorAll("button")].find((button) => button.textContent === "Focus").click();
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Open monitor").click();
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Pause").click();
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Stop").click();

  assert.deepEqual(events, [
    ["focus", "job-a"],
    ["monitor"],
    ["pause", "job-a"],
    ["cancel", "job-a"]
  ]);
});

test("main workspace browser jobs render continue for stopped or paused work", () => {
  const dom = new JSDOM(`<section id="jobs"></section>`);
  const events = [];
  const container = dom.window.document.querySelector("#jobs");

  const snapshot = renderMainBrowserJobStatus({
    activeJobId: "job-paused",
    container,
    jobs: [{
      id: "job-paused",
      goal: "Continue product research",
      status: "paused",
      pageLock: null
    }],
    onContinueFocused: (job) => events.push(["continue", job.id]),
    onFocusJob: (job) => events.push(["focus", job.id]),
    onOpenMonitor: () => events.push(["monitor"])
  });

  assert.equal(snapshot.focusedJob.id, "job-paused");
  assert.match(container.textContent, /Paused · Continue product research/);
  assert.equal([...container.querySelectorAll("button")].some((button) => button.textContent === "Pause"), false);
  assert.equal([...container.querySelectorAll("button")].find((button) => button.textContent === "Open monitor").dataset.primary, undefined);
  assert.equal([...container.querySelectorAll("button")].find((button) => button.textContent === "Continue").dataset.primary, "true");

  [...container.querySelectorAll("button")].find((button) => button.textContent === "Continue").click();

  assert.deepEqual(events, [["continue", "job-paused"]]);
});

test("main workspace browser jobs surface blocker guidance for stopped work", () => {
  const dom = new JSDOM(`<section id="jobs"></section>`);
  const container = dom.window.document.querySelector("#jobs");

  const snapshot = renderMainBrowserJobStatus({
    activeJobId: "job-blocked",
    container,
    jobs: [{
      id: "job-blocked",
      goal: "Find exact booking slot",
      lastError: "calendar widget did not expose available times",
      status: "blocked",
      steps: [{
        label: "Click calendar date",
        state: "blocked",
        type: "click",
        details: {
          nextHumanAction: "Open the date picker manually, then continue the job.",
          recoveryOptions: [
            "Select a visible date before continuing",
            "Ask the site for keyboard navigation"
          ],
          uncertainty: "The page did not expose a clickable slot in the current snapshot."
        }
      }]
    }],
    onContinueFocused: () => undefined,
    onOpenMonitor: () => undefined
  });

  assert.equal(snapshot.focusedJob.id, "job-blocked");
  assert.equal(container.dataset.status, "blocked");
  assert.match(container.textContent, /Blocked · Find exact booking slot/);
  assert.match(container.textContent, /Next: Open the date picker manually, then continue the job/);
  assert.match(container.textContent, /Why stopped: The page did not expose a clickable slot/);
  assert.match(container.textContent, /Options: Select a visible date before continuing · Ask the site for keyboard navigation/);
  assert.match(container.textContent, /Last error: calendar widget did not expose available times/);
  assert.equal(container.querySelector(".main-browser-jobs-blocker")?.textContent.includes("Next:"), true);
});

test("main workspace browser jobs render per-job approval review cards", () => {
  const dom = new JSDOM(`<section id="jobs"></section>`);
  const events = [];
  const container = dom.window.document.querySelector("#jobs");

  const snapshot = renderMainBrowserJobStatus({
    activeJobId: "job-running",
    container,
    jobs: [
      {
        id: "job-running",
        goal: "Compare products",
        status: "running",
        pageLock: { tabId: 3, siteKey: "shop.example", url: "https://shop.example/" }
      },
      {
        id: "job-approval",
        goal: "Reserve appointment",
        status: "approval",
        pageLock: { tabId: 11, siteKey: "booking.example", url: "https://booking.example/" },
        pendingApproval: {
          history: [{ observation: { title: "Booking checkout", url: "https://booking.example/confirm" } }],
          reason: "Clicking Book now is a public-submit boundary.",
          step: { type: "click", text: "Book now" }
        }
      }
    ],
    onCancelFocused: (job) => events.push(["cancel", job.id]),
    onFocusJob: (job) => events.push(["focus", job.id]),
    onOpenMonitor: () => events.push(["monitor"])
  });

  assert.equal(snapshot.focusedJob.id, "job-running");
  assert.deepEqual(snapshot.approvalJobs.map((job) => job.id), ["job-approval"]);
  assert.equal(container.dataset.status, "running");
  assert.match(container.textContent, /1 approval card/);
  assert.match(container.textContent, /Reserve appointment: Book now/);
  assert.match(container.textContent, /Clicking Book now is a public-submit boundary/);
  assert.match(container.textContent, /booking\.example · tab 11 · Booking checkout/);

  const reviewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Focus review");
  reviewButton.click();

  assert.deepEqual(events, [["focus", "job-approval"]]);
});
