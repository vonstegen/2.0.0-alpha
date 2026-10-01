#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
import {
  createWorkspaceAddonCredentialResolver,
  loadWorkspaceAddonCredentials,
} from "./workspace-addon-credentials.mjs";
import { buildBridgeCapabilityTokens } from "./bridge-capability-tokens.mjs";
import { createAddonDelegationHostService } from "./addon-delegation-host-service.mjs";
import { createAddonDelegationService } from "./addon-delegation-service.mjs";
import { createOpencodeHttpClient, ensureOpencodeServer, forgetOpencodeServer } from "./opencode-client.mjs";
import { createOpenCodeBoundary } from "./opencode-boundary.mjs";
import { createOpencodeSessionHandlers, createOpencodeSessionHostService } from "./opencode-session-host-service.mjs";
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
import { createHarnessHostService } from "./harness-host-service.mjs";
import { createPiNativeSessionService } from "./pi-native-session-service.mjs";
import { createHarnessResourceProjection } from "./harness-resource-projection.mjs";
import { buildSkillCatalogFromManifests, createHarnessSkillsProjection } from "./harness-skills-projection.mjs";
import { createProviderHostService } from "./provider-host-service.mjs";
import {
  memorySourceMoveHistoryPath as sourceMoveHistoryPath,
  memorySourceRepairHistoryPath as sourceRepairHistoryPath,
  memorySourceSyncHistoryPath as sourceSyncHistoryPath,
} from "./memory-source-history.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const defaultResonantExtension = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");
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
// for Phase-3 (P6) workspace add-on grant lifecycle handlers.
// Host-owned provider-profile credential resolver: resolves a non-secret
// provider profile id into the profile's endpoint + the session-only credential
// the same store already serves Augmentor's provider-fabric. It never exposes
// the credential store or profile enumeration to a harness — it is a scoped,
// host-mediated lookup keyed by the profile id approved in the binding.
const resolveProviderProfileCredential = async (providerProfileId) => {
  const profiles = await providerHostService.allProviderProfiles();
  const profile = profiles.find((candidate) => candidate.id === providerProfileId);
  if (!profile || typeof profile.apiBaseUrl !== "string" || !profile.apiBaseUrl) {
    throw new Error("Unknown provider profile.");
  }
  const secrets = await providerHostService.readProviderSecrets();
  const actionToken = secrets[providerProfileId];
  if (!actionToken) {
    throw new Error("Provider profile credential is not configured for this host session.");
  }
  return { endpoint: profile.apiBaseUrl, actionToken };
};

const approvedBindings = JSON.parse(process.env.RESONANTOS_HARNESS_BINDINGS ?? "[]");

// ---- Pi-native testing-phase wiring (session-environment credential chain) ----
//
// The host owns every authority in the native Pi chain:
//   * authorized project           — repoRoot (host-approved Project identity)
//   * session cwd                  — resourceProjection.consume() re-validates an
//                                    issued Project/Files projection; a caller
//                                    path is never accepted
//   * authorize                    — CLEAN gate: installed + enabled +
//                                    agent-runtime granted + approved binding via
//                                    registry.snapshot(). Never the
//                                    authorize("primary-agent", …) slot
//                                    displacement P2 used. A revocation fences
//                                    NEW launch material while the shared
//                                    provider credential stays usable elsewhere.
//   * credential                   — resolveProviderProfileCredential (the same
//                                    ROS provider/vault mechanism as Augmentor)
//   * executable                   — piCommand() allowlist (pi-runtime.mjs)
//
// The raw (secret-bearing) plan never leaves the session service; only
// redactLaunchPlan() projections cross any observability/UI boundary.
//
// The clean authorize gate reads registry state only when a launch plan is
// being built, so the harness service may be constructed after this wiring.
let harnessService;

const piAuthorizedProject = Object.freeze({ id: "resonant-os", label: "ResonantOS Project", root: repoRoot });
const piResourceProjection = createHarnessResourceProjection({ authorizedProject: piAuthorizedProject, homeDir: os.homedir() });

