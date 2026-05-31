#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-037-browser-first-chromium-resonantos.md

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeBrowserLaunchLog } from "../browser-first/host/browser-launch-diagnostics.mjs";
import {
  canFallbackToDirectLauncher,
  isLaunchServicesExecutableBlocked,
  isLocalBridgeSandboxBlocked
} from "../browser-first/host/installed-app-verifier-utils.mjs";
import { validateBrowserFirstNativeAssets } from "./browser-first-native-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
const defaultInstallRoot = path.join(os.homedir(), "Applications");
const appPath = path.resolve(args.get("app") ?? path.join(defaultInstallRoot, "ResonantOS Browser.app"));
const logPath = path.resolve(args.get("log") ?? path.join(repoRoot, "logs", "browser-first-installed-app.log"));
const timeoutMs = Number(args.get("timeout-ms") ?? 45_000);
const pollMs = Number(args.get("poll-ms") ?? 1_000);
const skipLaunch = args.get("no-launch") === "true";
const launchMode = args.get("launch-mode") ?? "direct";
const proofProfile = path.resolve(
  args.get("profile") ?? path.join(repoRoot, "logs", "browser-first-proof-profile"),
);
const requireNativeLive = args.has("require-native-live")
  ? args.get("require-native-live") === "true"
  : !skipLaunch;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function summarizeLog() {
  const logContent = await readFile(logPath, "utf8").catch(() => "");
  return {
    logPath,
    ...summarizeBrowserLaunchLog(logContent),
  };
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function runProbe(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  return {
    command,
    args,
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout?.trim() ?? "",
    stderr: result.stderr?.trim() ?? "",
  };
}

function hasExtendedAttribute(xattrOutput, attributeName) {
  return new RegExp(`(?:^|\\n)[^\\n:]+:\\s*${attributeName}:`).test(String(xattrOutput));
}

async function inspectInstalledAppBundle(targetAppPath) {
  const executablePath = path.join(targetAppPath, "Contents", "MacOS", "ResonantOSBrowserLauncher");
  const infoPlistPath = path.join(targetAppPath, "Contents", "Info.plist");
  const launcherSourcePath = path.join(targetAppPath, "Contents", "Resources", "ResonantOSBrowserLauncher.c");
  const infoPlist = await readFile(infoPlistPath, "utf8").catch(() => "");
  const launcherSource = await readFile(launcherSourcePath, "utf8").catch(() => "");
  const expectedLaunchScriptPath = path.join(repoRoot, "browser-first", "host", "run-browser-first.mjs");
  const xattrs = runProbe("xattr", ["-lr", targetAppPath]);
  const codesign = runProbe("codesign", ["--verify", "--deep", "--strict", "--verbose=2", targetAppPath]);
  const plistLint = runProbe("plutil", ["-lint", infoPlistPath]);
  const executableFile = runProbe("file", [executablePath]);
  return {
    appPath: targetAppPath,
    exists: await pathExists(targetAppPath),
    executablePath,
    executableExists: await pathExists(executablePath),
    infoPlistPath,
    infoPlistExists: Boolean(infoPlist),
    bundleExecutableDeclared: /<key>CFBundleExecutable<\/key>\s*<string>ResonantOSBrowserLauncher<\/string>/.test(infoPlist),
    launcherSourcePath,
    launcherSourceExists: Boolean(launcherSource),
    launcherRepoRootMatches: launcherSource.includes(JSON.stringify(repoRoot)),
    launcherScriptMatches: launcherSource.includes(JSON.stringify(expectedLaunchScriptPath)),
    launcherLogPathMatches: launcherSource.includes(JSON.stringify(logPath)),
    launcherUsesExec: /execlp\("node", "node"/.test(launcherSource),
    launcherForksAndExits: /fork\(\)|setsid\(\)/.test(launcherSource),
    diagnostics: {
      xattrs: {
        ok: xattrs.ok,
        hasQuarantine: hasExtendedAttribute(xattrs.stdout, "com.apple.quarantine"),
        hasProvenance: hasExtendedAttribute(xattrs.stdout, "com.apple.provenance"),
        stderr: xattrs.stderr,
      },
      codesign: {
        ok: codesign.ok,
        stderr: codesign.stderr,
        stdout: codesign.stdout,
      },
      plistLint: {
        ok: plistLint.ok,
        stderr: plistLint.stderr,
        stdout: plistLint.stdout,
      },
      executableFile: {
        ok: executableFile.ok,
        stdout: executableFile.stdout,
        stderr: executableFile.stderr,
      },
    },
  };
}

function launchInstalledApp() {
  return new Promise((resolve, reject) => {
    const child = spawn("open", ["-n", appPath], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        code,
        message: stderr.trim() || `open exited ${code}`,
      });
    });
  });
}

