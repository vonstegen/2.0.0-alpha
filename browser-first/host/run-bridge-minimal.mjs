#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
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
import { buildBridgeCapabilityTokens } from "./bridge-capability-tokens.mjs";
import { createBridgeGrantsStore } from "./bridge-grants-store.mjs";
import { createBridgeAuditLedger } from "./bridge-audit-ledger.mjs";
import { createBridgeTokenKey } from "./bridge-token-key.mjs";
import { createGovernedAuthority } from "./bridge-governed-authority.mjs";
import { createAugmentorExtensionEffect } from "./augmentor-extension-effect.mjs";
import { createAiderProviderAdapter, createAgentZeroProviderAdapter, createDeepSeekHarnessProviderAdapter, createHermesProviderAdapter, createOpenClawProviderAdapter, createOpenCodeProviderAdapter, createPiProviderAdapter } from "./harness-provider-adapters.mjs";
import { createAddonDelegationService } from "./addon-delegation-service.mjs";
import { createAddonDelegationHostService } from "./addon-delegation-host-service.mjs";
import { createDevExternalAgentRuntimesPanelService } from "./dev-external-agent-runtimes-panel.mjs";
import { createDevG0RosPanelService } from "./dev-g0-ros-panel.mjs";
import { createOpencodeHttpClient, ensureOpencodeServer } from "./opencode-client.mjs";
import { createOpencodeSessionHandlers, createOpencodeSessionHostService } from "./opencode-session-host-service.mjs";
import { createArchiveReviewHostService } from "./archive-review-host-service.mjs";
import { createBrowserDiagnosticsHostService } from "./browser-diagnostics-host-service.mjs";
import { createExtensionPrefsHostService } from "./extension-prefs-host-service.mjs";
import { createProfileBootstrapHostService } from "./profile-bootstrap-host-service.mjs";
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
import { createContinuityVault } from "./continuity-vault.mjs";
import { createGroundZeroService } from "./ground-zero-service.mjs";
import { createGroundZeroHostService } from "./ground-zero-host-service.mjs";
import { createKnownGoodSet } from "./ground-zero.mjs";
import { ROS_FUSED_CORE } from "./ros-architecture-snapshot.mjs";
import { collectRouteEnforcementTelemetry } from "./route-enforcement-telemetry.mjs";

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

function continuityRoot() {
  return path.join(browserFirstRoot(), "continuity");
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
  allModelCatalog,
  allProviderProfiles,
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
// Governed authority is created after the audit ledger (below); this holder
// lets the host-service route resolve it at request time.
const governedAuthorityHolder = { value: null };
const extensionEffectHolder = { value: null };
const harnessAdapterHolder = { value: null };
const { addonDelegationRoutes } = createAddonDelegationHostService({
  ...addonDelegationService,
  get governedAuthority() {
    return governedAuthorityHolder.value;
  },
  get runAugmentorExtensionEffect() {
    return extensionEffectHolder.value;
  },
});

// Dev-only HTML panel for addon SDK testing. Requires
// RESONANTOS_REPO_ROOT to be set so the JSON endpoint can enumerate
// examples/addons/. The panel itself is served at
// /dev/external-agent-runtimes/ and fetches the JSON at
// /dev/external-agent-runtimes. Not for production use.
const devExternalAgentRuntimesPanel = createDevExternalAgentRuntimesPanelService({
  repoRoot: process.env.RESONANTOS_REPO_ROOT ?? "",
});

// Dev-only G0-ROS workbench: surfaces the ROS architecture blueprint plus
// how discovered add-ons map onto the fused G0 core. Served at /dev/g0-ros/
// (HTML) with JSON at /dev/g0-ros. Not for production use.
const devG0RosPanel = createDevG0RosPanelService({
  repoRoot: process.env.RESONANTOS_REPO_ROOT ?? "",
});
// Inject the panel's repoRoot into the bridge context the JSON endpoint
// will read. (The route's third-arg `bridgeContext` is what the bridge
// dispatcher wires; we add `repoRoot` to the per-call bridgeContext the
// addon-delegation route handler reads.)
const _origEvaluateBridgeRequestForSelfTest = globalThis?.__noop;
const devPanelRepoRoot = process.env.RESONANTOS_REPO_ROOT;


// Live OpenCode session: the bridge starts (reuses) `opencode serve` on a
// ResonantOS-dedicated port and proxies session/prompt/permission; the extension
// streams the server's /event bus directly (host_permissions cover 127.0.0.1).
const opencodeSessionPort = Number(process.env.RESONANTOS_OPENCODE_PORT ?? 4231);
const opencodeSessionHandlers = createOpencodeSessionHandlers({
  ensureServer: () => ensureOpencodeServer({
    fetchImpl: (...args) => fetch(...args),
    spawnImpl: (cmd, cmdArgs, opts) => spawn(cmd, cmdArgs, opts),
    command: resolveOpenCodeCommand(),
    hostname: "127.0.0.1",
    port: opencodeSessionPort,
    env: process.env,
  }),
  createClient: (baseUrl) => createOpencodeHttpClient({ fetchImpl: (...args) => fetch(...args), baseUrl }),
});
const { opencodeSessionRoutes } = createOpencodeSessionHostService(opencodeSessionHandlers);

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
  allModelCatalog,
  allProviderProfiles,
  readProviderSecrets,
  sanitizeAssistantContent,
});

