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

test("browser surfaces list failures as a rail error state", async () => {
  const dom = new JSDOM("<!doctype html><main id=\"m\"></main>");
  const doc = dom.window.document;
  const browser = createOpenCodeSessionBrowser({
    document: doc,
    container: doc.querySelector("#m"),
    listSessions: async () => { throw new Error("bridge unavailable"); }
  });

  await browser.refresh();

  assert.match(doc.querySelector(".ocb-error").textContent, /bridge unavailable/);
  assert.equal(doc.querySelector(".ocb-empty"), null);
});

test("browser supports optimistic rename and confirmed delete actions", async () => {
  const dom = new JSDOM("<!doctype html><main id=\"m\"></main>");
  const doc = dom.window.document;
  const renamed = [];
  const deleted = [];
  const cleared = [];
  const confirms = [];
  const browser = createOpenCodeSessionBrowser({
    document: doc,
    container: doc.querySelector("#m"),
    listSessions: async () => ({ sessions: [
      { id: "ses_active", title: "Old title", created: Date.now(), updated: Date.now() },
      { id: "ses_other", title: "Other", created: Date.now(), updated: Date.now() }
    ] }),
    renameSession: async (id, title) => renamed.push([id, title]),
    deleteSession: async (id) => deleted.push(id),
    confirmDelete: async (session) => { confirms.push(session.id); return true; },
    onActiveDeleted: (id) => cleared.push(id)
  });

  await browser.refresh();
  browser.setActive("ses_active");

  doc.querySelector("[data-action='rename'][data-session-id='ses_active']").click();
  const input = doc.querySelector(".ocb-rename-input");
  input.value = "New title";
  doc.querySelector(".ocb-rename").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(doc.querySelector(".ocb-session[data-session-id='ses_active'] .ocb-session-title").textContent, "New title");
  assert.deepEqual(renamed, [["ses_active", "New title"]]);

  doc.querySelector("[data-action='delete'][data-session-id='ses_active']").click();
  await Promise.resolve();
  assert.deepEqual(confirms, ["ses_active"]);
  assert.deepEqual(deleted, ["ses_active"]);
  assert.deepEqual(cleared, ["ses_active"]);
  assert.equal(doc.querySelector(".ocb-session[data-session-id='ses_active']"), null);
});

test("browser renders archive action only when injected", async () => {
  const dom = new JSDOM("<!doctype html><main id=\"m\"></main>");
  const doc = dom.window.document;
  const archived = [];
  const browser = createOpenCodeSessionBrowser({
    document: doc,
    container: doc.querySelector("#m"),
    listSessions: async () => ({ sessions: [{ id: "ses_1", title: "Keep", created: Date.now(), updated: Date.now() }] }),
    archiveSession: async (id) => archived.push(id)
  });

  await browser.refresh();
  doc.querySelector("[data-action='archive'][data-session-id='ses_1']").click();
  assert.deepEqual(archived, ["ses_1"]);
});

test("seedEventsFromMessages replays history through the live reducer identically", () => {
  const messages = [
    { info: { id: "m1", role: "user" }, parts: [{ type: "text", text: "do the thing", id: "p1" }] },
    {
      info: { id: "m2", role: "assistant" },
      parts: [
        { type: "text", text: "done: the thing", id: "p2" },
        { type: "tool", id: "tool_part", callID: "call_1", tool: "shell", state: { status: "completed", input: "npm test", output: "pass" } },
        { type: "file", id: "file_part", path: "browser-first/test/x.test.mjs", added: 7, removed: 2 }
      ]
    }
  ];
  let state = createOpenCodeSessionState();
  for (const raw of seedEventsFromMessages(messages)) {
    state = applyOpenCodeEvent(state, normalizeOpenCodeEvent(raw));
  }
  // User text filtered (composer echoes it); assistant text present.
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[0].text, "done: the thing");
  assert.deepEqual(state.entries[1], {
    type: "tool",
    id: "call_1",
    tool: "shell",
    input: "npm test",
    state: "completed",
    output: "pass",
    error: ""
  });
  assert.equal(state.changedFiles["browser-first/test/x.test.mjs"].added, 7);
  assert.equal(state.changedFiles["browser-first/test/x.test.mjs"].removed, 2);
});
