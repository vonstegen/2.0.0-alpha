// @ts-check

/**
 * Dictation engine. Owns the parakeet.js model inside a module Web Worker
 * and exposes a small promise-based surface to the main thread.
 *
 * Designed to be host-agnostic: the Worker factory is injected so both the
 * Vite/React app (which can use `import MyWorker from './worker.js?worker'`)
 * and the Chrome extension (no bundler, uses
 * `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`)
 * can boot the same engine.
 *
 * The Parakeet TDT 0.6B v3 int8 model files are pulled from the
 * HuggingFace CDN at runtime. parakeet.js caches them in IndexedDB so the
 * second and subsequent loads are near-instant. The CDN is verified
 * CORS-enabled for any origin.
 *
 * Two transcribe modes:
 *   - `transcribe(pcm)` — fire a finished utterance at the worker; resolves
 *     with the full text. Best for tap-to-stop recording.
 *   - `openStream()` / `streamChunk(session, pcm)` / `finalizeStream(session)` —
 *     push audio chunks as the user speaks. Each chunk resolves with a
 *     *partial* transcript (cumulative). Finalize resolves with the final
 *     transcript. Best for push-to-talk where the user wants to see text
 *     appear in real time.
 *
 * Streaming mode is currently exposed but unused by the default
 * controller (which uses `transcribe()` on a full recording for
 * reliability). It's retained for callers that want to drive the
 * streaming pipeline directly.
 */

const HF_BASE = "https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx/resolve/main";

/**
 * Source URLs for the parakeet-tdt-0.6b-v3 model files (int8 quant).
 * Exported for documentation and external tooling. The worker no longer
 * fetches these directly — it goes through parakeet.js's `getModelFile`
 * hub helper which transparently caches the downloads in IndexedDB on
 * first load and serves them same-origin on subsequent page loads. See
 * `worker.js` for the cache path.
 *
 * The int8 export replaced the int4 export because the int4 quant
 * consistently produced degenerate single-token output ("A") for real
 * speech input. The int8 version is larger (~650 MB encoder vs ~390 MB
 * int4) but the IndexedDB cache makes that a one-time cost.
 *
 * @type {Readonly<{ encoderUrl: string, decoderUrl: string, tokenizerUrl: string }>}
 */
export const MODEL_URLS = Object.freeze({
  encoderUrl: `${HF_BASE}/encoder-model.int8.onnx`,
  decoderUrl: `${HF_BASE}/decoder_joint-model.int8.onnx`,
  tokenizerUrl: `${HF_BASE}/vocab.txt`,
});

/**
 * @typedef {import("./types.js").EngineState} EngineState
 * @typedef {import("./types.js").WorkerOutbound} WorkerOutbound
 * @typedef {import("./types.js").WorkerInbound} WorkerInbound
 */

/**
 * @typedef {import("./types.js").DictationEngineKind} DictationEngineKind
 */

/**
 * @typedef {Object} EngineOptions
 * @property {(kind: DictationEngineKind) => Worker} createWorker Returns a
 *   fresh module Web Worker for the chosen engine kind.
 * @property {("auto" | "whisper" | "parakeet")} [engineSelection="auto"]
 *   Which on-device ASR engine to load. `"auto"` tries Whisper first and
 *   falls back to Parakeet on init failure or 60s timeout. `"whisper"`
 *   loads Whisper base multilingual q8 via @huggingface/transformers.
 *   `"parakeet"` loads NVIDIA Parakeet TDT 0.6B v3 int8 via parakeet.js.
 * @property {string | null} [wasmPaths] Optional path to onnxruntime-web WASM
 *   blobs. When omitted, parakeet.js falls back to the jsDelivr CDN. Pass
 *   `/dictation/ort-wasm/` to keep WASM blobs same-origin.
 * @property {"webgpu-hybrid" | "webgpu-strict" | "wasm"} [backend]
 *   Preferred execution backend. Defaults to `'webgpu-hybrid'` (encoder on
 *   GPU when available, decoder on WASM). parakeet.js falls back to pure
 *   WASM (multithreaded when SharedArrayBuffer is available) if WebGPU is
 *   not exposed.
 * @property {boolean} [streaming] Reserved for future use.
 */

