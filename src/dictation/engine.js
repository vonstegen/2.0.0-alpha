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
 * The Parakeet TDT 0.6B v3 int4/int8 model files are pulled from the
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
 */

const HF_BASE = "https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4/resolve/main";

export const MODEL_URLS = Object.freeze({
  encoderUrl: `${HF_BASE}/encoder-model.int4.onnx`,
  decoderUrl: `${HF_BASE}/decoder_joint-model.int8.onnx`,
  tokenizerUrl: `${HF_BASE}/vocab.txt`,
});

/**
 * @typedef {import("./types.js").EngineState} EngineState
 * @typedef {import("./types.js").WorkerOutbound} WorkerOutbound
 * @typedef {import("./types.js").WorkerInbound} WorkerInbound
 */

/**
 * @typedef {Object} EngineOptions
 * @property {() => Worker} createWorker Returns a fresh module Web Worker.
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
let nextRequestId = 1;
/** @type {Map<number, { resolve: (text: string) => void, reject: (error: Error) => void, partialHandler: ((text: string) => void) | null }>} */
const pending = new Map();
/** @type {Map<string, number>} Map sessionId → nextRequestId for partial lookups. */
const sessionIdToLastChunkId = new Map();

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
      worker?.terminate().catch(() => undefined);
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
    worker.terminate().catch(() => undefined);
    worker = null;
  }
  initPromise = null;
}

/**
 * Idempotent. Resolves once the worker reports `ready`, or rejects if the
 * engine fails to initialise.
 *
 * @param {EngineOptions} options
 * @returns {Promise<void>}
 */
export function preload(options) {
  if (!options || typeof options.createWorker !== "function") {
    return Promise.reject(new Error("Engine preload requires a createWorker() factory."));
  }
  if (initPromise) return initPromise;
  if (state === "ready") return Promise.resolve();
  setState("loading");
  worker = options.createWorker();
  worker.addEventListener("message", dispatchMessage);
  worker.addEventListener("error", (event) => {
    const message = (event && /** @type {any} */ (event).message) || "Dictation worker crashed.";
    setState("error", String(message));
    for (const [, entry] of pending) {
      entry.reject(new Error(String(message)));
    }
    pending.clear();
    sessionIdToLastChunkId.clear();
  });

  initPromise = new Promise((resolve, reject) => {
    const onReady = (/** @type {MessageEvent<WorkerOutbound>} */ event) => {
      const data = event.data;
      if (data?.type === "ready") {
        worker?.removeEventListener("message", onReady);
        resolve();
      } else if (data?.type === "error" && data.id === -1) {
        worker?.removeEventListener("message", onReady);
        reject(new Error(data.message));
      }
    };
    worker.addEventListener("message", onReady);
    /** @type {WorkerInbound} */
    const initMessage = {
      type: "init",
      ...MODEL_URLS,
      wasmPaths: options.wasmPaths ?? null,
      backend: options.backend ?? "webgpu-hybrid",
    };
    worker.postMessage(initMessage);
  }).catch((error) => {
    setState("error", error instanceof Error ? error.message : String(error));
    initPromise = null;
    throw error;
  });
  return initPromise;
}

/**
 * Send PCM to the worker and resolve with the transcribed text. Throws if the
 * engine isn't ready or the worker reports an error.
 *
 * @param {Float32Array} pcm
 * @param {number} [sampleRate=16000]
 * @returns {Promise<string>}
 */
export function transcribe(pcm, sampleRate = 16000) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, partialHandler: null });
    worker.postMessage({ type: "transcribe", id, pcm, sampleRate }, [pcm.buffer]);
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
 * Finalize a streaming session. Resolves with the final transcript.
 *
 * If the session was never created on the worker (e.g. the controller
 * dropped every chunk via its silence gate), the worker would otherwise
 * reply with "Unknown streaming session". We special-case that here so the
 * caller can `await finalizeStream(...)` unconditionally — it just resolves
 * to an empty string.
 *
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
export function finalizeStream(sessionId) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  // If the caller never forwarded any chunk for this session, the worker
  // has no streaming session to finalize. Resolve with an empty string
  // instead of round-tripping and bouncing an "Unknown streaming session"
  // error back to the UI.
  // If the caller never forwarded any chunk for this session, the worker
  // has no streaming session to finalize. Resolve with an empty string
  // instead of round-tripping and bouncing an "Unknown streaming session"
  // error back to the UI.
  const lastChunkId = sessionIdToLastChunkId.get(sessionId);
  if (lastChunkId === undefined) {
    return Promise.resolve("");
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
  teardown();
  setState("idle");
}
