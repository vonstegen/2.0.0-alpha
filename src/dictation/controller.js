// @ts-check

import {
  cancelStream,
  finalizeStream,
  getEngineState,
  openStream,
  streamChunk,
  subscribeEngineState,
  transcribe,
} from "./engine.js";
import { isEditableTarget } from "./editable.js";
import { getToneContext, playStartTone, playStopTone } from "./tones.js";
import { startCapture } from "./audio-capture.js";

/**
 * Default WASM path served by the Vite app. The Chrome extension will pass a
 * `chrome.runtime.getURL(...)` path via the same option.
 */
const DEFAULT_WASM_PATHS = "/dictation/ort-wasm/";

/**
 * RMS threshold below which a chunk is treated as silence and dropped before
 * the streaming decoder sees it. The exact value is conservative: typical
 * speech at 1 m from a typical mic lands around 0.02-0.3 RMS; quiet
 * room-tone / mic self-noise is usually under 0.005. 0.005 leaves plenty
 * of headroom for soft speakers.
 */
const SILENCE_RMS = 0.005;

/**
 * Compute the root-mean-square amplitude of a PCM chunk. Used for silence
 * gating; cheap (one pass, no allocation).
 *
 * @param {Float32Array} pcm
 * @returns {number}
 */
function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    sum += pcm[i] * pcm[i];
  }
  return Math.sqrt(sum / pcm.length);
}

/**
 * Snapshot of the textarea's value and selection at the moment a recording
 * starts. The controller passes this to the `onText` callback so the caller
 * can splice the dictation result into the right place — even if React (or
 * any other framework) re-renders the controlled input during the
 * transcription window, by which time the DOM value may be stale.
 *
 * @typedef {Object} TextInsertionContext
 * @property {string} value The textarea's value at recording start.
 * @property {number} start Selection start at recording start.
 * @property {number} end Selection end at recording start.
 * @property {HTMLTextAreaElement | HTMLInputElement | null} input A reference
 *   to the input element, in case the caller wants to write back to it
 *   directly (e.g. the extension, which doesn't have framework state).
 */

/**
 * @typedef {Object} ControllerCallbacks
 * @property {(text: string, context: TextInsertionContext) => void} [onText]
 *   Fires once with the *final* transcript after a successful transcription.
 * @property {(text: string, context: TextInsertionContext) => void} [onPartialText]
 *   Fires repeatedly with the *cumulative* partial transcript as the user
 *   speaks. The context is the same as the one passed to `onText`. Use this
 *   for live-updating UI; fall back to `onText` if you only want the final
 *   result.
 * @property {(recording: boolean) => void} [onStateChange]
 * @property {(message: string) => void} [onNotice]
 * @property {(state: EngineState) => void} [onEngineState]
 */

/**
 * @typedef {Object} CreateControllerInput
 * @property {HTMLTextAreaElement | HTMLInputElement | (() => HTMLTextAreaElement | HTMLInputElement | null) | null} [input]
 * @property {HTMLElement} [button]
 * @property {ControllerCallbacks} [callbacks]
 * @property {(target: Element | null) => boolean} [isEditableTarget]
 */

/**
 * Records audio via an AudioWorklet (or ScriptProcessorNode fallback),
 * converting the mic stream directly into 16 kHz mono Float32Array PCM chunks
 * and forwarding them to a parakeet.js streaming session in the worker. The
 * caller receives `onPartialText` for each chunk so they can show live text
 * as the user speaks. On `stop()` the streaming session is finalized and
 * the final transcript is emitted via `onText`.
 *
 * Earlier revisions used `MediaRecorder` to encode audio as WebM/Opus and
 * `AudioContext.decodeAudioData` to decode each chunk back to PCM. That
 * pipeline was structurally broken: `decodeAudioData` either can't decode
 * WebM/Opus at all (most Chromium builds) or, when it can, refuses to
 * decode the *headerless fragment* chunks emitted by
 * `MediaRecorder.ondataavailable` — only the very first chunk has the
 * WebM headers. The current path bypasses encode/decode entirely.
 *
 * For tap-toggle the sequence is `start()` → wait → `stop()`. For
 * push-to-talk (Ctrl+Space) the keyboard handlers in the returned object
 * manage the same lifecycle.
 *
 * @param {CreateControllerInput} input
 * @returns {{
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   toggle: () => Promise<void>,
 *   isRecording: () => boolean,
 *   isReady: () => boolean,
 *   dispose: () => void,
 *   handleKeyDown: (event: KeyboardEvent) => boolean,
 *   handleKeyUp: (event: KeyboardEvent) => boolean,
 * }}
 */
