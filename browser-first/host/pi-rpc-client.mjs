// pi.dev harness RPC client. Drives `pi --mode rpc` over strict LF-delimited
// JSONL on stdin/stdout and resolves the final assistant text at `agent_end`.
//
// The wire protocol is documented in the pi-coding-agent package at
// docs/rpc.md: commands are JSON objects on stdin (one per line), responses
// are `{ "type": "response", "command": ..., "success": ... }`, and events
// stream to stdout as JSON lines. `agent_end` carries the full `messages`
// array. `extension_ui_request` records are startup/notification noise and are
// ignored here.
//
// Framing: split on `\n` ONLY. `node:readline` is NOT protocol-compliant
// because it also splits on U+2028/U+2029, which are legal inside JSON strings.

import { spawn } from "node:child_process";

/**
 * Return a chunk-feeding function that emits each complete LF-delimited JSON
 * record to `onRecord`. Malformed lines are dropped (they cannot be trusted
 * into the governed dispatch path).
 */
export function createJsonlReader(onRecord) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const record = line.endsWith("\r") ? line.slice(0, -1) : line;
      if (!record.trim()) continue;
      let parsed;
      try {
        parsed = JSON.parse(record);
      } catch {
        continue;
      }
      onRecord(parsed);
    }
  };
}

/**
 * Extract the final assistant text from an `agent_end` messages array.
 * Messages are AgentMessage objects; text lives in `content` blocks of
 * `{ type: "text", text }`. Returns "" when no assistant text is present.
 */
export function extractAssistantText(messages) {
  const assistant = [...(messages ?? [])].reverse().find((m) => m?.role === "assistant");
  if (!assistant) return "";
  return (assistant.content ?? [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/**
 * Run one prompt through `pi --mode rpc` and resolve the assistant text.
 * Fails closed: any spawn failure, premature exit, or timeout returns
 * `{ outcome: "deny", reason, detail }`. `spawnImpl` is injectable for tests.
 */
export function runPiPrompt({
  intent,
  command = "pi",
  provider = "",
  model = "",
  env = {},
  timeoutMs = 120000,
  spawnImpl = spawn,
}) {
  const args = ["--mode", "rpc", "--no-session"];
  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
    } catch (error) {
      resolve({ outcome: "deny", reason: "spawn-failed", detail: String(error) });
      return;
    }

    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve(outcome);
    };
    const timer = setTimeout(
      () => finish({ outcome: "deny", reason: "timeout", detail: `pi RPC timed out after ${timeoutMs}ms` }),
      timeoutMs,
    );

    const read = createJsonlReader((record) => {
      if (record.type === "agent_end") {
        finish({
          outcome: "allow",
          response: { text: extractAssistantText(record.messages), messages: record.messages },
        });
      }
    });

    child.stdout.on("data", (chunk) => read(String(chunk)));
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish({ outcome: "deny", reason: "spawn-failed", detail: String(error) }));
    child.on("exit", (code) =>
      finish({ outcome: "deny", reason: "runtime-exited", detail: `pi exited code ${code} before agent_end` }),
    );

    child.stdin.write(`${JSON.stringify({ id: "dispatch-1", type: "prompt", message: intent })}\n`);
  });
}
