import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47322;

// Per-add-on bearer token. Phase-3 (P6) replaces this with a token minted by
// `harness-registry.setGrants(...)`; for Phase-2 (P4) the operator passes one
// in via --counter-bearer-token=<value> or env RESONANTOS_COUNTER_BEARER_TOKEN,
// so the isolation proof can pin two distinct tokens for Echo and Counter.
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

// Like Echo, the sandboxed add-on iframe loads this HTML directly from the
// add-on's own origin (the renderer sets iframe.src = service.entrypoint). No
// CORS header is added anywhere, so cross-origin iframes cannot read the
// response. Boundary = per-origin sandbox + per-add-on bearer token.
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
 * declares no such token, so Echo's bootstrap envelope grants no token that
 * Counter accepts, and vice versa. The cross-origin boundary (no ACAO) keeps
 * cross-iframe calls out.
 *
 * Routes (all same-origin, no ACAO):
 *   GET    /health              → { status, addon }
 *   GET    /                    → index.html (UI; sandboxed cross-origin in iframe)
 *   GET    /api/counter/value   → { value } (public — used by the UI to read)
 *   POST   /api/counter/increment  → { value }, requires Authorization: Bearer <counter-token>
 *   POST   /api/counter/decrement  → { value }, requires Authorization: Bearer <counter-token>
 *   POST   /api/counter/reset      → { value: 0 }, requires Authorization: Bearer <counter-token>
 */
export function createCounterServer({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  initialValue = 0,
} = {}) {
  let value = Number.isInteger(initialValue) ? initialValue : 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", addon: "addon.resonant-counter", value }));
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

    if (
      req.method === "POST" &&
      (url.pathname === "/api/counter/increment" ||
        url.pathname === "/api/counter/decrement" ||
        url.pathname === "/api/counter/reset")
    ) {
      const expected = process.env.RESONANTOS_COUNTER_ACTIVE_BEARER ?? "";
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

  return {
    host,
    port,
    getValue: () => value,
    setValue: (v) => {
      value = Number.isInteger(v) ? v : 0;
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
