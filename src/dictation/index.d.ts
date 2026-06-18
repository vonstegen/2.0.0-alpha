// Type definitions for src/dictation/. The implementation is plain JS with
// JSDoc; this file lets the React app consume it with full TS type safety.

export type EngineState = "idle" | "loading" | "ready" | "error";

export type DictationEngineKind = "parakeet" | "whisper";

export type DictationEngineSelection = "auto" | "whisper" | "parakeet";

export interface DictationSettings {
  engineSelection?: DictationEngineSelection;
  language?: string;
  task?: "transcribe" | "translate";
}

export interface EngineOptions {
  /** Returns a fresh module Web Worker for the requested engine kind. */
  createWorker: (kind: DictationEngineKind) => Worker;
  /** Engine selection mode. Defaults to "auto". */
  engineSelection?: DictationEngineSelection;
  /** Returns the current settings snapshot; called per-transcribe. */
  getDictationSettings?: () => DictationSettings;
  /** Optional path to onnxruntime-web WASM blobs (same-origin recommended). */
  wasmPaths?: string | null;
  /** Preferred execution backend for Parakeet. Ignored by Whisper. */
  backend?: "webgpu-hybrid" | "webgpu-strict" | "wasm";
  /** Reserved for future use. */
  streaming?: boolean;
}

export interface TextInsertionContext {
  value: string;
  start: number;
  end: number;
  input: HTMLTextAreaElement | HTMLInputElement | null;
}

export interface ControllerCallbacks {
  onText?: (text: string, context: TextInsertionContext | null) => void;
  onStateChange?: (recording: boolean) => void;
  onNotice?: (message: string) => void;
  onEngineState?: (state: EngineState) => void;
}

export interface CreateControllerInput {
  input?: HTMLTextAreaElement | HTMLInputElement | (() => HTMLTextAreaElement | HTMLInputElement | null) | null;
  button?: HTMLElement | null;
  callbacks?: ControllerCallbacks;
  isEditableTarget?: (target: Element | null) => boolean;
  /** Returns the current per-utterance settings; called at each stop(). */
  getDictationSettings?: () => { language?: string; task?: "transcribe" | "translate" };
}

export interface DictationController {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  toggle: () => Promise<void>;
  isRecording: () => boolean;
  isReady: () => boolean;
  dispose: () => Promise<void>;
  handleKeyDown: (event: KeyboardEvent) => boolean;
  handleKeyUp: (event: KeyboardEvent) => boolean;
}

export const MODEL_URLS: Readonly<{
  encoderUrl: string;
  decoderUrl: string;
  tokenizerUrl: string;
}>;

export const DEFAULT_ENGINE_WASM_PATHS: string;

export function preload(options: EngineOptions): Promise<void>;
export function transcribe(pcm: Float32Array, sampleRate?: number): Promise<string>;
export function openStream(): string;
export function streamChunk(
  sessionId: string,
  pcm: Float32Array,
  sampleRate?: number,
  opts?: { onPartial?: (text: string) => void },
): Promise<string>;
export function finalizeStream(sessionId: string): Promise<string>;
export function cancelStream(sessionId: string): void;
export function getEngineState(): EngineState;
export function getEngineKind(): DictationEngineKind;
export function getEngineDevice(): "webgpu" | "wasm" | null;
export function getEngineMessage(): string | null;
export function subscribeEngineState(
  cb: (state: EngineState, message: string | null) => void,
): () => void;
export function subscribeDictationEngine(
  cb: (state: EngineState, message: string | null) => void,
): () => void;
export function isDictationEngineAvailable(): boolean;
export function dispose(): Promise<void>;

export function createDictationController(input?: CreateControllerInput): DictationController;

export function isEditableTarget(target: Element | null): boolean;
export function insertAtCursor(input: HTMLTextAreaElement | HTMLInputElement, text: string): void;
