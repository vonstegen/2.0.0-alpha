// Composition owns routes, never grants inferred from bridge authentication.
import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { tmpdir as osTmpdir } from 'node:os';
import { createHarnessRegistry } from './harness-registry.mjs';
import { createHarnessRegistryStore } from './harness-registry-store.mjs';
import { createHarnessBoundary } from './harness-boundary.mjs';
import { createHarnessCredentials } from './harness-credentials.mjs';
import { createHarnessTransport } from './harness-transport.mjs';
import { createOpenAICompatibleAdapter } from './agent-adapters/openai-compatible.mjs';
import { createDshTypertAdapter } from './agent-adapters/dsh-typert.mjs';
import { createProviderFabricAdapter } from './agent-adapters/provider-fabric.mjs';
import { createExternalCliTerminalAdapter } from './agent-adapters/external-cli-terminal.mjs';
import { publicHarnessError, assertValidHarnessManifest } from './harness-adapter-contract.mjs';
import { bridgeCorsHeaders, HarnessTransportError, validateLoopbackHost } from './bridge-server.mjs';
import { attachSessionEnv, buildProjectedSessionEnv, composeBootstrapCommand, consumeGrant, mintSessionBootstrapGrant, trackSessionBootstrapGrant } from './terminal-host-service.mjs';
import { ensureBridgeReachable, DEFAULT_BRIDGE_ENDPOINT } from './bridge-bootstrap.mjs';
import { getHarnessPolicy } from './harness-policy-registry.mjs';
import { piCommand } from './pi-runtime.mjs';

// Host platform token for the terminal-surface compatibility verdict.
// Mirrors harness-registry's `compatibleWithHost` (the same map and
// fallback) so `/terminal-host/status` reports the same verdict the
// registry projection already exposes as `entry.compatible`. The route
// computes it from the manifest because `entry.compatible` is only
// present for factoryId-pinned (lifecycle-managed) installations.
const HOST_PLATFORM_TOKEN = (() => {
  const tokens = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
  return tokens[process.platform] ?? process.platform;
})();

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

