# Whisper Dictation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Whisper as the primary dictation engine in the browser (with WebGPU auto-detect, multilingual support, and per-utterance language/task control), with Parakeet as a manual fallback selectable from Settings.

**Architecture:** Whisper loads via `@huggingface/transformers` `pipeline()` in `worker-whisper.js` using the reference stack (`onnx-community/whisper-base_timestamped`, per-device dtype: `q8` for WASM, `{encoder:fp32, decoder:q4}` for WebGPU). Parakeet remains the existing fallback. The `engine` module supports `engineSelection: "auto"|"whisper"|"parakeet"` with init-time fallback (Auto → Whisper fails → Parakeet). Settings persists `dictation.engineSelection`, `dictation.language`, `dictation.task` on `ResonantShellState`; `language` and `task` are re-read per-utterance so changes take effect without a worker reload.

**Tech Stack:** TypeScript + React (app shell), plain JS with JSDoc (dictation module), `@huggingface/transformers@3.8.1`, `onnxruntime-web` (transitive), Vite dev server with COOP/COEP headers already set, vitest for unit tests.

---

## File Structure

**Modified:**
- `src/dictation/types.js` — extend `EngineOptions` typedef; add `DictationSettings` typedef.
- `src/dictation/index.d.ts` — TypeScript mirror of the above; update `createWorker` signature.
- `src/dictation/engine.js` — accept `engineSelection`; accept `createWorker(kind)`; implement Auto fallback; emit `notice` event; capture `device` from worker's `ready` message; expose `getEngineDevice()`.
- `src/dictation/controller.js` — accept `language`/`task` getters; pass them per-utterance; accept `engineSelection` and pass through.
- `src/dictation/worker-whisper.js` — model swap (`whisper-base` → `whisper-base_timestamped`); v3 API fix (`quantized:` → `dtype:`); per-device dtype config; pass `device` to `pipeline()`; report `device` in `ready` message; accept `language`/`task` in transcribe and conditionally spread `language` (omit when `"auto"`).
- `src/dictation/worker.js` — accept (and ignore) `language`/`task` fields in transcribe message; no other changes.
- `src/dictation/__tests__/controller.test.ts` — update `createWorker` to take kind; flip the "rejects when kind=whisper" test to "succeeds when engineSelection=whisper"; add new tests per spec.
- `src/core/contracts.ts` — add `DictationSettings` interface; add `dictation: DictationSettings` to `ResonantShellState`.
- `src/App.tsx` — read `state.dictation.*`; pass to `preloadDictationEngine`; remove `?engine=whisper` URL affordance; pass `language`/`task` getters.
- `src/modules/settings/SettingsWorkspace.tsx` — new **Dictation** section.

**Created:**
- (none — `worker-whisper.js` already exists; we modify it.)

**Deleted:**
- `scripts/whisper-quants.mjs`
- `scripts/whisper-quants.log`

---

## Task 1: Extend dictation type definitions

**Files:**
- Modify: `src/dictation/types.js`
- Modify: `src/dictation/index.d.ts`

- [ ] **Step 1: Read current `src/dictation/types.js`** to see existing typedefs.

Run: `cat src/dictation/types.js`
Expected: file exists, contains `@typedef {..."parakeet" | "whisper"} DictationEngineKind`.

- [ ] **Step 2: Add `DictationSettings` and update `EngineOptions` in `src/dictation/types.js`**

Find the existing `EngineOptions`-related typedefs (or add new ones after the `DictationEngineKind` typedef) and append:

```js
/**
 * @typedef {"auto" | "whisper" | "parakeet"} DictationEngineSelection
 *   `"auto"` tries Whisper at preload and falls back to Parakeet if Whisper
 *   init fails or times out (60s). `"whisper"` and `"parakeet"` force one
 *   engine with no fallback.
 */

/**
 * @typedef {Object} DictationSettings
 * @property {DictationEngineSelection} [engineSelection="auto"]
 * @property {string} [language="auto"] Whisper language code or `"auto"` for
 *   auto-detect. Ignored by Parakeet (English-only model).
 * @property {"transcribe" | "translate"} [task="transcribe"] Whisper task.
 *   Ignored by Parakeet.
 */

/**
 * @typedef {Object} EngineOptions
 * @property {(kind: DictationEngineKind) => Worker} createWorker Returns a
 *   fresh module Web Worker for the requested engine kind. The factory is
 *   called once at preload; Auto mode calls it a second time with
 *   `"parakeet"` if Whisper init fails.
 * @property {DictationEngineSelection} [engineSelection="auto"] Engine
 *   selection mode. Replaces the older `kind` field.
 * @property {() => DictationSettings} [getDictationSettings] Returns the
 *   current settings snapshot. Called at each `transcribe` to pick up
 *   `language`/`task` changes without an engine reload.
 * @property {string | null} [wasmPaths] Optional path to onnxruntime-web
 *   WASM blobs.
 * @property {"webgpu-hybrid" | "webgpu-strict" | "wasm"} [backend] Preferred
 *   execution backend for Parakeet. Ignored by Whisper (Whisper auto-detects
 *   WebGPU at the worker level).
 * @property {boolean} [streaming] Reserved for future use.
 */
```

If a previous `EngineOptions` typedef exists with the old `kind` field, replace it entirely with the above.

- [ ] **Step 3: Update `src/dictation/index.d.ts` to mirror the new types**

Replace the `EngineOptions` interface (lines ~8-24 in the file) and add the new types just above it:

```ts
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
}
```

Also update the `preload` signature near the bottom:

```ts
export function preload(options: EngineOptions): Promise<void>;
```