// Phase 2C: host-owned skills staging. The catalog comes from the reviewed
// bundled add-on manifests; materialization writes only into the host-owned
// staging base and is cleaned up with the session.
const bundledAddonIndex = JSON.parse(await readFile(new URL("../../public/addons/index.json", import.meta.url), "utf8"));
const bundledAddonManifests = [];
for (const name of bundledAddonIndex) {
  bundledAddonManifests.push(JSON.parse(await readFile(new URL(`../../public/addons/${name}`, import.meta.url), "utf8")));
}
const piSkillCatalog = buildSkillCatalogFromManifests(bundledAddonManifests, { sourceRoot: repoRoot });
const piSkillsProjection = createHarnessSkillsProjection({
  authorizedProject: piAuthorizedProject,
  skillCatalog: piSkillCatalog,
  skillSourceRoot: repoRoot,
  stagingBase: path.join(userRoot(), "harness-skills-staging"),
  projectRoot: repoRoot,
  layout: { dir: ".pi/skills", file: "SKILL.md" },
});

const piDenied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });

// Clean launch authorization: registry state + approved binding only. Slot
// ownership is irrelevant here — installing, enabling, granting agent-runtime,
// and approving the binding is what authorizes a native Pi launch.
const piNativeAuthorize = ({ addonId, providerProfileId }) => {
  const projection = harnessService.registry.snapshot();
  const installation = projection.installations[addonId];
  if (!installation?.installed || !installation.enabled) throw piDenied();
  const agentGranted = (installation.grantedCapabilities ?? []).some(
    (grant) => grant.capability === "agent-runtime" && grant.granted === true,
  );
  if (!agentGranted) throw piDenied();
  const binding = approvedBindings.find((candidate) =>
    candidate.addonId === addonId &&
    candidate.adapterId === "pi-native-v1" &&
    typeof installation.agentRuntime?.credentialBinding === "string" &&
    candidate.name === installation.agentRuntime.credentialBinding &&
    candidate.authScheme === "session-environment" &&
    candidate.source && typeof candidate.source.providerProfileId === "string" &&
    candidate.source.providerProfileId === providerProfileId);
  if (!binding) throw piDenied();
};

const piGrantedCapabilities = (addonId) =>
  harnessService.registry.snapshot().installations[addonId]?.grantedCapabilities ?? [];

const piNativeSessionService = createPiNativeSessionService({
  providerHost: providerHostService,
  resolveProviderProfileCredential,
  authorize: piNativeAuthorize,
  consumeProjection: (projection, { addonId, sessionId }) =>
    piResourceProjection.consume(projection, {
      addonId,
      sessionId,
      authorizedProject: piAuthorizedProject,
      grantedCapabilities: piGrantedCapabilities(addonId),
    }),
  envAllowlist: ["PATH", "HOME"],
  baseEnv: {
    // Isolate pi from the user's durable agent dir (auth.json, extensions,
    // settings, sessions): the session-environment credential is then the ONLY
    // key source, and the user's federated extension bootstraps never run
    // inside a harness turn. The isolated dir is host-owned and disposable;
    // pi may create an empty auth.json there, but the session credential is
    // never written to it.
    PI_CODING_AGENT_DIR: path.join(userRoot(), "pi-coding-agent-isolated"),
  },
  homeDir: os.homedir(),
});

// Host-issued session projection: the ONLY source of the launch cwd. Issued
// per adapter session from the manifest's declared resource request and the
// CURRENT granted capabilities.
const issuePiProjection = async ({ addonId, sessionId, manifest }) => {
  const request = manifest?.harnessResources ?? { requests: { project: ["read"], files: ["read"] } };
  const result = await piResourceProjection.project({
    addonId,
    sessionId,
    request,
    grantedCapabilities: piGrantedCapabilities(addonId),
  });
  if (result.ok !== true) throw piDenied();
  return result;
};

