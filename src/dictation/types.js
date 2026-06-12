// @ts-check

/**
 * Engine lifecycle. Loaded in `idle`, transitioning to `loading` on first
 * `preload()` call, then to `ready` (success) or `error` (failure).
 *
 * @typedef {"idle" | "loading" | "ready" | "error"} EngineState
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
 * @typedef {WorkerInitMessage | WorkerTranscribeMessage} WorkerInbound
 */

/**
 * Callbacks the controller fires while recording. Each is optional.
 *
 * @typedef {Object} ControllerCallbacks
 * @property {(text: string) => void} [onText] Final transcript text from the most recent recording.
 * @property {(recording: boolean) => void} [onStateChange] Recording state flipped on start/stop.
 * @property {(message: string) => void} [onNotice] User-visible error/notice.
 * @property {(state: EngineState) => void} [onEngineState] Engine load state changed.
 */

/**
 * @typedef {Object} CreateControllerInput
 * @property {HTMLTextAreaElement | HTMLInputElement} [input] Optional input to insert transcript into. If omitted, the controller is button-only and the host handles the text.
 * @property {HTMLElement} [button] Optional mic button to update aria/title/disabled.
 * @property {ControllerCallbacks} [callbacks]
 * @property {(target: HTMLElement | null) => boolean} [isEditableTarget] Editable predicate override (defaults to {@link isEditableTarget}).
 */

export {};
