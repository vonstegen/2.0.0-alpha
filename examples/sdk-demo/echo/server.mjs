import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47321;

// Per-add-on bearer token for Echo's mutating routes (Phase-3 P6). Before P6,
// Echo was bearer-agnostic — the P6 capability-gated model requires Echo's
// `network` capability to be enforced the same way Counter's is, so the
// revoke/deny proof applies symmetrically across both add-ons. The bearer
// token is delivered to the iframe via the bootstrap envelope (host-minted
// from harness-registry). The admin token (operator-pinned, host-only) gates
// the /admin/* revocation surface.
const envBearerToken = () =>
  String(process.env.RESONANTOS_ECHO_BEARER_TOKEN ?? "").trim();
const argvBearerToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === `--echo-bearer-token`) {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--echo-bearer-token=")) {
      return arg.slice("--echo-bearer-token=".length).trim();
    }
  }
  return "";
};
const envAdminToken = () =>
  String(process.env.RESONANTOS_ECHO_ADMIN_TOKEN ?? "").trim();
const argvAdminToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === `--echo-admin-token`) {
      return String(process.argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith("--echo-admin-token=")) {
      return arg.slice("--echo-admin-token=".length).trim();
    }
  }
  return "";
};

// The sandboxed add-on iframe loads this HTML directly from the add-on's own
// origin (the renderer sets iframe.src = service.entrypoint), so the server
// serves its own UI here. No CORS header is added anywhere.
const INDEX_HTML_PATH = fileURLToPath(new URL("./index.html", import.meta.url));

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
 * Resonant Echo upstream — an operator-started loopback HTTP service.
 *
 * This is the endpoint the manifest (`examples/sdk-demo/echo/addon.json`)
 * declares as `service.entrypoint`. The bridge NEVER spawns it; the operator
 * starts it, matching the host-aligned model (ADR-055/056): add-ons declare an
 * endpoint, the host connects out through the shared endpoint guard.
 *
 * It intentionally sends no `Access-Control-Allow-Origin` header: the sandboxed
 * add-on iframe is same-origin with this server (sandbox="allow-scripts
 * allow-same-origin" where the iframe origin equals the upstream origin), so no
 * CORS widening is needed.
 *
 * Phase-3 (P6) capability gates:
 *   The mutating route /api/echo/message requires the host-minted bearer
 *   token. The host-only /admin/* revocation surface flips an in-memory flag
 *   that closes the mutating route with 403 even when the bearer is correct.
 *   Same shape as Counter, distinct token values.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health                  → { status, addon, hostGranted }
 *   GET    /                        → index.html (UI; sandboxed cross-origin in iframe)
 *   POST   /api/echo/message        → { echo }, requires Authorization: Bearer <echo-token>
 *                                      AND host policy has not revoked the network capability
 *   POST   /admin/deny { granted }  → host-only revocation signal; requires Authorization: Bearer <echo-admin-token>
 *   GET    /admin/state             → host-only read of { granted, bearerConfigured }
 *
 * Status codes:
 *   200 — operation succeeded
 *   401 — caller presented a missing or wrong bearer (Echo's bearer is locked
 *         down; Counter's bearer cannot authorize Echo)
 *   403 — host has revoked the grant (real host-policy result, not hard-coded)
 *   503 — server started without --echo-bearer-token; mutating calls refused
 */
export function createEchoServer({
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
      res.end(JSON.stringify({ status: "ok", addon: "addon.resonant-echo", hostGranted }));
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
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <echo-admin-token>." }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ hostGranted, bearerConfigured: Boolean(bearerToken ?? process.env.RESONANTOS_ECHO_ACTIVE_BEARER) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/admin/deny") {
      const presentedAdmin = String(req.headers.authorization ?? "");
      const expectedAdmin = adminToken ? `Bearer ${adminToken}` : "";
      if (!expectedAdmin || !constantTimeEqual(presentedAdmin, expectedAdmin)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin-unauthorized", message: "Admin path requires Authorization: Bearer <echo-admin-token>." }));
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

    if (req.method === "POST" && url.pathname === "/api/echo/message") {
      const expected = process.env.RESONANTOS_ECHO_ACTIVE_BEARER ?? bearerToken ?? "";
      const presented = String(req.headers.authorization ?? "");
      if (!expected) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "echo-not-configured",
            message:
              "Echo upstream started without --echo-bearer-token; no mutating calls are authorized. The host has not minted a capability token.",
          }),
        );
        return;
      }
      if (!constantTimeEqual(presented, authorizedBearer(expected))) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "echo-unauthorized",
            message:
              "Echo mutating route requires Authorization: Bearer <echo-token>. Counter's bootstrap envelope carries no such token; another add-on's token is not accepted.",
          }),
        );
        return;
      }
      if (!hostGranted) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: "echo-revoked",
            message:
              "Echo mutating route is closed by host policy. The network capability for addon.resonant-echo has been revoked. Restore the grant to re-enable.",
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
        /* non-JSON body is echoed verbatim */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ echo: message }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const resolvedEnvToken = envBearerToken();
  if (resolvedEnvToken) process.env.RESONANTOS_ECHO_ACTIVE_BEARER = resolvedEnvToken;
  const resolvedArgvToken = argvBearerToken();
  if (resolvedArgvToken) process.env.RESONANTOS_ECHO_ACTIVE_BEARER = resolvedArgvToken;
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
  const port = Number(process.env.RESONANTOS_ECHO_PORT ?? DEFAULT_PORT);
  const service = createEchoServer({ port });
  service.start().then(({ host: h, port: p }) => {
    const tokenStatus = process.env.RESONANTOS_ECHO_ACTIVE_BEARER ? "configured" : "NOT configured (mutating routes will return 503)";
    console.log(`Resonant Echo listening on http://${h}:${p} (bearer token: ${tokenStatus})`);
  });
}
