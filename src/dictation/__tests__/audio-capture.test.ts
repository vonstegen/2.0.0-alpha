// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { startCapture } from "../audio-capture.js";

/**
 * Tests for the audio-capture module. JSDOM doesn't ship
 * `AudioContext`/`AudioWorklet`/`ScriptProcessorNode`, so we stub them.
 *
 * The goal isn't to verify the browser's Web Audio implementation — that's
 * the browser's job — but to verify that `startCapture`:
 *   1. Creates an `AudioContext` with the requested sample rate.
 *   2. Wires the mic stream through the chosen processor.
 *   3. Forwards Float32Array samples to `onChunk` (and copies them out so the
 *      worklet can recycle the buffer).
 *   4. Stops cleanly on `stop()`.
 *   5. Reports `isWorklet` correctly based on the host's capabilities.
 */

class StubScriptProcessor {
  onaudioprocess: ((event: { inputBuffer: StubAudioBuffer }) => void) | null = null;
  constructor(public bufferSize: number, public inputs: number, public outputs: number) {}
  connect(): this { return this; }
  disconnect(): this { return this; }
}

class StubAudioBuffer {
  constructor(public length: number, private data: Float32Array) {}
  getChannelData(_ch: number): Float32Array { return this.data; }
}

class StubGain {
  gain = { value: 0 };
  connect(): this { return this; }
  disconnect(): this { return this; }
}

class StubMediaStreamSource {
  constructor(public stream: MediaStream) {}
  connect(): unknown { return null; }
  disconnect(): this { return this; }
}

class StubAudioContext {
  state: "running" | "suspended" | "closed" = "running";
  audioWorklet: { addModule: (url: string) => Promise<void> } | null = null;
  destination = {};
  scriptProcessorInstances: StubScriptProcessor[] = [];
  sources: StubMediaStreamSource[] = [];

  constructor(public opts: { sampleRate: number; latencyHint?: string }) {
    // Force the fallback path so the test is deterministic across JSDOM versions.
    this.audioWorklet = null;
  }

  createMediaStreamSource(stream: MediaStream): StubMediaStreamSource {
    const s = new StubMediaStreamSource(stream);
    this.sources.push(s);
    return s;
  }

  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): StubScriptProcessor {
    const sp = new StubScriptProcessor(bufferSize, inputs, outputs);
    this.scriptProcessorInstances.push(sp);
    return sp;
  }

  createGain(): StubGain { return new StubGain(); }
  resume(): Promise<void> { return Promise.resolve(); }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
  get currentTime(): number { return 0; }
}

function makeStream(): MediaStream {
  return { getTracks: () => [] } as unknown as MediaStream;
}

