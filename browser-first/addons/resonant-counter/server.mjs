// Resonant Counter — second reference SDK workspace add-on.
// Standalone HTTP server that demonstrates the workspace add-on contract:
//   - Listens on the port declared in addon.json (47422 by default).
//   - Accepts POST /api/counter/increment with body { delta } and returns
//     the new deterministic count plus bridgeIdentity + receivedAt.
//   - Accepts GET /api/counter/read and returns the current count.
//   - Verifies the inbound capability token header against the env-supplied
//     HARNESS_MESSAGING_TOKEN.
//
// Like addon.resonant-echo, this server has no Core ID-specific knowledge —
// it only knows the harness-messaging capability and the /api/counter/* path
// shape that the manifest declared.

import http from "node:http";
import process from "node:process";

const PORT = Number(process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_PORT ?? 47422);
const EXPECTED_TOKEN = process.env.RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN ?? "";
const BRIDGE_PUBLIC_URL = process.env.RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_BRIDGE_IDENTITY ?? "bridge://local";

let state = { count: 0 };

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

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  const capabilityToken = req.headers["x-resonantos-bridge-capability-token"];
  if (capabilityToken !== EXPECTED_TOKEN) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "harness-messaging capability token missing or invalid." }));
    return;
  }

  if (req.method === "POST" && path === "/api/counter/increment") {
    let body = {};
    try { body = await readJsonBody(req); }
    catch { body = {}; }
    const delta = Number(body.delta ?? 1);
    state = { count: state.count + (Number.isFinite(delta) ? delta : 1) };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      count: state.count,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      receivedAt: new Date().toISOString()
    }));
    return;
  }
  if (req.method === "GET" && path === "/api/counter/read") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      count: state.count,
      bridgeIdentity: BRIDGE_PUBLIC_URL,
      receivedAt: new Date().toISOString()
    }));
    return;
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: `unknown counter route ${req.method ?? "?"} ${path}` }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({
    event: "resonant_counter.upstream_listening",
    port: PORT,
    bridgeIdentity: BRIDGE_PUBLIC_URL
  }));
});
