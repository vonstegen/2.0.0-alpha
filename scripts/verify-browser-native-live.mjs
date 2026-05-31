#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  "addons/resonant-browser-native/test/native-cef-embed.test.mjs",
  "addons/resonant-browser-native/test/native-cef-smoke.test.mjs",
  "addons/resonant-browser-native/test/native-host-contract.test.mjs",
];

export function summarizeNativeLiveTap(tapText) {
  const skipLines = tapText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /#\s*SKIP\b/i.test(line));
  return {
    skipped: skipLines.length,
    skipLines,
  };
}

if (process.argv.includes("--self-test")) {
  const sample = [
    "ok 1 - native Browser host source satisfies the ADR-025 contract markers",
    "ok 2 - native CEF bridge embeds into a real macOS NSView # SKIP sandbox blocked",
  ].join("\n");
  console.log(JSON.stringify(summarizeNativeLiveTap(sample), null, 2));
  process.exit(0);
}

if (process.env.CODEX_SANDBOX) {
  console.log(JSON.stringify({
    status: "attention",
    reason: "native-live-verification-requires-unsandboxed-desktop",
    issues: [
      "Native Chromium live verification cannot run in the Codex sandbox because CEF profile sockets, helper process IPC, localhost listeners, and AppKit observation are blocked.",
      "Run this command from a normal macOS Terminal/Finder session.",
    ],
    command: "npm run browser-native:verify-live",
  }, null, 2));
  process.exit(2);
}

const result = spawnSync("node", ["--test", "--test-reporter=tap", ...testFiles], {
  cwd: repoRoot,
  encoding: "utf8",
  env: process.env,
  maxBuffer: 1024 * 1024 * 8,
});
const output = `${result.stdout || ""}${result.stderr || ""}`;
const summary = summarizeNativeLiveTap(output);
if (result.status !== 0 || summary.skipped > 0) {
  console.log(JSON.stringify({
    status: "attention",
    exitCode: result.status,
    skipped: summary.skipped,
    skipLines: summary.skipLines,
    issues: [
      result.status !== 0 ? "Native Chromium live tests failed." : "",
      summary.skipped > 0 ? "Native Chromium live verification is incomplete because at least one smoke test was skipped." : "",
    ].filter(Boolean),
    command: "node --test --test-reporter=tap addons/resonant-browser-native/test/*.test.mjs",
  }, null, 2));
  process.exit(result.status || 2);
}

console.log(JSON.stringify({
  status: "ready",
  skipped: 0,
  verified: [
    "native CEF page load",
    "embedded NSView CEF bridge",
    "same-session click/type/scroll",
    "extension entrypoints",
    "downloads",
    "permission denial",
    "context menus",
    "standard browser menu commands",
    "local Manifest V3 extension execution",
    "Phantom provider injection",
  ],
}, null, 2));
