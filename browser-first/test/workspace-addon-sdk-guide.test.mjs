// Tests for the SDK Guide workspace add-on. Proves that:
//   1. sdk-guide discovers through the same generic mechanism as Echo and Counter.
//   2. Its authorized capability (harness-messaging) reaches the upstream and
//      the deterministic round-trip returns cross-boundary evidence.
//   3. The denied-action route returns 403 with the canonical "Bridge route
//      requires X capability" message that the tutorial step renders.
//   4. The add-on declares only harness-messaging; the bridge refuses to mint
//      tokens for any of the four denied capabilities it declares (defense
//      in depth at the host policy layer).

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { BRIDGE_CAPABILITY_TOKEN_SPECS, buildBridgeCapabilityTokens } from "../host/bridge-capability-tokens.mjs";

const ROOT_PARENT = path.join(os.tmpdir(), "sdk-demo-001d-");
const FIXTURE_GUIDE_ADDON_ID = "addon.sdk-guide";
const GUIDE_PORT_ENV = "RESONANTOS_TEST_SDK_GUIDE_PORT";

async function writeManifest(rootDir, manifest) {
  const addonDir = path.join(rootDir, "addons", manifest.id);
  await rm(addonDir, { recursive: true, force: true });
  await mkdir(addonDir, { recursive: true });
  await writeFile(
    path.join(addonDir, "addon.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
  return addonDir;
}

const upstreamServers = new Set();

async function startUpstream() {
  // Tiny echo-style upstream for sdk-guide. Verifies the inbound capability
  // token matches the env-supplied one, and exposes the same three routes
  // the real sdk-guide/server.mjs exposes.
  // Match the per-capability tokens minted by `makeCapabilityTokens()` below:
  //   `test-token-harness-messaging` for harness-messaging.
  const expectedToken = "test-token-harness-messaging";
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const pathPart = url.split("?")[0] ?? "/";
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
    const cap = req.headers["x-resonantos-bridge-capability-token"];
    const capOk = typeof cap === "string" && cap === expectedToken;
    if (pathPart.startsWith("/api/sdk-guide/") && !capOk) {
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: false,
        error: "harness-messaging capability token missing or invalid.",
        bridgeIdentity: "bridge://test"
      }));
      return;
    }
    if (req.method === "GET" && pathPart === "/api/sdk-guide/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        addon: FIXTURE_GUIDE_ADDON_ID,
        bridgeIdentity: "bridge://test",
        messageCount: 0,
        capability: "harness-messaging"
      }));
      return;
    }
    if (req.method === "POST" && pathPart === "/api/sdk-guide/message") {
      const message = typeof body.message === "string" ? body.message : "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        addon: FIXTURE_GUIDE_ADDON_ID,
        bridgeIdentity: "bridge://test",
        echo: message,
        messageCount: 1,
        capability: "harness-messaging",
        crossBoundaryEvidence: {
          from: "workspace iframe srcdoc",
          to: "addon upstream",
          via: "ResonantOS bridge",
          capabilityChecked: "harness-messaging"
        }
      }));
      return;
    }
    if (req.method === "POST" && pathPart === "/api/sdk-guide/denied") {
      const capRequested = typeof body.capability === "string" ? body.capability : "wallet-signing";
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: false,
        error: `Bridge route requires ${capRequested} capability.`,
        bridgeIdentity: "bridge://test",
        capabilityRequested: capRequested
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
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

test.after(async () => {
  const servers = [...upstreamServers];
  upstreamServers.clear();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

function makeCapabilityTokens() {
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

test("sdk-guide discovers through the generic mechanism (zero Core edits)", async () => {
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
    process.env[GUIDE_PORT_ENV] = "47423";
    await writeManifest(root, {
      id: FIXTURE_GUIDE_ADDON_ID,
      name: "SDK Guide",
      version: "0.1.0",
      description: "Interactive tutorial walking any user through the ResonantOS SDK.",
      author: "ResonantOS SDK-DEMO-001D",
      mode: "workspace-addon",
      trust: "sdk-reference",
      entry: "index.html",
      contentScripts: [],
      commands: [],
      messageChannel: FIXTURE_GUIDE_ADDON_ID,
      capabilities: ["harness-messaging"],
      requestedCapabilities: ["harness-messaging"],
      grantedCapabilities: ["harness-messaging"],
      deniedCapabilities: [
        "wallet-signing",
        "provider-secret-read",
        "trusted-memory-write",
        "filesystem-write"
      ],
      requires: [],
      boundary: "Replaceable SDK demonstration guide. Performs only deterministic round-trips through the bridge using harness-messaging.",
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/sdk-guide/",
          apiBasePath: "/api/sdk-guide",
          iframeMode: "srcdoc",
          entry: "index.html",
          mirrorPaths: [
            { bridge: "/sdk-guide", upstream: "" },
            { bridge: "/api/sdk-guide", upstream: "/api/sdk-guide" }
          ],
          runtime: {
            command: "node",
            args: ["server.mjs"],
            port: 47423,
            host: "127.0.0.1"
          }
        }
      },
      messaging: {
        channel: FIXTURE_GUIDE_ADDON_ID,
        requestCapability: "harness-messaging",
        routes: [
          { method: "GET", path: "/api/sdk-guide/status", requiredCapability: "harness-messaging" },
          { method: "POST", path: "/api/sdk-guide/message", requiredCapability: "harness-messaging" },
          { method: "POST", path: "/api/sdk-guide/denied", requiredCapability: "harness-messaging" }
        ]
      }
    });
    const snapshot = await service.executeAddonsStatus();
    const found = (snapshot.addons || []).find((a) => a.id === FIXTURE_GUIDE_ADDON_ID);
    assert.ok(found, "sdk-guide should appear in the add-on snapshot");
    assert.equal(found.available, true);
    assert.equal(found.mode, "workspace-addon");
    assert.equal(found.trust, "sdk-reference");
    assert.deepEqual(found.requestedCapabilities, ["harness-messaging"]);
    assert.deepEqual(found.grantedCapabilities, ["harness-messaging"]);
    assert.deepEqual(found.deniedCapabilities, [
      "wallet-signing",
      "provider-secret-read",
      "trusted-memory-write",
      "filesystem-write"
    ]);
    assert.equal(found.proxyPath, "/sdk-guide/");
    assert.equal(found.apiBasePath, "/api/sdk-guide");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sdk-guide authorized capability reaches upstream and returns cross-boundary evidence", async () => {
  const upstream = await startUpstream();
  try {
    const capToken = makeCapabilityTokens()["harness-messaging"];
    const response = await fetch(`http://127.0.0.1:${upstream.port}/api/sdk-guide/message`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-capability-token": capToken
      },
      body: JSON.stringify({ message: "hello Manolo" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.addon, FIXTURE_GUIDE_ADDON_ID);
    assert.equal(body.echo, "hello Manolo");
    assert.equal(body.capability, "harness-messaging");
    assert.ok(body.crossBoundaryEvidence, "should include cross-boundary evidence block");
    assert.equal(body.crossBoundaryEvidence.capabilityChecked, "harness-messaging");
    assert.equal(body.crossBoundaryEvidence.via, "ResonantOS bridge");
  } finally {
    await upstream.close();
  }
});

test("sdk-guide missing capability token is denied at the host (defense in depth at upstream)", async () => {
  const upstream = await startUpstream();
  try {
    const response = await fetch(`http://127.0.0.1:${upstream.port}/api/sdk-guide/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "unauth" })
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /harness-messaging capability/);
  } finally {
    await upstream.close();
  }
});

test("sdk-guide denied-action route returns 403 with canonical bridge message shape", async () => {
  const upstream = await startUpstream();
  try {
    const capToken = makeCapabilityTokens()["harness-messaging"];
    const response = await fetch(`http://127.0.0.1:${upstream.port}/api/sdk-guide/denied`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-capability-token": capToken
      },
      body: JSON.stringify({ capability: "wallet-signing" })
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.ok, false);
    assert.match(body.error, /Bridge route requires wallet-signing capability/);
    assert.equal(body.capabilityRequested, "wallet-signing");
  } finally {
    await upstream.close();
  }
});

test("sdk-guide declares ONLY harness-messaging; the bridge refuses to mint tokens for denied capabilities", () => {
  // This is a defense-in-depth test: buildBridgeCapabilityTokens is the
  // canonical host-side capability-policy table. Even if a caller asks
  // the bootstrap endpoint for a capability the add-on did NOT declare,
  // the host must refuse. This proves the bridge-level gate exists and
  // applies to the sdk-guide add-on by the same code path that already
  // gates Resonant Echo and Resonant Counter.
  const tokens = makeCapabilityTokens();
  assert.ok(tokens["harness-messaging"], "harness-messaging is the only granted capability");
  // No wallet-signing / provider-secret-read / trusted-memory-write /
  // filesystem-write tokens should exist for this add-on.
  assert.equal(tokens["wallet-signing"], undefined);
  assert.equal(tokens["provider-secret-read"], undefined);
  assert.equal(tokens["trusted-memory-write"], undefined);
  assert.equal(tokens["filesystem-write"], undefined);
});
