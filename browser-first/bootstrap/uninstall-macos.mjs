// CP-BR1: macOS removal for the ResonantOS bridge bootstrap native host.
//
// Removes the per-user wrapper script and Chrome native-host manifest
// written by install-macos.mjs, and the support directory when empty.
// Idempotent: missing files are not an error. It never touches the bridge,
// the extension, generated bridge config, or user state.
//
// CLI:
//   node browser-first/bootstrap/uninstall-macos.mjs [--print]

import { existsSync, rmSync, rmdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveInstallPaths } from "./install-macos.mjs";

/**
 * Remove the installed native-host files.
 *
 * @param {{
 *   homeDir?: string,
 *   dryRun?: boolean,
 *   existsSyncImpl?: typeof existsSync,
 *   rmSyncImpl?: typeof rmSync,
 *   rmdirSyncImpl?: typeof rmdirSync,
 * }} [options]
 * @returns {{ ok: true, removed: string[], kept: string[] }}
 */
export function uninstallBootstrapNativeHost({
  homeDir,
  dryRun = false,
  existsSyncImpl = existsSync,
  rmSyncImpl = rmSync,
  rmdirSyncImpl = rmdirSync,
} = {}) {
  const paths = resolveInstallPaths({ homeDir: homeDir ?? os.homedir() });
  const removed = [];
  const kept = [];
  for (const target of [paths.wrapperPath, paths.manifestPath]) {
    if (!existsSyncImpl(target)) {
      kept.push(target);
      continue;
    }
    if (!dryRun) rmSyncImpl(target, { force: true });
    removed.push(target);
  }
  if (!dryRun && existsSyncImpl(paths.supportDir)) {
    try {
      rmdirSyncImpl(paths.supportDir); // only succeeds when empty
    } catch {
      // support directory holds other files; leave it
    }
  }
  return { ok: true, removed, kept };
}

const isMain = (() => {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
})();

if (isMain) {
  const dryRun = process.argv.slice(2).includes("--print");
  const result = uninstallBootstrapNativeHost({ dryRun });
  console.log(JSON.stringify({
    mode: dryRun ? "dry run (no files removed)" : "removed",
    removed: result.removed,
    kept: result.kept,
  }, null, 2));
}
