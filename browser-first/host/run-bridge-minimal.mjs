#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  createBridgeToken,
  getBridgeHost,
  getBridgePublicUrl,
  isLoopbackBridgeHost,
  startBridgeServerWithFallback,
  writeBridgeConfig,
} from "./bridge-server.mjs";
import { createBridgeRouteSelfTestInvoker } from "./bridge-self-test-invoker.mjs";
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
import { createAddonDelegationHostService } from "./addon-delegation-host-service.mjs";
import { createAddonDelegationService } from "./addon-delegation-service.mjs";
import {
  createOpencodeHttpClient,
  ensureOpencodeServer,
  forgetOpencodeServer,
} from "./opencode-client.mjs";
import { createOpenCodeBoundary } from "./opencode-boundary.mjs";
import {
  createOpencodeSessionHandlers,
  createOpencodeSessionHostService,
} from "./opencode-session-host-service.mjs";
import { createArchiveReviewHostService } from "./archive-review-host-service.mjs";
import { createBrowserDiagnosticsHostService } from "./browser-diagnostics-host-service.mjs";
import { createExtensionPrefsHostService } from "./extension-prefs-host-service.mjs";
import { createMemoryHostService } from "./memory-host-service.mjs";
import { createMemorySourceIntakeHostService } from "./memory-source-intake-host-service.mjs";
import { createMemorySourceSettingsService } from "./memory-source-settings-service.mjs";
import { opencodeRuntimeDiagnostics } from "./opencode-runtime.mjs";
import { hermesCommand, hermesHome, hermesPythonRuntimeDiagnostics } from "./hermes-runtime.mjs";
import { createHarnessHostService } from "./harness-host-service.mjs";
import { createRuntimeProjectionService } from "./runtime-projection-service.mjs";
import { createBridgeRuntimesHostService } from "./bridge-runtimes-host-service.mjs";
import {
  installTerminalHostBridge,
  uninstallTerminalHostBridge,
} from "./terminal-host-bridge-wiring.mjs";
import { createTerminalHostHostWiring } from "./terminal-host-host-wiring.mjs";
import {
  createRuntimeFactoryRegistry,
  ensureReviewedRuntimeFactories,
} from "./runtime-factory-registry.mjs";
import { createHostRuntimeLifecycle } from "./runtime-lifecycle-host.mjs";
import { seedTerminalRuntimeFactories } from "./terminal-runtime-factories.mjs";
import { loadTerminalAddonSeedInstallations } from "./terminal-addon-seed.mjs";
import { createTerminalHostServiceOwner } from "./terminal-host-service-owner.mjs";
import { createProviderHostService } from "./provider-host-service.mjs";
import {
  memorySourceMoveHistoryPath as sourceMoveHistoryPath,
  memorySourceRepairHistoryPath as sourceRepairHistoryPath,
  memorySourceSyncHistoryPath as sourceSyncHistoryPath,
} from "./memory-source-history.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultResonantExtension = path.join(
  repoRoot,
  "browser-first",
  "resonantos-side-panel-extension",
);
const resonantExtension = resolveResonantExtensionRoot();
const defaultBridgePort = 47773;
const resonantExtensionId = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const resonantExtensionOrigin = `chrome-extension://${resonantExtensionId}`;
const args = parseArgs(process.argv.slice(2));

function resolveResonantExtensionRoot() {
  const configured = String(process.env.RESONANTOS_EXTENSION_ROOT ?? "").trim();
  if (!configured) return defaultResonantExtension;
  if (!path.isAbsolute(configured)) {
    console.error(`RESONANTOS_EXTENSION_ROOT must be an absolute path: ${configured}`);
    process.exit(1);
  }
  try {
    const resolved = realpathSync.native(configured);
    if (!statSync(resolved).isDirectory()) {
      throw new Error("not a directory");
    }
    return resolved;
  } catch {
    console.error(`RESONANTOS_EXTENSION_ROOT must point to an existing directory: ${configured}`);
    process.exit(1);
  }
}