(No change to the signature text itself — just confirm it's still there.)

And add `getEngineDevice`:

```ts
export function getEngineDevice(): "webgpu" | "wasm" | null;
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/dictation/`. (Errors elsewhere in `src/App.tsx` or `src/dictation/engine.js` are expected at this point — they'll be fixed in later tasks. Note them but don't block.)

- [ ] **Step 5: Commit**

```bash
git add src/dictation/types.js src/dictation/index.d.ts
git commit -m "feat(dictation): extend types for engineSelection, language, task"
```

---

## Task 2: Add `DictationSettings` to `ResonantShellState`

**Files:**
- Modify: `src/core/contracts.ts:2860` (after `UiPreferences`)
- Modify: `src/core/contracts.ts:2895` (`ResonantShellState`)

- [ ] **Step 1: Add `DictationSettings` interface after `UiPreferences` (after line 2876)**

Insert immediately after the closing brace of `UiPreferences`:

```ts
export interface DictationSettings {
  /** Engine selection mode. Default "auto". */
  engineSelection: "auto" | "whisper" | "parakeet";
  /** Whisper language code or "auto" for auto-detect. Default "auto". Ignored by Parakeet. */
  language: string;
  /** Whisper task. Default "transcribe". Ignored by Parakeet. */
  task: "transcribe" | "translate";
}
```

- [ ] **Step 2: Add `dictation` to `ResonantShellState` (line ~2915)**

Add a new field after `distributionModel` (line 2916):

```ts
export interface ResonantShellState {
  strategistIdentity: StrategistIdentity;
  // ...existing fields unchanged...
  distributionModel: "curated-plus-sideload";
  dictation: DictationSettings;
}
```

Note: making `dictation` required (not optional) forces all state constructors to provide it. Step 3 finds the constructors and adds the default.

- [ ] **Step 3: Find and update all `ResonantShellState` constructors**

Run: `grep -rn "ResonantShellState = {" src/ | head -20`

For each constructor found, add (or merge in) the `dictation` field with the default:

```ts
dictation: {
  engineSelection: "auto",
  language: "auto",
  task: "transcribe",
},
```

If a constructor spreads an existing object (e.g. `...partialState`), make sure the default `dictation` is set after the spread or use a separate defaulting helper. The goal: every `ResonantShellState` value produced by the app has a populated `dictation` field.

- [ ] **Step 4: Find state-load paths and default missing `dictation`**

Run: `grep -rn "JSON.parse.*ResonantShellState\|loadState\|readState\|parseState" src/ | head -10`

For any path that loads `ResonantShellState` from disk/localStorage and might encounter old snapshots without `dictation`, add a defaulting merge after the parse:

```ts
const loaded = JSON.parse(raw) as ResonantShellState;
// Backward compat: pre-Whisper snapshots don't have dictation.
if (!loaded.dictation) {
  loaded.dictation = { engineSelection: "auto", language: "auto", task: "transcribe" };
}
```

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. Errors in `src/dictation/engine.js`, `src/dictation/controller.js`, `src/App.tsx` are still expected (they're addressed in later tasks).

- [ ] **Step 6: Commit**

```bash
git add src/core/contracts.ts src/core/*.ts
git commit -m "feat(state): add DictationSettings to ResonantShellState"
```

---

## Task 3: Fix `worker-whisper.js` — model swap, dtype API, per-device dtype, language/task

**Files:**
- Modify: `src/dictation/worker-whisper.js`

This task is not TDD-able without mocking the transformers.js `pipeline()` function, which would require a heavy test harness. The behavior is verified manually in the browser in Task 10. The code changes are mechanical and reviewable.

- [ ] **Step 1: Replace the `init` branch's pipeline call**

In `src/dictation/worker-whisper.js`, find the `init` handler (currently lines ~44-86). Replace the inner block that calls `pipeline()` with:

```js
if (data.type === "init") {
  try {
    transformersEnv.allowLocalModels = false;
    transformersEnv.useFs = false;

    // Per-device dtype config matching the whisper-word-timestamps reference:
    //   WebGPU -> { encoder_model: "fp32", decoder_model_merged: "q4" }
    //   WASM    -> "q8"
    // WebGPU auto-detect at the worker level — the user enables WebGPU at
    // the browser level (chrome://flags/#enable-unsafe-webgpu on Linux, or
    // stable Chrome with a discrete GPU). No manual WebGPU toggle in
    // Settings.
    const hasWebGPU =
      typeof navigator !== "undefined" && "gpu" in navigator
      && (await navigator.gpu.requestAdapter().catch(() => null)) != null;
    const device = hasWebGPU ? "webgpu" : "wasm";
    const defaultDtype = hasWebGPU
      ? { encoder_model: "fp32", decoder_model_merged: "q4" }
      : "q8";

    // v3 API: dtype (not quantized — that was v2). The `data.dtype` override
    // is a debug knob; the default is per-device.
    const modelId = data.modelId ?? "onnx-community/whisper-base_timestamped";
    transcriber = await pipeline("automatic-speech-recognition", modelId, {
      dtype: data.dtype ?? defaultDtype,
      device,
      revision: "main",
    });

    // Report the chosen device to the engine so the Settings status line
    // can show "(WebGPU)" or "(CPU)".
    self.postMessage({ type: "ready", device });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: "error",
      id: -1,
      message: `Whisper worker init failed: ${message}`,
    });
  }
  return;
}
```

Note the changes vs. the current code:
- Model default: `whisper-base` → `whisper-base_timestamped`.
- `quantized: dtype` → `dtype: data.dtype ?? defaultDtype` (with per-device default).
- Added `device` to the pipeline call.
- Added WebGPU detection.
- `ready` message now carries `device`.

- [ ] **Step 2: Replace the `transcribe` branch to accept language/task**

In the same file, find the `transcribe` handler (currently lines ~88-118). Replace the inner block:

```js
if (data.type === "transcribe") {
  if (!transcriber) {
    self.postMessage({
      type: "error",
      id: data.id,
      message: "Whisper worker is not ready yet.",
    });
    return;
  }
  try {
    const opts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
      task: data.task ?? "transcribe",
    };
    // When language === "auto", OMIT the field entirely — transformers.js
    // treats `language: "auto"` as the literal language code "auto", not
    // as auto-detect. The only safe way to get Whisper's auto-detect is to
    // leave the field unset.
    if (data.language && data.language !== "auto") {
      opts.language = data.language;
    }
    const out = await transcriber(data.pcm, opts);
    const text = typeof out?.text === "string" ? out.text : "";
    self.postMessage({ type: "result", id: data.id, text });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({
      type: "error",
      id: data.id,
      message: `Whisper transcribe failed: ${message}`,
    });
  }
  return;
}
```

- [ ] **Step 3: Update the top-of-file comment block**

The comment currently mentions the v3.8.1 pin and the q8 issue. Update the dtype explanation to reflect that the bug was the `quantized:` API mismatch + the wrong model variant. Replace the relevant paragraph:

```js
// **Failure mode honesty:** The prior attempt failed with a
// `Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`
// error on every dtype. Root cause was two implementation bugs, not an
// architectural dead end: (1) the worker called `pipeline({ quantized: ... })`
// but transformers.js v3 dropped `quantized` after v2 — v3 uses `dtype`, so
// the `quantized` key was silently ignored and the default model file was
// loaded regardless of the requested dtype; (2) the worker loaded
// `onnx-community/whisper-base`, but the transformers.js reference app
// (whisper-word-timestamps) uses `onnx-community/whisper-base_timestamped` —
// the variant the transformers.js team actually tests and exports. The
// plain `whisper-base` q8 export has a broken DequantizeLinear scale; the
// `_timestamped` export doesn't.
```

- [ ] **Step 4: Verify the file parses**

Run: `node --check src/dictation/worker-whisper.js`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add src/dictation/worker-whisper.js
git commit -m "fix(dictation): whisper worker — model swap, v3 dtype API, per-device dtype, language/task"
```

---

## Task 4: Update Parakeet worker to ignore `language`/`task`

**Files:**
- Modify: `src/dictation/worker.js`

- [ ] **Step 1: Read the transcribe handler in `src/dictation/worker.js`**

Run: `grep -n "transcribe\|language\|task" src/dictation/worker.js`
Expected: shows the transcribe message handler.

- [ ] **Step 2: Add a brief comment in the transcribe handler acknowledging the new fields**

The Parakeet worker doesn't need to *use* `language`/`task` (English-only model), but it should silently accept them so the controller doesn't have to special-case the message shape per engine. Find the transcribe handler's `onMessage`/`dispatchMessage` switch and add a comment near the top of the transcribe case:

```js
// Note: `data.language` and `data.task` are accepted but ignored. They're
// Whisper-specific options; Parakeet is English-only.
```

No code change required — the existing handler already only reads the fields it needs (`id`, `pcm`, `sampleRate`). The comment makes the intent explicit so a future reader doesn't wonder.

- [ ] **Step 3: Verify the file still parses**

Run: `node --check src/dictation/worker.js`
Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
git add src/dictation/worker.js
git commit -m "docs(dictation): note Parakeet worker ignores Whisper language/task fields"
```

---

## Task 5: Update `engine.js` — `engineSelection`, kind-aware `createWorker`, Auto fallback, `notice` event, `device` field

**Files:**
- Modify: `src/dictation/engine.js`

This is the most behavior-rich task. TDD applies.

- [ ] **Step 1: Read the current `engine.js` `preload` function (lines 201-250)**

Run: `sed -n '201,250p' src/dictation/engine.js`

Confirm the current shape matches the file we read during planning: `preload({ createWorker, kind, wasmPaths, backend })` → calls `options.createWorker()` (zero-arg) → posts `init`.

- [ ] **Step 2: Write the failing test for `engineSelection: "whisper"` (forces Whisper)**

Add to `src/dictation/__tests__/controller.test.ts`, in the `"engine dispatch"` describe block. The existing test at line ~205 ("rejects with a clear error when kind is anything other than 'parakeet'") will be removed in step 3; this test replaces it.

```ts
it("calls createWorker with kind='whisper' when engineSelection='whisper'", async () => {
  const calls: string[] = [];
  await preloadEngine({
    ...engineOptions,
    createWorker: (kind) => {
      calls.push(kind);
      return new FakeWorker("blob:fake", { type: "module" }) as unknown as Worker;
    },
    engineSelection: "whisper",
  });
  expect(calls).toEqual(["whisper"]);
  expect(getEngineKind()).toBe("whisper");
  await disposeEngine();
});

it("calls createWorker with kind='parakeet' when engineSelection='parakeet'", async () => {
  const calls: string[] = [];
  await preloadEngine({
    ...engineOptions,
    createWorker: (kind) => {
      calls.push(kind);
      return new FakeWorker("blob:fake", { type: "module" }) as unknown as Worker;
    },
    engineSelection: "parakeet",
  });
  expect(calls).toEqual(["parakeet"]);
  expect(getEngineKind()).toBe("parakeet");
  await disposeEngine();
});
```

- [ ] **Step 3: Remove the obsolete rejection test**

Delete the existing test at lines ~205-216 ("rejects with a clear error when kind is anything other than 'parakeet'") — the gate it asserts no longer exists.

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts -t "calls createWorker with kind="`
Expected: FAIL — `engineSelection` not yet implemented, `createWorker` is still called zero-arg.

- [ ] **Step 5: Update `engine.js` — add `engineSelection`, kind-aware `createWorker`, remove old `kind` gate**

Replace the `preload` function (lines 201-250) with:

```js
/**
 * Idempotent. Resolves once the worker reports `ready`, or rejects if the
 * engine fails to initialise. In `"auto"` mode, Whisper init failure (or 60s
 * timeout) triggers an internal re-spawn with Parakeet, which is announced
 * via the `notice` event.
 *
 * @param {EngineOptions} options
 * @returns {Promise<void>}
 */
export function preload(options) {
  if (!options || typeof options.createWorker !== "function") {
    return Promise.reject(new Error("Engine preload requires a createWorker() factory."));
  }
  const engineSelection = options.engineSelection ?? "auto";
  if (initPromise) return initPromise;
  if (state === "ready") return Promise.resolve();
  setState("loading");

  const startingKind = engineSelection === "parakeet" ? "parakeet" : "whisper";
  currentKind = startingKind;
  currentDevice = null;

  const initTimeoutMs = engineSelection === "auto" ? 60_000 : 0;

  initPromise = spawnAndInit({
    kind: startingKind,
    createWorker: options.createWorker,
    wasmPaths: options.wasmPaths ?? null,
    backend: options.backend ?? "webgpu-hybrid",
    initTimeoutMs,
  }).catch(async (error) => {
    if (engineSelection !== "auto" || startingKind === "parakeet") {
      // Explicit mode (or already on Parakeet): surface the error, no fallback.
      setState("error", error instanceof Error ? error.message : String(error));
      initPromise = null;
      throw error;
    }
    // Auto mode: fall back to Parakeet.
    if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
    pending.clear();
    sessionIdToLastChunkId.clear();
    currentKind = "parakeet";
    currentDevice = null;
    setState("loading");
    try {
      await spawnAndInit({
        kind: "parakeet",
        createWorker: options.createWorker,
        wasmPaths: options.wasmPaths ?? null,
        backend: options.backend ?? "webgpu-hybrid",
        initTimeoutMs: 0,
      });
      // Surface the fallback to subscribers.
      setState("ready", "Whisper unavailable — using Parakeet (slower).");
      emitNotice("Whisper unavailable — using Parakeet (slower).");
      return;
    } catch (fallbackError) {
      const msg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      setState("error", `Whisper and Parakeet both failed. Last error: ${msg}`);
      initPromise = null;
      throw fallbackError;
    }
  });
  return initPromise;
}

/**
 * Spawn a worker of the given kind and resolve once it reports `ready`,
 * or reject on init error / timeout.
 *
 * @param {{ kind: DictationEngineKind, createWorker: (kind: DictationEngineKind) => Worker, wasmPaths: string | null, backend: string, initTimeoutMs: number }} opts
 * @returns {Promise<void>}
 */
function spawnAndInit(opts) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    if (opts.initTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        worker?.removeEventListener("message", onMessage);
        reject(new Error(`Engine init timed out after ${opts.initTimeoutMs}ms.`));
      }, opts.initTimeoutMs);
    }
    worker = opts.createWorker(opts.kind);
    worker.addEventListener("message", dispatchMessage);
    worker.addEventListener("error", (event) => {
      const message = (event && /** @type {any} */ (event).message) || "Dictation worker crashed.";
      if (!settled) {
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        worker?.removeEventListener("message", onMessage);
        reject(new Error(String(message)));
      }
      setState("error", String(message));
    });

    function onMessage(/** @type {MessageEvent<WorkerOutbound>} */ event) {
      const data = event.data;
      if (data?.type === "ready") {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        worker?.removeEventListener("message", onMessage);
        // Capture the device the worker reported (Whisper only; Parakeet omits).
        if (typeof data.device === "string") {
          currentDevice = /** @type {"webgpu" | "wasm"} */ (data.device);
        }
        setState("ready");
        resolve();
      } else if (data?.type === "error" && data.id === -1) {
        if (settled) return;
        settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        worker?.removeEventListener("message", onMessage);
        reject(new Error(data.message));
      }
    }
    worker.addEventListener("message", onMessage);

    worker.postMessage({
      type: "init",
      wasmPaths: opts.wasmPaths,
      backend: opts.backend,
    });
  });
}
```

Also near the top of the file (where `currentKind` is declared at line ~95), add:

```js
/** Currently-loaded engine device. Whisper reports this in `ready`; null for Parakeet. */
let currentDevice = null;
```

And the `notice` emitter — add to the subscribers infra:

```js
/** @type {Set<(message: string) => void>} */
const noticeSubscribers = new Set();