// Phase 2C staging (best-effort): materialize read-eligible skills into the
// host-owned disposable staging tree for this session. A staging failure never
// blocks the session (skills are optional), but the projection is retained so
// dispose() can clean the owned tree.
const stagePiSkills = async ({ addonId, sessionId, manifest, projection }) => {
  const issued = piSkillsProjection.project({
    addonId,
    sessionId,
    request: manifest?.harnessResources,
    grantedCapabilities: piGrantedCapabilities(addonId),
  });
  if (issued.ok !== true) return null;
  for (const skill of piSkillsProjection.listSkills(issued.projection)) {
    const materialized = await piSkillsProjection.materialize(issued.projection, skill.id);
    if (!materialized.ok) {
      console.error(JSON.stringify({ event: "pi.skills.materialize_failed", code: materialized.code, skill: skill.id }));
    }
  }
  return issued;
};

const cleanupPiSkills = async ({ addonId, sessionId, projection }) => {
  if (!projection) return;
  await piSkillsProjection.cleanup(projection, {
    addonId,
    sessionId,
    authorizedProject: piAuthorizedProject,
    grantedCapabilities: piGrantedCapabilities(addonId),
    skillCatalog: piSkillCatalog,
  });
};

// The adapter-side session chain (agent-adapters/pi-native.mjs) composes these
// host authorities behind the same interface as every other reviewed adapter.
const piNativeHost = Object.freeze({
  sessionService: piNativeSessionService,
  issueProjection: issuePiProjection,
  stageSkills: stagePiSkills,
  cleanupSkills: cleanupPiSkills,
});

harnessService = await createHarnessHostService({
  userRoot: userRoot(), providerHost: providerHostService,
  resolveProviderProfileCredential,
  bindings: approvedBindings,
  env: process.env,
  piNative: piNativeHost,
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
  // T6/T6.1: one generic provisioning document (JSON) replaces the
  // demo-specific per-add-on token maps. NO raw secret material in argv:
  // precedence is --workspace-addon-credentials-file=<path> (a file
  // *reference*), then RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE, then
  // RESONANTOS_WORKSPACE_ADDON_CREDENTIALS (env JSON), then fail closed. The
  // historical --workspace-addon-credentials=<json> flag is not read. The
  // resolver maps (addon identity + purpose) -> scoped material; admin URLs
  // are derived from the validated manifest entrypoint unless the document
  // pins an `adminUrl` (host-only, true-loopback-validated; 0.0.0.0 rejected).
  // No per-add-on code, no per-add-on flags.
  workspaceAddonCredentialResolver: createWorkspaceAddonCredentialResolver({
    credentials: await loadWorkspaceAddonCredentials({ args }),
  }),
});

const { executeAddonsStatus } = addonDelegationService;
const { addonDelegationRoutes } = createAddonDelegationHostService(addonDelegationService);

