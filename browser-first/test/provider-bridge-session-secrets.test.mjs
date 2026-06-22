import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProviderBridgeService } from "../host/provider-bridge-service.mjs";

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

test("provider credentials saved through the alpha host are session-only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resonantos-provider-session-"));
  const secretPath = path.join(root, "Secrets", "provider-secrets.json");
  const service = createService(root);
  try {
    const saved = await service.executeProviderCredentialSave({
      providerId: "shared-minimax",
      credential: "minimax-test-credential",
    });

    assert.equal(saved.configured, true);
    assert.equal(saved.persistence, "session-only");
    assert.equal(existsSync(secretPath), false);
    assert.equal((await service.readProviderSecrets())["shared-minimax"], "minimax-test-credential");

    const status = await service.executeProviderStatus();
    const minimax = status.providers.find((provider) => provider.id === "shared-minimax");
    assert.equal(status.vault.persistence, "session-only");
    assert.equal(status.vault.legacyPlaintextDetected, false);
    assert.equal(minimax.configured, true);
    assert.equal(minimax.credentialPreview, "session");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy plaintext provider secret files are detected but ignored", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resonantos-provider-legacy-"));
  const secretPath = path.join(root, "Secrets", "provider-secrets.json");
  const service = createService(root);
  try {
    await mkdir(path.dirname(secretPath), { recursive: true });
    await writeFile(secretPath, JSON.stringify({ "shared-minimax": "legacy-plaintext-secret" }));

    const secrets = await service.readProviderSecrets();
    const status = await service.executeProviderStatus();
    const minimax = status.providers.find((provider) => provider.id === "shared-minimax");

    assert.equal(secrets["shared-minimax"], undefined);
    assert.equal(status.vault.legacyPlaintextDetected, true);
    assert.equal(minimax.configured, false);
    assert.equal(minimax.credentialPreview, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("provider account save enforces credential-safe endpoint policy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "resonantos-provider-endpoint-policy-"));
  const service = createService(root);
  try {
    await assert.rejects(
      () => service.executeProviderAccountSave({
        label: "Metadata Target",
        providerType: "openai-compatible",
        templateId: "openai-compatible",
        apiBaseUrl: "http://169.254.169.254/latest",
        models: ["custom-model"],
        credential: "custom-test-credential",
      }),
      /HTTPS|local, private, or metadata-network/,
    );

    await assert.rejects(
      () => service.executeProviderAccountSave({
        label: "Plain HTTP Public",
        providerType: "openai-compatible",
        templateId: "openai-compatible",
        apiBaseUrl: "http://api.example.com/v1",
        models: ["custom-model"],
        credential: "custom-test-credential",
      }),
      /must use HTTPS/,
    );

    await assert.rejects(
      () => service.executeProviderAccountSave({
        label: "Embedded Credentials",
        providerType: "openai-compatible",
        templateId: "openai-compatible",
        apiBaseUrl: "https://user:pass@api.example.com/v1",
        models: ["custom-model"],
        credential: "custom-test-credential",
      }),
      /embedded credentials/,
    );

    await assert.rejects(
      () => service.executeProviderAccountSave({
        label: "OpenAI Override",
        providerType: "openai",
        templateId: "openai",
        apiBaseUrl: "https://api.attacker.example/v1",
        models: ["gpt-5.5"],
        credential: "openai-test-credential",
      }),
      /built-in provider endpoint/,
    );

    const publicCustom = await service.executeProviderAccountSave({
      label: "Public Custom",
      providerType: "openai-compatible",
      templateId: "openai-compatible",
      apiBaseUrl: "https://api.example.com/v1/",
      models: ["custom-model"],
      credential: "custom-test-credential",
    });
    assert.equal(publicCustom.provider.apiBaseUrl, "https://api.example.com/v1");

    const localRuntime = await service.executeProviderAccountSave({
      label: "Local Runtime",
      providerType: "local",
      templateId: "ollama",
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      models: ["local-model"],
    });
    assert.equal(localRuntime.provider.apiBaseUrl, "http://127.0.0.1:11434/v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
