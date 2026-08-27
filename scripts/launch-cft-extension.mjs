// Launch Chrome for Testing with the ResonantOS extension loaded, on a
// dedicated profile that is separate from the human's normal Chrome profile.
//
// Two channels, one shared bridge:
//   dev    (default) — the live UI workbench in browser-first/resonantos-side-panel-extension
//   stable (--stable) — the frozen SDK workbench in browser-first/release/resonantos-side-panel-extension
//
// Purpose: SDK building/testing runs against the frozen stable workbench while
// UI repainting happens freely on the dev channel. Each channel gets its own
// profile and CDP port so both can run side by side.
//
// Usage:
//   npm run browser-first:bridge        # terminal 1 — the local bridge (shared)
//   npm run cft:extension               # terminal 2 — dev workbench (UI work)
//   npm run cft:stable                  # terminal 2 — stable workbench (SDK testing)
//   npm run cft:extension -- --fresh    # wipe the channel profile first
//
// Environment:
//   RESONANTOS_CFT_PATH     path to a Chrome for Testing binary (optional;
//                           defaults to the playwright cache, then /Applications)
//   RESONANTOS_CFT_PROFILE  profile directory override (default per channel:
//                           dev → ~/.resonantos-test/cft-dev-profile,
//                           stable → ~/.resonantos-test/cft-profile)
//   RESONANTOS_CFT_EXTENSION_DIR extension directory override (default per channel)
//   RESONANTOS_CFT_DEBUG_PORT remote-debugging port (default dev → 9224, stable → 9225)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const stable = process.argv.includes("--stable");
const channel = stable ? "stable" : "dev";
const extensionPath = process.env.RESONANTOS_CFT_EXTENSION_DIR
  ?? path.join(
    repoRoot,
    "browser-first",
    stable ? path.join("release", "resonantos-side-panel-extension") : "resonantos-side-panel-extension",
  );
const profileDir = process.env.RESONANTOS_CFT_PROFILE
  ?? path.join(homedir(), ".resonantos-test", stable ? "cft-profile" : "cft-dev-profile");
const debugPort = process.env.RESONANTOS_CFT_DEBUG_PORT ?? (stable ? "9225" : "9224");
const fresh = process.argv.includes("--fresh");

function candidateBins() {
  const explicit = process.env.RESONANTOS_CFT_PATH;
  if (explicit && existsSync(explicit)) return [explicit];
  const bins = [];
  if (explicit) bins.push(explicit);
  const pw = path.join(homedir(), "Library", "Caches", "ms-playwright");
  for (const entry of ["chromium-1223", "chromium-1217", "chromium-1200", "chromium"]) {
    for (const layout of [
      ["chrome-mac-arm64", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"],
      ["chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"],
      ["chrome-mac-arm64", "Chromium.app", "Contents", "MacOS", "Chromium"],
    ]) {
      bins.push(path.join(pw, entry, ...layout));
    }
  }
  bins.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  bins.push("/Applications/Chromium.app/Contents/MacOS/Chromium");
  return bins;
}

const chromeBin = candidateBins().find((candidate) => existsSync(candidate));
if (!chromeBin) {
  console.error("No Chrome for Testing binary found. Set RESONANTOS_CFT_PATH to the binary path.");
  process.exit(1);
}

const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));
if (!manifest?.key) {
  console.error("Extension manifest has no key — extension ID cannot be derived.");
  process.exit(1);
}
const der = Buffer.from(manifest.key, "base64");
const hash = createHash("sha256").update(der).digest().subarray(0, 16);
const alphabet = "abcdefghijklmnop";
const extensionId = [...hash].map((byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join("");

if (fresh) {
  await rm(profileDir, { recursive: true, force: true });
  console.log(`Fresh profile: ${profileDir}`);
} else {
  console.log(`Profile (reused): ${profileDir}`);
}
console.log(`Channel: ${channel} (${stable ? "frozen SDK workbench" : "live UI workbench"})`);

// Pin the extension to the toolbar so the pin is part of the saved profile
// state. Chrome records toolbar pins in the profile's Preferences file and
// rewrites that file on exit — so patch it BEFORE launching. `--unpin`
// reverses it (icon goes back into the puzzle menu).
const unpin = process.argv.includes("--unpin");
const prefsPath = path.join(profileDir, "Default", "Preferences");
try {
  let prefs;
  if (existsSync(prefsPath)) {
    prefs = JSON.parse(await readFile(prefsPath, "utf8"));
  } else {
    // Fresh profile: seed a Preferences file so the pin applies on the
    // very first launch instead of the second.
    prefs = {};
  }
  prefs.extensions ??= {};
  prefs.extensions.pinned_extensions ??= [];
  const set = new Set(prefs.extensions.pinned_extensions);
  if (unpin) set.delete(extensionId);
  else set.add(extensionId);
  prefs.extensions.pinned_extensions = [...set];
  await writeFile(prefsPath, JSON.stringify(prefs, null, 2));
  console.log(`Extension icon ${unpin ? "unpinned from" : "pinned to"} the toolbar (${extensionId}).`);
} catch (error) {
  console.warn(`Could not update the extension pin: ${error.message}`);
}

const workspaceUrl = `chrome-extension://${extensionId}/src/main-workspace.html`;

const args = [
  `--user-data-dir=${profileDir}`,
  `--load-extension=${extensionPath}`,
  `--disable-extensions-except=${extensionPath}`,
  `--remote-debugging-port=${debugPort}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--no-pdf-header-footer",
  workspaceUrl,
];

const child = spawn(chromeBin, args, { stdio: "inherit", detached: false });
child.on("exit", (code) => {
  console.log(`Chrome for Testing exited (${code ?? "signal"}).`);
  process.exit(code ?? 0);
});

console.log("");
console.log(`Chrome for Testing — ${channel.toUpperCase()} channel (isolated profile; normal Chrome untouched):`);
console.log(`  Channel: ${channel} — ${stable ? "frozen SDK workbench (browser-first/release)" : "live UI workbench (browser-first/resonantos-side-panel-extension)"}`);
console.log(`  Extension ID: ${extensionId}`);
console.log(`  Main workspace: chrome-extension://${extensionId}/src/main-workspace.html`);
console.log(`  Side panel page: chrome-extension://${extensionId}/src/side-panel.html`);
console.log(`  CDP: http://127.0.0.1:${debugPort}/json`);
console.log("");
console.log("Keep `npm run browser-first:bridge` running in another terminal.");
console.log("Ctrl-C here closes CfT.");
