// @ts-check

import { subscribeEngineState } from "./engine.js";

export {
  preload,
  transcribe,
  streamChunk,
  finalizeStream,
  openStream,
  cancelStream,
  getEngineState,
  getEngineMessage,
  subscribeEngineState,
  dispose,
  MODEL_URLS,
} from "./engine.js";
export {
  createDictationController,
  DEFAULT_ENGINE_WASM_PATHS,
} from "./controller.js";
export { isEditableTarget, insertAtCursor } from "./editable.js";

/**
 * True when the browser exposes the APIs dictation needs. Does NOT check the
 * engine state — use {@link getEngineState} for that. Used to gate the mic
 * toolbar button so it shows "not available" rather than "loading" on
 * unsupported runtimes.
 *
 * @returns {boolean}
 */
export function isDictationEngineAvailable() {
  if (typeof window === "undefined") return false;
  if (typeof Worker === "undefined") return false;
  if (typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return true;
}

/**
 * @typedef {import("./types.js").EngineState} DictationEngineState
 */

/**
 * Convenience alias for chat callers.
 *
 * @param {(state: DictationEngineState, message: string | null) => void} cb
 * @returns {() => void}
 */
export function subscribeDictationEngine(cb) {
  return subscribeEngineState(cb);
}
