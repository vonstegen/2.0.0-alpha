// CP-XH5a: shared bridge-bootstrap probe.
//
// `ensureBridgeReachable({ endpoint, timeoutMs })` is the single owner of
// the loopback bridge health-check. It is shared by the
// `POST /terminal-host/launch` route and the CP-BR1 independent
// native-messaging bootstrap host (browser-first/bootstrap/).
//
// Hard rules (CP-XH5a invariants):
//   * No auto-start. The probe never spawns or restarts the bridge; that
//     belongs to the independent bootstrap owner selected by ADR-047. On a
//     closed port or timeout the caller gets `{ ok: false, reason: "bridge-not-running",
//     endpoint }` and the UI surfaces the Settings deep-link.
//   * Never reads a secret. The probe only opens a TCP socket and
//     reads `GET /healthz`; it never touches token, credential, or
//     prompt content paths.
//   * Bounded. The TCP connect + HTTP probe share a single timeout
//     (default 1500 ms) so a hung bridge cannot wedge the launch path.
//
// Health attribution (CP-BR1): the Alpha bridge serves no unauthenticated
// health route; every unauthenticated request is answered 401 with the
// exact body `{"ok":false,"error":"Unauthorized browser-first bridge request."}`.
// That auth-guard signature is emitted only by a ResonantOS bridge whose
// token check held, so it is treated as proof of a healthy bridge (version
// unknown → null), mirroring the extension's detectLoopbackBridge
// signature matching in bridge-client.js. A fixture serving
// `200 { ok: true, version? }` on /healthz is also accepted. Any other
// status or body maps to `bridge-not-running`, so an arbitrary process
// answering the port is never reported as a healthy bridge.
//
// The function is intentionally tiny: it has no opinion on terminal
// add-ons, harnesses, grants, or projections. The launch route layers
// those concerns on top.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 10_000;

/**
 * @typedef {Object} EnsureBridgeReachableArgs
 * @property {string} endpoint                absolute loopback URL, e.g. http://127.0.0.1:7777
 * @property {number} [timeoutMs=1500]        shared TCP+HTTP timeout
 * @property {(url: string, options: object) => object} [_request]  test-only seam (http/https request factory)
 * @property {(host: string, port: number) => Promise<void>} [_probeTcp]  test-only seam
 */

/**
 * @typedef {{ ok: true, version: string | null, endpoint: string } |
 *           { ok: false, reason: "bridge-not-running", endpoint: string, code?: string }}
 * BridgeReachResult
 */

/**
 * Probe the loopback bridge endpoint. Returns
 * `{ ok: true, version, endpoint }` on a healthy `GET /healthz` that
 * returns JSON `{ ok: true }` (and a `version` when present), or
 * `{ ok: false, reason: "bridge-not-running", endpoint, code? }` on
 * ECONNREFUSED / timeout / malformed body. The probe never auto-starts
 * the bridge process.
 *
 * @param {EnsureBridgeReachableArgs} args
 * @returns {Promise<BridgeReachResult>}
 */
export async function ensureBridgeReachable({
  endpoint,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _request,
  _probeTcp,
} = {}) {
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    return { ok: false, reason: "bridge-not-running", endpoint: String(endpoint ?? "") };
  }
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "bridge-not-running", endpoint };
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { ok: false, reason: "bridge-not-running", endpoint };
  }
  const boundedTimeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(50, Math.floor(timeoutMs)));
  const requestFactory = _request ?? (parsed.protocol === "https:" ? httpsRequest : httpRequest);
  const tcpProbe = _probeTcp ?? defaultTcpProbe;

  // First, a fast TCP connect so we can short-circuit on ECONNREFUSED
  // without ever doing the HTTP dance.
  try {
    await tcpProbe(parsed.hostname, Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)), boundedTimeoutMs);
  } catch (error) {
    return { ok: false, reason: "bridge-not-running", endpoint, code: error?.code ?? "ECONNREFUSED" };
  }

  // The HTTP probe: bounded by the same timeout as the TCP probe so a
  // hung bridge cannot extend the overall budget.
  const probe = new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => settle({ ok: false, reason: "bridge-not-running", endpoint, code: "TIMEOUT" }), boundedTimeoutMs);
    let req;
    try {
      req = requestFactory(endpoint + "/healthz", { method: "GET", headers: { Accept: "application/json" }, timeout: boundedTimeoutMs }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          clearTimeout(timer);
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          if (status >= 200 && status < 300) {
            let parsedBody = null;
            try { parsedBody = JSON.parse(body); } catch { /* not JSON; treat as not-running */ }
            if (parsedBody && typeof parsedBody === "object" && parsedBody.ok === true) {
              const version = typeof parsedBody.version === "string" && parsedBody.version.length > 0 ? parsedBody.version : null;
              settle({ ok: true, version, endpoint });
            } else {
              settle({ ok: false, reason: "bridge-not-running", endpoint, code: "BAD_HEALTHZ" });
            }
          } else if (status === 401 && isBridgeAuthGuardBody(body)) {
            // CP-BR1: the bridge's unauthenticated refusal is emitted only
            // by a ResonantOS bridge whose token check held. Version is not
            // exposed without credentials.
            settle({ ok: true, version: null, endpoint });
          } else {
            settle({ ok: false, reason: "bridge-not-running", endpoint, code: `HTTP_${status}` });
          }
        });
        response.on("error", () => { clearTimeout(timer); settle({ ok: false, reason: "bridge-not-running", endpoint }); });
      });
      req.on("error", (error) => {
        clearTimeout(timer);
        settle({ ok: false, reason: "bridge-not-running", endpoint, code: error?.code ?? "ECONNREFUSED" });
      });
      req.end();
    } catch (error) {
      clearTimeout(timer);
      settle({ ok: false, reason: "bridge-not-running", endpoint, code: error?.code ?? "ECONNREFUSED" });
    }
  });
  return probe;
}

/**
 * Default TCP connect probe. Resolves on a successful connect, rejects
 * with the underlying error code (e.g. `ECONNREFUSED`, `EHOSTUNREACH`,
 * `ETIMEDOUT`) so the caller can surface a typed result.
 *
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 */
function defaultTcpProbe(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(null));
    socket.once("timeout", () => finish(Object.assign(new Error("TCP timeout"), { code: "TIMEOUT" })));
    socket.once("error", (error) => finish(error));
  });
}

/**
 * Exact match for the bridge's unauthenticated refusal body. Kept in sync
 * with `writeJson(response, 401, {ok:false,error:"Unauthorized browser-first
 * bridge request."})` in bridge-server.mjs.
 */
function isBridgeAuthGuardBody(body) {
  let parsed = null;
  try { parsed = JSON.parse(body); } catch { return false; }
  return Boolean(
    parsed
    && typeof parsed === "object"
    && parsed.ok === false
    && typeof parsed.error === "string"
    && parsed.error.includes("Unauthorized browser-first bridge request"),
  );
}

/**
 * Default endpoint when none is injected. CP-BR1 resolved the historical
 * port mismatch: 47773 is the authoritative Alpha port, matching
 * `defaultBridgePort` in run-bridge-minimal.mjs and `getBridgePort()` in
 * bridge-server.mjs.
 */
export const DEFAULT_BRIDGE_ENDPOINT = "http://127.0.0.1:47773";