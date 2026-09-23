// Resonant Counter — second reference SDK workspace add-on.
// Standalone HTTP server that demonstrates the workspace add-on contract:
//   - Listens on the port declared in addon.json (47422 by default).
//   - Accepts POST /api/counter/increment with body { delta } and returns
//     the new deterministic count plus bridgeIdentity + receivedAt.
//   - Accepts GET /api/counter/read and returns the current count.
//   - Verifies the inbound capability token header against the env-supplied
//     HARNESS_MESSAGING_TOKEN.
//
// SDK-DEMO-002 cross-origin rendering:
//   - GET / and GET /index.html serve the add-on HTML at the upstream
//     origin (http://127.0.0.1:<port>/). The bridge reverse-proxy is no
//     longer the iframe's load path; the iframe loads this URL directly
//     inside a sandboxed opaque-origin context.
//   - GET /bootstrap returns the bridge token + capability tokens +
//     apiBasePath + bridge identity, so the add-on's own script can
//     authenticate its /api/<addon>/* calls without round-tripping
//     through the bridge. The /api/<addon>/* routes still require the
//     capability token (enforced here) regardless of how the iframe
//     was loaded.
//   - Capability enforcement stays at the upstream boundary: every
//     /api/counter/* request is gated on the harness-messaging token.
//     This is the same check the bridge performs when proxying, so the
//     401/403 surface is unchanged regardless of render path.
//
// Like addon.resonant-echo, this server has no Core ID-specific knowledge —
// it only knows the harness-messaging capability and the /api/counter/*
// path shape that the manifest declared.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_PORT ?? 47422);
const HOST = process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_HOST ?? "127.0.0.1";
const ENTRY_PATH = process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_ENTRY
  ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
const EXPECTED_TOKEN = process.env.RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN ?? "";
const BRIDGE_PUBLIC_URL = process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_BRIDGE_IDENTITY ?? "bridge://local";
// SDK-DEMO-002-FIX-2: the bridge token is no longer needed by this
// upstream — capability tokens flow parent → iframe via postMessage
// (minted by the extension's renderer through the bridge's
// /api/capability-tokens endpoint). The add-on's own /api/<addon>/*
// calls are same-origin (no CORS) and authenticated with the
// capability token, not the bridge token. We deliberately do NOT
// read RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN here.
const ADDON_ID = "addon.resonant-counter";
const API_BASE_PATH = "/api/counter";
const REQUIRED_CAPABILITY = "harness-messaging";

let state = { count: 0 };

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

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(html),
    "cache-control": "no-store"
  });
  res.end(html);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

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
  const urlPath = url.split("?")[0] ?? "/";

  // SDK-DEMO-002-FIX-2: OPTIONS is not a CORS preflight — we do not
  // serve CORS for this upstream. Return 404 immediately so the
  // browser sees an explicit "no such route" and refuses the
  // preflight (the iframe's same-origin fetch does not trigger
  // preflight anyway).
  if (req.method === "OPTIONS") {
    sendText(res, 404, `not found: OPTIONS ${urlPath}`);
    return;
  }

  // SDK-DEMO-002-FIX-2: no CORS headers. The iframe is sandboxed with
  // `allow-scripts allow-same-origin`, so the iframe's origin equals
  // the upstream origin. Same-origin fetches don't trigger CORS — no
  // ACAO needed. We deliberately do NOT set Access-Control-Allow-Origin
  // (not even "null"). Only an iframe whose origin is
  // `http://127.0.0.1:<port>` can read our responses — i.e. the
  // add-on's own upstream, which is what we want.

  // Static entry HTML — served at / and /index.html so a sandboxed
  // cross-origin iframe can load the upstream directly. NO token
  // templating. The add-on receives its bootstrap config via
  // postMessage from the parent.
  if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    await serveEntryHtml(req, res);
    return;
  }

  // SDK-DEMO-002-FIX-2: /bootstrap endpoint REMOVED. There is no
  // production path that calls /bootstrap (the add-on's <script>
  // listens for postMessage from window.parent instead). Keeping the
  // endpoint would be a confused-deputy surface that could be hit by
  // any same-origin caller; the right call is to remove it.

  // All /api/counter/* routes require the harness-messaging token.
  if (!capabilityGateOk(req)) {
    sendJson(res, 403, {
      ok: false,
      error: `Missing or invalid ${REQUIRED_CAPABILITY} capability token.`,
      bridgeIdentity: BRIDGE_PUBLIC_URL
    });
    return;
  }

  if (req.method === "POST" && urlPath === "/api/counter/increment") {
    let body = {};
    try { body = await readJsonBody(req); }
    catch { body = {}; }
    const delta = Number(body.delta ?? 1);
    state = { count: state.count + (Number.isFinite(delta) ? delta : 1) };
    sendJson(res, 200, {
      ok: true,
      count: state.count,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      receivedAt: new Date().toISOString()
    });
    return;
  }
  if (req.method === "GET" && urlPath === "/api/counter/read") {
    sendJson(res, 200, {
      ok: true,
      count: state.count,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      receivedAt: new Date().toISOString()
    });
    return;
  }
  sendJson(res, 404, { ok: false, error: `unknown counter route ${req.method ?? "?"} ${urlPath}` });
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({
    event: "resonant_counter.upstream_listening",
    host: HOST,
    port: PORT,
    entryPath: ENTRY_PATH,
    bridgeIdentity: BRIDGE_PUBLIC_URL,
    capabilityEnforced: REQUIRED_CAPABILITY,
    capabilityTokenSet: Boolean(EXPECTED_TOKEN),
    apiBasePath: API_BASE_PATH
  }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}