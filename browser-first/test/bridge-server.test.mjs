import assert from "node:assert/strict";
import test from "node:test";

import {
  createBridgeClient,
  createRawBridgeFetch,
  capabilityForBridgeRoute,
  initCapabilityTokens,
  isUnauthorizedBridgeError,
  resolveBridgeConfig,
} from "../resonantos-side-panel-extension/src/lib/bridge-client.js";
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

// Kernel of M0 Test B (Local Files): two distinct callers, overlapping but
// distinct grants on the same capability, must be observably distinguishable
// to the bridge — both at the route handler and in the audit log.
test("bridge distinguishes two callers with overlapping grants (M0 Test B kernel)", async () => {
  const bridgeToken = "general-test-token";
  const alphaToken = "alpha-credential-token";
  const betaToken = "beta-credential-token";
  const routes = [
    {
      method: "POST",
      path: "/providers/credentials",
      requiredCapability: "provider-credential-write",
      handler: async () => ({ saved: true }),
    },
  ];
  const perCallerGrants = {
    "alpha-caller": { "provider-credential-write": alphaToken },
    "beta-caller": { "provider-credential-write": betaToken },
  };
  const auditRecords = [];
  const auditSink = (record) => { auditRecords.push(record); };

  // Beta caller requests write — they have the capability, but the audit log
  // must record their caller identity, not just the capability.
  const betaRequest = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: {
      "X-ResonantOS-Bridge-Token": bridgeToken,
      "X-ResonantOS-Bridge-Capability-Token": betaToken,
      "X-ResonantOS-Bridge-Caller-Id": "beta-caller",
    },
    body: { providerId: "shared-minimax" },
    bridgeToken,
    bridgeCapabilityTokens: {},
    perCallerGrants,
    auditSink,
    routes,
  });
  assert.equal(betaRequest.status, 200, "beta-caller has grant, must succeed");

  // Alpha caller requests write — different grant, different token.
  const alphaRequest = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: {
      "X-ResonantOS-Bridge-Token": bridgeToken,
      "X-ResonantOS-Bridge-Capability-Token": alphaToken,
      "X-ResonantOS-Bridge-Caller-Id": "alpha-caller",
    },
    body: { providerId: "shared-minimax" },
    bridgeToken,
    bridgeCapabilityTokens: {},
    perCallerGrants,
    auditSink,
    routes,
  });
  assert.equal(alphaRequest.status, 200, "alpha-caller has grant, must succeed");

  // A wrong-but-same-shape token for a caller with no grant must be rejected
  // — this is the kernel of M0 Test B's "denied unauthorized action".
  const unattributedRequest = await evaluateBridgeRequestForSelfTest({
    method: "POST",
    url: "/providers/credentials",
    headers: {
      "X-ResonantOS-Bridge-Token": bridgeToken,
      "X-ResonantOS-Bridge-Capability-Token": "rogue-token",
    },
    body: { providerId: "shared-minimax" },
    bridgeToken,
    bridgeCapabilityTokens: {},
    perCallerGrants,
    auditSink,
    routes,
  });
  assert.equal(unattributedRequest.status, 403, "rogue token must be rejected");

  // Audit log must carry distinct callerId for each authorised request.
  const successful = auditRecords.filter((record) => record.status === 200);
  assert.equal(successful.length, 2, "two successful requests recorded");
  const callerIds = new Set(successful.map((record) => record.callerId));
  assert.equal(callerIds.size, 2, "callerIds must be distinguishable in audit");
  assert.ok(callerIds.has("alpha-caller"));
  assert.ok(callerIds.has("beta-caller"));
});

