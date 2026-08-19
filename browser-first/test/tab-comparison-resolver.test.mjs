import assert from "node:assert/strict";
import test from "node:test";

import { parseTabMentions, resolveTabComparison } from "../resonantos-side-panel-extension/src/lib/tab-comparison-resolver.js";

const isReadable = (tab) => /^https?:\/\//i.test(String(tab?.url ?? ""));

// Two readable tabs plus one unreadable (internal) tab — the #220 test shape.
const twoPlusUnreadable = [
  { id: 1, title: "Alpha News", url: "https://alpha.test/" },
  { id: 2, title: "Beta Report", url: "https://beta.test/" },
  { id: 3, title: "Internal Settings", url: "chrome://settings/" }
];

test("parseTabMentions extracts every unique @tab mention in order", () => {
  assert.deepEqual(parseTabMentions("compare @Alpha, @Beta, and @Internal"), ["Alpha", "Beta", "Internal"]);
  assert.deepEqual(parseTabMentions("@Alpha @alpha"), ["Alpha"], "case-insensitive de-dup");
  assert.deepEqual(parseTabMentions("no tabs here"), []);
  assert.deepEqual(parseTabMentions(""), []);
});

test("resolveTabComparison resolves two readable tabs with title/URL provenance and skips the unreadable tab visibly", () => {
  const { items, skipped, ambiguous } = resolveTabComparison(
    "compare @Alpha, @Beta, and @Internal",
    twoPlusUnreadable,
    isReadable
  );

  // Acceptance #4: two readable tabs resolved, one unreadable skipped.
  assert.equal(items.length, 2);
  assert.equal(skipped.length, 1);
  assert.equal(ambiguous.length, 0);

  // Acceptance #2: every comparison item carries tab title/URL provenance.
  assert.equal(items[0].tabId, 1);
  assert.equal(items[0].title, "Alpha News");
  assert.equal(items[0].url, "https://alpha.test/");
  assert.equal(items[1].tabId, 2);
  assert.equal(items[1].title, "Beta Report");
  assert.equal(items[1].url, "https://beta.test/");

  // Acceptance #1: the unreadable/internal tab is skipped with a visible reason.
  assert.equal(skipped[0].mention, "Internal");
  assert.match(skipped[0].reason, /not a readable web page/);
  assert.match(skipped[0].reason, /Internal Settings/);
  assert.equal(skipped[0].url, "chrome://settings/");
});

test("resolveTabComparison asks for clarification on ambiguous mentions by listing candidate refs", () => {
  const tabs = [
    { id: 1, title: "BBC News", url: "https://bbc.co.uk/news" },
    { id: 2, title: "Reuters News", url: "https://reuters.com/news" }
  ];

  const { items, skipped, ambiguous } = resolveTabComparison("compare @news", tabs, isReadable);

  // Acceptance #3: an ambiguous reference yields candidate refs, not a silent first match.
  assert.equal(items.length, 0);
  assert.equal(skipped.length, 0);
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].mention, "news");
  assert.equal(ambiguous[0].candidates.length, 2);
  const candidateTitles = ambiguous[0].candidates.map((c) => c.title);
  assert.ok(candidateTitles.includes("BBC News"));
  assert.ok(candidateTitles.includes("Reuters News"));
  assert.equal(ambiguous[0].candidates.every((c) => c.url), true, "candidates carry URL provenance");
});

test("resolveTabComparison de-duplicates mentions that resolve to the same tab", () => {
  const { items } = resolveTabComparison("@Alpha @Alpha", twoPlusUnreadable, isReadable);
  assert.equal(items.length, 1);
  assert.equal(items[0].tabId, 1);
});

test("resolveTabComparison resolves `tab N` against readable tabs and skips out-of-range positions", () => {
  const { items, skipped } = resolveTabComparison("@tab 2", twoPlusUnreadable, isReadable);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Beta Report");

  const outOfRange = resolveTabComparison("@tab 9", twoPlusUnreadable, isReadable);
  assert.equal(outOfRange.items.length, 0);
  assert.equal(outOfRange.skipped.length, 1);
  assert.match(outOfRange.skipped[0].reason, /no readable tab at position 9/);
});

test("resolveTabComparison is deterministic for identical input", () => {
  const a = resolveTabComparison("compare @Alpha, @Beta, and @Internal", twoPlusUnreadable, isReadable);
  const b = resolveTabComparison("compare @Alpha, @Beta, and @Internal", twoPlusUnreadable, isReadable);
  assert.deepEqual(a, b);
});

test("resolveTabComparison reports an unmatched mention rather than silently resolving nothing", () => {
  const { items, skipped } = resolveTabComparison("@Nonexistent", twoPlusUnreadable, isReadable);
  assert.equal(items.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /no open tab matched this reference/);
});
