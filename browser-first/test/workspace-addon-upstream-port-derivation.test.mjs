// Verify buildWorkspaceAddonRegistryEntry derives `upstreamPort`
// correctly from the manifest's `runtime.port` AND the
// `upstreamPortEnvVar` (when set in process.env).
//
// Background: SDK-DEMO-002-CLEANUP caught a production bug where the
// host only read `upstreamPort` from `upstreamPortEnvVar`, ignoring
// `runtime.port`. A manifest declaring `runtime.port: 47321` but no
// env var surfaced `upstreamPort: null` in /addons/status, and the
// renderer fell back to the non-cross-origin "src" path. The fix in
// commit df865c8 made `runtime.port` the default. These tests pin the
// corrected derivation so it cannot regress.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";

const ROOT_PARENT = path.join(os.tmpdir(), "sdk-demo-002-port-");

function makeService(browserFirstRoot) {
  return createAddonDelegationService({
    browserFirstRoot: () => browserFirstRoot,
    repoRoot: path.join(browserFirstRoot, "Repo"),
    memoryRoot: () => path.join(browserFirstRoot, "Memory"),
    userRoot: () => path.join(browserFirstRoot, "User"),
    socketOpen: async () => false,
    hermesCommand: () => null,
    opencodeCommand: () => null
  });
}

function baseManifest(overrides = {}) {
  return {
    id: "addon.port-derivation-fixture",
    name: "Port Derivation Fixture",
    version: "0.0.0",
    mode: "workspace-addon",
    trust: "sdk-reference",
    boundary: "Throwaway fixture for upstreamPort derivation.",
    capabilities: ["harness-messaging"],
    contributions: {
      workspace: {
        type: "iframe",
        proxyPath: "/port-derivation/",
        apiBasePath: "/api/port-derivation",
        iframeMode: "src",
        entry: "index.html"
      }
    },
    messaging: {
      channel: "addon.port-derivation-fixture",
      requestCapability: "harness-messaging",
      routes: [
        { method: "POST", path: "/api/port-derivation/message", requiredCapability: "harness-messaging" }
      ]
    },
    ...overrides
  };
}

test("buildWorkspaceAddonRegistryEntry falls back to runtime.port when upstreamPortEnvVar is unset", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  try {
    const service = makeService(root);
    const manifest = baseManifest({
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/port-derivation/",
          apiBasePath: "/api/port-derivation",
          iframeMode: "src",
          entry: "index.html",
          runtime: { command: "node", args: ["server.mjs"], port: 47321 }
        }
      }
    });
    const entry = service.buildWorkspaceAddonRegistryEntry({
      manifest,
      bridgePublicUrl: "http://127.0.0.1:0"
    });
    assert.equal(entry.upstreamPort, 47321, "runtime.port must surface as upstreamPort when no env var is declared");
    assert.equal(entry.upstreamPortEnvVar, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildWorkspaceAddonRegistryEntry lets upstreamPortEnvVar override runtime.port", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  const ENV_VAR = "RESONANTOS_TEST_PORT_DERIVATION_PORT";
  const previousValue = process.env[ENV_VAR];
  process.env[ENV_VAR] = "59999";
  try {
    const service = makeService(root);
    const manifest = baseManifest({
      contributions: {
        workspace: {
          type: "iframe",
          proxyPath: "/port-derivation/",
          apiBasePath: "/api/port-derivation",
          iframeMode: "src",
          entry: "index.html",
          upstreamPortEnvVar: ENV_VAR,
          // runtime.port differs from the env value; env wins.
          runtime: { command: "node", args: ["server.mjs"], port: 47321 }
        }
      }
    });
    const entry = service.buildWorkspaceAddonRegistryEntry({
      manifest,
      bridgePublicUrl: "http://127.0.0.1:0"
    });
    assert.equal(entry.upstreamPortEnvVar, ENV_VAR);
    assert.equal(entry.upstreamPort, 59999, "env var must override runtime.port when both are declared");
  } finally {
    if (previousValue === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previousValue;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("buildWorkspaceAddonRegistryEntry surfaces null upstreamPort when neither env var nor runtime.port are declared", async () => {
  const root = await mkdtemp(ROOT_PARENT);
  try {
    const service = makeService(root);
    const manifest = baseManifest();
    const entry = service.buildWorkspaceAddonRegistryEntry({
      manifest,
      bridgePublicUrl: "http://127.0.0.1:0"
    });
    assert.equal(entry.upstreamPortEnvVar, null);
    assert.equal(entry.upstreamPort, null, "no env var + no runtime.port must surface as null so the renderer falls back to the non-cross-origin path");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