// Hook-up A: the wired request handler (createBridgeRequestHandler) honours
// perCallerGrants and auditSink when supplied, and rejects/forwards correctly
// when they're absent. Production stays dormant until run-bridge-minimal (or
// any future launcher) passes these — see hook-up B.
test("createBridgeRequestHandler threads perCallerGrants and auditSink end-to-end", async () => {
  const { createBridgeRequestHandler } = await import("../host/bridge-server.mjs");
  const bridgeToken = "wired-bridge-token";
  const perCallerGrants = {
    "alpha-caller": { "provider-credential-write": "alpha-cred-token" },
    "beta-caller": { "provider-credential-write": "beta-cred-token" },
  };
  const auditRecords = [];
  const auditSink = (record) => { auditRecords.push(record); };
  const routes = [
    {
      method: "GET",
      path: "/providers/credentials/probe",
      requiredCapability: "provider-credential-write",
      handler: async () => ({ probed: true }),
    },
  ];
  const handler = createBridgeRequestHandler({
    bridgeToken,
    bridgeCapabilityTokens: {},
    perCallerGrants,
    auditSink,
    extensionOrigin: "chrome-extension://test",
    routes,
  });
  function makeRequest(headers, body) {
    return {
    method: "GET",
    url: "/providers/credentials/probe",
    headers,
    };
  }

  function makeResponse() {
    const headers = {};
    const response = {
      statusCode: 0,
      body: null,
      _headers: headers,
      writeHead(status, headerObj) {
        response.statusCode = status;
        Object.assign(headers, headerObj);
      },
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      end(payload) {
        response.body = payload ? JSON.parse(payload) : null;
      },
    };
    return response;
  }

  // alpha-caller with its token — must succeed.
  const alphaResponse = makeResponse();
  await handler(makeRequest({
    "X-ResonantOS-Bridge-Token": bridgeToken,
    "X-ResonantOS-Bridge-Capability-Token": "alpha-cred-token",
    "X-ResonantOS-Bridge-Caller-Id": "alpha-caller",
  }), alphaResponse);
  assert.equal(alphaResponse.statusCode, 200, "alpha-caller request must 200");
  assert.equal(alphaResponse.body.probed, true);

  // beta-caller with its token — must succeed and record distinct caller.
  const betaResponse = makeResponse();
  await handler(makeRequest({
    "X-ResonantOS-Bridge-Token": bridgeToken,
    "X-ResonantOS-Bridge-Capability-Token": "beta-cred-token",
    "X-ResonantOS-Bridge-Caller-Id": "beta-caller",
  }), betaResponse);
  assert.equal(betaResponse.statusCode, 200);

  // Wrong token, valid caller header — must be rejected.
  const wrongResponse = makeResponse();
  await handler(makeRequest({
    "X-ResonantOS-Bridge-Token": bridgeToken,
    "X-ResonantOS-Bridge-Capability-Token": "rogue-token",
    "X-ResonantOS-Bridge-Caller-Id": "alpha-caller",
  }), wrongResponse);
  assert.equal(wrongResponse.statusCode, 403);

  const successes = auditRecords.filter((record) => record.status === 200);
  assert.equal(successes.length, 2);
  const callerIds = new Set(successes.map((record) => record.callerId));
  assert.equal(callerIds.size, 2, "audit must record distinct callerIds");
  assert.ok(callerIds.has("alpha-caller"));
  assert.ok(callerIds.has("beta-caller"));
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

test("bridge client reports unreachable bridge fetches with settings guidance", async () => {
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await assert.rejects(
    () => client("/addons/status", { method: "GET" }),
    /Bridge is unreachable for \/addons\/status: Failed to fetch.*Settings > Bridge Target/,
  );
});

test("bridge client marks 401 token mismatch errors as bridge authorization failures", async () => {
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken: "stale-token",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ ok: false, error: "Unauthorized browser-first bridge request." }),
    }),
  });

  await assert.rejects(
    () => client("/status", { method: "GET" }),
    (error) => {
      assert.equal(isUnauthorizedBridgeError(error), true);
      assert.equal(error.bridgeStatus, 401);
      return true;
    },
  );
});

