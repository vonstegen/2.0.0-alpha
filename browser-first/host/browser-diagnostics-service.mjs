import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { summarizeBrowserLaunchLog } from "./browser-launch-diagnostics.mjs";

export function createBrowserDiagnosticsService({
  repoRoot,
  resonantExtension,
  userRoot,
  browserFirstRoot,
  memoryRoot,
  profileDir,
  browserLaunchLogPath,
  executeSystemStatus,
  executeProviderStatus,
  executeAddonsStatus,
  executeMemoryStatus,
  redactPathForDiagnostics,
  redactDiagnosticText,
} = {}) {
  function assertDependency(name, value) {
    if (!value) {
      throw new Error(`Browser diagnostics service missing dependency: ${name}`);
    }
  }
  for (const [name, value] of Object.entries({
    repoRoot,
    resonantExtension,
    userRoot,
    browserFirstRoot,
    memoryRoot,
    profileDir,
    browserLaunchLogPath,
    executeSystemStatus,
    executeProviderStatus,
    executeAddonsStatus,
    executeMemoryStatus,
    redactPathForDiagnostics,
    redactDiagnosticText,
  })) {
    assertDependency(name, value);
  }

  function diagnosticsRoot() {
    return path.join(browserFirstRoot(), "Diagnostics");
  }

  function browserDownloadsRoot() {
    return path.join(os.homedir(), "Downloads");
  }

  function browserDownloadsStatePath() {
    return path.join(browserFirstRoot(), "downloads-state.json");
  }

  async function browserDownloadsState() {
    if (!existsSync(browserDownloadsStatePath())) {
      return {};
    }
    try {
      return JSON.parse(await readFile(browserDownloadsStatePath(), "utf8"));
    } catch {
      return {};
    }
  }

  async function writeBrowserDownloadsState(state) {
    await mkdir(browserFirstRoot(), { recursive: true });
    await writeFile(browserDownloadsStatePath(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }

  function resolveDownloadFile(nameOrPath) {
    const root = path.resolve(browserDownloadsRoot());
    const raw = String(nameOrPath ?? "").trim();
    if (!raw) {
      throw new Error("Download action requires a file name.");
    }
    const unredacted = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
    const candidate = path.isAbsolute(unredacted)
      ? path.resolve(unredacted)
      : path.resolve(root, unredacted);
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
      throw new Error("Download action is limited to files inside the browser downloads folder.");
    }
    return candidate;
  }

  function launchDetached(command, args) {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  async function openOrRevealDownload(filePath, action) {
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile?.()) {
      throw new Error("Download file was not found.");
    }
    if (process.platform === "darwin") {
      launchDetached("open", action === "reveal" ? ["-R", filePath] : [filePath]);
      return;
    }
    if (process.platform === "win32") {
      if (action === "reveal") {
        launchDetached("explorer.exe", ["/select,", filePath]);
      } else {
        launchDetached("cmd.exe", ["/c", "start", "", filePath]);
      }
      return;
    }
    launchDetached("xdg-open", [action === "reveal" ? path.dirname(filePath) : filePath]);
  }

  async function readPackageVersion() {
    try {
      const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
      return String(pkg.version ?? "unknown");
    } catch {
      return "unknown";
    }
  }

  async function readExtensionVersion() {
    try {
      const manifest = JSON.parse(await readFile(path.join(resonantExtension, "manifest.json"), "utf8"));
      return String(manifest.version ?? "unknown");
    } catch {
      return "unknown";
    }
  }

  async function executeBrowserLaunchDiagnostics() {
    const logPath = browserLaunchLogPath();
    let logContent = "";
    let logStat = null;
    try {
      [logContent, logStat] = await Promise.all([
        readFile(logPath, "utf8"),
        stat(logPath),
      ]);
    } catch (error) {
      return {
        status: "missing-log",
        logPath: redactPathForDiagnostics(logPath),
        error: redactDiagnosticText(error instanceof Error ? error.message : error),
      };
    }
    return {
      ...summarizeBrowserLaunchLog(logContent),
      logPath: redactPathForDiagnostics(logPath),
      updatedAt: logStat?.mtime?.toISOString?.() ?? "",
    };
  }

  async function executeDiagnosticsReport() {
    const generatedAt = new Date().toISOString();
    const [statusResult, providerResult, addonResult, memoryResult, browserLaunchResult] = await Promise.allSettled([
      executeSystemStatus(),
      executeProviderStatus(),
      executeAddonsStatus(),
      executeMemoryStatus(),
      executeBrowserLaunchDiagnostics(),
    ]);
    const settledValue = (result) => result.status === "fulfilled"
      ? result.value
      : { unavailable: true, error: redactDiagnosticText(result.reason instanceof Error ? result.reason.message : result.reason) };
    const providers = settledValue(providerResult).providers ?? [];
    const addons = settledValue(addonResult).addons ?? [];
    const memory = settledValue(memoryResult);
    const report = {
      generatedAt,
      product: "ResonantOS Browser",
      version: await readPackageVersion(),
      extensionVersion: await readExtensionVersion(),
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version,
      },
      paths: {
        userRoot: redactPathForDiagnostics(userRoot()),
        browserFirstRoot: redactPathForDiagnostics(browserFirstRoot()),
        memoryRoot: redactPathForDiagnostics(memoryRoot()),
        profileDir: redactPathForDiagnostics(profileDir),
      },
      status: settledValue(statusResult),
      providers: {
        total: providers.length,
        configured: providers.filter((provider) => provider.configured).length,
        entries: providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          configured: Boolean(provider.configured),
          models: provider.models ?? [],
          role: provider.role ?? "",
        })),
      },
      addons: {
        total: addons.length,
        available: addons.filter((addon) => addon.available || addon.enabled).length,
        entries: addons.map((addon) => ({
          id: addon.id,
          name: addon.name,
          available: Boolean(addon.available || addon.enabled),
          mode: addon.mode,
          trust: addon.trust,
        })),
      },
      memory: {
        wikiPages: memory?.wiki?.pages ?? 0,
        intakeArtifacts: memory?.intake?.artifacts ?? 0,
        reviewRequests: memory?.review?.requests ?? 0,
        reviewArtifacts: memory?.review?.artifacts ?? 0,
      },
      browserLaunch: settledValue(browserLaunchResult),
      redaction: "Provider credentials, bridge tokens, wallet secrets, private keys, and full home paths are excluded or redacted.",
    };
    const serialized = redactDiagnosticText(JSON.stringify(report, null, 2));
    await mkdir(diagnosticsRoot(), { recursive: true });
    const filePath = path.join(diagnosticsRoot(), `diagnostics-${generatedAt.replace(/[:.]/g, "-")}.json`);
    await writeFile(filePath, `${serialized}\n`, { mode: 0o600 });
    return {
      path: redactPathForDiagnostics(filePath),
      generatedAt,
      summary: {
        providers: report.providers,
        addons: report.addons,
        memory: report.memory,
        browserLaunch: report.browserLaunch,
      },
    };
  }

  async function executeBrowserDownloads() {
    const root = browserDownloadsRoot();
    const state = await browserDownloadsState();
    const clearedAtMs = Number.isFinite(Date.parse(state.clearedAt ?? ""))
      ? Date.parse(state.clearedAt)
      : 0;
    if (!existsSync(root)) {
      return {
        root: redactPathForDiagnostics(root),
        entries: [],
        total: 0,
        clearedAt: state.clearedAt ?? "",
      };
    }
    const names = await readdir(root).catch(() => []);
    const entries = [];
    for (const name of names) {
      if (!name || name.startsWith(".")) {
        continue;
      }
      const filePath = path.join(root, name);
      const fileStat = await stat(filePath).catch(() => null);
      if (!fileStat?.isFile?.()) {
        continue;
      }
      if (clearedAtMs && fileStat.mtime.getTime() <= clearedAtMs) {
        continue;
      }
      entries.push({
        name,
        path: redactPathForDiagnostics(filePath),
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
      });
    }
    entries.sort((left, right) => String(right.modifiedAt).localeCompare(String(left.modifiedAt)));
    return {
      root: redactPathForDiagnostics(root),
      entries: entries.slice(0, 20),
      total: entries.length,
      clearedAt: state.clearedAt ?? "",
    };
  }

  async function executeBrowserDownloadAction(payload = {}) {
    const action = String(payload.action ?? "").trim();
    if (action === "clear-history") {
      const clearedAt = new Date().toISOString();
      await writeBrowserDownloadsState({ clearedAt });
      return {
        action,
        clearedAt,
        message: "Download history was cleared. Files were not deleted.",
      };
    }
    if (action !== "open" && action !== "reveal") {
      throw new Error("Unsupported download action.");
    }
    const filePath = resolveDownloadFile(payload.name ?? payload.path);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile?.()) {
      throw new Error("Download file was not found.");
    }
    if (!payload.dryRun) {
      await openOrRevealDownload(filePath, action);
    }
    return {
      action,
      dryRun: Boolean(payload.dryRun),
      name: path.basename(filePath),
      path: redactPathForDiagnostics(filePath),
    };
  }

  return {
    browserDownloadsRoot,
    executeBrowserDownloadAction,
    executeBrowserDownloads,
    executeBrowserLaunchDiagnostics,
    executeDiagnosticsReport,
  };
}