let state = "idle";
let lastMessage = null;
/** @type {Set<(state: EngineState, message: string | null) => void>} */
const subscribers = new Set();
/** @type {Worker | null} */
let worker = null;
/** @type {Promise<void> | null} */
let initPromise = null;
/** Currently-loaded engine kind. Set from `engineSelection` at preload; Auto
 * mode may switch this to "parakeet" if Whisper init fails. */
let currentKind = "parakeet";
/** Currently-loaded engine device. Whisper reports this in `ready`; null for Parakeet. */
let currentDevice = null;
let nextRequestId = 1;
/** @type {Map<number, { resolve: (text: string) => void, reject: (error: Error) => void, partialHandler: ((text: string) => void) | null }>} */
const pending = new Map();
/** @type {Map<string, number>} Map sessionId → nextRequestId for partial lookups. */
const sessionIdToLastChunkId = new Map();

/** @type {Set<(message: string) => void>} */
const noticeSubscribers = new Set();

/**
 * Emit a notice event to all subscribers. Used for engine-level signals
 * like the Auto-fallback notice.
 *
 * @param {string} message
 */
function emitNotice(message) {
  for (const cb of noticeSubscribers) {
    try { cb(message); } catch { /* ignore */ }
  }
}

/**
 * Subscribe to engine notice events (engine-level signals, not worker errors).
 *
 * @param {(message: string) => void} cb
 * @returns {() => void}
 */
export function subscribeEngineNotices(cb) {
  noticeSubscribers.add(cb);
  return () => noticeSubscribers.delete(cb);
}

/**
 * Currently-loaded engine device. Synchronous read.
 *
 * @returns {"webgpu" | "wasm" | null}
 */
export function getEngineDevice() {
  return currentDevice;
}

function setState(next, message = null) {
  state = next;
  lastMessage = message;
  for (const cb of subscribers) {
    try {
      cb(next, message);
    } catch {
      // Subscriber errors are non-fatal.
    }
  }
}

/** @param {MessageEvent<WorkerOutbound>} event */
function dispatchMessage(event) {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;
  if (data.type === "ready") {
    setState("ready");
    return;
  }
  if (data.type === "result") {
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      entry.resolve(typeof data.text === "string" ? data.text : "");
    }
    return;
  }
  if (data.type === "chunk-result") {
    // Resolves a single `streamChunk` promise with the cumulative text for
    // that chunk. The `partial` side-channel message may have fired first;
    // both reference the same id.
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      entry.resolve(typeof data.text === "string" ? data.text : "");
    }
    return;
  }
  if (data.type === "partial") {
    // Side-channel: invoked synchronously for live UI updates. Does not
    // resolve the pending entry — that's the `chunk-result` message's job.
    const entry = pending.get(data.id);
    if (entry && entry.partialHandler) {
      entry.partialHandler(typeof data.text === "string" ? data.text : "");
    }
    return;
  }
  if (data.type === "final") {
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      sessionIdToLastChunkId.delete(data.sessionId);
      entry.resolve(typeof data.text === "string" ? data.text : "");
    }
    return;
  }
  if (data.type === "error") {
    if (data.id === -1) {
      setState("error", data.message);
      for (const [, entry] of pending) {
        entry.reject(new Error(data.message));
      }
      pending.clear();
      sessionIdToLastChunkId.clear();
      worker?.terminate();
      worker = null;
      initPromise = null;
      return;
    }
    const entry = pending.get(data.id);
    if (entry) {
      pending.delete(data.id);
      sessionIdToLastChunkId.delete(entry.sessionId ?? "");
      entry.reject(new Error(data.message));
    }
  }
}

function teardown() {
  for (const [, entry] of pending) {
    entry.reject(new Error("Dictation engine disposed."));
  }
  pending.clear();
  sessionIdToLastChunkId.clear();
  if (worker) {
    worker.terminate();
    worker = null;
  }
  initPromise = null;
}