test("bridge config resolver can refresh a generated config resource without eval", async () => {
  const previousBridgeConfig = globalThis.__RESONANTOS_BRIDGE_CONFIG__;
  globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken: "stale-token",
    capabilityBootstrapToken: "stale-bootstrap",
  });
  const script = 'globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze({"bridgeUrl":"http://127.0.0.1:47773","bridgeToken":"fresh-token","capabilityBootstrapToken":"fresh-bootstrap"});\n';
  try {
    const cfg = await resolveBridgeConfig({
      refreshGenerated: true,
      now: 12345,
      resourceUrl: "chrome-extension://test/src/bridge-config.generated.js",
      fetchImpl: async (url, options = {}) => {
        assert.equal(new URL(url).searchParams.get("resonantosConfigReload"), "12345");
        assert.equal(options.cache, "no-store");
        return new Response(script, {
          status: 200,
          headers: { "Content-Type": "application/javascript" },
        });
      },
    });

    assert.equal(cfg.bridgeToken, "fresh-token");
    assert.equal(cfg.capabilityBootstrapToken, "fresh-bootstrap");
    assert.equal(cfg.source, "generated:refreshed");
    assert.equal(globalThis.__RESONANTOS_BRIDGE_CONFIG__.bridgeToken, "fresh-token");
  } finally {
    if (previousBridgeConfig === undefined) {
      delete globalThis.__RESONANTOS_BRIDGE_CONFIG__;
    } else {
      globalThis.__RESONANTOS_BRIDGE_CONFIG__ = previousBridgeConfig;
    }
  }
});

test("bridge config resolver lets tokenless overrides inherit generated credentials", async () => {
  const previousBridgeConfig = globalThis.__RESONANTOS_BRIDGE_CONFIG__;
  const previousChrome = globalThis.chrome;
  globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken: "generated-token",
    capabilityBootstrapToken: "generated-bootstrap",
    bridgeCapabilityTokens: { "addon-runtime-read": "runtime-token" },
  });
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({
          bridgeTargetOverride: {
            bridgeUrl: "http://127.0.0.1:48773",
            bridgeToken: "",
            capabilityBootstrapToken: "",
          },
        }),
      },
    },
  };

  try {
    const cfg = await resolveBridgeConfig();
    assert.equal(cfg.source, "override");
    assert.equal(cfg.bridgeUrl, "http://127.0.0.1:48773");
    assert.equal(cfg.bridgeToken, "generated-token");
    assert.equal(cfg.capabilityBootstrapToken, "generated-bootstrap");
    assert.equal(cfg.bridgeCapabilityTokens["addon-runtime-read"], "runtime-token");
  } finally {
    if (previousBridgeConfig === undefined) {
      delete globalThis.__RESONANTOS_BRIDGE_CONFIG__;
    } else {
      globalThis.__RESONANTOS_BRIDGE_CONFIG__ = previousBridgeConfig;
    }
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  }
});

test("raw bridge fetch reports unreachable proxy fetches with settings guidance", async () => {
  const rawFetch = createRawBridgeFetch({
    bridgeUrl: "http://127.0.0.1:47773",
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });

  await assert.rejects(
    () => rawFetch("/hermes-dashboard/", { method: "GET" }),
    /Bridge is unreachable for \/hermes-dashboard\/: Failed to fetch.*Settings > Bridge Target/,
  );
});

test("bridge fetch helpers preserve AbortError cancellation", async () => {
  const abortError = new Error("The operation was aborted.");
  abortError.name = "AbortError";
  const fetchImpl = async () => {
    throw abortError;
  };
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:47773",
    fetchImpl,
  });
  const rawFetch = createRawBridgeFetch({
    bridgeUrl: "http://127.0.0.1:47773",
    fetchImpl,
  });
  const isSameAbort = (error) => error === abortError;

  await assert.rejects(() => client("/addons/status", { method: "GET" }), isSameAbort);
  await assert.rejects(() => rawFetch("/hermes-dashboard/", { method: "GET" }), isSameAbort);
});

test("capability-token bootstrap stays quiet when the bridge is unreachable", async () => {
  await initCapabilityTokens({
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken: "general-test-token",
    capabilityBootstrapToken: "bootstrap-test-token",
    fetchImpl: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
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
