import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLoopbackHealthProbe,
  discoverWorkspaceAddonManifests,
} from "../host/workspace-addon-discovery.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function dirent(name) {
  return { name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
}

function fsReaddirFromMap(map) {
  return async (target) => {
    if (target in map) return map[target];
    const error = new Error(`ENOENT: ${target}`);
    error.code = "ENOENT";
    throw error;
  };
}

function fsReadFileFromMap(map) {
  return async (target) => {
    if (target in map) return map[target];
    const error = new Error(`ENOENT: ${target}`);
    error.code = "ENOENT";
    throw error;
  };
}

function fsStatFromMap(map) {
  return async (target) => {
    if (target in map) return map[target];
    const error = new Error(`ENOENT: ${target}`);
    error.code = "ENOENT";
    throw error;
  };
}

const dirStat = { isDirectory: () => true, isFile: () => false };

const echoManifest = JSON.stringify({
  id: "addon.resonant-echo",
  name: "Resonant Echo",
  version: "0.1.0",
  author: "ResonantOS",
  category: "tool",
  sdkVersion: "0.1.0",
  description: "Deterministic local echo add-on that proves the SDK round-trip.",
  runtimeType: "local-service",
  surfaces: [{ id: "resonant-echo-workspace", type: "panel", label: "Resonant Echo", description: "echo" }],
  requestedCapabilities: [{ capability: "network", scope: "self", revocationBehavior: "hard-stop", granted: false }],
  provenance: { tier: "sideloaded-unverified", verificationState: "unverified", signed: false },
  runtimeIsolation: { boundary: "host-mediated-service", supportsDegradedMode: true, requiresReviewedGrant: true },
  grantPresets: [
    {
      id: "resonant-echo-local",
      label: "Local echo",
      description: "Grant the local echo service access to its own loopback endpoint.",
      grants: [{ capability: "network", scope: "self", revocationBehavior: "hard-stop", granted: true }],
    },
  ],
  health: { strategy: "http-json", endpoint: "http://127.0.0.1:47321/health" },
  service: { protocol: "http-json", entrypoint: "http://127.0.0.1:47321" },
  compatibility: { shellVersion: "^0.1.0", platforms: ["macOS", "linux", "windows"] },
});

const nonLoopbackManifest = JSON.stringify({
  ...JSON.parse(echoManifest),
  id: "addon.bad-host",
  service: { protocol: "http-json", entrypoint: "https://example.com/echo" },
  providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
  archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
  installHooks: {},
});

const malformedManifest = JSON.stringify({
  id: "addon.broken",
  runtimeType: "local-service",
  service: { protocol: "http-json", entrypoint: "http://127.0.0.1:47322" },
  // missing required fields: name, version, author, category, description, surfaces
});

test("discoverWorkspaceAddonManifests returns the live Echo manifest against the real repo", async () => {
  const result = await discoverWorkspaceAddonManifests({
    repoRoot,
    probeAvailability: async () => true,
  });
  assert.deepEqual(result.errors, []);
  const echo = result.manifests.find((manifest) => manifest.id === "addon.resonant-echo");
  assert.ok(echo, "expected Echo to be discovered");
  assert.equal(echo.entrypoint, "http://127.0.0.1:47321");
  assert.equal(echo.origin, "http://127.0.0.1:47321");
  assert.equal(echo.runtimeType, "local-service");
  assert.equal(echo.available, true);
  assert.equal(echo.requestedCapabilities[0].capability, "network");
  assert.equal(echo.requestedCapabilities[0].granted, false);
  assert.equal(echo.grantPresets[0].id, "resonant-echo-local");
  assert.equal(echo.grantPresets[0].grants[0].granted, true);
});

test("discoverWorkspaceAddonManifests tolerates a missing examples/sdk-demo folder", async () => {
  const result = await discoverWorkspaceAddonManifests({
    repoRoot: "/definitely/not/a/repo",
    probeAvailability: async () => true,
  });
  assert.deepEqual(result.manifests, []);
  assert.deepEqual(result.errors, []);
});

