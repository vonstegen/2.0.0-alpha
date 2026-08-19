import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createOpenCodeSessionBrowser,
  filterSessions,
  groupSessions,
  seedEventsFromMessages,
  sessionLabel
} from "../resonantos-side-panel-extension/src/lib/opencode-session-browser.js";
import {
  applyOpenCodeEvent,
  createOpenCodeSessionState,
  normalizeOpenCodeEvent
} from "../resonantos-side-panel-extension/src/lib/opencode-session-model.js";

const NOW = new Date("2026-08-18T20:00:00Z").getTime();
const DAY = 24 * 3600 * 1000;

test("groupSessions splits Today from Older, newest first", () => {
  const { today, older } = groupSessions([
    { id: "a", updated: NOW - 2 * DAY },
    { id: "b", updated: NOW - 3600 * 1000 },
    { id: "c", updated: NOW - 60 * 1000 }
  ], NOW);
  assert.deepEqual(today.map((s) => s.id), ["c", "b"]);
  assert.deepEqual(older.map((s) => s.id), ["a"]);
});

test("filterSessions matches title and id, case-insensitive", () => {
  const sessions = [{ id: "ses_abc", title: "Fix bridge" }, { id: "ses_xyz", title: "" }];
  assert.equal(filterSessions(sessions, "BRIDGE").length, 1);
  assert.equal(filterSessions(sessions, "xyz").length, 1);
  assert.equal(filterSessions(sessions, "").length, 2);
});

test("sessionLabel falls back to a short id", () => {
  assert.equal(sessionLabel({ id: "ses_123456789", title: "" }), "Session 456789");
  assert.equal(sessionLabel({ id: "x", title: "My run" }), "My run");
});

test("browser renders groups, resumes on click, and starts new sessions", async () => {
  const dom = new JSDOM("<!doctype html><main id=\"m\"></main>");
  const doc = dom.window.document;
  const opened = [];
  let newCount = 0;
  const browser = createOpenCodeSessionBrowser({
    document: doc,
    container: doc.querySelector("#m"),
    listSessions: async () => ({ sessions: [
      { id: "ses_now", title: "Live proof", created: Date.now(), updated: Date.now() },
      { id: "ses_old", title: "July run", created: 1, updated: 1 }
    ] }),
    onOpenSession: (id) => opened.push(id),
    onNewSession: () => { newCount += 1; }
  });
  await browser.refresh();
  const rows = [...doc.querySelectorAll(".ocb-session")];
  assert.equal(rows.length, 2);
  assert.deepEqual([...doc.querySelectorAll(".ocb-group")].map((g) => g.textContent), ["Today", "Older"]);
  rows[1].click();
  assert.deepEqual(opened, ["ses_old"]);
  assert.equal(rows[1].dataset.active, "true");
  doc.querySelector(".ocb-new").click();
  assert.equal(newCount, 1);
});

test("seedEventsFromMessages replays history through the live reducer identically", () => {
  const messages = [
    { info: { id: "m1", role: "user" }, parts: [{ type: "text", text: "do the thing", id: "p1" }] },
    { info: { id: "m2", role: "assistant" }, parts: [{ type: "text", text: "done: the thing", id: "p2" }] }
  ];
  let state = createOpenCodeSessionState();
  for (const raw of seedEventsFromMessages(messages)) {
    state = applyOpenCodeEvent(state, normalizeOpenCodeEvent(raw));
  }
  // User text filtered (composer echoes it); assistant text present.
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].text, "done: the thing");
});
