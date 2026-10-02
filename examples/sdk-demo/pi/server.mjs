import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47324;

// Per-add-on bearer token. Phase-3 (P6): the host mints this through
// `harness-registry.setGrants(...)` and delivers it via the bootstrap
// envelope; the operator hands a stable token to the server so the demo can
// be reproduced from a clean checkout. The host-only /admin/* routes accept a
// distinct admin token (operator-pinned, never delivered to the iframe) so the
// bridge can flip the in-memory deny flag without the add-on ever being able
// to do so itself.
const envBearerToken = () =>
  String(process.env.RESONANTOS_PI_BEARER_TOKEN ?? "").trim();
const argvBearerToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--pi-bearer-token") {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--pi-bearer-token=")) {
      return arg.slice("--pi-bearer-token=".length).trim();
    }
  }
  return "";
};
const envAdminToken = () =>
  String(process.env.RESONANTOS_PI_ADMIN_TOKEN ?? "").trim();
const argvAdminToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--pi-admin-token") {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--pi-admin-token=")) {
      return arg.slice("--pi-admin-token=".length).trim();
    }
  }
  return "";
};

// Like Echo and Counter, the sandboxed add-on iframe loads this HTML directly
// from the add-on's own origin (the renderer sets iframe.src =
// service.entrypoint). No CORS header is added anywhere, so cross-origin
// iframes cannot read the response. Boundary = per-origin sandbox + per-add-on
// bearer token + host-only admin token.
const INDEX_HTML_PATH = fileURLToPath(new URL("./index.html", import.meta.url));

// Expected Authorization header value for mutating routes.
const authorizedBearer = (bearerToken) => `Bearer ${bearerToken}`;

const constantTimeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
};

/**
 * Deterministic, self-contained Pi reply. This is a local demo only — it does
 * NOT call the live pi.dev (`@earendil-works/pi-coding-agent`) model. It gives
 * a warm, stable answer so the add-on lifecycle proof (grant → 200, wrong
 * token → 401, host revocation → 403) is fully reproducible from a clean
 * checkout with no external service and no provider credentials.
 */
function piReply(rawMessage) {
  const message = String(rawMessage ?? "").trim();
  const lower = message.toLowerCase();
  if (!lower) {
    return "Hi — I'm Pi. Say something and I'll answer.";
  }
  if (/\b(hi|hello|hey|howdy|good (morning|afternoon|evening))\b/.test(lower)) {
    return "Hello! I'm Pi, a personal-AI-style companion. What's on your mind?";
  }
  if (/\bwho are you\b/.test(lower) || /\bwhat are you\b/.test(lower)) {
    return "I'm the ResonantOS SDK demo add-on named Pi (pi.dev). I'm a self-contained local service that demonstrates the add-on lifecycle — grant (200), wrong token (401), and host revocation (403). I am not the live pi.dev coding harness.";
  }
  if (/\bvalue of pi\b/.test(lower) || /\bwhat is pi\b/.test(lower) || lower === "pi") {
    return "π ≈ 3.141592653589793… (and I'm a pi-shaped add-on, too).";
  }
  return `That's a good thought. You said: “${message}”. (This is a deterministic local demo reply — point this add-on at the live pi.dev harness for real answers.)`;
}

/**
 * Pi (pi.dev) upstream — an operator-started loopback HTTP service.
 *
 * This is the endpoint the manifest (`examples/sdk-demo/pi/addon.json`)
 * declares as `service.entrypoint`. The bridge NEVER spawns it; the operator
 * starts it, matching the host-aligned model (ADR-055/056). The bridge does
 * not inherit process.env into this process, and the response is deterministic
 * so the demo never depends on a live model or provider secret.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health            → { status, addon, hostGranted }
 *   GET    /                  → index.html (UI; sandboxed cross-origin in iframe)
 *   POST   /api/pi/ask        → { reply }, requires Authorization: Bearer <pi-token>
 *                                AND host policy has not revoked the network capability
 *   POST   /admin/deny { granted } → host-only revocation signal; requires Authorization: Bearer <pi-admin-token>
 *   GET    /admin/state       → host-only read of { granted, bearerConfigured }
 *
 * Status codes:
 *   200 — operation succeeded
 *   401 — caller presented a missing or wrong bearer (Pi's bearer is locked
 *         down; Echo/Counter/Guide tokens cannot authorize Pi)
 *   403 — host has revoked the grant (real host-policy result, not hard-coded)
 *   503 — server started without --pi-bearer-token; mutating calls refused
 */
export function createPiServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  bearerToken,
  adminToken,
} = {}) {
  let hostGranted = true;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", addon: "addon.resonant-pi", hostGranted }));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/state") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <pi-admin-token>." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hostGranted, bearerConfigured: Boolean(bearerToken ?? process.env.RESONANTOS_PI_ACTIVE_BEARER) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/deny") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <pi-admin-token>." }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
      catch { body = {}; }
      const nextGranted = body && typeof body.granted === "boolean" ? body.granted : false;
      hostGranted = nextGranted;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hostGranted }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pi/ask") {
      const expected = process.env.RESONANTOS_PI_ACTIVE_BEARER ?? bearerToken ?? "";
      const presented = String(req.headers.authorization ?? "");
      if (!expected) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "pi-not-configured",
            message:
              "Pi upstream started without --pi-bearer-token; no mutating calls are authorized. The host has not minted a capability token.",
          }),
        );
        return;
      }
      if (!constantTimeEqual(presented, authorizedBearer(expected))) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "pi-unauthorized",
            message:
              "Pi mutating route requires Authorization: Bearer <pi-token>. Echo/Counter/Guide bootstrap envelopes carry no such token; another add-on's token is not accepted.",
          }),
        );
        return;
      }
      if (!hostGranted) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "pi-revoked",
            message:
              "Pi mutating route is closed by host policy. The network capability for addon.resonant-pi has been revoked. Restore the grant to re-enable.",
          }),
        );
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      let message = raw;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.message === "string") message = parsed.message;
      } catch {
        /* non-JSON body is treated verbatim */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ reply: piReply(message) }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const resolvedEnvToken = envBearerToken();
  if (resolvedEnvToken) process.env.RESONANTOS_PI_ACTIVE_BEARER = resolvedEnvToken;
  const resolvedArgvToken = argvBearerToken();
  if (resolvedArgvToken) process.env.RESONANTOS_PI_ACTIVE_BEARER = resolvedArgvToken;
  const resolvedAdminEnvToken = envAdminToken();
  const resolvedAdminArgvToken = argvAdminToken();
  const resolvedAdminToken = adminToken ?? resolvedAdminEnvToken ?? resolvedAdminArgvToken;

  return {
    host,
    port,
    getHostGranted: () => hostGranted,
    setHostGranted: (g) => {
      hostGranted = Boolean(g);
    },
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          const address = server.address();
          const boundPort = address && typeof address === "object" ? address.port : port;
          resolve({ host, port: boundPort });
        });
      }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const port = Number(process.env.RESONANTOS_PI_PORT ?? DEFAULT_PORT);
  const service = createPiServer({ port });
  service.start().then(({ host: h, port: p }) => {
    const tokenStatus = process.env.RESONANTOS_PI_ACTIVE_BEARER ? "configured" : "NOT configured (mutating routes will return 503)";
    console.log(`Pi (pi.dev) listening on http://${h}:${p} (bearer token: ${tokenStatus})`);
  });
}