export async function createHarnessHostService({ userRoot, stateRoot, store = createHarnessRegistryStore({ userRoot, stateRoot }),
  bindings = [], env = process.env, providerHost, hostTerminal, terminalHost, cleanupTimeoutMs = 1000, onReceipt = () => {}, fixtureSigningKey,
  transportFactory = createHarnessTransport, dshAdapterFactory = createDshTypertAdapter, openaiAdapterFactory = createOpenAICompatibleAdapter,
  promptFilePath, seedInstallations = [],
  // CP-BR10: fixed install root for the `ros-session` CLI the
  // `POST /terminal-host/connection-script` route embeds in the
  // returned script. The host never sources this from caller argv or
  // the ambient PATH; the operator may override at composition time
  // (tests do).
  rosSessionPath,
  // CP-S5H3: bridge base URL + bridge/capability tokens, vended at
  // script-mint time, so the pasted connection script's ros-session
  // attach can authenticate with the loopback bridge (the same
  // discipline the launch path's `--auth-file` uses: 0600 JSON,
  // path-only on the clipboard, read-then-unlinked by the CLI).
  attachAuth = null } = {}) {
  if (!Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 30000) throw new TypeError('Bounded cleanup required.');
  // Step 5, 5B default for the pi-terminal-v1 adapter. Tests inject
  // their own factory to point at a temp dir. (The grant token file is
  // owned by terminal-host-service.launchBootstrap, not by this wiring.)
  // CP-XH5b: the prompt-file path must be STABLE per host instance.
  // The `/terminal-host/prompt-path` route and the launcher both call
  // this factory, and the renderer polls the route; if each call
  // minted a fresh random name, the operator would write a 0600 prompt
  // to one path and the next poll would stat a different (absent) path,
  // so `valid` never flips true and "Run session" stays disabled.
  let resolvedDefaultPromptPath = null;
  const defaultPromptFilePath = promptFilePath ?? (() => {
    if (resolvedDefaultPromptPath === null) {
      resolvedDefaultPromptPath = `${osTmpdir()}/pi-prompt-${randomUUID().slice(0, 8)}.txt`;
    }
    return resolvedDefaultPromptPath;
  });
  const approvedBindings = structuredClone(bindings);
  const credentials = createHarnessCredentials({ bindings: approvedBindings, env });
  const manifests = new Map(), resources = new Set();
  // CP-XH5a: launch persistence. The new `POST /terminal-host/launch`
  // route records every accepted launch here so the existing
  // `GET /terminal-host/status` (CP-XH4c) surfaces session count +
  // ids. Map shape: launchId -> {
  //   launchId, agentId, terminalAddonId, executablePath, promptPath,
  //   startedAt, sessionId }
  // No token, credential, env value, memory content, or arbitrary
  // path lives here — only the documented fields.
  const launchPersistence = new Map();
  // CP-BR10: connection-script adoptions. The host mints a single-use
  // grant for the operator to paste into an already-running terminal;
  // while the script is unconsumed, the adopted sessionId is tracked
  // here so disable / revoke / remove can close it. Consumed (the
  // operator pasted the script and the bridge claimed the grant) or
  // expired (TTL 60s — see SESSION_BOOTSTRAP_GRANT_TTL_MS in
  // terminal-host-service.mjs) adoptions are dropped from the map.
  const connectionScriptAdoptions = new Map();

  // CP-BR10: best-effort cleanup of all unconsumed adoptions for
  // the given add-on. Iterates the tracked map, asks the live
  // terminal-host service to terminate each session, and drops the
  // adoption. Each call is bounded; the grant TTL is the safety
  // net for adoptions that fail to terminate.
  async function closeConnectionScriptAdoptions(addonId) {
    const owned = [...connectionScriptAdoptions.values()].filter((entry) => entry.terminalAddonId === addonId);
    for (const entry of owned) {
      connectionScriptAdoptions.delete(entry.sessionId);
      // Unconsumed adoption: remove the 0600 files the operator never
      // pasted (the CLI unlinks them itself on a successful paste).
      if (typeof entry.tokenFilePath === "string") await unlink(entry.tokenFilePath).catch(() => {});
      if (typeof entry.authFilePath === "string") await unlink(entry.authFilePath).catch(() => {});
      if (!terminalHost?.service || typeof terminalHost.service.terminateSession !== 'function') continue;
      try {
        await terminalHost.service.terminateSession({ sessionId: entry.sessionId, terminalAddonId: entry.terminalAddonId });
      } catch {
        /* best effort */
      }
    }
  }
  // CP-XH5b: prompt-path resolver. The UI asks the host what path
  // the operator should write their prompt to, and whether a valid
  // 0600 file currently exists there. The host owns this seam so
  // the renderer never invents the path itself.
  const resolvePromptPath = () => {
    try { return defaultPromptFilePath(); } catch { return null; }
  };
  // CP-XH5d: optional sink for structured launch-telemetry events.
  // Default sink is a no-op so tests + production wiring stay free
  // of side effects unless explicitly opted in.
  let launchTelemetrySink = ({ event, payload }) => {
    try { console.error(JSON.stringify({ event, ...payload })); } catch { /* sink may be local-only */ }
  };
  const setLaunchTelemetrySink = (sink) => {
    if (typeof sink === 'function') launchTelemetrySink = sink;
  };
  let closed = false, closing;
  const trackedStore = {
    async read() {
      const document = await store.read();
      for (const entry of Object.values(document?.state?.installations ?? {})) if (entry?.manifest?.id) manifests.set(entry.manifest.id, structuredClone(entry.manifest));
      return document;
    },
    write: document => store.write(document),
    watermark: () => store.watermark?.() ?? null,
    raise: revision => store.raise?.(revision),
    watermarkPath: store.watermarkPath ?? null,
  };
  const registry = await createHarnessRegistry({ store: trackedStore, reviewedAdapterIds: ['dsh-typert-v1', 'provider-fabric-v1', 'openai-compatible-v1', 'pi-terminal-v1', 'external-cli-terminal-v1'],
    bindings: approvedBindings.map(({ name, addonId, adapterId, authScheme, endpoint }) => ({ name, addonId, adapterId, authScheme, endpoint })) });
  // CP-BR9: reviewed installation seed. Each entry is a host-owned
  // `{ manifest, factoryId }` pair (see terminal-addon-seed.mjs). The seed
  // runs through the same registry path the `/addons/install` route uses —
  // durable, validated, and idempotent across fresh boots:
  //   - not installed          -> install disabled with the factory pin;
  //   - installed, wrong/no pin -> pinFactory repairs the pin and refreshes
  //     the stored manifest to the reviewed copy (consent preserved);
  //   - installed, pinned       -> left untouched (operator enable/grant
  //     state survives restarts).
  // The seed never enables anything and never grants a capability.
  for (const seed of seedInstallations) {
    if (!seed || typeof seed !== 'object' || typeof seed.factoryId !== 'string' || seed.factoryId.length === 0) {
      throw new TypeError('seedInstallations entries must be { manifest, factoryId } with a non-empty factory id.');
    }
    assertValidHarnessManifest(seed.manifest);
    const existing = registry.snapshot().installations[seed.manifest.id];
    if (!existing) {
      await registry.install(seed.manifest, { enabled: false, factoryId: seed.factoryId, expectedRevision: registry.snapshot().revision });
      manifests.set(seed.manifest.id, structuredClone(seed.manifest));
    } else if (existing.factoryId !== seed.factoryId) {
      await registry.pinFactory(seed.manifest.id, seed.factoryId, { manifest: seed.manifest });
      manifests.set(seed.manifest.id, structuredClone(seed.manifest));
    }
  }
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
    ? await Promise.all(['deepseek-harness', 'provider-chat-demo', 'pi'].map(async name => JSON.parse(await readFile(new URL(`./harness-examples/${name}.json`, import.meta.url), 'utf8')))) : [];
  async function bounded(operation) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(operation), new Promise(resolve => { timer = setTimeout(resolve, cleanupTimeoutMs); })]); }
    catch { /* Local authority has already been withdrawn. */ }
    finally { clearTimeout(timer); }
  }
  async function resolveAdapter(authorization) {
    let adapter, transport;
    if (authorization.runtime.adapterId === 'provider-fabric-v1') {
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
    } else if (authorization.runtime.adapterId === 'pi-terminal-v1' || authorization.runtime.adapterId === 'external-cli-terminal-v1') {
      // XH2: pi-terminal-v1 routes through the generic external-CLI
      // launcher with the reviewed pi-v1 policy. The adapter id is
      // reviewed; the host must have installed the terminal-host
      // service (terminalHost.service + terminalHost.start).
      if (!terminalHost?.service || !terminalHost?.start?.bus) {
        throw fail('runtime-unavailable');
      }
      // The reviewed policy id comes from the manifest's
      // agentRuntime.policyId (XH1) or, for the legacy pi-terminal-v1
      // adapter id, defaults to "pi-v1". Manifests that lack a
      // policyId fail closed.
      const policyId = authorization.runtime.policyId ?? (authorization.runtime.adapterId === 'pi-terminal-v1' ? 'pi-v1' : null);
      if (typeof policyId !== 'string' || policyId.length === 0) {
        throw fail('invalid-manifest');
      }
      const sessionId = `${authorization.addonId}-${randomUUID().slice(0, 8)}`;
      try {
        adapter = createExternalCliTerminalAdapter({
          sessionId,
          policyId,
          terminalHostService: terminalHost.service,
          terminalHostStart: terminalHost.start,
          promptFilePath: promptFilePath ?? defaultPromptFilePath,
          harness: authorization.addonId,
          ...(hostTerminal ? { hostTerminal } : {}),
        });
      } catch (error) {
        // Adapter construction itself failed (e.g. policy not
        // reviewed, or compatible surface missing).
        throw fail('runtime-unavailable');
      }
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
  const snapshot = () => {
    const projection = registry.snapshot();
    for (const [addonId, entry] of Object.entries(projection.installations)) entry.supportedOperations = [...(manifests.get(addonId)?.agentRuntime?.supportedOperations ?? [])];
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
    route('POST', '/addons/install', control, ['manifest', 'enabled', 'expectedRevision'], [], async p => {
      if (typeof p.enabled !== 'boolean' || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.install(p.manifest, p);
      manifests.set(p.manifest.id, structuredClone(p.manifest)); return snapshot();
    }),
    route('POST', '/addons/grants', control, ['addonId', 'grants', 'consent', 'expectedRevision'], [], async p => {
      if (!id(p.addonId) || !Array.isArray(p.grants) || typeof p.consent !== 'boolean' || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.setGrants(p.addonId, p.grants, p); return snapshot();
    }),
    route('POST', '/terminal-host/session/attach', control, ['sessionId', 'token', 'providerProfileId'], ['harness', 'project', 'resolveCredential', 'authorizedProject', 'request', 'grantedCapabilities', 'skillCatalog', 'skillSourceRoot', 'stagingBase', 'resourceHooks', 'memoryAccess', 'memoryRoot', 'approvedMemoryDomains'], async p => {
      if (!id(p.sessionId) || typeof p.token !== 'string' || p.token.length === 0 || typeof p.providerProfileId !== 'string' || p.providerProfileId.length === 0) throw fail('invalid-event');
      // resolveCredential precedence:
      //   1. caller-injected (tests + ad-hoc callers) — sync
      //   2. hostTerminal?.resolveCredential (host boundary, default in
      //      production) — async. Pre-resolve here so the sync seam used
      //      by attachSessionEnv / buildProjectedSessionEnv can be satisfied
      //      without a contract change to step-3.
      //   3. null (no resolver -> route returns ok:false, reason:'missing-credential')
      let resolveCredential;
      if (typeof p.resolveCredential === 'function') {
        const stub = p.resolveCredential;
        resolveCredential = (profileId) => {
          const result = stub(profileId);
          return (result && typeof result === 'object' && 'name' in result && 'value' in result) ? result : null;
        };
      } else if (hostTerminal && typeof hostTerminal.resolveCredential === 'function') {
        // Pre-resolve the single credential for this request. The host
        // wiring may be async (e.g. allProviderProfiles() + readProviderSecrets());
        // the step-3 module's seam is sync, so we bridge once per request.
        const preResolved = await hostTerminal.resolveCredential(p.providerProfileId);
        if (preResolved && typeof preResolved === 'object' &&
            typeof preResolved.name === 'string' && typeof preResolved.value === 'string') {
          resolveCredential = () => preResolved;
        }
        // If pre-resolved is null, the route falls through to attachSessionEnv
        // / buildProjectedSessionEnv without a resolver, which surfaces
        // missing-credential as the rejection reason.
      }
      // Step 5A: when the caller supplies a plain `project` root and host
      // wiring is installed, materialize a real authorizedProject from the
      // host-owned project store. The id + label are NEVER caller-controlled
      // — the host wiring owns them. The caller may still pass an explicit
      // authorizedProject + request; that path is unchanged.
      let authorizedProject = p.authorizedProject;
      let skillCatalog = p.skillCatalog;
      let skillSourceRoot = p.skillSourceRoot;
      let stagingBase = p.stagingBase;
      if (!authorizedProject && p.project && typeof p.project === 'object' && typeof p.project.root === 'string' && hostTerminal) {
        const materialized = await hostTerminal.resolveProjectIdentity({ root: p.project.root });
        if (materialized) {
          authorizedProject = materialized;
          if (typeof hostTerminal.resolveSkillCatalog === 'function') {
            skillCatalog = await hostTerminal.resolveSkillCatalog(materialized);
          }
          if (!skillSourceRoot) skillSourceRoot = hostTerminal.skillSourceRoot;
          if (!stagingBase) stagingBase = hostTerminal.stagingBase;
        }
      }
      // Projection inputs are optional: when present, the route consumes the
      // grant explicitly, then delegates to buildProjectedSessionEnv for the
      // full projected env (project root + skills dir + credential). When
      // absent, it delegates to attachSessionEnv (step-3 contract) which
      // owns the grant consumption.
      const hasProjection = !!(authorizedProject && p.request);
      let result;
      if (hasProjection) {
        const claim = consumeGrant({ sessionId: p.sessionId, token: p.token });
        if (!claim.ok) return { ok: false, reason: claim.reason };
        result = await buildProjectedSessionEnv({
        sessionId: p.sessionId,
        harness: p.harness,
        authorizedProject,
        request: p.request,
        grantedCapabilities: p.grantedCapabilities ?? [],
        skillCatalog,
        skillSourceRoot,
        stagingBase,
        providerProfileId: p.providerProfileId,
        ...(resolveCredential ? { resolveCredential } : {}),
        ...(p.resourceHooks ? { resourceHooks: p.resourceHooks } : {}),
        ...(p.memoryAccess !== undefined ? { memoryAccess: p.memoryAccess } : {}),
        ...(p.memoryRoot !== undefined ? { memoryRoot: p.memoryRoot } : {}),
        ...(p.approvedMemoryDomains !== undefined ? { approvedMemoryDomains: p.approvedMemoryDomains } : {}),
      });
      } else {
        // CP-M2: when there is no resource projection, but the caller
        // declared memory access, we still want to surface ROS_MEMORY_CONTEXT
        // (or a non-secret meta marker). attachSessionEnv does NOT own the
        // memory seam; instead we issue a minimal buildProjectedSessionEnv
        // call with no resource/skills projection so the memory step runs.
        if (p.memoryAccess !== undefined) {
          const claim = consumeGrant({ sessionId: p.sessionId, token: p.token });
          if (!claim.ok) return { ok: false, reason: claim.reason };
          result = await buildProjectedSessionEnv({
            sessionId: p.sessionId,
            harness: p.harness,
            ...(p.project ? { authorizedProject: { id: 'memory-only', label: 'Memory Only', root: typeof p.project?.root === 'string' ? p.project.root : '' } } : {}),
            grantedCapabilities: p.grantedCapabilities ?? [],
            ...(skillCatalog ? { skillCatalog } : {}),
            ...(skillSourceRoot ? { skillSourceRoot } : {}),
            ...(stagingBase ? { stagingBase } : {}),
            providerProfileId: p.providerProfileId,
            ...(resolveCredential ? { resolveCredential } : {}),
            ...(p.resourceHooks ? { resourceHooks: p.resourceHooks } : {}),
            ...(p.memoryAccess !== undefined ? { memoryAccess: p.memoryAccess } : {}),
            ...(p.memoryRoot !== undefined ? { memoryRoot: p.memoryRoot } : {}),
            ...(p.approvedMemoryDomains !== undefined ? { approvedMemoryDomains: p.approvedMemoryDomains } : {}),
          });
        } else {
        result = attachSessionEnv({
          sessionId: p.sessionId,
          token: p.token,
          harness: p.harness,
          project: p.project,
          providerProfileId: p.providerProfileId,
          ...(resolveCredential ? { resolveCredential } : {}),
        });
        }
      }
      if (!result.ok) return { ok: false, reason: result.reason, ...(result.code ? { code: result.code } : {}) };
      const { _meta, ...envOnly } = result.env;
      return { ok: true, env: envOnly, meta: _meta ? JSON.parse(_meta) : null };
    }),
    // CP-XH4c: GET /terminal-host/status
    //
    // Loopback-only (loopbackHostOnly is set by route()) and requires
    // addon-runtime-control. Returns a non-secret projection of every
    // terminal-host surface registered with the harness: adapterId,
    // label, compatibility verdict, and `connected` derived from the
    // live terminal-host-service status. The route NEVER returns a
    // token, credential, path, env value, or any other host-private
    // material — see `assertNoSecretShapedValue` in the shape-walker
    // test for the enforcement invariant.
    route('GET', '/terminal-host/status', control, [], [], async () => {
      const projection = snapshot();
      // Top-level merged view (any live terminal); per-surface
      // connectivity is resolved per add-on below so TWO concurrently
      // live terminals both report connected on their own cards.
      const serviceStatus = typeof terminalHost?.service?.status === 'function'
        ? terminalHost.service.status()
        : { alive: false, driveId: 'in-memory', adapterId: null, sessions: [] };
      const surfaces = [];
      for (const [addonId, entry] of Object.entries(projection.installations)) {
        const manifest = manifests.get(addonId);
        if (!manifest || !manifest.surfaces) continue;
        const terminalSurface = manifest.surfaces.find((surface) => surface.embeddedWorkspace?.mode === 'terminal'
          || surface.shellNavigation?.sectionId === 'terminal');
        if (!terminalSurface) continue;
        // "compatible" is the host's compatibility verdict — whether the
        // surface's declared platform matches this host — NOT the grant
        // state. The terminal-host grant is operator-consented and lives
        // separately in `entry.grantedCapabilities`; conflating the two
        // made pre-grant surfaces render as "Not installed" with launch
        // and copy disabled.
        const platforms = manifest?.compatibility?.platforms;
        const compatible =
          !Array.isArray(platforms) ||
          platforms.length === 0 ||
          platforms.includes(HOST_PLATFORM_TOKEN);
        const surfaceStatus = typeof terminalHost?.service?.status === 'function'
          ? terminalHost.service.status(addonId)
          : { alive: false, driveId: null, adapterId: null };
        const connected = Boolean(compatible && surfaceStatus.alive === true
          && surfaceStatus.driveId != null
          && surfaceStatus.adapterId === addonId);
        surfaces.push({
          adapterId: addonId,
          label: terminalSurface.label || manifest.name,
          compatible,
          connected,
        });
      }
      // CP-XH5a: surface accepted launches alongside the live
      // terminal-host service sessions. The launch records carry
      // ONLY documented fields — no token, credential, env value,
      // memory content, or arbitrary path.
      const launchRecords = [...launchPersistence.values()].map((entry) => ({
        launchId: entry.launchId,
        agentId: entry.agentId,
        terminalAddonId: entry.terminalAddonId,
        startedAt: entry.startedAt,
      }));
      return {
        connected: Boolean(serviceStatus.alive),
        driveId: serviceStatus.driveId,
        surfaces,
        sessions: Array.isArray(serviceStatus.sessions) ? serviceStatus.sessions : [],
        launches: launchRecords,
      };
    }),
    // CP-XH5b: GET /terminal-host/prompt-path
    //
    // The "Open in Terminal" UI asks the host what path the operator
    // should write their prompt to, and whether a valid 0600 file is
    // already there. Loopback-only, addon-runtime-control. Returns
    // `{ promptPath, valid }`. The route NEVER reads the file
    // content; it only stats it for existence + mode.
    route('GET', '/terminal-host/prompt-path', control, [], [], async () => {
      const promptPath = resolvePromptPath();
      if (!promptPath || typeof promptPath !== 'string' || !promptPath.startsWith('/')) {
        return { promptPath: null, valid: false };
      }
      const fileStat = await stat(promptPath).catch(() => null);
      if (!fileStat || !fileStat.isFile()) return { promptPath, valid: false };
      const mode = fileStat.mode & 0o777;
      return { promptPath, valid: mode === 0o600 };
    }),
    // CP-BR11.1: POST /terminal-host/prompt
    //
    // The "Write a prompt" affordance. Writes the operator's prompt to the
    // host-authoritative 0600 path (the same path the prompt-path and
    // launch routes use). Loopback-only, addon-runtime-control. The route
    // writes the bytes and never reads them back or logs the content; the
    // text is bounded so a chatty renderer cannot grow the file without
    // bound.
    route('POST', '/terminal-host/prompt', control, ['text'], [], async p => {
      if (typeof p.text !== 'string' || p.text.length === 0 || p.text.length > 65536) throw fail('invalid-event');
      const promptPath = resolvePromptPath();
      if (!promptPath || typeof promptPath !== 'string' || !promptPath.startsWith('/')) {
        return { promptPath: null, valid: false };
      }
      await writeFile(promptPath, p.text, { mode: 0o600 });
      return { promptPath, valid: true };
    }),
    // CP-XH5a: POST /terminal-host/launch
    //
    // The "Open in Terminal" launch affordance. Loopback-only
    // (loopbackHostOnly is set by route()) and requires
    // addon-runtime-control.
    //
    // Request body:
    //   {
    //     agentId: "pi" | "opencode" | "codex" | "hermes",
    //     terminalAddonId: "addon.resonant-terminal-ghostty" |
    //                      "addon.resonant-terminal-iterm2",
    //     promptPath: string /* absolute, 0600, regular file */,
    //     options?: { memoryAccess?, env?, commandSuffix? }
    //   }
    //
    // Behavior:
    //   a. Validate `promptPath` via `stat` only — the host never
    //      reads the prompt content. Absolute + regular file +
    //      mode 0o600 is required.
    //   b. Look up the installed terminal add-on manifest + verify
    //      the `terminal-host` capability is currently granted
    //      (typed `capability-not-granted` otherwise).
    //   c. Resolve the harness executable via the reviewed policy
    //      (currently `pi-v1` for `agentId === "pi"`).
    //   d. Call `composeInvocationFromFile({ executable, promptPath,
    //      promptBytes })` so the prompt content never enters the
    //      host code path.
    //   e. Call `terminalHost.service.launchBootstrap({
    //      commandSuffix: invocation, ... })` so the projected env
    //      (memory/skills/project/credential) is wired.
    //   f. Probe the bridge loopback endpoint via `ensureBridgeReachable`
    //      BEFORE wiring any of the above — if the bridge is not
    //      running, the route returns the typed `bridge-not-running`
    //      error and the UI surfaces the Settings deep-link.
    //
    // Returns a non-secret receipt
    //   { launchId, agentId, terminalAddonId, executablePath,
    //     promptPath, startedAt }
    route('POST', '/terminal-host/launch', control, ['agentId', 'terminalAddonId', 'promptPath'], ['options', 'providerProfileId'], async p => {
      const requestedAgentId = typeof p.agentId === 'string' ? p.agentId.trim() : '';
      const requestedAddonId = typeof p.terminalAddonId === 'string' ? p.terminalAddonId.trim() : '';
      const promptPath = typeof p.promptPath === 'string' ? p.promptPath.trim() : '';
      const providerProfileId = typeof p.providerProfileId === 'string' ? p.providerProfileId.trim() : '';
      const options = (p.options && typeof p.options === 'object' && !Array.isArray(p.options)) ? p.options : {};
      if (requestedAgentId !== 'pi' && requestedAgentId !== 'opencode' && requestedAgentId !== 'codex' && requestedAgentId !== 'hermes') {
        throw fail('invalid-event');
      }
      if (!id(requestedAddonId)) throw fail('invalid-event');
      if (!promptPath.startsWith('/')) throw fail('invalid-event');
      // Validate options early so a malformed memoryAccess/env/commandSuffix
      // cannot reach OOM-prone launch path code.
      if (options.commandSuffix !== undefined && (typeof options.commandSuffix !== 'string' || options.commandSuffix.length === 0)) {
        throw fail('invalid-event');
      }
      if (options.env !== undefined && (!record(options.env) || Object.keys(options.env).length > 64)) {
        throw fail('invalid-event');
      }
      if (options.memoryAccess !== undefined && !record(options.memoryAccess)) {
        throw fail('invalid-event');
      }
      // a. Validate the prompt file via stat only.
      const promptStat = await stat(promptPath).catch(() => null);
      if (!promptStat || !promptStat.isFile()) throw fail('invalid-event');
      // POSIX only — Windows is not in scope here.
      const promptMode = promptStat.mode & 0o777;
      if (promptMode !== 0o600) throw fail('invalid-event');

      // f. Bridge probe FIRST. If the bridge is not running we
      //    surface the typed error and never mint a grant or
      //    touch the host projection.
      const probe = await ensureBridgeReachable({
        endpoint: (typeof options.bridgeEndpoint === 'string' && options.bridgeEndpoint.length > 0)
          ? options.bridgeEndpoint
          : DEFAULT_BRIDGE_ENDPOINT,
        timeoutMs: 1500,
      });
      if (!probe.ok) return probe;

      // b. Look up the terminal add-on + verify terminal-host grant.
      const projection = snapshot();
      const installation = projection.installations[requestedAddonId];
      if (!installation || installation.enabled !== true) return { ok: false, reason: 'capability-not-granted' };
      const manifest = manifests.get(requestedAddonId);
      if (!manifest) return { ok: false, reason: 'capability-not-granted' };
      const hasTerminalHostGrant = installation.grantedCapabilities.some((grant) => grant.capability === 'terminal-host' && grant.granted === true);
      if (!hasTerminalHostGrant) return { ok: false, reason: 'capability-not-granted' };

      // The bridge must hold a live service for THIS terminal add-on
      // (multi-live: a sibling terminal being live is not sufficient).
      const serviceStatus = typeof terminalHost?.service?.status === 'function'
        ? terminalHost.service.status(requestedAddonId)
        : { alive: false, driveId: 'in-memory', adapterId: null, sessions: [] };
      if (!serviceStatus.alive || serviceStatus.adapterId !== requestedAddonId) {
        return { ok: false, reason: 'bridge-not-running', endpoint: probe.endpoint };
      }

      // c. Resolve the harness executable via the reviewed policy.
      let executable = null;
      let composeInvocationFromFile = null;
      if (requestedAgentId === 'pi') {
        const policy = getHarnessPolicy('pi-v1');
        if (!policy || typeof policy.composeInvocationFromFile !== 'function') {
          return { ok: false, reason: 'policy-not-reviewed' };
        }
        composeInvocationFromFile = policy.composeInvocationFromFile;
        const probe2 = piCommand();
        if (!probe2 || typeof probe2.command !== 'string') return { ok: false, reason: 'executable-unavailable' };
        executable = { command: probe2.command, source: probe2.source === 'npm-install-g' ? 'npm-global-sibling' : 'fixed-install-root' };
      } else {
        // Other agents route through the harness-policy registry
        // when their policies are reviewed. Today only pi-v1 is
        // reviewed, so any other agentId returns policy-not-reviewed
        // rather than guessing.
        return { ok: false, reason: 'policy-not-reviewed' };
      }

      // d. Compose the reviewed commandSuffix from the prompt file.
      //    promptBytes is the only metadata passed alongside the path.
      //    The resolved pi-native provider id is passed through so `pi`
      //    selects that provider instead of falling back to its own
      //    default (e.g. a local Ollama model) and never consuming the
      //    injected credential.
      let piProvider = null;
      let piModel = null;
      if (providerProfileId && typeof hostTerminal?.resolvePiProvider === 'function') {
        const target = await hostTerminal.resolvePiProvider(providerProfileId);
        if (target && typeof target.piProvider === 'string' && target.piProvider) {
          piProvider = target.piProvider;
          // Host-derived default model from the authorized profile. Required:
          // `--provider` alone does not win routing when the operator's pi
          // settings pin a default model (the injected credential is then
          // never consumed; observed as a provider "Connection error").
          if (typeof target.model === 'string' && target.model) {
            piModel = target.model;
          }
        }
      }
      let invocation;
      try {
        invocation = composeInvocationFromFile({
          executable,
          promptPath,
          promptBytes: promptStat.size,
          credentialEnvVarName: null,
          ...(piProvider ? { provider: piProvider } : {}),
          ...(piModel ? { model: piModel } : {}),
        });
      } catch {
        return { ok: false, reason: 'policy-not-reviewed' };
      }
      if (!invocation || typeof invocation.commandSuffix !== 'string' || invocation.commandSuffix.length === 0) {
        return { ok: false, reason: 'policy-not-reviewed' };
      }

      // d2. Pre-validate the operator-selected provider credential BEFORE
      //     composing + launching, so a missing/unknown credential surfaces
      //     as a typed error instead of a terminal that launches and then
      //     fails with a confusing provider "Connection error". An empty
      //     profile id means "no credential" (the harness uses its own
      //     config) and skips the check. `hostTerminal.resolveCredential` is
      //     the same host boundary the attach route uses, so this is exactly
      //     the credential the composed `ros-session attach` would resolve
      //     moments later in the terminal.
      if (providerProfileId) {
        const credential = typeof hostTerminal?.resolveCredential === 'function'
          ? await hostTerminal.resolveCredential(providerProfileId)
          : null;
        if (!credential || typeof credential.name !== 'string' || typeof credential.value !== 'string') {
          return { ok: false, reason: 'missing-credential' };
        }
      }

      // e. Wire launchBootstrap with the projected env seam.
      const launchSessionId = `launch-${randomUUID().slice(0, 8)}`;
      let launchResult;
      try {
        launchResult = await terminalHost.service.launchBootstrap({
          sessionId: launchSessionId,
          commandSuffix: invocation.commandSuffix,
          // Dispatch hint for the multi-live facade (stripped before the
          // per-add-on service sees the payload): route this launch to the
          // terminal add-on the operator selected.
          terminalAddonId: requestedAddonId,
          // Forward the operator-selected provider profile so the composed
          // `ros-session attach --provider-profile-id <id>` resolves and
          // injects the credential under its host-owned env-var name. An
          // absent/empty profile means "no credential" (the harness uses its
          // own config); a named but unresolvable profile fails closed in
          // /terminal-host/session/attach (missing-credential) and surfaces
          // as launch-failed.
          ...(providerProfileId ? { providerProfileId } : {}),
          ...(options.memoryAccess ? { memoryAccess: options.memoryAccess } : {}),
          ...(options.commandSuffix ? { /* caller override is the same policy-authored tail; keep for compat */ } : {}),
        });
      } catch (error) {
        // launchBootstrap throws on in-memory driver + typed
        // errors when the adapter rejects. Map to the public
        // vocabulary without leaking the underlying message.
        if (error?.code === 'runtime-unavailable') return { ok: false, reason: 'bridge-not-running', endpoint: probe.endpoint };
        return { ok: false, reason: 'launch-failed' };
      }

      // Persist the launch record. Documented fields only — no
      // token, credential, env value, memory content, or arbitrary
      // path is stored here.
      const launchId = randomUUID();
      const startedAt = new Date().toISOString();
      const record2 = {
        launchId,
        agentId: requestedAgentId,
        terminalAddonId: requestedAddonId,
        executablePath: executable.command,
        promptPath,
        startedAt,
        sessionId: launchSessionId,
      };
      launchPersistence.set(launchId, record2);

      // CP-XH5d: emit the terminal.launch.receipt telemetry. The
      // payload is shape-walker-clean by construction — it
      // contains ONLY the documented fields.
      try { launchTelemetrySink({ event: 'terminal.launch.receipt', payload: {
        launchId, agentId: record2.agentId, terminalAddonId: record2.terminalAddonId,
        executablePath: record2.executablePath, promptPath: record2.promptPath, startedAt: record2.startedAt,
      } }); } catch { /* sink is observational */ }

      return {
        launchId,
        agentId: record2.agentId,
        terminalAddonId: record2.terminalAddonId,
        executablePath: record2.executablePath,
        promptPath: record2.promptPath,
        startedAt: record2.startedAt,
        // version comes from the bridge probe so callers can confirm
        // they are talking to a known bridge build.
        bridgeVersion: probe.version,
        // Surface a non-secret launchResult fragment for the UI to
        // confirm the adapter accepted the launchBootstrap RPC.
        launchAccepted: launchResult && typeof launchResult === 'object' ? true : false,
      };
    }),
    // CP-BR10: POST /terminal-host/connection-script
    //
    // The "Add-on Tools" section's copy-connection-script affordance.
    // Loopback-only (loopbackHostOnly is set by route()), requires
    // addon-runtime-read. The route mints a single-use, audience-
    // bound `SessionBootstrapGrant` for the requested terminal
    // add-on, writes the grant token to a 0600 file in the host's
    // temp dir, and returns a non-secret shell snippet the operator
    // pastes into an already-running terminal.
    //
    // Hard rules (CP-BR10 §5.4 + §7):
    //   - The script is composed via the existing
    //     `composeBootstrapCommand` / `ros-session attach` family; the
    //     grant token rides ONLY in a 0600 file path.
    //   - The returned `command` is the only field the renderer may
    //     copy to the clipboard; the other fields are non-secret
    //     metadata (sessionId, tokenFilePath, rosSessionPath,
    //     expiresAt, startedAt).
    //   - The route enforces the same gates as `/terminal-host/launch`:
    //     add-on installed + enabled + terminal-host grant + bridge
    //     reachable. A failed gate returns the SAME typed reasons
    //     the launch route uses (`capability-not-granted`,
    //     `bridge-not-running`).
    //   - Trackable: the adopted sessionId is registered in
    //     `connectionScriptAdoptions` so disable / revoke / remove
    //     can `terminateSession` the running terminal. Adoption is
    //     dropped on grant consumption (operator pasted the script)
    //     or after the grant TTL (60s, see
    //     SESSION_BOOTSTRAP_GRANT_TTL_MS).
    //   - The script's `--provider-profile-id` is left empty for
    //     the operator to fill at paste time (the auto-connect
    //     launch path already wires this in code). The
    //     `providerProfileId` body param, when present, is forwarded
    //     so the operator does not have to remember the id.
    route('POST', '/terminal-host/connection-script', read, ['terminalAddonId'], ['providerProfileId', 'bridgeEndpoint'], async p => {
      const requestedAddonId = typeof p.terminalAddonId === 'string' ? p.terminalAddonId.trim() : '';
      if (!id(requestedAddonId)) throw fail('invalid-event');
      const providerProfileId = typeof p.providerProfileId === 'string' ? p.providerProfileId.trim() : '';
      const bridgeEndpointOverride = typeof p.bridgeEndpoint === 'string' && p.bridgeEndpoint.length > 0
        ? p.bridgeEndpoint
        : null;

      // Bridge probe first — same gate as /terminal-host/launch.
      const probe = await ensureBridgeReachable({
        endpoint: bridgeEndpointOverride ?? DEFAULT_BRIDGE_ENDPOINT,
        timeoutMs: 1500,
      });
      if (!probe.ok) return probe;

      // Add-on installed + enabled + terminal-host grant.
      const projection = snapshot();
      const installation = projection.installations[requestedAddonId];
      if (!installation || installation.enabled !== true) return { ok: false, reason: 'capability-not-granted' };
      const manifest = manifests.get(requestedAddonId);
      if (!manifest) return { ok: false, reason: 'capability-not-granted' };
      const hasTerminalHostGrant = installation.grantedCapabilities.some((grant) => grant.capability === 'terminal-host' && grant.granted === true);
      if (!hasTerminalHostGrant) return { ok: false, reason: 'capability-not-granted' };

      // Mint + track a single-use attach grant for the adoption. The
      // same broker the auto-connect launch path uses, so the
      // `consumeGrant` claim in `/terminal-host/session/attach` is
      // symmetric.
      const sessionId = `attach-${randomUUID().slice(0, 8)}`;
      const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId, purpose: "attach" }));
      const tokenFilePath = `${osTmpdir()}/ros-session-${sessionId}-${randomUUID()}.token`;
      await writeFile(tokenFilePath, grant.token, { mode: 0o600 });

      // CP-S5H3: without the auth file the pasted script's
      // /terminal-host/session/attach call answers 401 (the route needs
      // addon-runtime-control). Mint the same 0600 JSON the launch
      // path's bootstrap composes; only its path rides the clipboard.
      let authFilePath = null;
      if (typeof attachAuth === "function") {
        const auth = await attachAuth();
        if (auth && typeof auth === "object") {
          authFilePath = `${osTmpdir()}/ros-session-${sessionId}-${randomUUID()}.auth.json`;
          await writeFile(
            authFilePath,
            JSON.stringify({
              ...(typeof auth.baseUrl === "string" && auth.baseUrl ? { baseUrl: auth.baseUrl } : {}),
              ...(typeof auth.bridgeToken === "string" && auth.bridgeToken ? { bridgeToken: auth.bridgeToken } : {}),
              ...(typeof auth.controlCapabilityToken === "string" && auth.controlCapabilityToken
                ? { controlCapabilityToken: auth.controlCapabilityToken }
                : {}),
            }),
            { mode: 0o600 },
          );
        }
      }

      // The ros-session CLI ships at the same fixed install root the
      // auto-connect path uses. The host never sources this from
      // caller argv or the ambient PATH. The CLI lives in the repo
      // today (browser-first/bin); the production install root is the
      // bridge's per-user prefix. The host composes a non-secret
      // metadata field (path only — no token, credential, env).
      const resolvedRosSessionPath = rosSessionPath
        ?? `${import.meta.dirname}/../bin/ros-session.mjs`;

      const command = composeBootstrapCommand({
        sessionId,
        tokenFilePath,
        providerProfileId,
        rosSessionPath: resolvedRosSessionPath,
        ...(authFilePath ? { authFilePath } : {}),
      });

      // Register the adoption for the zero-leaked-windows invariant.
      // The host will `terminateSession` (best-effort) on disable /
      // revoke / remove if the grant is still unconsumed; the adopt
      // record is removed on grant consumption or TTL expiry.
      connectionScriptAdoptions.set(sessionId, {
        sessionId,
        terminalAddonId: requestedAddonId,
        tokenFilePath,
        ...(authFilePath ? { authFilePath } : {}),
        grant,
        startedAt: new Date().toISOString(),
      });

      // Non-secret receipt. The `command` field is the only one the
      // renderer may copy verbatim to the clipboard; the rest are
      // fixed metadata (paths + timing).
      return {
        ok: true,
        command,
        sessionId,
        terminalAddonId: requestedAddonId,
        tokenFilePath,
        rosSessionPath: resolvedRosSessionPath,
        providerProfileId: providerProfileId || null,
        startedAt: grant.issuedAt,
        expiresAt: grant.expiresAt,
        bridgeVersion: probe.version,
      };
    }),
    route('POST', '/addons/enabled', control, ['addonId', 'enabled', 'expectedRevision'], [], async p => {
      if (!id(p.addonId) || typeof p.enabled !== 'boolean' || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.setEnabled(p.addonId, p.enabled, p);
      // CP-BR10: best-effort cleanup of any unconsumed connection-
      // script adoptions for this add-on when the operator disables
      // it. The grant TTL (60s) is the safety net.
      if (p.enabled === false) await closeConnectionScriptAdoptions(p.addonId);
      return snapshot();
    }),
    route('POST', '/addons/remove', control, ['addonId', 'expectedRevision'], [], async p => {
      if (!id(p.addonId) || !revision(p.expectedRevision)) throw fail('invalid-event');
      await registry.remove(p.addonId, p);
      manifests.delete(p.addonId);
      // CP-BR10: same cleanup as disable; remove is final.
      await closeConnectionScriptAdoptions(p.addonId);
      return snapshot();
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
    // CP-XH5a: launch helpers for tests + production telemetry wiring.
    listLaunches() {
      return [...launchPersistence.values()].map((entry) => ({
        launchId: entry.launchId,
        agentId: entry.agentId,
        terminalAddonId: entry.terminalAddonId,
        executablePath: entry.executablePath,
        promptPath: entry.promptPath,
        startedAt: entry.startedAt,
        sessionId: entry.sessionId,
      }));
    },
    setLaunchTelemetrySink,
    // CP-XH5d: structured-event sink contract. Production wires
    // it to the host event bus; tests inject a spy.
    close() {
      if (!closing) {
        closed = true;
        closing = boundary.close().catch(() => {}).then(() => Promise.allSettled([...resources].map(resource => resource.dispose({}))));
      }
      return closing;
    },
  };
}
