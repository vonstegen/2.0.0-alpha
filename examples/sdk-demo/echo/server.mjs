import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47321;

// The sandboxed add-on iframe loads this HTML directly from the add-on's own
// origin (the renderer sets iframe.src = service.entrypoint), so the server
// serves its own UI here. No CORS header is added anywhere.
const INDEX_HTML_PATH = fileURLToPath(new URL("./index.html", import.meta.url));

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
 */
export function createEchoServer({ host = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", addon: "addon.resonant-echo" }));
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await readFile(INDEX_HTML_PATH, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/echo/message") {
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

  return {
    host,
    port,
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
    console.log(`Resonant Echo listening on http://${h}:${p}`);
  });
}
