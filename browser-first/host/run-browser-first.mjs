import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  createBridgeToken,
  getBridgeHost,
  getBridgePublicUrl,
  startBridgeServerWithFallback,
  writeBridgeConfig,
} from "./bridge-server.mjs";
import {
  countFiles,
  dashboardTarget,
  execFileStdout,
  expandUserPath,
  firstExistingExecutable,
  isInsidePath,
  listFilesRecursive,
  parseArgs,
  pathSummary,
  redactDiagnosticText,
  redactPathForDiagnostics,
  safeFileSlug,
  socketOpen,
  stableMemorySourceId,
  uniqueRuntimeId,
} from "./browser-first-host-utils.mjs";
import { runBrowserFirstSelfTest } from "./browser-first-self-test-service.mjs";
import { createAgentControlHostService } from "./agent-control-host-service.mjs";
import { createAddonDelegationHostService } from "./addon-delegation-host-service.mjs";
import { createAddonDelegationService } from "./addon-delegation-service.mjs";
import { createArchiveReviewHostService } from "./archive-review-host-service.mjs";
import { createBrowserDiagnosticsHostService } from "./browser-diagnostics-host-service.mjs";
import { createExtensionPrefsHostService } from "./extension-prefs-host-service.mjs";
import { createMemoryHostService } from "./memory-host-service.mjs";
import { createMemorySourceIntakeHostService } from "./memory-source-intake-host-service.mjs";
import { opencodeCommand, opencodeRuntimeDiagnostics } from "./opencode-runtime.mjs";
import {
  findChromiumExtension,
  removeCachedUnpackedExtension,
  seedPinnedExtensions,
  seedResonantStartupExperience,
} from "./browser-profile-service.mjs";
import { createMemorySourceSettingsService } from "./memory-source-settings-service.mjs";
import { resolveBrowserProfile, resolveRemoteDebugging } from "./browser-launch-config.mjs";
import { createProviderHostService } from "./provider-host-service.mjs";
import {
  memorySourceMoveHistoryPath as sourceMoveHistoryPath,
  memorySourceRepairHistoryPath as sourceRepairHistoryPath,
  memorySourceSyncHistoryPath as sourceSyncHistoryPath,
} from "./memory-source-history.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const hostBinary = path.join(
  repoRoot,
  "addons",
  "resonant-browser-native",
  "build",
  "ResonantBrowserNativeHost.app",
  "Contents",
  "MacOS",
  "ResonantBrowserNativeHost",
);
const hostAppBundle = path.join(
  repoRoot,
  "addons",
  "resonant-browser-native",
  "build",
  "ResonantBrowserNativeHost.app",
);
const resonantExtension = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");
const defaultProfile = path.join(os.homedir(), "ResonantOS_User", "BrowserFirst", "Profiles", "main");
const phantomExtensionId = "bfnaelmomeimhlpmgjnjophhpkkoljpa";
const resonantExtensionId = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const defaultBridgePort = 47773;
const resonantExtensionOrigin = `chrome-extension://${resonantExtensionId}`;
const defaultMainWorkspaceUrl = `${resonantExtensionOrigin}/src/main-workspace.html`;

const args = parseArgs(process.argv.slice(2));

function findPhantomExtension() {
  return findChromiumExtension({
    extensionId: phantomExtensionId,
    overrideEnvName: "RESONANTOS_PHANTOM_EXTENSION_DIR",
  });
}

function userRoot() {
  return path.resolve(process.env.RESONANTOS_BROWSER_FIRST_USER_ROOT || path.join(os.homedir(), "ResonantOS_User"));
}

function memoryRoot() {
  return path.join(userRoot(), "Memory");
}

function memorySettingsPath() {
  return path.join(memoryRoot(), "CONFIG", "memory-settings.json");
}

function memorySourceAuditPath() {
  return path.join(memoryRoot(), "CONFIG", "source-audit.md");
}

function memorySourceFileManifestPath() {
  return path.join(memoryRoot(), "CONFIG", "source-file-versions.json");
}

function memorySourceSyncHistoryPath() {
  return sourceSyncHistoryPath(memoryRoot());
}

function memorySourceRepairHistoryPath() {
  return sourceRepairHistoryPath(memoryRoot());
}

function memorySourceMoveHistoryPath() {
  return sourceMoveHistoryPath(memoryRoot());
}

function browserFirstRoot() {
  return path.join(userRoot(), "BrowserFirst");
}

