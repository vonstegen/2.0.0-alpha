// @ts-check

/**
 * Engine lifecycle. Loaded in `idle`, transitioning to `loading` on first
 * `preload()` call, then to `ready` (success) or `error` (failure).
 *
 * @typedef {"idle" | "loading" | "ready" | "error"} EngineState
 */

/**
 * Which on-device ASR engine the engine module is currently configured
 * to load. The engine module is a singleton — switching kinds means
 * `dispose()` then `preload({ kind: <new> })`.
 *
 * - `"parakeet"` — NVIDIA Parakeet TDT 0.6B v3 int8 via parakeet.js.
 *   Default. ~650 MB encoder, multilingual, fast on CPU.
 * - `"whisper"` — Whisper base multilingual q8 via
 *   @huggingface/transformers. ~77 MB. Fallback option.
 *
 * @typedef {"parakeet" | "whisper"} DictationEngineKind
 */

/**
 * @typedef {Object} EngineStatus
 * @property {EngineState} state
 * @property {string | null} message Optional human-readable detail (only set on `error`).
 */

/**
 * Worker → main thread messages.
 *
 * @typedef {{ type: "ready" }} WorkerReadyMessage
 * @typedef {{ type: "result", id: number, text: string }} WorkerResultMessage
 * @typedef {{ type: "chunk-result", id: number, sessionId: string, text: string }} WorkerChunkResultMessage
 * @typedef {{ type: "partial", id: number, sessionId: string, text: string }} WorkerPartialMessage
 * @typedef {{ type: "final", id: number, sessionId: string, text: string }} WorkerFinalMessage
 * @typedef {{ type: "error", id: number, message: string }} WorkerErrorMessage
 * @typedef {WorkerReadyMessage | WorkerResultMessage | WorkerChunkResultMessage | WorkerPartialMessage | WorkerFinalMessage | WorkerErrorMessage} WorkerOutbound
 */

/**
 * Main thread → worker messages.
 *
 * @typedef {{ type: "init", wasmPaths: string | null, backend?: string }} WorkerInitMessage
 * @typedef {{ type: "transcribe", id: number, pcm: Float32Array, sampleRate: number }} WorkerTranscribeMessage
 * @typedef {{ type: "transcribe-chunk", id: number, sessionId: string, pcm: Float32Array, sampleRate: number }} WorkerTranscribeChunkMessage
 * @typedef {{ type: "stream-finalize", id: number, sessionId: string }} WorkerStreamFinalizeMessage
 * @typedef {{ type: "stream-cancel", id: number, sessionId: string }} WorkerStreamCancelMessage
 * @typedef {WorkerInitMessage | WorkerTranscribeMessage | WorkerTranscribeChunkMessage | WorkerStreamFinalizeMessage | WorkerStreamCancelMessage} WorkerInbound
 */

/**
 * Callbacks the controller fires while recording. Each is optional.
 *
 * @typedef {Object} ControllerCallbacks
 * @property {(text: string, context: import("./controller.js").TextInsertionContext) => void} [onText]
 *   Final transcript text from the most recent recording.
 * @property {(recording: boolean) => void} [onStateChange] Recording state flipped on start/stop.
 * @property {(message: string) => void} [onNotice] User-visible error/notice.
 * @property {(state: EngineState) => void} [onEngineState] Engine load state changed.
 */

/**
 * @typedef {Object} CreateControllerInput
 * @property {HTMLTextAreaElement | HTMLInputElement | (() => HTMLTextAreaElement | HTMLInputElement | null) | null} [input]
 *   Optional input to insert transcript into. May be a DOM element or a
 *   function that returns one (useful for refs that mount later). If
 *   omitted, the controller is button-only and the host handles the text.
 * @property {HTMLElement} [button] Optional mic button to update aria/title/disabled.
 * @property {ControllerCallbacks} [callbacks]
 * @property {(target: Element | null) => boolean} [isEditableTarget]
 *   Editable predicate override (defaults to {@link isEditableTarget}).
 */

export {};
