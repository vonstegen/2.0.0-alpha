// http-json transport for the Community Hub local-service host (M3).
//
// The manifest declares `service.protocol: "http-json"`, an entrypoint on
// 127.0.0.1, and `healthCommand: community.status`. This is the loopback endpoint
// the bridge/extension calls; it is the ONLY thing that reaches the hosted
// Community API (Art. II). It binds 127.0.0.1 exclusively — never a routable
// interface — so nothing off-box can drive a signed-in member's writes.
//
// Wire shape (POST /):  { "id": <any>, "method": "community.*", "params": {...} }
//                 ->    { "id": <any>, "result": {...} }  |  { "id", "error": {...} }
// Health:         GET /status -> service.status()
//
// createCommunityHubServer builds the node http.Server but does not listen, so the
// request handler is unit-testable without binding a port; `listen()` is the thin
// wrapper index.mjs uses.

import http from "node:http";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 256 * 1024;

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function errorPayload(error) {
  return {
    error: {
      code: error?.code ?? "internal_error",
      status: error?.status ?? 500,
      message: error?.message ?? String(error),
    },
  };
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error("Request body too large.");
      err.status = 413;
      err.code = "payload_too_large";
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Dispatch a single decoded request object against the service/poller. Pure enough
 * to unit-test without a socket.
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function dispatch({ service, poller }, request) {
  const method = String(request?.method ?? "");
  const params = request?.params ?? {};

  // Host-local control methods (not proxied to the Community API).
  if (method === "community.status") {
    return { status: 200, body: { result: await service.status() } };
  }
  if (method === "community.snapshot") {
    return { status: 200, body: { result: poller ? poller.getSnapshot() : null } };
  }
  if (method === "community.sign_in") {
    return { status: 200, body: { result: service.signIn(params.token) } };
  }
  if (method === "community.sign_out") {
    return { status: 200, body: { result: service.signOut() } };
  }
  if (method === "community.audit") {
    return { status: 200, body: { result: service.audit() } };
  }

  // Everything else is a community.* tool call routed through the policy layer.
  const result = await service.call(method, params);
  return { status: 200, body: { result } };
}

/**
 * @param {{ service: any, poller?: any }} deps
 * @returns {http.Server}
 */
export function createCommunityHubServer({ service, poller }) {
  if (!service) throw new Error("createCommunityHubServer requires a service.");

  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/status" || req.url === "/")) {
        return send(res, 200, { result: await service.status() });
      }
      if (req.method !== "POST") {
        return send(res, 405, errorPayload({ status: 405, code: "method_not_allowed", message: "Use POST with a JSON-RPC body." }));
      }
      let request;
      try {
        request = await readJsonBody(req);
      } catch (error) {
        return send(res, error.status ?? 400, { id: null, ...errorPayload(error) });
      }
      const id = request?.id ?? null;
      try {
        const { status, body } = await dispatch({ service, poller }, request);
        return send(res, status, { id, ...body });
      } catch (error) {
        return send(res, error?.status ?? 500, { id, ...errorPayload(error) });
      }
    } catch (error) {
      return send(res, 500, errorPayload(error));
    }
  });
}

/**
 * Bind the host on loopback only.
 * @returns {Promise<{ server: http.Server, port: number, url: string }>}
 */
export function listen(server, { port = 4890, host = LOOPBACK } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      resolve({ server, port: boundPort, url: `http://${host}:${boundPort}` });
    });
  });
}
