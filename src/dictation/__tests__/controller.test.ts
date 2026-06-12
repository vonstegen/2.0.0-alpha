// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDictationController,
  dispose as disposeEngine,
  getEngineState,
  isEditableTarget,
  preload as preloadEngine,
  subscribeDictationEngine,
  subscribeEngineState,
  transcribe as transcribePcm,
} from "../index.js";

/**
 * Stub for `startCapture`. The real implementation pulls audio from a
 * `MediaStream` via `AudioContext` + `AudioWorklet`; in JSDOM neither is
 * implemented, so we mock the module and expose a `__push(pcm)` test handle
 * the test suite can use to feed Float32Array chunks directly into the
 * controller's `processChunk` path. This is the same boundary the
 * real-world audio worklet uses, so the pipeline behavior under test
 * (chunk → streamChunk → finalizeStream → onText) is unchanged.
 */
let captureStarted = false;
let captureOnChunk: ((pcm: Float32Array) => void) | null = null;
let captureOnError: ((error: Error) => void) | null = null;
function fakeStartCapture(options: {
  stream: MediaStream;
  onChunk: (pcm: Float32Array) => void;
  onError?: (error: Error) => void;
}) {
  captureStarted = true;
  captureOnChunk = options.onChunk;
  captureOnError = options.onError ?? null;
  return Promise.resolve({
    stop() {
      captureStarted = false;
      captureOnChunk = null;
      captureOnError = null;
    },
    isWorklet: () => false,
  });
}
const __pushChunk = (pcm: Float32Array) => {
  if (captureOnChunk) captureOnChunk(pcm);
};
const __pushError = (error: Error) => {
  if (captureOnError) captureOnError(error);
};

vi.mock("../audio-capture.js", () => ({
  startCapture: (options: Parameters<typeof fakeStartCapture>[0]) => fakeStartCapture(options),
}));

type WorkerListener = (event: { data: unknown }) => void;

class FakeWorker {
  static lastInstance: FakeWorker | null = null;
  url: string;
  options: { type?: string };
  private messageListeners: WorkerListener[] = [];
  private errorListeners: WorkerListener[] = [];
  sentMessages: unknown[] = [];
  ready = false;
  /**
   * Per-message-type handlers the test can override. By default each handler
   * is a no-op; tests that need a particular message to return text set
   * the appropriate handler. This mirrors the real worker's contract: a
   * `transcribe-chunk` message emits a `partial` (cumulative) and a
   * `stream-finalize` message emits a `final`.
   */
  transcribeHandler: ((id: number, pcm: Float32Array, sampleRate: number) => void) | null = null;
  streamChunkHandler: ((id: number, sessionId: string, pcm: Float32Array, sampleRate: number) => void) | null = null;
  streamFinalizeHandler: ((id: number, sessionId: string) => void) | null = null;

  constructor(url: string, options: { type?: string } = {}) {
    this.url = url;
    this.options = options;
    FakeWorker.lastInstance = this;
  }

  addEventListener(type: "message" | "error", listener: WorkerListener) {
    if (type === "message") this.messageListeners.push(listener);
    if (type === "error") this.errorListeners.push(listener);
  }

  removeEventListener(type: "message" | "error", listener: WorkerListener) {
    if (type === "message") {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    }
    if (type === "error") {
      this.errorListeners = this.errorListeners.filter((l) => l !== listener);
    }
  }

  /** Dispatch a message to all registered listeners. */
  emitMessage(data: unknown) {
    for (const listener of [...this.messageListeners]) {
      listener({ data });
    }
  }

