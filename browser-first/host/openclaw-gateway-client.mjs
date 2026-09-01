// Intent citation: docs/architecture/resonantos-browser-architecture/CP5-PHASE5-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/IMPLEMENTATION_TRACKING.md (row 100)
//
// CP-5 Phase 5 row 100: the OpenClaw adapter must drive a real MCP
// gateway transport, not a host-command spawn. The gateway is the
// only authority path for the child actor: the bridge cannot bypass
// it.
//
// Design:
//   - The client is a thin HTTP wrapper. The gateway decides what
//     capabilities the child actor can use, what the child actor can
//     write, and how the audit chain is recorded. The bridge is
//     purely a transport.
//   - The client surfaces the gateway's decisions verbatim: a 403
//     from the gateway surfaces as `{ ok: false, status, reason }` at
//     the dispatch layer; a 200 forwards the response. The bridge
//     does not second-guess the gateway.
//   - Forged grants are still caught by the CP-2 governed envelope
//     before the gateway is ever called. The gateway's only job is
//     child-actor authority, not request attestation — the bridge
//     already proved the request is well-formed.

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

function buildGatewayHeaders({ gatewayToken, addonId, requestId } = {}) {
  const headers = { "content-type": "application/json" };
  if (gatewayToken) headers["authorization"] = `Bearer ${gatewayToken}`;
  if (addonId) headers["x-resonantos-addon"] = addonId;
  if (requestId) headers["x-resonantos-request"] = requestId;
  return headers;
}

/**
 * Build an OpenClaw gateway client.
 *
 * @param {object} options
 * @param {string} options.baseUrl  The MCP gateway base URL.
 * @param {string} [options.gatewayToken]  Bearer token for the gateway.
 * @param {function} [options.fetchImpl]  Injectable fetch (tests use this).
 * @param {number} [options.requestTimeoutMs]
 * @returns {{
 *   requestDelegation: function,
 *   listChildren: function,
 * }}
 */
export function createOpenclawGatewayClient(options = {}) {
  const {
    baseUrl,
    gatewayToken,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  } = options;

  if (typeof baseUrl !== "string" || !baseUrl) {
    throw new Error("createOpenclawGatewayClient requires a non-empty baseUrl");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createOpenclawGatewayClient requires a fetchImpl (or global fetch)");
  }

  async function call(callName, method, path, body, headers) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), requestTimeoutMs) : null;
    try {
      const res = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller?.signal,
      });
      const text = await res.text().catch(() => "");
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          reason: typeof data === "string" ? data : (data?.error ?? `gateway-error-${res.status}`),
          detail: typeof data === "object" && data ? data : null,
        };
      }
      return { ok: true, status: res.status, data };
    } catch (error) {
      if (controller?.signal?.aborted || error?.name === "AbortError") {
        return { ok: false, status: 0, reason: `gateway-${callName}-timed-out`, detail: null };
      }
      return { ok: false, status: 0, reason: `gateway-${callName}-unreachable`, detail: String(error?.message ?? error) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    requestDelegation({ addonId, tool, prompt, subjectPrincipalId, grantHandle, auditCorrelationId, payload = {}, delegationId = null, requestId } = {}) {
      return call("requestDelegation", "POST", "/v1/delegation", {
        addonId,
        tool,
        prompt,
        subjectPrincipalId,
        grantHandle,
        auditCorrelationId,
        delegationId,
        payload,
      }, buildGatewayHeaders({ gatewayToken, addonId, requestId }));
    },
    listChildren(requestId) {
      return call("listChildren", "GET", "/v1/children", undefined, buildGatewayHeaders({ gatewayToken, requestId }));
    },
  };
}

/**
 * OpenClaw gateway transport (CP-5 row 100). Structurally different
 * from the OpenCode transport: the gateway is the only authority path
 * for the child actor. The bridge still owns the CP-2 governed
 * envelope (request attestation) — the gateway owns child-actor
 * authority (capability check + child spawn + child write scope).
 *
 * Decisions:
 *   - governedAuthority.validateGovernedRequest is called first. A
 *     forged subject or missing capability returns
 *     `{ outcome: "deny", reason: "..." }` BEFORE the gateway is
 *     contacted. The bridge never reaches the gateway with an
 *     unproven request.
 *   - A gateway 403 (forged child grant, missing child capability)
 *     surfaces as `{ outcome: "deny", reason: "gateway-denied",
 *     detail: <gateway body> }`.
 *   - A gateway 200 forwards the child actor's response to the
 *     dispatch consumer.
 */
export function openclawGatewayRuntimeDispatch({ governedAuthority, gatewayClient, requestIdFactory }) {
  return async (packet, grant) => {
    if (!governedAuthority) {
      return { outcome: "deny", reason: "governed-authority-unavailable", detail: "no governed authority on this bridge" };
    }
    if (!gatewayClient) {
      return { outcome: "deny", reason: "gateway-unavailable", detail: "no OpenClaw gateway client on this bridge" };
    }
    const request = {
      taskId: packet.taskId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      payload: { addonId: "addon.openclaw", tool: "openclaw.delegate", messages: [{ role: "user", content: packet.intent }] },
    };
    const decision = governedAuthority.validateGovernedRequest(request);
    if (!decision.ok) {
      return { outcome: "deny", reason: decision.reason, detail: `governed request rejected: ${decision.reason}` };
    }
    const requestId = (requestIdFactory ?? (() => `${packet.taskId}:${Date.now()}`))();
    const gatewayOutcome = await gatewayClient.requestDelegation({
      addonId: "addon.openclaw",
      tool: "openclaw.delegate",
      prompt: packet.intent,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      requestId,
    });
    if (!gatewayOutcome.ok) {
      return {
        outcome: "deny",
        reason: gatewayOutcome.reason,
        detail: typeof gatewayOutcome.detail === "string"
          ? gatewayOutcome.detail
          : JSON.stringify(gatewayOutcome.detail ?? null),
        gatewayStatus: gatewayOutcome.status,
      };
    }
    return { outcome: "allow", response: gatewayOutcome.data, gatewayStatus: gatewayOutcome.status };
  };
}