function launchInstalledExecutable(executablePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, [], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RESONANTOS_BROWSER_FIRST_PROFILE: proofProfile,
      },
      stdio: "pipe",
    });
    let stderr = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }
      finish({
        ok: false,
        code,
        message: stderr.trim() || `launcher exited ${code}`,
      });
    });
    setTimeout(() => {
      finish({ ok: true, fallback: "direct-installed-executable", pid: child.pid });
    }, 750);
  });
}

function cleanupProofBrowser() {
  if (!proofProfile || launchMode === "open") {
    return;
  }
  const ps = spawnSync("ps", ["-axo", "pid=,command="], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const pids = String(ps.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(`--resonantos-user-data-dir=${proofProfile}`))
    .map((line) => Number(line.split(/\s+/, 1)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) {
    spawnSync("kill", ["-TERM", String(pid)], { stdio: "ignore" });
  }
  if (pids.length) {
    spawnSync("sleep", ["0.3"], { stdio: "ignore" });
  }
  for (const pid of pids) {
    spawnSync("kill", ["-KILL", String(pid)], { stdio: "ignore" });
  }
}

function runNativeLiveVerifier() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "verify-browser-native-live.mjs")], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      let result = null;
      try {
        result = JSON.parse(stdout || "{}");
      } catch {
        result = {
          status: "attention",
          issues: ["Native Chromium live verifier did not return JSON."],
          stdout,
          stderr,
        };
      }
      resolve({
        ok: code === 0 && result.status === "ready",
        code,
        result,
        stderr,
      });
    });
  });
}

await mkdir(path.dirname(logPath), { recursive: true });
const nativeAssets = await validateBrowserFirstNativeAssets({ repoRoot });
if (!nativeAssets.ok) {
  console.log(JSON.stringify({
    appPath,
    elapsedMs: 0,
    logPath,
    status: "attention",
    issues: nativeAssets.issues,
    nativeAssets: {
      status: "failed",
      nextAction: nativeAssets.nextAction,
    },
  }, null, 2));
  process.exit(2);
}