export function createDictationController(input = {}) {
  const button = input.button ?? null;
  /** Resolves the current input element lazily so a late-mounting ref still works. */
  const getInput = typeof input.input === "function"
    ? input.input
    : () => input.input ?? null;
  const callbacks = input.callbacks ?? {};
  const isEditable = input.isEditableTarget ?? isEditableTarget;

  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {{ stop: () => void } | null} */
  let capture = null;
  let recording = false;
  let pushToTalk = false;
  /** @type {string | null} */
  let sessionId = null;
  /** @type {TextInsertionContext | null} */
  let startContext = null;
  /** Inflight streamChunk promise; we await it before pushing the next chunk. */
  let chunkInflight = null;
  /** Lock so `onChunk` callbacks fire streamChunk sequentially. */
  let processingLock = null;
  /**
   * True once at least one non-silence chunk has been forwarded to the
   * streaming session in the worker. Used by `stop()` to decide whether
   * to call `finalizeStream` at all — if the user only recorded silence,
   * the worker never created the session and `stream-finalize` would
   * bounce back as "Unknown streaming session".
   */
  let sessionReceivedChunks = false;

  function setRecordingUI(next) {
    if (!button) return;
    button.classList.toggle("is-live", next);
    button.setAttribute("aria-pressed", next ? "true" : "false");
    button.setAttribute("aria-label", next ? "Stop dictation" : "Start dictation");
  }

  function reflectEngineState() {
    if (!button) return;
    const ready = getEngineState() === "ready";
    button.disabled = !ready;
    if (ready) {
      button.title = recording
        ? "Stop dictation"
        : "Start dictation (or press Ctrl+Space while editing)";
    } else {
      button.title = "Loading dictation model…";
    }
  }

  const unsubscribeEngine = subscribeEngineState(() => {
    reflectEngineState();
    callbacks.onEngineState?.(getEngineState());
  });
  reflectEngineState();

  async function ensureMicStream() {
    if (stream) return stream;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is not available in this browser runtime.");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16_000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    return stream;
  }

  /**
   * Forward a Float32Array PCM chunk (16 kHz mono, already in the format
   * parakeet.js wants) to the streaming session. Multiple `onChunk` calls
   * may fire in quick succession; we serialize them through `processingLock`
   * so the engine's decoder state is updated in order. Partial transcripts
   * are emitted via `onPartialText`.
   *
   * Silence is gated: chunks whose RMS is below a small threshold are
   * skipped so we don't burn decoder cycles on background noise and don't
   * pollute the partials UI with empty transcripts.
   */
  async function processChunk(pcm) {
    if (!sessionId || !pcm || pcm.length === 0) return;
    if (rms(pcm) < SILENCE_RMS) return;
    sessionReceivedChunks = true;
    const run = async () => {
      try {
        const text = await streamChunk(sessionId, pcm, 16_000, {
          onPartial: (partial) => {
            if (callbacks.onPartialText && startContext) {
              callbacks.onPartialText(partial, startContext);
            }
          },
        });
        // After this chunk completes, the next `onChunk` may already be
        // queued. We don't emit a final `onText` here — that fires only on
        // `stop()` after `finalizeStream`.
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        callbacks.onNotice?.(`Voice dictation failed: ${message}`);
      }
    };
    const previous = processingLock ?? Promise.resolve();
    const next = previous.then(run);
    processingLock = next.catch(() => undefined);
    return next;
  }

  async function startCaptureFromMic() {
    const s = await ensureMicStream();
    capture = await startCapture({
      stream: s,
      sampleRate: 16_000,
      chunkFrames: 4096,
      onChunk: (pcm) => {
        // Copy defensively in case the capture implementation hands us a
        // non-owned view; the worklet path already transfers a fresh
        // buffer per chunk, but the ScriptProcessorNode fallback reuses
        // a single input buffer across calls.
        const copy = new Float32Array(pcm.length);
        copy.set(pcm);
        void processChunk(copy);
      },
      onError: (error) => {
        callbacks.onNotice?.(`Voice dictation failed: ${error.message}`);
      },
    });
  }

  function stopCapture() {
    if (capture) {
      capture.stop();
      capture = null;
    }
  }

  function stopTracks() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  /**
   * Snapshot the input element's value and selection. Called at recording
   * start so we can pass the *original* splice position to `onText`, even
   * if the DOM has been re-rendered by a framework by the time transcribe
   * completes.
   *
   * @returns {TextInsertionContext | null}
   */
  function captureContext() {
    const liveInput = getInput();
    if (!liveInput) return null;
    const value = liveInput.value ?? "";
    const start =
      typeof liveInput.selectionStart === "number" ? liveInput.selectionStart : value.length;
    const end =
      typeof liveInput.selectionEnd === "number" ? liveInput.selectionEnd : value.length;
    return { value, start, end, input: liveInput };
  }

  async function start() {
    if (recording) return;
    if (getEngineState() !== "ready") {
      callbacks.onNotice?.("Dictation model is still loading.");
      return;
    }
    startContext = captureContext();
    sessionId = openStream();
    sessionReceivedChunks = false;
    try {
      await startCaptureFromMic();
    } catch (error) {
      const message = describeMicError(error);
      callbacks.onNotice?.(message);
      stopTracks();
      stopCapture();
      cancelStream(sessionId);
      sessionId = null;
      startContext = null;
      sessionReceivedChunks = false;
      return;
    }
    recording = true;
    setRecordingUI(true);
    const ctx = getToneContext();
    if (ctx) playStartTone(ctx);
    callbacks.onStateChange?.(true);
  }

  async function stop() {
    if (!recording) return;
    recording = false;
    setRecordingUI(false);
    callbacks.onStateChange?.(false);
    const ctx = getToneContext();
    if (ctx) playStopTone(ctx);

    const localSessionId = sessionId;
    const localStartContext = startContext;
    const localProcessing = processingLock;
    stopCapture();

    // Drain any in-flight chunk processing before finalizing, so the
    // session's decoder state includes the final chunk's contribution.
    if (localProcessing) {
      try { await localProcessing; } catch { /* errors already surfaced */ }
    }
    stopTracks();

    if (!localSessionId) return;
    if (!sessionReceivedChunks) {
      // The user only recorded silence (or the controller was disposed
      // before any chunk landed). The worker never created the streaming
      // session, so there's nothing to finalize — `stream-finalize` would
      // bounce back as "Unknown streaming session". Skip the round-trip
      // entirely.
      cancelStream(localSessionId);
      sessionId = null;
      startContext = null;
      processingLock = null;
      return;
    }
    try {
      const text = await finalizeStream(localSessionId);
      if (text && text.trim()) {
        callbacks.onText?.(text, localStartContext);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onNotice?.(`Voice dictation failed: ${message}`);
    } finally {
      cancelStream(localSessionId);
      sessionId = null;
      startContext = null;
      processingLock = null;
      sessionReceivedChunks = false;
    }
  }

  async function toggle() {
    if (recording) {
      await stop();
    } else {
      await start();
    }
  }

  function handleKeyDown(event) {
    if (event.key !== " " && event.code !== "Space") return false;
    if (event.repeat) return false;
    if (!event.ctrlKey && !event.metaKey) return false;
    if (event.altKey) return false;
    if (!recording && !isEditable(event.target)) return false;
    if (getEngineState() !== "ready") {
      callbacks.onNotice?.("Dictation model is still loading.");
      return false;
    }
    event.preventDefault();
    if (!recording) {
      pushToTalk = true;
      void start();
    }
    return true;
  }

  function handleKeyUp(event) {
    if (event.key !== " " && event.code !== "Space") return false;
    if (!recording || !pushToTalk) return false;
    event.preventDefault();
    pushToTalk = false;
    void stop();
    return true;
  }

  function dispose() {
    unsubscribeEngine();
    if (recording) {
      stopCapture();
    }
    if (sessionId) {
      cancelStream(sessionId);
      sessionId = null;
    }
    stopTracks();
    startContext = null;
    processingLock = null;
    sessionReceivedChunks = false;
  }

  return {
    start,
    stop,
    toggle,
    isRecording: () => recording,
    isReady: () => getEngineState() === "ready",
    dispose,
    handleKeyDown,
    handleKeyUp,
  };
}

/**
 * Default WASM path resolver. The Vite app uses `/dictation/ort-wasm/`; the
 * Chrome extension overrides this with `chrome.runtime.getURL(...)`.
 *
 * @type {string}
 */
export const DEFAULT_ENGINE_WASM_PATHS = DEFAULT_WASM_PATHS;

/**
 * @param {Error | { name?: string, message?: string }} error
 * @returns {string}
 */
function describeMicError(error) {
  const name = String(error?.name ?? "");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone input device was found. Connect or enable a microphone, then try dictation again.";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "Microphone permission is denied. Enable microphone access for this site, then try again.";
  }
  // Surface the exception type so we can tell apart an AudioWorklet addModule
  // failure (the common cross-origin-isolated Chromium bug) from a generic
  // audio capture error. Without this, every failure reads as "Microphone
  // access failed" and the user can't tell whether it's a permission issue,
  // a worklet loading issue, or something else.
  const type = error?.constructor?.name ?? "Error";
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "Unknown error");
  return `Microphone access failed (${type}): ${message}`;
}
