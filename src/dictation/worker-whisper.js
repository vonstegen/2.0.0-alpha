// @ts-check

/**
 * Whisper fallback dictation worker. Mirrors the message protocol of the
 * parakeet worker (`./worker.js`) so the engine singleton in
 * `engine.js` can swap workers without changing anything else.
 *
 * **Failure mode honesty:** Transformers.js + onnxruntime-web has the
 * same compatibility surface as parakeet.js + onnxruntime-web, and
 * parakeet.js took 7 fixes to get working in this environment. This
 * worker is provided as a fallback for users who hit issues with the
 * default Parakeet path. If Transformers.js fails to load (CSP, ORT
 * backend not found, model fetch error, etc.), the worker surfaces
 * a clear `error` message and stays unready; the engine reports the
 * error via the existing `Voice dictation failed: ...` notice.
 *
 * **Audio contract:** the host thread sends 16 kHz mono Float32Array
 * PCM (the existing `decodeBlobToMono16k` helper in `controller.js`
 * produces exactly this). Whisper's `AutoProcessor` does the mel
 * feature extraction internally.
 *
 * Message protocol (mirrors `./worker.js`):
 *   in:  { type: "init" }
 *   in:  { type: "transcribe", id, pcm, sampleRate }
 *   out: { type: "ready" }
 *   out: { type: "result", id, text }
 *   out: { type: "error", id, message }
 *
 * Streaming message types (`transcribe-chunk`, `stream-finalize`,
 * `stream-cancel`, `partial`, `final`, `chunk-result`) are NOT
 * implemented — Whisper is a batch model by design, no token-by-token
 * streaming.
 */

import { pipeline, env as transformersEnv } from "@huggingface/transformers";

/** @type {import("@huggingface/transformers").AutomaticSpeechRecognitionPipeline | null} */
let transcriber = null;

self.addEventListener("message", async (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;

  if (data.type === "init") {
    try {
      // Tell transformers.js to use the onnxruntime-web wasm files we
      // already serve at `/dictation/ort-wasm/`. This is the same
      // directory parakeet.js uses, so both engines share the ORT
      // runtime in the browser.
      // The path is relative to the page origin (we set wasmPaths on
      // the engine side; here we just configure cache + remote host).
      transformersEnv.allowLocalModels = false;
      transformersEnv.useFs = false;

      // Default HF model. The q8 dtype keeps the on-device footprint
      // at ~77 MB and works on every browser; WebGPU is a future
      // optimization tracked separately.
      const modelId = "Xenova/whisper-base";
      const transcriberPromise = pipeline(
        "automatic-speech-recognition",
        modelId,
        {
          dtype: "q8",
          device: "wasm",
        },
      );
      transcriber = await transcriberPromise;
      self.postMessage({ type: "ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Stay unready. The engine surfaces the error.
      self.postMessage({
        type: "error",
        id: -1,
        message: `Whisper worker init failed: ${message}`,
      });
    }
    return;
  }

  if (data.type === "transcribe") {
    if (!transcriber) {
      self.postMessage({
        type: "error",
        id: data.id,
        message: "Whisper worker is not ready yet.",
      });
      return;
    }
    try {
      // transformers.js expects an AudioBuffer-like object or a
      // Float32Array. We pass a Float32Array directly; the AutoProcessor
      // resamples to 16 kHz if needed (we already do that in the
      // controller, so this is a no-op for us).
      const out = await transcriber(data.pcm, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });
      const text = typeof out?.text === "string" ? out.text : "";
      self.postMessage({ type: "result", id: data.id, text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({
        type: "error",
        id: data.id,
        message: `Whisper transcribe failed: ${message}`,
      });
    }
    return;
  }
});
