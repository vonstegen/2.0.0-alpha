#!/usr/bin/env node
// Phase 1 manual smoke against real iTerm2.
//
// Spawns examples/sdk-demo/terminal-host/iterm2/adapter.py, drives the
// JSON-RPC surface end-to-end, and asserts:
//   1. createSession returns a sessionId and emits terminal.session.started
//   2. sendInput writes text to the iTerm2 tab and emits terminal.command.started
//   3. terminateSession closes the tab and emits terminal.session.terminated
//
// Run via:
//   node --experimental-strip-types examples/sdk-demo/terminal-host/iterm2/smoke.mjs
//
// The smoke requires a running iTerm2 instance with the iTerm2 Python
// module installed (pip install iterm2).

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const ADAPTER_DIR = resolve("examples/sdk-demo/terminal-host/iterm2");
const ADAPTER = resolve(ADAPTER_DIR, "adapter.py");

const child = spawn("python3", [ADAPTER], {
  cwd: ADAPTER_DIR,
  env: { ...process.env, RESONANT_TERMINAL_DRIVER: "iterm2" },
  stdio: ["pipe", "pipe", "pipe"],
});

const notifications = [];
const responses = new Map();
let nextId = 1;
let resolveReady;

child.stderr.on("data", (chunk) => process.stderr.write(`[adapter:err] ${chunk}`));
child.stdout.on("data", (chunk) => {
  for (const line of chunk.toString().split("\n")) {
    if (line.length === 0) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { process.stderr.write(`[bad json] ${line}\n`); continue; }
    if ("id" in msg) {
      const waiter = responses.get(msg.id);
      if (waiter) {
        responses.delete(msg.id);
        if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
        else waiter.resolve(msg.result);
      }
    } else if ("method" in msg && msg.method === "terminal.event") {
      notifications.push(msg.params);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolveP, reject) => {
    responses.set(id, { resolve: resolveP, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function main() {
  // Wait for the adapter to print anything (it doesn't print a banner,
  // but stderr is a reasonable signal that it has started). The iterm2
  // module blocks on connecting to the daemon, so we just give it 2s.
  await delay(2000);

  console.log("[smoke] createSession");
  const created = await send("createSession", { sessionId: `smoke-${randomUUID().slice(0, 8)}` });
  console.log(`[smoke]   -> ${JSON.stringify(created)}`);

  await delay(500);
  console.log("[smoke] sendInput 'echo hello-from-ros'");
  const sent = await send("sendInput", { sessionId: created.sessionId, text: "echo hello-from-ros\n" });
  console.log(`[smoke]   -> ${JSON.stringify(sent)}`);

  await delay(2000);
  console.log("[smoke] terminateSession");
  const terminated = await send("terminateSession", { sessionId: created.sessionId });
  console.log(`[smoke]   -> ${JSON.stringify(terminated)}`);

  // Let the adapter drain notifications for the last commands.
  await delay(1000);

  // Summarize
  const types = notifications.map((n) => n.event.type);
  console.log(`[smoke] observed ${notifications.length} notifications: ${types.join(", ")}`);

  // Assertions
  const failures = [];
  if (!types.includes("terminal.session.started")) failures.push("missing terminal.session.started");
  if (!types.includes("terminal.command.started")) failures.push("missing terminal.command.started");
  if (!types.includes("terminal.session.terminated")) failures.push("missing terminal.session.terminated");
  if (failures.length > 0) {
    console.error(`[smoke] FAIL: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("[smoke] PASS");
  child.kill("SIGTERM");
  await delay(500);
}

main().catch((error) => {
  console.error(`[smoke] error: ${error?.message ?? error}`);
  child.kill("SIGKILL");
  process.exit(1);
});
