#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeBrowserLaunchLog } from "../browser-first/host/browser-launch-diagnostics.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const logArg = args.find((arg) => arg !== "--strict");
const logPath = logArg
  ? path.resolve(logArg)
  : path.join(repoRoot, "logs", "browser-first-installed-app.log");

const logContent = await readFile(logPath, "utf8").catch((error) => {
  console.error(JSON.stringify({
    status: "missing-log",
    logPath,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
  return "";
});

if (logContent) {
  const summary = {
    logPath,
    ...summarizeBrowserLaunchLog(logContent),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (strict && summary.status !== "ready") {
    process.exitCode = 2;
  }
}
