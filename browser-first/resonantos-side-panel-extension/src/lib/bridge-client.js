const defaultBridgeConfig = globalThis.__RESONANTOS_BRIDGE_CONFIG__ ?? {};

// SECURITY: Capability tokens are NOT read from the generated config file.
// They are fetched at runtime via the authenticated /api/capability-tokens endpoint,
// scoped behind the bridge token. Call initCapabilityTokens() on service-worker startup.
const _capabilityTokens = {};

export function createBridgeClient(config = defaultBridgeConfig) {
  const bridgeUrl = config.bridgeUrl ?? "http://127.0.0.1:47773";
  const bridgeToken = config.bridgeToken ?? "";
  const fetchImpl = config.fetchImpl ?? fetch;

  return async function bridgeRequest(route, options = {}) {
    const headers = options.body ? { "Content-Type": "application/json" } : {};
    if (bridgeToken) {
      headers["X-ResonantOS-Bridge-Token"] = bridgeToken;
    }
    if (options.capability && _capabilityTokens[options.capability]) {
      headers["X-ResonantOS-Bridge-Capability-Token"] = _capabilityTokens[options.capability];
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

/**
 * Fetches capability tokens from the bridge server's authenticated endpoint and
 * populates the shared _capabilityTokens map. Must be called on service-worker
 * startup so that bridge requests can attach the correct capability token headers.
 *
 * The endpoint requires a valid X-ResonantOS-Bridge-Token header; raw capability
 * tokens are never written to the generated config file.
 */
export async function initCapabilityTokens(config = defaultBridgeConfig) {
  const bridgeUrl = config.bridgeUrl ?? "http://127.0.0.1:47773";
  const bridgeToken = config.bridgeToken ?? "";
  if (!bridgeToken) {
    return;
  }
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
    // requests will be sent without capability headers until tokens are fetched.
  }
}
