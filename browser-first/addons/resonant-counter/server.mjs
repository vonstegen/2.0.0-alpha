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
const BRIDGE_TOKEN = process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? "";
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
    // SDK-DEMO-002-FIX: production token delivery. The upstream holds
    // the capability token via env (the bridge launcher passes it).
    // Inject it into the served HTML as a global so the add-on's own
    // <script> sees window.__RESONANTOS_BOOTSTRAP_TOKEN__ BEFORE its
    // first /bootstrap fetch fires. Exposure limited to loopback HTTP
    // (upstream only listens on 127.0.0.1); see
    // docs/architecture/sdk-demo-002-r-and-d-record.md §"Token
    // delivery: server-template".
    const bootstrapScript = `<script>window.__RESONANTOS_BOOTSTRAP_TOKEN__=${JSON.stringify(EXPECTED_TOKEN)};window.__RESONANTOS_BRIDGE_IDENTITY__=${JSON.stringify(BRIDGE_PUBLIC_URL)};window.__RESONANTOS_API_BASE_PATH__=${JSON.stringify(API_BASE_PATH)};</script>`;
    const templated = html.includes("<script")
      ? html.replace(/(<script\b)/i, `${bootstrapScript}$1`)
      : `${html}\n${bootstrapScript}`;
    sendHtml(res, 200, templated);
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

  // Static entry HTML — served at / and /index.html so a sandboxed
  // cross-origin iframe can load the upstream directly. Capability
  // enforcement is intentionally NOT applied here: the add-on UI must
  // render so the user can see the 403 banner when the bootstrap
  // token exchange fails.
  if (req.method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    await serveEntryHtml(req, res);
    return;
  }

  // Bootstrap endpoint: returns the bridge token + granted capability
  // tokens + apiBasePath + bridge identity so the add-on's own script
  // can authenticate its /api/<addon>/* calls directly. The bridge
  // token is included so the iframe can prove its origin to the
  // bridge (e.g. for capability re-mint if needed). The bootstrap
  // endpoint itself is gated on the harness-messaging capability so a
  // tampered iframe cannot harvest tokens without satisfying the
  // bridge capability check first.
  if (req.method === "GET" && urlPath === "/bootstrap") {
    if (!capabilityGateOk(req)) {
      sendJson(res, 403, {
        ok: false,
        error: `Missing or invalid ${REQUIRED_CAPABILITY} capability token.`,
        bridgeIdentity: BRIDGE_PUBLIC_URL
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      addon: ADDON_ID,
      apiBasePath: API_BASE_PATH,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      bridgeToken: BRIDGE_TOKEN,
      capabilityTokens: {
        [REQUIRED_CAPABILITY]: EXPECTED_TOKEN
      }
    });
    return;
  }

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
    bridgeTokenSet: Boolean(BRIDGE_TOKEN),
    apiBasePath: API_BASE_PATH
  }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}