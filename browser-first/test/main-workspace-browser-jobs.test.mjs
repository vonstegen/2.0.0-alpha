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
  assert.equal(snapshot.focusedJob.id, "job-a");
  assert.deepEqual(snapshot.scheduler.runnableQueued.map((job) => job.id), ["job-b"]);
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
    onOpenMonitor: () => events.push(["monitor"])
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
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Stop").click();

  assert.deepEqual(events, [
    ["focus", "job-a"],
    ["monitor"],
    ["cancel", "job-a"]
  ]);
});