const { extensionPrefsRoutes, flushPendingExtensionPrefs } = createExtensionPrefsHostService({ userRoot });
const { profileBootstrapRoutes } = createProfileBootstrapHostService({ userRoot });
const bridgeRoutes = [
  ...browserDiagnosticsRoutes,
  ...providerBridgeRoutes,
  ...agentControlRoutes,
  ...memoryBridgeRoutes,
  ...addonDelegationRoutes,
  ...opencodeSessionRoutes,
  ...extensionPrefsRoutes,
  ...(devExternalAgentRuntimesPanel?.devPanelRoutes ?? []),
  ...(devG0RosPanel?.g0RosRoutes ?? []),
  ...profileBootstrapRoutes,
];

const bridgeToken = args.get("bridge-token") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? createBridgeToken();
const capabilityBootstrapToken = args.get("capability-bootstrap-token") ??
  process.env.RESONANTOS_BROWSER_FIRST_CAPABILITY_BOOTSTRAP_TOKEN ??
  createBridgeToken();
const bridgeCapabilityTokens = buildBridgeCapabilityTokens({ args, mint: createBridgeToken });

// Phase 3.5 (caller-attributed capability tokens). The minimal launcher
// constructs an in-memory grants store and a JSONL audit ledger and passes
// both to startBridgeServerWithFallback so that every successful capability-
// scoped bridge request carries caller attribution through to the audit log.
// Production launcher (resonantos-bridge-full.mjs) is not yet wired; that
// lands in a follow-up commit.
// Seed minimal-launcher demo callers for the bundled add-ons so any
// immediate caller-attribution exercises against the minimal launcher
// observe distinct audit records. Minting happens here so auditSink sees
// only authorised requests, not mint events.
const bridgeTokenKey = createBridgeTokenKey();
// Phase 3.5 H3 allowlist: only known add-on callerIds may mint grants. The
// list is hard-coded at the launcher level because it represents the set of
// bundled add-ons this minimal launcher is willing to serve. The audit line
// below records the allowlist at boot so a misconfigured launcher is
// observable in the launcher log.
const minimalLauncherCallerIds = ["hermes", "opencode", "resonant-context", "resonator", "dev-roundtrip"];
const minimalLauncherCallerGrants = (() => {
  const grants = createBridgeGrantsStore({
    tokenKey: bridgeTokenKey,
    callerIdAllowlist: minimalLauncherCallerIds,
  });
  grants.mintGrant("hermes", "provider-model-invoke");
  grants.mintGrant("hermes", "agent-control-plan");
  grants.mintGrant("opencode", "provider-model-invoke");
  grants.mintGrant("resonant-context", "archive-read");
  grants.mintGrant("dev-roundtrip", "network");
  grants.mintGrant("dev-roundtrip", "providers");
  grants.mintGrant("dev-roundtrip", "agent-delegation", bridgeCapabilityTokens["agent-delegation"]);
  grants.mintGrant("dev-roundtrip", "archive-intake-write");
  grants.mintGrant("dev-roundtrip", "memory-provider");
  grants.mintGrant("resonator", "memory-source-manage");
  return grants;
})();
const bridgeAuditFilePath = path.join(userRoot(), "BrowserFirst", "audit.jsonl");
let bridgeAudit;
try {
  bridgeAudit = createBridgeAuditLedger({
    filePath: bridgeAuditFilePath,
    onError: (error) => console.error("[bridge-audit-ledger] write failed:", error?.message ?? error),
  });
} catch (error) {
  // Fail-fast (H3): a misconfigured audit ledger must not allow the bridge
  // to start. Otherwise the launcher silently loses its only observability
  // surface for caller-attributed requests.
  console.error("[run-bridge-minimal] failed to initialise audit ledger:", error?.message ?? error);
  console.error("[run-bridge-minimal] filePath:", bridgeAuditFilePath);
  process.exit(1);
}