/**
 * Emit a notice event to all subscribers. Used for engine-level signals
 * like the Auto-fallback notice.
 *
 * @param {string} message
 */
function emitNotice(message) {
  for (const cb of noticeSubscribers) {
    try { cb(message); } catch { /* ignore */ }
  }
}

/**
 * Subscribe to engine notice events (engine-level signals, not worker errors).
 *
 * @param {(message: string) => void} cb
 * @returns {() => void}
 */
export function subscribeEngineNotices(cb) {
  noticeSubscribers.add(cb);
  return () => noticeSubscribers.delete(cb);
}

/**
 * Currently-loaded engine device. Synchronous read.
 *
 * @returns {"webgpu" | "wasm" | null}
 */
export function getEngineDevice() {
  return currentDevice;
}
```

And in `dispose()` (line ~403), reset `currentDevice = null` and `noticeSubscribers.clear()`:

```js
export async function dispose() {
  subscribers.clear();
  noticeSubscribers.clear();
  teardown();
  currentKind = "parakeet";
  currentDevice = null;
  setState("idle");
}
```

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts -t "calls createWorker with kind="`
Expected: PASS.

- [ ] **Step 7: Run the full dictation test suite**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts`
Expected: All tests pass except possibly the existing `engineOptions`-using tests that still call `createWorker()` zero-arg — those need updating in Task 8. Note them but continue.

- [ ] **Step 8: Commit**

```bash
git add src/dictation/engine.js src/dictation/__tests__/controller.test.ts
git commit -m "feat(dictation): engineSelection + Auto fallback + device field + notice event"
```

---

## Task 6: Write the failing Auto-fallback test

**Files:**
- Modify: `src/dictation/__tests__/controller.test.ts`

- [ ] **Step 1: Add the failing test for Auto mode fallback**

Add to the `"engine dispatch"` describe block:

```ts
it("falls back to Parakeet when engineSelection='auto' and Whisper init fails", async () => {
  const calls: string[] = [];
  let firstWorkerReady = false;
  // First call (whisper) simulates init failure; second call (parakeet) succeeds.
  await preloadEngine({
    ...engineOptions,
    createWorker: (kind) => {
      calls.push(kind);
      const w = new FakeWorker("blob:fake", { type: "module" }) as unknown as FakeWorker;
      if (kind === "whisper") {
        // Override postMessage to emit an init error.
        w.postMessage = (msg) => {
          if (msg?.type === "init") {
            queueMicrotask(() => {
              w.emitMessage({ type: "error", id: -1, message: "whisper init failed" });
            });
          }
        };
      } else {
        w.postMessage = (msg) => {
          if (msg?.type === "init" && !firstWorkerReady) {
            firstWorkerReady = true;
            queueMicrotask(() => {
              w.emitMessage({ type: "ready", device: undefined });
            });
          }
        };
      }
      return w as unknown as Worker;
    },
    engineSelection: "auto",
  });
  expect(calls).toEqual(["whisper", "parakeet"]);
  expect(getEngineKind()).toBe("parakeet");
  await disposeEngine();
});

