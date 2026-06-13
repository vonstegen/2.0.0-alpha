// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDictationController,
  dispose as disposeEngine,
  getEngineKind,
  getEngineState,
  isEditableTarget,
  preload as preloadEngine,
  subscribeDictationEngine,
  subscribeEngineState,
  transcribe as transcribePcm,
} from "../index.js";

type WorkerListener = (event: { data: unknown }) => void;

class FakeWorker {
  static lastInstance: FakeWorker | null = null;
  url: string;
  options: { type?: string };
  private messageListeners: WorkerListener[] = [];
  private errorListeners: WorkerListener[] = [];
  sentMessages: unknown[] = [];
  ready = false;
  /** Override to make `transcribe` return text. */
  transcribeHandler: ((id: number, pcm: Float32Array, sampleRate: number) => void) | null = null;

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

  emitMessage(data: unknown) {
    for (const listener of [...this.messageListeners]) {
      listener({ data });
    }
  }

  postMessage(message: unknown) {
    this.sentMessages.push(message);
    if (message && typeof message === "object" && "type" in message) {
      const m = message as { type: string; id?: number; pcm?: Float32Array; sampleRate?: number };
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

describe("engine dispatch", () => {
  it("defaults to parakeet when no kind is specified", async () => {
    await preloadEngine(engineOptions);
    expect(getEngineKind()).toBe("parakeet");
  });

  it("records the requested kind in getEngineKind()", async () => {
    await preloadEngine({ ...engineOptions, kind: "parakeet" });
    expect(getEngineKind()).toBe("parakeet");
  });

  it("rejects with a clear error when kind is anything other than 'parakeet'", async () => {
    // Whisper fallback was attempted in WIP commits 641d3bb and 5fd50a3.
    // The q8 export had a decoder quant-scale incompatibility; the
    // fp16 export hung silently. Same shape as the parakeet int4/int8
    // failures earlier. Stage 2 was reverted; the dispatcher exists
    // but only 'parakeet' is implemented. The Settings UI (Stage 4)
    // is now a "future" task and shouldn't offer Whisper selection.
    await expect(
      preloadEngine({ ...engineOptions, kind: "whisper" }),
    ).rejects.toThrow(/not implemented/i);
  });

  it("resets the kind on dispose so the next preload starts clean", async () => {
    await preloadEngine({ ...engineOptions, kind: "parakeet" });
    expect(getEngineKind()).toBe("parakeet");
    await disposeEngine();
    expect(getEngineKind()).toBe("parakeet");
    // (Reset to the default initial state. beforeEach re-preloads.)
    expect(getEngineState()).toBe("idle");
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

/**
 * Spins up a controller with fakes for `getUserMedia`, `MediaRecorder`,
 * `AudioContext`, and the dictation engine. The FakeMediaRecorder's
 * `ondataavailable` is driven via a closure captured at construction
 * time. Returns the text the controller would have inserted into the
 * input.
 */
async function runEndToEndPipeline(): Promise<string | null> {
  // Build a 1-second Float32Array that AudioContext.decodeAudioData will
  // hand back when the controller asks for the recording as PCM.
  const pcm = new Float32Array(16_000);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.1;

  const originalMediaRecorder = (globalThis as Record<string, unknown>).MediaRecorder;
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
  const originalMediaDevices = navigator.mediaDevices;

  let capturedWorker: FakeWorker | null = null;
  const localEngineOptions = {
    createWorker: () => {
      capturedWorker = new FakeWorker("blob:fake", { type: "module" });
      return capturedWorker as unknown as Worker;
    },
    wasmPaths: "/dictation/ort-wasm/",
  };
  await preloadEngine(localEngineOptions);
  capturedWorker!.transcribeHandler = (id) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "result", id, text: "hello world" });
    });
  };

  class FakeMediaRecorder {
    static isTypeSupported(_t: string) { return true; }
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    state: "inactive" | "recording" = "inactive";
    addEventListener(type: "stop" | "dataavailable" | "error", listener: (e: unknown) => void) {
      if (type === "stop") this.onstop = listener as () => void;
      if (type === "dataavailable") this.ondataavailable = listener as (e: { data: Blob }) => void;
      if (type === "error") this.onerror = listener as (e: unknown) => void;
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      // Mirror real MediaRecorder: emit the accumulated blob on dataavailable
      // (only on stop, not before), then fire onstop.
      const blob = new Blob([new Uint8Array(8192)], { type: "audio/webm;codecs=opus" });
      this.ondataavailable?.({ data: blob });
      queueMicrotask(() => this.onstop?.());
    }
    constructor(_stream: MediaStream) {}
  }
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;

  class FakeAudioContext {
    state = "running";
    decodeAudioData(_buf: ArrayBuffer): Promise<{ numberOfChannels: number; length: number; getChannelData: (ch: number) => Float32Array }> {
      return Promise.resolve({
        numberOfChannels: 1,
        length: pcm.length,
        getChannelData: (_ch: number) => pcm,
      });
    }
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

  let captured: string | null = null;
  const controller = createDictationController({
    callbacks: { onText: (t) => (captured = t) },
  });
  await controller.start();
  expect(controller.isRecording()).toBe(true);
  await controller.stop();
  for (let i = 0; i < 50 && captured === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  (globalThis as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  (navigator as unknown as Record<string, unknown>).mediaDevices = originalMediaDevices;
  controller.dispose();
  await disposeEngine();

  return captured;
}

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
  const originalMediaRecorder = (globalThis as Record<string, unknown>).MediaRecorder;
  const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
  const originalMediaDevices = navigator.mediaDevices;

  // Set up a real <textarea> in the JSDOM with the user's pre-existing text.
  const textarea = document.createElement("textarea");
  textarea.value = "Hello world";
  textarea.setSelectionRange(6, 6);
  document.body.appendChild(textarea);
  textarea.focus();

  const pcm = new Float32Array(16_000);

  let capturedWorker: FakeWorker | null = null;
  const localEngineOptions = {
    createWorker: () => {
      capturedWorker = new FakeWorker("blob:fake", { type: "module" });
      return capturedWorker as unknown as Worker;
    },
    wasmPaths: "/dictation/ort-wasm/",
  };
  await preloadEngine(localEngineOptions);
  capturedWorker!.transcribeHandler = (id) => {
    queueMicrotask(() => {
      capturedWorker!.emitMessage({ type: "result", id, text: "hello world" });
    });
  };

  class FakeMediaRecorder {
    static isTypeSupported(_t: string) { return true; }
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    state: "inactive" | "recording" = "inactive";
    addEventListener(type: "stop" | "dataavailable" | "error", listener: (e: unknown) => void) {
      if (type === "stop") this.onstop = listener as () => void;
      if (type === "dataavailable") this.ondataavailable = listener as (e: { data: Blob }) => void;
      if (type === "error") this.onerror = listener as (e: unknown) => void;
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      const blob = new Blob([new Uint8Array(8192)], { type: "audio/webm;codecs=opus" });
      this.ondataavailable?.({ data: blob });
      queueMicrotask(() => this.onstop?.());
    }
    constructor(_stream: MediaStream) {}
  }
  (globalThis as Record<string, unknown>).MediaRecorder = FakeMediaRecorder;

  class FakeAudioContext {
    state = "running";
    decodeAudioData(): Promise<{ numberOfChannels: number; length: number; getChannelData: () => Float32Array }> {
      return Promise.resolve({ numberOfChannels: 1, length: pcm.length, getChannelData: () => pcm });
    }
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

  // Simulate the React-controlled re-render clearing the textarea value
  // before the transcribe result arrives.
  textarea.value = "";
  textarea.setSelectionRange(0, 0);

  await controller.stop();

  // Wait for the async transcribe.
  for (let i = 0; i < 50 && capturedText === null; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  (globalThis as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
  (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
  (navigator as unknown as Record<string, unknown>).mediaDevices = originalMediaDevices;
  controller.dispose();
  await disposeEngine();

  return { capturedText, capturedContext };
}

describe("createDictationController full record→transcribe pipeline", () => {
  it("streams the recorded blob through transcribe and emits onText with the final transcript", async () => {
    const text = await runEndToEndPipeline();
    expect(text).toBe("hello world");
  });

  it("does not call onText when no audio data was captured", async () => {
    // Regression: a media recorder that fires `onstop` without
    // `ondataavailable` (which can happen if the user denies mic access
    // mid-session or the device disconnects) must not produce a
    // bogus onText call with empty text.
    const originalMediaRecorder = (globalThis as Record<string, unknown>).MediaRecorder;
    const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
    const originalMediaDevices = navigator.mediaDevices;

    class EmptyMediaRecorder {
      static isTypeSupported(_t: string) { return true; }
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      state: "inactive" | "recording" = "inactive";
      addEventListener(type: "stop" | "dataavailable", listener: (e: unknown) => void) {
        if (type === "stop") this.onstop = listener as () => void;
        if (type === "dataavailable") this.ondataavailable = listener as (e: { data: Blob }) => void;
      }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        // No dataavailable emission before onstop — empty recording.
        queueMicrotask(() => this.onstop?.());
      }
      constructor(_stream: MediaStream) {}
    }
    (globalThis as Record<string, unknown>).MediaRecorder = EmptyMediaRecorder;
    class SilentAudioContext {
      state = "running";
      createOscillator() { return { type: "sine", frequency: { value: 0 }, connect: () => this, start: () => undefined, stop: () => undefined }; }
      createGain() { return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: () => this }; }
      get currentTime() { return 0; }
      get destination() { return {}; }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    (globalThis as Record<string, unknown>).AudioContext = SilentAudioContext as unknown as typeof AudioContext;
    (navigator as unknown as Record<string, unknown>).mediaDevices = {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined, kind: "audio" }] }),
    } as unknown as MediaDevices;

    let capturedWorker: FakeWorker | null = null;
    await preloadEngine({
      createWorker: () => {
        capturedWorker = new FakeWorker("blob:fake", { type: "module" });
        return capturedWorker as unknown as Worker;
      },
      wasmPaths: "/dictation/ort-wasm/",
    });
    let onTextCalls = 0;
    const controller = createDictationController({
      callbacks: { onText: () => (onTextCalls += 1) },
    });
    await controller.start();
    await controller.stop();
    // The stop sequence awaits the recorder's `stop` event, then a
    // microtask for the worker, so yield a few ticks.
    for (let i = 0; i < 20; i += 1) {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
    }
    expect(onTextCalls).toBe(0);
    // Worker should never have seen a transcribe message either.
    const transcribeMessages = (capturedWorker!.sentMessages as Array<{ type: string }>).filter(
      (m) => m?.type === "transcribe",
    );
    expect(transcribeMessages).toHaveLength(0);

    (globalThis as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
    (navigator as unknown as Record<string, unknown>).mediaDevices = originalMediaDevices;
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

// Reference `vi` so the import isn't flagged as unused if a future test
// needs to add spies.
vi.fn();