function userRoot() {
  return path.resolve(
    process.env.RESONANTOS_BROWSER_FIRST_USER_ROOT || path.join(os.homedir(), "ResonantOS_User"),
  );
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
const addonRuntimeResolverOptions = () =>
  addonRuntimeSelfTestHomeDir ? { homeDir: addonRuntimeSelfTestHomeDir } : {};
const resolveHermesCommand = () => hermesCommand(addonRuntimeResolverOptions());
const resolveHermesPythonRuntime = (command) =>
  hermesPythonRuntimeDiagnostics(command, addonRuntimeResolverOptions());
const resolveOpenCodeRuntimeDiagnostics = () =>
  opencodeRuntimeDiagnostics(addonRuntimeResolverOptions());
const resolveOpenCodeCommand = () => resolveOpenCodeRuntimeDiagnostics().command;
const setAddonRuntimeSelfTestHomeDir = (homeDir) => {
  addonRuntimeSelfTestHomeDir = homeDir ? realpathSync.native(path.resolve(homeDir)) : null;
};

const providerHostService = createProviderHostService({ redactDiagnosticText, extractJsonObject });
const {
  executeProviderStatus,
  extractAssistantContent,
  openAiReasoningEffort,
  providerBridgeRoutes: legacyProviderBridgeRoutes,
  providerRouteForModel,
  allModelCatalog,
  allProviderProfiles,
  readProviderSecrets,
  runArchiveIngestWriter,
  runArchiveSemanticVerifier,
  sanitizeAssistantContent,
} = providerHostService;

// Bindings are operator configuration only. Demo manifests never authorize a
// credential name, endpoint, or port. Invalid host configuration fails startup.
// Hoisted above addonDelegationService so the host-owned registry is available
// Step 5A: assemble the terminal-host host boundary wiring. The wiring owns
// the host source-of-truth for the /terminal-host/session/attach route:
//   * getProfile -> allProviderProfiles() (provider-bridge)
//   * resolveSecret -> readProviderSecrets() (provider-bridge) mapped by id
//   * resolveProjectIdentity -> synthesized from root (host-owned id+label)
//   * resolveSkillCatalog -> [] (no host catalog yet; overridable)
//   * skillSourceRoot / stagingBase -> <userRoot>/BrowserFirst/HostSkills,
//     <userRoot>/Staging
// shared-* / anthropic / unknown profiles fail closed: resolvePiNativeProvider
// returns null for them, so resolveCredential yields null and the route
// returns ok:false, reason:'missing-credential'.
const hostTerminal = createTerminalHostHostWiring({
  userRoot: userRoot(),
  env: process.env,
  getProfile: async (profileId) => {
    const profiles = await allProviderProfiles();
    return profiles.find((profile) => profile?.id === profileId) ?? null;
  },
  resolveSecret: async (profile) => {
    if (!profile?.id) return null;
    const secrets = await readProviderSecrets();
    const value = secrets[profile.id];
    return typeof value === "string" && value.length > 0 ? value : null;
  },
});

// Phase 1.5 Step B wiring: invoke the terminal-host bridge service FIRST
// so the harness service can see the terminal-host service + bus when it
// is constructed (Step 5, 5B: pi-terminal-v1 adapter). The service is
// opt-in via RESONANT_TERMINAL_HOST_BRIDGE=1 (default off in production;
// on in dev + tests) so existing CI / production bridge runs are unchanged.
// RESONANT_TERMINAL_DRIVER (in-memory | iterm2) selects the driver; the
// in-memory driver composes the bus without spawning.
// CP-S5H3: attachAuth supplies the bridge base URL + bridge/capability tokens
// so the composed ros-session attach command can authenticate with the
// loopback bridge. The closure reads bridgePublicUrlHolder.value (set after
// the bridge server binds) so the URL is always current even if the port
// falls back.
const attachAuth = async () => ({
  baseUrl: bridgePublicUrlHolder.value,
  bridgeToken,
  controlCapabilityToken: bridgeCapabilityTokens["addon-runtime-control"],
});
const terminalHostBridge = await installTerminalHostBridge({
  env: process.env,
  serviceOptions: { attachAuth },
});
// installTerminalHostBridge already starts the service when enabled and
// returns `{ service: null, started: null }` when the env flag is unset.
// Use the returned handle; never re-start (double-start) or dereference a
// null service (the default production path has no terminal-host bridge).
const terminalHostService = terminalHostBridge.service;
const terminalHostStart = terminalHostBridge.started;

// CP-BR9: single owner of the live terminal-host service. The CP-BR7
// factories attach the service they start (the real Ghostty/iTerm2
// adapter, driver pinned per add-on); the facade below is the ONLY
// terminal-host service the harness routes see, so "enable a terminal
// add-on" and "Open in Terminal" share one live instance. When no
// terminal add-on holds the singleton, the facade falls back to the
// bridge-level boot composition (in-memory in the default ROS-started
// bridge) and every route fails closed.
const terminalServiceOwner = createTerminalHostServiceOwner();
const terminalHostFacade = terminalServiceOwner.facade({
  fallback:
    terminalHostService && terminalHostStart
      ? { service: terminalHostService, started: terminalHostStart }
      : null,
});

// CP-BR9: reviewed seed for the two production terminal add-ons. The
// manifests come from the canonical bundled catalog
// (public/addons/terminal-host-{ghostty,iterm2}.json) and are paired with
// the CP-BR7 reviewed factory ids by terminal-addon-seed.mjs. The harness
// host service installs them through the same registry path the
// `/addons/install` route uses — durable, idempotent, never enabled and
// never granted by default.
const terminalAddonSeeds = await loadTerminalAddonSeedInstallations();

// for Phase-3 (P6) workspace add-on grant lifecycle handlers.
const harnessService = await createHarnessHostService({
  userRoot: userRoot(),
  providerHost: providerHostService,
  hostTerminal,
  terminalHost: terminalHostFacade,
  bindings: JSON.parse(process.env.RESONANTOS_HARNESS_BINDINGS ?? "[]"),
  env: process.env,
  seedInstallations: terminalAddonSeeds,
  // CP-S5H3: the connection-script route mints the same 0600 --auth-file
  // the launch path composes, so a pasted script's attach authenticates.
  attachAuth,
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
  // Phase 3 (P6): the host-owned registry is the single source of truth for
  // workspace add-on grants. `harnessService.registry` is the same registry
  // the harness adapter routes use; P6 extends its lifecycle to local-service
  // workspace add-ons without inventing a second registry.
  workspaceAddonRegistry: harnessService.registry,
  // Host-side bearer tokens (delivered to the iframe in the bootstrap
  // envelope for every granted capability) and host-side admin tokens
  // (NEVER delivered — host-only, used to drive /admin/deny on revocation).
  // Both are operator-pinned via launcher args or env so the demo is
  // reproducible from a clean checkout without a second trust path.
  workspaceAddonBearerTokens: {
    "addon.resonant-echo":
      args.get("echo-bearer-token") ?? process.env.RESONANTOS_DEMO_ECHO_BEARER ?? "",
    "addon.resonant-counter":
      args.get("counter-bearer-token") ?? process.env.RESONANTOS_DEMO_COUNTER_BEARER ?? "",
    "addon.sdk-guide":
      args.get("sdk-guide-bearer-token") ?? process.env.RESONANTOS_DEMO_SDK_GUIDE_BEARER ?? "",
    "addon.resonant-pi": args.get("pi-bearer-token") ?? process.env.RESONANTOS_DEMO_PI_BEARER ?? "",
  },
  workspaceAddonAdminTokens: {
    "addon.resonant-echo":
      args.get("echo-admin-token") ?? process.env.RESONANTOS_DEMO_ECHO_ADMIN ?? "",
    "addon.resonant-counter":
      args.get("counter-admin-token") ?? process.env.RESONANTOS_DEMO_COUNTER_ADMIN ?? "",
    "addon.sdk-guide":
      args.get("sdk-guide-admin-token") ?? process.env.RESONANTOS_DEMO_SDK_GUIDE_ADMIN ?? "",
    "addon.resonant-pi": args.get("pi-admin-token") ?? process.env.RESONANTOS_DEMO_PI_ADMIN ?? "",
  },
});

const { executeAddonsStatus } = addonDelegationService;
const { addonDelegationRoutes } = createAddonDelegationHostService(addonDelegationService);

function getPublicPort() {
  const publicUrl = getBridgePublicUrlValue();
  if (!publicUrl) return undefined;
  try {
    const parsed = new URL(publicUrl);
    if (!isLoopbackBridgeHost(parsed.hostname) || parsed.username || parsed.password)
      return undefined;
    if (parsed.port) return parsed.port;
    if (parsed.protocol === "http:") return "80";
    if (parsed.protocol === "https:") return "443";
    return undefined;
  } catch {
    return undefined;
  }
}

function logOpenCodeBoundary({ code, operation } = {}) {
  console.error(JSON.stringify({ event: "opencode.boundary", code, operation }));
}

const openCodeBoundary = createOpenCodeBoundary({
  ensureServer: () =>
    ensureOpencodeServer({
      fetchImpl: (...args) => fetch(...args),
      spawnImpl: (cmd, cmdArgs, opts) => spawn(cmd, cmdArgs, opts),
      command: resolveOpenCodeCommand(),
      hostname: "127.0.0.1",
      port: process.env.RESONANTOS_OPENCODE_PORT
        ? Number(process.env.RESONANTOS_OPENCODE_PORT)
        : undefined,
      env: process.env,
    }),
  createClient: (baseUrl, opts = {}) =>
    createOpencodeHttpClient({ fetchImpl: (...args) => fetch(...args), baseUrl, ...opts }),
  fetchImpl: (...args) => fetch(...args),
  executionEnabled: () => addonDelegationService.openCodeProxyExecutionEnabled(),
  forgetServer: forgetOpencodeServer,
  log: logOpenCodeBoundary,
});
const unsubscribeOpenCodeExecution = addonDelegationService.subscribeOpenCodeExecution((enabled) =>
  enabled ? undefined : openCodeBoundary.revoke(),
);
const opencodeSessionHandlers = createOpencodeSessionHandlers({ boundary: openCodeBoundary });
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

const { extensionPrefsRoutes, flushPendingExtensionPrefs } = createExtensionPrefsHostService({
  userRoot,
});

const { harnessRoutes } = harnessService;
const providerBridgeRoutes = harnessService.composeProviderRoutes(legacyProviderBridgeRoutes);

// CP-BR7: wire the CP-BR4 reconciler into the production composition
// root. The reconciler consumes the host registry projection and the
// CP-BR3 resolver decisions; the projection service (CP-BR5) then
// reflects live `listActive()` state. The two CP-BR7 reviewed terminal
// factories (Ghostty + iTerm2) are seeded here; the existing
// `external-cli-terminal` and `pi-runtime` seeds are left untouched.
const terminalFactoryRegistry = createRuntimeFactoryRegistry({});
ensureReviewedRuntimeFactories(terminalFactoryRegistry, { observers: new Map() });
seedTerminalRuntimeFactories(terminalFactoryRegistry, {
  // Wire the live terminal-host bridge service (installed above) into
  // the factories' session-close path. When the bridge is disabled
  // (default production) this is null, and closeSessions falls back to
  // the per-add-on service's own status()/closeSession() path.
  serviceFactory: undefined,
  baseEnv: process.env,
  terminalHostService,
  // CP-S5H3: the factory-owned services are the ones the CP-BR9 owner
  // facade actually serves launches with, so THEY must compose the
  // ros-session attach command with --auth-file. attachAuth is the same
  // host-owned closure the bridge-level service gets; it vends the
  // tokens at launch time and the factory never sees the values.
  attachAuth,
  // CP-BR9: factories attach their started service to the single live
  // owner so the launch route and the reconciler share one instance.
  serviceOwner: terminalServiceOwner,
});

// CP-BR9: reconciler lifecycle events refresh the cached CP-BR5
// projection. The sink is assigned after the projection service exists
// (below); events emitted before that point carry no subscriber and are
// dropped, which the initial reconcile already tolerates.
let runtimeProjectionEventSink = null;

const hostRuntimeLifecycle = createHostRuntimeLifecycle({
  factoryRegistry: terminalFactoryRegistry,
  hostRegistry: harnessService.registry,
  emit: (event) => {
    // Non-secret lifecycle event sink. The CP-BR4 reconciler emits
    // public identifiers only.
    try {
      runtimeProjectionEventSink?.(event);
    } catch {
      /* the projection sink is observational; it never breaks a reconcile */
    }
  },
});

const { reconciler: hostRuntimeReconciler } = hostRuntimeLifecycle;

// Reconcile on mount and on every registry fence. The reconciler is
// idempotent; calling it twice in the same projection generation is a
// no-op. The registry's `onFence` hook is the host-owned event source.
if (typeof harnessService.registry?.onFence === "function") {
  harnessService.registry.onFence(() => {
    void hostRuntimeReconciler.reconcile();
  });
}
void hostRuntimeReconciler.reconcile();

// CP-BR5: non-secret runtime/connector/session projection. The projection
// service reads the harness registry + the (optional) CP-BR4 reconciler
// active list and produces the public BridgeRuntimesProjection. The
// bridge-runtimes host service attaches a single GET /bridge/runtimes
// route to the route table; the route is capability-gated
// (addon-runtime-read) and loopback-only.
// Boot identity + in-process health for the bridgeOverview projection. These
// are derived from real boot/clock/health state rather than fabricated
// constants (the previous "bridge-0" instance id and hardcoded "connected").
const bootStartedAt = Date.now();
const bootInstanceId =
  typeof process.env.RESONANTOS_BRIDGE_INSTANCE_ID === "string" &&
  process.env.RESONANTOS_BRIDGE_INSTANCE_ID.length > 0
    ? process.env.RESONANTOS_BRIDGE_INSTANCE_ID
    : uniqueRuntimeId("bridge");

function getBridgeHealth() {
  // The projection is served by the bridge itself, so a reachable bridge is
  // connected. The one in-process degradation signal is the live terminal
  // service: when a real driver (ghostty/iterm2) is selected and its
  // adapter child has since exited, the bridge is degraded. CP-BR9 reads
  // this through the single-owner facade so the factory-active service and
  // the bridge-level boot composition share one health source. The
  // in-memory driver has no child and is always treated as healthy.
  const terminal = terminalHostFacade.service.status();
  if (
    terminal &&
    typeof terminal.driveId === "string" &&
    terminal.driveId !== "in-memory" &&
    terminal.alive === false
  ) {
    return { status: "degraded" };
  }
  return { status: "connected" };
}

const runtimeProjection = createRuntimeProjectionService({
  hostRegistry: harnessService.registry,
  reconciler: hostRuntimeReconciler,
  bridgeStatus: {
    snapshot: () => {
      const health = getBridgeHealth();
      return {
        status: health.status,
        version:
          typeof process.env.RESONANTOS_BRIDGE_VERSION === "string"
            ? process.env.RESONANTOS_BRIDGE_VERSION
            : "alpha",
        // activeBridgePort is assigned after the server binds below; this
        // snapshot is only computed lazily on the first /bridge/runtimes
        // read, so the reference is safe.
        endpoint: `http://${getBridgeHost()}:${activeBridgePort}`,
        publicEndpoint: getBridgePublicUrlValue(),
        startedAt: new Date(bootStartedAt).toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        instanceId: bootInstanceId,
        bootEpoch:
          typeof harnessService.registry?.snapshot === "function"
            ? String(harnessService.registry.snapshot().bootEpoch ?? "")
            : "",
      };
    },
  },
  sessionCounts: { getSessionsByRuntime: () => ({ activeSessionCount: 0 }) },
});
// CP-BR9: from here on, reconciler lifecycle events (start_requested,
// ready, stopped, …) refresh the cached projection so GET
// /bridge/runtimes never serves a stale runtime list.
runtimeProjectionEventSink = (event) => runtimeProjection.recordEvent(event);
const bridgeRuntimesRoute = [];
createBridgeRuntimesHostService({
  runtimeProjection,
  attachRoute: (route) => {
    bridgeRuntimesRoute.push(route);
  },
});

const bridgeRoutes = [
  ...browserDiagnosticsRoutes,
  ...providerBridgeRoutes,
  ...agentControlRoutes,
  ...memoryBridgeRoutes,
  ...addonDelegationRoutes,
  ...opencodeSessionRoutes,
  ...extensionPrefsRoutes,
  ...harnessRoutes,
  ...bridgeRuntimesRoute,
];

const bridgeToken =
  args.get("bridge-token") ??
  process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ??
  createBridgeToken();
const capabilityBootstrapToken =
  args.get("capability-bootstrap-token") ??
  process.env.RESONANTOS_BROWSER_FIRST_CAPABILITY_BOOTSTRAP_TOKEN ??
  createBridgeToken();
const bridgeCapabilityTokens = buildBridgeCapabilityTokens({ args, mint: createBridgeToken });

const invokeBridgeRouteForSelfTest = createBridgeRouteSelfTestInvoker({
  bridgeToken,
  bridgeCapabilityTokens,
  capabilityBootstrapToken,
  routes: bridgeRoutes,
  listenerPort: Number(
    args.get("bridge-port") ??
      process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ??
      defaultBridgePort,
  ),
  getPublicPort,
});

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

const bridgePort = Number(
  args.get("bridge-port") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ?? defaultBridgePort,
);
const bridgeInfo = await startBridgeServerWithFallback({
  port: bridgePort,
  bridgeToken,
  bridgeCapabilityTokens,
  capabilityBootstrapToken,
  extensionOrigin: resonantExtensionOrigin,
  routes: bridgeRoutes,
  host: getBridgeHost(),
  getPublicPort,
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

console.log(
  JSON.stringify(
    {
      event: "browser.first.bridge_started",
      requestedPort: bridgeInfo.requestedPort,
      attemptedPort: bridgeInfo.attemptedPort,
      actualPort: activeBridgePort,
      recovered: bridgeInfo.recovered,
      bridgeUrl: bridgePublicUrl,
      bridgeConfigPath,
      extensionRoot: resonantExtension,
    },
    null,
    2,
  ),
);
console.log(`Load ${resonantExtension} in Chrome as an unpacked extension.`);

const shutdown = async () => {
  await flushPendingExtensionPrefs().catch(() => undefined);
  try {
    unsubscribeOpenCodeExecution();
  } catch {
    /* noop */
  }
  await openCodeBoundary.dispose().catch(() => undefined);
  // CP-BR9: stop every reconciler-owned runtime (the factory-active
  // terminal adapters) before closing the harness service, preserving the
  // zero-leaked-windows invariant across bridge shutdown.
  await hostRuntimeReconciler.stopAll().catch(() => undefined);
  await harnessService.close();
  await uninstallTerminalHostBridge({ service: terminalHostService });
  await new Promise((resolve) => bridgeInfo.server.close(resolve));
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

// CP-BR11 bridge-death log. The bridge is spawned with `stdio: "ignore"`
// (see host/bridge-launcher.mjs), so an unexpected bridge exit leaves no
// stderr trail. The CP-BR2 orchestrator only sees the host's status
// envelope, which surfaces `unexpected-exit`; a redacted append-only log
// here gives the operator a breadcrumb on the bridge host without leaking
// the bridge token, capability tokens, paths, PIDs, or env. The log is
// bounded by simple size-based rotation (≤ 256 KiB) so a chatty host
// cannot grow it without bound.
//
// The `exit` event handler below is the single sink for every exit
// path — normal return, uncaught exception, or graceful shutdown after
// SIGINT/SIGTERM (the SIGINT/SIGTERM handlers above call
// `process.exit(0)`, which fires the `exit` event). The signal field is
// always null because the runtime's `exit` event does not surface the
// terminating signal; that detail is recoverable from the operator's
// own signal handling / shell history if needed.
const BRIDGE_EXIT_LOG_BASENAME = "bridge-exit.log";
const BRIDGE_EXIT_LOG_MAX_BYTES = 256 * 1024;
const BRIDGE_EXIT_LOG_KEEP_BYTES = 128 * 1024;

function bridgeExitLogPath() {
  return path.join(os.homedir(), ".ros", BRIDGE_EXIT_LOG_BASENAME);
}

function recordBridgeExit({ code }) {
  // The record carries exactly the three documented fields: code (number
  // or null), signal (always null at the `exit` event), at (ISO
  // timestamp). No env, path, PID, argv, or token value is ever
  // appended.
  const record = JSON.stringify({
    event: "bridge.exit",
    code: typeof code === "number" ? code : null,
    signal: null,
    at: new Date().toISOString(),
  });
  const logPath = bridgeExitLogPath();
  try {
    const dir = path.dirname(logPath);
    if (!existsSync(dir)) {
      // The directory is normally created by the installer. If it is
      // missing we skip silently to keep the bridge's shutdown path
      // clean (this log is operator breadcrumb, not a contract).
      return;
    }
    appendFileSync(logPath, record + "\n");
    const { size } = statSync(logPath);
    if (size > BRIDGE_EXIT_LOG_MAX_BYTES) {
      // Simple rotation: keep the trailing half and drop the rest.
      // Avoiding a full re-architecture (winston/pino) for a 4-field log.
      const buf = readFileSync(logPath);
      const trimmed = buf.subarray(Math.max(0, buf.length - BRIDGE_EXIT_LOG_KEEP_BYTES));
      // Drop everything up to and including the first newline so the
      // surviving file is a sequence of complete JSON lines.
      const firstNewline = trimmed.indexOf(0x0a);
      const writeBuf = firstNewline >= 0 ? trimmed.subarray(firstNewline + 1) : trimmed;
      writeFileSync(logPath, writeBuf);
    }
  } catch {
    // Best-effort logging; never throw from a shutdown path.
  }
}

process.on("exit", (code) => {
  // The `exit` event only allows synchronous work; appendFileSync is.
  recordBridgeExit({ code });
});
