#!/usr/bin/env node
// Copies the onnxruntime-web WASM blobs into public/dictation/ort-wasm/ so the
// parakeet.js worker can load them same-origin. Vite serves `public/` at `/`,
// so the engine can point `ort.env.wasm.wasmPaths = "/dictation/ort-wasm/"`.
//
// Usage:
//   node scripts/install-dictation-ort.mjs
//
// Idempotent. Re-runs cleanly after every `npm install`.

import { cp, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const ORT_DIST = resolve(REPO_ROOT, "node_modules/onnxruntime-web/dist");
const VITE_DEST = resolve(REPO_ROOT, "public/dictation/ort-wasm");
const EXTENSION_DEST = resolve(
  REPO_ROOT,
  "browser-first/resonantos-side-panel-extension/assets/ort-wasm",
);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(ORT_DIST))) {
    console.warn(
      `[install-dictation-ort] onnxruntime-web not found at ${ORT_DIST}. ` +
        "Run `npm install` first. Skipping copy.",
    );
    return;
  }

  await mkdir(VITE_DEST, { recursive: true });

  const entries = await readdir(ORT_DIST);
  const wasmFiles = entries.filter((name) => name.endsWith(".wasm"));
  if (wasmFiles.length === 0) {
    console.warn(
      `[install-dictation-ort] No .wasm files found in ${ORT_DIST}. ` +
        "Skipping copy. The dictation engine will fall back to the jsDelivr CDN at runtime.",
    );
    return;
  }

  for (const name of wasmFiles) {
    await cp(join(ORT_DIST, name), join(VITE_DEST, name));
  }
  console.log(
    `[install-dictation-ort] Copied ${wasmFiles.length} onnxruntime-web WASM blob(s) to ${VITE_DEST}.`,
  );

  // Also drop the same blobs into the extension's `assets/` directory so the
  // extension's worker can fetch them via `chrome.runtime.getURL(...)` under
  // the extension's `web_accessible_resources` manifest entry.
  await mkdir(EXTENSION_DEST, { recursive: true });
  for (const name of wasmFiles) {
    await cp(join(ORT_DIST, name), join(EXTENSION_DEST, name));
  }
  console.log(
    `[install-dictation-ort] Copied ${wasmFiles.length} onnxruntime-web WASM blob(s) to ${EXTENSION_DEST}.`,
  );
}

main().catch((error) => {
  console.error("[install-dictation-ort] Failed:", error);
  process.exit(1);
});
