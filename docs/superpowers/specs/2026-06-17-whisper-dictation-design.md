# Whisper Dictation in the Browser — Design

**Date:** 2026-06-17
**Status:** Approved, ready for implementation plan
**Scope:** Make Whisper work as the primary dictation engine in the browser, with the existing Parakeet engine as a manual fallback selectable from Settings.

## Background and why this isn't a sixth failed attempt

The local dictation feature in `src/dictation/` currently uses Parakeet TDT 0.6B v3 (int8, via `parakeet.js`) and works, but is CPU-bound in this environment (~1.3–1.7× realtime factor). Whisper has been attempted ~5× in this codebase on the pattern "load an HF ONNX model in browser via a JS port," each attempt failing for a different reason. The standing memory warning was to not recommend that pattern again without explicit risk acknowledgement.

Investigation of the latest attempt (the in-tree `worker-whisper.js` re-added after the most recent revert, plus `scripts/whisper-quants.mjs`) found two concrete, fixable implementation bugs rather than an architectural dead end:

1. **v3 API mismatch.** `worker-whisper.js` calls `pipeline("automatic-speech-recognition", modelId, { quantized: <dtype-string> })`. The `quantized` parameter was removed after transformers.js v2; v3 uses `dtype`. v3 silently ignores the unknown `quantized` key and falls through to `dtype: null` (model default). This means the five-row dtype sweep in `scripts/whisper-quants.log` (q8/fp16/fp32/q4/q4f16) all loaded the *same* default model file and produced the *same* error. The "all dtypes fail" conclusion drawn from that log is invalid.

2. **Wrong model variant.** The worker loads `onnx-community/whisper-base`. The transformers.js reference app `whisper-word-timestamps` uses `onnx-community/whisper-base_timestamped` — the variant the transformers.js team actually tests and exports. The plain `whisper-base` q8 export has the broken `decoder.embed_tokens.weight_merged_0_scale` DequantizeLinear scale that the sweep log shows. The `_timestamped` export doesn't.

The architectural pattern works in the reference app. The dev server already sets COOP (`same-origin`) and COEP (`credentialless`) headers correctly, so cross-origin isolation is not the issue. The remaining work is to match the reference stack and wire it into the existing engine + Settings infrastructure.

## Architecture

### Engines

- **Whisper** — primary. `onnx-community/whisper-base_timestamped`, `dtype: "q8"`, WASM/CPU path. Loaded via `@huggingface/transformers` `pipeline()` in `src/dictation/worker-whisper.js`. ~150 MB cached in IndexedDB on first load.
- **Parakeet** — fallback. Unchanged: `istupakov/parakeet-tdt-0.6b-v3-onnx` int8 via `parakeet.js`, ~660 MB in IndexedDB.

Both workers speak the same message protocol (`init` / `transcribe` / `ready` / `result` / `error`) that `src/dictation/worker.js` already defines; `worker-whisper.js` already mirrors it. Both accept the same Float32Array 16 kHz mono PCM contract that `decodeBlobToMono16k` in `controller.js` produces, so the audio path is engine-agnostic.

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

Two edits in the `init` branch:

1. **Model swap.** Default `modelId` changes from `"onnx-community/whisper-base"` → `"onnx-community/whisper-base_timestamped"`.

2. **v3 API fix.** Replace:
   ```js
   {
     quantized: dtype,
     revision: "main",
   }
   ```
   with:
   ```js
   {
     dtype: dtype ?? "q8",
     revision: "main",
   }
   ```
   The `data.dtype` override stays for debug; the default is `"q8"` (single string), matching what `whisper-word-timestamps` uses on the WASM/CPU path.

Unchanged:
- `transformersEnv.allowLocalModels = false`, `useFs = false` (correct for browser).
- `chunk_length_s: 30`, `stride_length_s: 5` (matches reference).
- `return_timestamps: false` (chat-composer use case doesn't need timestamps; matches existing Parakeet path).
- The failure-mode-honesty comment block at the top (still accurate).
- The `transcribe` branch (already passes the Float32Array correctly).

## Engine & controller wiring

### Protocol changes

The worker → engine protocol (`init` / `transcribe` in; `ready` / `result` / `error` out) is unchanged. A new **engine → controller** event `notice` is added for the Auto-fallback signal — the engine emits it (not the worker) when Parakeet takes over from a failed Whisper init. The controller listens for `notice` and forwards the message to the chat notice area and the Settings status line.

### `controller.js`

Add an `engineSelection: "auto" | "whisper" | "parakeet"` field to the preload options (read from Settings — see Settings UI section). The controller passes it through to `engine.preload()` along with the kind-aware `createWorker` factory. The current `App.tsx`-inline `?engine=whisper` URL parsing is removed and replaced by reading `state.dictation.engineSelection` and passing it through.

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
─────────────────────────────────────────
[status line: "Whisper loaded" | "Parakeet loaded (Whisper unavailable)" | "Loading…"]
```

**Persistence:** stored on `ResonantShellState` as `dictation.engineSelection: "auto" | "whisper" | "parakeet"` (default `"auto"`). The existing `commitReadyState` path that the other settings use handles persistence; no new storage layer.

**Read on app boot:** `App.tsx` reads `state.dictation.engineSelection` (defaulting to `"auto"` if unset for backward compat with existing snapshots) and passes it to `preloadDictationEngine({ engineSelection, createWorker, wasmPaths })`. The current inline `?engine=whisper` URL affordance is removed.

**Status line:** reflects the currently-loaded engine, reported by the engine via the new `notice` message. In Auto mode, if Whisper failed and Parakeet took over, the user sees *why* in Settings without a chat notice interrupting them.

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
- No real-model tests — the existing test suite mocks the worker, as it does for Parakeet.

## Verification (manual, in the browser — not optional)

1. `npm run dev`, open the app, Settings → Dictation → Auto.
2. First load: watch the network panel — `whisper-base_timestamped` q8 (~150 MB) fetches from HF, caches in IndexedDB. Status line shows "Whisper loaded".
3. Record a short utterance (5–10 s of real speech), stop, confirm transcript appears. Compare against the same utterance through Parakeet — both should produce coherent text; Whisper should be noticeably faster on this CPU-bound env (Whisper-base is ~74 M params vs Parakeet's 600 M).
4. Force Parakeet mode, repeat — confirms the existing path is unaffected.
5. Force Whisper mode, break it (e.g. block HF in DevTools), confirm the error surfaces and there's no silent fallback.
6. Re-run with Whisper blocked at the network layer, Auto mode — confirm Parakeet takes over and the notice fires.
7. **De-wonk audit.** Run the `de-wonk` skill after the implementation is complete (before declaring the task done). It catches unimplemented stubs, disabled code, broken paths, and weird code that the test suite won't flag — exactly the kind of thing a worker-swap + new Settings section can introduce (dormant imports, unreachable fallback branches, settings that don't actually round-trip, etc.).

If Whisper-base q8 RTF on this CPU-bound env is not meaningfully better than Parakeet's ~1.3–1.7×, that's a follow-up investigation, not a blocker for shipping the engine toggle.

## Out of scope

- WebGPU dtype split (`{encoder_model: "fp32", decoder_model_merged: "q4"}`). Env is CPU-bound; this is premature. Re-evaluate when WebGPU is enabled.
- Streaming partial transcripts. The standing decision (see streaming-partials-vs-reliability memory) is to ship one-shot transcribe on stop. Not changing.
- Per-utterance fallback. Adds retry/state plumbing inside the audio path. The fallback lives at engine selection, not per-utterance.
- Whisper-large or Whisper multilingual/translation. Whisper-base handles English well; multilingual is a separate feature decision.