import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createMainWorkspaceRailController } from "../resonantos-side-panel-extension/src/lib/main-workspace-rail-controller.js";
import {
  isRailVisibleChatSession,
  normalizedRailQuery,
  railSearchMatchesProject,
  railSearchMatchesSession
} from "../resonantos-side-panel-extension/src/lib/main-workspace-rail.js";

const session = {
  title: "DAO research",
  workspaceId: "answer",
  messages: [
    { role: "user", content: "Find governance links" },
    { role: "assistant", content: "ResonantDAO membership notes" }
  ]
};

test("main workspace rail normalizes search queries", () => {
  assert.equal(normalizedRailQuery("  DAO   Research  "), "dao research");
});

test("main workspace rail search matches session title, workspace, and message content", () => {
  assert.equal(railSearchMatchesSession(session, ""), true);
  assert.equal(railSearchMatchesSession(session, "dao research"), true);
  assert.equal(railSearchMatchesSession(session, "governance links"), true);
  assert.equal(railSearchMatchesSession(session, "opencode"), false);
});

test("main workspace rail search keeps projects visible when project name or child chat matches", () => {
  const project = { id: "project-cosmo", name: "Cosmodestiny" };
  assert.equal(railSearchMatchesProject(project, [], "cosmo"), true);
  assert.equal(railSearchMatchesProject(project, [session], "membership"), true);
  assert.equal(railSearchMatchesProject(project, [session], "unrelated"), false);
});

test("main workspace rail hides blank draft sessions from chat history", () => {
  assert.equal(isRailVisibleChatSession({ title: "New chat", messages: [] }), false);
  assert.equal(isRailVisibleChatSession({ title: "Settings", workspaceId: "settings", messages: [] }), false);
  assert.equal(isRailVisibleChatSession({ title: "Real chat", messages: [{ role: "user", content: "hello" }] }), true);
  assert.equal(isRailVisibleChatSession({ title: "Archived", archivedAt: "2026-06-02T00:00:00.000Z", messages: [{ role: "user", content: "hello" }] }), false);
});

test("main workspace rail controller renders from injected workspace state without global leakage", () => {
  const dom = new JSDOM(`
    <!doctype html>
    <button data-workspace="answer"></button>
    <button data-workspace="settings"></button>
    <button id="clear"></button>
    <ol id="projects"></ol>
    <ol id="chats"></ol>
  `);
  const document = dom.window.document;
  const sessions = [{
    id: "session-1",
    title: "Architecture review",
    workspaceId: "answer",
    projectId: "",
    pinned: false,
    unread: false,
    archivedAt: "",
    updatedAt: "2026-06-02T00:00:00.000Z",
    messages: [{ role: "user", content: "check the architecture" }]
  }];
  const projects = [{
    id: "project-1",
    name: "ResonantOS vNext",
    expanded: true,
    pinned: false,
    archivedAt: "",
    updatedAt: "2026-06-02T00:00:00.000Z"
  }];
  const controller = createMainWorkspaceRailController({
    allowedWorkspaces: new Set(["answer", "settings"]),
    chatSessionStore: {
      getActiveSessionId: () => "session-1",
      getProjects: () => projects,
      getSessions: () => sessions,
      switchSession: async () => sessions[0],
    },
    document,
    getActiveWorkspace: () => "answer",
    getRailSearchQuery: () => "",
    isRailVisibleChatSession,
    persistActiveWorkspace: async () => {},
    railChatList: document.querySelector("#chats"),
    railClearSearch: document.querySelector("#clear"),
    railProjectList: document.querySelector("#projects"),
    railSearchMatchesProject,
    railSearchMatchesSession,
    renderAll: () => {},
    setActiveWorkspaceId: () => {},
    updateConnectionLine: () => {},
    window: dom.window,
    workspaceButtons: [...document.querySelectorAll("[data-workspace]")]
  });

  assert.doesNotThrow(() => controller.renderRailNavigation());
  assert.equal(document.querySelector("[data-workspace='answer']").classList.contains("active"), true);
  assert.match(document.querySelector("#chats").textContent, /Architecture review/);
  assert.match(document.querySelector("#projects").textContent, /ResonantOS vNext/);
});
