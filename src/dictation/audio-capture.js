// @ts-check

/**
 * Audio capture for live dictation.
 *
 * Replaces the previous MediaRecorder + decodeAudioData path, which was
 * structurally broken: MediaRecorder produces WebM/Opus chunks, and
 * `AudioContext.decodeAudioData` either can't decode WebM/Opus at all (most
 * Chromium builds) or, when it can, refuses to decode headerless fragment
 * chunks — only the *first* `ondataavailable` blob has the WebM headers.
 *
 * This module goes straight from a `MediaStream` to Float32Array PCM via the
 * Web Audio API. The output is exactly the format parakeet.js / meljs want:
 * mono 16 kHz `Float32Array` chunks in the range [-1, 1]. No encode, no
 * decode, no fragmentation.
 *
 * Two implementations behind a single surface:
 *   - AudioWorklet (modern Chromium, Firefox, Safari 14.1+): runs the
 *     Float32 copy on the audio rendering thread. Preferred.
 *   - ScriptProcessorNode (Safari, JSDOM, worklet-blocked environments):
 *     main-thread fallback. The processor is deprecated but still works
 *     everywhere and is the only reliable option when worklets aren't
 *     available.
 *
 * The worklet source is loaded as a same-origin static file at
 * `WORKLET_URL` (default `/dictation/pcm-16k-processor.js`). Earlier
 * revisions used `URL.createObjectURL(blob)` and `FileReader.readAsDataURL`
 * to inline the source; both are blocked under the document's CSP
 * (`script-src 'self'`) and under COOP/COEP cross-origin isolation.
 * A same-origin file satisfies both constraints.
 *
 * The two implementations emit the same callback shape, so callers don't
 * have to care which path is in use.
 */

/**
 * Same-origin URL of the AudioWorklet processor module. Served by Vite from
 * `public/dictation/pcm-16k-processor.js`. The Chrome extension will need to
 * override this with a `chrome.runtime.getURL(...)` path because the
 * extension's CSP and asset layout differ from the Vite app's.
 *
 * @type {string}
 */
export const WORKLET_URL = "/dictation/pcm-16k-processor.js";

/**
 * @typedef {Object} CaptureOptions
 * @property {MediaStream} stream
 * @property {number} [sampleRate=16000] Target sample rate. The worklet runs
 *   at the AudioContext's actual rate, so 16 kHz is requested at context
 *   creation. Browsers resample to 16 kHz on the audio thread.
 * @property {number} [chunkFrames=4096] Frames per emitted chunk. At 16 kHz
 *   this is ~256 ms per chunk — long enough to be useful, short enough to
 *   feel live.
 * @property {(pcm: Float32Array) => void} onChunk Receives a fresh
 *   `Float32Array` (always 16 kHz mono, range [-1, 1]). The callback owns
 *   the buffer; do not retain references past the synchronous call site.
 * @property {(error: Error) => void} [onError] Surfaces capture failures
 *   (e.g. context suspended, device disconnected).
 * @property {string} [workletUrl] Override the AudioWorklet module URL.
 *   Defaults to {@link WORKLET_URL} (`/dictation/pcm-16k-processor.js`).
 *   The Chrome extension passes `chrome.runtime.getURL("assets/dictation/
 *   pcm-16k-processor.js")` to satisfy its own CSP and asset layout.
 */

/**
 * @typedef {Object} CaptureHandle
 * @property {() => void} stop Stop the capture, release the worklet/module
 *   processor, and stop all tracks on the underlying stream. Idempotent.
 * @property {() => boolean} isWorklet True if running on AudioWorklet, false
 *   if on the ScriptProcessorNode fallback.
 */

/**
 * Start capturing 16 kHz mono Float32Array PCM from a MediaStream.
 *
 * @param {CaptureOptions} options
 * @returns {Promise<CaptureHandle>}
 */
