#!/usr/bin/env node
// SDK Guide — third reference SDK workspace add-on.
//
// Demonstrates the generic workspace-add-on contract end-to-end:
//   - Listens on the port declared in addon.json (47423 by default).
//   - Verifies the inbound capability token header against the env-supplied
//     HARNESS_MESSAGING_TOKEN.
//   - Three routes, all guarded by the SAME capability token:
//     GET  /api/sdk-guide/status    -> running + bridgeIdentity + stepCount
//     POST /api/sdk-guide/message   -> deterministic echo of the message
//                                       plus cross-boundary evidence
//     POST /api/sdk-guide/denied    -> always 403, used by the tutorial
//                                       step that demonstrates "what the SDK
//                                       forbids." The denied route is the
//                                       same harness-messaging-protected
//                                       endpoint — the 403 comes from the
//                                       bridge itself rejecting an undeclared
//                                       capability, not from this process.
//
// SDK-DEMO-002 cross-origin rendering:
//   - GET / and /index.html serve the add-on HTML (with the capability
//     token templated in as window.__RESONANTOS_BOOTSTRAP_TOKEN__) so
//     the sandboxed cross-origin iframe can load this upstream directly
//     and the add-on's own <script> can authenticate its /api/<addon>/*
//     calls without needing a separate /bootstrap round-trip. The
//     /bootstrap endpoint is also exposed for add-ons that prefer the
//     fetch-the-config approach.
//   - Capability enforcement stays at the upstream boundary: every
//     /api/sdk-guide/* request is gated on the harness-messaging token.
//
// Deterministic only: no provider, no wallet, no trusted-memory writes,
// no filesystem writes, no internet.

import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.RESONANTOS_BROWSER_FIRST_SDK_GUIDE_PORT ?? 47423);
const EXPECTED_TOKEN = process.env.RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN ?? "";
const BRIDGE_PUBLIC_URL = process.env.RESONANTOS_BROWSER_FIRST_SDK_GUIDE_BRIDGE_IDENTITY ?? "bridge://local";
// SDK-DEMO-002-FIX-2: the bridge token is no longer needed by this
// upstream — capability tokens flow parent → iframe via postMessage
// (minted by the extension's renderer through the bridge's
// /api/capability-tokens endpoint). The add-on's own /api/<addon>/*
// calls are same-origin (no CORS) and authenticated with the
// capability token, not the bridge token. We deliberately do NOT
// read RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN here.
const ADDON_ID = "addon.sdk-guide";
const API_BASE_PATH = "/api/sdk-guide";
const REQUIRED_CAPABILITY = "harness-messaging";
const ENTRY_PATH = process.env.RESONANTOS_BROWSER_FIRST_SDK_GUIDE_ENTRY
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");

let messageCount = 0;
const startedAt = new Date().toISOString();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

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

async function serveEntryHtml(req, res) {
  try {
    const html = await readFile(ENTRY_PATH, "utf8");
    sendHtml(res, 200, html);
  } catch (err) {
    sendText(res, 500, `failed to load entry: ${err?.message ?? String(err)}`);
  }
}

