import { adapterCapabilityFloor, evaluateHarnessPolicy, replacementAllowed, undeclaredAdapterCapabilities } from './harness-policy.mjs';
import { randomUUID } from 'node:crypto';
import { assertValidHarnessManifest, publicHarnessError } from './harness-adapter-contract.mjs';

const fail = code => Object.assign(new Error(publicHarnessError({ code }).message), { code });
const slots = { 'primary-agent': 'agent-runtime', 'chat-interface': 'chat-interface', 'memory-system': 'memory-provider', 'communication-channel': 'notifications' };
const empty = () => ({ revision: 0, governanceActivated: false, installations: {}, slots: {} });
const counter = n => Number.isSafeInteger(n) && n >= 0 && n < Number.MAX_SAFE_INTEGER;
const grantShape = grant => ({ capability: grant.capability, scope: grant.scope, revocationBehavior: grant.revocationBehavior, granted: grant.granted });
const sameRequest = (a, b) => a.capability === b.capability && a.scope === b.scope && a.revocationBehavior === b.revocationBehavior;
// CP-BR9: a reviewed runtime factory id pinned on an installation. The id
// shape mirrors the host route identifier rule; the value is host-owned
// (never read from a manifest or a caller-controlled string).
const factoryIdShape = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value);
// Host platform tokens as declared by manifest `compatibility.platforms`.
const platformTokens = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

