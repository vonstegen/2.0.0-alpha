// Host-owned Harness Provider Connection discovery. Given an installed
// harness manifest and the shared provider catalog, it returns ONLY the
// Provider Profiles/models whose host-derived protocol is one the harness
// declared it can consume (harnessProviderConnection.providerProtocols).
// Descriptive and metadata-only: never a credential, apiBaseUrl/endpoint,
// or arbitrary provider secret.
//
// Compatibility is decided solely by the host: a profile is compatible when
// deriveProviderProtocol(profile) — read only from host provider/profile data —
// is present in the harness's providerProtocols. A harness/manifest/caller
// supplied protocol field, profile label, or providerType naming convention is
// never trusted to substitute for that derivation. Classification / provider
// declarations grant no authority — the host still enforces the per-harness
// binding, grant gate, and credential resolution. A harness with no declaration
// (or an empty protocol list) receives an empty compatible set: no protocol
// claim, no catalog leak.

import { deriveProviderProtocol } from './provider-fabric-core.mjs';

const stringList = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry) : [];

export function discoverCompatibleProviderProfiles({ manifest, profiles = [], modelCatalog = [] }) {
  const connection = manifest?.harnessProviderConnection;
  const consumes = connection
    ? connection.consumesProviderProfiles === true
    : manifest?.agentRuntime?.credentialSource === "provider-profile";
  const protocols = connection ? stringList(connection.providerProtocols) : [];
  if (!consumes || protocols.length === 0) {
    return { consumesProviderProfiles: consumes, profiles: [], models: [] };
  }
  const protocolSet = new Set(protocols);
  const compatible = [];
  for (const profile of profiles) {
    if (!profile || typeof profile.id !== "string") continue;
    const providerProtocol = deriveProviderProtocol(profile);
    if (!providerProtocol || !protocolSet.has(providerProtocol)) continue;
    compatible.push({
      id: profile.id,
      label: typeof profile.label === "string" && profile.label ? profile.label : profile.id,
      providerType: profile.providerType,
      providerProtocol,
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
