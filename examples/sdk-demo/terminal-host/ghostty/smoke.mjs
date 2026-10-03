#!/usr/bin/env node
// Phase 5 / TH-7c manual smoke against real Ghostty.
//
// Spawns examples/sdk-demo/terminal-host/ghostty/adapter.mjs, drives
// the JSON-RPC surface end-to-end, and asserts:
//   1. createSession returns a sessionId+windowId and emits terminal.session.started
//   2. launchBootstrap runs a command in a new window and emits session.started
//   3. terminateSession closes the window and emits terminal.session.terminated
//
// Run via:
//   node --experimental-strip-types examples/sdk-demo/terminal-host/ghostty/smoke.mjs
//
// The smoke requires a running Ghostty.app at /Applications/Ghostty.app
// with the AppleScript dictionary exposed (default install).

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { existsSync } from "node:fs";

if (!existsSync("/Applications/Ghostty.app")) {
  console.error("[smoke] FAIL: /Applications/Ghostty.app not found; install Ghostty or run on a host with it");
  process.exit(1);
}

const ADAPTER_DIR = resolve("examples/sdk-demo/terminal-host/ghostty");
const ADAPTER = resolve(ADAPTER_DIR, "adapter.mjs");

const child = spawn("node", [ADAPTER], {
  cwd: ADAPTER_DIR,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    RESONANT_TERMINAL_DRIVER: "ghostty",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const notifications = [];
const responses = new Map();
let nextId = 1;

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
  // Give the adapter 1s to start its poller.
  await delay(1000);

  console.log("[smoke] createSession");
  const created = await send("createSession", { sessionId: `smoke-${randomUUID().slice(0, 8)}` });
  console.log(`[smoke]   -> ${JSON.stringify(created)}`);
  await delay(500);

  console.log("[smoke] launchBootstrap 'echo ghostty-smoke-bootstrap'");
  const grant = {
    sessionId: created.sessionId,
    token: randomUUID().replace(/-/g, "").slice(0, 43),
    purpose: "attach",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const launched = await send("launchBootstrap", {
    sessionId: `smoke-${randomUUID().slice(0, 8)}`,
    bootstrapCommand: "echo ghostty-smoke-bootstrap",
    grant,
  });
  console.log(`[smoke]   -> ${JSON.stringify(launched)}`);
  await delay(2000);

  console.log("[smoke] sendInput 'echo hello-from-ros' (degrades to immediate in 1.3.1)");
  const sent = await send("sendInput", { sessionId: created.sessionId, text: "echo hello-from-ros\n" });
  console.log(`[smoke]   -> ${JSON.stringify(sent)}`);
  await delay(500);

  console.log("[smoke] terminateSession (created)");
  const terminated = await send("terminateSession", { sessionId: created.sessionId });
  console.log(`[smoke]   -> ${JSON.stringify(terminated)}`);

  console.log("[smoke] terminateSession (launched)");
  const terminated2 = await send("terminateSession", { sessionId: launched.sessionId });
  console.log(`[smoke]   -> ${JSON.stringify(terminated2)}`);

  // Let the poller drain a few cycles.
  await delay(1500);

  const types = notifications.map((n) => n.event.type);
  console.log(`[smoke] observed ${notifications.length} notifications: ${types.join(", ")}`);

  const failures = [];
  const startedCount = types.filter((t) => t === "terminal.session.started").length;
  if (startedCount < 2) failures.push(`expected >=2 terminal.session.started (one per created/launched), got ${startedCount}`);
  const terminatedCount = types.filter((t) => t === "terminal.session.terminated").length;
  if (terminatedCount < 2) failures.push(`expected >=2 terminal.session.terminated, got ${terminatedCount}`);
  if (failures.length > 0) {
    console.error(`[smoke] FAIL: ${failures.join("; ")}`);
    child.kill("SIGTERM");
    await delay(500);
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
