// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
import assert from "node:assert/strict";
import test from "node:test";

import { createJsonlReader, extractAssistantText, runPiPrompt } from "../host/pi-rpc-client.mjs";

function makeFakeChild() {
  const listeners = { error: [], exit: [] };
  let stdoutData = null;
  const child = {
    stdin: { write() {}, end() {} },
    stdout: { on(ev, cb) { if (ev === "data") stdoutData = cb; } },
    stderr: { on() {} },
    on(ev, cb) { (listeners[ev] ??= []).push(cb); },
    kill() {},
  };
  return { child, emit: (line) => stdoutData?.(line), listeners };
}

test("createJsonlReader splits on LF only and tolerates CRLF and U+2028 inside strings", () => {
  const records = [];
  const read = createJsonlReader((record) => records.push(record));
  read('{"a":"x\\u2028y"}\n{"b":2}\r\n{"c":3}\n');
  assert.equal(records.length, 3);
  assert.equal(records[0].a, "x\u2028y");
  assert.equal(records[1].b, 2);
  assert.equal(records[2].c, 3);
});

test("createJsonlReader drops malformed records", () => {
  const records = [];
  const read = createJsonlReader((record) => records.push(record));
  read('not-json\n{"ok":true}\n');
  assert.deepEqual(records, [{ ok: true }]);
});

test("extractAssistantText returns the final assistant text blocks", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: [{ type: "text", text: "Hello" }, { type: "text", text: " world" }] },
  ];
  assert.equal(extractAssistantText(messages), "Hello world");
});

test("extractAssistantText returns empty string when no assistant message is present", () => {
  assert.equal(extractAssistantText([{ role: "user", content: [] }]), "");
});

test("runPiPrompt writes the prompt command and resolves allow on agent_end", async () => {
  const { child, emit } = makeFakeChild();
  let written = "";
  child.stdin.write = (s) => { written += s; };

  const pending = runPiPrompt({
    intent: "hello",
    provider: "deepseek",
    model: "deepseek/deepseek-chat",
    spawnImpl: () => child,
  });

  emit(JSON.stringify({ type: "extension_ui_request", method: "notify" }) + "\n");
  emit(JSON.stringify({ id: "dispatch-1", type: "response", command: "prompt", success: true }) + "\n");
  emit(JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "Hello." }] }] }) + "\n");

  const result = await pending;
  assert.equal(result.outcome, "allow");
  assert.equal(result.response.text, "Hello.");

  const sent = JSON.parse(written.trim());
  assert.equal(sent.type, "prompt");
  assert.equal(sent.message, "hello");
});

test("runPiPrompt denies when the process exits before agent_end", async () => {
  const { child, listeners } = makeFakeChild();
  const pending = runPiPrompt({ intent: "x", spawnImpl: () => child });
  listeners.exit.forEach((cb) => cb(1));
  const result = await pending;
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "runtime-exited");
});

test("runPiPrompt denies when spawn throws", async () => {
  const result = await runPiPrompt({ intent: "x", spawnImpl: () => { throw new Error("ENOENT"); } });
  assert.equal(result.outcome, "deny");
  assert.equal(result.reason, "spawn-failed");
});
