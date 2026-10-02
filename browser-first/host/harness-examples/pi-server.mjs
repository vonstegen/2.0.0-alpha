import { spawn } from "node:child_process";
import { createServer } from "node:http";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 47326;

// Operator-pinned bearer token. The harness credential binding delivers the
// same token to the host adapter (via RESONANTOS_HARNESS_BINDINGS); this
// wrapper checks it on the mutating completions route exactly like the SDK
// demo upstreams check their own per-add-on bearers. The token is never
// embedded in a manifest and never reaches the browser.
const envBearerToken = () => String(process.env.PI_BEARER_TOKEN ?? "").trim();
const argvBearerToken = () => {
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--pi-bearer-token") return String(process.argv[i + 1] ?? "").trim();
    if (arg.startsWith("--pi-bearer-token=")) return arg.slice("--pi-bearer-token=".length).trim();
  }
  return "";
};

const authorizedBearer = (token) => `Bearer ${token}`;
const constantTimeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
};

// A banner line emitted by the pi CLI at startup (federation/permission noise)
// is not part of the reply and must not be forwarded to the user.
const isBannerLine = (line) => /^\s*\[/.test(line) || /pi-infra|permissions|fleet/i.test(line);

/**
 * Deterministic, self-contained Pi reply. Used when the real `pi` CLI is not
 * enabled (PI_LIVE !== "1") or its spawn fails, so the harness swap lifecycle
 * is demonstrable from a clean checkout with no provider credential.
 */
function stubReply(message) {
  const lower = String(message ?? "").trim().toLowerCase();
  if (!lower) return "Hi — I'm Pi, the pi.dev coding agent (stub reply).";
  if (/\b(hi|hello|hey)\b/.test(lower)) return "Hello! I'm Pi. Connect the live `pi` CLI to get a real answer.";
  if (/\bwho are you\b/.test(lower)) return "I'm addon.pi, a ResonantOS harness-provider add-on that mounts the pi.dev coding agent as a replaceable primary agent.";
  return `Pi (pi.dev) received: “${String(message).trim()}”. (This is a deterministic stub — set PI_LIVE=1 and configure a provider for the real pi CLI.)`;
}

/**
 * Run one turn through the real `pi` CLI (non-interactive) and return the
 * assistant text. Best-effort: any spawn failure, timeout, or empty result
 * returns null so the caller falls back to the stub.
 */
function runPi(message, { timeoutMs = 120000, live = false, provider = "", model = "" } = {}) {
  if (!live) return Promise.resolve(null);
  const args = ["--mode", "text", "--print", "--no-session"];
  if (provider) args.push("--provider", provider);
  if (model) args.push("--model", model);
  args.push(String(message ?? ""));

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("pi", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve(null);
      return;
    }
    let settled = false;
    let out = "";
    let err = "";
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* ignore */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.stderr.on("data", (chunk) => { err += String(chunk); });
    child.on("error", () => finish(null));
    child.on("exit", (code) => {
      if (code === 0) {
        const reply = out
          .split(/\r?\n/)
          .filter((line) => line.trim() && !isBannerLine(line))
          .join("\n")
          .trim();
        finish(reply || null);
      } else {
        finish(null);
      }
    });
  });
}

function lastUserMessage(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

/**
 * Pi (pi.dev) loopback wrapper — an operator-started OpenAI-compatible SSE
 * endpoint that backs the `openai-compatible-v1` harness adapter.
 *
 *   POST /v1/chat/completions  → OpenAI chat body in, SSE chunk stream out,
 *                                gated by Authorization: Bearer <pi-token>
 *   GET  /health               → { status, addon }
 *
 * The bridge never spawns this process; the operator starts it, matching the
 * host-aligned model (ADR-055/056). It intentionally sends no CORS headers.
 */
export function createPiServer({ host = DEFAULT_HOST, port = DEFAULT_PORT, bearerToken } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", addon: "addon.pi" }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      const expected = bearerToken ?? "";
      const presented = String(req.headers.authorization ?? "");
      if (!expected) {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "pi-not-configured", message: "Wrapper started without a bearer token; no completions are authorized." }));
        return;
      }
      if (!constantTimeEqual(presented, authorizedBearer(expected))) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "pi-unauthorized", message: "Completions require Authorization: Bearer <pi-token>." }));
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
      const message = lastUserMessage(body);

      let reply;
      try {
        reply = await runPi(message, {
          live: process.env.PI_LIVE === "1",
          provider: process.env.PI_PROVIDER ?? "",
          model: process.env.PI_MODEL ?? "",
        });
      } catch {
        reply = null;
      }
      if (!reply) reply = stubReply(message);

      // OpenAI-compatible SSE. The host adapter reads `data:` JSON frames and
      // terminates on `data: [DONE]`; every frame carries a single content
      // delta and no tool_calls.
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const STEP = 160;
      for (let i = 0; i < reply.length; i += STEP) {
        const delta = reply.slice(i, i + STEP);
        const last = i + STEP >= reply.length;
        const frame = { choices: [{ index: 0, delta: { content: delta }, finish_reason: last ? "stop" : null }] };
        res.write(`data: ${JSON.stringify(frame)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not-found" }));
  });

  const resolvedBearer = bearerToken ?? argvBearerToken() ?? envBearerToken();

  return {
    host,
    port,
    getBearerToken: () => resolvedBearer,
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

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1]);

if (isDirectRun) {
  const port = Number(process.env.PI_PORT ?? DEFAULT_PORT);
  const service = createPiServer({ port });
  service.start().then(({ host: h, port: p }) => {
    const tokenStatus = service.getBearerToken() ? "configured" : "NOT configured (completions will return 503)";
    console.log(`Pi (pi.dev) wrapper listening on http://${h}:${p} (bearer: ${tokenStatus})`);
  });
}
