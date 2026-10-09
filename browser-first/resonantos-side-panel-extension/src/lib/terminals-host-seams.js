// ResonantOS terminal-host host seams (CP-BR11).
//
// Both the Settings → Add-on Tools section (CP-BR10) and the new
// left-rail Terminals workspace (CP-BR11) need the same set of
// transactions against the host:
//   - `fetchStatus`        → GET /terminal-host/status
//   - `fetchPromptPath`    → GET /terminal-host/prompt-path
//   - `fetchProjection`    → GET /bridge/runtimes
//   - `fetchRegistry`      → GET /addons/registry
//   - `fetchGrants`        → GET /addons/grants
//   - `enableTransaction`  → POST /addons/enabled (registry-revision-aware)
//   - `grantTransaction`   → POST /addons/grants   (registry-revision-aware, consent)
//   - `launchTerminal`     → POST /terminal-host/launch
//   - `fetchConnectionScript` → POST /terminal-host/connection-script
//
// `createTerminalsHostSeams({ bridgeRequest })` returns an object
// with these functions. Each is a thin closure over the shared
// `bridgeRequest` callback; no global state is introduced. The
// renderers read only the public fields documented in the view-model.
//
// Intent citation:
//   docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §1
//   (Add-on Surfaces → Terminal), §13/§14, ADR-047.

/**
 * @param {{ bridgeRequest: (route: string, options?: { method?: string, body?: unknown, capability?: string }) => Promise<unknown> }} deps
 */
export function createTerminalsHostSeams({ bridgeRequest } = {}) {
  if (typeof bridgeRequest !== "function") {
    throw new Error("createTerminalsHostSeams requires a bridgeRequest function.");
  }

  // The host wraps every route result in `{ ok: true, ... }`. The
  // view-models in `terminal-cards.js` are unwrapped payloads.
  function unwrap(payload) {
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const { ok: _ok, ...rest } = payload;
      return rest;
    }
    return payload;
  }

  async function fetchStatus() {
    return unwrap(await bridgeRequest("/terminal-host/status", { method: "GET" }));
  }

  async function fetchPromptPath() {
    return unwrap(await bridgeRequest("/terminal-host/prompt-path", { method: "GET" }));
  }

  async function fetchProjection() {
    return unwrap(await bridgeRequest("/bridge/runtimes", { method: "GET" }));
  }

  async function fetchRegistry() {
    return unwrap(await bridgeRequest("/addons/registry", { method: "GET" }));
  }

  async function fetchGrants() {
    return unwrap(await bridgeRequest("/addons/grants", { method: "GET" }));
  }

  async function readRevision() {
    const registry = await fetchRegistry();
    const revision = registry?.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("Host registry revision unavailable.");
    }
    return revision;
  }

  /**
   * Optimistic-concurrency enable transaction. Reads the registry
   * revision immediately before the POST; a stale read fails closed
   * with ownership-conflict and the UI surfaces the error.
   */
  async function enableTransaction(addonId, enabled) {
    if (typeof addonId !== "string" || !addonId) {
      throw new Error("enableTransaction requires an addonId.");
    }
    const expectedRevision = await readRevision();
    await bridgeRequest("/addons/enabled", {
      method: "POST",
      body: { addonId, enabled: Boolean(enabled), expectedRevision },
    });
  }

  /**
   * Optimistic-concurrency grant transaction. Always operator-consented;
   * the renderer never calls this without a `window.confirm` first
   * (the workspace's grant button is gated on consent). The grant
   * payload is the closed shape the host expects:
   *   { addonId, grants: [{ capability, granted, scope, revocationBehavior }], consent, expectedRevision }
   */
  async function grantTransaction(addonId, capability, options = {}) {
    if (typeof addonId !== "string" || !addonId) {
      throw new Error("grantTransaction requires an addonId.");
    }
    if (typeof capability !== "string" || !capability) {
      throw new Error("grantTransaction requires a capability.");
    }
    const expectedRevision = await readRevision();
    const body = {
      addonId,
      grants: [{
        capability,
        granted: true,
        scope: options.scope ?? "system",
        revocationBehavior: options.revocationBehavior ?? "degrade",
      }],
      consent: true,
      expectedRevision,
    };
    return unwrap(await bridgeRequest("/addons/grants", { method: "POST", body }));
  }

  async function launchTerminal({ terminalAddonId, promptPath, agentId }) {
    return unwrap(await bridgeRequest("/terminal-host/launch", {
      method: "POST",
      body: {
        agentId: typeof agentId === "string" && agentId ? agentId : "pi",
        terminalAddonId,
        promptPath,
      },
    }));
  }

  async function fetchConnectionScript({ terminalAddonId, promptPath, providerProfileId }) {
    return unwrap(await bridgeRequest("/terminal-host/connection-script", {
      method: "POST",
      body: {
        terminalAddonId,
        ...(typeof providerProfileId === "string" && providerProfileId ? { providerProfileId } : {}),
      },
    }));
  }

  return {
    fetchStatus,
    fetchPromptPath,
    fetchProjection,
    fetchRegistry,
    fetchGrants,
    enableTransaction,
    grantTransaction,
    launchTerminal,
    fetchConnectionScript,
  };
}