it("does not fall back when engineSelection='whisper' and Whisper init fails", async () => {
  const calls: string[] = [];
  await expect(
    preloadEngine({
      ...engineOptions,
      createWorker: (kind) => {
        calls.push(kind);
        const w = new FakeWorker("blob:fake", { type: "module" }) as unknown as FakeWorker;
        w.postMessage = (msg) => {
          if (msg?.type === "init") {
            queueMicrotask(() => {
              w.emitMessage({ type: "error", id: -1, message: "whisper init failed" });
            });
          }
        };
        return w as unknown as Worker;
      },
      engineSelection: "whisper",
    }),
  ).rejects.toThrow(/whisper init failed/);
  expect(calls).toEqual(["whisper"]);
  await disposeEngine();
});
```

- [ ] **Step 2: Run the new tests to verify they pass (Auto test) or fail appropriately**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts -t "falls back to Parakeet"`
Expected: PASS (the engine.js changes from Task 5 already implement this).

Run: `npx vitest run src/dictation/__tests__/controller.test.ts -t "does not fall back"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/dictation/__tests__/controller.test.ts
git commit -m "test(dictation): Auto fallback to Parakeet + no-fallback in whisper mode"
```

---

## Task 7: Update `controller.js` — accept `language`/`task` getters and `engineSelection`