// CP-2/CP-3 governed authority: one bridge-process instance wired to the
// append-only audit ledger sink. Grants are minted at task-approval time
// (CP-3); until a launcher mints grants, the governed route fails closed
// with "unknown-handle" rather than 503.
governedAuthorityHolder.value = createGovernedAuthority({ auditSink: bridgeAudit.sink });

// CP-7 Identity & Continuity Vault: Core-owned trusted continuity + delegation
// history (doc 15). Hydrated from BrowserFirst/continuity/ at boot so a task
// survives restart reconstruction; delegation history records which harness
// worked which task under whose authority (audit summaries, never credentials).
const continuityVault = createContinuityVault({
  persistenceRoot: continuityRoot(),
  secretPattern: /\b(?:sk-[A-Za-z0-9]{12,}|[A-Za-z0-9_-]{24,})\b/,
});

// Delegation-history seam: as a harness run completes, append a trusted
// continuity entry. Denied/failed runs produce no continuity (the audit ledger
// still records them separately).
function recordRunEnded({ providerId, taskId, delegationId, issuerPrincipalId, summary, status, endedAt }) {
  if (status !== "completed") return;
  continuityVault.recordDelegation({
    delegationId,
    taskId,
    harnessId: providerId,
    issuerPrincipalId,
    summary,
    completedAt: endedAt,
  });
}

// CP-3 host-mediated extension effect: after the governed envelope authorizes an
// invocation, dispatch the extension's declared tool through the host-mediated
// path and return a typed result.
extensionEffectHolder.value = createAugmentorExtensionEffect({
  repoRoot,
  auditSink: bridgeAudit.sink,
});

// CP-4/CP-5 harness provider adapters, each driven through the governed envelope.
// External-runtime LLM wiring. pi and aider fall back to the machine's local
// default model (e.g. ollama) unless an explicit model/provider is supplied, so
// pin DeepSeek here and let env override for other setups. The DEEPSEEK_API_KEY
// is read from the process env (sourced at runtime by the launcher, never
// printed) and flows through the adapter transports via `process.env`.
const piHarnessModel = process.env.RESONANTOS_PI_MODEL ?? "deepseek/deepseek-chat";
const aiderHarnessModel = process.env.RESONANTOS_AIDER_MODEL ?? "deepseek/deepseek-chat";
const hermesHarnessModel = process.env.RESONANTOS_HERMES_MODEL ?? "deepseek/deepseek-chat";
const aiderHarnessCommand = process.env.RESONANTOS_AIDER_COMMAND ?? `${process.env.HOME}/.local/bin/aider`;
const hermesHarnessCommand = process.env.RESONANTOS_HERMES_COMMAND ?? `${process.env.HOME}/.hermes/hermes-agent/venv/bin/hermes`;
const openclawHarnessCommand = process.env.RESONANTOS_OPENCLAW_COMMAND ?? "openclaw";