function capabilityGateOk(req) {
  const token = String(req.headers["x-resonantos-bridge-capability-token"] ?? "");
  return Boolean(EXPECTED_TOKEN) && constantTimeEqual(token, EXPECTED_TOKEN);
}

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";

  // SDK-DEMO-002-FIX-2: OPTIONS is not a CORS preflight — we do not
  // serve CORS for this upstream. Return 404 immediately so the
  // browser sees an explicit "no such route" and refuses the
  // preflight (the iframe's same-origin fetch does not trigger
  // preflight anyway).
  if (req.method === "OPTIONS") {
    sendText(res, 404, `not found: OPTIONS ${path}`);
    return;
  }

  // SDK-DEMO-002-FIX-2: no CORS headers. The iframe is sandboxed with
  // `allow-scripts allow-same-origin`, so the iframe's origin equals
  // the upstream origin. Same-origin fetches don't trigger CORS — no
  // ACAO needed. We deliberately do NOT set Access-Control-Allow-Origin
  // (not even "null"). Only an iframe whose origin is
  // `http://127.0.0.1:<port>` can read our responses — i.e. the
  // add-on's own upstream, which is what we want.

  // SDK-DEMO-002-FIX-2: serve the add-on HTML at root so a sandboxed
  // cross-origin iframe can load this upstream directly. NO token
  // templating — the add-on receives its bootstrap config via
  // postMessage from the parent.
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    await serveEntryHtml(req, res);
    return;
  }

  // SDK-DEMO-002-FIX-2: /bootstrap endpoint REMOVED. There is no
  // production path that calls /bootstrap (the add-on's <script>
  // listens for postMessage from window.parent instead). Keeping the
  // endpoint would be a confused-deputy surface that could be hit by
  // any same-origin caller; the right call is to remove it.

  // Parse the request body once at the top so every handler below can
  // read it without re-reading the request stream.
  let body = {};
  try { body = await readJsonBody(req); }
  catch { body = {}; }

  // Capability gate. Every route under /api/sdk-guide/* requires the
  // harness-messaging capability token. The bridge passes through the
  // host's capability header, so this is a real upstream-side check.
  const capabilityOk = capabilityGateOk(req);
  if (path.startsWith("/api/sdk-guide/") && !capabilityOk) {
    sendJson(res, 403, {
      ok: false,
      error: `Missing or invalid ${REQUIRED_CAPABILITY} capability token.`,
      bridgeIdentity: BRIDGE_PUBLIC_URL
    });
    return;
  }

  if (req.method === "GET" && path === "/api/sdk-guide/status") {
    sendJson(res, 200, {
      ok: true,
      addon: ADDON_ID,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      startedAt,
      messageCount,
      capability: REQUIRED_CAPABILITY
    });
    return;
  }

  if (req.method === "POST" && path === "/api/sdk-guide/message") {
    const message = typeof body.message === "string" ? body.message : "";
    messageCount += 1;
    sendJson(res, 200, {
      ok: true,
      addon: ADDON_ID,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      echo: message,
      receivedAt: new Date().toISOString(),
      messageCount,
      capability: REQUIRED_CAPABILITY,
      crossBoundaryEvidence: {
        from: "workspace iframe cross-origin",
        to: "addon upstream (this process)",
        via: "direct iframe -> upstream (no bridge proxy)",
        capabilityChecked: REQUIRED_CAPABILITY
      }
    });
    return;
  }

  if (req.method === "POST" && path === "/api/sdk-guide/denied") {
    // This endpoint intentionally requests a capability the add-on does
    // NOT declare (e.g. wallet-signing). The bridge will reject the
    // request before it reaches this process because the bridge-side
    // capability-policy table only knows about harness-messaging for
    // this add-on. As a defense-in-depth check, this process also
    // returns 403 if a request ever does arrive.
    const capabilityRequested = typeof body?.capability === "string" ? body.capability : "wallet-signing";
    sendJson(res, 403, {
      ok: false,
      error: `Bridge route requires ${capabilityRequested} capability.`,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      capabilityRequested
    });
    return;
  }

  sendText(res, 404, `not found: ${req.method ?? "?"} ${path}`);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    event: "sdk_guide.upstream_listening",
    port: PORT,
    host: "127.0.0.1",
    entryPath: ENTRY_PATH,
    bridgeIdentity: BRIDGE_PUBLIC_URL,
    capabilityEnforced: REQUIRED_CAPABILITY,
    capabilityTokenSet: Boolean(EXPECTED_TOKEN),
    apiBasePath: API_BASE_PATH,
    routes: [
      "GET /",
      "GET /index.html",
      "GET /api/sdk-guide/status",
      "POST /api/sdk-guide/message",
      "POST /api/sdk-guide/denied"
    ]
  }));
});