**Files:**
- Modify: `src/dictation/controller.js`

- [ ] **Step 1: Read the current `controller.js` `transcribe` call (line ~295)**

Run: `sed -n '290,300p' src/dictation/controller.js`

Confirm the current call shape: `const text = await transcribe(pcm, 16_000);`

- [ ] **Step 2: Update `transcribe` signature in `engine.js` to accept options**

In `src/dictation/engine.js`, replace the `transcribe` function (lines ~259-268):

```js
/**
 * Send PCM to the worker and resolve with the transcribed text. Throws if the
 * engine isn't ready or the worker reports an error.
 *
 * @param {Float32Array} pcm
 * @param {number} [sampleRate=16000]
 * @param {{ language?: string, task?: "transcribe" | "translate" }} [opts]
 *   Per-utterance Whisper options. Ignored by Parakeet.
 * @returns {Promise<string>}
 */
export function transcribe(pcm, sampleRate = 16000, opts = {}) {
  if (state !== "ready" || !worker) {
    return Promise.reject(new Error("Dictation engine is not ready."));
  }
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, partialHandler: null });
    worker.postMessage(
      { type: "transcribe", id, pcm, sampleRate, language: opts.language, task: opts.task },
      [pcm.buffer],
    );
  });
}
```

- [ ] **Step 3: Update `controller.js` to accept `getDictationSettings` and pass `language`/`task` per-utterance**

In `src/dictation/controller.js`, find the `createDictationController` factory input type and the `transcribe` call site.

First, extend the `CreateControllerInput` typedef (lines ~38-43):

```js
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
```

Then in the factory body (after `const isEditable = ...`):

```js
const getDictationSettings = input.getDictationSettings ?? (() => ({}));
```

Then in `stop()`, replace the `const text = await transcribe(pcm, 16_000);` line:

```js
const settings = getDictationSettings() ?? {};
const text = await transcribe(pcm, 16_000, {
  language: settings.language,
  task: settings.task,
});
```

- [ ] **Step 4: Write a test that the controller passes `language`/`task` from `getDictationSettings`**

Add to `src/dictation/__tests__/controller.test.ts`:

```ts
it("passes language and task from getDictationSettings into the transcribe message", async () => {
  await preloadEngine(engineOptions);
  const worker = FakeWorker.lastInstance as unknown as FakeWorker;
  let captured: any = null;
  worker.transcribeHandler = (id, pcm, sampleRate) => {
    // Capture the last inbound message to the worker.
    const last = (worker as any).__lastMessage;
    captured = last;
    queueMicrotask(() => {
      worker.emitMessage({ type: "result", id, text: "hola" });
    });
  };
  // Patch postMessage to capture the message
  const origPost = worker.postMessage.bind(worker);
  (worker as any).__lastMessage = null;
  worker.postMessage = (msg, transfer) => {
    (worker as any).__lastMessage = msg;
    return origPost(msg, transfer);
  };

  const button = makeButton();
  const controller = createDictationController({
    button,
    callbacks: { onText: () => {} },
    getDictationSettings: () => ({ language: "es", task: "transcribe" }),
  });
  // Trigger a transcribe via the controller's stop() — needs mic access mock.
  // (Use the existing test harness's getUserMedia mock pattern — see other
  // controller tests for the exact setup.)
  // ...drive a stop() and assert captured.language === "es" and captured.task === "transcribe".
  await disposeEngine();
});
```

Note: the test skeleton above references patterns the existing test file already uses (FakeWorker.postMessage override, getUserMedia mock). Look at the existing transcribe tests in `controller.test.ts` for the exact setup pattern and mirror it. The key assertion is that the `transcribe` message includes `language: "es"` and `task: "transcribe"` when `getDictationSettings` returns those.

