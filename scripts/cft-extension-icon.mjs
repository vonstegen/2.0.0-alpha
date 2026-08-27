// Toggle the ResonantOS extension icon on the Chrome for Testing toolbar.
//
//   node scripts/cft-extension-icon.mjs pin|unpin|status          # dev channel
//   node scripts/cft-extension-icon.mjs pin|unpin|status --stable # stable channel
//
// Chrome must be closed on the target profile first: Chrome rewrites its
// Preferences file on exit and would clobber the change. This script refuses
// to run while a CfT instance is using the profile.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const action = process.argv[2] ?? "status";
if (!["pin", "unpin", "status"].includes(action)) {
  console.error("Usage: node scripts/cft-extension-icon.mjs <pin|unpin|status> [--stable]");
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const stable = process.argv.includes("--stable");
const extensionPath = process.env.RESONANTOS_CFT_EXTENSION_DIR
  ?? path.join(
    repoRoot,
    "browser-first",
    stable ? path.join("release", "resonantos-side-panel-extension") : "resonantos-side-panel-extension",
  );
const profileDir = process.env.RESONANTOS_CFT_PROFILE
  ?? path.join(homedir(), ".resonantos-test", stable ? "cft-profile" : "cft-dev-profile");

const manifest = JSON.parse(await readFile(path.join(extensionPath, "manifest.json"), "utf8"));
if (!manifest?.key) {
  console.error("Extension manifest has no key — extension ID cannot be derived.");
  process.exit(1);
}
const der = Buffer.from(manifest.key, "base64");
const hash = createHash("sha256").update(der).digest().subarray(0, 16);
const alphabet = "abcdefghijklmnop";
const extensionId = [...hash].map((byte) => alphabet[byte >> 4] + alphabet[byte & 15]).join("");

try {
  const running = execSync(`pgrep -f "Google Chrome for Testing.*${profileDir}"`, { encoding: "utf8" }).trim();
  if (running) {
    console.error("Chrome for Testing is running on this profile. Close it first (Ctrl-C in the launcher terminal), then retry — Chrome rewrites Preferences on exit and would undo the change.");
    process.exit(1);
  }
} catch {
  // pgrep found nothing — safe to proceed.
}

if (!existsSync(prefsPath)) {
  console.error(`Preferences not found: ${prefsPath}`);
  console.error(`Run \`node scripts/launch-cft-extension.mjs${stable ? " --stable" : ""}\` once first so the profile exists.`);
  process.exit(1);
}

const prefs = JSON.parse(await readFile(prefsPath, "utf8"));
prefs.extensions ??= {};
prefs.extensions.pinned_extensions ??= [];
const set = new Set(prefs.extensions.pinned_extensions);
const pinned = set.has(extensionId);

if (action === "status") {
  console.log(pinned ? "pinned" : "unpinned");
  process.exit(0);
}

if (action === "pin") set.add(extensionId);
if (action === "unpin") set.delete(extensionId);
prefs.extensions.pinned_extensions = [...set];
await writeFile(prefsPath, JSON.stringify(prefs, null, 2));

console.log(`Extension icon ${action === "pin" ? "pinned to" : "unpinned from"} the ${stable ? "stable" : "dev"} toolbar (${extensionId}).`);
console.log(`Relaunch with \`node scripts/launch-cft-extension.mjs${stable ? " --stable" : ""}\` to see the change.`);
