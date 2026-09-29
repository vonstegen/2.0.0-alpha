// Generic Harness Provider Adapter. Host-owned and harness-agnostic: maps a
// ROS Provider Profile to a harness through the reviewed chain
//
//   profile -> harness identity -> authorization/grants -> compatibility
//            -> selected model -> safest supported credential delivery
//
// Identity/grants are enforced upstream by the registry (binding addonId match
// + grant gate); this adapter owns the compatibility and delivery-decision
// step so no harness (Pi included) carries its own credential-resolution
// logic. It only ever reads provider metadata — never a credential, endpoint,
// or secret. Classification/provider declarations grant no authority.

import { publicHarnessError } from './harness-adapter-contract.mjs';

const fail = code => Object.assign(new Error(publicHarnessError({ code }).message), { code });

// Host preference order. Only `runtime-adapter` is implemented in the Alpha:
// the scoped lease returned by createHarnessCredentials.acquire(). The others
// are declared/documented so a harness can state what it could consume, but a
// provider-profile harness that does not accept `runtime-adapter` cannot be
// serviced by the current host and fails closed.
export const HARNESS_DELIVERY_PREFERENCE = ['runtime-adapter', 'session-environment', 'self-auth', 'none'];

export function createHarnessProviderAdapter({ allProviderProfiles, allModelCatalog } = {}) {
  async function plan({ manifest, providerProfileId, selectedModel } = {}) {
    const connection = manifest?.harnessProviderConnection;
    const consumes = connection
      ? connection.consumesProviderProfiles === true
      : manifest?.agentRuntime?.credentialSource === 'provider-profile';
    if (!consumes) throw fail('permission-denied');
    const families = connection ? [...(connection.providerFamilies ?? [])] : [];
    const delivery = connection ? [...(connection.credentialDelivery ?? [])] : [];
    // Runtime-adapter is the only host delivery implemented today; a harness
    // that cannot consume it cannot receive a provider-profile credential.
    if (!delivery.includes('runtime-adapter')) throw fail('permission-denied');
    if (typeof allProviderProfiles !== 'function') throw fail('runtime-unavailable');
    const profiles = await allProviderProfiles();
    const profile = profiles.find(candidate => candidate?.id === providerProfileId);
    if (!profile || !families.includes(profile.providerType)) throw fail('permission-denied');
    if (selectedModel) {
      const catalog = typeof allModelCatalog === 'function' ? await allModelCatalog() : [];
      const entry = catalog.find(candidate => candidate?.model === selectedModel && candidate?.providerId === providerProfileId);
      if (!entry) throw fail('permission-denied');
    }
    const mechanism = HARNESS_DELIVERY_PREFERENCE.find(candidate => delivery.includes(candidate)) ?? 'runtime-adapter';
    return {
      providerProfileId,
      providerType: profile.providerType,
      deliveryMechanism: mechanism,
      selectedModel: selectedModel ?? null,
    };
  }
  return { plan, HARNESS_DELIVERY_PREFERENCE };
}
