import assert from "node:assert/strict";
import test from "node:test";

import { createBridgeClient, capabilityForBridgeRoute, initCapabilityTokens } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";
import { evaluateBridgeRequestForSelfTest, startBridgeServer } from "../host/bridge-server.mjs";

test("bridge capability behavior is deterministic without localhost binding", async () => {
  const bridgeToken = "general-test-token";
  const capabilityToken = "credential-write-test-token";
  const routes = [
    { method: "GET", path: "/public", handler: async () => ({ public: true }) },
    {
      method: "POST",
      path: "/providers/credentials",
      requiredCapability: "provider-credential-write",
      handler: async () => ({ saved: true }),
    },
  ];

  const publicResult = await evaluateBridgeRequestForSelfTest({
    method: "GET",
    url: "/public",
    headers: { "X-ResonantOS-Bridge-Token": bridgeToken },
    bridgeToken,
    bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
    routes,
  });
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.payload.public, true);

  const unauthorized = await evaluateBridgeRequestForSelfTest({
    method: "GET",
    url: "/public",
    headers: {},
    bridgeToken,
    bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
    routes,
  });
  assert.equal(unauthorized.status, 401);

  const missingCapability = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: { "X-ResonantOS-Bridge-Token": bridgeToken },
    body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
    bridgeToken,
    bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
    routes,
  });
  assert.equal(missingCapability.status, 403);

  const wrongCapability = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: {
      "X-ResonantOS-Bridge-Token": bridgeToken,
      "X-ResonantOS-Bridge-Capability-Token": "wrong-token",
    },
    body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
    bridgeToken,
    bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
    routes,
  });
  assert.equal(wrongCapability.status, 403);

  const saved = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: {
      "X-ResonantOS-Bridge-Token": bridgeToken,
      "X-ResonantOS-Bridge-Capability-Token": capabilityToken,
    },
    body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
    bridgeToken,
    bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
    routes,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.payload.saved, true);
});

test("bridge client sends scoped capability headers without localhost binding", async () => {
  const bridgeToken = "general-test-token";
  const capabilityToken = "credential-write-test-token";
  const routes = [
    {
      method: "POST",
      path: "/providers/credentials",
      requiredCapability: "provider-credential-write",
      handler: async (payload) => ({ saved: payload.providerId === "shared-minimax" }),
    },
  ];
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken,
    bridgeCapabilityTokens: {
      "provider-credential-write": capabilityToken,
    },
    fetchImpl: async (url, options = {}) => {
      const result = await evaluateBridgeRequestForSelfTest({
        method: options.method,
        url: new URL(url).pathname,
        headers: options.headers,
        body: options.body ? JSON.parse(options.body) : {},
        bridgeToken,
        bridgeCapabilityTokens: {
          "provider-credential-write": capabilityToken,
        },
        routes,
      });
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.payload,
      };
    },
  });

  assert.equal(capabilityForBridgeRoute("/providers/credentials", "POST"), "provider-credential-write");

  const clientWithoutCapability = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken,
    bridgeCapabilityTokens: {},
    fetchImpl: async (url, options = {}) => {
      const result = await evaluateBridgeRequestForSelfTest({
        method: options.method,
        url: new URL(url).pathname,
        headers: options.headers,
        body: options.body ? JSON.parse(options.body) : {},
        bridgeToken,
        bridgeCapabilityTokens: {
          "provider-credential-write": capabilityToken,
        },
        routes,
      });
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.payload,
      };
    },
  });

  await assert.rejects(
    () => clientWithoutCapability("/providers/credentials", {
      method: "POST",
      body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
    }),
    /requires provider-credential-write capability/,
  );

  const saved = await client("/providers/credentials", {
    method: "POST",
    body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
  });
  assert.equal(saved.saved, true);
});