  postMessage(message: unknown) {
    this.sentMessages.push(message);
    if (message && typeof message === "object" && "type" in message) {
      const m = message as {
        type: string;
        id?: number;
        sessionId?: string;
        pcm?: Float32Array;
        sampleRate?: number;
      };
      if (m.type === "init") {
        queueMicrotask(() => {
          this.ready = true;
          this.emitMessage({ type: "ready" });
        });
      }
      if (m.type === "transcribe" && this.transcribeHandler) {
        const id = m.id ?? 0;
        this.transcribeHandler(id, m.pcm ?? new Float32Array(0), m.sampleRate ?? 16_000);
      }
      if (m.type === "transcribe-chunk" && this.streamChunkHandler) {
        const id = m.id ?? 0;
        this.streamChunkHandler(id, m.sessionId ?? "", m.pcm ?? new Float32Array(0), m.sampleRate ?? 16_000);
      }
      if (m.type === "stream-finalize" && this.streamFinalizeHandler) {
        const id = m.id ?? 0;
        this.streamFinalizeHandler(id, m.sessionId ?? "");
      }
    }
  }

  terminate() {
    return Promise.resolve();
  }
}

function makeButton() {
  const button = document.createElement("button");
  button.setAttribute("type", "button");
  document.body.appendChild(button);
  return button;
}

/** @type {{ createWorker: () => Worker, wasmPaths: string }} */
const engineOptions = {
  createWorker: () => new FakeWorker("blob:fake", { type: "module" }) as unknown as Worker,
  wasmPaths: "/dictation/ort-wasm/",
};

beforeEach(async () => {
  await disposeEngine();
  FakeWorker.lastInstance = null;
});

afterEach(async () => {
  await disposeEngine();
});

describe("isEditableTarget", () => {
  it("returns true for input and textarea", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    document.body.append(input, textarea);
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
  });

  it("returns true for contenteditable descendants", () => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    child.textContent = "x";
    host.appendChild(child);
    document.body.appendChild(host);
    expect(isEditableTarget(child)).toBe(true);
  });

  it("returns false for non-editable elements", () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(false);
  });
});

describe("createDictationController", () => {
  it("exposes start/stop/toggle/isReady without an engine", () => {
    const controller = createDictationController();
    expect(typeof controller.start).toBe("function");
    expect(typeof controller.stop).toBe("function");
    expect(typeof controller.toggle).toBe("function");
    expect(controller.isReady()).toBe(false);
    controller.dispose();
  });

  it("disables the button before the engine is ready and enables it after", async () => {
    const button = makeButton();
    const controller = createDictationController({ button });
    // Initial state: button is disabled with the loading title.
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/Loading dictation model/);

    await preloadEngine(engineOptions);
    // After preload: button enables and the title flips.
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("title")).toMatch(/Start dictation/);

    controller.dispose();
  });
});

describe("engine state machine", () => {
  it("transitions idle → loading → ready on preload()", async () => {
    const states: string[] = [];
    const unsubscribe = subscribeEngineState((s) => states.push(s));
    await preloadEngine(engineOptions);
    expect(states).toContain("loading");
    expect(states.at(-1)).toBe("ready");
    expect(getEngineState()).toBe("ready");
    unsubscribe();
  });

  it("surfaces worker init errors as engine error state", async () => {
    class BrokenWorker extends FakeWorker {
      postMessage(message: unknown) {
        if (message && typeof message === "object" && (message as { type?: string }).type === "init") {
          queueMicrotask(() => {
            this.emitMessage({ type: "error", id: -1, message: "boom" });
          });
          return;
        }
        super.postMessage(message);
      }
    }
    const errors: string[] = [];
    const unsubscribe = subscribeEngineState((_s, msg) => {
      if (msg) errors.push(msg);
    });
    await expect(
      preloadEngine({
        createWorker: () => new BrokenWorker("blob:fake", { type: "module" }) as unknown as Worker,
      }),
    ).rejects.toThrow(/boom/);
    expect(getEngineState()).toBe("error");
    expect(errors).toContain("boom");
    unsubscribe();
    await disposeEngine();
  });
});

