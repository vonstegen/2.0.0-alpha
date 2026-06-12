// @ts-check

/**
 * Dictation worker. Owns the parakeet.js model, receives Float32Array PCM
 * segments, and returns the transcribed text.
 *
 * Message protocol (see types.js):
 *   in:  { type: "init", encoderUrl, decoderUrl, tokenizerUrl, wasmPaths, sharedArrayBuffer }
 *   in:  { type: "transcribe", id, pcm, sampleRate }
 *   in:  { type: "transcribe-chunk", id, sessionId, pcm, sampleRate }   (streaming)
 *   in:  { type: "stream-finalize", id, sessionId }                     (streaming)
 *   in:  { type: "stream-reset", id, sessionId }                         (streaming)
 *   in:  { type: "stream-cancel", id, sessionId }                        (streaming)
 *   out: { type: "ready" }
 *   out: { type: "result", id, text }
 *   out: { type: "partial", id, text, sessionId }                        (streaming)
 *   out: { type: "final", id, text, sessionId }                          (streaming)
 *   out: { type: "error", id, message }
 *
 * The worker is launched as a module worker (`type: "module"`) so we can use
 * top-level imports of parakeet.js / meljs / onnxruntime-web.
 *
 * Backend selection (set by the host page):
 *   - `webgpu-hybrid`: encoder on GPU, decoder/joiner on WASM. Best when
 *     WebGPU is available (modern Chromium).
 *   - `wasm`: pure WASM. The ORT runtime picks `numThreads` from
 *     `navigator.hardwareConcurrency` when `SharedArrayBuffer` is exposed
 *     (i.e. when the host is `crossOriginIsolated`).
 *   - `webgpu-strict`: encoder on GPU, no WASM fallback. Only useful for
 *     diagnosing WebGPU issues.
 *
 * parakeet.js handles the runtime WebGPU→WASM fallback internally; we just
 * tell it the *preferred* backend.
 */

import { ParakeetModel } from "parakeet.js";
import { getModelFile } from "parakeet.js/hub";
import * as ort from "onnxruntime-web";

/**
 * HuggingFace repo + revision used for the parakeet-tdt-0.6b-v3 int4/int8
 * weights. The hub's `getModelFile` looks up these files in IndexedDB
 * (`parakeet-cache-db`) before hitting the network, so subsequent page
 * loads skip the ~150 MB download entirely.
 *
 * @type {{ repoId: string, revision: string }}
 */
const MODEL_REPO = { repoId: "efederici/parakeet-tdt-0.6b-v3-onnx-int4", revision: "main" };

/** Filenames within the repo. The int4 encoder + int8 decoder are what we
 * actually ship — see https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4
 * for the full file listing. */
const MODEL_FILES = Object.freeze({
  encoder: "encoder-model.int4.onnx",
  decoder: "decoder_joint-model.int8.onnx",
  tokenizer: "vocab.txt",
});

/** @type {ParakeetModel | null} */
let model = null;
/** @type {string} */
let preferredBackend = "webgpu-hybrid";
/** @type {string | null} */
let wasmPathsValue = null;

/** @type {Map<string, import("parakeet.js").StatefulStreamingTranscriber>} */
const streamingSessions = new Map();
let streamingSessionCounter = 0;

self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;

  if (data.type === "init") {
    try {
      preferredBackend = data.backend || "webgpu-hybrid";
      wasmPathsValue = data.wasmPaths ?? null;
      if (wasmPathsValue) {
        ort.env.wasm.wasmPaths = wasmPathsValue;
      }
      // ORT picks up `numThreads` from `navigator.hardwareConcurrency` when
      // SharedArrayBuffer is available (crossOriginIsolated + COOP/COEP).
      // We don't set it explicitly so parakeet.js uses the right default.
      ort.env.logLevel = "warning";

      // Resolve model file URLs through the hub. `getModelFile` checks the
      // IndexedDB cache (`parakeet-cache-db`) first and only falls back to
      // a HuggingFace fetch when the file is missing. After a single
      // first-load, all subsequent page loads serve the model from
      // IndexedDB and skip the ~150 MB network transfer.
      //
      // We use `getModelFile` directly (not the higher-level
      // `getParakeetModel`) because the hub's quant-suffix map only
      // covers int8/fp16/fp32, and our encoder is int4.
      const [encoderUrl, decoderUrl, tokenizerUrl] = await Promise.all([
        getModelFile(MODEL_REPO.repoId, MODEL_FILES.encoder, { revision: MODEL_REPO.revision }),
        getModelFile(MODEL_REPO.repoId, MODEL_FILES.decoder, { revision: MODEL_REPO.revision }),
        getModelFile(MODEL_REPO.repoId, MODEL_FILES.tokenizer, { revision: MODEL_REPO.revision }),
      ]);

      model = await ParakeetModel.fromUrls({
        encoderUrl,
        decoderUrl,
        tokenizerUrl,
        preprocessorBackend: "js",
        backend: preferredBackend,
        wasmPaths: wasmPathsValue ?? undefined,
      });
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({
        type: "error",
        id: -1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (data.type === "transcribe") {
    if (!model) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: "Dictation engine is not ready yet.",
      });
      return;
    }
    try {
      const result = await model.transcribe(data.pcm, data.sampleRate, {
        returnTimestamps: false,
        returnConfidences: false,
      });
      self.postMessage({ type: "result", id: data.id, text: result.utterance_text ?? "" });
    } catch (error) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (data.type === "transcribe-chunk") {
    if (!model) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: "Dictation engine is not ready yet.",
      });
      return;
    }
    try {
      let session = streamingSessions.get(data.sessionId);
      if (!session) {
        session = model.createStreamingTranscriber({
          returnTimestamps: false,
          returnConfidences: false,
        });
        streamingSessions.set(data.sessionId, session);
      }
      const partial = await session.processChunk(data.pcm, data.sampleRate);
      const cumulative = partial.text ?? partial.chunkText ?? "";
      // Two messages: a `partial` for live UI updates (the caller may not
      // await this id; partialHandler is just a side-channel), and a
      // `chunk-result` that resolves the `streamChunk` promise with the
      // cumulative text so callers can `.then`/await the per-chunk result.
      self.postMessage({
        type: "partial",
        id: data.id,
        sessionId: data.sessionId,
        text: cumulative,
      });
      self.postMessage({
        type: "chunk-result",
        id: data.id,
        sessionId: data.sessionId,
        text: cumulative,
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (data.type === "stream-finalize") {
    try {
      const session = streamingSessions.get(data.sessionId);
      if (!session) {
        self.postMessage({
          type: "error",
          id: data.id,
          message: `Unknown streaming session: ${data.sessionId}`,
        });
        return;
      }
      const final = session.finalize();
      streamingSessions.delete(data.sessionId);
      self.postMessage({
        type: "final",
        id: data.id,
        sessionId: data.sessionId,
        text: final.text ?? "",
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (data.type === "stream-cancel") {
    streamingSessions.delete(data.sessionId);
    return;
  }
});
