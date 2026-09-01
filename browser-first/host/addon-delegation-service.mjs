import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  appendProviderHandoffAudit,
  buildProviderDraftHandoff,
  parseDraftPacketMarkdown,
} from "./addon-draft-connectors.mjs";
import { dashboardProxyUrl } from "./bridge-server.mjs";
import { ensureOpencodeServer } from "./opencode-client.mjs";
import { createOpenCodeWebUrlHandler } from "./opencode-session-host-service.mjs";
import { addonTrustAndIsolationSnapshot } from "./dev-panel-addon-snapshot.mjs";
import {
  createHermesProviderAdapterBridge,
  createOpenCodeProviderAdapterBridge,
} from "./addon-delegation-adapter-bridge.mjs";

// Provider/model defaults are owned by the adapter bridge; the host service
// only needs them for the lightweight status endpoints (which still read
// runtime + provider/model metadata without delegating the full lifecycle).
// The values must match `addon-delegation-adapter-bridge.mjs` to keep the
// 1197-test wire format identical.
const DEFAULT_OPENCODE_MODEL = "openai/gpt-5.4-mini";
const MINIMAX_OPENCODE_MODEL = "minimax/MiniMax-M3";
const DEFAULT_HERMES_PROVIDER = "openai-api";
const DEFAULT_HERMES_MODEL = "gpt-5.4-mini";
const DEFAULT_HERMES_MINIMAX_MODEL = "MiniMax-M3";
const MINIMAX_OPENAI_COMPAT_BASE_URL = "https://api.minimax.io/v1";

const providerEnvKeyDefaults = Object.freeze({
  anthropic: ["ANTHROPIC_API_KEY"],
  "anthropic-api": ["ANTHROPIC_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY"],
  glm: ["GLM_API_KEY", "ZAI_API_KEY", "ZHIPUAI_API_KEY"],
  google: ["GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"],
  minimax: ["MINIMAX_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-api": ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  xai: ["XAI_API_KEY"],
  zai: ["ZAI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY"],
  zhipuai: ["ZHIPUAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY"],
});

// Discover addon manifests under examples/addons/ and public/addons/.
// Returns an array of { id, manifest, source } entries deduplicated by id.
export async function discoverBundledAddonManifests(repoRoot) {
  const dirs = ["examples/addons", "public/addons"];
  const merged = new Map();
  for (const relDir of dirs) {
    const absDir = path.resolve(repoRoot, relDir);
    let entries = [];
    try {
      entries = await readdir(absDir);
    } catch {
      continue;
    }
    for (const fileName of entries) {
      if (!fileName.endsWith(".json")) continue;
      const filePath = path.join(absDir, fileName);
      let raw;
      try {
        raw = await readFile(filePath, "utf8");
      } catch {
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const id = typeof parsed?.id === "string" ? parsed.id : null;
      if (!id) continue;
      merged.set(id, { id, manifest: parsed, source: relDir });
    }
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// Map a discovered manifest to the `mode` value the extension's
// main-workspace-addons.js expects.
export function modeForManifest(manifest) {
  const systemSlots = Array.isArray(manifest.systemSlots) ? manifest.systemSlots : [];
  if (systemSlots.some((slot) => slot?.id === "memory-system")) return "memory-system";
  if (manifest.runtimeType === "agent-addon") return "delegation-addon";
  if (manifest.runtimeType === "embedded-module") return "coding-addon";
  if (manifest.runtimeType === "local-service") {
    return manifest.category === "memory" ? "memory-system" : "draft-only-communication-addon";
  }
  return "unknown";
}

export function trustLabelFor(manifest) {
  if (manifest.runtimeType === "agent-addon") return "add-on agent";
  if (manifest.runtimeType === "local-service" && manifest.category === "memory") {
    return "host-mediated memory provider";
  }
  return "host-mediated service";
}

// Mirrors src/sdk/addons/surface-routing.ts `createAddOnSurfaceDockRoutes`.
// The SDK is TypeScript and not importable from this plain-`.mjs` host
// runtime (the bench runs source directly, no tsc step), so the pure
// resolver is mirrored here — same shape, same semantics, same order.
function hasGrantedCapability(installation, capability) {
  return Array.isArray(installation?.grantedCapabilities) &&
    installation.grantedCapabilities.some((grant) => grant?.capability === capability && grant?.granted);
}

export function createAddOnSurfaceDockRoutes(manifests, installations) {
  return manifests
    .flatMap((manifest) => {
      const installation = installations[manifest.id];
      if (!installation?.installed || !installation.enabled) {
        return [];
      }
      return (Array.isArray(manifest.surfaces) ? manifest.surfaces : []).flatMap((surface) => {
        const navigation = surface?.shellNavigation;
        if (!navigation) {
          return [];
        }
        const missingCapability = (navigation.requiredCapabilities ?? []).find(
          (capability) => !hasGrantedCapability(installation, capability),
        );
        if (missingCapability) {
          return [];
        }
        return [
          {
            addonId: manifest.id,
            surfaceId: surface.id,
            sectionId: navigation.sectionId,
            label: surface.label || manifest.name,
            eyebrow: navigation.eyebrow,
            dockIcon: navigation.dockIcon,
            order: navigation.order ?? 1000,
          },
        ];
      });
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}

// Mirrors src/sdk/addons/architecture.ts (G0_HARNESS_TOOL_CATALOG +
// railMenuKindForCategory) and src/sdk/addons/surface-routing.ts
// (createShellRailMenus / createRosHarnessMenu / createAddOnRailMenus). The
// shell always leads with the fused-core "ROS Harness" menu (its own minimal
// tool loop), then agent add-ons each get their own menu, memory providers
// collapse into "Memory", and every other category collapses into "Tools".
const SHELL_RAIL_MENUS = Object.freeze({
  memory: { label: "Memory", dockIcon: "memory" },
  tools: { label: "Tools", dockIcon: "tool" },
});

function menuKindForCategory(category) {
  if (category === "agent") return "harness";
  if (category === "memory") return "memory";
  return "tools";
}

const byOrderThenLabel = (left, right) =>
  left.order - right.order || String(left.label).localeCompare(String(right.label));

export function createAddOnRailMenus(manifests, installations) {
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const routes = createAddOnSurfaceDockRoutes(manifests, installations);

  const groups = new Map();
  for (const route of routes) {
    const manifest = manifestById.get(route.addonId);
    const kind = menuKindForCategory(manifest?.category ?? "tool");
    const key = kind === "harness" ? route.addonId : kind;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind,
        label: kind === "harness" ? (manifest?.name ?? route.label) : SHELL_RAIL_MENUS[kind].label,
        dockIcon: kind === "harness" ? route.dockIcon : SHELL_RAIL_MENUS[kind].dockIcon,
        order: route.order,
        routes: [],
        tools: kind === "harness" ? manifest?.tools : undefined,
      };
      groups.set(key, group);
    }
    group.order = Math.min(group.order, route.order);
    group.routes.push(route);
  }

  return [...groups.values()]
    .map((group) => ({
      menuId: group.kind === "harness" ? group.routes[0].sectionId : group.kind,
      kind: group.kind,
      label: group.label,
      dockIcon: group.dockIcon,
      order: group.order,
      routes: group.routes.sort(byOrderThenLabel),
      tools: group.tools,
    }))
    .sort(byOrderThenLabel);
}

// ---- ROS Harness (fused-core) rail menu -------------------------------------
// Mirrors src/sdk/addons/surface-routing.ts createRosHarnessMenu. The G0
// harness ships a minimal tool loop; an installed add-on whose tool declares
// `coversNativeTool` supersedes (grays out) the equivalent G0 tool.
const G0_HARNESS_TOOL_CATALOG = Object.freeze([
  { name: "research.search_api", description: "Search the web for current information.", domain: "research" },
  { name: "research.fetch_url", description: "Fetch and read a web page.", domain: "research" },
  { name: "browser.session", description: "Drive a controlled browser session.", domain: "browser" },
  { name: "filesystem.read", description: "Read a file within scope.", domain: "filesystem" },
  { name: "filesystem.search", description: "Search code and text within scope.", domain: "filesystem" },
  { name: "filesystem.patch", description: "Apply a reviewed, scoped patch.", domain: "filesystem" },
  { name: "process.safe_command", description: "Run an allowlisted shell command.", domain: "process" },
  { name: "provider.probe", description: "Probe a provider's health and credentials.", domain: "provider" },
  { name: "provider.route_select", description: "Select a model route within policy.", domain: "provider" },
  { name: "archive.search", description: "Search the trusted archive.", domain: "archive" },
  { name: "archive.read", description: "Read a trusted archive page.", domain: "archive" },
  { name: "archive.intake_write", description: "Write through the ingest path (Strategist-owned).", domain: "archive" },
  { name: "delegation.create_packet", description: "Create a delegation packet for another agent.", domain: "delegation" },
]);

export function createRosHarnessMenu(manifests, installations) {
  const supersedeByNativeTool = new Map();
  for (const manifest of manifests) {
    const installation = installations[manifest.id];
    if (!installation?.installed || !installation.enabled) continue;
    for (const tool of manifest.tools ?? []) {
      if (tool.coversNativeTool && !supersedeByNativeTool.has(tool.coversNativeTool)) {
        supersedeByNativeTool.set(tool.coversNativeTool, { addonId: manifest.id, toolName: tool.name });
      }
    }
  }
  return {
    menuId: "ros-harness",
    kind: "harness",
    label: "ROS Harness",
    dockIcon: "harness",
    order: 0,
    routes: [],
    nativeTools: G0_HARNESS_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      description: tool.description,
      domain: tool.domain,
      supersededBy: supersedeByNativeTool.get(tool.name),
    })),
  };
}

export function createShellRailMenus(manifests, installations) {
  return [createRosHarnessMenu(manifests, installations), ...createAddOnRailMenus(manifests, installations)];
}
export const OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS = Object.freeze([
  "ANTHROPIC_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "GEMINI_BASE_URL",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "GOOGLE_API_BASE_URL",
  "GLM_BASE_URL",
  "MINIMAX_BASE_URL",
  "OPENAI_BASE_URL",
  "OPENROUTER_BASE_URL",
  "XAI_BASE_URL",
  "ZAI_BASE_URL",
  "ZHIPUAI_BASE_URL",
]);

const providerSecretIdDefaults = Object.freeze({
  anthropic: ["shared-anthropic", "anthropic"],
  "anthropic-api": ["shared-anthropic", "anthropic"],
  deepseek: ["shared-deepseek", "deepseek"],
  gemini: ["shared-gemini", "shared-google", "gemini", "google"],
  google: ["shared-google", "shared-gemini", "google", "gemini"],
  minimax: ["shared-minimax", "minimax"],
  openai: ["shared-openai", "openai"],
  "openai-api": ["shared-openai", "openai"],
  openrouter: ["shared-openrouter", "openrouter"],
  xai: ["shared-xai", "xai"],
  zai: ["shared-zai-glm", "shared-zai", "zai", "glm", "zhipuai"],
  zhipuai: ["shared-zai-glm", "shared-zhipuai", "zhipuai", "zai", "glm"],
});

function providerFromModel(model, fallback = "") {
  const [provider] = String(model ?? "").trim().split("/");
  return provider && provider !== String(model ?? "").trim() ? provider.toLowerCase() : fallback;
}

function providerEnvKeysForProvider(provider) {
  return providerEnvKeyDefaults[String(provider ?? "").trim().toLowerCase()] ?? [];
}

function providerSecretCandidates(provider) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  return providerSecretIdDefaults[normalized] ?? (normalized ? [`shared-${normalized}`, normalized] : []);
}