/**
 * Idempotent. Resolves once the worker reports `ready`, or rejects if the
 * engine fails to initialise. In `"auto"` mode, Whisper init failure (or 60s
 * timeout) triggers an internal re-spawn with Parakeet, which is announced
 * via the `notice` event.
 *
 * @param {EngineOptions} options
 * @returns {Promise<void>}
 */
export function preload(options) {
  if (!options || typeof options.createWorker !== "function") {
    return Promise.reject(new Error("Engine preload requires a createWorker() factory."));
  }
  const engineSelection = options.engineSelection ?? "auto";
  if (initPromise) return initPromise;
  if (state === "ready") return Promise.resolve();
  setState("loading");

  const startingKind = engineSelection === "parakeet" ? "parakeet" : "whisper";
  currentKind = startingKind;
  currentDevice = null;

  const initTimeoutMs = engineSelection === "auto" ? 60_000 : 0;

  initPromise = spawnAndInit({
    kind: startingKind,
    createWorker: options.createWorker,
    wasmPaths: options.wasmPaths ?? null,
    backend: options.backend ?? "webgpu-hybrid",
    initTimeoutMs,
  }).catch(async (error) => {
    if (engineSelection !== "auto" || startingKind === "parakeet") {
      // Explicit mode (or already on Parakeet): surface the error, no fallback.
      setState("error", error instanceof Error ? error.message : String(error));
      initPromise = null;
      throw error;
    }
    // Auto mode: fall back to Parakeet.
    if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
    pending.clear();
    sessionIdToLastChunkId.clear();
    currentKind = "parakeet";
    currentDevice = null;
    setState("loading");
    try {
      await spawnAndInit({
        kind: "parakeet",
        createWorker: options.createWorker,
        wasmPaths: options.wasmPaths ?? null,
        backend: options.backend ?? "webgpu-hybrid",
        initTimeoutMs: 0,
      });
      // Surface the fallback to subscribers. Use `setState("ready", msg)`
      // to push the message to existing subscribers (Settings status line)
      // AND emit a notice for the chat-notice side channel.
      const fallbackMsg = "Whisper unavailable — using Parakeet (slower).";
      setState("ready", fallbackMsg);
      emitNotice(fallbackMsg);
      return;
    } catch (fallbackError) {
      const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      setState("error", `Whisper and Parakeet both failed. Last error: ${msg}`);
      initPromise = null;
      throw fallbackError;
    }
  });
  return initPromise;
}

/**
 * Spawn a worker of the given kind and resolve once it reports `ready`,
 * or reject on init error / timeout.
 *
 * @param {{ kind: DictationEngineKind, createWorker: (kind: DictationEngineKind) => Worker, wasmPaths: string | null, backend: string, initTimeoutMs: number }} opts
 * @returns {Promise<void>}
 */
function spawnAndInit(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    if (opts.initTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker?.removeEventListener("message", onMessage);
        reject(new Error(`Engine init timed out after ${opts.initTimeoutMs}ms.`));
      }, opts.initTimeoutMs);
    }
    try {
      worker = opts.createWorker(opts.kind);
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    worker.addEventListener("message", dispatchMessage);
    worker.addEventListener("error", (event) => {
      const message = (event && /** @type {any} */ (event).message) || "Dictation worker crashed.";
      if (settled) {
        // Post-init crash: surface as error.
        setState("error", String(message));
        return;
      }
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      worker?.removeEventListener("message", onMessage);
      reject(new Error(String(message)));
    });

    function onMessage(/** @type {MessageEvent<WorkerOutbound>} */ event) {
      const data = event.data;
      if (data?.type === "ready") {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        worker?.removeEventListener("message", onMessage);
        // Capture the device the worker reported (Whisper only; Parakeet omits).
        if (typeof data.device === "string") {
          currentDevice = /** @type {"webgpu" | "wasm"} */ (data.device);
        }
        setState("ready");
        resolve();
      } else if (data?.type === "error" && data.id === -1) {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        worker?.removeEventListener("message", onMessage);
        reject(new Error(data.message));
      }
    }
    worker.addEventListener("message", onMessage);

    worker.postMessage({
      type: "init",
      wasmPaths: opts.wasmPaths,
      backend: opts.backend,
    });
  });
}
/**
 * Send PCM to the worker and resolve with the transcribed text. Throws if the
 * engine isn't ready or the worker reports an error.
 *
 * @param {Float32Array} pcm
 * @param {number} [sampleRate=16000]
 * @param {{ language?: string, task?: "transcribe" | "translate" }} [opts]
 *   Per-utterance Whisper options. Ignored by Parakeet.
 * @returns {Promise<string>}
 */
