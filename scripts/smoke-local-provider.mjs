#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

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

async function readRuntimeState() {
  const filePath = path.join(tauriAppStateRoot(), "runtime-state.json");
  if (!existsSync(filePath)) {
    throw new Error(`Runtime state does not exist: ${filePath}`);
  }
  return { filePath, state: JSON.parse(await readFile(filePath, "utf8")) };
}

function primaryChatRoute(state) {
  const strategy = state.modelStrategy?.workloadStrategies?.find((item) => item.id === "strategy-augmentor-primary");
  const route = strategy?.primaryRoute;
  if (!route) {
    throw new Error("No strategy-augmentor-primary route is configured.");
  }
  const provider = state.providers?.find((item) => item.id === route.providerProfileId);
  const runtimeNode = state.runtimeNodes?.find((item) => item.id === route.runtimeNodeId);
  if (!provider || !runtimeNode) {
    throw new Error("Configured primary chat route is missing its provider or runtime node.");
  }
  if (provider.providerType !== "openai-compatible" || provider.authMethod !== "local-runtime") {
    throw new Error(`Refusing to smoke-test non-local provider route: ${provider.id}`);
  }
  return {
    provider,
    runtimeNode,
    model: route.model || provider.primaryModel,
    endpoint: runtimeNode.endpoint || provider.apiBaseUrl,
  };
}

async function main() {
  const { filePath, state } = await readRuntimeState();
  const route = primaryChatRoute(state);
  const response = await fetch(`${String(route.endpoint).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer not-needed",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        { role: "system", content: "You are a concise ResonantOS local provider smoke-test assistant." },
        { role: "user", content: "hello" },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Provider smoke failed with HTTP ${response.status}.`);
  }
  const reply = payload?.choices?.[0]?.message?.content;
  if (!String(reply ?? "").trim()) {
    throw new Error("Provider smoke did not return assistant content.");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        runtimeStatePath: filePath,
        providerId: route.provider.id,
        runtimeNodeId: route.runtimeNode.id,
        endpoint: route.endpoint,
        model: route.model,
        prompt: "hello",
        reply: String(reply).trim(),
        usage: payload.usage ?? null,
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
