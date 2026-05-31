import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  artifactCategory,
  artifactInsightsFromMarkdown,
  renderArtifactsWorkspace
} from "../resonantos-side-panel-extension/src/lib/main-workspace-artifacts.js";

function setupDom() {
  const dom = new JSDOM("<!doctype html><main id=\"root\"></main>", { url: "https://resonantos.local/" });
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  return {
    container: dom.window.document.querySelector("#root"),
    cleanup: () => {
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.Event;
    }
  };
}

test("artifacts workspace lists and previews archive intake artifacts", async () => {
  const { container, cleanup } = setupDom();
  const calls = [];
  const continued = [];
  const openedReviews = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push([route, options]);
    if (route === "/archive/intake/list") {
      return {
        root: "Memory/INTAKE",
        entries: [
          {
            path: "INTAKE/browser/job-report.md",
            title: "Browser job completed: compare a product",
            kind: "browser-job-report",
            bytes: 2048,
            modifiedAt: "2026-05-28T10:00:00.000Z",
            excerpt: "Observed, clicked, verified, and returned artifacts.",
            insights: {
              nextHumanAction: "Review the product row before continuing.",
              summary: "Blocked · 1/2 complete · 1 blocked · 50%"
            }
          },
          {
            path: "INTAKE/browser/page-summary.md",
            title: "Saved page: ResonantOS DAO",
            kind: "browser-intake",
            bytes: 1024,
            modifiedAt: "2026-05-28T11:00:00.000Z",
            excerpt: "- capturedAt: 2026-05-28T11:00:00.000Z\n- pageTitle: ResonantOS DAO\n- pageUrl: https://resonantos.com/dao/"
          },
          {
            path: "INTAKE/browser/wallet-audit.md",
            title: "Wallet / DAO Audit: DAO Vote",
            kind: "browser-intake",
            bytes: 1200,
            modifiedAt: "2026-05-28T12:00:00.000Z",
            excerpt: "# Wallet / DAO Audit\n- capturedAt: 2026-05-28T12:00:00.000Z\n- pageTitle: DAO Vote\n- pageUrl: https://dao.example/vote"
          }
        ]
      };
    }
    if (route === "/archive/intake/read") {
      if (options.body.path === "INTAKE/browser/wallet-audit.md") {
        return {
          path: options.body.path,
          title: "Wallet / DAO Audit: DAO Vote",
          kind: "browser-intake",
          bytes: 1200,
          modifiedAt: "2026-05-28T12:00:00.000Z",
          content: [
            "# Wallet / DAO Audit: DAO Vote",
            "",
            "- capturedAt: 2026-05-28T12:00:00.000Z",
            "- pageTitle: DAO Vote",
            "- pageUrl: https://dao.example/vote",
            "",
            "## Wallet Provider State",
            "Phantom Solana: available, not connected"
          ].join("\n"),
          truncated: false
        };
      }
      return {
        path: options.body.path,
        title: "Browser job completed: compare a product",
        kind: "browser-job-report",
        bytes: 2048,
        modifiedAt: "2026-05-28T10:00:00.000Z",
        content: [
          "# Browser Job Report",
          "",
          "- status: blocked",
          "",
          "## Controlled Target",
          "- targetSite: example.com",
          "- targetReason: Product comparison task",
          "",
          "## Aggregate Progress",
          "- phase: blocked",
          "- summary: Blocked · 1/2 complete · 1 blocked · 50%",
          "- percentComplete: 50",
          "",
          "## Goal",
          "compare a product",
          "",
          "## Steps",
          "1. Read page — completed",
          "2. Click details — blocked",
          "     - next human action: Review the product row before continuing."
        ].join("\n"),
        truncated: false
      };
    }
    if (route === "/archive/review/request") {
      return {
        path: "REVIEW/requests/job-report.md",
        sourceArtifactPath: options.body.path,
        status: "pending"
      };
    }
    throw new Error(`Unexpected route ${route}`);
  };

  try {
    renderArtifactsWorkspace({
      container,
      bridgeRequest,
      onContinueArtifact: async (artifact) => continued.push(artifact.path),
      onOpenReviewQueue: (review) => openedReviews.push(review.path)
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(container.textContent, /Reports and intake created by browser work/);
    assert.match(container.textContent, /All 3/);
    assert.match(container.textContent, /Browser Jobs 1/);
    assert.match(container.textContent, /Browser Intake 1/);
    assert.match(container.textContent, /Wallet \/ DAO 1/);
    assert.match(container.textContent, /Browser job completed/);
    assert.match(container.textContent, /# Browser Job Report/);
    assert.match(container.textContent, /Next: Review the product row before continuing/);
    assert.match(container.textContent, /Source: ResonantOS DAO · https:\/\/resonantos\.com\/dao\//);
    assert.match(container.textContent, /Action Summary/);
    assert.match(container.textContent, /Blocked · 1\/2 complete · 1 blocked · 50%/);
    assert.match(container.textContent, /example.com · Product comparison task/);
    assert.ok(calls.some(([route]) => route === "/archive/intake/list"));
    assert.ok(calls.some(([route, options]) => route === "/archive/intake/read" && options.body.path === "INTAKE/browser/job-report.md"));

    [...container.querySelectorAll(".artifact-filters button")]
      .find((button) => button.textContent === "Wallet / DAO 1")
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(container.textContent, /1\/3 artifact\(s\) shown/);
    assert.match(container.textContent, /Wallet \/ DAO Audit: DAO Vote/);
    assert.match(container.textContent, /SourceDAO Vote · https:\/\/dao\.example\/vote/);
    assert.match(container.textContent, /Captured2026-05-28T12:00:00.000Z/);

    [...container.querySelectorAll(".artifact-filters button")]
      .find((button) => button.textContent === "All 3")
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    container.querySelector(".artifact-row").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(calls.filter(([route]) => route === "/archive/intake/read").length >= 4);

    const [copyPath, requestReview, continueFrom] = container.querySelectorAll(".artifact-actions button");
    assert.equal(copyPath.textContent, "Copy Path");
    requestReview.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(calls.some(([route, options]) => route === "/archive/review/request" && options.body.path === "INTAKE/browser/job-report.md"));
    assert.match(container.textContent, /Review request created: REVIEW\/requests\/job-report\.md\. Next: open the Living Archive review queue/);
    assert.match(container.textContent, /Next: inspect this artifact in Living Archive review/);
    assert.match(container.textContent, /trusted AI Memory changes happen only after draft, verify, and promote/);
    Array.from(container.querySelectorAll(".artifact-review-handoff button"))
      .find((button) => button.textContent === "Open Review Queue")
      .click();
    assert.deepEqual(openedReviews, ["REVIEW/requests/job-report.md"]);

    continueFrom.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(continued, ["INTAKE/browser/job-report.md"]);
  } finally {
    cleanup();
  }
});

test("artifacts workspace classifies artifact categories", () => {
  assert.equal(artifactCategory({ kind: "browser-control-report" }), "agent-control");
  assert.equal(artifactCategory({ kind: "browser-job-report" }), "browser-job");
  assert.equal(artifactCategory({ kind: "browser-intake", excerpt: "- pageUrl: https://example.com" }), "browser-intake");
  assert.equal(artifactCategory({ title: "Wallet / DAO Audit", excerpt: "# Wallet / DAO Audit" }), "wallet-dao");
  assert.equal(artifactCategory({ kind: "intake" }), "intake");
});

test("artifacts workspace extracts wallet and DAO audit summaries", () => {
  const insights = artifactInsightsFromMarkdown([
    "# Wallet / DAO Audit: DAO Vote",
    "",
    "- capturedAt: 2026-05-29T10:00:00.000Z",
    "- pageTitle: DAO Vote",
    "- pageUrl: https://dao.example/vote",
    "- walletProbeSource: main-world-probe",
    "- detectionOnly: yes",
    "",
    "## Wallet Provider State",
    "Phantom Solana: available, not connected",
    "",
    "## Human Boundary",
    "This artifact is read-only evidence."
  ].join("\n"));

  assert.equal(insights.evidenceType, "Wallet / DAO Audit");
  assert.equal(insights.pageUrl, "https://dao.example/vote");
  assert.equal(insights.pageTitle, "DAO Vote");
  assert.equal(insights.capturedAt, "2026-05-29T10:00:00.000Z");
  assert.equal(insights.summary, "Read-only wallet/DAO evidence queued for review");
  assert.equal(insights.walletSummary, "available, not connected");
});

test("artifacts workspace extracts progress and blocker guidance from markdown reports", () => {
  const insights = artifactInsightsFromMarkdown([
    "# Browser Agent Control Report",
    "",
    "- status: approval-required",
    "",
    "## Controlled Target",
    "- targetSite: checkout.example",
    "- targetReason: Agent Control goal: buy safely",
    "",
    "## Aggregate Progress",
    "- phase: approval",
    "- summary: Awaiting approval · 2/3 complete · 67%",
    "- percentComplete: 67",
    "",
    "## Steps",
    "3. Click submit — approval-required",
    "     - next human action: Review the form, then approve once or deny."
  ].join("\n"));

  assert.deepEqual(insights, {
    capturedAt: "",
    evidenceType: "",
    nextHumanAction: "Review the form, then approve once or deny.",
    pageTitle: "",
    pageUrl: "",
    percentComplete: "67",
    phase: "approval",
    status: "approval-required",
    summary: "Awaiting approval · 2/3 complete · 67%",
    targetReason: "Agent Control goal: buy safely",
    targetSite: "checkout.example",
    walletSummary: ""
  });
});

test("artifacts workspace reports empty intake clearly", async () => {
  const { container, cleanup } = setupDom();
  try {
    renderArtifactsWorkspace({
      container,
      bridgeRequest: async () => ({ root: "Memory/INTAKE", entries: [] })
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.match(container.textContent, /No browser reports or intake artifacts found yet/);
  } finally {
    cleanup();
  }
});