function getPublicPort() {
  const publicUrl = getBridgePublicUrlValue();
  if (!publicUrl) return undefined;
  try {
    const parsed = new URL(publicUrl);
    if (!isLoopbackBridgeHost(parsed.hostname) || parsed.username || parsed.password) return undefined;
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
  ensureServer: () => ensureOpencodeServer({
    fetchImpl: (...args) => fetch(...args),
    spawnImpl: (cmd, cmdArgs, opts) => spawn(cmd, cmdArgs, opts),
    command: resolveOpenCodeCommand(),
    hostname: "127.0.0.1",
    port: process.env.RESONANTOS_OPENCODE_PORT ? Number(process.env.RESONANTOS_OPENCODE_PORT) : undefined,
    env: process.env,
  }),
  createClient: (baseUrl, opts = {}) => createOpencodeHttpClient({ fetchImpl: (...args) => fetch(...args), baseUrl, ...opts }),
  fetchImpl: (...args) => fetch(...args),
  executionEnabled: () => addonDelegationService.openCodeProxyExecutionEnabled(),
  forgetServer: forgetOpencodeServer,
  log: logOpenCodeBoundary,
});
const unsubscribeOpenCodeExecution = addonDelegationService.subscribeOpenCodeExecution(
  (enabled) => (enabled ? undefined : openCodeBoundary.revoke()),
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

const { extensionPrefsRoutes, flushPendingExtensionPrefs } = createExtensionPrefsHostService({ userRoot });

const { harnessRoutes } = harnessService;
const providerBridgeRoutes = harnessService.composeProviderRoutes(legacyProviderBridgeRoutes);

// Pi-native proof trigger. Loopback-only, bridge-token + provider-model-invoke
// capability gated, harness error family. Runs the proof IN the bridge process
// (sharing the Settings-configured session credential) through the FULL testing
// chain: clean authorize gate -> issued Project/Files projection (the only cwd
// source) -> reviewed planner -> bounded launcher. Returns ONLY redacted
// evidence: redactLaunchPlan(plan) projection + sanitized process output. The
// raw plan (secret-bearing env) never crosses this boundary.
const piHarnessManifest = JSON.parse(
  await readFile(new URL("../../examples/addons/pi-harness.json", import.meta.url), "utf8"),
);
const piNativeProofRoute = {
  method: "POST",
  path: "/pi-native/proof",
  requiredCapability: "provider-model-invoke",
  loopbackHostOnly: true,
  errorFamily: "harness",
  async handler(payload = {}) {
    const providerProfileId = String(payload.providerProfileId ?? "").trim();
    const prompt = String(payload.prompt ?? "").trim();
    if (!providerProfileId || !prompt) {
      throw Object.assign(new Error("invalid-event"), { code: "invalid-event" });
    }
    const selectedModel = typeof payload.selectedModel === "string" ? payload.selectedModel.trim() : "";
    const sessionId = randomUUID();
    // One-shot session projection for this proof turn: the cwd is the authorized
    // project root, never a caller path.
    const issued = await issuePiProjection({ addonId: piHarnessManifest.id, sessionId, manifest: piHarnessManifest });
    const result = await piNativeSessionService.launchProof({
      addonId: piHarnessManifest.id,
      manifest: piHarnessManifest,
      providerProfileId,
      selectedModel,
      projection: issued.projection,
      sessionId,
      prompt,
    });
    const { evidence, projection } = result;
    return { projection, evidence: { ...evidence, exitCode: evidence.exitCode ?? null } };
  },
};

const bridgeRoutes = [
  ...browserDiagnosticsRoutes,
  ...providerBridgeRoutes,
  ...agentControlRoutes,
  ...memoryBridgeRoutes,
  ...addonDelegationRoutes,
  ...opencodeSessionRoutes,
  ...extensionPrefsRoutes,
  ...harnessRoutes,
  piNativeProofRoute,
];

const bridgeToken = args.get("bridge-token") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? createBridgeToken();
const capabilityBootstrapToken = args.get("capability-bootstrap-token") ??
  process.env.RESONANTOS_BROWSER_FIRST_CAPABILITY_BOOTSTRAP_TOKEN ??
  createBridgeToken();
const bridgeCapabilityTokens = buildBridgeCapabilityTokens({ args, mint: createBridgeToken });

const invokeBridgeRouteForSelfTest = createBridgeRouteSelfTestInvoker({
  bridgeToken,
  bridgeCapabilityTokens,
  capabilityBootstrapToken,
  routes: bridgeRoutes,
  listenerPort: Number(args.get("bridge-port") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ?? defaultBridgePort),
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

const bridgePort = Number(args.get("bridge-port") ?? process.env.RESONANTOS_BROWSER_FIRST_BRIDGE_PORT ?? defaultBridgePort);
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

console.log(JSON.stringify({
  event: "browser.first.bridge_started",
  requestedPort: bridgeInfo.requestedPort,
  attemptedPort: bridgeInfo.attemptedPort,
  actualPort: activeBridgePort,
  recovered: bridgeInfo.recovered,
  bridgeUrl: bridgePublicUrl,
  bridgeConfigPath,
  extensionRoot: resonantExtension,
}, null, 2));
console.log(`Load ${resonantExtension} in Chrome as an unpacked extension.`);

const shutdown = async () => {
  await flushPendingExtensionPrefs().catch(() => undefined);
  try { unsubscribeOpenCodeExecution(); } catch { /* noop */ }
  await openCodeBoundary.dispose().catch(() => undefined);
  await harnessService.close();
  await new Promise((resolve) => bridgeInfo.server.close(resolve));
};

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}
