#!/usr/bin/env node
// Test-bench addon server: speaks just enough of the OpenAI-compatible
// /api/v1/chat/completions surface that the bridge-side dispatcher
// (browser-first/host/external-agent-runtime-dispatcher.mjs) can route
// to it. One stub per addon — pass addonId + model on the CLI.
//
// Usage: node bench/stub.mjs <addonId> <port> <model>
//
// Args:
//   addonId  e.g. "addon.deepseek-harness"
//   port     e.g. 3080
//   model    e.g. "deepseek-chat"
//
// The first two may also come from ADDON_ID, ADDON_PORT, ADDON_MODEL
// environment variables; CLI args win.

import { createServer } from "node:http";
import { argv, env } from "node:process";

const addonId = argv[2] ?? env.ADDON_ID ?? "addon.unnamed";
const port    = Number(argv[3] ?? env.ADDON_PORT ?? "0");
const model   = argv[4] ?? env.ADDON_MODEL ?? "stub-model";

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`stub.mjs: invalid port ${argv[3] ?? env.ADDON_PORT}`);
  process.exit(2);
}

const styleNotes = {
  "addon.deepseek-harness":  "delegation packet acknowledged; would call DeepSeek API.",
  "addon.recursive-mas":      "final-answer recursive reasoning (stub).",
  "addon.reference-memory":   "memory broker contract stub; no real wiki lookup.",
};

const styleNote = styleNotes[addonId] ?? "addon stub.";

const server = createServer((req, res) => {
  // CORS preflight — extension panels occasionally probe.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, addon: addonId, model, at: new Date().toISOString() }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/v1/chat/completions") {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { body = {}; }
      const userMsg = Array.isArray(body.messages)
        ? body.messages.find((m) => m.role === "user")?.content ?? ""
        : "";
      const reply = {
        id: `stubcmpl-${addonId}-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: body.model ?? model,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content:
                `[${addonId} stub · ${model}]\n` +
                `${styleNote}\n` +
                `received ${Array.isArray(body.messages) ? body.messages.length : 0} message(s); ` +
                `last user content: ${String(userMsg).slice(0, 200)}`,
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
      };
      console.log(`[${new Date().toISOString()}] ${addonId} <- ${req.method} ${req.url}  (model=${body.model ?? model})`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not-found", path: req.url }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[stub] ${addonId} listening on http://127.0.0.1:${port} (model=${model})`);
});

function shutdown(signal) {
  console.log(`[stub] ${addonId} received ${signal}, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));