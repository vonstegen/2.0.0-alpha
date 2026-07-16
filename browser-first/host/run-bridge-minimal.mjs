#!/usr/bin/env node

import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
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
import { createMemorySourceSettingsService } from "./memory-source-settings-service.mjs";
import { opencodeRuntimeDiagnostics } from "./opencode-runtime.mjs";
import {
  hermesCommand,
  hermesHome,
  hermesPythonRuntimeDiagnostics,
} from "./hermes-runtime.mjs";
import { createProviderHostService } from "./provider-host-service.mjs";
import {
  memorySourceMoveHistoryPath as sourceMoveHistoryPath,
  memorySourceRepairHistoryPath as sourceRepairHistoryPath,
  memorySourceSyncHistoryPath as sourceSyncHistoryPath,
} from "./memory-source-history.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const resonantExtension = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");
const defaultBridgePort = 47773;
const resonantExtensionId = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const resonantExtensionOrigin = `chrome-extension://${resonantExtensionId}`;
const args = parseArgs(process.argv.slice(2));

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

const bridgePublicUrlHolder = { value: undefined };
const getBridgePublicUrlValue = () => bridgePublicUrlHolder.value;
let addonRuntimeSelfTestHomeDir = null;
const addonRuntimeResolverOptions = () => addonRuntimeSelfTestHomeDir
  ? { homeDir: addonRuntimeSelfTestHomeDir }
  : {};
const resolveHermesCommand = () => hermesCommand(addonRuntimeResolverOptions());
const resolveHermesPythonRuntime = (command) =>
  hermesPythonRuntimeDiagnostics(command, addonRuntimeResolverOptions());
const resolveOpenCodeRuntimeDiagnostics = () => opencodeRuntimeDiagnostics(addonRuntimeResolverOptions());
const resolveOpenCodeCommand = () => resolveOpenCodeRuntimeDiagnostics().command;
const setAddonRuntimeSelfTestHomeDir = (homeDir) => {
  addonRuntimeSelfTestHomeDir = homeDir
    ? realpathSync.native(path.resolve(homeDir))
    : null;
};

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

