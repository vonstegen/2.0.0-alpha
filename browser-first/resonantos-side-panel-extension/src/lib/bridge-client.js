// ResonantOS bridge client.
//
// Resolves the bridge configuration in this order:
//   1. A user-set override in chrome.storage.local (key: "bridgeTargetOverride"),
//      set via the Bridge Target settings section so the same extension can
//      point at a different bridge host on every machine.
//   2. The generated config written by the bridge at startup
//      (globalThis.__RESONANTOS_BRIDGE_CONFIG__), which points at the bridge
//      the extension was installed alongside.
//   3. A last-resort loopback default of http://127.0.0.1:47773 so the
//      extension at least mounts on a clean install with no generated config.
//
// createBridgeClient(config) builds a request function. The config can be
// passed in directly (e.g. from a test) or omitted to use the
// generated/default. Most callers should use `await resolveBridgeConfig()`
// and pass the result, so the chrome.storage override is honored.

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:47773";
const STORAGE_OVERRIDE_KEY = "bridgeTargetOverride";

function normalizeBridgeTarget(value) {
  if (!value || typeof value !== "object") return null;
  const url = typeof value.bridgeUrl === "string" ? value.bridgeUrl.trim() : "";
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  const token = typeof value.bridgeToken === "string" && value.bridgeToken.trim()
    ? value.bridgeToken.trim()
    : null;
  const capabilityTokens = value.bridgeCapabilityTokens && typeof value.bridgeCapabilityTokens === "object"
    ? value.bridgeCapabilityTokens
    : null;
  return { url, token, capabilityTokens };
}

async function readOverrideFromStorage() {
  try {
    if (typeof chrome === "undefined" || !chrome?.storage?.local?.get) return null;
    const result = await chrome.storage.local.get([STORAGE_OVERRIDE_KEY]);
    return normalizeBridgeTarget(result?.[STORAGE_OVERRIDE_KEY]);
  } catch {
    return null;
  }
}

function generatedConfig() {
  const cfg = globalThis.__RESONANTOS_BRIDGE_CONFIG__;
  if (!cfg || typeof cfg !== "object") return null;
  const url = typeof cfg.bridgeUrl === "string" && cfg.bridgeUrl.trim()
    ? cfg.bridgeUrl.trim()
    : null;
  if (!url) return null;
  return {
    url,
    token: typeof cfg.bridgeToken === "string" ? cfg.bridgeToken : null,
    capabilityTokens: cfg.bridgeCapabilityTokens && typeof cfg.bridgeCapabilityTokens === "object"
      ? cfg.bridgeCapabilityTokens
      : null,
  };
}

export async function resolveBridgeConfig() {
  const override = await readOverrideFromStorage();
  if (override) {
    return {
      bridgeUrl: override.url,
      bridgeToken: override.token ?? "",
      bridgeCapabilityTokens: override.capabilityTokens ?? {},
      source: "override",
    };
  }
  const generated = generatedConfig();
  if (generated) {
    return {
      bridgeUrl: generated.url,
      bridgeToken: generated.token ?? "",
      bridgeCapabilityTokens: generated.capabilityTokens ?? {},
      source: "generated",
    };
  }
  return {
    bridgeUrl: DEFAULT_BRIDGE_URL,
    bridgeToken: "",
    bridgeCapabilityTokens: {},
    source: "default",
  };
}

export const BRIDGE_STORAGE_OVERRIDE_KEY = STORAGE_OVERRIDE_KEY;

export function createBridgeClient(config = globalThis.__RESONANTOS_BRIDGE_CONFIG__ ?? {}) {
  const bridgeUrl = config.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const bridgeToken = config.bridgeToken ?? "";
  const bridgeCapabilityTokens = config.bridgeCapabilityTokens ?? {};
  const fetchImpl = config.fetchImpl ?? fetch;

  return async function bridgeRequest(route, options = {}) {
    const headers = options.body ? { "Content-Type": "application/json" } : {};
    if (bridgeToken) {
      headers["X-ResonantOS-Bridge-Token"] = bridgeToken;
    }
    if (options.capability && bridgeCapabilityTokens[options.capability]) {
      headers["X-ResonantOS-Bridge-Capability-Token"] = bridgeCapabilityTokens[options.capability];
    }
    const response = await fetchImpl(`${bridgeUrl}${route}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload?.error ?? `Bridge request failed with HTTP ${response.status}.`);
    }
    return payload;
  };
}

// Raw byte/HTML fetch. The bridge's addon proxy endpoints (e.g.
// /hermes-dashboard/*) return non-JSON (the upstream's actual content
// type) — the extension needs the raw response to inline it into an
// <iframe srcdoc>. Same auth as bridgeRequest. Use this for any route
// the bridge forwards to a non-JSON upstream.
export function createRawBridgeFetch(config = globalThis.__RESONANTOS_BRIDGE_CONFIG__ ?? {}) {
  const bridgeUrl = config.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const bridgeToken = config.bridgeToken ?? "";
  const bridgeCapabilityTokens = config.bridgeCapabilityTokens ?? {};
  const fetchImpl = config.fetchImpl ?? fetch;

  return async function rawFetch(path, options = {}) {
    const headers = { ...(options.headers ?? {}) };
    if (bridgeToken) {
      headers["X-ResonantOS-Bridge-Token"] = bridgeToken;
    }
    if (options.capability && bridgeCapabilityTokens[options.capability]) {
      headers["X-ResonantOS-Bridge-Capability-Token"] = bridgeCapabilityTokens[options.capability];
    }
    return fetchImpl(`${bridgeUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      signal: options.signal,
    });
  };
}

