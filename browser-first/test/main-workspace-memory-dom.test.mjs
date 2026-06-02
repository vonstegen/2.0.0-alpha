import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  formatCount,
  memoryMetric,
  memoryResultCard,
  promotionMatchesHandoff,
  reviewMatchesHandoff,
  setMemoryStatus,
  wikiHealthCard
} from "../resonantos-side-panel-extension/src/lib/main-workspace-memory-dom.js";

function setupDom() {
  const dom = new JSDOM("<!doctype html><main id=\"root\"></main>", { url: "https://resonantos.local/" });
  globalThis.document = dom.window.document;
  return {
    cleanup: () => {
      delete globalThis.document;
    }
  };
}

test("memory DOM helpers render metrics, results, and status safely", () => {
  const { cleanup } = setupDom();
  try {
    assert.equal(formatCount(1200), "1,200");

    const metric = memoryMetric("Pages", "12", "indexed");
    assert.equal(metric.className, "memory-metric");
    assert.equal(metric.textContent, "Pages12indexed");

    const result = memoryResultCard({ title: "Augmentatism", path: "AI_MEMORY/wiki/augmentatism.md", excerpt: "Core philosophy." });
    assert.equal(result.querySelector("strong")?.textContent, "Augmentatism");
    assert.equal(result.querySelector("code")?.textContent, "AI_MEMORY/wiki/augmentatism.md");

    const status = document.createElement("p");
    setMemoryStatus(status, "Ready", "success");
    assert.equal(status.textContent, "Ready");
    assert.equal(status.dataset.tone, "success");
  } finally {
    cleanup();
  }
});

test("wiki health card renders actionable lint and refresh controls", () => {
  const { cleanup } = setupDom();
  try {
    let refreshed = false;
    let linted = false;
    const card = wikiHealthCard({
      exists: true,
      score: 72,
      pages: 42,
      issues: [{ type: "broken-link", message: "Missing target." }],
      brokenLinks: ["missing.md"],
      orphanPages: ["orphan.md"],
      index: { exists: true, entries: 40 },
      log: { exists: true, modifiedAt: "2026-06-02T10:00:00.000Z" }
    }, () => {
      refreshed = true;
    }, () => {
      linted = true;
    });

    assert.match(card.textContent, /Health 72\/100/);
    assert.match(card.textContent, /broken-link/);
    const buttons = [...card.querySelectorAll("button")];
    buttons.find((button) => button.textContent === "Refresh")?.click();
    buttons.find((button) => button.textContent === "Run Lint")?.click();
    assert.equal(refreshed, true);
    assert.equal(linted, true);
  } finally {
    cleanup();
  }
});

test("memory handoff matchers focus review and promotion artifacts deterministically", () => {
  assert.equal(reviewMatchesHandoff(
    { path: "REVIEW/requests/a.md", artifactPath: "INTAKE/a.md" },
    { initialReviewPath: "REVIEW/requests/a.md" }
  ), true);
  assert.equal(reviewMatchesHandoff(
    { path: "REVIEW/requests/a.md", artifactPath: "INTAKE/a.md" },
    { initialArtifactPath: "INTAKE/a.md" }
  ), true);
  assert.equal(reviewMatchesHandoff(
    { path: "REVIEW/requests/a.md", artifactPath: "INTAKE/a.md" },
    { initialReviewPath: "REVIEW/requests/other.md" }
  ), false);

  assert.equal(promotionMatchesHandoff(
    { promotedPage: "AI_MEMORY/wiki/page.md", path: "REVIEW/requests/a.md" },
    { initialPromotedPage: "AI_MEMORY/wiki/page.md" }
  ), true);
  assert.equal(promotionMatchesHandoff(
    { promotedPage: "AI_MEMORY/wiki/page.md", path: "REVIEW/requests/a.md" },
    { initialReviewPath: "REVIEW/requests/a.md" }
  ), true);
  assert.equal(promotionMatchesHandoff(
    { promotedPage: "AI_MEMORY/wiki/page.md", path: "REVIEW/requests/a.md" },
    { initialPromotedPage: "AI_MEMORY/wiki/other.md" }
  ), false);
});
