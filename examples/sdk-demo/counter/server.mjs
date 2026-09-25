import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47322;

// Per-add-on bearer token. Phase-3 (P6): the host mints this through
// `harness-registry.setGrants(...)` and delivers it via the bootstrap
// envelope; the operator hands a stable token to the server so the demo can
// be reproduced from a clean checkout. The host-only /admin/* routes accept a
// distinct admin token (operator-pinned, never delivered to the iframe) so the
// bridge can flip the in-memory deny flag without the add-on ever being able
// to do so itself.
const envBearerToken = () =>
  String(process.env.RESONANTOS_COUNTER_BEARER_TOKEN ?? "").trim();
const argvBearerToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === `--counter-bearer-token`) {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--counter-bearer-token=")) {
      return arg.slice("--counter-bearer-token=".length).trim();
    }
  }
  return "";
};
const envAdminToken = () =>
  String(process.env.RESONANTOS_COUNTER_ADMIN_TOKEN ?? "").trim();
const argvAdminToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === `--counter-admin-token`) {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--counter-admin-token=")) {
      return arg.slice("--counter-admin-token=".length).trim();
    }
  }
  return "";
};

// Like Echo, the sandboxed add-on iframe loads this HTML directly from the
// add-on's own origin (the renderer sets iframe.src = service.entrypoint). No
// CORS header is added anywhere, so cross-origin iframes cannot read the
// response. Boundary = per-origin sandbox + per-add-on bearer token +
// host-only admin token.
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
 * Resonant Counter upstream — operator-started loopback HTTP service.
 *
 * Stateless-from-host: the counter value lives in this server's memory only.
 * The host NEVER reads or writes the value; the bootstrap envelope tells the
 * iframe its per-add-on bearer token, and every mutating request from the
 * iframe must carry that token in the Authorization header. Echo's manifest
 * declares a different (or no) bearer token, so Echo's bootstrap envelope
 * cannot grant a token that Counter accepts, and vice versa. The cross-origin
 * boundary (no ACAO) keeps cross-iframe calls out.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health                          → { status, addon, value }
 *   GET    /                                → index.html (UI; sandboxed cross-origin in iframe)
 *   GET    /api/counter/value               → { value } (public read; UI uses it)
 *   POST   /api/counter/increment           → { value }, requires Authorization: Bearer <counter-token>
 *                                              AND host policy has not revoked the network capability
 *   POST   /api/counter/decrement           → { value }, requires Authorization: Bearer <counter-token>
 *                                              AND host policy has not revoked the network capability
 *   POST   /api/counter/reset               → { value: 0 }, requires Authorization: Bearer <counter-token>
 *                                              AND host policy has not revoked the network capability
 *   POST   /admin/deny   { granted: bool }  → host-only revocation signal; requires Authorization: Bearer <counter-admin-token>
 *   GET    /admin/state                     → host-only read of { granted: bool, bearerConfigured: bool }
 *
 * Status codes:
 *   200 — operation succeeded
 *   401 — caller presented a missing or wrong bearer (the add-on's bearer
 *         surface is locked down; Echo's bearer cannot authorize Counter)
 *   403 — host has revoked the grant; caller has a valid bearer but the
 *         network capability was withdrawn by the host (real host-policy
 *         result, not a hard-coded 403)
 *   503 — server was started without --counter-bearer-token; no mutating
 *         calls are authorized. Discovery step of the isolation proof.
 */
export function createCounterServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  initialValue = 0,
  bearerToken,
  adminToken,
} = {}) {
  let value = Number.isInteger(initialValue) ? initialValue : 0;
  // Host-revocable in-memory flag. Flipped by POST /admin/deny; cleared by
  // the same route with { granted: true }. The bridge calls this when the
  // operator revokes the network capability for addon.resonant-counter.
  let hostGranted = true;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", addon: "addon.resonant-counter", value, hostGranted }));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/counter/value") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ value }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/admin/state") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <counter-admin-token>." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hostGranted, bearerConfigured: Boolean(bearerToken ?? process.env.RESONANTOS_COUNTER_ACTIVE_BEARER) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/deny") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <counter-admin-token>." }));
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

    if (
      req.method === "POST" &&
      (url.pathname === "/api/counter/increment" ||
        url.pathname === "/api/counter/decrement" ||
        url.pathname === "/api/counter/reset")
    ) {
      const expected = process.env.RESONANTOS_COUNTER_ACTIVE_BEARER ?? bearerToken ?? "";
      const presented = String(req.headers.authorization ?? "");
      if (!expected) {
        // Server was started without an operator-pinned token: refuse all
        // mutating requests. Discovering this is part of the isolation proof
        // — the test passes --counter-bearer-token to opt in.
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "counter-not-configured",
            message:
              "Counter upstream started without --counter-bearer-token; no mutating calls are authorized. This is the isolation guarantee: callers without the operator-pinned token cannot drive the counter.",
          }),
        );
        return;
      }
      if (!constantTimeEqual(presented, authorizedBearer(expected))) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "counter-unauthorized",
            message:
              "Counter mutating route requires Authorization: Bearer <counter-token>. Echo's bootstrap envelope carries no such token; another add-on's token is not accepted.",
          }),
        );
        return;
      }
      // 403 — host has withdrawn the grant. The bearer is valid; the policy
      // is closed. This is the real host-policy revocation result.
      if (!hostGranted) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "counter-revoked",
            message:
              "Counter mutating route is closed by host policy. The network capability for addon.resonant-counter has been revoked. Restore the grant to re-enable.",
          }),
        );
        return;
      }
      if (url.pathname === "/api/counter/increment") value += 1;
      else if (url.pathname === "/api/counter/decrement") value -= 1;
      else value = 0;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ value }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const resolvedEnvToken = envBearerToken();
  if (resolvedEnvToken) process.env.RESONANTOS_COUNTER_ACTIVE_BEARER = resolvedEnvToken;
  const resolvedArgvToken = argvBearerToken();
  if (resolvedArgvToken) process.env.RESONANTOS_COUNTER_ACTIVE_BEARER = resolvedArgvToken;
  const resolvedAdminEnvToken = envAdminToken();
  const resolvedAdminArgvToken = argvAdminToken();
  const resolvedAdminToken = adminToken ?? resolvedAdminEnvToken ?? resolvedAdminArgvToken;

  return {
    host,
    port,
    getValue: () => value,
    setValue: (v) => {
      value = Number.isInteger(v) ? v : 0;
    },
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
  const port = Number(process.env.RESONANTOS_COUNTER_PORT ?? DEFAULT_PORT);
  const service = createCounterServer({ port });
  service.start().then(({ host: h, port: p }) => {
    const tokenStatus = process.env.RESONANTOS_COUNTER_ACTIVE_BEARER ? "configured" : "NOT configured (mutating routes will return 503)";
    console.log(`Resonant Counter listening on http://${h}:${p} (bearer token: ${tokenStatus})`);
  });
}