test("bridge capability-token bootstrap is scoped and separate from the bridge token", async (t) => {
  const bridgeToken = "general-test-token";
  const capabilityBootstrapToken = "bootstrap-token";
  const credentialToken = "credential-write-test-token";
  const routingToken = "routing-write-test-token";
  let server;
  try {
    server = await startBridgeServer({
      port: 0,
      bridgeToken,
      capabilityBootstrapToken,
      bridgeCapabilityTokens: {
        "provider-credential-write": credentialToken,
        "provider-routing-write": routingToken,
      },
      extensionOrigin: "chrome-extension://test",
      routes: [{ method: "GET", path: "/public", handler: async () => ({ public: true }) }],
    });
  } catch (error) {
    if (error?.code === "EPERM" && error?.address === "127.0.0.1") {
      t.skip("localhost bind is denied in this sandbox; bridge bootstrap behavior must be verified outside sandboxed CI.");
      return;
    }
    throw error;
  }
  const address = server.address();
  const bridgeUrl = `http://127.0.0.1:${address.port}`;
  try {
    const oldGet = await fetch(`${bridgeUrl}/api/capability-tokens`, {
      headers: { "X-ResonantOS-Bridge-Token": bridgeToken },
    });
    assert.equal(oldGet.status, 404);

    const noBootstrap = await fetch(`${bridgeUrl}/api/capability-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ResonantOS-Bridge-Token": bridgeToken,
      },
      body: JSON.stringify({ capabilities: ["provider-credential-write"] }),
    });
    assert.equal(noBootstrap.status, 403);

    const scoped = await fetch(`${bridgeUrl}/api/capability-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ResonantOS-Bridge-Token": bridgeToken,
        "X-ResonantOS-Capability-Bootstrap-Token": capabilityBootstrapToken,
      },
      body: JSON.stringify({ capabilities: ["provider-credential-write"] }),
    });
    assert.equal(scoped.status, 200);
    const payload = await scoped.json();
    assert.deepEqual(payload.capabilityTokens, { "provider-credential-write": credentialToken });
    assert.equal(payload.capabilityTokens["provider-routing-write"], undefined);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bridge privileged routes require a route-scoped capability token", async (t) => {
  const bridgeToken = "general-test-token";
  const capabilityToken = "credential-write-test-token";
  let server;
  try {
    server = await startBridgeServer({
      port: 0,
      bridgeToken,
      bridgeCapabilityTokens: {
        "provider-credential-write": capabilityToken,
      },
      extensionOrigin: "chrome-extension://test",
      routes: [
        { method: "GET", path: "/public", handler: async () => ({ public: true }) },
        {
          method: "POST",
          path: "/providers/credentials",
          requiredCapability: "provider-credential-write",
          handler: async () => ({ saved: true }),
        },
      ],
    });
  } catch (error) {
    if (error?.code === "EPERM" && error?.address === "127.0.0.1") {
      t.skip("localhost bind is denied in this sandbox; bridge capability behavior must be verified outside sandboxed CI.");
      return;
    }
    throw error;
  }
  const address = server.address();
  const bridgeUrl = `http://127.0.0.1:${address.port}`;
  const client = createBridgeClient({
    bridgeUrl,
    bridgeToken,
    bridgeCapabilityTokens: {
      "provider-credential-write": capabilityToken,
    },
  });
  const clientWithoutCapability = createBridgeClient({
    bridgeUrl,
    bridgeToken,
    bridgeCapabilityTokens: {},
  });

  try {
    assert.equal((await client("/public", { method: "GET" })).public, true);

    await assert.rejects(
      () => clientWithoutCapability("/providers/credentials", {
        method: "POST",
        body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
      }),
      /requires provider-credential-write capability/,
    );

    const wrongCapability = await fetch(`${bridgeUrl}/providers/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ResonantOS-Bridge-Token": bridgeToken,
        "X-ResonantOS-Bridge-Capability-Token": "wrong-token",
      },
      body: JSON.stringify({ providerId: "shared-minimax", credential: "minimax-test-credential" }),
    });
    assert.equal(wrongCapability.status, 403);

    const saved = await client("/providers/credentials", {
      method: "POST",
      body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
    });
    assert.equal(saved.saved, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bridge client uses runtime-scoped capability tokens after bootstrap", async () => {
  const bridgeToken = "runtime-general-test-token";
  const capabilityBootstrapToken = "runtime-bootstrap-test-token";
  const capabilityToken = "runtime-credential-write-token";
  const routes = [
    {
      method: "POST",
      path: "/providers/credentials",
      requiredCapability: "provider-credential-write",
      handler: async () => ({ saved: true }),
    },
  ];
  const fetchImpl = async (url, options = {}) => {
    const result = await evaluateBridgeRequestForSelfTest({
      method: options.method,
      url: new URL(url).pathname,
      headers: options.headers,
      body: options.body ? JSON.parse(options.body) : {},
      bridgeToken,
      capabilityBootstrapToken,
      bridgeCapabilityTokens: { "provider-credential-write": capabilityToken },
      routes: [
        {
          method: "POST",
          path: "/api/capability-tokens",
          requiredCapabilityBootstrap: true,
          handler: async (payload) => ({
            capabilityTokens: Object.fromEntries(
              (payload.capabilities ?? [])
                .filter((capability) => capability === "provider-credential-write")
                .map((capability) => [capability, capabilityToken]),
            ),
          }),
        },
        ...routes,
      ],
    });
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.payload,
    };
  };

  await initCapabilityTokens({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken,
    capabilityBootstrapToken,
    fetchImpl,
  });
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken,
    bridgeCapabilityTokens: {},
    fetchImpl,
  });
  const saved = await client("/providers/credentials", {
    method: "POST",
    body: { providerId: "shared-minimax", credential: "minimax-test-credential" },
  });
  assert.equal(saved.saved, true);
});
