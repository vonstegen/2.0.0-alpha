// Intent citation: docs/architecture/ADR-001-platform-stack.md

import {
  getEngineState,
  isDictationEngineAvailable,
  subscribeDictationEngine,
  type EngineState,
} from "../../dictation/index.js";

/**
 * Re-export the dictation engine surface for callers that prefer to import
 * from `chat/dictation` (preserves the original module path).
 */
export {
  getEngineState,
  isDictationEngineAvailable,
  subscribeDictationEngine,
  type EngineState,
};

const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * True when the runtime is one where local dictation should be allowed. Tauri
 * is excluded per scope (the worker + IndexedDB + mic pipeline is well-tested
 * in browser engines, but Tauri WebViews have not been validated).
 */
export const canUseDictation = (): boolean =>
  !isTauriRuntime() &&
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Synchronous read of the current dictation engine state.
 */
export const isDictationReady = (): boolean => getEngineState() === "ready";

/**
 * Returns a record of booleans the shell view model can use to render the
 * mic toolbar button. `dictationAvailable` is whether the runtime is
 * fundamentally capable; `dictationReady` is whether the model has finished
 * loading. The mic button is disabled until both are true.
 */
export const getDictationAvailability = (): { available: boolean; ready: boolean; state: EngineState } => {
  const available = canUseDictation() && isDictationEngineAvailable();
  return {
    available,
    ready: available && isDictationReady(),
    state: getEngineState(),
  };
};

/**
 * Subscribe to dictation engine state changes. Returns an unsubscribe function.
 * Wraps the engine's `subscribe` so chat code can avoid reaching into `dictation/`.
 */
export const subscribeDictationState = (cb: (ready: boolean) => void): (() => void) =>
  subscribeDictationEngine((state) => cb(state === "ready"));