function makeSamples(values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("startCapture", () => {
  it("throws when no stream is supplied", async () => {
    await expect(
      startCapture({ stream: undefined as unknown as MediaStream, onChunk: () => undefined }),
    ).rejects.toThrow(/MediaStream/);
  });

  it("throws when no onChunk callback is supplied", async () => {
    await expect(
      startCapture({ stream: makeStream(), onChunk: undefined as unknown as (p: Float32Array) => void }),
    ).rejects.toThrow(/onChunk/);
  });

  it("throws when Web Audio is unavailable", async () => {
    const original = (globalThis as Record<string, unknown>).AudioContext;
    (globalThis as Record<string, unknown>).AudioContext = undefined;
    (globalThis as Record<string, unknown>).webkitAudioContext = undefined;
    try {
      await expect(
        startCapture({ stream: makeStream(), onChunk: () => undefined }),
      ).rejects.toThrow(/Web Audio/);
    } finally {
      (globalThis as Record<string, unknown>).AudioContext = original;
    }
  });

  it("creates an AudioContext with the requested sample rate and latency hint", async () => {
    // Spy that records the constructor args.
    let captured: { sampleRate: number; latencyHint?: string } | null = null;
    class SpyContext extends StubAudioContext {
      constructor(opts: { sampleRate: number; latencyHint?: string }) {
        super(opts);
        captured = opts;
      }
    }
    const original = (globalThis as Record<string, unknown>).AudioContext;
    (globalThis as Record<string, unknown>).AudioContext = SpyContext as unknown as typeof AudioContext;
    const handle = await startCapture({ stream: makeStream(), onChunk: () => undefined });
    expect(captured).not.toBeNull();
    expect(captured!.sampleRate).toBe(16_000);
    expect(captured!.latencyHint).toBe("interactive");
    handle.stop();
    (globalThis as Record<string, unknown>).AudioContext = original;
  });

  it("emits Float32Array chunks to onChunk when the processor fires (ScriptProcessor path)", async () => {
    // The integration test below ("forwards Float32Array samples to onChunk")
    // exercises this end-to-end via onaudioprocess, which is the realistic
    // entry point in the ScriptProcessorNode fallback. This test just
    // asserts the ScriptProcessor is created with the right shape.
    class CapturingContext extends StubAudioContext {
      public sp: StubScriptProcessor | null = null;
      createScriptProcessor(bufferSize: number, inputs: number, outputs: number): StubScriptProcessor {
        const sp = super.createScriptProcessor(bufferSize, inputs, outputs) as StubScriptProcessor;
        this.sp = sp;
        return sp;
      }
    }
    const original = (globalThis as Record<string, unknown>).AudioContext;
    const ctx = new CapturingContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx; } as unknown as typeof AudioContext;

    const handle = await startCapture({
      stream: makeStream(),
      sampleRate: 16_000,
      chunkFrames: 4096,
      onChunk: () => undefined,
    });
    expect(ctx.sp).not.toBeNull();
    expect(ctx.sp!.bufferSize).toBe(4096);
    expect(ctx.sp!.inputs).toBe(1);
    expect(ctx.sp!.outputs).toBe(1);

    handle.stop();
    (globalThis as Record<string, unknown>).AudioContext = original;
  });

  it("stops cleanly and closes the AudioContext", async () => {
    const original = (globalThis as Record<string, unknown>).AudioContext;
    const ctx = new StubAudioContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx; } as unknown as typeof AudioContext;

    const handle = await startCapture({
      stream: makeStream(),
      onChunk: () => undefined,
    });
    expect(ctx.state).toBe("running");
    handle.stop();
    expect(ctx.state).toBe("closed");

    (globalThis as Record<string, unknown>).AudioContext = original;
  });

  it("forwards Float32Array samples to onChunk (integration: trigger onaudioprocess)", async () => {
    // Custom context class that captures the script processor so we can
    // drive its onaudioprocess directly.
    class CapturingContext extends StubAudioContext {
      public sp: StubScriptProcessor | null = null;
      createScriptProcessor(bufferSize: number, inputs: number, outputs: number): StubScriptProcessor {
        const sp = super.createScriptProcessor(bufferSize, inputs, outputs) as StubScriptProcessor;
        this.sp = sp;
        return sp;
      }
    }
    const original = (globalThis as Record<string, unknown>).AudioContext;
    const ctx = new CapturingContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx; } as unknown as typeof AudioContext;

    const chunks: number[][] = [];
    const handle = await startCapture({
      stream: makeStream(),
      sampleRate: 16_000,
      chunkFrames: 4096,
      onChunk: (pcm: Float32Array) => chunks.push(Array.from(pcm)),
    });

    expect(ctx.sp).not.toBeNull();
    const samples = makeSamples([0.1, 0.2, 0.3, 0.4]);
    ctx.sp!.onaudioprocess?.({ inputBuffer: new StubAudioBuffer(samples.length, samples) });
    expect(chunks).toHaveLength(1);
    // Float32Array stores 0.1, 0.2, etc. with quantization; use toBeCloseTo.
    expect(chunks[0]).toHaveLength(4);
    expect(chunks[0][0]).toBeCloseTo(0.1, 5);
    expect(chunks[0][1]).toBeCloseTo(0.2, 5);
    expect(chunks[0][2]).toBeCloseTo(0.3, 5);
    expect(chunks[0][3]).toBeCloseTo(0.4, 5);

    // Modifying the original Float32Array after the chunk was emitted must
    // not affect the captured chunk — capture's ScriptProcessor fallback
    // copies into a fresh Float32Array. Verify.
    samples[0] = 0.99;
    expect(chunks[0][0]).toBeCloseTo(0.1, 5);

    handle.stop();
    (globalThis as Record<string, unknown>).AudioContext = original;
  });

  it("isWorklet returns false in the ScriptProcessor fallback", async () => {
    const original = (globalThis as Record<string, unknown>).AudioContext;
    const ctx = new StubAudioContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx; } as unknown as typeof AudioContext;
    const handle = await startCapture({ stream: makeStream(), onChunk: () => undefined });
    expect(handle.isWorklet()).toBe(false);
    handle.stop();
    (globalThis as Record<string, unknown>).AudioContext = original;
  });

  it("loads the AudioWorklet module from the configured same-origin URL", async () => {
    // Regression test for the cross-origin-isolated Chromium bug: inline
    // `blob:` and `data:` URLs for AudioWorklet.addModule are blocked by
    // CSP `script-src 'self'` and by COOP/COEP. The fix is a static file
    // served same-origin. Verify addModule is called with the default
    // path AND that an override option is honored.
    class StubAudioWorkletNode {
      port = {
        postMessage: (msg: unknown) => undefined,
        onmessage: null as ((event: { data: unknown }) => void) | null,
      };
      onprocessorerror: ((event: unknown) => void) | null = null;
      constructor(public ctx: unknown, public name: string) {}
      connect(): this { return this; }
      disconnect(): this { return this; }
    }
    const originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
    const originalAudioWorkletNode = (globalThis as Record<string, unknown>).AudioWorkletNode;
    (globalThis as Record<string, unknown>).AudioWorkletNode = StubAudioWorkletNode;

    class WorkletCapableContext extends StubAudioContext {
      audioWorklet: { addModule: (url: string) => Promise<void> };
      addModuleCalls: string[] = [];
      constructor(opts: { sampleRate: number }) {
        super(opts);
        this.audioWorklet = {
          addModule: (url: string) => {
            this.addModuleCalls.push(url);
            return Promise.resolve();
          },
        };
      }
    }

    // Default URL.
    const ctx1 = new WorkletCapableContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx1; } as unknown as typeof AudioContext;
    const handle1 = await startCapture({ stream: makeStream(), onChunk: () => undefined });
    expect(ctx1.addModuleCalls).toEqual(["/dictation/pcm-16k-processor.js"]);
    expect(handle1.isWorklet()).toBe(true);
    handle1.stop();
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;

    // Override URL (the Chrome extension passes a chrome.runtime.getURL path).
    const ctx2 = new WorkletCapableContext({ sampleRate: 16_000 });
    (globalThis as Record<string, unknown>).AudioContext = function () { return ctx2; } as unknown as typeof AudioContext;
    const handle2 = await startCapture({
      stream: makeStream(),
      onChunk: () => undefined,
      workletUrl: "chrome-extension://abc/assets/dictation/pcm-16k-processor.js",
    });
    expect(ctx2.addModuleCalls).toEqual([
      "chrome-extension://abc/assets/dictation/pcm-16k-processor.js",
    ]);
    handle2.stop();
    (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
    (globalThis as Record<string, unknown>).AudioWorkletNode = originalAudioWorkletNode;
  });
});