function secretForProvider(provider, secrets = {}) {
  const normalized = String(provider ?? "").trim().toLowerCase();
  const entries = Object.entries(secrets ?? {})
    .map(([providerId, credential]) => [String(providerId ?? "").trim(), String(credential ?? "").trim()])
    .filter(([providerId, credential]) => providerId && credential);
  const byId = new Map(entries.map(([providerId, credential]) => [providerId.toLowerCase(), credential]));
  for (const candidate of providerSecretCandidates(normalized)) {
    const credential = byId.get(String(candidate).toLowerCase());
    if (credential) return credential;
  }
  const fuzzy = entries.find(([providerId]) => {
    const id = providerId.toLowerCase();
    return normalized && (id === normalized || id.includes(`-${normalized}`) || id.includes(normalized));
  });
  return fuzzy?.[1] ?? "";
}

function providerEnvFromSecrets(provider, secrets = {}, envKeys = providerEnvKeysForProvider(provider)) {
  const credential = secretForProvider(provider, secrets);
  if (!credential) return {};
  const selectedKey = envKeys.find((key) => !String(process.env[key] ?? "").trim()) ?? envKeys[0];
  return selectedKey ? { [selectedKey]: credential } : {};
}

function providerCredential(provider, secrets = {}, envKeys = providerEnvKeysForProvider(provider)) {
  const secret = secretForProvider(provider, secrets);
  if (secret) return secret;
  return envKeys
    .map((key) => String(process.env[key] ?? "").trim())
    .find(Boolean) ?? "";
}

function providerEnvKeysPresent(provider, secrets = {}, envKeys = providerEnvKeysForProvider(provider)) {
  const fromProcess = envKeys.filter((key) => String(process.env[key] ?? "").trim());
  const fromSecrets = secretForProvider(provider, secrets) ? [envKeys[0]].filter(Boolean) : [];
  return [...new Set([...fromProcess, ...fromSecrets])];
}