describe("transcribe()", () => {
  it("rejects when the engine is not ready", async () => {
    await expect(transcribePcm(new Float32Array(16000))).rejects.toThrow(/not ready/);
  });

  it("resolves with text from a fake worker result", async () => {
    await preloadEngine(engineOptions);
    const worker = FakeWorker.lastInstance as unknown as FakeWorker;
    worker.transcribeHandler = (id, _pcm, _sr) => {
      queueMicrotask(() => {
        worker.emitMessage({ type: "result", id, text: "hello world" });
      });
    };
    const text = await transcribePcm(new Float32Array(16000), 16_000);
    expect(text).toBe("hello world");
  });

  it("rejects with the worker error message on failure", async () => {
    await preloadEngine(engineOptions);
    const worker = FakeWorker.lastInstance as unknown as FakeWorker;
    worker.transcribeHandler = (id) => {
      queueMicrotask(() => {
        worker.emitMessage({ type: "error", id, message: "decode failed" });
      });
    };
    await expect(transcribePcm(new Float32Array(16000))).rejects.toThrow(/decode failed/);
  });
});

describe("subscribeEngineState", () => {
  it("returns an unsubscribe function and replays the current state", async () => {
    let count = 0;
    let lastState: string | null = null;
    const unsubscribe = subscribeEngineState((s) => {
      count += 1;
      lastState = s;
    });
    // Replay on subscribe.
    expect(count).toBe(1);
    expect(lastState).toBe("idle");
    await preloadEngine(engineOptions);
    expect(count).toBeGreaterThan(1);
    expect(lastState).toBe("ready");
    unsubscribe();
  });

  it("subscribeDictationEngine is a working alias, not an undefined reference", () => {
    // The barrel's `subscribeDictationEngine` re-export was a thin wrapper
    // around `subscribeEngineState`. A prior version forgot to import the
    // target, so the alias threw `ReferenceError: subscribeEngineState is not
    // defined` at runtime — the unit test suite missed it because it only
    // exercised the underlying function directly. This guards the alias.
    let called = 0;
    const unsubscribe = subscribeDictationEngine(() => {
      called += 1;
    });
    // The alias must replay the current state synchronously on subscribe
    // (mirroring subscribeEngineState's contract).
    expect(called).toBe(1);
    expect(typeof unsubscribe).toBe("function");
    unsubscribe();
  });
});

describe("engine session lifecycle", () => {
  it("finalizeStream resolves with empty string for an unknown session", async () => {
    // Defense-in-depth: the controller's silence gate can produce a
    // sessionId for which no chunk was ever forwarded. The engine should
    // resolve finalizeStream with "" instead of bouncing "Unknown
    // streaming session" back to the caller.
    await preloadEngine(engineOptions);
    // `finalizeStream` isn't re-exported from the barrel (it's an internal
    // surface the controller uses), so we go to the source module. The
    // `@ts-ignore` is safe: we only use the function in this one test and
    // don't need a separate .d.ts for it.
    // @ts-ignore - engine.js has no .d.ts companion; type only used here.
    const engineMod: { finalizeStream: (id: string) => Promise<string> } = await import("../engine.js");
    const text = await engineMod.finalizeStream("session-never-chunked");
    expect(text).toBe("");
    const worker = FakeWorker.lastInstance as unknown as FakeWorker;
    const finalizeMessages = (worker.sentMessages as Array<{ type: string }>).filter(
      (m) => m?.type === "stream-finalize",
    );
    expect(finalizeMessages).toHaveLength(0);
  });
});