- [ ] **Step 5: Run the new test, verify it fails first then passes**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts -t "passes language and task"`
Expected: FAIL before controller.js edit (no `language`/`task` in message), PASS after.

- [ ] **Step 6: Add the test for `language: "auto"` being passed through as `undefined`**

Add to the same describe block:

```ts
it("passes language=undefined when getDictationSettings returns language='auto'", async () => {
  await preloadEngine(engineOptions);
  const worker = FakeWorker.lastInstance as unknown as FakeWorker;
  let captured: any = null;
  worker.postMessage = (msg, transfer) => {
    captured = msg;
    // Simulate the worker emitting a result.
    queueMicrotask(() => {
      worker.emitMessage({ type: "result", id: msg.id, text: "" });
    });
    return undefined;
  };
  // Drive a stop() with getDictationSettings returning { language: "auto", task: "transcribe" }.
  // Assert captured.language === undefined (the controller should pass through
  // whatever getDictationSettings returns; the WORKER decides to omit it).
  // ...mirror the existing test harness pattern.
  await disposeEngine();
});
```

Note: the controller passes `language: "auto"` through as-is; the worker's `transcribe` branch (Task 3, step 2) is what omits the field from the `transcriber()` call. The test asserts the controller doesn't transform `"auto"` to anything else.

- [ ] **Step 7: Commit**

```bash
git add src/dictation/engine.js src/dictation/controller.js src/dictation/__tests__/controller.test.ts
git commit -m "feat(dictation): per-utterance language/task from getDictationSettings"
```

---

## Task 8: Update existing tests to use `createWorker(kind)` factory

**Files:**
- Modify: `src/dictation/__tests__/controller.test.ts`

The existing `engineOptions` constant (line ~85) uses a zero-arg `createWorker`. After Task 5's contract change, this still works because `createWorker` is called with `kind` as an argument and the existing factory ignores arguments. But the FakeWorker returned is a "parakeet" worker regardless of kind — which means tests using `engineOptions` are testing the parakeet path only.

- [ ] **Step 1: Update `engineOptions` to use a kind-aware factory**

Replace the `engineOptions` constant (around line 85):

```ts
/** @type {{ createWorker: (kind: "parakeet" | "whisper") => Worker, wasmPaths: string }} */
const engineOptions = {
  createWorker: (_kind) => new FakeWorker("blob:fake", { type: "module" }) as unknown as Worker,
  wasmPaths: "/dictation/ort-wasm/",
};
```

The `_kind` prefix marks it as intentionally unused; the FakeWorker is parakeet-shaped which is fine for tests that don't assert engine kind.

- [ ] **Step 2: Find any test that asserts `kind` field behavior and update**

Run: `grep -n "kind:" src/dictation/__tests__/controller.test.ts`

For any test still passing `kind: "parakeet"` or `kind: "whisper"`, replace with `engineSelection: "parakeet"` or `engineSelection: "whisper"` respectively. The semantic is preserved (the field is renamed).

- [ ] **Step 3: Run the full dictation test suite**

Run: `npx vitest run src/dictation/__tests__/controller.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/dictation/__tests__/controller.test.ts
git commit -m "test(dictation): migrate to createWorker(kind) factory + engineSelection field"
```

---

## Task 9: Wire `App.tsx` to read Settings and remove `?engine=whisper` URL affordance

**Files:**
- Modify: `src/App.tsx:121` (imports)
- Modify: `src/App.tsx:614-636` (preload call)

- [ ] **Step 1: Read the current preload block in `App.tsx`**

Run: `sed -n '610,640p' src/App.tsx`

Confirm the block currently has the `?engine=whisper` URL affordance (per the gitStatus diff).

- [ ] **Step 2: Replace the preload block**

Replace the block starting around line 615 (`void preloadDictationEngine({...})`) with:

```tsx
void preloadDictationEngine({
  createWorker: (kind) =>
    kind === "whisper" ? new WhisperWorker() : new DictationWorker(),
  engineSelection:
    state.dictation?.engineSelection ?? "auto",
  wasmPaths: DEFAULT_ENGINE_WASM_PATHS,
  // getDictationSettings is called at each stop() to pick up language/task
  // changes without an engine reload.
  getDictationSettings: () => ({
    language: state.dictation?.language ?? "auto",
    task: state.dictation?.task ?? "transcribe",
  }),
}).catch((error) => {
  setChatNotice(
    `Voice dictation unavailable: ${error instanceof Error ? error.message : String(error)}`,
  );
});
```

Note: `state` here refers to the `ResonantShellState` already in scope in `App()` — adjust the variable name if it's `resonantShellState` or similar. The `WhisperWorker` and `DictationWorker` imports at the top of `App.tsx` are kept; the `?engine=whisper` URL parsing is removed.

- [ ] **Step 3: Remove the now-obsolete comment block**

Find the comment block that starts with `// Engine kind is hard-coded to "parakeet"…` (was present in the staged version) and remove it entirely.

- [ ] **Step 4: Verify the file compiles**

Run: `npx tsc --noEmit`
Expected: no errors in `src/App.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): wire dictation preload to Settings; remove ?engine=whisper URL affordance"
```

---

## Task 10: Add the Dictation section to Settings UI

**Files:**
- Modify: `src/modules/settings/SettingsWorkspace.tsx`

- [ ] **Step 1: Read the existing SettingsWorkspace.tsx structure**

Run: `wc -l src/modules/settings/SettingsWorkspace.tsx && grep -n "section\|<h2\|<h3\|commitReadyState" src/modules/settings/SettingsWorkspace.tsx | head -40`

Get a sense of where the existing sections live and how state is committed.

- [ ] **Step 2: Add the Dictation section JSX**

Find a good insertion point (typically after the last existing section, before the closing `</div>` of the workspace container). Add:

```tsx
<section className="settings-section" aria-labelledby="dictation-heading">
  <h3 id="dictation-heading">Dictation</h3>

  <div className="settings-row">
    <span className="settings-label">Engine</span>
    <div className="settings-radio-group" role="radiogroup" aria-label="Dictation engine">
      <label>
        <input
          type="radio"
          name="dictation-engine"
          checked={(state.dictation?.engineSelection ?? "auto") === "auto"}
          onChange={() => updateDictationSettings({ engineSelection: "auto" })}
        />
        Auto (default) — Whisper preferred, Parakeet fallback
      </label>
      <label>
        <input
          type="radio"
          name="dictation-engine"
          checked={(state.dictation?.engineSelection ?? "auto") === "whisper"}
          onChange={() => updateDictationSettings({ engineSelection: "whisper" })}
        />
        Whisper — faster, may fail on some setups
      </label>
      <label>
        <input
          type="radio"
          name="dictation-engine"
          checked={(state.dictation?.engineSelection ?? "auto") === "parakeet"}
          onChange={() => updateDictationSettings({ engineSelection: "parakeet" })}
        />
        Parakeet — slower, always works
      </label>
    </div>
  </div>

  <div className="settings-row">
    <label className="settings-label" htmlFor="dictation-language">Language</label>
    <select
      id="dictation-language"
      disabled={(state.dictation?.engineSelection ?? "auto") === "parakeet"}
      value={state.dictation?.language ?? "auto"}
      onChange={(e) => updateDictationSettings({ language: e.target.value })}
    >
      <option value="auto">Auto-detect</option>
      <option value="en">English</option>
      <option value="es">Spanish</option>
      <option value="fr">French</option>
      <option value="de">German</option>
      <option value="it">Italian</option>
      <option value="pt">Portuguese</option>
      <option value="ja">Japanese</option>
      <option value="zh">Chinese</option>
      <option value="ko">Korean</option>
      <option value="ru">Russian</option>
      <option value="hi">Hindi</option>
      <option value="ar">Arabic</option>
    </select>
  </div>

  <div className="settings-row">
    <span className="settings-label">Task</span>
    <div className="settings-radio-group" role="radiogroup" aria-label="Whisper task">
      <label>
        <input
          type="radio"
          name="dictation-task"
          disabled={(state.dictation?.engineSelection ?? "auto") === "parakeet"}
          checked={(state.dictation?.task ?? "transcribe") === "transcribe"}
          onChange={() => updateDictationSettings({ task: "transcribe" })}
        />
        Transcribe (keep original language)
      </label>
      <label>
        <input
          type="radio"
          name="dictation-task"
          disabled={(state.dictation?.engineSelection ?? "auto") === "parakeet"}
          checked={(state.dictation?.task ?? "transcribe") === "translate"}
          onChange={() => updateDictationSettings({ task: "translate" })}
        />
        Translate (output English)
      </label>
    </div>
  </div>

  <div className="settings-row">
    <span className="settings-status" aria-live="polite">{dictationStatusLine}</span>
  </div>
</section>
```