let launchResult = { ok: true };
let installedApp = null;
if (!skipLaunch) {
  installedApp = await inspectInstalledAppBundle(appPath);
  if (
    !installedApp.exists ||
    !installedApp.executableExists ||
    !installedApp.bundleExecutableDeclared ||
    !installedApp.launcherSourceExists ||
    !installedApp.launcherRepoRootMatches ||
    !installedApp.launcherScriptMatches ||
    !installedApp.launcherLogPathMatches ||
    !installedApp.launcherUsesExec ||
    installedApp.launcherForksAndExits ||
    !installedApp.diagnostics.codesign.ok ||
    !installedApp.diagnostics.plistLint.ok ||
    installedApp.diagnostics.xattrs.hasQuarantine
  ) {
    console.log(JSON.stringify({
      appPath,
      elapsedMs: 0,
      logPath,
      status: "attention",
      issues: [
        !installedApp.exists ? `Installed app bundle is missing: ${appPath}` : "",
        !installedApp.executableExists ? `Installed app executable is missing: ${installedApp.executablePath}` : "",
        !installedApp.bundleExecutableDeclared ? "Installed app Info.plist does not declare ResonantOSBrowserLauncher as CFBundleExecutable." : "",
        !installedApp.launcherSourceExists ? `Installed app launcher source is missing: ${installedApp.launcherSourcePath}` : "",
        !installedApp.launcherRepoRootMatches ? "Installed app launcher does not point at the current repository root." : "",
        !installedApp.launcherScriptMatches ? "Installed app launcher does not point at the current browser-first launch script." : "",
        !installedApp.launcherLogPathMatches ? "Installed app launcher does not write to the current browser-first launch log." : "",
        !installedApp.launcherUsesExec ? "Installed app launcher must exec the browser host so the app lifecycle stays attached to the browser session." : "",
        installedApp.launcherForksAndExits ? "Installed app launcher still forks and exits, which can make Launch Services/Dock lifecycle unreliable." : "",
        !installedApp.diagnostics.codesign.ok ? "Installed app code signature verification failed." : "",
        !installedApp.diagnostics.plistLint.ok ? "Installed app Info.plist lint failed." : "",
        installedApp.diagnostics.xattrs.hasQuarantine ? "Installed app still has com.apple.quarantine metadata." : "",
        "Run npm run browser-first:install, then rerun this verifier from a normal macOS Terminal or Finder session.",
      ].filter(Boolean),
      installedApp,
    }, null, 2));
    process.exit(2);
  }

  cleanupProofBrowser();
  await rm(logPath, { force: true });
  await rm(proofProfile, { recursive: true, force: true });
  await writeFile(logPath, "");
  launchResult = launchMode === "open"
    ? await launchInstalledApp()
    : await launchInstalledExecutable(installedApp.executablePath);
  if (!launchResult.ok) {
    const launchServicesBlocked = isLaunchServicesExecutableBlocked(launchResult.message);
    if (launchServicesBlocked && canFallbackToDirectLauncher(installedApp)) {
      const directLaunch = await launchInstalledExecutable(installedApp.executablePath);
      if (directLaunch.ok) {
        launchResult = {
          ok: true,
          fallback: "direct-installed-executable",
          launchServicesMessage: launchResult.message,
        };
      } else {
        launchResult = {
          ...directLaunch,
          fallback: "direct-installed-executable",
          launchServicesMessage: launchResult.message,
        };
      }
    }
  }
  if (!launchResult.ok) {
    const summary = await summarizeLog();
    const launchServicesBlocked = isLaunchServicesExecutableBlocked(launchResult.message) ||
      isLaunchServicesExecutableBlocked(launchResult.launchServicesMessage);
    const bridgeSandboxBlocked = isLocalBridgeSandboxBlocked(summary);
    const summaryIssues = bridgeSandboxBlocked
      ? summary.issues.filter((issue) => /Local bridge/i.test(issue))
      : summary.issues;
    console.log(JSON.stringify({
      appPath,
      elapsedMs: 0,
      ...summary,
      status: "attention",
      issues: [
        bridgeSandboxBlocked
          ? `Installed app launch reached a restricted local bridge boundary: ${summary.bridge.message}`
          : `Installed app launch failed: ${launchResult.message}`,
        bridgeSandboxBlocked
          ? "This Codex/sandbox environment blocked the localhost bridge before CEF could start; rerun from a normal macOS Terminal or Finder session before treating menus, Phantom, or workspace readiness as app failures."
          : "",
        launchServicesBlocked
          ? "LaunchServices can report this inside restricted automation sandboxes even when the app executable is present; the installedApp field below records the bundle/executable preflight result. Rerun from a normal macOS Terminal or Finder."
          : "",
        ...summaryIssues,
      ].filter(Boolean),
      environmentBoundary: bridgeSandboxBlocked
        ? {
            type: "sandbox-localhost-bind",
            code: summary.bridge.code,
            message: summary.bridge.message,
          }
        : null,
      installedApp,
      launch: {
        status: "failed",
        code: launchResult.code,
        fallback: launchResult.fallback ?? "",
        launchServicesBlocked,
        launchServicesMessage: launchResult.launchServicesMessage ?? "",
        message: launchResult.message,
      },
    }, null, 2));
    process.exit(2);
  }
}

const startedAt = Date.now();
let summary = await summarizeLog();
while (Date.now() - startedAt < timeoutMs) {
  summary = await summarizeLog();
  if (summary.status === "ready") {
    cleanupProofBrowser();
    const nativeLive = requireNativeLive ? await runNativeLiveVerifier() : { ok: true, result: { status: "skipped" } };
    if (!nativeLive.ok) {
      console.log(JSON.stringify({
        appPath,
        elapsedMs: Date.now() - startedAt,
        ...summary,
        status: "attention",
        issues: [
          "Installed app launch diagnostics are ready, but strict native Chromium live verification did not pass.",
          ...(nativeLive.result?.issues ?? []),
          nativeLive.stderr ? `Native live verifier stderr: ${nativeLive.stderr}` : "",
        ].filter(Boolean),
        nativeLive: nativeLive.result,
      }, null, 2));
      process.exit(2);
    }
    console.log(JSON.stringify({
      appPath,
      elapsedMs: Date.now() - startedAt,
      ...summary,
      nativeLive: nativeLive.result,
    }, null, 2));
    process.exit(0);
  }
  await sleep(pollMs);
}

console.log(JSON.stringify({
  appPath,
  elapsedMs: Date.now() - startedAt,
  ...summary,
  launch: launchResult.fallback ? {
    status: "fallback-used",
    fallback: launchResult.fallback,
    launchServicesMessage: launchResult.launchServicesMessage ?? "",
  } : undefined,
}, null, 2));
cleanupProofBrowser();
process.exit(2);
