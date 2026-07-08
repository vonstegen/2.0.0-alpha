// Outbound Community API client (M3).
//
// Constitution Art. II: the browser extension NEVER calls the public Community API
// directly (MV3 CSP locks `connect-src` to 'self' + localhost). All Community API
// traffic is made here, in the local-service host, exactly like the outbound-fetch
// precedent in browser-first/host/provider-bridge-service.mjs.
//
// This module owns only the HTTP mechanics: URL normalization, timeout, bearer
// attachment for authenticated writes, and typed errors. It holds NO policy — the
// approval gate and fail-closed auth live one layer up in community-host.mjs so
// they can be reasoned about (and tested) in isolation. `fetchImpl` is injectable
// (default platform `fetch`) so the whole client runs offline under `node --test`.

const DEFAULT_TIMEOUT_MS = 10_000;

/** A network/transport failure reaching the Community API (backend unreachable). */
export class CommunityNetworkError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = "CommunityNetworkError";
    this.code = "network";
    if (cause) this.cause = cause;
  }
}

/** A non-2xx response from the Community API. Carries the parsed error body. */
export class CommunityApiError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = "CommunityApiError";
    this.status = status ?? 0;
    this.code = code ?? "api_error";
    this.body = body ?? null;
  }
}

function isPrivateOrLocalHostname(hostname) {
  const host = String(hostname ?? "").toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return !host.includes(".");
}

/**
 * Validate + canonicalize the Community API base URL. HTTPS is required for a real
 * hosted backend; plain http is tolerated ONLY for a local/preview backend (so
 * `vercel dev` / an in-memory host on 127.0.0.1 works). Mirrors the endpoint
 * hardening in provider-bridge-service.mjs (no credentials, no query/fragment).
 */
export function normalizeApiBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error("Community API base URL is required.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Community API base URL must be an absolute http or https URL.");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Community API base URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Community API base URL must not embed credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Community API base URL must not include a query string or fragment.");
  }
  if (url.protocol !== "https:" && !isPrivateOrLocalHostname(url.hostname)) {
    throw new Error("Community API base URL must use HTTPS unless it targets a local/preview backend.");
  }
  return url.toString().replace(/\/+$/, "");
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl                 Community API base, e.g. https://hub.example.com
 * @param {typeof fetch} [opts.fetchImpl]       injectable fetch (default platform fetch)
 * @param {number} [opts.timeoutMs]
 */
export function createCommunityApiClient({ baseUrl, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const root = normalizeApiBaseUrl(baseUrl);
  if (typeof fetchImpl !== "function") {
    throw new Error("createCommunityApiClient requires a fetch implementation.");
  }

  async function request({ method = "GET", path, token, body }) {
    const url = `${root}${path}`;
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    // Bearer is attached only when a token is supplied (writes). Reads are public
    // (Art. IV) and must NOT carry the member token unnecessarily.
    if (token) headers.authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new CommunityNetworkError(`Community API ${method} ${path} timed out after ${Math.round(timeoutMs / 1000)}s.`, { cause: error });
      }
      throw new CommunityNetworkError(`Community API ${method} ${path} is unreachable: ${error?.message ?? error}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }
    if (!response.ok) {
      throw new CommunityApiError(
        payload?.message ?? `Community API ${method} ${path} failed with HTTP ${response.status}.`,
        { status: response.status, code: payload?.error ?? "api_error", body: payload },
      );
    }
    return payload ?? {};
  }

  return {
    baseUrl: root,

    // --- public reads (Art. IV) ------------------------------------------------
    listEvents: () => request({ method: "GET", path: "/v1/events" }),
    listTasks: () => request({ method: "GET", path: "/v1/tasks" }),
    listPresence: () => request({ method: "GET", path: "/v1/presence" }),

    // --- authenticated writes (token required, attached as bearer) -------------
    rsvp: ({ eventId, state, token }) =>
      request({ method: "POST", path: `/v1/events/${encodeURIComponent(eventId)}/rsvp`, token, body: { state } }),
    checkin: ({ eventId, token }) =>
      request({ method: "POST", path: `/v1/events/${encodeURIComponent(eventId)}/checkin`, token, body: {} }),
    claimTask: ({ taskId, action, token }) =>
      request({ method: "POST", path: `/v1/tasks/${encodeURIComponent(taskId)}/claim`, token, body: { action } }),
    setPresence: ({ status, note, clear, token }) =>
      request({ method: "PUT", path: "/v1/presence", token, body: clear ? { clear: true } : { status, note } }),
    report: ({ targetType, targetId, reason, token }) =>
      request({ method: "POST", path: "/v1/reports", token, body: { targetType, targetId, reason } }),

    // --- sign-in (OAuth handled server-side; host just relays the code) --------
    exchangeAuthCallback: ({ code, state }) =>
      request({ method: "GET", path: `/v1/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}` }),
    authStartUrl: () => `${root}/v1/auth/github/start`,

    // Escape hatch used by higher layers/tests.
    request,
  };
}