- [ ] **Step 3: Add the `updateDictationSettings` handler and `dictationStatusLine` value**

In the component body (where the other state-update handlers live), add:

```tsx
const updateDictationSettings = useCallback((patch: Partial<DictationSettings>) => {
  const next: DictationSettings = {
    engineSelection: state.dictation?.engineSelection ?? "auto",
    language: state.dictation?.language ?? "auto",
    task: state.dictation?.task ?? "transcribe",
    ...patch,
  };
  commitReadyState({ ...state, dictation: next });
}, [state, commitReadyState]);

const dictationStatusLine = (() => {
  const engineKind = getEngineKind();
  const device = getEngineDevice();
  if (engineKind === "whisper" && device === "webgpu") return "Whisper loaded (WebGPU)";
  if (engineKind === "whisper" && device === "wasm") return "Whisper loaded (CPU)";
  if (engineKind === "parakeet" && (state.dictation?.engineSelection ?? "auto") === "auto") {
    return "Parakeet loaded (Whisper unavailable)";
  }
  if (engineKind === "parakeet") return "Parakeet loaded";
  return "Loading…";
})();
```

Add the necessary imports at the top of the file:

```tsx
import { getEngineKind, getEngineDevice } from "../../dictation";
import type { DictationSettings } from "../../core/contracts";
```

(Check that `getEngineKind` and `getEngineDevice` are exported from `src/dictation/index.js` — if not, add them.)

- [ ] **Step 4: Verify Settings UI builds**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 5: Add a Settings UI test that round-trips the dictation settings**

Look at `src/modules/settings/SettingsWorkspace.test.tsx` for the existing test pattern. Add:

```tsx
it("persists dictation engineSelection, language, and task changes", async () => {
  // Render the SettingsWorkspace with a mock state + commitReadyState.
  // Click the Whisper radio. Assert commitReadyState was called with
  // state.dictation.engineSelection === "whisper".
  // Change the Language dropdown to "Spanish". Assert commitReadyState
  // was called with state.dictation.language === "es".
  // Click the Translate radio. Assert commitReadyState was called with
  // state.dictation.task === "translate".
  // ...mirror the existing SettingsWorkspace test harness.
});
```

- [ ] **Step 6: Run the Settings test**

Run: `npx vitest run src/modules/settings/SettingsWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/settings/SettingsWorkspace.tsx src/modules/settings/SettingsWorkspace.test.tsx src/dictation/index.js
git commit -m "feat(settings): Dictation section — engine, language, task controls"
```

---

## Task 11: Cleanup — delete sweep script + log

**Files:**
- Delete: `scripts/whisper-quants.mjs`
- Delete: `scripts/whisper-quants.log`

- [ ] **Step 1: Delete the files**

Run: `git rm scripts/whisper-quants.mjs scripts/whisper-quants.log`

- [ ] **Step 2: Verify nothing imports them**

Run: `grep -rn "whisper-quants" src/ docs/ 2>/dev/null`
Expected: no results (the script was standalone, not imported anywhere).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove invalid whisper-quants sweep script and log"
```

---

## Task 12: Run full test suite + typecheck + build

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Unit tests**

Run: `npx vitest run`
Expected: all tests pass. Note any pre-existing intermittent failures in `src/App.test.tsx` (Browser/Notes workspaces) — these were already intermittent before this work and aren't blockers.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit if any fixes were needed**

If the build surfaced issues that needed edits, commit them with a clear message. Otherwise no commit.

---

## Task 13: Manual verification in the browser (NOT OPTIONAL)

This is the gate that says "Whisper actually works." Type-checks and unit tests don't validate that the model loads and produces transcripts.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the printed URL in Chromium.

- [ ] **Step 2: Open Settings → Dictation, set Engine = Auto**

Confirm the radio buttons render and the Language dropdown defaults to Auto-detect.

- [ ] **Step 3: First-load verification**

Open DevTools → Network tab. Watch for `whisper-base_timestamped` model files fetching from HF (encoder/decoder/tokenizer). The first load fetches ~150 MB on WASM/CPU. Confirm the IndexedDB cache populates (Application → IndexedDB).

Confirm the status line in Settings → Dictation shows "Whisper loaded (CPU)" (or "(WebGPU)" if you have WebGPU enabled).

- [ ] **Step 4: Record an English utterance**

Click the dictation button in the chat composer. Speak 5-10 seconds of clear English. Stop. Confirm a transcript appears in the composer. The transcript should be coherent and faster to produce than the same utterance through Parakeet (Whisper-base is ~74M params vs Parakeet's 600M).

- [ ] **Step 5: Switch to Parakeet, repeat**

In Settings → Dictation, set Engine = Parakeet. Confirm the Language dropdown and Task radio are disabled. Record the same utterance. Confirm transcript appears (slower). This confirms the existing path is unaffected.

- [ ] **Step 6: Force Whisper, break it**

In Settings → Dictation, set Engine = Whisper. In DevTools → Network, block `huggingface.co`. Reload the page. Confirm the error "Voice dictation unavailable: Whisper worker init failed: …" surfaces in the chat notice, and there's no silent fallback to Parakeet.

- [ ] **Step 7: Auto fallback**

Unblock HF, reload, set Engine = Auto. Once Whisper loads, block HF again. Trigger a worker reload (reload the page). Confirm Parakeet takes over and the notice "Whisper unavailable — using Parakeet (slower)" fires. Confirm the Settings status line shows "Parakeet loaded (Whisper unavailable)".

- [ ] **Step 8: Multilingual — Spanish**

Set Engine = Auto (or Whisper), Language = Spanish. Speak a short Spanish phrase. Confirm the transcript is in Spanish.

- [ ] **Step 9: Multilingual — Translate**

Set Task = Translate. Speak the same Spanish phrase. Confirm the transcript is in English.

- [ ] **Step 10: Multilingual — auto-detect**

Set Language = Auto-detect. Speak a phrase in another language you know (e.g. French, German). Confirm Whisper auto-detects and transcribes correctly.

- [ ] **Step 11: WebGPU (if available)**

If you can enable WebGPU (`chrome://flags/#enable-unsafe-webgpu` in Chromium on hardware with a discrete GPU, then restart Chrome): reload the page. Confirm the Settings status line shows "Whisper loaded (WebGPU)" and that transcription RTF is meaningfully faster than the WASM/CPU path.