describe("createDictationController full record→transcribe pipeline", () => {
  // Verifies the end-to-end streaming pipeline: MediaRecorder feeds chunks,
  // the controller decodes each one and pushes it to the worker via
  // streamChunk, on stop the worker finalizes the session, and onText fires
  // with the returned text. The implementation details (a single `chunks`
  // variable, teardown timing) are internal to the controller; what we care
  // about is the observable pipeline behavior.
  it("streams recorded chunks to the worker and emits onText with the final transcript", async () => {
    const text = await runEndToEndPipeline();
    expect(text).toBe("hello world");
  });

  it("skips silence chunks so the engine doesn't transcribe background noise", async () => {
    // The controller's RMS gate (SILENCE_RMS = 0.005) should drop PCM
    // chunks that are all zeros. This prevents two related symptoms from
    // the old MediaRecorder + decodeAudioData path:
    //   1. WebM/Opus encode of silence round-tripped to non-zero PCM
    //      (Opus injects dither noise), causing the engine to "transcribe
    //      nothing" and emit non-empty noise.
    //   2. Per-chunk decode failures on headerless WebM fragments, which
    //      surfaced as "Voice dictation failed: Unable to decode audio
    //      data" within the first 250ms — looking like the engine was
    //      transcribing before the user had spoken.
    let capturedWorker: FakeWorker | null = null;
    const localEngineOptions = {
      createWorker: () => {
        capturedWorker = new FakeWorker("blob:fake", { type: "module" });
        return capturedWorker as unknown as Worker;
      },
      wasmPaths: "/dictation/ort-wasm/",
    };
    await preloadEngine(localEngineOptions);
    // The silence test doesn't install a streamFinalizeHandler, so the
    // controller's `await finalizeStream` would hang. Install a no-op
    // finalize that returns empty text — that's the realistic shape
    // (the engine has nothing to transcribe because the gate dropped
    // the only chunk).
    capturedWorker!.streamFinalizeHandler = (id, sessionId) => {
      queueMicrotask(() => {
        capturedWorker!.emitMessage({ type: "final", id, sessionId, text: "" });
      });
    };
    (navigator as unknown as Record<string, unknown>).mediaDevices = {
      getUserMedia: async () => ({ getTracks: () => [] }),
    } as unknown as MediaDevices;
    const controller = createDictationController();
    await controller.start();
    // Push a chunk of pure silence. The gate should drop it; the worker
    // should never see a `transcribe-chunk` message.
    __pushChunk(new Float32Array(4096));
    await controller.stop();
    // Drain any pending microtasks so silence-drop and stop completion
    // are reflected in sentMessages before the assertion.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const chunkMessages = (capturedWorker!.sentMessages as Array<{ type: string }>).filter(
      (m) => m?.type === "transcribe-chunk",
    );
    expect(chunkMessages).toHaveLength(0);
    // Regression: the controller used to call `finalizeStream` even when
    // no chunks were sent, which made the worker reply with
    // "Unknown streaming session" and surfaced that as
    // "Voice dictation failed: Unknown streaming session: <id>". The fix
    // is to skip the round-trip entirely when no chunks were forwarded.
    const finalizeMessages = (capturedWorker!.sentMessages as Array<{ type: string }>).filter(
      (m) => m?.type === "stream-finalize",
    );
    expect(finalizeMessages).toHaveLength(0);
    controller.dispose();
    await disposeEngine();
  });

  it("captures cursor and textarea value at start(), so the React-controlled re-render can't clobber the splice", async () => {
    // Regression test: when transcribe completes (3-5 seconds after start),
    // the React-controlled <textarea> may have re-rendered with a stale or
    // empty value. The controller must report the cursor + textarea value
    // captured at *start()* time so the caller can splice correctly, instead
    // of re-reading the DOM at completion (which yields the React state, not
    // the user's last edit).
    const { capturedContext, capturedText } = await runEndToEndPipelineWithContext();

    expect(capturedText).toBe("hello world");
    expect(capturedContext).not.toBeNull();
    // At start() the user had "Hello world" with cursor at position 6 (between
    // "Hello " and "world"). The controller must capture that, even if the
    // DOM value is empty by the time the callback fires.
    expect(capturedContext!.value).toBe("Hello world");
    expect(capturedContext!.start).toBe(6);
    expect(capturedContext!.end).toBe(6);
  });
});

/**
 * Like {@link runEndToEndPipeline} but additionally:
 *   - Pre-populates the textarea with "Hello world" and cursor at 6.
 *   - After start() (but before stop's transcribe resolves), the React render
 *     cycle replaces the textarea value with "" (simulating the bug).
 *   - Captures the context the controller hands to `onText` and asserts that
 *     it's the *captured-at-start* value, not the current (stale) DOM value.
 */
