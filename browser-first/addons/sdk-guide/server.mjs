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
// Deterministic only: no provider, no wallet, no trusted-memory writes,
// no filesystem writes, no internet.

import http from "node:http";
import process from "node:process";

const PORT = Number(process.env.RESONANTOS_BROWSER_FIRST_SDK_GUIDE_PORT ?? 47423);
const EXPECTED_TOKEN = process.env.RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN ?? "";
const BRIDGE_PUBLIC_URL = process.env.RESONANTOS_BROWSER_FIRST_SDK_GUIDE_BRIDGE_IDENTITY ?? "bridge://local";

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

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  const capabilityToken = req.headers["x-resonantos-bridge-capability-token"];

  // Parse the request body once at the top so every handler below can
  // read it without re-reading the request stream.
  let body = {};
  try { body = await readJsonBody(req); }
  catch { body = {}; }

  // Capability gate. Every route under /api/sdk-guide/* requires the
  // harness-messaging capability token. The bridge passes through the
  // host's capability header, so this is a real upstream-side check.
  const capabilityOk = EXPECTED_TOKEN && constantTimeEqual(capabilityToken ?? "", EXPECTED_TOKEN);
  if (path.startsWith("/api/sdk-guide/") && !capabilityOk) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: "harness-messaging capability token missing or invalid.",
      bridgeIdentity: BRIDGE_PUBLIC_URL
    }));
    return;
  }

  if (req.method === "GET" && path === "/api/sdk-guide/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      addon: "addon.sdk-guide",
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      startedAt,
      messageCount,
      capability: "harness-messaging"
    }));
    return;
  }

  if (req.method === "POST" && path === "/api/sdk-guide/message") {
    const message = typeof body.message === "string" ? body.message : "";
    messageCount += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      addon: "addon.sdk-guide",
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      echo: message,
      receivedAt: new Date().toISOString(),
      messageCount,
      capability: "harness-messaging",
      crossBoundaryEvidence: {
        from: "workspace iframe srcdoc",
        to: "addon upstream (this process)",
        via: "ResonantOS bridge",
        capabilityChecked: "harness-messaging"
      }
    }));
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
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: false,
      error: `Bridge route requires ${capabilityRequested} capability.`,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      capabilityRequested
    }));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: `unknown sdk-guide route ${req.method ?? "?"} ${path}` }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    event: "sdk_guide.upstream_listening",
    port: PORT,
    bridgeIdentity: BRIDGE_PUBLIC_URL,
    capabilityEnforced: "harness-messaging",
    routes: [
      "GET /api/sdk-guide/status",
      "POST /api/sdk-guide/message",
      "POST /api/sdk-guide/denied"
    ]
  }));
});
