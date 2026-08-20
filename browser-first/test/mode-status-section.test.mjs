import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createModeStatusSection,
  describeAugmentorModeStatus,
  formatModeStatusLine
} from "../resonantos-side-panel-extension/src/lib/settings/mode-status-section.js";

test("mode status maps blocked sites to Q&A only", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "blocked",
    siteKey: "example.com"
  });

  assert.equal(status.modeLabel, "Q&A only");
  assert.equal(status.permissionLabel, "Blocked");
  assert.equal(status.explanation, "Augmentor can answer questions, but browser reads and actions are blocked for example.com.");
  assert.deepEqual(status.breakdown, [
    {
      state: "allowed",
      label: "Allowed",
      text: "Chat answers and planning that do not touch the page."
    },
    {
      state: "requires-review",
      label: "Requires review",
      text: "Change the site permission before Augmentor can inspect or operate this page."
    },
    {
      state: "blocked",
      label: "Blocked",
      text: "Page reads, clicks, typing, scrolling, submits, wallet, login, payment, credentials, signing, and public-submit actions."
    }
  ]);
});

test("mode status maps read-only sites to Q&A only with page reading", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "read-only",
    siteKey: "docs.example"
  });

  assert.equal(status.modeLabel, "Q&A only");
  assert.equal(status.permissionLabel, "Read only");
  assert.equal(status.explanation, "Augmentor may read visible page context for docs.example, but it will not click, type, scroll, or submit.");
  assert.deepEqual(status.breakdown, [
    {
      state: "allowed",
      label: "Allowed",
      text: "Q&A, summaries, page text, controls, fields, frames, and metadata."
    },
    {
      state: "requires-review",
      label: "Requires review",
      text: "Change the site permission before any browser action can run."
    },
    {
      state: "blocked",
      label: "Blocked",
      text: "Clicks, typing, scrolling, submits, wallet, login, payment, credentials, signing, and public-submit actions."
    }
  ]);
});

test("mode status maps ask-before-action to partial automation", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "ask-before-action",
    siteKey: "shop.example"
  });

  assert.equal(status.modeLabel, "Partial automation");
  assert.equal(status.permissionLabel, "Ask before action");
  assert.equal(status.explanation, "Augmentor can inspect shop.example and propose actions; each browser action needs approval.");
  assert.deepEqual(status.breakdown, [
    {
      state: "allowed",
      label: "Allowed",
      text: "Page reading, planning, and approved action-by-action execution."
    },
    {
      state: "requires-review",
      label: "Requires review",
      text: "Clicks, non-sensitive typing, scrolling, and safe submits require approval before they run."
    },
    {
      state: "blocked",
      label: "Blocked",
      text: "Wallet, login, payment, credentials, signing, personal autofill, destructive actions, and public-submit remain human-only."
    }
  ]);
});

test("mode status maps trusted site permission to delegated safe actions", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "trusted-for-safe-actions",
    siteKey: "search.example"
  });

  assert.equal(status.modeLabel, "Fully delegated");
  assert.equal(status.permissionLabel, "Trusted safe actions");
  assert.equal(status.explanation, "Augmentor may run safe browser actions on search.example without per-action approval.");
  assert.deepEqual(status.breakdown, [
    {
      state: "allowed",
      label: "Allowed",
      text: "Page reading, safe clicks, non-sensitive typing, scrolling, and search-like submits."
    },
    {
      state: "requires-review",
      label: "Requires review",
      text: "Ambiguous, risky, destructive, or externally visible actions stop for human review."
    },
    {
      state: "blocked",
      label: "Blocked",
      text: "Wallet, login, payment, credentials, signing, personal autofill, and public-submit stay gated."
    }
  ]);
});

test("mode status maps allow-safe task consent to delegated approved task class", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "ask-before-action",
    siteKey: "research.example",
    consent: {
      mode: "allow-safe",
      taskClass: "research"
    }
  });

  assert.equal(status.modeLabel, "Fully delegated");
  assert.equal(status.permissionLabel, "Ask before action");
  assert.equal(status.explanation, "Augmentor may run safe research actions for research.example without per-action approval.");
  assert.deepEqual(status.breakdown, [
    {
      state: "allowed",
      label: "Allowed",
      text: "Page reading and safe actions within the approved research task class."
    },
    {
      state: "requires-review",
      label: "Requires review",
      text: "Actions outside the approved task class or unclear targets stop for review."
    },
    {
      state: "blocked",
      label: "Blocked",
      text: "Wallet, login, payment, credentials, signing, personal autofill, and public-submit stay gated."
    }
  ]);
});

test("mode status maps allow-once task consent to one-execution delegation", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "ask-before-action",
    siteKey: "calendar.example",
    consent: {
      mode: "allow-once",
      taskClass: "booking"
    }
  });

  assert.equal(status.modeLabel, "Fully delegated");
  assert.equal(status.explanation, "Augmentor may run safe booking actions for calendar.example for this execution only.");
  assert.equal(status.breakdown[0].text, "Page reading and safe actions within the approved booking task class for this execution only.");
});

test("mode status keeps denied task consent in partial automation", () => {
  const status = describeAugmentorModeStatus({
    permissionMode: "ask-before-action",
    siteKey: "forms.example",
    consent: {
      mode: "deny",
      taskClass: "form-edit"
    }
  });

  assert.equal(status.modeLabel, "Partial automation");
  assert.equal(status.explanation, "Augmentor can inspect forms.example and propose actions; each browser action needs approval.");
});

test("mode status line is compact for side panel surfaces", () => {
  assert.equal(
    formatModeStatusLine({
      permissionMode: "trusted-for-safe-actions",
      siteKey: "example.com"
    }),
    "Mode: Fully delegated · Permission: Trusted safe actions · safe actions allowed"
  );
  assert.equal(
    formatModeStatusLine({
      permissionMode: "blocked",
      siteKey: "example.com"
    }),
    "Mode: Q&A only · Permission: Blocked · page access blocked"
  );
});

test("mode status section renders all state rows", () => {
  const dom = new JSDOM("<!doctype html><main id=\"root\"></main>");
  const section = createModeStatusSection({
    document: dom.window.document,
    status: describeAugmentorModeStatus({
      permissionMode: "ask-before-action",
      siteKey: "example.com"
    })
  });

  assert.equal(section.className, "settings-mode-status");
  assert.equal(section.querySelector("strong").textContent, "Mode: Partial automation");
  assert.match(section.textContent, /Augmentor can inspect example\.com/);
  assert.deepEqual(
    [...section.querySelectorAll("li")].map((item) => item.dataset.state),
    ["allowed", "requires-review", "blocked"]
  );
  assert.deepEqual(
    [...section.querySelectorAll("li strong")].map((item) => item.textContent),
    ["Allowed", "Requires review", "Blocked"]
  );
});