async function runEndToEndPipelineWithContext(): Promise<{
  capturedText: string | null;
  capturedContext: { value: string; start: number; end: number } | null;
}> {
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
  const originalMediaDevices = navigator.mediaDevices;

  // Set up a real <textarea> in the JSDOM with the user's pre-existing text.
  const textarea = document.createElement("textarea");
  textarea.value = "Hello world";
  textarea.setSelectionRange(6, 6);
  document.body.appendChild(textarea);
  textarea.focus();

  const pcm = new Float32Array(16_000);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.5;

  let capturedWorker: FakeWorker | null = null;
  const localEngineOptions = {
    createWorker: () => {
      capturedWorker = new FakeWorker("blob:fake", { type: "module" });
      return capturedWorker as unknown as Worker;
    },
    wasmPaths: "/dictation/ort-wasm/",
  };
  await preloadEngine(localEngineOptions);
  // Drive the streaming protocol: each chunk posts a `partial` and a
  // `chunk-result` (resolves streamChunk), then the finalize call posts
  // a `final` (resolves finalizeStream).
  capturedWorker!.streamChunkHandler = (id, sessionId, _p, _sr) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "partial", id, sessionId, text: "hello world" });
      capturedWorker!.emitMessage({ type: "chunk-result", id, sessionId, text: "hello world" });
    });
  };
  capturedWorker!.streamFinalizeHandler = (id, sessionId) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "final", id, sessionId, text: "hello world" });
    });
  };

  class FakeAudioContext {
    state = "running";
    createOscillator(): unknown {
      const self = { type: "sine", frequency: { value: 0 }, connect: () => self, start: () => undefined, stop: () => undefined };
      return self;
    }
    createGain(): unknown {
      const self = { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => self };
      return self;
    }
    get currentTime(): number { return 0; }
    get destination(): unknown { return {}; }
    resume(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { return Promise.resolve(); }
  }
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;

  (navigator as unknown as Record<string, unknown>).mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined, kind: "audio" }] }),
  } as MediaDevices;

  let capturedText: string | null = null;
  let capturedContext: { value: string; start: number; end: number } | null = null;
  const controller = createDictationController({
    input: () => textarea,
    callbacks: {
      onText: (text, context) => {
        capturedText = text;
        capturedContext = context;
      },
    },
  });
  await controller.start();
  // Simulate two captured PCM chunks being pushed to the controller, as
  // though the AudioWorklet had been emitting 4096-frame buffers at 16 kHz.
  __pushChunk(pcm);
  __pushChunk(pcm);
  // Wait for the controller to flush both chunks into sentMessages.
  // processChunk is async (chained through processingLock), so the
  // worker.postMessage for each chunk fires on a future microtask.
  for (let i = 0; i < 50; i += 1) {
    const count = (capturedWorker!.sentMessages as Array<{ type: string }>).filter(
      (m) => m?.type === "transcribe-chunk",
    ).length;
    if (count >= 2) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  // Simulate the React-controlled re-render clearing the textarea value
  // before the transcribe result arrives.
  textarea.value = "";
  textarea.setSelectionRange(0, 0);

  // Verify the controller actually forwarded the chunks to the worker
  // (the silence gate in controller.js would otherwise silently drop them
  // and the rest of the test would still pass — a regression test for
  // the gate being too aggressive).
  const chunkMessages = (capturedWorker!.sentMessages as Array<{ type: string; pcm?: Float32Array }>).filter(
    (m) => m?.type === "transcribe-chunk",
  );
  expect(chunkMessages).toHaveLength(2);
  expect(chunkMessages[0].pcm?.length).toBe(16_000);
  // Sine wave at 0.5 amplitude: the second sample of the chunk is near
  // 0.086 (sin(2π·440·1/16000)·0.5 ≈ sin(0.1728)·0.5 ≈ 0.0860).
  expect(chunkMessages[0].pcm?.[1]).toBeCloseTo(0.086, 2);

  await controller.stop();

  await controller.stop();

  // Wait for the async transcribe.
  for (let i = 0; i < 50 && capturedText === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  (navigator as unknown as Record<string, unknown>).mediaDevices = originalMediaDevices;
  controller.dispose();
  await disposeEngine();

  return { capturedText, capturedContext };
}

/**
 * Spins up a controller with fakes for `getUserMedia`, `AudioContext`, and
 * the dictation engine. The audio-capture module is mocked at the top of
 * the file so the controller sees a synthetic onChunk callback instead of
 * a real AudioWorklet. Returns the text the controller would have
 * inserted into the input.
 */
async function runEndToEndPipeline(): Promise<string | null> {
  // Build a 1-second Float32Array as the synthetic PCM.
  const pcm = new Float32Array(16_000);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.1;

  // Save and restore globals we monkey-patch.
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
  const originalMediaDevices = navigator.mediaDevices;

  // Preload the engine so the controller sees a ready engine when start() fires.
  // Use a closure that captures the FakeWorker instance so we can install a
  // transcribe handler on it later.
  let capturedWorker: FakeWorker | null = null;
  const localEngineOptions = {
    createWorker: () => {
      capturedWorker = new FakeWorker("blob:fake", { type: "module" });
      return capturedWorker as unknown as Worker;
    },
    wasmPaths: "/dictation/ort-wasm/",
  };
  await preloadEngine(localEngineOptions);
  capturedWorker!.streamChunkHandler = (id, sessionId) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "partial", id, sessionId, text: "hello world" });
      capturedWorker!.emitMessage({ type: "chunk-result", id, sessionId, text: "hello world" });
    });
  };
  capturedWorker!.streamFinalizeHandler = (id, sessionId) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "final", id, sessionId, text: "hello world" });
    });
  };

  class FakeAudioContext {
    state = "running";
    createOscillator(): {
      type: string;
      frequency: { value: number };
      connect: (n: unknown) => unknown;
      start: (t: number) => void;
      stop: (t: number) => void;
    } {
      const self = {
        type: "sine",
        frequency: { value: 0 },
        connect: (_n: unknown) => self,
        start: (_t: number) => undefined,
        stop: (_t: number) => undefined,
      };
      return self;
    }
    createGain(): {
      gain: {
        setValueAtTime: (v: number, t: number) => void;
        exponentialRampToValueAtTime: (v: number, t: number) => void;
      };
      connect: (n: unknown) => unknown;
    } {
      const self = {
        gain: {
          setValueAtTime: (_v: number, _t: number) => undefined,
          exponentialRampToValueAtTime: (_v: number, _t: number) => undefined,
        },
        connect: (_n: unknown) => self,
      };
      return self;
    }
    get currentTime(): number { return 0; }
    get destination(): unknown { return {}; }
    resume(): Promise<void> { return Promise.resolve(); }
    close(): Promise<void> { return Promise.resolve(); }
  }
  (globalThis as Record<string, unknown>).AudioContext = FakeAudioContext;

  (navigator as unknown as Record<string, unknown>).mediaDevices = {
    getUserMedia: async () => {
      return {
        getTracks: () => [{ stop: () => undefined, kind: "audio" }],
      } as unknown as MediaStream;
    },
  } as MediaDevices;

  // Capture the text the controller would have inserted.
  let captured: string | null = null;
  const controller = createDictationController({
    callbacks: { onText: (t) => (captured = t) },
  });
  await controller.start();
  expect(captureStarted).toBe(true);
  expect(controller.isRecording()).toBe(true);
  // Push two PCM chunks as if the AudioWorklet had produced them.
  __pushChunk(pcm);
  __pushChunk(pcm);
  await controller.stop();
  for (let i = 0; i < 50 && captured === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // Restore globals.
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  (navigator as unknown as Record<string, unknown>).mediaDevices = originalMediaDevices;
  controller.dispose();
  await disposeEngine();

  return captured;
}

// Reference `vi` so the import isn't flagged as unused if a future test
// needs to add spies.
vi.fn();