const addonDelegationService = createAddonDelegationService({
  browserFirstRoot,
  bridgePublicUrl: getBridgePublicUrlValue,
  dashboardTarget,
  execFileStdout,
  expandUserPath,
  firstExistingExecutable,
  hermesCommand: resolveHermesCommand,
  hermesHome,
  hermesPythonRuntime: resolveHermesPythonRuntime,
  listFilesRecursive,
  memoryRoot,
  opencodeCommand: resolveOpenCodeCommand,
  opencodeRuntimeDiagnostics: resolveOpenCodeRuntimeDiagnostics,
  redactPathForDiagnostics,
  readProviderSecrets,
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

const { browserDiagnosticsRoutes, executeSystemStatus } = createBrowserDiagnosticsHostService({
  repoRoot,
  resonantExtension,
  userRoot,
  browserFirstRoot,
  memoryRoot,
  profileDir: path.join(userRoot(), "BrowserFirst", "Profiles", "main"),
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

const { extensionPrefsRoutes, flushPendingExtensionPrefs } = createExtensionPrefsHostService({ userRoot });

const bridgeRoutes = [
  ...browserDiagnosticsRoutes,
  ...providerBridgeRoutes,
  ...agentControlRoutes,
  ...memoryBridgeRoutes,
  ...addonDelegationRoutes,
  ...extensionPrefsRoutes,
];

const bridgeToken = args.get("bridge-token") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? createBridgeToken();
const capabilityBootstrapToken = args.get("capability-bootstrap-token") ??
  process.env.RESONANTOS_BROWSER_FIRST_CAPABILITY_BOOTSTRAP_TOKEN ??
  createBridgeToken();
const bridgeCapabilityTokens = {
  "provider-credential-write": args.get("provider-credential-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_CREDENTIAL_TOKEN ??
    createBridgeToken(),
  "provider-routing-write": args.get("provider-routing-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_ROUTING_TOKEN ??
    createBridgeToken(),
  "provider-diagnostics-read": args.get("provider-diagnostics-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_DIAGNOSTICS_TOKEN ??
    createBridgeToken(),
  "provider-model-invoke": args.get("provider-model-invoke-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_PROVIDER_MODEL_INVOKE_TOKEN ??
    createBridgeToken(),
  "agent-control-plan": args.get("agent-control-plan-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_AGENT_CONTROL_PLAN_TOKEN ??
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
  "archive-read": args.get("archive-read-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ARCHIVE_READ_TOKEN ??
    createBridgeToken(),
  "archive-write": args.get("archive-write-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ARCHIVE_WRITE_TOKEN ??
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
  "addon-runtime-read": args.get("addon-runtime-read-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ADDON_RUNTIME_READ_TOKEN ??
    createBridgeToken(),
  "addon-runtime-control": args.get("addon-runtime-control-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ADDON_RUNTIME_CONTROL_TOKEN ??
    createBridgeToken(),
  "addon-record-read": args.get("addon-record-read-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ADDON_RECORD_READ_TOKEN ??
    createBridgeToken(),
  "addon-record-write": args.get("addon-record-write-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_ADDON_RECORD_WRITE_TOKEN ??
    createBridgeToken(),
  "extension-prefs-write": args.get("extension-prefs-write-token") ??
    process.env.RESONANTOS_BROWSER_FIRST_EXTENSION_PREFS_WRITE_TOKEN ??
    createBridgeToken(),
};

async function invokeBridgeRouteForSelfTest({ method = "POST", routePath, body = {}, capabilityToken = "" } = {}) {
  const route = bridgeRoutes.find((entry) => entry.method === method && entry.path === routePath);
  if (!route) {
    return { status: 404, payload: { ok: false, error: "Unknown browser-first bridge route." } };
  }
  if (route.requiredCapability && capabilityToken !== bridgeCapabilityTokens[route.requiredCapability]) {
    return { status: 403, payload: { ok: false, error: `Bridge route requires ${route.requiredCapability} capability.` } };
  }
  try {
    const result = await route.handler(body, { headers: {} });
    return { status: 200, payload: { ok: true, ...result } };
  } catch (error) {
    return { status: 500, payload: { ok: false, error: error instanceof Error ? error.message : String(error) } };
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
  setAddonRuntimeSelfTestHomeDir,
});

if (selfTestHandled) {
  process.exit(0);
}

if (!existsSync(path.join(resonantExtension, "manifest.json"))) {
  console.error(`ResonantOS extension is missing: ${resonantExtension}`);
  process.exit(1);
}

const bridgePort = Number(args.get("bridge-port") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ?? defaultBridgePort);
const bridgeInfo = await startBridgeServerWithFallback({
  port: bridgePort,
  bridgeToken,
  bridgeCapabilityTokens,
  capabilityBootstrapToken,
  extensionOrigin: resonantExtensionOrigin,
  routes: bridgeRoutes,
  host: getBridgeHost(),
});

const activeBridgePort = bridgeInfo.actualPort;
const bridgePublicUrl = getBridgePublicUrl(activeBridgePort);
bridgePublicUrlHolder.value = bridgePublicUrl;
const bridgeConfigPath = await writeBridgeConfig({
  extensionRoot: resonantExtension,
  bridgePort: activeBridgePort,
  bridgeToken,
  capabilityBootstrapToken,
  publicUrl: bridgePublicUrl,
});

console.log(JSON.stringify({
  event: "browser.first.bridge_started",
  requestedPort: bridgeInfo.requestedPort,
  attemptedPort: bridgeInfo.attemptedPort,
  actualPort: activeBridgePort,
  recovered: bridgeInfo.recovered,
  bridgeUrl: bridgePublicUrl,
  bridgeConfigPath,
}, null, 2));
console.log("Load browser-first/resonantos-side-panel-extension in Chrome as an unpacked extension.");

const shutdown = async () => {
  await flushPendingExtensionPrefs().catch(() => undefined);
  await new Promise((resolve) => bridgeInfo.server.close(resolve));
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