test("discoverWorkspaceAddonManifests rejects non-loopback service.entrypoint", async () => {
  const entries = [dirent("bad-host")];
  const statMap = {
    [path.join(repoRoot, "examples/sdk-demo")]: dirStat,
  };
  const dirMap = {
    [path.join(repoRoot, "examples/sdk-demo")]: entries,
  };
  const fileMap = {
    [path.join(repoRoot, "examples/sdk-demo/bad-host/addon.json")]: nonLoopbackManifest,
  };
  const result = await discoverWorkspaceAddonManifests({
    repoRoot,
    probeAvailability: async () => true,
    fsReaddir: fsReaddirFromMap(dirMap),
    fsReadFile: fsReadFileFromMap(fileMap),
    fsStat: fsStatFromMap(statMap),
  });
  assert.equal(result.manifests.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "manifest-entrypoint-not-loopback");
});

test("discoverWorkspaceAddonManifests surfaces validation errors without exposing them as manifests", async () => {
  const entries = [dirent("broken")];
  const statMap = {
    [path.join(repoRoot, "examples/sdk-demo")]: dirStat,
  };
  const dirMap = {
    [path.join(repoRoot, "examples/sdk-demo")]: entries,
  };
  const fileMap = {
    [path.join(repoRoot, "examples/sdk-demo/broken/addon.json")]: malformedManifest,
  };
  const result = await discoverWorkspaceAddonManifests({
    repoRoot,
    probeAvailability: async () => true,
    fsReaddir: fsReaddirFromMap(dirMap),
    fsReadFile: fsReadFileFromMap(fileMap),
    fsStat: fsStatFromMap(statMap),
  });
  assert.equal(result.manifests.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].code, "manifest-validation-failed");
});

test("discoverWorkspaceAddonManifests reports available: false when the probe returns false", async () => {
  const result = await discoverWorkspaceAddonManifests({
    repoRoot,
    probeAvailability: async () => false,
  });
  const echo = result.manifests.find((manifest) => manifest.id === "addon.resonant-echo");
  assert.ok(echo);
  assert.equal(echo.available, false);
});

test("discoverWorkspaceAddonManifests never invokes the probe with a non-loopback URL", async () => {
  const probeCalls = [];
  const probe = async (manifestPath) => {
    probeCalls.push(manifestPath);
    return true;
  };
  await discoverWorkspaceAddonManifests({
    repoRoot,
    probeAvailability: probe,
  });
  assert.ok(probeCalls.length >= 1);
  // Every probed path must be under the repoRoot examples/sdk-demo folder.
  for (const probePath of probeCalls) {
    assert.ok(probePath.startsWith(path.join(repoRoot, "examples/sdk-demo")), `unexpected probe path: ${probePath}`);
  }
});

test("createLoopbackHealthProbe treats non-2xx responses as unavailable", async () => {
  const fakeFetch = async () => ({ ok: false, status: 500 });
  const probe = createLoopbackHealthProbe({ fetchImpl: fakeFetch });
  assert.equal(await probe(`${repoRoot}/examples/sdk-demo/echo/addon.json`), false);
});

test("createLoopbackHealthProbe treats network errors as unavailable", async () => {
  const fakeFetch = async () => {
    throw new TypeError("ECONNREFUSED");
  };
  const probe = createLoopbackHealthProbe({ fetchImpl: fakeFetch });
  assert.equal(await probe(`${repoRoot}/examples/sdk-demo/echo/addon.json`), false);
});

test("createLoopbackHealthProbe treats 2xx responses as available", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200 });
  const probe = createLoopbackHealthProbe({ fetchImpl: fakeFetch });
  assert.equal(await probe(`${repoRoot}/examples/sdk-demo/echo/addon.json`), true);
});

test("createLoopbackHealthProbe aborts the request when the timeout fires", async () => {
  let capturedSignal = null;
  const fakeFetch = async (_url, options) => {
    capturedSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  const probe = createLoopbackHealthProbe({ fetchImpl: fakeFetch, timeoutMs: 5 });
  const result = await probe(`${repoRoot}/examples/sdk-demo/echo/addon.json`);
  assert.equal(result, false);
  assert.ok(capturedSignal, "probe should pass an AbortSignal to fetch");
});