export async function startCapture(options) {
  if (!options || !options.stream) {
    throw new Error("startCapture requires a MediaStream.");
  }
  if (typeof options.onChunk !== "function") {
    throw new Error("startCapture requires an onChunk callback.");
  }

  const sampleRate = options.sampleRate ?? 16_000;
  const chunkFrames = options.chunkFrames ?? 4096;
  const onChunk = options.onChunk;
  const onError = options.onError ?? (() => undefined);

  const AudioCtor = /** @type {any} */ (
    (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext))
  );
  if (!AudioCtor) {
    throw new Error("Web Audio API is not available in this runtime.");
  }

  const ctx = new AudioCtor({ sampleRate, latencyHint: "interactive" });

  // Some browsers start the context suspended until a user gesture. If the
  // user invoked dictation via a click/keystroke, the gesture should already
  // have resumed it; this is a belt-and-suspenders.
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch (error) {
      // Non-fatal: capture will simply produce no audio until resumed.
    }
  }

  const source = ctx.createMediaStreamSource(options.stream);
  /** @type {AudioWorkletNode | ScriptProcessorNode | null} */
  let node = null;
  /** @type {AudioWorkletGlobalScope | null} */
  let workletNode = null;
  let isWorklet = false;
  let stopped = false;

  // Two paths. The worklet path is preferred because it runs on the audio
  // rendering thread and doesn't glitch under main-thread load. Detect at
  // runtime: `audioContext.audioWorklet` is the canonical signal. Be
  // defensive: some host environments expose `audioWorklet` as `null`
  // (TypeScript-typed JSDOM stubs) rather than `undefined`, so guard both.
  const workletApi = /** @type {{ addModule?: unknown } | null | undefined} */ (ctx.audioWorklet);
  const supportsWorklet = !!workletApi && typeof workletApi.addModule === "function";

  if (supportsWorklet) {
    // Load the worklet module from a same-origin URL. Inline `blob:` and
    // `data:` URLs are blocked under COOP/COEP cross-origin isolation and
    // by the document's `script-src 'self'` CSP. A static file served from
    // `/dictation/` satisfies both constraints.
    await ctx.audioWorklet.addModule(options.workletUrl ?? WORKLET_URL);
    workletNode = /** @type {AudioWorkletNode} */ (new AudioWorkletNode(ctx, "pcm-16k-processor"));
    /** @type {SharedArrayBuffer} */
    const sab = new SharedArrayBuffer(chunkFrames * Float32Array.BYTES_PER_ELEMENT);
    workletNode.port.postMessage({ type: "configure", sab });
    workletNode.port.onmessage = (event) => {
      if (stopped) return;
      const data = event.data;
      if (data && data.type === "chunk" && data.samples instanceof Float32Array) {
        // The samples are transferred — wrap in a fresh Float32Array view
        // just to be safe in case the worklet postMessage didn't transfer.
        const samples = data.samples;
        onChunk(samples.byteOffset === 0 && samples.byteLength === samples.buffer.byteLength
          ? samples
          : new Float32Array(samples));
      }
    };
    workletNode.onprocessorerror = (event) => {
      onError(new Error(`AudioWorklet processor error: ${(event && /** @type {any} */ (event).exception?.message) || "unknown"}`));
    };
    source.connect(workletNode);
    // Note: we intentionally do NOT connect the worklet to ctx.destination —
    // the user does not want to hear their own dictation played back.
    node = workletNode;
    isWorklet = true;
  } else {
    // ScriptProcessorNode fallback. The deprecation warning is fine; it's
    // still the universal default.
    const sp = /** @type {any} */ (ctx.createScriptProcessor(chunkFrames, 1, 1));
    sp.onaudioprocess = (event) => {
      if (stopped) return;
      const input = event.inputBuffer.getChannelData(0);
      // Copy out so the worklet-processor's buffer can be recycled.
      const out = new Float32Array(input.length);
      out.set(input);
      onChunk(out);
    };
    source.connect(sp);
    // ScriptProcessorNode *requires* a connection to destination to fire.
    // Connect to a muted gain so we don't actually play back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    sp.connect(mute);
    mute.connect(ctx.destination);
    node = sp;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      node?.disconnect();
    } catch {
      // ignore
    }
    try {
      source.disconnect();
    } catch {
      // ignore
    }
    if (ctx.state !== "closed") {
      ctx.close().catch(() => undefined);
    }
  }

  return { stop, isWorklet: () => isWorklet };
}