function redactCliText(value) {
  return String(value ?? "")
    .replace(/sk-[a-z0-9_-]+/gi, "[redacted-key]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_-]?key\s*[:=]\s*[^\s]+/gi, "api_key=[redacted]")
    .replace(/token\s*[:=]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret=[redacted]");
}

// When the bridge runs on a multi-homed host (e.g. the Pi5 has loopback,
// LAN 192.168.1.100, and Tailscale 100.100.100.100), it has to publish URLs
// that a remote extension can actually reach. `dashboardTarget()` returns
// the loopback URL the dashboard process binds to (correct for the bridge
// to manage the process), but the URL the extension displays to the user
// must be the one that resolves on the *client* machine — same port, but
// the host the bridge has told clients to dial. We use the same env var
// the bridge config file uses (RESONANTOS_BRIDGE_PUBLIC_URL) so the two
// stay in lockstep.
function clientReachableHost() {
  const explicit = process.env.RESONANTOS_BRIDGE_PUBLIC_URL;
  if (explicit) {
    try {
      const u = new URL(explicit);
      return u.hostname || "127.0.0.1";
    } catch {
      /* fall through to RESONANTOS_BRIDGE_HOST */
    }
  }
  const host = process.env.RESONANTOS_BRIDGE_HOST ?? "127.0.0.1";
  // Don't expose a bind-everything address as a client-facing URL.
  if (host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function clientReachableUrl(loopbackUrl) {
  try {
    const u = new URL(loopbackUrl);
    return `${u.protocol}//${clientReachableHost()}:${u.port}`;
  } catch {
    return loopbackUrl;
  }
}

export function createAddonDelegationService(dependencies) {
  const {
    browserFirstRoot,
    bridgePublicUrl,
    dashboardTarget,
    execFileStdout,
    expandUserPath,
    firstExistingExecutable,
    hermesCommand,
    hermesHome,
    hermesPythonRuntime,
    listFilesRecursive,
    memoryRoot,
    opencodeCommand,
    opencodeRuntimeDiagnostics,
    ensureOpenCodeServer = ensureOpencodeServer,
    platform = process.platform,
    redactPathForDiagnostics,
    readProviderSecrets = async () => ({}),
    repoRoot,
    safeFileSlug,
    spawnProcess = spawn,
    socketOpen,
    uniqueRuntimeId,
    userRoot,
  } = dependencies;

  function currentOpenCodeRuntime() {
    if (typeof opencodeRuntimeDiagnostics === "function") {
      return opencodeRuntimeDiagnostics();
    }
    const command = opencodeCommand();
    return {
      installed: Boolean(command),
      command,
      commandRedacted: command ? redactPathForDiagnostics(command) : "",
      installHint: "Install OpenCode with `curl -fsSL https://opencode.ai/install | bash` or `npm install -g opencode-ai`. To select a binary at a supported fixed install root, set `OPENCODE_COMMAND=/usr/local/bin/opencode` and restart ResonantOS.",
      installCommand: "curl -fsSL https://opencode.ai/install | bash",
      alternativeInstallCommands: ["npm install -g opencode-ai", "brew install anomalyco/tap/opencode"],
      configureCommand: "OPENCODE_COMMAND=/usr/local/bin/opencode",
      searchedCommands: ["opencode", "opencode-ai"],
      searchedPaths: [],
      searchedPathCount: 0,
      searchedPathOmitted: 0,
      overrideConfigured: false,
      overridePath: "",
      overrideFound: false,
    };
  }

  function openCodeProviderForModel(model) {
    const normalized = String(model ?? "").trim();
    if (/^minimax-m/i.test(normalized)) return "minimax";
    if (/^gpt-/i.test(normalized)) return "openai";
    return providerFromModel(normalized, "openai");
  }

  function openCodeModel(payload = {}, secrets = {}) {
    const requested = String(payload.model ?? process.env.RESONANTOS_OPENCODE_MODEL ?? "").trim();
    if (requested) return requested;
    if (providerEnvKeysPresent("minimax", secrets).length) return MINIMAX_OPENCODE_MODEL;
    return DEFAULT_OPENCODE_MODEL;
  }

  function isAllowedOpenCodeProviderEnvKey(key) {
    return OPENCODE_EXPLICIT_PROVIDER_ENV_KEYS.includes(key);
  }

  function openCodeProviderEnvKeys(model) {
    const provider = openCodeProviderForModel(model);
    const explicit = String(process.env.RESONANTOS_OPENCODE_PROVIDER_ENV ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter(isAllowedOpenCodeProviderEnvKey);
    return [...new Set([...providerEnvKeysForProvider(provider), ...explicit])];
  }

  // Hermes dashboard + status thin helpers. The lifecycle heavy lifting is
  // owned by the adapter bridge; the dashboard still needs provider/model
  // resolution + scoped env composition because the dashboard process is a
  // long-running background process (not a task packet).
  const hermesBridge = createHermesProviderAdapterBridge();
  function hermesProvider(payload = {}, secrets = {}) {
    return hermesBridge.resolveProvider(payload, secrets);
  }
  function hermesModel(payload = {}, provider = DEFAULT_HERMES_PROVIDER) {
    return hermesBridge.resolveModel(payload, provider);
  }
  function scopedHermesEnv({ provider, model, profileHome, secrets = {} } = {}) {
    return hermesBridge.scopedEnv({ provider, model, profileHome, secrets });
  }


  // Reverse-proxy URL the extension can embed in an iframe without tripping
  // Chrome's mixed-content blocker. The proxy lives at the bridge origin
  // (same origin as the bridge request itself), and the bridge streams the
  // Hermes dashboard (running on 127.0.0.1:9119 on the Pi) through it. The
  // dependency is a getter (not a static string) because the bridge host URL
  // is only known after the server actually binds a port.
  function clientReachableProxyUrl() {
    return dashboardProxyUrl({
      publicUrl: typeof bridgePublicUrl === "function" ? bridgePublicUrl() : bridgePublicUrl,
    });
  }

  async function executeGoalRecord(payload) {
    const mission = String(payload.mission ?? "").trim();
    if (mission.length < 8) {
      throw new Error("Goal requires a concrete mission.");
    }
    const goalDir = path.join(browserFirstRoot(), "Goals");
    await mkdir(goalDir, { recursive: true });
    const goal = {
      id: uniqueRuntimeId("goal"),
      mission,
      success: payload.success ?? [],
      constraints: payload.constraints ?? [],
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const goalPath = path.join(goalDir, `${goal.id}.json`);
    await writeFile(goalPath, `${JSON.stringify(goal, null, 2)}\n`);
    return { ...goal, path: path.relative(userRoot(), goalPath) };
  }

  async function executeDelegationRecord(payload) {
    const target = String(payload.target ?? "").trim().toLowerCase();
    const mission = String(payload.mission ?? "").trim();
    const contextMarkdown = String(payload.contextMarkdown ?? "").trim().slice(0, 24_000);
    const source = String(payload.source ?? "resonantos-chat").trim().slice(0, 120);
    const sourceControlRunId = String(payload.sourceControlRunId ?? "").trim().slice(0, 120);
    if (!["hermes", "opencode", "engineer"].includes(target)) {
      throw new Error("Delegation target must be hermes, opencode, or engineer.");
    }
    if (mission.length < 8) {
      throw new Error("Delegation requires a concrete mission.");
    }
    const taskDir = path.join(delegationRoot(), target);
    await mkdir(taskDir, { recursive: true });
    const id = uniqueRuntimeId(target);
    const taskPath = path.join(taskDir, `${id}.md`);
    const body = [
      `# Delegation: ${target}`,
      "",
      `- id: ${id}`,
      `- createdAt: ${new Date().toISOString()}`,
      `- source: ResonantOS Browser Layer`,
      `- sourceKind: ${source || "resonantos-chat"}`,
      ...(sourceControlRunId ? [`- sourceControlRunId: ${sourceControlRunId}`] : []),
      `- status: queued`,
      `- trust: add-on agent, not core trusted Strategist`,
      "- allowedCapabilities: agent-delegation, archive-read-optional",
      "- forbiddenActions: provider-secrets, wallet-actions, trusted-memory-write, external-send",
      "- approvalRequiredBeforeExternalAction: true",
      "- expectedArtifacts: final-summary, actions-taken, approval-needs, residual-risks, verification",
      "",
      "## Mission",
      mission,
      "",
      "## Success Criteria",
      "- Return a concise final summary.",
      "- List actions taken or explain why no action was taken.",
      "- Identify any approval needed before external communication or public action.",
      "- State residual risks and verification evidence.",
      "",
      ...(contextMarkdown
        ? [
          "## Context Packet",
          contextMarkdown,
          ""
        ]
        : []),
      "## Artifact Return Contract",
      "- finalSummary: user-facing result",
      "- actionsTaken: bounded list",
      "- approvalNeeds: human review gates",
      "- residualRisks: uncertainty and limitations",
      "- verification: how the result was checked",
      "",
      "## Boundary",
      "The add-on receives a task packet only. Provider secrets, wallet actions, and trusted memory writes remain host-mediated.",
      "",
    ].join("\n");
    await writeFile(taskPath, body);
    return {
      hasContextPacket: Boolean(contextMarkdown),
      id,
      mission,
      path: path.relative(userRoot(), taskPath),
      source,
      sourceControlRunId,
      status: "queued",
      target,
    };
  }

  async function executeAddonDraftRecord(payload) {
    const target = String(payload.target ?? "").trim().toLowerCase();
    if (!["email", "calendar"].includes(target)) {
      throw new Error("Draft target must be email or calendar.");
    }
    const intent = String(payload.intent ?? payload.subject ?? payload.title ?? "").trim();
    const body = String(payload.body ?? payload.details ?? payload.mission ?? "").trim();
    if (intent.length < 3 || body.length < 8) {
      throw new Error("Draft requires a concrete intent and body.");
    }
    const draftDir = path.join(browserFirstRoot(), "AddOnDrafts", target);
    await mkdir(draftDir, { recursive: true });
    const id = uniqueRuntimeId(`${target}-draft`);
    const draftPath = path.join(draftDir, `${id}-${safeFileSlug(intent)}.md`);
    const content = [
      `# ${target === "email" ? "Email" : "Calendar"} Draft`,
      "",
      `- id: ${id}`,
      `- createdAt: ${new Date().toISOString()}`,
      `- target: ${target}`,
      "- status: draft-only",
      "- approvalRequired: true",
      "- source: ResonantOS Browser Layer",
      "",
      "## Intent",
      intent,
      "",
      "## Draft Body",
      body,
      "",
      "## Boundary",
      target === "email"
        ? "This is a draft packet only. ResonantOS does not send email from this route; sending requires a separate human approval flow in the email add-on."
        : "This is a draft packet only. ResonantOS does not schedule calendar events from this route; scheduling requires a separate human approval flow in the calendar add-on.",
      "",
    ].join("\n");
    await writeFile(draftPath, content);
    return {
      approvalRequired: true,
      id,
      path: path.relative(userRoot(), draftPath),
      status: "draft-created",
      target,
    };
  }

  function draftRoot() {
    return path.join(browserFirstRoot(), "AddOnDrafts");
  }

  function delegationRoot() {
    return path.join(browserFirstRoot(), "Delegations");
  }

  function delegationArtifactRoot() {
    return path.join(browserFirstRoot(), "DelegationArtifacts");
  }

  function addonExecutionSettingsPath() {
    return path.join(browserFirstRoot(), "Settings", "addon-execution.json");
  }

  function addonGovernanceAuditPath() {
    return path.join(browserFirstRoot(), "Settings", "addon-governance-audit.jsonl");
  }

  function defaultAddonExecutionSettings() {
    return {
      hermes: { localCliExecution: false },
      opencode: { localCliExecution: false },
      disabledAddons: [],
      uninstalledAddons: [],
    };
  }

  function normalizeAddonExecutionSettings(value = {}) {
    const defaults = defaultAddonExecutionSettings();
    const list = (candidate) => [...new Set((Array.isArray(candidate) ? candidate : []).map((entry) => String(entry)).filter(Boolean))].sort();
    return {
      hermes: { localCliExecution: Boolean(value?.hermes?.localCliExecution ?? defaults.hermes.localCliExecution) },
      opencode: { localCliExecution: Boolean(value?.opencode?.localCliExecution ?? defaults.opencode.localCliExecution) },
      disabledAddons: list(value?.disabledAddons ?? defaults.disabledAddons),
      uninstalledAddons: list(value?.uninstalledAddons ?? defaults.uninstalledAddons),
    };
  }

  async function readAddonExecutionSettings() {
    const raw = await readFile(addonExecutionSettingsPath(), "utf8").catch(() => "");
    if (!raw) return defaultAddonExecutionSettings();
    try {
      return normalizeAddonExecutionSettings(JSON.parse(raw));
    } catch {
      return defaultAddonExecutionSettings();
    }
  }

  async function writeAddonExecutionSettings(next) {
    const normalized = normalizeAddonExecutionSettings(next);
    const filePath = addonExecutionSettingsPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => undefined);
    return normalized;
  }

  async function appendAddonGovernanceAuditEntry(entry) {
    const filePath = addonGovernanceAuditPath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    await chmod(filePath, 0o600).catch(() => undefined);
  }

  function addonLocalCliExecutionEnabled(addon, payload = {}, settings = defaultAddonExecutionSettings()) {
    if (addon === "hermes" && payload.enableHermesExecution === true) return true;
    if (addon === "opencode" && payload.enableOpenCodeExecution === true) return true;
    if (addon === "hermes" && /^enabled|true|1$/i.test(String(process.env.RESONANTOS_HERMES_EXECUTION ?? ""))) return true;
    if (addon === "opencode" && /^enabled|true|1$/i.test(String(process.env.RESONANTOS_OPENCODE_EXECUTION ?? ""))) return true;
    return Boolean(settings?.[addon]?.localCliExecution);
  }

  function resolveDraftPath(relativePath) {
    const resolved = path.resolve(userRoot(), String(relativePath ?? ""));
    const root = path.resolve(draftRoot());
    if (!resolved.startsWith(`${root}${path.sep}`) || !resolved.endsWith(".md")) {
      throw new Error("Draft path must point to a draft packet inside BrowserFirst/AddOnDrafts.");
    }
    return resolved;
  }

  function resolveDelegationPath(relativePath, expectedTarget = "") {
    const resolved = path.resolve(userRoot(), String(relativePath ?? ""));
    const target = String(expectedTarget ?? "").trim().toLowerCase();
    const root = path.resolve(target ? path.join(delegationRoot(), target) : delegationRoot());
    if (!resolved.startsWith(`${root}${path.sep}`) || !resolved.endsWith(".md")) {
      throw new Error("Delegation path must point to a task packet inside BrowserFirst/Delegations.");
    }
    return resolved;
  }

  function fieldFromMarkdown(content, field) {
    const match = new RegExp(`^- ${field}:\\s*(.+)$`, "mi").exec(content);
    return match ? match[1].trim() : "";
  }

  function sectionFromMarkdown(content, heading) {
    const normalizedContent = String(content ?? "").replace(/\r\n?/g, "\n");
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "i").exec(normalizedContent);
    return match ? match[1].trim() : "";
  }

  function sectionListFromMarkdown(content, heading) {
    return sectionFromMarkdown(content, heading)
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);
  }

  function resultArtifactPathFromMarkdown(content) {
    const fieldValue = fieldFromMarkdown(content, "resultArtifactPath");
    if (fieldValue) return fieldValue;
    return sectionFromMarkdown(content, "Result Artifact")
      .split(/\s+/)
      .map((line) => line.trim())
      .find(Boolean) || "";
  }

  function draftSummaryFromMarkdown(filePath, content, details) {
    return {
      id: fieldFromMarkdown(content, "id") || path.basename(filePath, ".md"),
      target: fieldFromMarkdown(content, "target") || path.basename(path.dirname(filePath)),
      status: fieldFromMarkdown(content, "status") || "draft-only",
      approvalRequired: /- approvalRequired:\s*true/i.test(content),
      path: path.relative(userRoot(), filePath),
      intent: sectionFromMarkdown(content, "Intent").slice(0, 220),
      updatedAt: details?.mtime?.toISOString?.() ?? "",
    };
  }

  function delegationSummaryFromMarkdown(filePath, content, details) {
    const context = sectionFromMarkdown(content, "Context Packet");
    const result = sectionFromMarkdown(content, "Result");
    return {
      contextExcerpt: context.replace(/\s+/g, " ").slice(0, 360),
      hasContextPacket: Boolean(context),
      id: fieldFromMarkdown(content, "id") || path.basename(filePath, ".md"),
      mission: sectionFromMarkdown(content, "Mission").slice(0, 360),
      path: path.relative(userRoot(), filePath),
      resultArtifactPath: resultArtifactPathFromMarkdown(content),
      resultExcerpt: result.replace(/\s+/g, " ").slice(0, 360),
      sourceControlRunId: fieldFromMarkdown(content, "sourceControlRunId"),
      sourceKind: fieldFromMarkdown(content, "sourceKind") || "resonantos-chat",
      status: fieldFromMarkdown(content, "status") || "queued",
      target: path.basename(path.dirname(filePath)),
      updatedAt: details?.mtime?.toISOString?.() ?? "",
    };
  }

  async function executeAddonDraftList(payload) {
    const limit = Math.min(40, Math.max(1, Number(payload.limit ?? 20)));
    const target = String(payload.target ?? "").trim().toLowerCase();
    const roots = ["email", "calendar"]
      .filter((candidate) => !target || candidate === target)
      .map((candidate) => path.join(draftRoot(), candidate));
    const files = [];
    for (const root of roots) {
      files.push(...await listFilesRecursive(root, (filePath) => filePath.endsWith(".md"), limit));
    }
    const drafts = [];
    for (const filePath of files) {
      const [details, content] = await Promise.all([
        stat(filePath).catch(() => null),
        readFile(filePath, "utf8").catch(() => ""),
      ]);
      if (!details || !content) continue;
      drafts.push(draftSummaryFromMarkdown(filePath, content, details));
    }
    drafts.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return { root: path.relative(userRoot(), draftRoot()), drafts: drafts.slice(0, limit) };
  }

  async function executeDelegationList(payload) {
    const limit = Math.min(40, Math.max(1, Number(payload.limit ?? 20)));
    const target = String(payload.target ?? "").trim().toLowerCase();
    const roots = ["hermes", "opencode", "engineer"]
      .filter((candidate) => !target || candidate === target)
      .map((candidate) => path.join(delegationRoot(), candidate));
    const files = [];
    for (const root of roots) {
      files.push(...await listFilesRecursive(root, (filePath) => filePath.endsWith(".md"), limit));
    }
    const delegations = [];
    for (const filePath of files) {
      const [details, content] = await Promise.all([
        stat(filePath).catch(() => null),
        readFile(filePath, "utf8").catch(() => ""),
      ]);
      if (!details || !content) continue;
      delegations.push(delegationSummaryFromMarkdown(filePath, content, details));
    }
    delegations.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
    return { root: path.relative(userRoot(), delegationRoot()), delegations: delegations.slice(0, limit) };
  }

  async function executeHermesStatus(payload = {}) {
    const executionSettings = await readAddonExecutionSettings();
    const profileHome = hermesHome(payload.profileHome);
    const command = hermesCommand(profileHome);
    const dashboard = await executeHermesDashboardStatus({ profileHome, host: payload.host, port: payload.port });
    const secrets = await readProviderSecrets();
    const provider = hermesProvider(payload, secrets);
    const model = hermesModel(payload, provider);
    const taskRoot = path.join(delegationRoot(), "hermes");
    const tasks = await listFilesRecursive(taskRoot, (filePath) => filePath.endsWith(".md"), 200);
    const statusCounts = {};
    for (const filePath of tasks) {
      const content = await readFile(filePath, "utf8").catch(() => "");
      const status = fieldFromMarkdown(content, "status") || "queued";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
    return {
      available: Boolean(command),
      command: command ? redactPathForDiagnostics(command) : "",
      dashboard,
      executionEnabled: addonLocalCliExecutionEnabled("hermes", payload, executionSettings),
      provider,
      model,
      providerEnvKeys: providerEnvKeysPresent(provider, secrets, providerEnvKeysForProvider(provider)),
      mode: command
        ? addonLocalCliExecutionEnabled("hermes", payload, executionSettings)
          ? "local-hermes-cli"
          : "local-hermes-cli-disabled"
        : "packet-only",
      profileHome: redactPathForDiagnostics(profileHome),
      taskCounts: statusCounts,
      boundary: "Hermes is an add-on agent. ResonantOS mediates task packets, artifacts, provider access, memory access, and external-send approval.",
    };
  }

  async function writeDelegationStatus(filePath, status, extraFields = {}) {
    const previous = await readFile(filePath, "utf8");
    let next = previous.replace(/^- status:\s*.+$/mi, `- status: ${status}`);
    for (const [field, value] of Object.entries(extraFields)) {
      const line = `- ${field}: ${String(value).replace(/\n/g, " ").trim()}`;
      const expression = new RegExp(`^- ${field}:\\s*.+$`, "mi");
      next = expression.test(next) ? next.replace(expression, line) : next.replace(/(\n## Mission\n)/, `\n${line}$1`);
    }
    await writeFile(filePath, next);
    return next;
  }

  async function failDelegationAfterRunning(taskPath, error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const updated = await writeDelegationStatus(taskPath, "failed", {
        failedAt: new Date().toISOString(),
        failureReason: message.slice(0, 500),
      });
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        failureReason: message,
        status: "failed",
      };
    } catch (statusError) {
      const statusMessage = statusError instanceof Error ? statusError.message : String(statusError);
      throw new Error(`Delegation failed, and failed-status recovery also failed: ${message}; recovery: ${statusMessage}`);
    }
  }

  // CP-4 Phase 4 cutover: Hermes lifecycle is owned by the adapter bridge.
  // The host service keeps the markdown packet writes + wire format; the
  // bridge owns credential gating, CLI invocation, env scoping, and result
  // parsing. See `addon-delegation-adapter-bridge.mjs` for the canonical
  // implementation. The shape returned by `bridge.startTask(...)` is one of:
  //   { kind: "blocked", reason, fieldReason, provider?, model? }
  //   { kind: "failed",  reason }
  //   { kind: "completed", result }
  // Each branch is mapped to the same status writes the legacy inline
  // implementation produced, so 1197 browser-first extension tests still
  // see byte-identical wire format.
  async function writeHermesResultArtifact(taskPath, packet, result) {
    const id = fieldFromMarkdown(packet, "id") || path.basename(taskPath, ".md");
    const artifactDir = path.join(delegationArtifactRoot(), "hermes");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${id}-result.md`);
    const lines = [
      `# Hermes Result: ${id}`,
      "",
      `- id: ${id}`,
      `- taskPath: ${path.relative(userRoot(), taskPath)}`,
      `- createdAt: ${new Date().toISOString()}`,
      `- adapter: ${result.adapter}`,
      "- status: completed",
      result.provider ? `- provider: ${result.provider}` : "",
      result.model ? `- model: ${result.model}` : "",
      "- boundary: Reviewable artifact only. External sends and trusted memory writes remain blocked.",
      "",
      "## Final Summary",
      result.finalSummary,
      "",
      "## Actions Taken",
      ...result.actionsTaken.map((item) => `- ${item}`),
      "",
      "## Approval Needs",
      ...result.approvalNeeds.map((item) => `- ${item}`),
      "",
      "## Residual Risks",
      ...result.residualRisks.map((item) => `- ${item}`),
      "",
      "## Verification",
      ...result.verification.map((item) => `- ${item}`),
      "",
    ];
    await writeFile(artifactPath, lines.join("\n"));
    return artifactPath;
  }

  async function executeHermesDelegationStart(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "hermes");
    const packet = await readFile(taskPath, "utf8");
    const settings = await readAddonExecutionSettings();
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_HERMES_ADAPTER ?? "auto").trim().toLowerCase();
    await writeDelegationStatus(taskPath, "running", {
      startedAt: new Date().toISOString(),
      adapter: adapter || "auto",
    });
    const profileHome = hermesHome(payload.profileHome);
    const command = hermesCommand(profileHome);
    const bridge = createHermesProviderAdapterBridge();
    const outcome = await bridge.startTask({
      payload,
      packet,
      profileHome,
      command,
      runtime: hermesPythonRuntime(command),
      secrets: await readProviderSecrets(),
      settings,
      localExecutionEnabled: addonLocalCliExecutionEnabled("hermes", payload, settings),
      disabledAddons: settings.disabledAddons ?? [],
      browserFirstRoot: browserFirstRoot(),
      repoRoot,
      spawnProcess,
    });
    if (outcome.kind === "blocked") {
      const updated = await writeDelegationStatus(taskPath, "blocked", {
        blockedAt: new Date().toISOString(),
        blockedReason: outcome.fieldReason ?? outcome.reason,
        ...(outcome.provider ? { provider: outcome.provider } : {}),
        ...(outcome.model ? { model: outcome.model } : {}),
      });
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        blockedReason: outcome.reason,
        status: "blocked",
      };
    }
    if (outcome.kind === "failed") {
      const updated = await writeDelegationStatus(taskPath, "failed", {
        failedAt: new Date().toISOString(),
        failureReason: outcome.reason.slice(0, 500),
      });
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        failureReason: outcome.reason,
        status: "failed",
      };
    }
    try {
      const artifactPath = await writeHermesResultArtifact(taskPath, packet, outcome.result);
      let updated = await writeDelegationStatus(taskPath, "completed", {
        completedAt: new Date().toISOString(),
        resultArtifactPath: path.relative(userRoot(), artifactPath),
      });
      updated = `${updated.trimEnd()}\n\n## Result\n${outcome.result.finalSummary}\n\n## Result Artifact\n${path.relative(userRoot(), artifactPath)}\n`;
      await writeFile(taskPath, updated);
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        adapter: outcome.result.adapter,
        artifact: {
          path: path.relative(userRoot(), artifactPath),
          ...outcome.result,
        },
        status: "completed",
      };
    } catch (error) {
      return failDelegationAfterRunning(taskPath, error);
    }
  }


  async function executeHermesDelegationStatus(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "hermes");
    const [details, content] = await Promise.all([stat(taskPath), readFile(taskPath, "utf8")]);
    return delegationSummaryFromMarkdown(taskPath, content, details);
  }

  async function executeHermesDelegationArtifact(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "hermes");
    const content = await readFile(taskPath, "utf8");
    const artifactRelative = resultArtifactPathFromMarkdown(content);
    if (!artifactRelative) {
      throw new Error("Hermes delegation has no result artifact yet.");
    }
    const artifactPath = path.resolve(userRoot(), artifactRelative);
    const artifactRoot = path.resolve(path.join(delegationArtifactRoot(), "hermes"));
    if (!artifactPath.startsWith(`${artifactRoot}${path.sep}`) || !artifactPath.endsWith(".md")) {
      throw new Error("Hermes result artifact path is outside the approved artifact root.");
    }
    const artifact = await readFile(artifactPath, "utf8");
    return {
      actionsTaken: sectionListFromMarkdown(artifact, "Actions Taken"),
      approvalNeeds: sectionListFromMarkdown(artifact, "Approval Needs"),
      content: artifact,
      finalSummary: sectionFromMarkdown(artifact, "Final Summary"),
      path: path.relative(userRoot(), artifactPath),
      residualRisks: sectionListFromMarkdown(artifact, "Residual Risks"),
      verification: sectionListFromMarkdown(artifact, "Verification"),
    };
  }

  async function executeHermesDelegationCancel(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "hermes");
    const content = await readFile(taskPath, "utf8");
    const currentStatus = fieldFromMarkdown(content, "status") || "queued";
    if (["completed", "cancelled"].includes(currentStatus)) {
      return delegationSummaryFromMarkdown(taskPath, content, await stat(taskPath));
    }
    const updated = await writeDelegationStatus(taskPath, "cancelled", {
      cancelledAt: new Date().toISOString(),
      cancelReason: String(payload.reason ?? "Human cancelled Hermes delegation.").slice(0, 240),
    });
    return delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath));
  }

  async function executeOpenCodeStatus(payload = {}) {
    const executionSettings = await readAddonExecutionSettings();
    const runtime = currentOpenCodeRuntime();
    const command = runtime.command;
    const secrets = await readProviderSecrets();
    const model = openCodeModel(payload, secrets);
    const provider = openCodeProviderForModel(model);
    const taskRoot = path.join(delegationRoot(), "opencode");
    const tasks = await listFilesRecursive(taskRoot, (filePath) => filePath.endsWith(".md"), 200);
    const statusCounts = {};
    for (const filePath of tasks) {
      const content = await readFile(filePath, "utf8").catch(() => "");
      const status = fieldFromMarkdown(content, "status") || "queued";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }
    return {
      installed: Boolean(command),
      command: runtime.commandRedacted || (command ? redactPathForDiagnostics(command) : ""),
      mode: command && addonLocalCliExecutionEnabled("opencode", payload, executionSettings) ? "local-opencode-cli" : command ? "local-opencode-cli-disabled" : "packet-only",
      executionEnabled: addonLocalCliExecutionEnabled("opencode", payload, executionSettings),
      workspaceLaunch: "not-enabled-in-browser-first-v1",
      model,
      modelSource: payload.model ? "request" : process.env.RESONANTOS_OPENCODE_MODEL ? "env" : model === MINIMAX_OPENCODE_MODEL ? "provider-default" : "default",
      providerEnvKeys: providerEnvKeysPresent(provider, secrets, openCodeProviderEnvKeys(model)),
      detail: command
        ? "OpenCode runtime was detected. ResonantOS can create governed coding packets and start execution only when explicit OpenCode execution is enabled."
        : "OpenCode runtime was not detected. Install OpenCode, or point ResonantOS at an existing binary with OPENCODE_COMMAND.",
      installHint: runtime.installHint,
      installCommand: runtime.installCommand,
      alternativeInstallCommands: runtime.alternativeInstallCommands,
      configureCommand: runtime.configureCommand,
      searchedCommands: runtime.searchedCommands,
      searchedPaths: runtime.searchedPaths,
      searchedPathCount: runtime.searchedPathCount,
      searchedPathOmitted: runtime.searchedPathOmitted,
      overrideConfigured: runtime.overrideConfigured,
      overridePath: runtime.overridePath,
      overrideFound: runtime.overrideFound,
      taskCounts: statusCounts,
      delegationPackets: tasks.length,
      requiredGrants: ["filesystem", "shell", "providers", "ui-embedding"],
      boundary: "OpenCode is an add-on agent. Filesystem, shell, provider secrets, wallet actions, and trusted memory writes remain mediated by ResonantOS.",
    };
  }

  const executeOpenCodeWebUrl = createOpenCodeWebUrlHandler({
    executionEnabled: async (payload = {}) => {
      const executionSettings = await readAddonExecutionSettings();
      return addonLocalCliExecutionEnabled("opencode", payload, executionSettings);
    },
    ensureServer: () => ensureOpenCodeServer({
      fetchImpl: (...args) => fetch(...args),
      spawnImpl: (cmd, args, opts) => spawnProcess(cmd, args, opts),
      command: opencodeCommand(),
      hostname: "127.0.0.1",
      port: Number(process.env.RESONANTOS_OPENCODE_PORT ?? 4231),
      env: process.env,
    }),
    appendAuditEntry: appendAddonGovernanceAuditEntry,
  });
  // CP-4 Phase 4 cutover: OpenCode lifecycle is owned by the adapter bridge.
  // The host service keeps the markdown packet writes + wire format; the
  // bridge owns credential gating, CLI invocation, env scoping, JSON-stream
  // parsing, and workspace-root enforcement. The shape returned by
  // `bridge.startTask(...)` is one of:
  //   { kind: "blocked", reason, fieldReason, install*?, model? }
  //   { kind: "failed",  reason }
  //   { kind: "completed", result, workspacePath }
  // Each branch is mapped to the same status writes the legacy inline
  // implementation produced, so the 1197 browser-first extension tests still
  // see byte-identical wire format.
  function resolveOpenCodeWorkspacePath(payload = {}) {
    const workspacePath = payload.workspacePath
      ? expandUserPath(payload.workspacePath)
      : repoRoot;
    const resolved = path.resolve(workspacePath);
    const allowedRoot = path.resolve(repoRoot);
    if (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error("OpenCode workspace path must stay inside the ResonantOS repository for browser-first V1.");
    }
    return resolved;
  }

  async function writeOpenCodeResultArtifact(taskPath, packet, result) {
    const id = fieldFromMarkdown(packet, "id") || path.basename(taskPath, ".md");
    const artifactDir = path.join(delegationArtifactRoot(), "opencode");
    await mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${id}-result.md`);
    const lines = [
      `# OpenCode Result: ${id}`,
      "",
      `- id: ${id}`,
      `- taskPath: ${path.relative(userRoot(), taskPath)}`,
      `- createdAt: ${new Date().toISOString()}`,
      `- adapter: ${result.adapter}`,
      "- status: completed",
      `- workspacePath: ${result.workspacePath || "."}`,
      result.model ? `- model: ${result.model}` : "",
      "- boundary: Reviewable coding artifact only. Shell, filesystem, provider secrets, trusted memory writes, and external sends remain governed by ResonantOS.",
      "",
      "## Final Summary",
      result.finalSummary,
      "",
      "## Actions Taken",
      ...(result.actionsTaken ?? []).map((item) => `- ${item}`),
      "",
      "## Changed Files",
      ...((result.changedFiles ?? []).length ? result.changedFiles : ["None reported."]).map((item) => `- ${item}`),
      "",
      "## Commands Run",
      ...((result.commandsRun ?? []).length ? result.commandsRun : ["None reported."]).map((item) => `- ${item}`),
      "",
      "## Residual Risks",
      ...(result.residualRisks ?? []).map((item) => `- ${item}`),
      "",
      "## Verification",
      ...(result.verification ?? []).map((item) => `- ${item}`),
      "",
    ];
    await writeFile(artifactPath, lines.join("\n"));
    return artifactPath;
  }

  async function executeOpenCodeDelegationStart(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "opencode");
    const packet = await readFile(taskPath, "utf8");
    const settings = await readAddonExecutionSettings();
    const adapter = String(payload.adapter ?? process.env.RESONANTOS_OPENCODE_ADAPTER ?? "auto").trim().toLowerCase();
    const runtime = currentOpenCodeRuntime();
    await writeDelegationStatus(taskPath, "running", {
      startedAt: new Date().toISOString(),
      adapter: adapter || "auto",
      workspacePath: path.relative(repoRoot, resolveOpenCodeWorkspacePath(payload)) || ".",
    });
    const bridge = createOpenCodeProviderAdapterBridge();
    const outcome = await bridge.startTask({
      payload,
      packet,
      command: runtime.command,
      runtime,
      secrets: await readProviderSecrets(),
      settings,
      localExecutionEnabled: addonLocalCliExecutionEnabled("opencode", payload, settings),
      disabledAddons: settings.disabledAddons ?? [],
      resolveWorkspacePath: resolveOpenCodeWorkspacePath,
      repoRoot,
      browserFirstRoot: browserFirstRoot(),
      spawnProcess,
      platform,
    });
    if (outcome.kind === "blocked") {
      const extra = {
        blockedAt: new Date().toISOString(),
        blockedReason: outcome.fieldReason ?? outcome.reason,
      };
      if (outcome.model) extra.model = outcome.model;
      const updated = await writeDelegationStatus(taskPath, "blocked", extra);
      const base = {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        blockedReason: outcome.reason,
        status: "blocked",
      };
      if (outcome.installHint !== undefined) {
        return {
          ...base,
          installHint: outcome.installHint,
          installCommand: outcome.installCommand,
          alternativeInstallCommands: outcome.alternativeInstallCommands,
          configureCommand: outcome.configureCommand,
          searchedCommands: outcome.searchedCommands,
          searchedPaths: outcome.searchedPaths,
          searchedPathCount: outcome.searchedPathCount,
          searchedPathOmitted: outcome.searchedPathOmitted,
          overrideConfigured: outcome.overrideConfigured,
          overridePath: outcome.overridePath,
          overrideFound: outcome.overrideFound,
        };
      }
      return base;
    }
    if (outcome.kind === "failed") {
      const updated = await writeDelegationStatus(taskPath, "failed", {
        failedAt: new Date().toISOString(),
        failureReason: outcome.reason.slice(0, 500),
      });
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        failureReason: outcome.reason,
        status: "failed",
      };
    }
    try {
      const artifactPath = await writeOpenCodeResultArtifact(taskPath, packet, outcome.result);
      let updated = await writeDelegationStatus(taskPath, "completed", {
        completedAt: new Date().toISOString(),
        resultArtifactPath: path.relative(userRoot(), artifactPath),
      });
      updated = `${updated.trimEnd()}\n\n## Result\n${outcome.result.finalSummary}\n\n## Result Artifact\n${path.relative(userRoot(), artifactPath)}\n`;
      await writeFile(taskPath, updated);
      return {
        ...delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath)),
        adapter: outcome.result.adapter,
        artifact: {
          path: path.relative(userRoot(), artifactPath),
          ...outcome.result,
        },
        status: "completed",
      };
    } catch (error) {
      return failDelegationAfterRunning(taskPath, error);
    }
  }


  async function executeOpenCodeDelegationStatus(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "opencode");
    const [details, content] = await Promise.all([stat(taskPath), readFile(taskPath, "utf8")]);
    return delegationSummaryFromMarkdown(taskPath, content, details);
  }

  async function executeOpenCodeDelegationArtifact(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "opencode");
    const content = await readFile(taskPath, "utf8");
    const artifactRelative = resultArtifactPathFromMarkdown(content);
    if (!artifactRelative) {
      throw new Error("OpenCode delegation has no result artifact yet.");
    }
    const artifactPath = path.resolve(userRoot(), artifactRelative);
    const artifactRoot = path.resolve(path.join(delegationArtifactRoot(), "opencode"));
    if (!artifactPath.startsWith(`${artifactRoot}${path.sep}`) || !artifactPath.endsWith(".md")) {
      throw new Error("OpenCode result artifact path is outside the approved artifact root.");
    }
    const artifact = await readFile(artifactPath, "utf8");
    return {
      changedFiles: sectionFromMarkdown(artifact, "Changed Files"),
      commandsRun: sectionFromMarkdown(artifact, "Commands Run"),
      content: artifact,
      finalSummary: sectionFromMarkdown(artifact, "Final Summary"),
      path: path.relative(userRoot(), artifactPath),
      residualRisks: sectionFromMarkdown(artifact, "Residual Risks"),
      verification: sectionFromMarkdown(artifact, "Verification"),
    };
  }

  async function executeOpenCodeDelegationCancel(payload = {}) {
    const taskPath = resolveDelegationPath(payload.path, "opencode");
    const content = await readFile(taskPath, "utf8");
    const currentStatus = fieldFromMarkdown(content, "status") || "queued";
    if (["completed", "cancelled"].includes(currentStatus)) {
      return delegationSummaryFromMarkdown(taskPath, content, await stat(taskPath));
    }
    const updated = await writeDelegationStatus(taskPath, "cancelled", {
      cancelledAt: new Date().toISOString(),
      cancelReason: String(payload.reason ?? "Human cancelled OpenCode delegation.").slice(0, 240),
    });
    return delegationSummaryFromMarkdown(taskPath, updated, await stat(taskPath));
  }

  async function executeAddonDraftRead(payload) {
    const filePath = resolveDraftPath(payload.path);
    const [details, content] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    return {
      ...draftSummaryFromMarkdown(filePath, content, details),
      content,
    };
  }

  async function executeAddonDraftTransition(payload) {
    const status = String(payload.status ?? "").trim().toLowerCase();
    if (!["approved-for-manual-send", "rejected", "draft-only"].includes(status)) {
      throw new Error("Draft status must be approved-for-manual-send, rejected, or draft-only.");
    }
    const filePath = resolveDraftPath(payload.path);
    const previous = await readFile(filePath, "utf8");
    const previousStatus = fieldFromMarkdown(previous, "status") || "draft-only";
    const reason = String(payload.reason ?? "Manual review from ResonantOS Add-ons workspace.").trim().slice(0, 240);
    const reviewer = String(payload.reviewer ?? "human").trim().slice(0, 80) || "human";
    const next = previous.replace(/^- status:\s*.+$/mi, `- status: ${status}`);
    const audit = [
      "",
      "## Audit",
      `- reviewedAt: ${new Date().toISOString()}`,
      `- reviewer: ${reviewer}`,
      `- previousStatus: ${previousStatus}`,
      `- newStatus: ${status}`,
      `- reason: ${reason}`,
      "- boundary: This review state does not send email or schedule calendar events.",
      "",
    ].join("\n");
    await writeFile(filePath, `${next.trimEnd()}\n${audit}`);
    const details = await stat(filePath);
    return draftSummaryFromMarkdown(filePath, await readFile(filePath, "utf8"), details);
  }

  async function executeAddonDraftProviderHandoff(payload) {
    const filePath = resolveDraftPath(payload.path);
    const provider = String(payload.provider ?? "").trim().toLowerCase();
    const content = await readFile(filePath, "utf8");
    const draft = parseDraftPacketMarkdown(content, {
      id: path.basename(filePath, ".md"),
      target: path.basename(path.dirname(filePath)),
    });
    if (draft.status !== "approved-for-manual-send") {
      throw new Error("Provider handoff requires a human-approved draft packet first.");
    }
    const handoff = buildProviderDraftHandoff(draft, provider);
    const reviewer = String(payload.reviewer ?? "human").trim().slice(0, 80) || "human";
    await writeFile(filePath, appendProviderHandoffAudit(content, handoff, reviewer));
    const details = await stat(filePath);
    return {
      ...draftSummaryFromMarkdown(filePath, await readFile(filePath, "utf8"), details),
      handoff,
    };
  }

  async function executeAddonsStatus() {
    const executionSettings = await readAddonExecutionSettings();
    const discovered = await discoverBundledAddonManifests(repoRoot);
    const fromManifests = discovered.map((entry) => {
      const { id, manifest, source } = entry;
      const snapshot = addonTrustAndIsolationSnapshot(manifest);
      const requestedCapabilities = Array.isArray(manifest.requestedCapabilities)
        ? manifest.requestedCapabilities.map((e) => e?.capability).filter(Boolean)
        : [];
      return {
        id,
        name: typeof manifest.name === "string" ? manifest.name : id,
        available: true,
        mode: modeForManifest(manifest),
        trust: trustLabelFor(manifest),
        trustTier: snapshot.trustTier,
        trustNotice: snapshot.trustNotice,
        untrusted: snapshot.untrusted,
        requestedCapabilities,
        grantedCapabilities: requestedCapabilities,
        runtime: manifest.runtimeType ?? null,
        category: manifest.category ?? null,
        source,
        description: typeof manifest.description === "string" ? manifest.description : "",
        tools: Array.isArray(manifest.tools) ? manifest.tools.map((t) => t?.name).filter(Boolean) : [],
      };
    });
    const uninstalled = new Set(executionSettings.uninstalledAddons ?? []);
    const disabled = new Set(executionSettings.disabledAddons ?? []);
    return {
      addons: [
        {
          id: "addon.hermes",
          name: "Hermes",
          available: true,
          mode: "delegation-addon",
          trust: "add-on agent",
          requestedCapabilities: ["agent-delegation", "network", "notifications"],
          description: "Communication and coordination agent add-on for delegated messaging, follow-up, and channel workflows.",
          grantedCapabilities: ["agent-delegation"],
          execution: {
            localCliExecution: Boolean(executionSettings.hermes.localCliExecution),
            runtimeAvailable: Boolean(hermesCommand()),
            mode: hermesCommand() ? "local-cli-detected" : "packet-only",
          },
          boundary: "Bundled browser-first add-on contract. Real Hermes execution still requires a detected local Hermes CLI and explicit execution enablement.",
        },
        {
          id: "addon.opencode",
          name: "OpenCode",
          available: existsSync(path.join(repoRoot, "src", "modules", "opencode")),
          mode: "coding-addon",
          trust: "add-on agent",
          description: "Coding agent add-on that receives bounded delegation packets, runs governed OpenCode sessions, and returns artifacts through ResonantOS.",
          requestedCapabilities: ["agent-delegation", "filesystem-scoped", "shell", "providers"],
          grantedCapabilities: ["agent-delegation"],
          deniedCapabilities: executionSettings.opencode.localCliExecution ? [] : ["shell"],
          execution: {
            localCliExecution: Boolean(executionSettings.opencode.localCliExecution),
            mode: opencodeCommand() ? "local-cli-detected" : "packet-only",
          },
        },
        ...fromManifests.filter((entry) => entry.id !== "addon.hermes" && entry.id !== "addon.opencode"),
      ]
        .filter((addon) => !uninstalled.has(addon.id))
        .map((addon) => ({ ...addon, disabled: disabled.has(addon.id) })),
    };
  }

  async function executeAddonSurfaceRoutes() {
    const discovered = await discoverBundledAddonManifests(repoRoot);
    const manifests = discovered.map((entry) => entry.manifest);
    const installations = {};
    for (const { id, manifest } of discovered) {
      const requestedCapabilities = Array.isArray(manifest.requestedCapabilities)
        ? manifest.requestedCapabilities.map((entry) => ({
            capability: entry?.capability,
            granted: true,
            scope: entry?.scope ?? "shared",
            revocationBehavior: entry?.revocationBehavior ?? "hard-stop",
          }))
        : [];
      installations[id] = {
        installed: true,
        enabled: true,
        status: "enabled",
        grantedCapabilities: requestedCapabilities,
      };
    }
    return { menus: createShellRailMenus(manifests, installations) };
  }

  async function executeAddonExecutionSettingsGet() {
    const settings = await readAddonExecutionSettings();
    return {
      settings,
      boundary: "Local CLI execution is disabled by default. Enabling it lets a configured add-on runtime execute through host-mediated adapters while preserving scoped task packets and artifact review.",
    };
  }

  async function executeAddonExecutionSettingsUpdate(payload = {}) {
    const current = await readAddonExecutionSettings();
    const addon = String(payload.addon ?? "").trim().toLowerCase();
    if (!addon) {
      throw new Error("Addon id is required.");
    }
    if (typeof payload.disabled === "boolean") {
      const set = new Set(current.disabledAddons ?? []);
      if (payload.disabled) set.add(addon);
      else set.delete(addon);
      const settings = await writeAddonExecutionSettings({ ...current, disabledAddons: [...set] });
      await appendAddonGovernanceAuditEntry({
        at: new Date().toISOString(),
        addonId: addon,
        field: "disabled",
        from: !payload.disabled,
        to: payload.disabled,
      });
      return { addon, disabled: settings.disabledAddons.includes(addon) };
    }
    if (!["hermes", "opencode"].includes(addon)) {
      throw new Error("Execution settings can only be updated for Hermes or OpenCode.");
    }
    const next = normalizeAddonExecutionSettings(current);
    const previousLocalCliExecution = Boolean(next[addon].localCliExecution);
    const nextLocalCliExecution = Boolean(payload.localCliExecution);
    next[addon] = {
      ...next[addon],
      localCliExecution: nextLocalCliExecution,
    };
    const settings = await writeAddonExecutionSettings(next);
    if (previousLocalCliExecution !== nextLocalCliExecution) {
      await appendAddonGovernanceAuditEntry({
        at: new Date().toISOString(),
        addonId: addon,
        field: "localCliExecution",
        from: previousLocalCliExecution,
        to: nextLocalCliExecution,
      });
    }
    return {
      addon,
      settings,
      status: settings[addon].localCliExecution ? "enabled" : "disabled",
    };
  }

  async function isAddonDisabled(addonId) {
    if (!addonId) return false;
    const settings = await readAddonExecutionSettings();
    return (settings.disabledAddons ?? []).includes(addonId);
  }

  async function executeAddonUninstall(payload = {}) {
    const addonId = String(payload.addonId ?? "").trim();
    if (!addonId) throw new Error("Addon id is required.");
    const discovered = await discoverBundledAddonManifests(repoRoot);
    const entry = discovered.find((candidate) => candidate.id === addonId);
    if (!entry) throw new Error("Addon not found in the local registry.");
    const snapshot = addonTrustAndIsolationSnapshot(entry.manifest);
    if (!snapshot.untrusted) {
      throw new Error("Bundled and approved add-ons cannot be uninstalled. Only personal-tier (sideloaded) add-ons can be removed.");
    }
    const settings = await readAddonExecutionSettings();
    const set = new Set(settings.uninstalledAddons ?? []);
    set.add(addonId);
    await writeAddonExecutionSettings({ ...settings, uninstalledAddons: [...set] });
    await appendAddonGovernanceAuditEntry({
      at: new Date().toISOString(),
      addonId,
      field: "uninstalled",
      from: false,
      to: true,
    });
    return { addonId, uninstalled: true };
  }

  async function executeHermesDashboardStatus(payload = {}) {
    const target = dashboardTarget(payload.host, payload.port);
    const command = hermesCommand(payload.profileHome);
    const running = await socketOpen(target.host, target.port);
    const secrets = await readProviderSecrets();
    const provider = hermesProvider(payload, secrets);
    const model = hermesModel(payload, provider);
    return {
      running,
      url: clientReachableUrl(target.url),
      // Same-origin URL the extension hits to fetch the dashboard HTML,
      // which it then inlines into a sandboxed <iframe srcdoc> on its own
      // secure extension page. This avoids Chrome's mixed-content rule
      // (which would block any http:// iframe src inside a
      // chrome-extension:// page). Works for any addon, no TLS, no certs.
      dashboardProxyUrl: clientReachableProxyUrl(),
      host: target.host,
      port: target.port,
      clientHost: clientReachableHost(),
      command,
      provider,
      model,
      providerEnvKeys: providerEnvKeysPresent(provider, secrets, providerEnvKeysForProvider(provider)),
      profileHome: hermesHome(payload.profileHome),
      detail: running
        ? `Hermes dashboard is reachable at ${clientReachableUrl(target.url)}.`
        : `Hermes dashboard is not reachable at ${clientReachableUrl(target.url)}.`,
      rawStatus: command ? "Hermes CLI found." : "Hermes CLI was not found.",
    };
  }

  async function executeHermesDashboardStart(payload = {}) {
    const target = dashboardTarget(payload.host, payload.port);
    const profileHome = hermesHome(payload.profileHome);
    const command = hermesCommand(profileHome);
    const secrets = await readProviderSecrets();
    const provider = hermesProvider(payload, secrets);
    const model = hermesModel(payload, provider);
    if (!command) {
      throw new Error("Hermes CLI was not found. Install or configure Hermes before launching the dashboard.");
    }
    const alreadyRunning = await socketOpen(target.host, target.port);
    if (!alreadyRunning) {
      // Bind Hermes to the bridge's public interface so remote clients
      // (Mac/Windows extension over LAN or Tailscale) can reach the
      // dashboard. Falls back to loopback if the bridge is loopback-only.
      const bindHost = clientReachableHost();
      const args = ["dashboard", "--host", bindHost, "--port", String(target.port), "--no-open"];
      if (payload.includeTui !== false) {
        args.push("--tui");
      }
      const child = spawnProcess(command, args, {
        detached: true,
        env: scopedHermesEnv({ provider, model, profileHome, secrets }),
        shell: false,
        stdio: "ignore",
      });
      child.unref();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (await socketOpen(target.host, target.port)) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return executeHermesDashboardStatus({ ...payload, host: target.host, port: target.port, profileHome });
  }

  async function executeHermesDashboardStop(payload = {}) {
    const profileHome = hermesHome(payload.profileHome);
    const command = hermesCommand(profileHome);
    const secrets = await readProviderSecrets();
    const provider = hermesProvider(payload, secrets);
    const model = hermesModel(payload, provider);
    if (!command) {
      throw new Error("Hermes CLI was not found. Install or configure Hermes before stopping the dashboard.");
    }
    await new Promise((resolve) => {
      const child = spawnProcess(command, ["dashboard", "--stop"], {
        env: scopedHermesEnv({ provider, model, profileHome, secrets }),
        shell: false,
        stdio: "ignore",
      });
      child.once("exit", resolve);
      child.once("error", resolve);
    });
    return executeHermesDashboardStatus({ ...payload, profileHome });
  }

  return {
    executeGoalRecord,
    executeDelegationRecord,
    executeAddonDraftRecord,
    executeAddonDraftList,
    executeDelegationList,
    executeHermesStatus,
    executeHermesDelegationStart,
    executeHermesDelegationStatus,
    executeHermesDelegationArtifact,
    executeHermesDelegationCancel,
    executeOpenCodeStatus,
    executeOpenCodeDelegationStart,
    executeOpenCodeDelegationStatus,
    executeOpenCodeDelegationArtifact,
    executeOpenCodeDelegationCancel,
    executeOpenCodeWebUrl,
    executeAddonDraftRead,
    executeAddonDraftTransition,
    executeAddonDraftProviderHandoff,
    executeAddonsStatus,
    executeAddonSurfaceRoutes,
    executeAddonExecutionSettingsGet,
    executeAddonExecutionSettingsUpdate,
    executeAddonUninstall,
    isAddonDisabled,
    executeHermesDashboardStatus,
    executeHermesDashboardStart,
    executeHermesDashboardStop,
  };
}
