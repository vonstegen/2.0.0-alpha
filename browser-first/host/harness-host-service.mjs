// Composition owns routes, never grants inferred from bridge authentication.
import { readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { createHarnessRegistry } from './harness-registry.mjs';
import { createHarnessRegistryStore } from './harness-registry-store.mjs';
import { createHarnessBoundary } from './harness-boundary.mjs';
import { createHarnessCredentials } from './harness-credentials.mjs';
import { createHarnessTransport } from './harness-transport.mjs';
import { createOpenAICompatibleAdapter } from './agent-adapters/openai-compatible.mjs';
import { createDshTypertAdapter } from './agent-adapters/dsh-typert.mjs';
import { createProviderFabricAdapter } from './agent-adapters/provider-fabric.mjs';
import { createPiNativeAdapter } from './agent-adapters/pi-native.mjs';
import { publicHarnessError } from './harness-adapter-contract.mjs';
import { discoverCompatibleProviderProfiles } from './harness-provider-discovery.mjs';
import { createHarnessProviderAdapter } from './harness-provider-adapter.mjs';
import { bridgeCorsHeaders, HarnessTransportError, validateLoopbackHost } from './bridge-server.mjs';

// JSON data only: recursively sort object keys, preserve array order, no whitespace.
export function canonicalReceipt(value) {
  return JSON.stringify(value, (_, item) => record(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
export function receiptFingerprint(publicKey) {
  return createHash('sha256').update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);
}

const fail = code => Object.assign(new Error(publicHarnessError({ code }).message), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,256}$/.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
function shape(value, required, optional = []) {
  if (!record(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => ![...required, ...optional].includes(key))) throw fail('invalid-event');
}
function sessionRef(value) {
  shape(value, ['addonId', 'sessionId', 'bootEpoch', 'generation']);
  if (!['addonId', 'sessionId', 'bootEpoch'].every(key => id(value[key])) || !revision(value.generation)) throw fail('invalid-event');
  return value;
}
function chatInput(input) {
  shape(input, ['messages'], ['model', 'surface', 'systemPrompt', 'pageContext', 'runtimeContext', 'tabContexts', 'contextSources']);
  if (!Array.isArray(input.messages) || !input.messages.length || input.messages.length > 256 || input.messages.some(message => {
    shape(message, ['role', 'content']);
    return !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 65536;
  })) throw fail('invalid-event');
  for (const key of ['model', 'surface', 'systemPrompt', 'pageContext', 'runtimeContext']) {
    if (Object.hasOwn(input, key) && (typeof input[key] !== 'string' || input[key].length > 65536)) throw fail('invalid-event');
  }
  for (const [key, fields, limit] of [['tabContexts', ['title', 'url', 'text'], 8], ['contextSources', ['source', 'kind', 'title', 'path', 'text'], 12]]) {
    if (!Object.hasOwn(input, key)) continue;
    if (!Array.isArray(input[key]) || input[key].length > limit) throw fail('invalid-event');
    for (const item of input[key]) {
      shape(item, fields);
      if (fields.some(field => typeof item[field] !== 'string' || item[field].length > 65536)) throw fail('invalid-event');
    }
  }
  return input;
}

// The extension's compatibility wire format includes provider options and
// nullable context. Normalize only those known fields before strict validation.
function compatibilityChatInput(payload) {
  if (!record(payload)) throw fail('invalid-event');
  const { workload, thinkingDepth, ...input } = payload;
  if (Object.hasOwn(payload, 'workload') && workload !== 'augmentor-chat') throw fail('invalid-event');
  if (Object.hasOwn(payload, 'thinkingDepth') &&
      (typeof thinkingDepth !== 'string' || thinkingDepth.length > 65536)) throw fail('invalid-event');
  for (const key of ['pageContext', 'runtimeContext']) if (input[key] === null) delete input[key];
  if (Array.isArray(input.tabContexts)) {
    if (input.tabContexts.length > 8) throw fail('invalid-event');
    input.tabContexts = input.tabContexts.map(tab => {
      shape(tab, ['title', 'url', 'text'], ['tabId']);
      if (Object.hasOwn(tab, 'tabId') && tab.tabId !== null && !revision(tab.tabId)) throw fail('invalid-event');
      const { title, url, text } = tab;
      return { title, url, text };
    });
  }
  return { ...chatInput(input),
    ...(Object.hasOwn(payload, 'workload') ? { workload } : {}),
    ...(Object.hasOwn(payload, 'thinkingDepth') ? { thinkingDepth } : {}),
  };
}

// Adapt 1B's bounded reader to the transport contract without changing either
// event provenance or OpenCode's subscription implementation.
export function createHarnessStreamSubscription(reader) {
  let terminalCode, afterEvent, transport;
  const subscription = {
    stream: true,
    get terminalCode() { return terminalCode; },
    get queuedBytes() { return 0; }, // The reader owns its own bounded queue.
    attachTransport(value) { transport = value; return () => { transport = undefined; }; },
    async close(code = 'runtime-unavailable') {
      if (!terminalCode) {
        terminalCode = publicHarnessError({ code }).code;
        await reader.return();
      }
      await transport?.terminate(terminalCode);
    },
    events: {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        if (afterEvent) { await subscription.close(afterEvent); return { done: true }; }
        const result = await reader.next();
        if (result.value?.type === 'error') {
          result.value = { ...result.value, data: publicHarnessError(result.value.data) };
          afterEvent = result.value.data.code;
        }
        return result;
      },
    },
  };
  return subscription;
}

export async function createHarnessHostService({ userRoot, store = createHarnessRegistryStore({ userRoot }),
  bindings = [], env = process.env, providerHost, resolveProviderProfileCredential, cleanupTimeoutMs = 1000, onReceipt = () => {}, fixtureSigningKey,
  transportFactory = createHarnessTransport, dshAdapterFactory = createDshTypertAdapter, openaiAdapterFactory = createOpenAICompatibleAdapter,
  piNativeAdapterFactory = createPiNativeAdapter, piNative = null } = {}) {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 30000) throw new TypeError('Bounded cleanup required.');
  const approvedBindings = structuredClone(bindings);
  const credentials = createHarnessCredentials({ bindings: approvedBindings, env, resolveProviderProfileCredential });
  const providerAdapter = createHarnessProviderAdapter({
    allProviderProfiles: providerHost?.allProviderProfiles?.bind(providerHost),
    allModelCatalog: providerHost?.allModelCatalog?.bind(providerHost),
  });
  const manifests = new Map(), resources = new Set();
  let closed = false, closing;
  const syncManifests = (document) => {
    for (const entry of Object.values(document?.state?.installations ?? {})) if (entry?.manifest?.id) manifests.set(entry.manifest.id, structuredClone(entry.manifest));
  };
  const trackedStore = {
    // Keep the host-side manifest view in sync with every durable registry
    // mutation (install/import/grants/remove), not only route-driven installs,
    // so provider-profile discovery and supported-operations projections stay
    // correct for direct registry consumers as well.
    async read() {
      const document = await store.read();
      syncManifests(document);
      return document;
    },
    write: (document) => { syncManifests(document); return store.write(document); },
  };
  const registry = await createHarnessRegistry({ store: trackedStore, reviewedAdapterIds: ['dsh-typert-v1', 'provider-fabric-v1', 'openai-compatible-v1', 'pi-native-v1', 'grok-native-v1'],
    bindings: approvedBindings.map(({ name, addonId, adapterId, authScheme, endpoint, source }) => ({
      name, addonId, adapterId, authScheme, endpoint,
      providerProfile: Boolean(source && typeof source.providerProfileId === 'string' && source.providerProfileId),
    })) });
  // Only the explicit fixture composition injects a public test key. Production
  // keys are generated anew, remain in this closure, and are never persisted.
  const { privateKey } = fixtureSigningKey ? { privateKey: fixtureSigningKey } : generateKeyPairSync('ed25519');
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 receipt key required.');
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  const signer = Object.freeze({ algorithm: 'ed25519', publicKey, fingerprint: receiptFingerprint(publicKey) });
  let receiptSequence = 0;
  const turnReceiptContext = new AsyncLocalStorage();
  function issue(fields) {
    const body = JSON.parse(canonicalReceipt({ ...fields, bootEpoch: registry.snapshot().bootEpoch,
      receiptSequence: ++receiptSequence, at: new Date().toISOString(),
      mode: fixtureSigningKey ? 'fixture' : 'live', signer: { algorithm: 'ed25519', keyId: signer.fingerprint } }));
    const receipt = { ...body, signature: sign(null, Buffer.from(canonicalReceipt(body)), privateKey).toString('base64') };
    // An observational sink cannot change the host result or authority.
    try { onReceipt(structuredClone(receipt)); } catch { /* Evidence collection is not runtime authority. */ }
    return receipt;
  }
  console.error(JSON.stringify({ event: 'harness.receipt_signer', bootEpoch: registry.snapshot().bootEpoch,
    fingerprint: signer.fingerprint, algorithm: signer.algorithm, mode: fixtureSigningKey ? 'fixture' : 'live' }));
  issue({ kind: 'boot', projection: registry.snapshot() });
  const candidates = env.RESONANTOS_HARNESS_DEMO === '1'
    ? await Promise.all(['deepseek-harness', 'provider-chat-demo'].map(async name => JSON.parse(await readFile(new URL(`./harness-examples/${name}.json`, import.meta.url), 'utf8')))) : [];
  async function bounded(operation) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise(resolve => { timer = setTimeout(resolve, cleanupTimeoutMs); })]); }
    catch { /* Local authority has already been withdrawn. */ }
    finally { clearTimeout(timer); }
  }
  async function resolveAdapter(authorization) {
    let adapter, transport;
    const runtime = authorization.runtime;
    // Host-owned compatibility + delivery gate for provider-profile harnesses.
    // The registry already enforced identity (binding addonId/adapter/scheme)
    // and the grant gate; here the generic adapter verifies the approved
    // profile's family is one the harness declared it can consume and that it
    // accepts runtime-adapter delivery. Incompatible declarations fail closed.
    if (runtime.credentialSource === 'provider-profile') {
      const binding = approvedBindings.find(candidate => candidate.addonId === authorization.addonId &&
        candidate.adapterId === runtime.adapterId && candidate.name === runtime.credentialBinding &&
        candidate.source && typeof candidate.source.providerProfileId === 'string' && candidate.source.providerProfileId);
      if (!binding) throw fail('permission-denied');
      const delivery = manifests.get(authorization.addonId)?.harnessProviderConnection?.credentialDelivery ?? [];
      // The runtime-adapter gate enforces protocol compatibility + delivery for
      // header-based transports. The pi-native-v1 session-environment chain
      // re-derives the SAME protocol gate and its delivery gate inside the
      // reviewed planner on every plan; it is not a runtime-adapter consumer.
      if (!(runtime.adapterId === 'pi-native-v1' && delivery.includes('session-environment'))) {
        await providerAdapter.plan({ manifest: manifests.get(authorization.addonId), providerProfileId: binding.source.providerProfileId });
      }
    }
    if (runtime.adapterId === 'provider-fabric-v1') {
      adapter = createProviderFabricAdapter({ executeRawProviderChat: providerHost?.executeRawProviderChat,
        readiness: async () => {
          const status = await providerHost.executeProviderStatus();
          return status.providers.some(provider => provider.configured === true && provider.models?.some(model => model.allowed === true));
        } });
      if (!(await adapter.probe()).available) throw fail('runtime-unavailable');
    } else if (authorization.runtime.adapterId === 'dsh-typert-v1') {
      transport = await transportFactory({ credentials, addonId: authorization.addonId, runtime: authorization.runtime });
      try { adapter = dshAdapterFactory({ transport }); }
      catch (error) { await bounded(() => transport.dispose()); throw error; }
    } else if (authorization.runtime.adapterId === 'openai-compatible-v1') {
      try { adapter = await openaiAdapterFactory({ credentials, addonId: authorization.addonId, runtime: authorization.runtime }); }
      catch (error) { await bounded(() => adapter?.dispose()); throw error; }
    } else if (runtime.adapterId === 'pi-native-v1') {
      // The reviewed native Pi session chain. The credential never reaches this
      // adapter: the host-wired session service resolves it into the private
      // session env and only redacted evidence returns. The approved binding
      // names the host-owned provider profile; the launch cwd comes from the
      // host-issued Project/Files projection (never a caller path).
      if (!piNative?.sessionService || typeof piNative.issueProjection !== 'function') throw fail('runtime-unavailable');
      const binding = approvedBindings.find(candidate => candidate.addonId === authorization.addonId &&
        candidate.adapterId === runtime.adapterId && candidate.name === runtime.credentialBinding &&
        candidate.source && typeof candidate.source.providerProfileId === 'string' && candidate.source.providerProfileId);
      if (!binding) throw fail('permission-denied');
      adapter = piNativeAdapterFactory({
        addonId: authorization.addonId,
        runtime,
        manifest: manifests.get(authorization.addonId),
        sessionService: piNative.sessionService,
        providerProfileId: binding.source.providerProfileId,
        issueProjection: piNative.issueProjection,
        stageSkills: piNative.stageSkills,
        cleanupSkills: piNative.cleanupSkills,
      });
      if (!(await adapter.probe()).available) throw fail('runtime-unavailable');
    } else throw fail('permission-denied');
    let disposed = false;
    const resource = {
      async dispose(args) {
        if (disposed) return;
        disposed = true;
        // Start both cleanups: an adapter awaiting a stuck cancel cannot retain
        // its transport. A rejection never prevents other sessions' cleanup.
        await Promise.all([bounded(() => adapter.dispose(args)), bounded(() => transport?.dispose())]);
        resources.delete(resource);
      },
    };
    resources.add(resource);
    if (closed) { await resource.dispose({}); throw fail('runtime-unavailable'); }
    return { ...adapter, dispose: resource.dispose,
      async *invoke(args) {
        const dispatch = { dispatchId: randomUUID(), addonId: authorization.addonId,
          generation: authorization.generation, adapterId: authorization.runtime.adapterId,
          ...turnReceiptContext.getStore() };
        issue({ kind: 'adapter-dispatch', ...dispatch });
        const aborted = () => issue({ kind: 'adapter-abort', ...dispatch });
        args.signal.addEventListener('abort', aborted, { once: true });
        if (args.signal.aborted) aborted();
        try { yield* await adapter.invoke(args); }
        finally { args.signal.removeEventListener('abort', aborted); }
      },
    };
  }
  const boundary = createHarnessBoundary({ registry, resolveAdapter, cleanupTimeoutMs });
  const snapshot = async () => {
    const projection = registry.snapshot();
    for (const [addonId, entry] of Object.entries(projection.installations)) entry.supportedOperations = [...(manifests.get(addonId)?.agentRuntime?.supportedOperations ?? [])];
    // Host-owned credential-configured status, keyed by the approved binding.
    // Never exposes a credential: only a boolean, and only for provider-profile
    // harnesses (null otherwise). A resolver miss reads as "not configured".
    await Promise.all(Object.entries(projection.installations).map(async ([addonId, entry]) => {
      if (entry.agentRuntime?.credentialSource !== 'provider-profile') return;
      const runtime = entry.agentRuntime;
      const binding = approvedBindings.find(candidate => candidate.addonId === addonId &&
        candidate.adapterId === runtime?.adapterId && candidate.name === runtime?.credentialBinding &&
        candidate.source && typeof candidate.source.providerProfileId === 'string' && candidate.source.providerProfileId);
      if (!binding) { entry.providerProfileConfigured = false; return; }
      try {
        await resolveProviderProfileCredential(binding.source.providerProfileId);
        entry.providerProfileConfigured = true;
      } catch { entry.providerProfileConfigured = false; }
    }));
    // Host-owned provider-profile discovery: only profiles/models compatible
    // with the harness's declared provider families. Metadata only — never a
    // credential, endpoint, or secret. A harness with no family declaration
    // receives an empty compatible set (no family claim, no catalog leak).
    if (typeof providerHost?.allProviderProfiles === 'function' && typeof providerHost?.allModelCatalog === 'function') {
      const profiles = await providerHost.allProviderProfiles();
      const catalog = await providerHost.allModelCatalog();
      for (const [, entry] of Object.entries(projection.installations)) {
        if (!entry.harnessProviderConnection) continue;
        const discovery = discoverCompatibleProviderProfiles({
          manifest: { harnessProviderConnection: entry.harnessProviderConnection, agentRuntime: entry.agentRuntime },
          profiles,
          modelCatalog: catalog,
        });
        entry.compatibleProviderProfiles = discovery.profiles;
        entry.compatibleModels = discovery.models;
      }
    }
    // Operator-approved provider profiles per add-on, mirroring the session
    // authorize gate's semantics (addonId + adapterId + authScheme match, no
    // binding-name coupling). Panels filter their pickers to this set so a
    // dedicated harness (e.g. Grok Build → its xAI profile) never offers a
    // profile the gate would deny. Empty array = no operator-approved profile.
    for (const [addonId, entry] of Object.entries(projection.installations)) {
      const runtime = entry.agentRuntime;
      if (!runtime || runtime.credentialSource !== 'provider-profile') continue;
      entry.approvedProviderProfileIds = approvedBindings
        .filter(candidate => candidate.addonId === addonId &&
          candidate.adapterId === runtime.adapterId &&
          candidate.authScheme === runtime.authScheme &&
          candidate.source && typeof candidate.source.providerProfileId === 'string' && candidate.source.providerProfileId)
        .map(candidate => candidate.source.providerProfileId);
    }
    return { ...projection, candidates: structuredClone(candidates) };
  };
  function route(method, path, capability, required, optional, handler, streaming = false) {
    return { method, path, requiredCapability: capability, loopbackHostOnly: true, errorFamily: 'harness',
      ...(streaming ? { responseType: 'sse', terminalEventFamily: 'harness' } : {}),
      async handler(payload, request = {}) {
        if (closed) throw fail('runtime-unavailable');
        const query = new URL(request.url ?? path, 'http://127.0.0.1').searchParams;
        if (streaming) {
          if ([...query.keys()].length !== new Set(query.keys()).size) throw fail('invalid-event');
          payload = Object.fromEntries(query);
          if (!/^(0|[1-9][0-9]*)$/.test(payload.generation ?? '')) throw fail('invalid-event');
          payload.generation = Number(payload.generation);
        } else if (query.size) throw fail('invalid-event');
        shape(payload, required, optional);
        if (Buffer.byteLength(JSON.stringify(payload)) > 1048576) throw fail('invalid-event');
        // Record only validated identities, never request headers, credentials or
        // caller-supplied chat context. Outcomes use sanitized host projections.
        const requestReceipt = {};
        for (const key of ['addonId', 'slot', 'session', 'turnId', 'expectedGeneration', 'replace', 'expectedRevision', 'enabled', 'bootEpoch', 'generation', 'sessionId']) {
          const value = payload[key];
          if (key === 'session' && record(value)) {
            requestReceipt.session = Object.fromEntries(['addonId', 'sessionId', 'bootEpoch', 'generation']
              .filter(field => field === 'generation' ? revision(value[field]) : id(value[field])).map(field => [field, value[field]]));
          } else if (typeof value === 'boolean' || revision(value) || id(value) || value === null) requestReceipt[key] = value;
        }
        if (path === '/addons/install' && id(payload.manifest?.id)) requestReceipt.addonId = payload.manifest.id;
        try {
          const result = await handler(payload);
          if (streaming) {
            issue({ kind: 'route', operation: path, request: requestReceipt, ok: true, result: { subscribed: true } });
            const events = result.events;
            result.events = {
              [Symbol.asyncIterator]() { return this; },
              async next() {
                const item = await events.next();
                if (item.done) issue({ kind: 'stream-closed', session: payload });
                else issue({ kind: 'event', event: item.value });
                return item;
              },
            };
          } else {
            const declaration = path === '/addons/install' ? {
              systemSlots: payload.manifest.systemSlots,
              agentRuntime: payload.manifest.agentRuntime,
              tools: payload.manifest.tools,
            } : undefined;
            issue({ kind: 'route', operation: path, request: requestReceipt, ok: true, result, declaration,
              ...(path === '/agent/turn' ? { runtime: manifests.get(payload.session.addonId)?.agentRuntime } : {}) });
          }
          return result;
        } catch (error) {
          issue({ kind: 'route', operation: path, request: requestReceipt, ok: false,
            error: publicHarnessError(error), projection: registry.snapshot() });
          throw error;
        }
      },
    };
  }
  const read = 'addon-runtime-read', control = 'addon-runtime-control';
  const harnessRoutes = [
    route('GET', '/addons/registry', read, [], [], () => snapshot()),
    route('POST', '/addons/install', control, ['manifest', 'enabled'], [], async p => {
      if (typeof p.enabled !== 'boolean') throw fail('invalid-event');
      await registry.install(p.manifest, { enabled: p.enabled });
      manifests.set(p.manifest.id, structuredClone(p.manifest)); return snapshot();
    }),
    route('POST', '/addons/grants', control, ['addonId', 'grants', 'consent', 'expectedRevision'], [], async p => {
      if (!id(p.addonId) || !Array.isArray(p.grants) || typeof p.consent !== 'boolean' || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.setGrants(p.addonId, p.grants, p); return snapshot();
    }),
    route('POST', '/addons/enabled', control, ['addonId', 'enabled', 'expectedRevision'], [], async p => {
      if (!id(p.addonId) || typeof p.enabled !== 'boolean' || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.setEnabled(p.addonId, p.enabled, p); return snapshot();
    }),
    route('POST', '/addons/remove', control, ['addonId'], [], async p => {
      if (!id(p.addonId)) throw fail('invalid-event');
      await registry.remove(p.addonId); manifests.delete(p.addonId); return snapshot();
    }),
    route('POST', '/addons/slots/assign', control, ['slot', 'addonId', 'expectedGeneration'], ['replace'], async p => {
      if (!id(p.slot) || (p.addonId !== null && !id(p.addonId)) || !revision(p.expectedGeneration) || (p.replace !== undefined && typeof p.replace !== 'boolean')) throw fail('invalid-event');
      await registry.assignSlot(p.slot, p.addonId, p); return snapshot();
    }),
    route('POST', '/agent/session', control, ['addonId'], [], async p => {
      if (!id(p.addonId)) throw fail('invalid-event');
      return { session: await boundary.createSession(p) };
    }),
    route('POST', '/agent/turn', control, ['session', 'input'], [], p => {
      const session = sessionRef(p.session), input = chatInput(p.input);
      const context = { session: structuredClone(session) };
      const { turnId } = turnReceiptContext.run(context, () => boundary.invoke(session, input));
      context.turnId = turnId;
      return { turnId };
    }),
    route('POST', '/agent/dispose', control, ['session'], [], async p => {
      await boundary.dispose(sessionRef(p.session)); return {};
    }),
    route('POST', '/agent/cancel', control, ['session', 'turnId'], [], async p => {
      const session = sessionRef(p.session);
      if (!id(p.turnId)) throw fail('invalid-event');
      await boundary.cancel(session, p.turnId); return {};
    }),
    route('GET', '/agent/events', read, ['addonId', 'sessionId', 'bootEpoch', 'generation'], [], p => createHarnessStreamSubscription(boundary.events(sessionRef(p))), true),
    route('POST', '/agent/history', read, ['session'], [], async p => ({ history: await boundary.history(sessionRef(p.session)) })),
    route('POST', '/agent/status', read, ['session'], [], async p => ({ status: await boundary.status(sessionRef(p.session)) })),
    route('POST', '/agent/select-model', control, ['session', 'model'], [], async p => {
      const session = sessionRef(p.session);
      shape(p.model, ['provider', 'model']);
      if (Object.values(p.model).some(value => typeof value !== 'string' || !value.trim() || value.length > 256)) throw fail('invalid-event');
      return { selection: await boundary.selectModel(session, p.model) };
    }),
  ];
  let compatibilitySession, compatibilityBusy = false;
  async function executeBridgeChat(payload, request) {
    const projection = registry.snapshot();
    if (!projection.governanceActivated) {
      if (closed) throw fail('runtime-unavailable');
      return providerHost.executeBridgeChat(payload);
    }
    try {
      if (closed) throw fail('runtime-unavailable');
      if (request) {
        const transport = request.bridgeTransport ?? request.openCodeTransport ?? {};
        if (!validateLoopbackHost(request, transport)) throw fail('permission-denied');
        if (request.headers?.origin && bridgeCorsHeaders(transport.extensionOrigin, request.headers, transport.allowedOrigins)
          ['Access-Control-Allow-Origin'] !== request.headers.origin) throw fail('permission-denied');
      }
      return await executeGovernedChat(payload, projection);
    } catch (error) {
      throw new HarnessTransportError(error);
    }
  }
  async function executeGovernedChat(payload, projection) {
    const input = compatibilityChatInput(payload);
    const owner = projection.slots['primary-agent'];
    registry.authorize('primary-agent', owner?.addonId);
    if (compatibilityBusy) throw fail('ownership-conflict');
    compatibilityBusy = true;
    let reader, timer, turn;
    try {
      if (!compatibilitySession || compatibilitySession.generation !== owner.generation || compatibilitySession.addonId !== owner.addonId) {
        compatibilitySession = await boundary.createSession({ addonId: owner.addonId });
      }
      reader = boundary.events(compatibilitySession);
      const context = { session: structuredClone(compatibilitySession) };
      turn = turnReceiptContext.run(context, () => boundary.invoke(compatibilitySession, input));
      context.turnId = turn.turnId;
      return await Promise.race([
        (async () => {
          for await (const event of reader) {
            if (event.type === 'final') {
              issue({ kind: 'event', operation: '/augmentor/chat', event });
              return { reply: event.data.text, harness: { ...compatibilitySession, turnId: turn.turnId } };
            }
            if (event.type === 'error') throw fail(event.data.code);
            if (event.type === 'cancelled') throw fail('cancelled');
          }
          throw fail('runtime-unavailable');
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          void boundary.cancel(compatibilitySession, turn.turnId).catch(() => {});
          reject(fail('deadline-exceeded'));
        }, 30000); }),
      ]);
    } finally { clearTimeout(timer); await reader?.return(); compatibilityBusy = false; }
  }
  return { registry, boundary, harnessRoutes, executeBridgeChat, signer,
    composeProviderRoutes(routes) {
      return routes.map(route => route.method === 'POST' && route.path === '/augmentor/chat'
        ? { ...route, handler: executeBridgeChat }
        : route);
    },
    close() {
      if (!closing) {
        closed = true;
        closing = boundary.close().catch(() => {}).then(() => Promise.allSettled([...resources].map(resource => resource.dispose({}))));
      }
      return closing;
    },
  };
}
