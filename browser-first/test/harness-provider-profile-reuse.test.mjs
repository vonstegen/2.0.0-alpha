// Central provider-profile reuse: one Settings-configured provider credential
// serves Augmentor (provider-fabric-v1, runtime-adapter) and Pi (pi-native-v1,
// session-environment) through a single host-owned resolver, without a second
// credential entry. The pi-native tests run the REAL reviewed chain with a fake
// launcher (canary secrets only). Revocation and isolation fail closed.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createProviderBridgeService } from "../host/provider-bridge-service.mjs";
import { createHarnessHostService } from "../host/harness-host-service.mjs";
import { createPiNativeSessionService } from "../host/pi-native-session-service.mjs";
import { createHarnessResourceProjection } from "../host/harness-resource-projection.mjs";
import { evaluateBridgeRequestForSelfTest } from "../host/bridge-server.mjs";

const CREDENTIAL = "reuse-canary-credential-0123456789";
const ENDPOINT = "http://127.0.0.1:8377";
const MODEL = "shared-loopback-model";

const PROVIDER_ENV = [
  "MINIMAX_API_KEY", "OPENAI_API_KEY", "ZAI_API_KEY", "GLM_API_KEY", "ZHIPUAI_API_KEY",
  "RESONANTOS_PROVIDER_SECRETS_JSON", "RESONANTOS_LOCAL_RUNTIME_URL", "RESONANTOS_PROVIDER_ALLOW_LOCAL_ENDPOINTS",
  "RESONANTOS_HARNESS_BINDINGS",
];

