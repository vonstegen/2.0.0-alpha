#!/usr/bin/env node
// Resonant Echo — SDK reference harness runtime.
//
// This is the upstream that the ResonantOS bridge reverse-proxies under
// `/echo/`. The bridge forwards the original method, path, and body, and
// strips the bridge-token / capability-token headers so this process does
// not see them. We re-introduce a single capability check here to make
// the "authorized capability succeeds / unauthorized fails" boundary
// observable from the upstream side as well as the host side.
//
// The responder is intentionally deterministic:
//   - No model inference.
//   - No network access.
//   - No provider secret reads.
//   - No trusted-memory writes.
//
// Its only job is to prove the round-trip crosses the bridge.
//
// CLI:
//   RESONANT_ECHO_PORT=47321 RESONANT_ECHO_CAPABILITY_TOKEN=<...> node server.mjs
//
// Default port: 47321. Default token: empty (server still runs; all requests
// denied). The bridge launcher passes the harness-messaging token it minted.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.RESONANT_ECHO_PORT ?? 47321);
const HOST = process.env.RESONANT_ECHO_HOST ?? "127.0.0.1";
const ENTRY_PATH = process.env.RESONANT_ECHO_ENTRY
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
const REQUIRED_CAPABILITY = "harness-messaging";
const REQUIRED_CAPABILITY_TOKEN = process.env.RESONANT_ECHO_CAPABILITY_TOKEN ?? "";
const BRIDGE_IDENTITY = process.env.RESONANT_ECHO_BRIDGE_IDENTITY ?? "echo-upstream";

const startedAt = new Date().toISOString();
let messageCount = 0;

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  res.end(payload);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store"
  });
  res.end(html);
}

async function readBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > maxBytes) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const pathPart = url.split("?")[0] ?? "/";
  const capabilityToken = String(req.headers["x-resonantos-bridge-capability-token"] ?? "");

  // Capability gate. The bridge passes through the host's capability
  // header, so this is a real upstream-side authorization check. A
  // missing or mismatched token returns 403 — equivalent to the
  // bridge's own enforcement, double-checked at the add-on boundary.
  const capabilityOk = REQUIRED_CAPABILITY_TOKEN
    && constantTimeEqual(capabilityToken, REQUIRED_CAPABILITY_TOKEN);
  if (pathPart.startsWith("/api/echo/")) {
    if (!capabilityOk) {
      sendJson(res, 403, {
        ok: false,
        error: `Missing or invalid ${REQUIRED_CAPABILITY} capability token.`,
        bridgeIdentity: BRIDGE_IDENTITY
      });
      return;
    }
  }

  if (req.method === "GET" && (pathPart === "/" || pathPart === "/index.html")) {
    try {
      const html = await readFile(ENTRY_PATH, "utf8");
      sendHtml(res, 200, html);
    } catch (err) {
      sendText(res, 500, `failed to load entry: ${err.message}`);
    }
    return;
  }

  if (req.method === "GET" && pathPart === "/api/echo/status") {
    sendJson(res, 200, {
      ok: true,
      addon: "addon.resonant-echo",
      bridgeIdentity: BRIDGE_IDENTITY,
      startedAt,
      messageCount,
      capability: REQUIRED_CAPABILITY,
      upstreamHost: HOST,
      upstreamPort: PORT
    });
    return;
  }

  if (req.method === "POST" && pathPart === "/api/echo/message") {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (err) {
      sendJson(res, 400, { ok: false, error: `invalid json: ${err.message}` });
      return;
    }
    const message = typeof payload.message === "string" ? payload.message : "";
    messageCount += 1;
    sendJson(res, 200, {
      ok: true,
      addon: "addon.resonant-echo",
      bridgeIdentity: BRIDGE_IDENTITY,
      echo: message,
      receivedAt: new Date().toISOString(),
      messageCount,
      capability: REQUIRED_CAPABILITY
    });
    return;
  }

  sendText(res, 404, `not found: ${req.method} ${pathPart}`);
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: "echo.upstream_started",
    addon: "addon.resonant-echo",
    host: HOST,
    port: PORT,
    entryPath: ENTRY_PATH,
    bridgeIdentity: BRIDGE_IDENTITY,
    capabilityEnforced: REQUIRED_CAPABILITY,
    capabilityTokenSet: Boolean(REQUIRED_CAPABILITY_TOKEN)
  }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
