#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_PROVIDER_ID = "local-llamacpp-primary";
const DEFAULT_NODE_ID = "node-local-llamacpp-primary";

function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function tauriAppStateRoot() {
  if (process.env.RESONANTOS_APP_STATE_ROOT) {
    return path.resolve(process.env.RESONANTOS_APP_STATE_ROOT);
  }
  if (process.platform === "darwin") {
    return path.join(homeDir(), "Library", "Application Support", "com.resonantos.vnext");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir(), "AppData", "Roaming"), "com.resonantos.vnext");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homeDir(), ".config"), "com.resonantos.vnext");
}

function runtimeStatePath() {
  return path.join(tauriAppStateRoot(), "runtime-state.json");
}

function assertPrivateHttpEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PRIMARY_LOCAL_ENDPOINT must be http or https.");
  }
  const host = parsed.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (!privateHost) {
    throw new Error(`Refusing non-private local provider endpoint: ${endpoint}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

async function discoverModel(endpoint, requestedModel) {
  const response = await fetch(`${endpoint}/models`);
  if (!response.ok) {
    throw new Error(`Model discovery failed with HTTP ${response.status} at ${endpoint}/models`);
  }
  const payload = await response.json();
  const models = [
    ...(Array.isArray(payload.data) ? payload.data.map((item) => item.id || item.model || item.name) : []),
    ...(Array.isArray(payload.models) ? payload.models.map((item) => item.id || item.model || item.name) : []),
  ].filter(Boolean);
  const uniqueModels = [...new Set(models.map(String))];
  if (!uniqueModels.length) {
    throw new Error(`No model ids found in ${endpoint}/models response.`);
  }
  return {
    models: uniqueModels,
    selectedModel: uniqueModels.includes(requestedModel) ? requestedModel : uniqueModels[0],
  };
}

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }
  const raw = await readFile(filePath, "utf8");
  return raw.trim() ? JSON.parse(raw) : fallback;
}

function upsertById(items = [], item) {
  const next = items.filter((current) => current?.id !== item.id);
  next.push(item);
  return next;
}

function localProvider({ providerId, endpoint, model }) {
  return {
    id: providerId,
    label: "Local llama.cpp Test",
    providerType: "openai-compatible",
    authSource: "manual",
    authMethod: "local-runtime",
    authTier: "supported",
    apiBaseUrl: endpoint,
    allowedModels: [model],
    primaryModel: model,
    fallbackModel: undefined,
    modelContext: [
      {
        model,
        maxContextTokens: 8192,
        tokenEstimateMethod: "provider-metadata",
        source: "runtime-node",
      },
    ],
    consumerScopes: ["strategist", "setup", "archive-ingest", "recovery"],
    shared: true,
    status: "ready",
    credentialStatus: "configured",
  };
}

function localRuntimeNode({ providerId, nodeId, endpoint, model }) {
  return {
    id: nodeId,
    label: "Local llama.cpp Test Runtime",
    providerProfileId: providerId,
    kind: "remote-user-owned",
    locality: "lan-remote",
    endpoint,
    supportedModels: [model],
    authTier: "supported",
    healthState: "ready",
    deployableOnDemand: false,
    notes: ["Configured from local host-owned test provider setup. No cloud API key required."],
  };
}

function configureState(state, { providerId, nodeId, endpoint, model }) {
  const provider = localProvider({ providerId, endpoint, model });
  const node = localRuntimeNode({ providerId, nodeId, endpoint, model });
  const route = {
    providerProfileId: providerId,
    runtimeNodeId: nodeId,
    model,
    costPosture: "free-local",
    note: "Default local llama.cpp test route.",
  };
  const chain = {
    id: "chain-local-llamacpp-test",
    label: "Local llama.cpp Test Chain",
    rule: "Use the configured local OpenAI-compatible llama.cpp endpoint before any cloud route.",
    orderedRoutes: [route],
    lastResortRoute: undefined,
  };

  const workloadStrategies = upsertById(state.modelStrategy?.workloadStrategies, {
    id: "strategy-augmentor-primary",
    label: "Augmentor Primary Chat",
    workloadClass: "primary-chat",
    ownerType: "agent",
    ownerId: "strategist.core",
    primaryRoute: route,
    fallbackChainId: chain.id,
    hardStopWhenNoFallback: false,
    notes: ["Configured for local test chat through an OpenAI-compatible llama.cpp endpoint."],
  });

  return {
    ...state,
    providers: upsertById(state.providers, provider),
    runtimeNodes: upsertById(state.runtimeNodes, node),
    agents: upsertById(state.agents, {
      id: "strategist.core",
      providerProfileId: providerId,
      fallbackProviderProfileId: undefined,
    }),
    modelStrategy: {
      ...(state.modelStrategy ?? {}),
      fallbackChains: upsertById(state.modelStrategy?.fallbackChains, chain),
      workloadStrategies,
    },
    uiPreferences: {
      ...(state.uiPreferences ?? {}),
      activeSection: "strategist",
      activeChatThreadId: state.uiPreferences?.activeChatThreadId ?? "thread-main-desktop",
      workspaceLayout: "main-chat",
      chatSidebarOpen: true,
    },
  };
}

async function main() {
  const endpoint = assertPrivateHttpEndpoint(
    process.env.PRIMARY_LOCAL_ENDPOINT || process.env.RESONANTOS_LOCAL_PROVIDER_ENDPOINT || "",
  );
  const requestedModel = process.env.PRIMARY_MODEL_NAME || process.env.RESONANTOS_LOCAL_PROVIDER_MODEL || "";
  if (!requestedModel) {
    throw new Error("Set PRIMARY_MODEL_NAME to the expected local model id.");
  }
  const { models, selectedModel } = await discoverModel(endpoint, requestedModel);
  const providerId = process.env.RESONANTOS_LOCAL_PROVIDER_ID || DEFAULT_PROVIDER_ID;
  const nodeId = process.env.RESONANTOS_LOCAL_PROVIDER_NODE_ID || DEFAULT_NODE_ID;
  const filePath = runtimeStatePath();
  const current = await readJson(filePath, {});
  const next = configureState(current, {
    providerId,
    nodeId,
    endpoint,
    model: selectedModel,
  });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runtimeStatePath: filePath,
        providerId,
        runtimeNodeId: nodeId,
        endpoint,
        requestedModel,
        selectedModel,
        discoveredModels: models,
        modelChanged: requestedModel !== selectedModel,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
