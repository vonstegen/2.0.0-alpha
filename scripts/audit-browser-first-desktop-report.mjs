#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md
//
// Audits the durable desktop verification report and answers one narrow
// question: does current evidence prove native Chromium readiness?

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function stepById(report, id) {
  return Array.isArray(report?.steps) ? report.steps.find((step) => step?.id === id) : null;
}

function assertReady(condition, issue, issues) {
  if (!condition) {
    issues.push(issue);
  }
}

export function auditBrowserFirstDesktopReport(report) {
  const issues = [];
  const installed = stepById(report, "installed-app");
  const nativeLive = stepById(report, "native-live");
  const installedParsed = installed?.parsed ?? {};
  const nativeParsed = nativeLive?.parsed ?? {};

  assertReady(report?.status === "ready", "Desktop report status is not ready.", issues);
  assertReady(installed?.status === "passed", "Installed app verification step did not pass.", issues);
  assertReady(nativeLive?.status === "passed", "Native live verification step did not pass.", issues);
  assertReady(installedParsed.status === "ready", "Installed app verifier did not report ready.", issues);
  assertReady(nativeParsed.status === "ready", "Native live verifier did not report ready.", issues);
  assertReady(installedParsed.appkitMenu === "installed", "Native AppKit menu was not installed.", issues);
  assertReady(installedParsed.postCefMenuInstalled === true, "Native AppKit menu was not reasserted after CEF.", issues);
  assertReady(installedParsed.cefInitialized === true, "CEF/Chromium did not initialize.", issues);
  assertReady(installedParsed.nativeHostStarted === true, "Native Chromium host did not start.", issues);
  assertReady(installedParsed.mainWorkspaceLoaded === true, "ResonantOS main workspace did not load.", issues);
  assertReady(installedParsed.phantomLoaded === true, "Phantom provider was not detected.", issues);
  assertReady(installedParsed.bridge?.status === "started", "Local bridge did not start.", issues);
  assertReady(installedParsed.pinnedExtensions?.resonantOS === true, "ResonantOS extension was not pinned/detected.", issues);
  assertReady(installedParsed.pinnedExtensions?.phantom === true, "Phantom extension was not pinned/detected.", issues);
  assertReady(Array.isArray(installedParsed.missingMenus) && installedParsed.missingMenus.length === 0, "Native browser menu set is incomplete.", issues);

  const verifiedAreas = Array.isArray(nativeParsed.verified) ? nativeParsed.verified : [];
  for (const required of [
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
  ]) {
    assertReady(verifiedAreas.includes(required), `Native live verifier did not prove ${required}.`, issues);
  }

  return {
    status: issues.length ? "attention" : "ready",
    reportPath: report?.reportPath ?? "",
    generatedAt: report?.generatedAt ?? "",
    issues,
  };
}

async function main() {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, "").split("=");
    return [key, value.length ? value.join("=") : "true"];
  }));
  const reportPath = path.resolve(
    args.get("report") ?? path.join(repoRoot, "logs", "browser-first-desktop-verification.json"),
  );

  const raw = await readFile(reportPath, "utf8").catch((error) => {
    console.log(JSON.stringify({
      status: "attention",
      reportPath,
      issues: [`Could not read desktop verification report: ${error instanceof Error ? error.message : String(error)}`],
    }, null, 2));
    process.exit(2);
  });

  const report = JSON.parse(raw);
  const audit = auditBrowserFirstDesktopReport(report);
  console.log(JSON.stringify(audit, null, 2));
  process.exit(audit.status === "ready" ? 0 : 2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
