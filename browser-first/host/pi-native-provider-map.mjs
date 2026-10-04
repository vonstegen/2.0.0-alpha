// Host-owned, authoritative mapping from ROS provider identity to a native Pi
// built-in provider and its approved credential environment variable.
//
// This is the single authority for native Pi session-environment delivery
// (P0.2/P1.2). Protocol compatibility alone is insufficient: a profile's wire
// protocol (openai-compatible/minimax-compatible/ollama) does not determine
// which native Pi provider — and therefore which env var — receives the ROS
// session credential. An unknown ROS identity fails closed (null); a harness
// or manifest can never propose a provider id or an env var name.
//
// Every entry is proven by two inventories (P0.1):
//   * ROS side — the identity exists as a host provider template
//     (providerPreset in provider-bridge-service.mjs) or a built-in provider
//     profile (provider-fabric-core.mjs providerProfiles).
//   * Pi side (0.80.3) — the provider is a built-in provider in
//     @earendil-works/pi-ai getBuiltinProviders() and its env var is the
//     approved one from pi-ai env-api-keys getApiKeyEnvVars().
//
// Deliberately minimal: only the six providers Pi documents for non-persistent
// API keys (OPENROUTER_API_KEY, XAI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY,
// MINIMAX_API_KEY, ZAI_API_KEY). anthropic (OAuth-token precedence) and google
// are intentionally out of scope and fail closed. Never write a ROS secret into
// Pi's auth.json: this map only names an env var, never carries a value.
export const PI_NATIVE_PROVIDER_MAP = Object.freeze({
  openai: Object.freeze({ piProvider: "openai", envVar: "OPENAI_API_KEY" }),
  openrouter: Object.freeze({ piProvider: "openrouter", envVar: "OPENROUTER_API_KEY" }),
  xai: Object.freeze({ piProvider: "xai", envVar: "XAI_API_KEY" }),
  deepseek: Object.freeze({ piProvider: "deepseek", envVar: "DEEPSEEK_API_KEY" }),
  minimax: Object.freeze({ piProvider: "minimax", envVar: "MINIMAX_API_KEY" }),
  zai: Object.freeze({ piProvider: "zai", envVar: "ZAI_API_KEY" }),
});

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();

// Resolve a ROS provider profile to its native Pi mapping, or null.
// Reads only templateId/providerType identity — never a credential, endpoint,
// or manifest-supplied field. templateId is the authoritative ROS identity;
// providerType is the legacy fallback for built-in profiles without a
// templateId (e.g. shared-minimax, shared-openai). NOTE: shared-* profiles
// are intentionally out of scope (no non-persistent env-var key) and fail
// closed to null; this map never aliases them to a base provider.
export function resolvePiNativeProvider(profile) {
  if (!profile || typeof profile !== "object") return null;
  const identity = normalizeIdentity(profile.templateId) || normalizeIdentity(profile.providerType);
  if (!identity) return null;
  return PI_NATIVE_PROVIDER_MAP[identity] ?? null;
}