function createProviderService(root) {
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

function sseFrame(text) {
  return Buffer.from(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\r\n\r\n` +
    `data: [DONE]\r\n\r\n`,
  );
}

function sseResponse(bytes) {
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(bytes); controller.close(); },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

function jsonReply(content) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: null }) };
}

const manifestById = async (rel) => JSON.parse(await readFile(new URL(rel, import.meta.url), "utf8"));

async function withFixture(run) {
  const previous = Object.fromEntries(PROVIDER_ENV.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const root = await mkdtemp(path.join(os.tmpdir(), "resonant-profile-reuse-"));
  for (const name of PROVIDER_ENV) delete process.env[name];
  // A credential-bearing loopback endpoint needs this explicit opt-in for the
  // provider-fabric SSRF guard. No listener is opened: fetch is stubbed.
  process.env.RESONANTOS_PROVIDER_ALLOW_LOCAL_ENDPOINTS = "1";
  try {
    const provider = createProviderService(root);
    const captured = [];
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      captured.push({ url: target, headers: init?.headers, body: init?.body ? JSON.parse(init.body) : undefined });
      return target.endsWith("/v1/chat/completions") ? sseResponse(sseFrame("pi reply")) : jsonReply("augmentor reply");
    };
    await run(provider, captured, root);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }


}

// Real pi-native host wiring shared by the reuse tests: reviewed session
// service (planner + fake launcher), host-issued projection, and the CLEAN
// authorize gate over registry.snapshot(). Canary secrets only.
async function piNativeHostFixture(provider, profileId) {
  const projRoot = await mkdtemp(path.join(os.tmpdir(), "ros-pi-native-root-"));
  const piAuthorizedProject = { id: "project-a", label: "Project A", root: projRoot };
  const piResourceProjection = createHarnessResourceProjection({ authorizedProject: piAuthorizedProject });
  const binding = {
    name: "pi.native", addonId: "addon.pi-harness",
    adapterId: "pi-native-v1", authScheme: "session-environment",
    source: { providerProfileId: profileId },
  };
  const resolveProviderProfileCredential = async (id) => {
    const profiles = await provider.allProviderProfiles();
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile?.apiBaseUrl) throw new Error("unknown profile");
    const secrets = await provider.readProviderSecrets();
    const actionToken = secrets[id];
    if (!actionToken) throw new Error("credential not configured");
    return { endpoint: profile.apiBaseUrl, actionToken };
  };
  let host;
  const piDenied = () => Object.assign(new Error("permission-denied"), { code: "permission-denied" });
  const piNativeAuthorize = ({ addonId, providerProfileId }) => {
    const projection = host.registry.snapshot();
    const installation = projection.installations[addonId];
    if (!installation?.installed || !installation.enabled) throw piDenied();
    const agentGranted = (installation.grantedCapabilities ?? []).some(
      (grant) => grant.capability === "agent-runtime" && grant.granted === true,
    );
    if (!agentGranted) throw piDenied();
    const approved = [binding].find((candidate) =>
      candidate.addonId === addonId && candidate.adapterId === "pi-native-v1" &&
      typeof installation.agentRuntime?.credentialBinding === "string" &&
      candidate.name === installation.agentRuntime.credentialBinding &&
      candidate.authScheme === "session-environment" &&
      candidate.source && candidate.source.providerProfileId === providerProfileId);
    if (!approved) throw piDenied();
  };
  const piGrantedCapabilities = (addonId) =>
    host.registry.snapshot().installations[addonId]?.grantedCapabilities ?? [];
  const launchPlans = [];
  const piNativeSessionService = createPiNativeSessionService({
    providerHost: provider,
    resolveProviderProfileCredential,
    authorize: piNativeAuthorize,
    consumeProjection: (projection, { addonId, sessionId }) =>
      piResourceProjection.consume(projection, {
        addonId, sessionId,
        authorizedProject: piAuthorizedProject,
        grantedCapabilities: piGrantedCapabilities(addonId),
      }),
    resolveExecutable: async () => ({
      command: "/usr/local/bin/pi",
      canonicalPath: "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
      source: "fixed-system-root", validated_by: "piRuntimeAllowlist",
    }),
    envAllowlist: ["PATH", "HOME"],
    launcher: {
      async launch(plan) {
        launchPlans.push(plan);
        return { exitCode: 0, signal: null, timedOut: false, aborted: false,
          spawnError: null, durationMs: 3, stdout: "pi reply", stderr: "" };
      },
    },
  });
  const issuePiProjection = async ({ addonId, sessionId, manifest }) => {
    const result = await piResourceProjection.project({
      addonId, sessionId,
      request: manifest.harnessResources ?? { requests: { project: ["read"] } },
      grantedCapabilities: piGrantedCapabilities(addonId),
    });
    if (result.ok !== true) throw piDenied();
    return result;
  };
  const piNativeHost = { sessionService: piNativeSessionService, issueProjection: issuePiProjection };
  let stored = null;
  host = await createHarnessHostService({
    env: {},
    store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
    providerHost: provider, resolveProviderProfileCredential, bindings: [binding],
    piNative: piNativeHost,
  });
  const tokens = { "addon-runtime-read": "read-token", "addon-runtime-control": "control-token" };
  const call = (url, body = {}) => {
    const method = url.startsWith("/addons/registry") || url.startsWith("/agent/events") ? "GET" : "POST";
    const route = host.harnessRoutes.find((r) => r.path === url.split("?")[0]);
    return evaluateBridgeRequestForSelfTest({
      method, url, body, routes: host.harnessRoutes, bridgeToken: "bridge-token",
      bridgeCapabilityTokens: tokens, listenerPort: 47773,
      headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token",
        "x-resonantos-bridge-capability-token": tokens[route.requiredCapability] },
      rawHeaders: ["Host", "127.0.0.1:47773"],
    });
  };
  return { host, call, launchPlans, binding };
}

test("one provider profile credential serves Augmentor and Pi; revocation isolates Pi", async () => {
  await withFixture(async (provider, captured) => {
    // 1. Configure the provider profile + credential exactly once (Settings →
    //    Providers path: account metadata + session-only credential).
    const account = await provider.executeProviderAccountSave({
      mode: "create", templateId: "openrouter", label: "Shared Loopback",
      providerType: "openai-compatible", apiBaseUrl: ENDPOINT, models: [MODEL], credential: "",
    });
    const profileId = account.provider.id;
    await provider.executeProviderCredentialSave({ providerId: profileId, credential: CREDENTIAL });
    const status = await provider.executeProviderStatus();
    const sharedProfile = status.providers.find((p) => p.id === profileId);
    assert.equal(sharedProfile.configured, true, "provider profile configured exactly once");
    assert.ok(!JSON.stringify(status).includes(CREDENTIAL), "provider status never exposes the credential");

    // 2. Real pi-native wiring: the reviewed session chain with a fake launcher.
    const { host, call, launchPlans, binding } = await piNativeHostFixture(provider, profileId);
    assert.ok(!JSON.stringify(binding).includes(CREDENTIAL), "binding carries only a non-secret profile id");
    try {
      const pi = await manifestById("../../examples/addons/pi-harness.json");
      const augmentor = await manifestById("../host/harness-examples/provider-chat-demo.json");
      const grants = (manifest) => manifest.requestedCapabilities.map((g) => ({ ...g, granted: true }));
      const payload = { workload: "augmentor-chat", model: MODEL, messages: [{ role: "user", content: "hi" }] };

      // 3. Augmentor as primary-agent uses the profile through provider-fabric.
      await host.registry.install(augmentor, { enabled: true });
      await host.registry.setGrants(augmentor.id, grants(augmentor), { consent: true, expectedRevision: host.registry.snapshot().revision });
      await host.registry.assignSlot("primary-agent", augmentor.id, { expectedGeneration: 0 });
      const augOut = await host.executeBridgeChat(payload);
      assert.equal(augOut.reply, "augmentor reply");
      assert.equal(captured.at(-1).url, `${ENDPOINT}/chat/completions`);
      assert.equal(captured.at(-1).headers.Authorization, `Bearer ${CREDENTIAL}`);

      // 4. Swap primary-agent to Pi; Pi resolves the SAME profile credential
      //    through the session-environment chain — no second credential entry.
      await host.registry.install(pi, { enabled: true });
      await host.registry.setGrants(pi.id, grants(pi), { consent: true, expectedRevision: host.registry.snapshot().revision });
      await host.registry.assignSlot("primary-agent", pi.id, {
        expectedGeneration: host.registry.snapshot().slots["primary-agent"].generation, replace: true,
      });
      const piOut = await host.executeBridgeChat(payload);
      assert.equal(piOut.reply, "pi reply");
      assert.equal(launchPlans.length, 1);
      const plan = launchPlans[0];
      assert.equal(plan.providerProfileId, profileId);
      assert.equal(plan.piProvider, "openrouter");
      assert.equal(plan.envVar, "OPENROUTER_API_KEY");
      assert.equal(plan.credentialMechanism, "session-environment");
      assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL, "credential flows only through the private session env");
      assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL), "credential never reaches argv");
      assert.ok(plan.projectPath.includes("ros-pi-native-root"), "launch cwd is the projected root");

      // 5. No secret appears in host projections or manifest surfaces.
      const projection = JSON.stringify(host.registry.snapshot());
      assert.ok(!projection.includes(CREDENTIAL), "registry snapshot must not expose the credential");

      // 6. Revoke Pi's agent-runtime: the clean gate fences new launch material,
      //    Augmentor stays authorized.
      const revokedGrants = pi.requestedCapabilities.map((g) => ({ ...g, granted: g.capability !== "agent-runtime" }));
      await host.registry.setGrants(pi.id, revokedGrants, { consent: true, expectedRevision: host.registry.snapshot().revision });
      assert.throws(() => host.registry.authorize("primary-agent", pi.id), { code: "permission-denied" });
      await assert.rejects(host.executeBridgeChat(payload), { code: "permission-denied" });
      assert.equal(launchPlans.length, 1, "no new launch plan after revocation");

      // 7. Re-assign Augmentor (its grants were never revoked) and prove reuse:
      //    the shared provider credential remains usable by other authorized
      //    consumers after Pi's revocation.
      await host.registry.assignSlot("primary-agent", augmentor.id, {
        expectedGeneration: host.registry.snapshot().slots["primary-agent"].generation, replace: true,
      });
      const again = await host.executeBridgeChat(payload);
      assert.equal(again.reply, "augmentor reply");
      assert.equal(captured.at(-1).headers.Authorization, `Bearer ${CREDENTIAL}`);
    } finally {
      await host.close();
    }
  });
});

test("cross-harness and cross-profile provider-profile resolution fails closed", async () => {
  await withFixture(async (provider) => {
    const a = await provider.executeProviderAccountSave({
      mode: "create", templateId: "openai-compatible", label: "Profile A",
      providerType: "openai-compatible", apiBaseUrl: "http://127.0.0.1:8378", models: ["model-a"], credential: "",
    });
    await provider.executeProviderCredentialSave({ providerId: a.provider.id, credential: "aaaa-credential-123" });
    const resolveProviderProfileCredential = async (id) => {
      const profiles = await provider.allProviderProfiles();
      const profile = profiles.find((p) => p.id === id);
      const secrets = await provider.readProviderSecrets();
      return { endpoint: profile?.apiBaseUrl, actionToken: secrets[id] };
    };
    // A binding that maps a DIFFERENT add-on to the profile cannot be used by Pi.
    const otherBinding = {
      name: "openai.compatible", addonId: "addon.other-harness",
      adapterId: "openai-compatible-v1", authScheme: "bearer", source: { providerProfileId: a.provider.id },
    };
    let stored = null;
    const host = await createHarnessHostService({
      env: {},
      store: { read: async () => stored, write: async (value) => { stored = structuredClone(value); } },
      providerHost: provider, resolveProviderProfileCredential, bindings: [otherBinding],
    });
    try {
      const pi = await manifestById("../../examples/addons/pi-harness.json");
      // No approved binding for addon.pi-harness -> install of a provider-profile
      // manifest is refused (authority is host-owned, never manifest-owned).
      await assert.rejects(host.registry.install(pi, { enabled: true }), { code: "permission-denied" });
    } finally {
      await host.close();
    }
  });
});

test("workbench route flow installs, swaps and revokes provider-profile Pi through bridge routes", async () => {
  await withFixture(async (provider, captured, root) => {
    const account = await provider.executeProviderAccountSave({
      mode: "create", templateId: "openrouter", label: "Workbench Shared",
      providerType: "openai-compatible", apiBaseUrl: ENDPOINT, models: [MODEL], credential: "",
    });
    const profileId = account.provider.id;
    await provider.executeProviderCredentialSave({ providerId: profileId, credential: CREDENTIAL });
    // Real pi-native wiring shared with the first test (reviewed session
    // service, host-issued projection, clean snapshot authorize gate).
    const { host, call, launchPlans } = await piNativeHostFixture(provider, profileId);
    try {
      const pi = await manifestById("../../examples/addons/pi-harness.json");
      const augmentor = await manifestById("../host/harness-examples/provider-chat-demo.json");
      const grants = (manifest) => manifest.requestedCapabilities.map((g) => ({ ...g, granted: true }));
      const payload = { workload: "augmentor-chat", model: MODEL, messages: [{ role: "user", content: "hi" }] };

      // Install + grant + assign Pi through the extension's bridge routes.
      const installPi = await call("/addons/install", { manifest: pi, enabled: true });
      assert.equal(installPi.status, 200);
      const grantPi = await call("/addons/grants", { addonId: pi.id, grants: grants(pi), consent: true, expectedRevision: installPi.payload.revision });
      assert.equal(grantPi.status, 200);
      const assignPi = await call("/addons/slots/assign", { slot: "primary-agent", addonId: pi.id, expectedGeneration: 0 });
      assert.equal(assignPi.status, 200);

      // Governed composer chat runs the REAL pi-native chain with the fake
      // launcher: Settings credential -> session env -> plan env -> launcher.
      const piOut = await host.executeBridgeChat(payload);
      assert.equal(piOut.reply, "pi reply");
      assert.equal(launchPlans.length, 1);
      const plan = launchPlans[0];
      assert.equal(plan.providerProfileId, profileId);
      assert.equal(plan.selectedModel, MODEL);
      assert.equal(plan.piProvider, "openrouter");
      assert.equal(plan.envVar, "OPENROUTER_API_KEY");
      assert.equal(plan.credentialMechanism, "session-environment");
      assert.equal(plan.env.OPENROUTER_API_KEY, CREDENTIAL, "credential flows only through the private session env");
      assert.ok(!JSON.stringify(plan.argv).includes(CREDENTIAL), "credential never reaches argv");
      assert.ok(plan.projectPath.includes("ros-pi-native-root"), "launch cwd is the projected root");
      assert.ok(!JSON.stringify(host.registry.snapshot()).includes(CREDENTIAL), "registry snapshot never exposes the credential");

      // Revoke Pi's agent-runtime through the grants route: the CLEAN authorize
      // gate (registry snapshot) fences any NEW launch plan.
      const revoked = pi.requestedCapabilities.map((g) => ({ ...g, granted: g.capability !== "agent-runtime" }));
      const revokePi = await call("/addons/grants", { addonId: pi.id, grants: revoked, consent: true, expectedRevision: host.registry.snapshot().revision });
      assert.equal(revokePi.status, 200);
      await assert.rejects(host.executeBridgeChat(payload), { code: "permission-denied" });
      assert.equal(launchPlans.length, 1, "no new launch plan after revocation");

      // Swap primary-agent to Augmentor through routes; the SAME profile serves
      // it — the shared provider credential remains usable by other authorized
      // consumers after Pi's revocation.
      const installAug = await call("/addons/install", { manifest: augmentor, enabled: true });
      const grantAug = await call("/addons/grants", { addonId: augmentor.id, grants: grants(augmentor), consent: true, expectedRevision: installAug.payload.revision });
      assert.equal(grantAug.status, 200);
      const swapAug = await call("/addons/slots/assign", { slot: "primary-agent", addonId: augmentor.id,
        expectedGeneration: host.registry.snapshot().slots["primary-agent"].generation, replace: true });
      assert.equal(swapAug.status, 200);
      const augOut = await host.executeBridgeChat(payload);
      assert.equal(augOut.reply, "augmentor reply");
      assert.equal(captured.at(-1).headers.Authorization, `Bearer ${CREDENTIAL}`);
      assert.equal(launchPlans.length, 1, "Augmentor's runtime-adapter path never spawns Pi");

      // The payloads never carried the credential; the store is the only source.
      assert.ok(!JSON.stringify({ installPi, grantPi, assignPi, revokePi, swapAug }).includes(CREDENTIAL));
    } finally {
      await host.close();
    }
  });
});
