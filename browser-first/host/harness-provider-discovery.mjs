// Host-owned Harness Provider Connection discovery. Given an installed
// harness manifest and the shared provider catalog, it returns ONLY the
// Provider Profiles/models the harness declared it can consume
// (harnessProviderConnection.providerFamilies). Descriptive and metadata-only:
// never a credential, apiBaseUrl/endpoint, or arbitrary provider secret.
//
// Classification / provider compatibility is descriptive and grants no
// authority — the host still enforces the per-harness binding, grant gate, and
// credential resolution. A harness with no declaration (or an empty family
// list) receives an empty compatible set: no family claim, no catalog leak.

const stringList = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry) : [];

export function discoverCompatibleProviderProfiles({ manifest, profiles = [], modelCatalog = [] }) {
  const connection = manifest?.harnessProviderConnection;
  const consumes = connection
    ? connection.consumesProviderProfiles === true
    : manifest?.agentRuntime?.credentialSource === "provider-profile";
  const families = connection ? stringList(connection.providerFamilies) : [];
  if (!consumes || families.length === 0) {
    return { consumesProviderProfiles: consumes, profiles: [], models: [] };
  }
  const familySet = new Set(families);
  const compatible = [];
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== "string" || !familySet.has(profile.providerType)) continue;
    compatible.push({
      id: profile.id,
      label: typeof profile.label === "string" && profile.label ? profile.label : profile.id,
      providerType: profile.providerType,
      models: [...new Set(stringList(profile.models))],
    });
  }
  const compatibleIds = new Set(compatible.map((profile) => profile.id));
  const models = [];
  for (const entry of modelCatalog) {
    if (!entry || !compatibleIds.has(entry.providerId) || typeof entry.model !== "string") continue;
    models.push({
      model: entry.model,
      label: typeof entry.label === "string" && entry.label ? entry.label : entry.model,
      providerId: entry.providerId,
    });
  }
  return { consumesProviderProfiles: consumes, profiles: compatible, models };
}