function browserLaunchLogPath() {
  return path.join(repoRoot, "logs", "browser-first-installed-app.log");
}

const browserProfile = resolveBrowserProfile({
  args,
  env: process.env,
  persistentDefaultProfile: defaultProfile,
  userRoot: userRoot(),
});
const profileDir = browserProfile.profileDir;

function hermesHome(profileHome) {
  const value = String(profileHome ?? process.env.HERMES_HOME ?? "~/.hermes").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function hermesCommand(profileHome) {
  if (process.env.HERMES_COMMAND && existsSync(process.env.HERMES_COMMAND)) {
    return process.env.HERMES_COMMAND;
  }
  const home = hermesHome(profileHome);
  const candidates = [
    path.join(home, "hermes-agent", "venv", "bin", "hermes"),
    path.join(home, "venv", "bin", "hermes"),
    path.join(home, "bin", "hermes"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? firstExistingExecutable("hermes");
}

const {
  executeProviderStatus,
  extractAssistantContent,
  openAiReasoningEffort,
  providerBridgeRoutes,
  providerRouteForModel,
  readProviderSecrets,
  runArchiveIngestWriter,
  runArchiveSemanticVerifier,
  sanitizeAssistantContent,
} = createProviderHostService({
  redactDiagnosticText,
  extractJsonObject,
});
function extractJsonObject(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("Planner returned an empty response.");
  }
  try {
    return JSON.parse(text);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1]?.trim();
    if (fenced) {
      return JSON.parse(fenced);
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
    throw new Error("Planner response was not valid JSON.");
  }
}

// Mutable holder for the bridge public URL. The URL depends on the port
// the bridge actually binds to (and the bridge starts after this module's
// top-level code runs), so we leave it undefined and populate it after
// startBridgeServer completes. The addon service reads this holder at
// request time. If a request arrives before the holder is populated
// (e.g. during the in-process self-test), the addon service gracefully
// returns null for the proxy URL and falls back to the direct URL.
const bridgePublicUrlHolder = { value: undefined };
function getBridgePublicUrlValue() {
  return bridgePublicUrlHolder.value;
}

const addonDelegationService = createAddonDelegationService({
  browserFirstRoot,
  // The bridge public URL is only known after the server binds a port, so
  // pass a getter rather than a string. Resolved at request time.
  bridgePublicUrl: getBridgePublicUrlValue,
  dashboardTarget,
  execFileStdout,
  expandUserPath,
  firstExistingExecutable,
  hermesCommand,
  hermesHome,
  listFilesRecursive,
  memoryRoot,
  opencodeCommand,
  opencodeRuntimeDiagnostics,
  redactPathForDiagnostics,
  repoRoot,
  safeFileSlug,
  socketOpen,
  uniqueRuntimeId,
  userRoot,
});

const { executeAddonsStatus } = addonDelegationService;

const { addonDelegationRoutes } = createAddonDelegationHostService(addonDelegationService);

const memorySourceSettingsService = createMemorySourceSettingsService({
  memoryRoot,
  userRoot,
  memorySettingsPath,
  memorySourceAuditPath,
  countFiles,
  pathSummary,
  listFilesRecursive,
  expandUserPath,
  stableMemorySourceId,
  redactPathForDiagnostics,
  redactDiagnosticText,
  execFileStdout,
  firstExistingExecutable,
  isInsidePath,
  executeAddonsStatus,
});

const {
  appendMemorySourceAudit,
  appendMemorySourceRepairHistory,
  appendMemorySourceSyncHistory,
  classifyMemorySourceFile,
  executeMemorySettings,
  executeMemorySettingsSave,
  executeMemorySourceAction,
  executeMemorySourceBrowse,
  executeMemorySourceMoveExecute,
  executeMemorySourceMovePreflight,
  executeMemorySourceMoveRollback,
  executeMemorySourceScan,
  executeMemoryStatus,
  readMemorySettings,
  readMemorySourceMoveHistory,
  readMemorySourceRepairHistory,
} = memorySourceSettingsService;

const archiveReviewService = createArchiveReviewHostService({
  memoryRoot,
  userRoot,
  listFilesRecursive,
  safeFileSlug,
  runArchiveIngestWriter,
  runArchiveSemanticVerifier,
});

const {
  executeArchiveIntake,
  executeArchiveIntakeList,
  executeArchiveIntakeRead,
  executeArchivePromotionList,
  executeArchivePromotionRestore,
  executeArchiveReviewArtifactPromote,
  executeArchiveReviewArtifactRead,
  executeArchiveReviewArtifactRevise,
  executeArchiveReviewArtifactVerify,
  executeArchiveReviewDraft,
  executeArchiveReviewList,
  executeArchiveReviewRequest,
  executeArchiveReviewTransition,
  executeArchiveVerificationRead,
  executeMemoryWikiPageRead,
} = archiveReviewService;

const memorySourceIntakeService = createMemorySourceIntakeHostService({
  appendMemorySourceAudit,
  appendMemorySourceRepairHistory,
  appendMemorySourceSyncHistory,
  classifyMemorySourceFile,
  executeArchiveReviewRequest,
  executeMemorySourceScan,
  expandUserPath,
  listFilesRecursive,
  memoryRoot,
  memorySourceFileManifestPath,
  readMemorySettings,
  redactDiagnosticText,
  safeFileSlug,
});

const {
  executeMemorySourceReview,
  executeMemorySourceIntake,
  executeMemorySourceFileIntake,
  executeMemorySourceSync,
  executeMemorySearch,
  executeMemoryWikiHealth,
  executeMemoryWikiLint,
  executeMemorySourceVersions,
  executeMemorySourceVersionsRepair,
  executeMemorySourceDiff,
} = memorySourceIntakeService;

const { memoryBridgeRoutes } = createMemoryHostService({
  executeMemoryStatus,
  executeMemorySettings,
  executeMemorySettingsSave,
  executeMemorySourceBrowse,
  executeMemorySourceScan,
  executeMemorySourceAction,
  executeMemorySourceMovePreflight,
  executeMemorySourceMoveExecute,
  executeMemorySourceMoveRollback,
  executeMemorySourceReview,
  executeMemorySourceIntake,
  executeMemorySourceFileIntake,
  executeMemorySourceSync,
  executeMemorySearch,
  executeMemoryWikiHealth,
  executeMemoryWikiPageRead,
  executeMemoryWikiLint,
  executeMemorySourceVersions,
  executeMemorySourceVersionsRepair,
  executeMemorySourceDiff,
  executeArchiveIntake,
  executeArchiveIntakeList,
  executeArchiveIntakeRead,
  executeArchiveReviewRequest,
  executeArchiveReviewList,
  executeArchiveReviewTransition,
  executeArchiveReviewDraft,
  executeArchiveReviewArtifactRead,
  executeArchiveReviewArtifactVerify,
  executeArchiveVerificationRead,
  executeArchiveReviewArtifactRevise,
  executeArchiveReviewArtifactPromote,
  executeArchivePromotionList,
  executeArchivePromotionRestore,
});

const {
  browserDiagnosticsRoutes,
  executeSystemStatus,
} = createBrowserDiagnosticsHostService({
  repoRoot,
  resonantExtension,
  userRoot,
  browserFirstRoot,
  memoryRoot,
  profileDir,
  browserLaunchLogPath,
  executeProviderStatus,
  executeAddonsStatus,
  executeMemoryStatus,
  readProviderSecrets,
  countFiles,
  redactPathForDiagnostics,
  redactDiagnosticText,
});

const { agentControlRoutes } = createAgentControlHostService({
  extractAssistantContent,
  extractJsonObject,
  openAiReasoningEffort,
  providerRouteForModel,
  readProviderSecrets,
  sanitizeAssistantContent,
});

const { extensionPrefsRoutes, flushPendingExtensionPrefs } = createExtensionPrefsHostService({
  userRoot,
});

const bridgeRoutes = [
  ...browserDiagnosticsRoutes,
  ...providerBridgeRoutes,
  ...agentControlRoutes,
  ...memoryBridgeRoutes,
  ...addonDelegationRoutes,
  ...extensionPrefsRoutes,
];

const bridgeToken = args.get("bridge-token") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? createBridgeToken();
const bridgeCapabilityTokens = {
  "provider-credential-write": args.get("provider-credential-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_CREDENTIAL_TOKEN ??
    createBridgeToken(),
  "provider-routing-write": args.get("provider-routing-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_ROUTING_TOKEN ??
    createBridgeToken(),
  "memory-settings-write": args.get("memory-settings-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SETTINGS_TOKEN ??
    createBridgeToken(),
  "memory-source-browse": args.get("memory-source-browse-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_BROWSE_TOKEN ??
    createBridgeToken(),
  "memory-source-scan": args.get("memory-source-scan-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_SCAN_TOKEN ??
    createBridgeToken(),
  "memory-source-manage": args.get("memory-source-manage-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_MANAGE_TOKEN ??
    createBridgeToken(),
  "memory-source-move": args.get("memory-source-move-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_MOVE_TOKEN ??
    createBridgeToken(),
  "memory-source-review": args.get("memory-source-review-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_REVIEW_TOKEN ??
    createBridgeToken(),
  "memory-source-intake": args.get("memory-source-intake-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_INTAKE_TOKEN ??
    createBridgeToken(),
  "memory-source-file-intake": args.get("memory-source-file-intake-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_MEMORY_SOURCE_FILE_INTAKE_TOKEN ??
    createBridgeToken(),
  "diagnostics-report-export": args.get("diagnostics-report-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_DIAGNOSTICS_REPORT_TOKEN ??
    createBridgeToken(),
  "browser-download-action": args.get("browser-download-action-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_BROWSER_DOWNLOAD_ACTION_TOKEN ??
    createBridgeToken(),
  "addon-execution-settings-write": args.get("addon-execution-settings-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ADDON_EXECUTION_SETTINGS_TOKEN ??
    createBridgeToken(),
};

async function invokeBridgeRouteForSelfTest({ method = "POST", routePath, body = {}, capabilityToken = "" } = {}) {
  const route = bridgeRoutes.find((entry) => entry.method === method && entry.path === routePath);
  if (!route) {
    return { status: 404, payload: { ok: false, error: "Unknown browser-first bridge route." } };
  }
  if (route.requiredCapability && capabilityToken !== bridgeCapabilityTokens[route.requiredCapability]) {
    return {
      status: 403,
      payload: { ok: false, error: `Bridge route requires ${route.requiredCapability} capability.` },
    };
  }
  try {
    const result = await route.handler(body, { headers: {} });
    return { status: 200, payload: { ok: true, ...result } };
  } catch (error) {
    return {
      status: 500,
      payload: { ok: false, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

const selfTestHandled = await runBrowserFirstSelfTest({
  args,
  bridgeCapabilityTokens,
  bridgeRoutes,
  bridgeToken,
  invokeBridgeRouteForSelfTest,
  memoryRoot,
  memorySettingsPath,
  memorySourceFileManifestPath,
  memorySourceSyncHistoryPath,
  readMemorySourceMoveHistory,
  readMemorySourceRepairHistory,
  resonantExtensionOrigin,
  safeFileSlug,
});

if (selfTestHandled) {
  process.exit(0);
}
const url = args.get("url") ?? defaultMainWorkspaceUrl;
const autoOpenSidePanel = args.get("auto-open-side-panel") === "true";
const bridgePort = Number(args.get("bridge-port") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ?? defaultBridgePort);
const remoteDebugging = resolveRemoteDebugging({ args, env: process.env });

if (!existsSync(hostBinary)) {
  console.error(`Browser-first host binary is missing: ${hostBinary}`);
  console.error("Run: npm run browser-native:build:required");
  process.exit(1);
}

if (!existsSync(path.join(resonantExtension, "manifest.json"))) {
  console.error(`ResonantOS browser layer extension is missing: ${resonantExtension}`);
  process.exit(1);
}

const extensionDirs = [resonantExtension];
const phantomExtension = findPhantomExtension();
if (phantomExtension) {
  extensionDirs.push(phantomExtension);
}

await mkdir(profileDir, { recursive: true });
await removeCachedUnpackedExtension(profileDir, resonantExtensionId);
await seedResonantStartupExperience(profileDir, resonantExtensionId, url);
await seedPinnedExtensions(profileDir, [resonantExtensionId, phantomExtension ? phantomExtensionId : null]);
const hostArgs = [
  "--resonantos-browser-first",
  `--url=${url}`,
  `--resonantos-user-data-dir=${profileDir}`,
  `--resonantos-extension-dirs=${extensionDirs.join(",")}`,
  `--resonantos-log-path=${browserLaunchLogPath()}`,
  ...remoteDebugging.hostArgs,
];

const launchThroughMacAppBundle = process.platform === "darwin" && args.get("launch-mode") !== "direct";
console.log(JSON.stringify({
  event: "browser.first.launch_mode",
  mode: launchThroughMacAppBundle ? "mac-app-bundle" : "direct-native-host",
  appBundle: launchThroughMacAppBundle ? hostAppBundle : null,
  directHost: launchThroughMacAppBundle ? null : hostBinary,
}));

let bridgeInfo;
try {
  bridgeInfo = await startBridgeServerWithFallback({
    port: bridgePort,
    bridgeToken,
    bridgeCapabilityTokens,
    extensionOrigin: resonantExtensionOrigin,
    routes: bridgeRoutes,
    host: getBridgeHost(),
  });
} catch (error) {
  console.error(JSON.stringify({
    event: "browser.first.bridge_failed",
    requestedPort: bridgePort,
    code: error?.code ?? "unknown",
    message: error instanceof Error ? error.message : String(error),
  }));
  throw error;
}
const bridgeServer = bridgeInfo.server;
const activeBridgePort = bridgeInfo.actualPort;
const bridgePublicUrl = getBridgePublicUrl(activeBridgePort);
bridgePublicUrlHolder.value = bridgePublicUrl;
const bridgeConfigPath = await writeBridgeConfig({
  extensionRoot: resonantExtension,
  bridgePort: activeBridgePort,
  bridgeToken,
  bridgeCapabilityTokens,
  publicUrl: bridgePublicUrl,
});
console.log(JSON.stringify({
  event: "browser.first.bridge_started",
  requestedPort: bridgeInfo.requestedPort,
  attemptedPort: bridgeInfo.attemptedPort,
  actualPort: activeBridgePort,
  recovered: bridgeInfo.recovered,
}));

console.log("Launching ResonantOS Browser-First host");
console.log(JSON.stringify({
  hostBinary,
  hostAppBundle,
  url,
  profileDir,
  extensionDirs,
  phantomLoaded: Boolean(phantomExtension),
  pinnedExtensions: [resonantExtensionId, phantomExtension ? phantomExtensionId : null].filter(Boolean),
  bridgeUrl: bridgePublicUrl,
  bridgeConfigPath,
  profileMode: browserProfile.mode,
  remoteDebugging: remoteDebugging.enabled
    ? { port: remoteDebugging.port, address: "127.0.0.1", requested: remoteDebugging.requestedPort }
    : "disabled",
}, null, 2));

function launchNativeHostDirect() {
  return spawn(hostBinary, hostArgs, {
    cwd: repoRoot,
    env: {
      ...process.env,
      RESONANTOS_NATIVE_DISABLE_APPKIT_MENU: "1",
    },
    stdio: "inherit",
  });
}

function launchNativeHostThroughAppBundle() {
  // Launch Services is required for the native AppKit menu bar to belong to
  // the browser app. Direct executable launch remains a fallback for restricted
  // shells where `open` is unavailable or blocked.
  return spawn("open", ["-W", "-n", hostAppBundle, "--args", ...hostArgs], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

let usedLaunchServicesFallback = false;
let child = launchThroughMacAppBundle ? launchNativeHostThroughAppBundle() : launchNativeHostDirect();
let hostLaunchStartedAt = Date.now();

if (autoOpenSidePanel && process.platform === "darwin") {
  setTimeout(() => {
    spawn("osascript", [
      "-e",
      [
        "tell application \"System Events\"",
        "set frontmost of first process whose name contains \"ResonantBrowserNativeHost\" to true",
        "delay 0.2",
        "keystroke \"a\" using {option down, shift down}",
        "end tell",
      ].join("\n"),
    ], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }, 6500);
}

function attachHostExitHandler(hostProcess) {
  hostProcess.on("exit", (code, signal) => {
    if (launchThroughMacAppBundle && !usedLaunchServicesFallback && code !== 0 && !signal) {
      usedLaunchServicesFallback = true;
      console.warn(
        `Launch Services failed for ResonantOS Browser.app with code ${code}; falling back to direct native host launch.`,
      );
      child = launchNativeHostDirect();
      hostLaunchStartedAt = Date.now();
      attachHostExitHandler(child);
      return;
    }

    const elapsedMs = Date.now() - hostLaunchStartedAt;
    if (launchThroughMacAppBundle && code === 0 && !signal && elapsedMs < 15_000) {
      console.warn(
        "Launch Services returned quickly after handing off to an existing browser session; keeping the ResonantOS bridge alive.",
      );
      return;
    }

    bridgeServer.close();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

attachHostExitHandler(child);