// Host-only API. Routes supply explicit consent later; no browser or adapter may
// write this state. Binding metadata authorizes use, never resolves credentials.
export async function createHarnessRegistry({ store, reviewedAdapterIds = [], bindings = [], platformToken } = {}) {
  if (!store?.read || !store?.write) throw new TypeError('Durable registry store required.');
  const reviewed = new Set(reviewedAdapterIds), approvedBindings = structuredClone(bindings);
  // CP-BR9: the host-owned platform token used by the compatibility
  // projection. Defaults to the current host; tests inject a fixed token.
  const hostPlatformToken = typeof platformToken === 'string' && platformToken.length > 0
    ? platformToken : (platformTokens[process.platform] ?? process.platform);
  // Host-owned compatibility verdict for lifecycle-managed installations:
  // an empty/absent platforms list is unconstrained; otherwise the host
  // platform must be declared. The shell version is not evaluated here —
  // manifest validation already bounds the declaration.
  const compatibleWithHost = manifest => {
    const platforms = manifest?.compatibility?.platforms;
    if (!Array.isArray(platforms) || platforms.length === 0) return true;
    return platforms.includes(hostPlatformToken);
  };
  const bootEpoch = randomUUID(), listeners = new Set(), fenced = new Set(), pendingPolicies = new Map();
  let state = empty(), disabled = false, queue = Promise.resolve();

  function bindingAllowed(manifest) {
    const runtime = manifest.agentRuntime;
    if (!runtime || runtime.adapterVersion !== 1 || !reviewed.has(runtime.adapterId)) return false;
    if (runtime.authScheme === 'none' && !runtime.endpoint) return true;
    return approvedBindings.some(binding => binding.addonId === manifest.id && binding.adapterId === runtime.adapterId &&
      binding.name === runtime.credentialBinding && binding.authScheme === runtime.authScheme &&
      binding.endpoint === runtime.endpoint);
  }
  function validateGrants(entry, grants) {
    if (!Array.isArray(grants) || new Set(grants.map(g => g?.capability)).size !== grants.length || grants.some(grant =>
      !grant || Object.keys(grant).some(key => !['capability', 'scope', 'revocationBehavior', 'granted'].includes(key)) ||
      typeof grant.granted !== 'boolean' || !entry.manifest.requestedCapabilities.some(request => sameRequest(request, grant)))) throw fail('permission-denied');
  }
  function refuse(reason, documentRevision, watermark) {
    console.error(JSON.stringify({ event: 'harness.registry_refused', reason, documentRevision, watermark, watermarkPath: store.watermarkPath ?? null }));
    throw fail('runtime-unavailable');
  }
  async function readWatermark(documentRevision) {
    try { return typeof store.watermark === 'function' ? await store.watermark() : null; }
    catch (error) { refuse(error.code ? 'watermark-unreadable' : 'watermark-invalid', documentRevision, null); }
  }
  try {
    const document = await store.read();
    if (document !== null) {
      if (document?.version !== 1 || !['pending', 'committed'].includes(document.phase)) throw fail('runtime-unavailable');
      const loaded = structuredClone(document.state);
      if (!loaded || !counter(loaded.revision) || typeof loaded.governanceActivated !== 'boolean' ||
          !loaded.installations || Array.isArray(loaded.installations) || !loaded.slots || Array.isArray(loaded.slots) ||
          Object.keys(loaded.installations).length > 256) throw fail('runtime-unavailable');
      const watermark = await readWatermark(loaded.revision);
      if (watermark !== null && watermark > loaded.revision) refuse('rollback', loaded.revision, watermark);
      for (const [id, entry] of Object.entries(loaded.installations)) {
        // Validate saved consent against its original requests before adding a
        // runtime request. Legacy delegation authority must never be relabelled.
        validateGrants(entry, entry.grants);
        if (entry.manifest.systemSlots?.some(slot => slot.id === 'primary-agent')) {
          let request = entry.manifest.requestedCapabilities.find(grant => grant.capability === 'agent-runtime');
          if (!request && entry.manifest.requestedCapabilities.some(grant => grant.capability === 'agent-delegation')) {
            request = { capability: 'agent-runtime', scope: 'system', revocationBehavior: 'hard-stop', granted: false };
            entry.manifest.requestedCapabilities.push(request);
          }
          if (request && !entry.grants.some(grant => grant.capability === 'agent-runtime')) {
            entry.grants.push({ ...grantShape(request), granted: false });
          }
        }
        assertValidHarnessManifest(entry.manifest);
        if (id !== entry.manifest.id || typeof entry.enabled !== 'boolean') throw fail('runtime-unavailable');
        // CP-BR9: persisted factory pins must carry the host-owned shape;
        // anything else is unknown persisted authority and fails closed.
        if (entry.factoryId !== undefined && !factoryIdShape(entry.factoryId)) throw fail('runtime-unavailable');
        if (entry.runtimeGeneration !== undefined && !counter(entry.runtimeGeneration)) throw fail('runtime-unavailable');
        // An installation persisted before the adapter floor existed may understate what its
        // adapter reaches. Its operations are already denied by policy, and the operator cannot
        // grant a capability the manifest never requested — so without this it could also never
        // be removed while it owned a slot. Disable it and vacate its slots so the operator can
        // remove it and install a corrected manifest. Never grant the missing capability.
        if (undeclaredAdapterCapabilities(entry.manifest).length) {
          entry.enabled = false;
          for (const [slot, owner] of Object.entries(loaded.slots)) {
            if (owner?.addonId === id) { owner.addonId = null; owner.generation += 1; }
          }
        }
      }
      for (const [slot, owner] of Object.entries(loaded.slots)) {
        if (!Object.hasOwn(slots, slot) || !counter(owner.generation) ||
            (owner.addonId !== null && !Object.hasOwn(loaded.installations, owner.addonId))) throw fail('runtime-unavailable');
      }
      state = structuredClone(loaded);
      if (document.phase === 'committed' && (watermark === null || watermark < loaded.revision)) {
        // Healing narrows the rollback window; an unwritable state root must not cost authority the document already proves.
        try { await store.raise?.(loaded.revision); }
        catch { console.error(JSON.stringify({ event: 'harness.registry_watermark_unwritable', revision: loaded.revision, watermarkPath: store.watermarkPath ?? null })); }
      }
      disabled = document.phase !== 'committed';
    } else {
      const watermark = await readWatermark(null);
      if (watermark !== null) state = { ...empty(), revision: watermark };
    }
  } catch {
    disabled = true;
    // Unknown persisted authority must never look like an unmanaged legacy slot.
    state = { ...empty(), governanceActivated: true, slots: { 'primary-agent': { addonId: null, generation: 0 } } };
  }

  const entryFor = addonId => {
    if (!Object.hasOwn(state.installations, addonId)) throw fail('permission-denied');
    return state.installations[addonId];
  };
  function eligible(entry, slot) {
    if (!entry?.enabled || !entry.manifest.systemSlots?.some(item => item.id === slot)) return false;
    // Only primary execution needs a reviewed runtime and approved binding.
    // Other slots authorize their own capability on an installed registry entry.
    if (slot === 'primary-agent' && !bindingAllowed(entry.manifest)) return false;
    // The floor joins the declared requirements, so a slot is never advertised as available
    // while every operation it offers is disabled for want of a capability nobody granted.
    const required = [slots[slot], ...(slot === 'primary-agent'
      ? [...entry.manifest.agentRuntime.requiredCapabilities, ...adapterCapabilityFloor(entry.manifest)] : [])];
    return required.every(capability => entry.grants.some(grant => grant.capability === capability && grant.granted));
  }
  function authorize(slot, addonId) {
    if (disabled) throw fail('runtime-unavailable');
    const owner = state.slots[slot];
    if (!Object.hasOwn(slots, slot) || !owner?.addonId || owner.addonId !== addonId || fenced.has(slot) || !eligible(state.installations[addonId], slot)) throw fail('permission-denied');
    return { slot, addonId, bootEpoch, generation: owner.generation, runtime: structuredClone(state.installations[addonId].manifest.agentRuntime) };
  }
  function isCurrent(authorization) {
    try {
      const current = authorize(authorization.slot, authorization.addonId);
      return authorization.bootEpoch === current.bootEpoch && authorization.generation === current.generation;
    } catch { return false; }
  }
  function projectPolicy(addonId, entry) {
    const policy = pendingPolicies.get(addonId) ?? evaluateHarnessPolicy(entry.manifest, entry.grants);
    return { disabledOperations: disabled || !entry.enabled ? [...(entry.manifest.agentRuntime?.supportedOperations ?? [])] : [...policy.disabledOperations],
      hiddenSurfaceIds: [...policy.hiddenSurfaceIds] };
  }
  function assertOperation(authorization, operation) {
    if (!isCurrent(authorization)) throw fail('ownership-conflict');
    if (projectPolicy(authorization.addonId, entryFor(authorization.addonId)).disabledOperations.includes(operation)) throw fail('permission-denied');
  }
  /** @returns {import('../../src/core/contracts.ts').HarnessRegistryProjection} */
  function snapshot() {
    const installations = Object.fromEntries(Object.entries(state.installations).map(([addonId, entry]) => {
      const base = {
        addonId, installed: true, enabled: entry.enabled, grantedCapabilities: structuredClone(entry.grants),
        ...projectPolicy(addonId, entry),
      };
      // CP-BR9: an installation pinned to a reviewed factory id is
      // lifecycle-managed. Only those entries carry the reconciler /
      // projection fields (manifest, factoryId, compatibility, required
      // capabilities, per-add-on generation). Slot-managed add-ons keep
      // the legacy shape and stay invisible to the CP-BR4 reconciler and
      // the CP-BR5 runtime projection.
      if (typeof entry.factoryId === 'string') {
        return [addonId, {
          ...base,
          manifest: structuredClone(entry.manifest),
          factoryId: entry.factoryId,
          compatible: compatibleWithHost(entry.manifest),
          requiredCapabilities: entry.manifest.requestedCapabilities
            .map(grant => grant?.capability)
            .filter(capability => typeof capability === 'string'),
          projectionGeneration: entry.runtimeGeneration ?? 0,
          bootEpoch,
        }];
      }
      return [addonId, base];
    }));
    const projection = Object.fromEntries(Object.entries(state.slots).map(([slot, owner]) => [slot, { ...owner,
      available: !disabled && !fenced.has(slot) && !!owner.addonId && eligible(state.installations[owner.addonId], slot),
    }]));
    return { bootEpoch, revision: state.revision, governanceActivated: state.governanceActivated, candidates: [], installations, slots: projection };
  }
  function notify(slot) {
    fenced.add(slot); // Fence synchronously, before listeners or durable I/O.
    return [...listeners].map(listener => {
      try { return Promise.resolve(listener({ slot })); } catch (error) { return Promise.reject(error); }
    });
  }
  function transact(prepare) {
    const operation = queue.then(async () => {
      if (disabled) throw fail('runtime-unavailable');
      const next = structuredClone(state), changes = prepare(next);
      const changedSlots = Array.isArray(changes) ? changes : changes.changedSlots;
      const effects = Array.isArray(changes) ? [] : changes.effects;
      // CP-BR9: add-on-level authority changes (install / enable / grants /
      // remove / factory pin) that the CP-BR4 reconciler must observe.
      const lifecycleAddons = Array.isArray(changes) || !Array.isArray(changes.addons) ? [] : changes.addons;
      if (!counter(next.revision + 1)) throw fail('runtime-unavailable');
      next.revision++;
      // Withdraw operation authority before any listener or durable write. New
      // calls and late results see the same pending policy as running work.
      for (const effect of effects) pendingPolicies.set(effect.addonId, effect.policy);
      const cleanup = Promise.allSettled([...changedSlots.flatMap(notify), ...effects.flatMap(effect =>
        [...listeners].map(listener => {
          try { return Promise.resolve(listener(effect)); } catch (error) { return Promise.reject(error); }
        }))]);
      try {
        await store.write({ version: 1, phase: 'pending', state: next });
        const results = await cleanup;
        if (results.some(result => result.status === 'rejected')) throw fail('runtime-unavailable');
        await store.write({ version: 1, phase: 'committed', state: next });
        state = next;
        pendingPolicies.clear();
        for (const slot of changedSlots) fenced.delete(slot);
        // CP-BR9: post-commit lifecycle notifications. These fire AFTER the
        // durable commit so consumers (the CP-BR4 reconciler) read committed
        // state, never a pre-transaction projection. Slot-owning add-ons are
        // already covered by the slot fence above; only slotless add-ons get
        // the add-on-level event. Post-commit listeners are observational:
        // their failures cannot roll back committed consent.
        for (const changedAddonId of lifecycleAddons) {
          if (typeof changedAddonId !== 'string' || ownedSlots(next, changedAddonId).length > 0) continue;
          for (const listener of [...listeners]) {
            try { listener({ slot: null, addonId: changedAddonId }); } catch { /* observational */ }
          }
        }
        return snapshot();
      } catch {
        disabled = true;
        await Promise.allSettled(Object.keys(state.slots).flatMap(notify));
        throw fail('runtime-unavailable');
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  function ownedSlots(next, addonId) {
    return Object.keys(next.slots).filter(slot => next.slots[slot].addonId === addonId);
  }
  function advance(next, changed) {
    for (const slot of changed) {
      if (!counter(next.slots[slot].generation + 1)) throw fail('runtime-unavailable');
      next.slots[slot].generation++;
    }
    return changed;
  }
  return {
    snapshot, authorize, isCurrent, assertOperation,
    onFence(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    install(manifest, { enabled, factoryId, expectedRevision } = {}) {
      // Capture input before entering the serialized queue to prevent TOCTOU edits.
      const captured = structuredClone(manifest);
      const capturedFactoryId = factoryId ?? null;
      return transact(next => {
        if (expectedRevision !== state.revision) throw fail('ownership-conflict');
        assertValidHarnessManifest(captured);
        if (typeof enabled !== 'boolean' || (captured.agentRuntime?.adapterVersion !== undefined && !bindingAllowed(captured))) throw fail('permission-denied');
        // CP-BR9: an optional reviewed factory pin marks the installation as
        // lifecycle-managed. The pin is host-owned and shape-checked; it is
        // never read from the manifest itself.
        if (capturedFactoryId !== null && !factoryIdShape(capturedFactoryId)) throw fail('invalid-manifest');
        if (Buffer.byteLength(JSON.stringify(captured)) > 262144) throw fail('invalid-manifest');
        // A manifest cannot understate the adapter it names: every capability that adapter
        // reaches must be requested, so the operator sees it and can withdraw it.
        if (undeclaredAdapterCapabilities(captured).length) throw fail('invalid-manifest');
        if (!Object.hasOwn(next.installations, captured.id) && Object.keys(next.installations).length >= 256) throw fail('runtime-unavailable');
        const changed = ownedSlots(next, captured.id);
        // Replacement of an installed manifest cannot silently mutate an owner.
        if (changed.length) throw fail('ownership-conflict');
        captured.requestedCapabilities = captured.requestedCapabilities.map(grant => ({ ...grantShape(grant), granted: false }));
        next.installations[captured.id] = { manifest: captured, enabled, grants: structuredClone(captured.requestedCapabilities),
          ...(capturedFactoryId !== null ? { factoryId: capturedFactoryId, runtimeGeneration: 0 } : {}) };
        return { changedSlots: [], effects: [], addons: [captured.id] };
      });
    },
    pinFactory(addonId, factoryId, { manifest } = {}) {
      // CP-BR9: host-owned repair/upgrade path for an existing installation
      // that must become lifecycle-managed (or have its manifest refreshed
      // to the reviewed catalog copy). Consent is preserved: every existing
      // grant must remain declared by the refreshed manifest, and no slot
      // ownership may be mutated. Never grants anything by itself.
      const captured = structuredClone(manifest);
      return transact(next => {
        const entry = entryFor(addonId);
        assertValidHarnessManifest(captured);
        if (captured.id !== addonId || !factoryIdShape(factoryId)) throw fail('invalid-manifest');
        if (ownedSlots(next, addonId).length) throw fail('ownership-conflict');
        if (entry.grants.some(grant => !captured.requestedCapabilities.some(request => sameRequest(request, grant)))) throw fail('permission-denied');
        captured.requestedCapabilities = captured.requestedCapabilities.map(grant => ({ ...grantShape(grant), granted: false }));
        const mergedGrants = [...entry.grants];
        for (const request of captured.requestedCapabilities) {
          if (!mergedGrants.some(grant => sameRequest(grant, request))) mergedGrants.push({ ...grantShape(request), granted: false });
        }
        next.installations[addonId].manifest = captured;
        next.installations[addonId].grants = mergedGrants;
        next.installations[addonId].factoryId = factoryId;
        next.installations[addonId].runtimeGeneration = (entry.runtimeGeneration ?? 0) + 1;
        return { changedSlots: [], effects: [], addons: [addonId] };
      });
    },
    importLegacy(records) {
      const captured = structuredClone(records);
      return transact(next => {
        if (!Array.isArray(captured) || captured.length > 256) throw fail('invalid-manifest');
        for (const record of captured) {
          const manifest = record?.manifest;
          assertValidHarnessManifest(manifest);
          if (Buffer.byteLength(JSON.stringify(manifest)) > 262144) throw fail('invalid-manifest');
          if (undeclaredAdapterCapabilities(manifest).length) throw fail('invalid-manifest');
          // Imported booleans and local selections are proposals, never consent.
          // Existing host records always win over a migration candidate.
          if (Object.hasOwn(next.installations, manifest.id)) continue;
          if (Object.keys(next.installations).length >= 256) throw fail('runtime-unavailable');
          manifest.requestedCapabilities = manifest.requestedCapabilities.map(grant => ({ ...grantShape(grant), granted: false }));
          next.installations[manifest.id] = { manifest, enabled: false, grants: structuredClone(manifest.requestedCapabilities) };
        }
        return [];
      });
    },
    setGrants(addonId, grants, { consent, expectedRevision } = {}) {
      const captured = structuredClone(grants);
      return transact(next => {
        if (expectedRevision !== state.revision) throw fail('ownership-conflict');
        if (consent !== true) throw fail('permission-denied');
        const entry = entryFor(addonId); validateGrants(entry, captured);
        const revoked = captured.filter(grant => !grant.granted && entry.grants.some(old => old.capability === grant.capability && old.granted)).map(grant => grant.capability);
        next.installations[addonId].grants = entry.grants.map(old => grantShape(captured.find(grant => sameRequest(old, grant)) ?? old));
        const grants = next.installations[addonId].grants;
        // CP-BR9: grant changes are lifecycle authority changes; a pinned
        // installation's generation fences stale reconciler completions.
        if (typeof next.installations[addonId].factoryId === 'string') {
          next.installations[addonId].runtimeGeneration = (next.installations[addonId].runtimeGeneration ?? 0) + 1;
        }
        const changed = ownedSlots(next, addonId).filter(slot => evaluateHarnessPolicy(entry.manifest, grants, { revoked, slot }).hardStop);
        return { changedSlots: advance(next, changed), effects: revoked.length ? [{ addonId,
          policy: evaluateHarnessPolicy(entry.manifest, grants, { revoked }) }] : [], addons: [addonId] };
      });
    },
    setEnabled(addonId, enabled, { expectedRevision } = {}) {
      return transact(next => {
        entryFor(addonId);
        if (expectedRevision !== state.revision) throw fail('ownership-conflict');
        if (typeof enabled !== 'boolean') throw fail('permission-denied');
        next.installations[addonId].enabled = enabled;
        if (typeof next.installations[addonId].factoryId === 'string') {
          next.installations[addonId].runtimeGeneration = (next.installations[addonId].runtimeGeneration ?? 0) + 1;
        }
        return { changedSlots: advance(next, ownedSlots(next, addonId)), effects: [], addons: [addonId] };
      });
    },
    assignSlot(slot, addonId, { expectedGeneration, replace = false } = {}) {
      return transact(next => {
        if (!Object.hasOwn(slots, slot)) throw fail('permission-denied');
        const incumbent = state.slots[slot] ?? { addonId: null, generation: 0 };
        if (expectedGeneration !== incumbent.generation) throw fail('ownership-conflict');
        if (incumbent.addonId && (!replace || !replacementAllowed(entryFor(incumbent.addonId).manifest, slot))) throw fail('ownership-conflict');
        if (addonId !== null && !eligible(entryFor(addonId), slot)) throw fail('permission-denied');
        if (!counter(incumbent.generation + 1)) throw fail('runtime-unavailable');
        next.slots[slot] = { addonId, generation: incumbent.generation + 1 };
        if (slot === 'primary-agent') next.governanceActivated = true;
        return [slot];
      });
    },
    remove(addonId, { expectedRevision } = {}) {
      return transact(next => {
        entryFor(addonId);
        if (expectedRevision !== state.revision) throw fail('ownership-conflict');
        if (ownedSlots(next, addonId).length) throw fail('ownership-conflict');
        delete next.installations[addonId];
        return { changedSlots: [], effects: [], addons: [addonId] };
      });
    },
  };
}
