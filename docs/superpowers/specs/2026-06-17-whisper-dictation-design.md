# Whisper Dictation in the Browser — Design

**Date:** 2026-06-17
**Status:** Approved, ready for implementation plan
**Scope:** Make Whisper work as the primary dictation engine in the browser, with the existing Parakeet engine as a manual fallback selectable from Settings. Whisper runs on WebGPU when available (matching Parakeet's existing `webgpu-hybrid` pattern), falling back to WASM. Whisper is the multilingual variant (`onnx-community/whisper-base_timestamped`, based on `openai/whisper-base`) and supports per-utterance language auto-detect with optional manual override, plus a transcribe/translate task toggle.

## Background and why this isn't a sixth failed attempt

The local dictation feature in `src/dictation/` currently uses Parakeet TDT 0.6B v3 (int8, via `parakeet.js`) and works, but is CPU-bound in this environment (~1.3–1.7× realtime factor). Whisper has been attempted ~5× in this codebase on the pattern "load an HF ONNX model in browser via a JS port," each attempt failing for a different reason. The standing memory warning was to not recommend that pattern again without explicit risk acknowledgement.

Investigation of the latest attempt (the in-tree `worker-whisper.js` re-added after the most recent revert, plus `scripts/whisper-quants.mjs`) found two concrete, fixable implementation bugs rather than an architectural dead end:

1. **v3 API mismatch.** `worker-whisper.js` calls `pipeline("automatic-speech-recognition", modelId, { quantized: <dtype-string> })`. The `quantized` parameter was removed after transformers.js v2; v3 uses `dtype`. v3 silently ignores the unknown `quantized` key and falls through to `dtype: null` (model default). This means the five-row dtype sweep in `scripts/whisper-quants.log` (q8/fp16/fp32/q4/q4f16) all loaded the *same* default model file and produced the *same* error. The "all dtypes fail" conclusion drawn from that log is invalid.

2. **Wrong model variant.** The worker loads `onnx-community/whisper-base`. The transformers.js reference app `whisper-word-timestamps` uses `onnx-community/whisper-base_timestamped` — the variant the transformers.js team actually tests and exports. The plain `whisper-base` q8 export has the broken `decoder.embed_tokens.weight_merged_0_scale` DequantizeLinear scale that the sweep log shows. The `_timestamped` export doesn't.

The architectural pattern works in the reference app. The dev server already sets COOP (`same-origin`) and COEP (`credentialless`) headers correctly, so cross-origin isolation is not the issue. The remaining work is to match the reference stack and wire it into the existing engine + Settings infrastructure.

## Architecture

### Engines

- **Whisper** — primary. `onnx-community/whisper-base_timestamped` (multilingual, based on `openai/whisper-base`). Loaded via `@huggingface/transformers` `pipeline()` in `src/dictation/worker-whisper.js`. ~150 MB cached in IndexedDB on first load. Device and dtype chosen at init time (see WebGPU section below).
- **Parakeet** — fallback. Unchanged: `istupakov/parakeet-tdt-0.6b-v3-onnx` int8 via `parakeet.js`, ~660 MB in IndexedDB. Already uses `webgpu-hybrid` backend (preferred, falls back to WASM).

Both workers speak the same message protocol (`init` / `transcribe` / `ready` / `result` / `error`) that `src/dictation/worker.js` already defines; `worker-whisper.js` already mirrors it. Both accept the same Float32Array 16 kHz mono PCM contract that `decodeBlobToMono16k` in `controller.js` produces, so the audio path is engine-agnostic.

### WebGPU

Mirrors Parakeet's existing `webgpu-hybrid` pattern: Whisper auto-detects WebGPU at worker init time. No manual WebGPU toggle in Settings — the user enables WebGPU at the browser level (`chrome://flags/#enable-unsafe-webgpu` on Linux, or it's available in stable Chrome with a discrete GPU). If `navigator.gpu` is present and `requestAdapter()` returns a non-null adapter, Whisper uses WebGPU with the per-model dtype config from the `whisper-word-timestamps` reference:

- **WebGPU**: `dtype: { encoder_model: "fp32", decoder_model_merged: "q4" }`, `device: "webgpu"`
- **WASM (CPU)**: `dtype: "q8"`, `device: "wasm"`

The per-model dtype object is the transformers.js v3 form for specifying different dtypes per submodel on WebGPU. The encoder runs in fp32 for accuracy; the merged decoder runs in q4 for memory. The reference app uses exactly this split.

The current env (per memory) is CPU-bound because WebGPU isn't enabled in the user's Chromium yet. The WebGPU code is forward-looking — it activates when the user enables WebGPU at the browser level. No code change is needed when that happens.

### Multilingual

The model `onnx-community/whisper-base_timestamped` is multilingual (based on `openai/whisper-base`, not `.en`). The transcribe call passes two options per utterance:

- `language` — `"auto"` (default, Whisper auto-detects) or a specific language code (`"en"`, `"es"`, `"fr"`, `"de"`, `"ja"`, `"zh"`, ...). Whisper's auto-detect is strong for chat-composer use; the manual override is for users whose accent gets mis-detected.
- `task` — `"transcribe"` (default, keep original language) or `"translate"` (output English).

These are per-transcribe options, not per-init — the model loads once and accepts language/task on every call. Changing the Settings doesn't require reloading the engine; the next utterance picks up the new language/task.

### User choice (Settings → Dictation)

Three options, persisted on `ResonantShellState`:

- **Auto** (default) — try Whisper at preload; on init failure or 60 s timeout, swap to Parakeet and surface a one-time notice. Per-utterance, stick with whichever engine loaded.
- **Whisper** — force Whisper. On init failure, surface the existing `Voice dictation failed: …` error and let the user manually switch. No silent fallback.
- **Parakeet** — force Parakeet (current behavior).

### No per-utterance fallback

The fallback lives at the engine-selection layer, not inside the transcribe loop. Per-utterance retry would add the kind of state/retry plumbing that the streaming-partials work accumulated before being cut. Both engines accept the same PCM contract, so the audio path doesn't change between them.

### Single-engine-at-a-time

The engine spawns one worker at preload time. Auto mode spawns a second worker only when Whisper init fails. Loading both engines upfront would double IndexedDB usage (~810 MB) and double init latency for no benefit, since both engines serve the same utterance contract.

### Init timeout

60 s. Whisper `_timestamped` q8 first-load fetches ~150 MB from HF; warm loads from IndexedDB should init in <10 s. 60 s gives a generous ceiling for cold loads on slow connections without making "Auto" feel broken. The timeout fires for Auto mode only; explicit Whisper mode waits on the natural init error.

## Worker fix (`src/dictation/worker-whisper.js`)

### `init` branch — three edits

1. **Model swap.** Default `modelId` changes from `"onnx-community/whisper-base"` → `"onnx-community/whisper-base_timestamped"`. (The `_timestamped` variant is the multilingual model the transformers.js team tests; the plain `whisper-base` q8 export has the broken `decoder.embed_tokens.weight_merged_0_scale` scale.)

2. **v3 API fix + per-device dtype.** Replace:
   ```js
   {
     quantized: dtype,
     revision: "main",
   }
   ```
   with a per-device dtype config (matching `whisper-word-timestamps`):
   ```js
   const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator
     && (await navigator.gpu.requestAdapter()) != null;
   const device = hasWebGPU ? "webgpu" : "wasm";
   const defaultDtype = hasWebGPU
     ? { encoder_model: "fp32", decoder_model_merged: "q4" }
     : "q8";
   // ...
   pipeline("automatic-speech-recognition", modelId, {
     dtype: data.dtype ?? defaultDtype,
     device,
     revision: "main",
   });
   ```
   The `data.dtype` override stays for debug; the default is per-device.

