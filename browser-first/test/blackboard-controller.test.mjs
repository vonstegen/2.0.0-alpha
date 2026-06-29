import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  appendBlackboardSystemPrompt,
  createBlackboardController,
  formatBlackboardContextMessage,
  parseBlackboardMarkersFromReply,
  parseBlackboardNaturalIntent,
  parseBlackboardSlashCommand,
  processBlackboardAssistantReply
} from "../resonantos-side-panel-extension/src/lib/blackboard-controller.js";
import {
  BLACKBOARD_BLOCKED_URL,
  sanitizeBlackboardEmbedUrl,
  sanitizeBlackboardImageUrl,
  sanitizeBlackboardLinkUrl
} from "../resonantos-side-panel-extension/src/lib/blackboard-url-policy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("blackboard slash parser handles visual surface commands", () => {
  assert.deepEqual(parseBlackboardSlashCommand("/blackboard"), {
    action: "open",
    command: "open",
    payload: {},
    body: ""
  });
  assert.deepEqual(parseBlackboardSlashCommand("/doc # Title"), {
    action: "send",
    command: "document",
    payload: { markdown: "# Title" },
    body: "# Title"
  });
  assert.deepEqual(parseBlackboardSlashCommand("/show https://example.com/demo"), {
    action: "send",
    command: "embed",
    payload: { url: "https://example.com/demo" },
    body: "https://example.com/demo"
  });
  assert.deepEqual(parseBlackboardSlashCommand('/table {"headers":["A"],"rows":[["B"]]}'), {
    action: "send",
    command: "table",
    payload: { headers: ["A"], rows: [["B"]] },
    body: '{"headers":["A"],"rows":[["B"]]}'
  });
});

test("blackboard natural parser handles deterministic visual prompts", () => {
  const smile = parseBlackboardNaturalIntent("draw a smile");

  assert.equal(smile.action, "send");
  assert.equal(smile.command, "draw");
  assert.equal(smile.source, "natural");
  assert.equal(smile.payload.shapes.some((shape) => shape.type === "path"), true);
  assert.equal(smile.payload.shapes.some((shape) => shape.type === "text" && shape.text === "Smile"), true);
  assert.equal(parseBlackboardNaturalIntent("draw a conclusion"), null);
  assert.equal(parseBlackboardNaturalIntent("/draw a smile"), null);
});

test("blackboard marker parser strips protocol and records commands", () => {
  const parsed = parseBlackboardMarkersFromReply('Here is the chart.\n[BLACKBOARD:table]{"headers":["Name"],"rows":[["Alpha"]]}[/BLACKBOARD]\nDone.');
  assert.match(parsed.text, /Here is the chart/);
  assert.match(parsed.text, /Sent to Blackboard: table/);
  assert.doesNotMatch(parsed.text, /\[BLACKBOARD/);
  assert.deepEqual(parsed.commands, [
    { command: "table", payload: { headers: ["Name"], rows: [["Alpha"]] } }
  ]);
});

test("blackboard assistant processor sends each marker sequentially", async () => {
  const sent = [];
  const reply = await processBlackboardAssistantReply(
    'Display it. [BLACKBOARD:document]# Notes[/BLACKBOARD] [BLACKBOARD:draw]{"shapes":[]}[/BLACKBOARD]',
    { sendCommand: async (...args) => sent.push(args) }
  );
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], ["document", { markdown: "# Notes" }]);
  assert.deepEqual(sent[1], ["draw", { shapes: [] }]);
  assert.doesNotMatch(reply, /\[BLACKBOARD/);
});

test("blackboard system prompt is appended once", () => {
  const once = appendBlackboardSystemPrompt("Use local profile.");
  const twice = appendBlackboardSystemPrompt(once);
  assert.match(once, /Use local profile/);
  assert.match(once, /Resonant Blackboard/);
  assert.equal(twice, once);
});

test("blackboard URL policy blocks unsafe protocols", () => {
  assert.equal(sanitizeBlackboardEmbedUrl("javascript:alert(1)"), BLACKBOARD_BLOCKED_URL);
  assert.equal(sanitizeBlackboardEmbedUrl("file:///tmp/secret"), BLACKBOARD_BLOCKED_URL);
  assert.equal(sanitizeBlackboardImageUrl("data:text/html;base64,PGgxPg=="), BLACKBOARD_BLOCKED_URL);
  assert.match(sanitizeBlackboardImageUrl("data:image/png;base64,iVBORw0KGgo="), /^data:image\/png;base64,/);
  assert.equal(sanitizeBlackboardLinkUrl("javascript:alert(1)"), BLACKBOARD_BLOCKED_URL);
  assert.equal(sanitizeBlackboardEmbedUrl("https://example.com/path"), "https://example.com/path");
});

test("blackboard controller opens tab and relays commands", async () => {
  const events = [];
  const chromeApi = {
    runtime: {
      getURL: (path) => `chrome-extension://id/${path}`,
      sendMessage: async (message) => {
        events.push(["sendMessage", message]);
        return { ok: true };
      }
    },
    tabs: {
      query: async () => [],
      create: async (details) => {
        events.push(["create", details]);
        return { id: 42 };
      },
      get: async () => ({ id: 42, windowId: 7 }),
      update: async (...args) => events.push(["update", ...args])
    },
    windows: {
      update: async (...args) => events.push(["window-update", ...args])
    }
  };
  const controller = createBlackboardController({ chromeApi, relayDelayMs: 0 });

  const result = await controller.sendCommand("document", { markdown: "# Ready" });

  assert.equal(result.ok, true);
  assert.deepEqual(events[0], ["create", { url: "chrome-extension://id/src/addons/blackboard/blackboard.html", active: true }]);
  assert.equal(events.some((event) => event[0] === "sendMessage" && event[1].channel === "resonantos.blackboard.relay"), true);
});

test("blackboard context formatting avoids large inline image payloads", () => {
  const message = formatBlackboardContextMessage({
    label: "Canvas diagram",
    mode: "canvas",
    type: "image",
    content: "data:image/png;base64,AAAA"
  });
  assert.match(message, /Canvas diagram/);
  assert.match(message, /omitted from chat context/);
});

test("blackboard renderer test harness is local-verification gated", async () => {
  const source = await readFile(
    path.join(__dirname, "../resonantos-side-panel-extension/src/addons/blackboard/blackboard.js"),
    "utf8"
  );
  assert.match(source, /function shouldExposeBlackboardTestHarness\(\)/);
  assert.match(source, /params\.get\("blackboardTest"\) !== "1"/);
  assert.match(source, /hostname === "127\.0\.0\.1"/);
  assert.match(source, /hostname === "localhost"/);
  assert.match(source, /protocol === "file:"/);
  assert.match(source, /__resonantBlackboardTest/);
});

test("blackboard renderer consumes service-worker session relay records", async () => {
  const source = await readFile(
    path.join(__dirname, "../resonantos-side-panel-extension/src/addons/blackboard/blackboard.js"),
    "utf8"
  );
  assert.match(source, /let lastBlackboardRelayId = null/);
  assert.match(source, /function handleBlackboardRelayRecord\(record\)/);
  assert.match(source, /chrome\.storage\.session\.get\("blackboardRelay"\)/);
  assert.match(source, /area !== "session"/);
  assert.match(source, /changes\?\.blackboardRelay\?\.newValue/);
});