If WebGPU isn't available in this env, skip this step — the WASM path is the default and is fully tested by step 4.

- [ ] **Step 12: Note RTF observation**

If Whisper-base q8 RTF on this CPU-bound env is not meaningfully better than Parakeet's ~1.3-1.7×, note it as a follow-up investigation, not a blocker. Record the observation in the commit message of the final commit (Task 14) or as a separate follow-up note.

---

## Task 14: De-wonk audit

- [ ] **Step 1: Invoke the de-wonk skill**

Run: `/de-wonk` (via the Skill tool) — invokes the de-wonk audit loop.

The de-wonk skill scans the codebase for: unimplemented stubs, disabled code, broken paths, weird code, dead branches. After a worker-swap + new Settings section, the likely failure modes it would catch:
- Dormant imports (e.g. `WhisperWorker` imported but never used after removing `?engine=whisper`).
- Unreachable fallback branches (e.g. Auto mode's Parakeet fallback that never fires because Whisper always succeeds in the dev env).
- Settings that don't actually round-trip (e.g. `updateDictationSettings` writes but the read path doesn't default correctly).
- Dead `kind` references in tests after the contract change.
- Leftover `?engine=whisper` references in tests or docs.

- [ ] **Step 2: Address findings**

For each finding, either fix it inline or document why it's intentional. Don't leave de-wonk findings unresolved.

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "chore(dictation): de-wonk audit fixes"
```

If no findings, no commit needed.

---

## Task 15: Update memory

The `dictation-architecture-final` memory currently says: "If they want a Whisper fallback, the architectural pattern 'load an ONNX model from HF in browser via a JS port' has failed four times in this codebase ... don't recommend that path without explicit acknowledgement of the risk."

The situation has changed: Whisper works on the reference stack. Update the memory.

- [ ] **Step 1: Update `/home/victor/.claude/projects/-home-victor-Workspace-src-github-com-vijayee-2-0-0-alpha/memory/dictation-architecture-final.md`**

Replace the "Engine dispatcher" paragraph with:

```markdown
**Engine dispatcher + Whisper**: As of 2026-06-17, Whisper is the primary
engine (Auto mode default), with Parakeet as fallback. Whisper uses
`onnx-community/whisper-base_timestamped` via `@huggingface/transformers@3.8.1`,
per-device dtype (`q8` for WASM, `{encoder:fp32, decoder:q4}` for WebGPU),
auto-detected at worker init. Settings → Dictation exposes Engine (Auto /
Whisper / Parakeet), Language (Auto-detect or specific), Task (Transcribe
/ Translate).

The prior "four failures, don't try again" warning was based on a misdiagnosis:
the 5th attempt's dtype sweep was invalid (used v2's `quantized:` API on v3,
which silently ignored it — all 5 rows loaded the same default model and
produced the same error). The real fix was two implementation bugs: (1) use
v3's `dtype:` API, (2) load `whisper-base_timestamped` not `whisper-base`.
The architectural pattern (HF ONNX via JS port) is sound when matched to the
reference stack.
```

- [ ] **Step 2: Verify the memory file is valid frontmatter**

Run: `head -10 /home/victor/.claude/projects/-home-victor-Workspace-src-github-com-vijayee-2-0-0-alpha/memory/dictation-architecture-final.md`
Expected: frontmatter intact.

(No git commit — memory files live outside the repo.)

---

## Self-Review

After writing this plan, I re-read the spec and checked:

1. **Spec coverage:**
   - Architecture (Whisper primary, Parakeet fallback, Auto mode): Tasks 5, 6
   - WebGPU auto-detect + per-device dtype: Task 3 (worker fix step 1)
   - Multilingual (language auto-detect + manual override + task toggle): Task 3 (worker fix step 2), Task 7 (controller), Task 10 (Settings UI)
   - No per-utterance fallback: enforced by the design — engine fallback happens at init, not per-transcribe
   - Single-engine-at-a-time: Task 5 — the engine spawns one worker, Auto mode spawns a second only on failure
   - Init timeout 60s: Task 5 step 5 (`initTimeoutMs`)
   - Worker fix (model swap, v3 API, per-device dtype, language/task): Task 3
   - Parakeet worker ignores language/task: Task 4
   - Protocol changes (`language`/`task` on transcribe, `device` on ready, `notice` engine→controller): Tasks 3, 5, 7
   - createWorker(kind) contract: Tasks 5, 8
   - Settings UI: Task 10
   - Cleanup (delete sweep, remove URL affordance, remove obsolete comment): Tasks 9, 11
   - Tests: Tasks 5, 6, 7, 8, 10
   - Verification: Task 13
   - De-wonk: Task 14
   - Memory update: Task 15

2. **Placeholder scan:** No TBDs/TODOs in steps. Test skeletons in Tasks 7 and 10 reference "mirror the existing test harness pattern" — this is intentional delegation to the implementer to look at the existing test file's setup pattern, with concrete references to what to assert. The de-wonk step delegates to the skill itself, which is the correct way to invoke it.

3. **Type consistency:** `DictationSettings` is defined identically in `types.js` (JSDoc), `index.d.ts`, and `contracts.ts`. `engineSelection` is `"auto"|"whisper"|"parakeet"` everywhere. `createWorker(kind)` signature is consistent across engine.js, App.tsx, and tests. `getDictationSettings` returns `{language?: string, task?: "transcribe"|"translate"}` consistently. `device` field on `ready` is `"webgpu"|"wasm"|undefined` consistently.

4. **Gaps found and fixed during self-review:**
   - Initially forgot to add `getEngineDevice` export to `index.d.ts` — fixed in Task 1 step 3.
   - Initially forgot to wire `noticeSubscribers.clear()` into `dispose()` — fixed in Task 5 step 5.
   - The Task 7 test skeleton needs the implementer to look at the existing controller test harness for the getUserMedia mock pattern — noted explicitly in the test step.