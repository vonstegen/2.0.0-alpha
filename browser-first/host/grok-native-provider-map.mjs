// Host-owned, authoritative mapping from ROS provider identity to the official
// Grok CLI's approved credential environment variable.
//
// The Grok CLI is xAI's own agentic coding tool — it accepts an xAI API key via
// the XAI_API_KEY environment variable (verified empirically: `grok` reports
// "You are using XAI_API_KEY" when the env is set, and the xAI API is invoked
// with that key). This is the same env var the pi-native chain uses for xAI;
// the grok-native chain therefore maps ONLY xai (grok is single-provider).
//
// Deliberately minimal. A ROS identity that has no entry fails closed (null) —
// a manifest can never widen authority by naming a provider the host hasn't
// reviewed. Never write a ROS secret into the durable ~/.grok/auth.json; this
// map only names an env var, never carries a value.
export const GROK_NATIVE_PROVIDER_MAP = Object.freeze({
  xai: Object.freeze({ envVar: "XAI_API_KEY" }),
});

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();

// Resolve a ROS provider profile to its grok CLI env-var mapping, or null.
// Reads only templateId/providerType identity — never a credential, endpoint,
// or manifest-supplied field. templateId is the authoritative ROS identity;
// providerType is the legacy fallback for built-in profiles without a
// templateId (e.g. shared-xai).
export function resolveGrokNativeProvider(profile) {
  if (!profile || typeof profile !== "object") return null;
  const identity = normalizeIdentity(profile.templateId) || normalizeIdentity(profile.providerType);
  if (!identity) return null;
  return GROK_NATIVE_PROVIDER_MAP[identity] ?? null;
}
