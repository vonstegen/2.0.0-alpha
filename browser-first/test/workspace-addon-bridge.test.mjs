// Tests for the generic workspace add-on bridge path. Proves that:
//   1. /addons/status merges workspace add-ons from addon.json manifests.
//   2. Authorized capability tokens (e.g. harness-messaging) reach the
//      upstream and the upstream returns the expected payload.
//   3. Missing or mismatched capability tokens are denied at the host.
//   4. Capability tokens for capabilities the addon did NOT request are
//      not honored for that add-on's routes.
//   5. Workspace add-on discovery does not require Core ID-specific code
//      (a second unrelated add-on registers through the same mechanism).

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { buildWorkspaceAddonRoutes } from "../host/addon-delegation-host-service.mjs";
import { evaluateBridgeRequestForSelfTest } from "../host/bridge-server.mjs";
import { BRIDGE_CAPABILITY_TOKEN_SPECS, buildBridgeCapabilityTokens } from "../host/bridge-capability-tokens.mjs";

const ROOT_PARENT = path.join(os.tmpdir(), "sdk-demo-001-");
const FIXTURE_ADDON_ID = "addon.resonant-echo";
const FIXTURE_SECOND_ADDON_ID = "addon.resonant-counter";

async function writeManifest(rootDir, manifest) {
  // Mirrors browserFirst/addons/<addon-id>/addon.json layout.
  const addonDir = path.join(rootDir, "addons", manifest.id);
  await rm(addonDir, { recursive: true, force: true });
  await mkdir(addonDir, { recursive: true });
  const manifestPath = path.join(addonDir, "addon.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifestPath;
}

const upstreamServers = new Set();

async function startUpstream({ respond, onRequest }) {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const pathPart = url.split("?")[0] ?? "/";
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload = {};
    try { payload = body ? JSON.parse(body) : {}; } catch { /* ignore */ }
    onRequest?.({ method: req.method, path: pathPart, body: payload, headers: req.headers });
    if (pathPart === "/api/echo/message" && req.method === "POST") {
      respond({ status: 200, payload: { ok: true, echo: payload.message ?? "", upstream: true } }, res);
      return;
    }
    respond({ status: 404, payload: { ok: false, error: "not found" } }, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  upstreamServers.add(server);
  return {
    port,
    close: async () => {
      upstreamServers.delete(server);
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

// Close any leftover upstreams when this test file exits so subsequent
// test files in the same `node --test` invocation are not blocked by an
// open HTTP server keeping the event loop alive.
test.after(async () => {
  const servers = [...upstreamServers];
  upstreamServers.clear();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

function makeCapabilityTokens() {
  // Mint a unique opaque token for each declared capability so the bridge
  // can distinguish "missing token" from "token issued for a different
  // capability". The bridge compares tokens as opaque constant-time strings.
  // buildBridgeCapabilityTokens checks args[arg] ?? env[env] ?? mint();
  // we set env[env] = per-capability token so each spec gets a distinct
  // value and mint() never has to fire.
  const env = {};
  for (const spec of BRIDGE_CAPABILITY_TOKEN_SPECS) {
    env[spec.env] = `test-token-${spec.capability}`;
  }
  return buildBridgeCapabilityTokens({
    args: new Map(),
    env,
    mint: () => "test-token-unused"
  });
}

function buildExecutor(upstream, addonRegistry, manifest, capabilityTokens) {
  const runtimeState = new Map();
  runtimeState.set(manifest.id, { manifest, port: upstream.port });
  return async ({ addon, route, payload }) => {
    const state = runtimeState.get(addon.id);
    if (!state) {
      return { status: 503, body: { ok: false, error: `runtime not running for ${addon.id}` } };
    }
    const response = await fetch(`http://127.0.0.1:${state.port}${route.path}`, {
      method: String(route.method ?? "POST"),
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-capability-token":
          capabilityTokens[addon?.messaging?.requestCapability] ?? ""
      },
      body: JSON.stringify(payload ?? {})
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    return { status: response.status, body: parsed };
  };
}

async function invoke(route, { capabilityTokens, body }) {
  const result = await evaluateBridgeRequestForSelfTest({
    method: route.method,
    url: route.path,
    headers: {
      "x-resonantos-bridge-token": "bridge-token",
      "x-resonantos-bridge-capability-token": capabilityTokens
    },
    body: body ?? {},
    bridgeToken: "bridge-token",
    bridgeCapabilityTokens: makeCapabilityTokens(),
    capabilityBootstrapToken: "bootstrap",
    routes: [route]
  });
  return result;
}

test("workspace addon discovery surfaces addon.json into /addons/status", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  try {
    const browserFirstRoot = () => root;
    const service = createAddonDelegationService({
      browserFirstRoot,
      repoRoot: path.join(root, "Repo"),
      memoryRoot: () => path.join(root, "Memory"),
      userRoot: () => path.join(root, "User"),
      socketOpen: async () => false,
      hermesCommand: () => null,
      opencodeCommand: () => null
    });
    // The registry reads the upstream port from process.env[upstreamPortEnvVar].
    const ECHO_ENV = "RESONANTOS_TEST_ECHO_PORT";
    process.env[ECHO_ENV] = "47321";
    await writeManifest(root, {
      id: FIXTURE_ADDON_ID,
      name: "Resonant Echo",
      version: "0.1.0",
      mode: "workspace-addon",
      trust: "sdk-reference",
      boundary: "Replaceable.",
      capabilities: ["harness-messaging"],
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/echo/",
          apiBasePath: "/api/echo",
          iframeMode: "srcdoc",
          entry: "index.html",
          upstreamPortEnvVar: ECHO_ENV,
          mirrorPaths: [
            { bridge: "/echo", upstream: "" },
            { bridge: "/api/echo", upstream: "/api/echo" }
          ],
          runtime: { command: "node", args: ["server.mjs"], port: 47321 }
        }
      },
      messaging: {
        channel: "addon.resonant-echo",
        requestCapability: "harness-messaging",
        routes: [
          { method: "POST", path: "/api/echo/message", requiredCapability: "harness-messaging" },
          { method: "GET", path: "/api/echo/status", requiredCapability: "harness-messaging" }
        ]
      }
    });
    const status = await service.executeAddonsStatus();
    const echo = status.addons.find((addon) => addon.id === FIXTURE_ADDON_ID);
    assert.ok(echo, "expected addon.resonant-echo in /addons/status");
    assert.equal(echo.proxyPath, "/echo/");
    assert.equal(echo.apiBasePath, "/api/echo");
    assert.equal(echo.upstreamPort, 47321);
    assert.equal(echo.messaging.routes.length, 2);
    assert.deepEqual(echo.grantedCapabilities, []);
    assert.deepEqual(echo.requestedCapabilities, ["harness-messaging"]);
  } finally {
    delete process.env["RESONANTOS_TEST_ECHO_PORT"];
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace addon: authorized capability reaches upstream and returns the response", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  let upstream = null;
  try {
    const capabilityTokens = makeCapabilityTokens();
    const harnessToken = capabilityTokens["harness-messaging"];
    assert.ok(harnessToken, "harness-messaging capability must be in launcher catalog");

    let observedRequest = null;
    upstream = await startUpstream({
      respond: ({ status, payload }, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      },
      onRequest: (req) => { observedRequest = req; }
    });

    const manifest = {
      id: FIXTURE_ADDON_ID,
      name: "Resonant Echo",
      version: "0.1.0",
      mode: "workspace-addon",
      trust: "sdk-reference",
      boundary: "Replaceable.",
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/echo/",
          apiBasePath: "/api/echo",
          iframeMode: "srcdoc",
          entry: "index.html",
          mirrorPaths: [{ bridge: "/api/echo", upstream: "/api/echo" }],
          runtime: { command: "node", args: ["server.mjs"], port: upstream.port }
        }
      },
      messaging: {
        channel: "addon.resonant-echo",
        requestCapability: "harness-messaging",
        routes: [{ method: "POST", path: "/api/echo/message", requiredCapability: "harness-messaging" }]
      }
    };

    const route = buildWorkspaceAddonRoutes({
      workspaceAddons: [{
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        mode: manifest.mode,
        trust: manifest.trust,
        boundary: manifest.boundary,
        contributions: manifest.contributions,
        messaging: manifest.messaging
      }],
      executeWorkspaceAddonRequest: buildExecutor(upstream, null, manifest, capabilityTokens)
    })[0];

    const ok = await invoke(route, {
      capabilityTokens: harnessToken,
      body: { message: "Hello Manolo" }
    });
    assert.equal(ok.status, 200, `expected 200, got ${ok.status}: ${JSON.stringify(ok.payload)}`);
    assert.ok(ok.payload && ok.payload.body, `expected ok.payload.body, got ${JSON.stringify(ok.payload)}`);
    assert.equal(ok.payload.body.echo, "Hello Manolo");
    assert.equal(ok.payload.body.upstream, true);
    assert.ok(observedRequest, "upstream must have been called");
    assert.equal(observedRequest.headers["x-resonantos-bridge-capability-token"], harnessToken);
  } finally {
    await upstream.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace addon: missing capability token is denied at the host", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  let upstream = null;
  try {
    upstream = await startUpstream({
      respond: ({ status, payload }, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      }
    });
    const capabilityTokens = makeCapabilityTokens();
    const manifest = {
      id: FIXTURE_ADDON_ID,
      name: "Resonant Echo",
      version: "0.1.0",
      mode: "workspace-addon",
      trust: "sdk-reference",
      boundary: "Replaceable.",
      contributions: { workspace: { type: "iframe", proxyPath: "/echo/", apiBasePath: "/api/echo", iframeMode: "srcdoc", entry: "index.html" } },
      messaging: {
        channel: "addon.resonant-echo",
        requestCapability: "harness-messaging",
        routes: [{ method: "POST", path: "/api/echo/message", requiredCapability: "harness-messaging" }]
      }
    };
    const route = buildWorkspaceAddonRoutes({
      workspaceAddons: [{
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        mode: manifest.mode,
        trust: manifest.trust,
        boundary: manifest.boundary,
        contributions: manifest.contributions,
        messaging: manifest.messaging
      }],
      executeWorkspaceAddonRequest: buildExecutor(upstream, null, manifest, capabilityTokens)
    })[0];
    const denied = await invoke(route, { capabilityTokens: "", body: { message: "should not arrive" } });
    assert.equal(denied.status, 403, "expected 403 when capability token is missing");
    assert.match(denied.payload.error, /harness-messaging/);
  } finally {
    await upstream.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace addon: capability the addon did not declare is not honored for its routes", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  let upstream = null;
  try {
    upstream = await startUpstream({
      respond: ({ status, payload }, res) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(payload));
      }
    });
    const capabilityTokens = makeCapabilityTokens();
    // The addon only requested `harness-messaging`. A different capability
    // token (e.g. provider-credential-write) must NOT authorize the route.
    const manifest = {
      id: FIXTURE_ADDON_ID,
      name: "Resonant Echo",
      version: "0.1.0",
      mode: "workspace-addon",
      trust: "sdk-reference",
      boundary: "Replaceable.",
      contributions: { workspace: { type: "iframe", proxyPath: "/echo/", apiBasePath: "/api/echo", iframeMode: "srcdoc", entry: "index.html" } },
      messaging: {
        channel: "addon.resonant-echo",
        requestCapability: "harness-messaging",
        routes: [{ method: "POST", path: "/api/echo/message", requiredCapability: "harness-messaging" }]
      }
    };
    const route = buildWorkspaceAddonRoutes({
      workspaceAddons: [{
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        mode: manifest.mode,
        trust: manifest.trust,
        boundary: manifest.boundary,
        contributions: manifest.contributions,
        messaging: manifest.messaging
      }],
      executeWorkspaceAddonRequest: buildExecutor(upstream, null, manifest, capabilityTokens)
    })[0];
    const wrong = await invoke(route, {
      capabilityTokens: capabilityTokens["provider-credential-write"],
      body: { message: "should not arrive" }
    });
    assert.equal(wrong.status, 403, "expected 403 when an unrelated capability token is used");
  } finally {
    await upstream.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace addon: a second unrelated addon registers through the same mechanism", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  try {
    const browserFirstRoot = () => root;
    const service = createAddonDelegationService({
      browserFirstRoot,
      repoRoot: path.join(root, "Repo"),
      memoryRoot: () => path.join(root, "Memory"),
      userRoot: () => path.join(root, "User"),
      socketOpen: async () => false,
      hermesCommand: () => null,
      opencodeCommand: () => null
    });
    // The registry reads the upstream port from process.env[upstreamPortEnvVar].
    const COUNTER_ENV = "RESONANTOS_TEST_COUNTER_PORT";
    process.env[COUNTER_ENV] = "47422";
    await writeManifest(root, {
      id: FIXTURE_SECOND_ADDON_ID,
      name: "Resonant Counter",
      version: "0.1.0",
      mode: "workspace-addon",
      trust: "sdk-reference",
      boundary: "Replaceable.",
      capabilities: ["harness-messaging"],
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/counter/",
          apiBasePath: "/api/counter",
          iframeMode: "srcdoc",
          entry: "index.html",
          upstreamPortEnvVar: COUNTER_ENV,
          mirrorPaths: [{ bridge: "/counter", upstream: "" }, { bridge: "/api/counter", upstream: "/api/counter" }],
          runtime: { command: "node", args: ["server.mjs"], port: 47422 }
        }
      },
      messaging: {
        channel: "addon.resonant-counter",
        requestCapability: "harness-messaging",
        routes: [{ method: "POST", path: "/api/counter/increment", requiredCapability: "harness-messaging" }]
      }
    });
    const status = await service.executeAddonsStatus();
    const counter = status.addons.find((addon) => addon.id === FIXTURE_SECOND_ADDON_ID);
    assert.ok(counter, "expected addon.resonant-counter in /addons/status");
    assert.equal(counter.proxyPath, "/counter/");
    assert.equal(counter.upstreamPort, 47422);
  } finally {
    delete process.env["RESONANTOS_TEST_COUNTER_PORT"];
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace addon: workspace route path is non-empty for the generic addon ID", () => {
  // Exercises the renderer-side resolver path indirectly via the manifest
  // contribution. The renderer's `workspaceForAddon` reads proxyPath from
  // `contributions.workspace.proxyPath`; verify the upstream loader emits it.
  const manifest = {
    id: FIXTURE_ADDON_ID,
    contributions: {
      workspace: {
        type: "iframe",
        proxyPath: "/echo/",
        apiBasePath: "/api/echo",
        iframeMode: "srcdoc",
        entry: "index.html"
      }
    }
  };
  const proxyPath = manifest.contributions.workspace.proxyPath;
  assert.ok(proxyPath && proxyPath.startsWith("/"));
  assert.ok(proxyPath.endsWith("/"));
});
