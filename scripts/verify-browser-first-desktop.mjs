#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md
//
// Desktop verification runner for the browser-first product path. This script
// is intentionally separate from the individual verifiers so a normal macOS
// Terminal/Finder session can produce one durable evidence report.

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
const dryRun = args.get("dry-run") === "true";
const reportPath = path.resolve(
  args.get("report") ?? path.join(repoRoot, "logs", "browser-first-desktop-verification.json"),
);

const commands = [
  {
    id: "installed-app",
    description: "Launch installed ResonantOS Browser.app and verify CEF/AppKit/bridge/Phantom readiness.",
    command: "npm",
    args: ["run", "browser-first:verify-installed", "--", "--require-native-live=false"],
  },
  {
    id: "native-live",
    description: "Run strict native Chromium live smoke tests with no skipped CEF checks.",
    command: "npm",
    args: ["run", "browser-native:verify-live"],
  },
];

function parseJson(stdout) {
  const text = String(stdout ?? "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function runCommand(step) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      // Preserve normal desktop env; this marker is for downstream reports.
      RESONANTOS_DESKTOP_VERIFICATION: "1",
    },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const parsed = parseJson(stdout);
  return {
    ...step,
    startedAt,
    elapsedMs: Date.now() - startedMs,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    signal: result.signal,
    stdout,
    stderr,
    parsed,
  };
}

function summarize(steps) {
  const failed = steps.filter((step) => step.status !== "passed");
  return {
    status: failed.length ? "attention" : "ready",
    failedSteps: failed.map((step) => step.id),
    passedSteps: steps.filter((step) => step.status === "passed").map((step) => step.id),
  };
}

await mkdir(path.dirname(reportPath), { recursive: true });

if (dryRun) {
  const report = {
    status: "dry-run",
    repoRoot,
    reportPath,
    platform: process.platform,
    arch: process.arch,
    user: os.userInfo().username,
    commands,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const steps = commands.map(runCommand);
const summary = summarize(steps);
const report = {
  ...summary,
  repoRoot,
  reportPath,
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  user: os.userInfo().username,
  steps,
  nextAction: summary.status === "ready"
    ? "Chromium desktop verification passed. The active goal can be completion-audited against this report."
    : "Inspect failed step stdout/stderr in this report, fix the blocker, then rerun npm run browser-first:verify-desktop from normal Terminal.",
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  status: report.status,
  reportPath,
  failedSteps: report.failedSteps,
  passedSteps: report.passedSteps,
  nextAction: report.nextAction,
}, null, 2));

process.exit(report.status === "ready" ? 0 : 2);
