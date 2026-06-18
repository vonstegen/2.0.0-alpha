// @ts-check

/**
 * Whisper fallback dictation worker. Mirrors the message protocol of the
 * parakeet worker (`./worker.js`) so the engine singleton in
 * `engine.js` can swap workers without changing anything else.
 *
 * **Failure mode honesty:** The prior attempt failed with a
 * `Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`
 * error on every dtype. Root cause was two implementation bugs, not an
 * architectural dead end: (1) the worker called `pipeline({ quantized: ... })`
 * but transformers.js v3 dropped `quantized` after v2 — v3 uses `dtype`, so
 * the `quantized` key was silently ignored and the default model file was
 * loaded regardless of the requested dtype; (2) the worker loaded
 * `onnx-community/whisper-base`, but the transformers.js reference app
 * (whisper-word-timestamps) uses `onnx-community/whisper-base_timestamped` —
 * the variant the transformers.js team actually tests and exports. The
 * plain `whisper-base` q8 export has a broken DequantizeLinear scale; the
 * `_timestamped` export doesn't.
 *
 * **Audio contract:** the host thread sends 16 kHz mono Float32Array
 * PCM (the existing `decodeBlobToMono16k` helper in `controller.js`
 * produces exactly this). Whisper's `AutoProcessor` does the mel
 * feature extraction internally.
 *
 * Message protocol (mirrors `./worker.js`):
 *   in:  { type: "init" [, modelId, dtype] }
 *   in:  { type: "transcribe", id, pcm, sampleRate [, language, task] }
 *   out: { type: "ready", device }
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
      transformersEnv.allowLocalModels = false;
      transformersEnv.useFs = false;

      // Per-device dtype config matching the whisper-word-timestamps reference:
      //   WebGPU -> { encoder_model: "fp32", decoder_model_merged: "q4" }
      //   WASM    -> "q8"
      // WebGPU auto-detect at the worker level — the user enables WebGPU at
      // the browser level (chrome://flags/#enable-unsafe-webgpu on Linux, or
      // stable Chrome with a discrete GPU). No manual WebGPU toggle in
      // Settings.
      const hasWebGPU =
        typeof navigator !== "undefined" && "gpu" in navigator
        && (await navigator.gpu.requestAdapter().catch(() => null)) != null;
      const device = hasWebGPU ? "webgpu" : "wasm";
      const defaultDtype = hasWebGPU
        ? { encoder_model: "fp32", decoder_model_merged: "q4" }
        : "q8";

      // v3 API: dtype (not quantized — that was v2). The `data.dtype` override
      // is a debug knob; the default is per-device.
      const modelId = data.modelId ?? "onnx-community/whisper-base_timestamped";
      transcriber = await pipeline("automatic-speech-recognition", modelId, {
        dtype: data.dtype ?? defaultDtype,
        device,
        revision: "main",
      });

      // Report the chosen device to the engine so the Settings status line
      // can show "(WebGPU)" or "(CPU)".
      self.postMessage({ type: "ready", device });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
      const opts = {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
        task: data.task ?? "transcribe",
      };
      // When language === "auto", OMIT the field entirely — transformers.js
      // treats `language: "auto"` as the literal language code "auto", not
      // as auto-detect. The only safe way to get Whisper's auto-detect is to
      // leave the field unset.
      if (data.language && data.language !== "auto") {
        opts.language = data.language;
      }
      const out = await transcriber(data.pcm, opts);
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