export function transcribe(pcm, sampleRate = 16000, opts = {}) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, partialHandler: null });
    worker.postMessage(
      { type: "transcribe", id, pcm, sampleRate, language: opts.language, task: opts.task },
      [pcm.buffer],
    );
  });
}

/**
 * Open a streaming session. Each session is identified by a `sessionId` so
 * the caller can run multiple in parallel (e.g. two dictation rails). The
 * session accumulates decoder state across chunks so partial transcripts
 * stay coherent as the user speaks.
 *
 * @returns {string} sessionId
 */
export function openStream() {
  return `s${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Push a chunk of PCM audio to a streaming session. Resolves with the
 * *cumulative* partial transcript for the session so far. Optional
 * `onPartial` is invoked synchronously (via postMessage) for each in-flight
 * chunk's progress.
 *
 * @param {string} sessionId
 * @param {Float32Array} pcm
 * @param {number} [sampleRate=16000]
 * @param {{ onPartial?: (text: string) => void }} [opts]
 * @returns {Promise<string>}
 */
export function streamChunk(sessionId, pcm, sampleRate = 16000, opts = {}) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      partialHandler: opts.onPartial ?? null,
      sessionId,
    });
    sessionIdToLastChunkId.set(sessionId, id);
    worker.postMessage(
      { type: "transcribe-chunk", id, sessionId, pcm, sampleRate },
      [pcm.buffer],
    );
  });
}

/**
/**
 * Finalize a streaming session. Resolves with the final transcript.
 *
 * Note: the current controller uses a single `transcribe()` call against
 * the full recording rather than streaming, so this entry point is unused
 * in production. It's retained for callers that want to drive the
 * streaming pipeline directly.
 *
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
export function finalizeStream(sessionId) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, partialHandler: null, sessionId });
    worker.postMessage({ type: "stream-finalize", id, sessionId });
  });
}

/**
 * Cancel a streaming session without resolving. Frees the worker's state
 * for the session so a future `openStream` doesn't share decoder state.
 *
 * @param {string} sessionId
 */
export function cancelStream(sessionId) {
  if (!worker) return;
  const id = nextRequestId++;
  worker.postMessage({ type: "stream-cancel", id, sessionId });
  // Also resolve any pending chunk entries for this session with rejection.
  for (const [chunkId, entry] of pending) {
    if (entry.sessionId === sessionId) {
      pending.delete(chunkId);
      entry.reject(new Error("Streaming session cancelled."));
    }
  }
  sessionIdToLastChunkId.delete(sessionId);
}

/**
 * Current engine state. Synchronous read.
 *
 * @returns {EngineState}
 */
export function getEngineState() {
  return state;
}

/**
 * Currently-loaded engine kind. Synchronous read.
 *
 * @returns {DictationEngineKind}
 */
export function getEngineKind() {
  return currentKind;
}

/**
 * Last error message, if any.
 *
 * @returns {string | null}
 */
export function getEngineMessage() {
  return lastMessage;
}

/**
 * Subscribe to state transitions. Returns an unsubscribe function.
 *
 * @param {(state: EngineState, message: string | null) => void} cb
 * @returns {() => void}
 */
export function subscribeEngineState(cb) {
  subscribers.add(cb);
  try {
    cb(state, lastMessage);
  } catch {
    // ignore
  }
  return () => subscribers.delete(cb);
}

/**
 * Tear down the worker. Intended for tests.
 */
export async function dispose() {
  subscribers.clear();
  noticeSubscribers.clear();
  teardown();
  currentKind = "parakeet";
  currentDevice = null;
  setState("idle");
}