3. **Pass `device` to pipeline.** The reference passes `device: "webgpu" | "wasm"` to `pipeline()` so transformers.js selects the right ORT execution provider. This is required for the WebGPU dtype split to take effect.

Unchanged:
- `transformersEnv.allowLocalModels = false`, `useFs = false` (correct for browser).
- `chunk_length_s: 30`, `stride_length_s: 5` (matches reference).
- `return_timestamps: false` (chat-composer use case doesn't need timestamps; matches existing Parakeet path).
- The failure-mode-honesty comment block at the top (still accurate).

### `transcribe` branch — accept language/task

The current transcribe call:
```js
const out = await transcriber(data.pcm, {
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: false,
});
```

extended with `task` and conditionally with `language`:

```js
const opts = {
  chunk_length_s: 30,
  stride_length_s: 5,
  return_timestamps: false,
  task: data.task ?? "transcribe",
};
// When language === "auto", OMIT the field entirely — transformers.js
// treats `language: "auto"` as the literal language code "auto" rather
// than as auto-detect. The only safe way to get Whisper's auto-detect
// is to leave the field unset.
if (data.language && data.language !== "auto") opts.language = data.language;
const out = await transcriber(data.pcm, opts);
```

## Engine & controller wiring

### Protocol changes

The worker → engine protocol's `transcribe` message gains two optional fields: `language` (string, default `"auto"`) and `task` (`"transcribe" | "translate"`, default `"transcribe"`). Parakeet's worker ignores them; Whisper's worker uses them.

The worker → engine `ready` message gains one optional field: `device: "webgpu" | "wasm"` (Whisper only — reports which device the worker picked at init, so the Settings status line can show "(WebGPU)" or "(CPU)"). Parakeet's `ready` message omits it.

A new **engine → controller** event `notice` is added for the Auto-fallback signal — the engine emits it (not the worker) when Parakeet takes over from a failed Whisper init. The controller listens for `notice` and forwards the message to the chat notice area and the Settings status line.

The `init` / `result` / `error` messages are unchanged.

### `controller.js`

Add three new fields to the preload options, all read from Settings:
- `engineSelection: "auto" | "whisper" | "parakeet"` — engine selection (see Architecture).
- `language: string` — Whisper language code or `"auto"` (default). Only used by Whisper; Parakeet ignores it (English-only model).
- `task: "transcribe" | "translate"` — Whisper task. Only used by Whisper.

The controller passes `engineSelection` to `engine.preload()` along with the kind-aware `createWorker` factory. `language` and `task` are stored on the controller and re-read at each `transcribe` call — so changing Settings mid-session takes effect on the next utterance without reloading the engine. The controller holds a reference to a getter that returns the current `state.dictation.language` / `state.dictation.task` snapshot (set at preload time by `App.tsx`, which owns the `ResonantShellState`). The current `App.tsx`-inline `?engine=whisper` URL parsing is removed and replaced by reading `state.dictation.engineSelection`, `state.dictation.language`, and `state.dictation.task` and passing them through.

The `transcribe` message from controller → worker is extended to include `language` and `task` fields. Parakeet's worker (`worker.js`) ignores them; Whisper's worker uses them per the Worker fix section above.

### `engine.js`

Add init-fallback handling for Auto mode. When `engineSelection === "auto"` and Whisper's `init` message fails or the 60 s timeout fires, the engine performs an *internal* re-spawn (not a recursive call to the public `preload()` function — that would re-trigger the state machine):

1. Terminates the Whisper worker.
2. Calls `createWorker("parakeet")` to get a Parakeet worker.
3. Re-enters the init handshake with `kind: "parakeet"` and the new worker.
4. Once Parakeet reports `ready`, emits an engine-level `notice` event (new — see Protocol changes below) that the controller surfaces to the chat notice area: *"Whisper unavailable — using Parakeet (slower)."* The notice is also reflected in the Settings status line.

For the explicit `"whisper"` and `"parakeet"` modes, no fallback: a Whisper init failure surfaces the existing `Voice dictation failed: …` notice and the user manually switches via Settings.

### `createWorker` factory contract

The current `preload({ createWorker, kind, wasmPaths })` takes a single zero-argument factory plus a separate `kind` selector. To support Auto mode's "spawn Whisper, fall through to Parakeet" the contract changes to a single factory that takes the kind:

```js
preload({
  createWorker: (kind) =>
    kind === "whisper" ? new WhisperWorker() : new DictationWorker(),
  engineSelection: state.dictation.engineSelection ?? "auto",
  wasmPaths,
})
```

The `kind` field is removed from the preload options — it's now derived from `engineSelection` (`"auto"` starts as `"whisper"`). The existing test that passes `kind: "whisper"` directly is updated to pass `engineSelection: "whisper"` and a `createWorker(kind)` factory; the test's intent is preserved.

## Settings UI

New **Dictation** section in `src/modules/settings/SettingsWorkspace.tsx`, modeled after the existing provider-config sections (same notice/busy-state/section pattern).

**Layout:**

```
Dictation
─────────────────────────────────────────
Engine:    ( ) Auto (default)   — Whisper preferred, Parakeet fallback
           ( ) Whisper          — faster, may fail on some setups
           ( ) Parakeet         — slower, always works

Language:  [Auto-detect ▼]      — Whisper auto-detects by default
           (dropdown: Auto / English / Spanish / French / German /
            Japanese / Chinese / ... — common languages; full list
            sourced from Whisper's supported-language list)
           Disabled when Engine = Parakeet (English-only model).

Task:      ( ) Transcribe (default)  — keep original language
           ( ) Translate              — output English
           Disabled when Engine = Parakeet.
─────────────────────────────────────────
[status line: "Whisper loaded (WebGPU)" | "Whisper loaded (CPU)" |
              "Parakeet loaded (Whisper unavailable)" | "Loading…"]
```

**Persistence:** stored on `ResonantShellState` as:
- `dictation.engineSelection: "auto" | "whisper" | "parakeet"` (default `"auto"`)
- `dictation.language: string` (default `"auto"`)
- `dictation.task: "transcribe" | "translate"` (default `"transcribe"`)

The existing `commitReadyState` path that the other settings use handles persistence; no new storage layer.

**Read on app boot:** `App.tsx` reads all three (defaulting for backward compat with existing snapshots) and passes them to `preloadDictationEngine({ engineSelection, language, task, createWorker, wasmPaths })`. The current inline `?engine=whisper` URL affordance is removed.

**Per-utterance refresh:** `language` and `task` are re-read from `state.dictation` at each transcribe call, so changing them mid-session takes effect on the next utterance without an engine reload. `engineSelection` changes do require a reload (different worker); the controller handles this by terminating the current worker and re-running preload when the setting changes. (If implementation finds this reload jarring, an alternative is to require a page reload for engine changes but not for language/task — that decision can be made in implementation.)

**Status line:** reflects the currently-loaded engine *and device*, reported by the engine via the new `notice` message (and an init-time report of which device Whisper chose). In Auto mode, if Whisper failed and Parakeet took over, the user sees *why* in Settings without a chat notice interrupting them.

**No advanced controls in UI:** dtype override, model ID override, timeout tuning. Debug-only knobs; the worker already accepts them via the init message. A debug URL param can be added later if needed; not in the Settings UI.

## Cleanup

- Delete `scripts/whisper-quants.mjs` and `scripts/whisper-quants.log` (sweep was invalid; reference stack makes it redundant).
- Remove the `?engine=whisper` URL parsing + `WhisperWorker` import block in `App.tsx` (replaced by the settings-driven preload).
- Remove the `engine kind is hard-coded to "parakeet"…` comment block in `App.tsx` (no longer accurate).

## Tests

`src/dictation/__tests__/controller.test.ts` already exercises `kind: "whisper"`; the contract change to `createWorker(kind)` requires updating it:

- Update the existing `kind: "whisper"` happy-path test to use `engineSelection: "whisper"` and a `createWorker(kind)` factory. Intent preserved.
- New test: `engineSelection: "auto"` + Whisper init failure → controller calls `createWorker("parakeet")`, surfaces the notice, preload resolves successfully.
- New test: `engineSelection: "whisper"` + Whisper init failure → preload rejects with the existing error; no second worker spawn.
- New test: `engineSelection: "parakeet"` → only the Parakeet worker is created; Whisper is never spawned.
- New test: transcribe call passes current `language` and `task` from settings → the `transcribe` message includes them.
- New test: changing `language` mid-session → next transcribe call uses the new language; no worker reload.
- New test: `language: "auto"` → the `transcribe` message either omits `language` or sends `"auto"`, and the worker's call to `transcriber()` does not include `language` in options (so Whisper auto-detects).
- No real-model tests — the existing test suite mocks the worker, as it does for Parakeet.

## Verification (manual, in the browser — not optional)

1. `npm run dev`, open the app, Settings → Dictation → Auto.
2. First load: watch the network panel — `whisper-base_timestamped` (~150 MB on WASM/CPU; larger on WebGPU due to fp32 encoder) fetches from HF, caches in IndexedDB. Status line shows "Whisper loaded (CPU)" (or "(WebGPU)" if enabled).
3. Record a short utterance (5–10 s of real speech), stop, confirm transcript appears. Compare against the same utterance through Parakeet — both should produce coherent text; Whisper should be noticeably faster on this CPU-bound env (Whisper-base is ~74 M params vs Parakeet's 600 M).
4. Force Parakeet mode, repeat — confirms the existing path is unaffected. Language and Task controls should be disabled in this mode.
5. Force Whisper mode, break it (e.g. block HF in DevTools), confirm the error surfaces and there's no silent fallback.
6. Re-run with Whisper blocked at the network layer, Auto mode — confirm Parakeet takes over and the notice fires.
7. **Multilingual**: set Language = Spanish, speak a short Spanish utterance, confirm transcript is in Spanish. Set Task = Translate, repeat — confirm transcript is English. Set Language back to Auto-detect, speak in another language, confirm Whisper auto-detects.
8. **WebGPU** (if available — enable `chrome://flags/#enable-unsafe-webgpu` in Chromium on hardware with a discrete GPU): confirm status line shows "(WebGPU)" and that transcription RTF is meaningfully faster than the WASM/CPU path. If WebGPU isn't available in this env, this step is skipped — the WASM path is the default and is fully tested by step 3.
9. **De-wonk audit.** Run the `de-wonk` skill after the implementation is complete (before declaring the task done). It catches unimplemented stubs, disabled code, broken paths, and weird code that the test suite won't flag — exactly the kind of thing a worker-swap + new Settings section can introduce (dormant imports, unreachable fallback branches, settings that don't actually round-trip, etc.).

If Whisper-base q8 RTF on this CPU-bound env is not meaningfully better than Parakeet's ~1.3–1.7×, that's a follow-up investigation, not a blocker for shipping the engine toggle.

## Out of scope

- Streaming partial transcripts. The standing decision (see streaming-partials-vs-reliability memory) is to ship one-shot transcribe on stop. Not changing.
- Per-utterance fallback. Adds retry/state plumbing inside the audio path. The fallback lives at engine selection, not per-utterance.
- Whisper-large or Whisper-turbo. Whisper-base is the smallest practical model; larger models are a separate size/latency tradeoff decision.
- Manual WebGPU toggle in Settings. WebGPU auto-detects at the browser level; a manual toggle would be redundant.
- Word-level timestamps. `return_timestamps: false` is the chat-composer choice; timestamps are a separate feature.