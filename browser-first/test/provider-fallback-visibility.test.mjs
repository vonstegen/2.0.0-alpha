// #231 — Provider Fabric must not silently swap an explicit model, and must make
// a fallback visible and actionable. These tests drive executeBridgeChat with a
// per-endpoint fetch stub (no live secrets) to cover manual preservation and the
// visible-fallback path.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProviderBridgeService } from "../host/provider-bridge-service.mjs";

const PROVIDER_ENV = [
  "MINIMAX_API_KEY", "OPENAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY",
  "RESONANTOS_PROVIDER_SECRETS_JSON", "RESONANTOS_LOCAL_RUNTIME_URL",
];

function createService(root) {
  return createProviderBridgeService({
    providerSecretsPath: () => path.join(root, "Secrets", "provider-secrets.json"),
    providerAccountsPath: () => path.join(root, "ProviderFabric", "provider-accounts.json"),
    providerRoutingPath: () => path.join(root, "ProviderFabric", "routing-strategies.json"),
    providerModelPreferencesPath: () => path.join(root, "ProviderFabric", "model-preferences.json"),
    providerDiagnosticsHistoryPath: () => path.join(root, "ProviderFabric", "diagnostics-history.json"),
    redactDiagnosticText: (value) => String(value ?? ""),
    unique: (values) => [...new Set(values.filter(Boolean))],
    extractJsonObject: (value) => JSON.parse(String(value ?? "{}")),
  });
}

function reply(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: null }) };
}

async function withService(run) {
  const previous = Object.fromEntries(PROVIDER_ENV.map((name) => [name, process.env[name]]));
  for (const name of PROVIDER_ENV) delete process.env[name];
  const originalFetch = globalThis.fetch;
  const root = await mkdtemp(path.join(os.tmpdir(), "resonant-231-"));
  try {
    await run(createService(root), (stub) => { globalThis.fetch = stub; });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

test("#231 an explicitly selected, available model is preserved (no silent swap)", async () => {
  await withService(async (svc, setFetch) => {
    await svc.executeProviderCredentialSave({ providerId: "shared-openai", credential: "openai-test-credential" });
    setFetch(async () => reply("hi from gpt"));
    const out = await svc.executeBridgeChat({ workload: "augmentor-chat", model: "gpt-5.5", messages: [{ role: "user", content: "hi" }] });
    assert.equal(out.model, "gpt-5.5", "the explicitly requested model must be the one used");
    assert.equal(out.requestedModel, "gpt-5.5");
    assert.equal(out.routeSource, "manual");
    assert.equal(out.routeFallback, false);
  });
});

test("#231 an explicitly selected unavailable model reports actionable guidance (not a silent swap)", async () => {
  await withService(async (svc) => {
    await svc.executeProviderCredentialSave({ providerId: "shared-openai", credential: "openai-test-credential" });
    await assert.rejects(
      () => svc.executeBridgeChat({ workload: "augmentor-chat", model: "no-such-model-xyz", messages: [{ role: "user", content: "hi" }] }),
      /selected model "no-such-model-xyz" is currently unavailable[\s\S]*Settings > Providers/,
    );
  });
});

test("#231 a strategy fallback is visible: response reports routeFallback + an actionable notice", async () => {
  await withService(async (svc, setFetch) => {
    // Configure both the primary (MiniMax) and a fallback (OpenAI), and pin them.
    await svc.executeProviderCredentialSave({ providerId: "shared-minimax", credential: "minimax-test-credential" });
    await svc.executeProviderCredentialSave({ providerId: "shared-openai", credential: "openai-test-credential" });
    await svc.executeProviderRoutingStrategySave({
      strategyId: "augmentor-chat", primaryModel: "MiniMax-M3", fallbackModels: ["gpt-5.5"], costPosture: "quality-first", hardStop: false,
    });
    // Primary endpoint fails; fallback endpoint answers.
    setFetch(async (url) => {
      if (String(url).includes("minimax")) return { ok: false, status: 500, json: async () => ({ error: { message: "primary down" } }) };
      return reply("answered by fallback");
    });
    const out = await svc.executeBridgeChat({ workload: "augmentor-chat", model: "__auto__", messages: [{ role: "user", content: "hi" }] });
    assert.equal(out.reply, "answered by fallback");
    assert.equal(out.model, "gpt-5.5", "the fallback model answered");
    assert.equal(out.routeFallback, true, "a fallback occurred and must be reported");
    assert.match(out.routeNotice, /Preferred route unavailable[\s\S]*Settings > (Providers|Routing)/);
  });
});

test("#231 no fallback flag when the primary route answers", async () => {
  await withService(async (svc, setFetch) => {
    await svc.executeProviderCredentialSave({ providerId: "shared-minimax", credential: "minimax-test-credential" });
    await svc.executeProviderRoutingStrategySave({
      strategyId: "augmentor-chat", primaryModel: "MiniMax-M3", fallbackModels: [], costPosture: "quality-first", hardStop: false,
    });
    setFetch(async () => reply("answered by primary"));
    const out = await svc.executeBridgeChat({ workload: "augmentor-chat", model: "__auto__", messages: [{ role: "user", content: "hi" }] });
    assert.equal(out.routeFallback, false);
    assert.equal(out.routeNotice, "");
  });
});