harnessAdapterHolder.value = {
  hermes: createHermesProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, command: hermesHarnessCommand, model: hermesHarnessModel, onRunEnded: recordRunEnded }),
  opencode: createOpenCodeProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, onRunEnded: recordRunEnded }),
  openclaw: createOpenClawProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, command: openclawHarnessCommand, onRunEnded: recordRunEnded }),
  agentzero: createAgentZeroProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, onRunEnded: recordRunEnded }),
  "deepseek-harness": createDeepSeekHarnessProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, onRunEnded: recordRunEnded }),
  pi: createPiProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, provider: piHarnessModel.split("/")[0], model: piHarnessModel, onRunEnded: recordRunEnded }),
  aider: createAiderProviderAdapter({ governedAuthority: governedAuthorityHolder.value, repoRoot, command: aiderHarnessCommand, model: aiderHarnessModel, onRunEnded: recordRunEnded }),
};

// CP-8 Ground-0 state (Core-owned recovery, doc 10). The live "optional
// executable surface" is the seven harness adapters plus the host-mediated
// extension effect and the archive ingest writer. Entering Ground-0 revokes
// every active grant (the governed dispatch then fails closed on a replayed
// handle) and marks the surface disabled; exit health-checks each item in
// dependency order and re-enables the healthy ones — never reviving a
// pre-recovery grant. The per-item live health probe lands with CP-5 parity;
// until then every registered adapter is treated as known-good.
const groundZeroSurfaceInventory = () => [
  ...Object.keys(harnessAdapterHolder.value ?? {}).map((id) => ({ id: `harness:${id}`, kind: "harness" })),
  { id: "extension:augmentor-effect", kind: "extension" },
  { id: "archive-ingest", kind: "archive-ingest" },
];

// CP-8 known-good manifest/config set (doc 10 §Entry): the frozen fused-core
// baseline (shell sections + integrated harness) Ground-0 restores to. The
// integrity digest is recomputed on entry — a tampered set fails closed.
const groundZeroKnownGoodSet = createKnownGoodSet({
  version: "1",
  manifestIds: [...ROS_FUSED_CORE.sections, ROS_FUSED_CORE.integratedHarness],
});

const groundZeroService = createGroundZeroService({
  governedAuthority: governedAuthorityHolder.value,
  surfaceInventory: groundZeroSurfaceInventory,
  knownGood: groundZeroKnownGoodSet,
});

const groundZeroExitHealthCheck = () => true;
const groundZeroExitResumeItem = () => {};

function executeGroundZeroEnter(body) {
  const { trigger = "manual" } = body ?? {};
  return groundZeroService.enter({ trigger });
}

function executeGroundZeroExit(body) {
  const { order = [] } = body ?? {};
  return groundZeroService.exit({
    order,
    healthCheck: groundZeroExitHealthCheck,
    resumeItem: groundZeroExitResumeItem,
  });
}

function executeGroundZeroStatus() {
  return groundZeroService.getSnapshot();
}

const { groundZeroRoutes } = createGroundZeroHostService({
  executeGroundZeroEnter,
  executeGroundZeroExit,
  executeGroundZeroStatus,
});
bridgeRoutes.push(...groundZeroRoutes);