// Loopback detection.
//
// The extension ships with the bridge's LAN address baked into the
// generated config (e.g. "http://192.168.1.100:47773"). On the Pi5 itself
// that's a wasted hop — we can talk to the bridge over 127.0.0.1
// directly, which is faster and avoids LAN routing bugs.
//
// We probe localhost:19443 (Caddy HTTPS front) and localhost:47773
// (the bridge's direct HTTP port) for a /status response. We PREFER
// HTTPS — even though the HTTP probe responds faster, the iframe
// inside the extension runs in a secure context (chrome-extension://)
// and an http:// subresource triggers Chrome's mixed-content block,
// which silently leaves the React app unable to mount.
//
// We deliberately do NOT probe IPv6 (e.g. [::1]). The bridge only
// binds 0.0.0.0 / 127.0.0.1, and the manifest's CSP doesn't list
// https://[::1]:19443. Probing it would produce a confusing dead
// result and trigger a CSP error in the extension page.
const LOOPBACK_CANDIDATES = [
  // [host, port, scheme] — checked in this order, first one whose
  // /status returns ok=true wins.
  ["localhost", 19443, "https"],
  ["localhost", 47773, "http"],
];
const PROBE_TIMEOUT_MS = 1500;

function buildLoopbackCandidates(config) {
  const out = [];
  const seen = new Set();
  // Use "localhost" (not 127.0.0.1) as the host for the loopback probe
  // because Chrome's MV3 CSP rejects "https://127.0.0.1:*" as an
  // "insecure CSP value" in script-src, even though 127.0.0.1 is a
  // secure context per W3C. localhost is treated as a normal DNS host
  // and is accepted.
  for (const [host, port, scheme] of LOOPBACK_CANDIDATES) {
    const candidate = `${scheme}://${host}:${port}`;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  // Always include the original URL as a final fallback so a remote
  // machine (where loopback is meaningless) still resolves to its
  // configured target.
  const origin = (config.bridgeUrl || "").trim().replace(/\/+$/, "");
  if (origin && !seen.has(origin)) {
    seen.add(origin);
    out.push(origin);
  }
  return out;
}

export async function detectLoopbackBridge(config, { fetchImpl: fetchOverride } = {}) {
  if (!config) return config;
  const fetchFn = fetchOverride ?? (typeof fetch !== "undefined" ? fetch : null);
  if (!fetchFn) return config;
  const candidates = buildLoopbackCandidates(config);
  const headers = config.bridgeToken
    ? { "X-ResonantOS-Bridge-Token": config.bridgeToken }
    : {};
  // Probe candidates SEQUENTIALLY (not via Promise.any) so HTTPS
  // gets a fair shot even if HTTP responds first. We return the
  // first candidate whose /status returns ok=true. Sequential probing
  // is fast enough — the bridge is on the same host, and we time
  // out each probe at 1.5s.
  for (const candidate of candidates) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetchFn(`${candidate}/status`, {
        method: "GET",
        headers,
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      let body = null;
      try { body = await res.json(); } catch { continue; }
      if (body?.ok === true && (body?.service === "resonantos-bridge" || body?.bridge)) {
        return {
          ...config,
          bridgeUrl: candidate,
          source: config.source ? `loopback:${config.source}` : "loopback",
        };
      }
    } catch {
      clearTimeout(timer);
      // Try next candidate.
    }
  }
  return config;
}

// SECURITY: Capability tokens issued at runtime by the bridge's authenticated
// /api/capability-tokens endpoint populate this module-level map on
// service-worker startup. Config-supplied tokens (bridgeCapabilityTokens in
// the createBridgeClient config, or globalThis.__RESONANTOS_BRIDGE_CONFIG__)
// take precedence — they are typically the higher-privilege tokens baked
// into the build. The runtime-fetched tokens are an additional layer for
// tokens that should NOT appear in the generated config file.
const _capabilityTokens = {};

/**
 * Fetches capability tokens from the bridge server's authenticated endpoint
 * and merges them into the shared _capabilityTokens map. Must be called
 * once on service-worker startup so that subsequent bridgeRequest() calls
 * can attach the right capability headers.
 *
 * The endpoint requires a valid X-ResonantOS-Bridge-Token header; raw
 * capability tokens are never written to the generated config file.
 */
export async function initCapabilityTokens(config) {
  const cfg = config ?? globalThis.__RESONANTOS_BRIDGE_CONFIG__ ?? {};
  const bridgeUrl = cfg.bridgeUrl ?? DEFAULT_BRIDGE_URL;
  const bridgeToken = cfg.bridgeToken ?? "";
  if (!bridgeToken) return;
  try {
    const response = await fetch(`${bridgeUrl}/api/capability-tokens`, {
      headers: { "X-ResonantOS-Bridge-Token": bridgeToken },
    });
    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (payload?.ok && payload?.capabilityTokens && typeof payload.capabilityTokens === "object") {
        Object.assign(_capabilityTokens, payload.capabilityTokens);
      }
    }
  } catch {
    // Bridge may not be reachable yet (e.g. host not started). Capability
    // requests will fall back to config-supplied tokens until the bridge
    // is up.
  }
}
