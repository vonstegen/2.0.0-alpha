// @ts-check

import {
  dispose as disposeEngine,
  getEngineState,
  subscribeEngineState,
  subscribeEngineNotices,
  transcribe,
} from "./engine.js";
import { isEditableTarget } from "./editable.js";
import { getToneContext, playStartTone, playStopTone } from "./tones.js";

/**
 * Default WASM path served by the Vite app. The Chrome extension will pass a
 * `chrome.runtime.getURL(...)` path via the same option.
 */
const DEFAULT_WASM_PATHS = "/dictation/ort-wasm/";

/**
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
 * @property {() => { language?: string, task?: "transcribe" | "translate" }} [getDictationSettings]
 *   Returns the current per-utterance settings. Called at each `stop()` so
 *   changes take effect without an engine reload.
 */

/**
 * Records the user's speech with MediaRecorder, decodes the full
 * recording on `onstop` (a complete, header-bearing file, not a
 * fragment), and runs one `transcribe(pcm)` call against the
 * parakeet.js model.
 *
 * For tap-toggle the sequence is `start()` → wait → `stop()`. For
 * push-to-talk (Ctrl+Space) the keyboard handlers in the returned
 * object manage the same lifecycle.
 *
 * @param {CreateControllerInput} input
 * @returns {{
 *   start: () => Promise<void>,
 *   stop: () => Promise<void>,
 *   toggle: () => Promise<void>,
 *   isRecording: () => boolean,
 *   isReady: () => boolean,
 *   dispose: () => Promise<void>,
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
  const getDictationSettings = input.getDictationSettings ?? (() => ({}));

  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {MediaRecorder | null} */
  let recorder = null;
  /** @type {Blob[] | null} */
  let chunks = null;
  /** Reused across sessions so we don't spin up a new audio thread per recording. */
  let decodeContext = null;
  let recording = false;
  let pushToTalk = false;
  /** @type {TextInsertionContext | null} */
  let startContext = null;
  /** Set when the recording produced at least one non-empty chunk. */
  let gotData = false;

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
  const unsubscribeNotices = subscribeEngineNotices((message) => {
    callbacks.onNotice?.(message);
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

  function pickRecorderMime() {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    }
    return "";
  }

  async function getDecodeContext() {
    if (decodeContext) return decodeContext;
    const AudioCtor = /** @type {any} */ (
      (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext))
    );
    if (!AudioCtor) {
      throw new Error("Web Audio API is not available in this browser runtime.");
    }
    decodeContext = new AudioCtor({ sampleRate: 16_000 });
    if (decodeContext.state === "suspended") {
      try { await decodeContext.resume(); } catch { /* ignore */ }
    }
    return decodeContext;
  }

  /**
   * Decode a complete WebM/Opus recording into a mono 16 kHz Float32Array.
   * `decodeAudioData` works reliably here because the input is a
   * finished file (headers + final EOS marker), not a fragment chunk.
   *
   * @param {Blob} blob
   * @returns {Promise<Float32Array>}
   */
  async function decodeBlobToMono16k(blob) {
    const ctx = await getDecodeContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0).slice();
    }
    const length = audioBuffer.length;
    const out = new Float32Array(length);
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const data = audioBuffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        out[i] += data[i] / audioBuffer.numberOfChannels;
      }
    }
    return out;
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
    gotData = false;
    chunks = [];
    try {
      const s = await ensureMicStream();
      const mime = pickRecorderMime();
      recorder = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
          gotData = true;
        }
      };
      // No timeslice: we only want a complete recording on onstop. With
      // timeslice(250), each ondataavailable would be a headerless
      // fragment that decodeAudioData can't decode on its own. The whole
      // recording-as-one-blob approach is what makes the audio path
      // reliable.
      recorder.start();
    } catch (error) {
      const message = describeMicError(error);
      callbacks.onNotice?.(message);
      stopTracks();
      teardownRecorder();
      chunks = null;
      startContext = null;
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

    if (!recorder) {
      stopTracks();
      chunks = null;
      return;
    }
    const localRecorder = recorder;
    const localChunks = chunks;
    const localStartContext = startContext;
    teardownRecorder();

    const ended = new Promise((resolve) => {
      localRecorder.addEventListener("stop", resolve, { once: true });
    });
    try {
      localRecorder.stop();
    } catch {
      // recorder may already be stopped
    }
    await ended;
    stopTracks();

    if (!localChunks || !gotData) {
      // No data captured. Nothing to transcribe.
      chunks = null;
      startContext = null;
      return;
    }

    // Build a single complete blob from all chunks. The concatenated
    // blob carries the WebM headers (from the first chunk) and the EOS
    // marker (from the last), which is what `decodeAudioData` needs to
    // succeed.
    const blob = new Blob(localChunks, { type: localChunks[0]?.type || "audio/webm" });
    chunks = null;
    startContext = null;

    try {
      const pcm = await decodeBlobToMono16k(blob);
      if (pcm.length === 0) return;
      const settings = getDictationSettings() ?? {};
      const text = await transcribe(pcm, 16_000, {
        language: settings.language,
        task: settings.task,
      });
      if (text && text.trim()) {
        callbacks.onText?.(text, localStartContext);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      callbacks.onNotice?.(`Voice dictation failed: ${message}`);
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

  function teardownRecorder() {
    recorder = null;
  }

  function stopTracks() {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
  }

  async function dispose() {
    unsubscribeEngine();
    unsubscribeNotices();
    if (recording) {
      try { recorder?.stop(); } catch { /* ignore */ }
    }
    stopTracks();
    teardownRecorder();
    chunks = null;
    startContext = null;
    gotData = false;
    // Tear down the engine worker too so a fresh controller
    // (e.g. in tests, or after a hot reload) re-preloads cleanly.
    await disposeEngine();
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
  // Surface the exception type so we can tell apart a `getUserMedia` error
  // from a `decodeAudioData` error or a WebM decode error.
  const type = error?.constructor?.name ?? "Error";
  const message = error instanceof Error ? error.message : String(error?.message ?? error ?? "Unknown error");
  return `Microphone access failed (${type}): ${message}`;
}