// CP-3 task-approval minting seam: mints a task grant + records its delegation so
// the governed routes can resolve the handle. Called by the runtime at approval
// time; the minimal launcher exposes it but does not mint at boot (fail-closed).
function mintTaskGrant({
  taskId,
  delegationId,
  subjectPrincipalId,
  issuerPrincipalId,
  action,
  resourceSelectors = [],
  operations = [],
}) {
  const authority = governedAuthorityHolder.value;
  if (!authority) throw new Error("governed authority is not ready");
  // CP-8: no fresh authority may be minted while Ground-0 is active — recovery
  // exit is the only way to resume, and it never revives pre-recovery grants.
  if (groundZeroService.isDisabled()) {
    throw new Error("Ground-0 active: mintTaskGrant is blocked until recovery exit");
  }
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  authority.recordDelegation({
    id: delegationId,
    taskId,
    parentDelegationId: null,
    issuerPrincipalId,
    subjectPrincipalId,
    requestedCapabilities: [],
    effectiveGrantId: `g:${taskId}`,
    purpose: "task approval",
    issuedAt: now,
    notBefore: now,
    expiresAt,
    status: "active",
    auditCorrelationId: `aud:${taskId}`,
  });
  return authority.mintGrant({
    grantId: `g:${taskId}`,
    scope: {
      action,
      resourceSelectors,
      operations,
      taskId,
      delegationId,
      issuerPrincipalId,
      subjectPrincipalId,
      notBefore: now,
      expiresAt,
      revocationBehavior: "cancel",
    },
  });
}

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
  perCallerGrants: minimalLauncherCallerGrants.snapshot(),
  tokenKey: bridgeTokenKey,
  callerGrantVerifier: minimalLauncherCallerGrants.verifyCallerGrant.bind(minimalLauncherCallerGrants),
  auditSink: bridgeAudit.sink,
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
// H3 startup log: caller count and grant count are observable at boot so a
// misconfigured launcher doesn't silently ship with no add-ons authorised. We
// also emit a SHA-256 fingerprint of the tokenKey (first 8 hex chars) so two
// bridge processes can be told apart without leaking the key.
const tokenKeyFingerprint = createHash("sha256")
  .update(bridgeTokenKey)
  .digest("hex")
  .slice(0, 8);

console.log(JSON.stringify({
  event: "browser.first.caller_grants_ready",
  callerCount: minimalLauncherCallerGrants.listCallers().length,
  grantCount: minimalLauncherCallerGrants.listGrants().length,
  callerIds: minimalLauncherCallerGrants.listCallers(),
  tokenKeyFingerprint,
  auditLedgerPath: bridgeAuditFilePath,
}, null, 2));
console.log(JSON.stringify({
  event: "browser.first.bridge_started",
  requestedPort: bridgeInfo.requestedPort,
  attemptedPort: bridgeInfo.attemptedPort,
  actualPort: activeBridgePort,
  recovered: bridgeInfo.recovered,
  bridgeUrl: bridgePublicUrl,
  bridgeConfigPath,
}, null, 2));
console.log(JSON.stringify({
  event: "browser.first.governed_runtime_ready",
  governedAuthority: Boolean(governedAuthorityHolder.value),
  extensionEffect: Boolean(extensionEffectHolder.value),
  harnessAdapters: Object.keys(harnessAdapterHolder.value),
  grantMintSeam: typeof mintTaskGrant === "function",
  continuityVault: true,
  continuityDelegationCount: continuityVault.delegationHistory().length,
  continuitySnapshotCount: continuityVault.snapshots().length,
  lastKnownGoodSnapshot: continuityVault.lastKnownGood()?.snapshotId ?? null,
  routeEnforcement: collectRouteEnforcementTelemetry(bridgeRoutes),
 }, null, 2));
 
const shutdown = async () => {
  // CP-7 last-known-good continuity snapshot: capture FIRST and synchronously,
  // so even an unclean shutdown persists durable identity + continuity for the
  // next boot to reconstruct (doc 15 §Ground-0 reload path). No credentials are
  // ever snapshot payloads.
  continuityVault.recordSnapshot({
    domains: {
      "user-identity": { userRoot: userRoot() },
      "augmentor-identity": { flavor: "browser-first", recovered: bridgeInfo.recovered },
      "trusted-continuity": {
        delegationCount: continuityVault.delegationHistory().length,
        snapshotTakenAt: new Date().toISOString(),
      },
    },
  });
  await flushPendingExtensionPrefs().catch(() => undefined);
  await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(), 1500);
    timeout.unref();
    bridgeInfo.server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
};

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}


