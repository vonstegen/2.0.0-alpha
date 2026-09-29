// SDK-DEMO-003R T7 — workspace add-on endpoint enforcement.
//
// Reconstructs and locks the T7 finding: the workspace add-on upstream mutating
// endpoints were not anchored to the host's authoritative registry state.
// They defaulted to OPEN (`hostGranted = true`) and the grant route mutated the
// registry without converging the upstream enforcement projection (only
// revoke/admin-revoke converged). Consequence:
//   * a freshly started / restarted upstream re-opened the mutating endpoint, so
//     a stale bearer bypassed a revoked registry state;
//   * the grant/revoke directions were asymmetric, so the registry and the
//     endpoint could diverge (grant-after-revoke left the registry granted but
//     the endpoint closed).
//
// T7 correction (NOT the deferred D1 host-mediated proxy): the upstream flag
// fails closed by default, and the grant route converges the upstream flag
// through the same host-owned admin channel as revoke — so the upstream
// enforcement flag is a faithful, restart-safe projection of the registry in
// BOTH directions. The host is still not the *sole* enforcement point (a
// hostile add-on that ignores /admin/deny remains the D1 proxy); that stays
// deferred and is not claimed here.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createWorkspaceAddonCredentialResolver } from "../host/workspace-addon-credentials.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";
import { createEchoServer } from "../../examples/sdk-demo/echo/server.mjs";
import { createCounterServer } from "../../examples/sdk-demo/counter/server.mjs";
import { createSdkGuideServer } from "../../examples/sdk-demo/sdk-guide/server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = "addon.resonant-echo";
const BEARER = "t7-endpoint-bearer";
const ADMIN = "t7-endpoint-admin";
const NETWORK_GRANT = { capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" };

const echoManifest = JSON.parse(await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"));

function memoryStore() {
  const data = new Map();
  return { read: async () => data.get("doc") ?? null, write: async (_k, v) => { data.set("doc", v); } };
}

function fn(p) { return () => p; }

async function buildService(adminUrl) {
  const userRoot = await mkdtemp(join(tmpdir(), "sdk-003r-t7-endpoint-"));
  const registry = await createHarnessRegistry({ store: memoryStore() });
  const service = createAddonDelegationService({
    browserFirstRoot: () => join(userRoot, "browser-first-root"),
    bridgePublicUrl: () => "http://127.0.0.1:47325",
    dashboardTarget: { url: "about:blank", control: "noop" },
    execFileStdout: fn(""),
    expandUserPath: (p) => p,
    firstExistingExecutable: () => null,
    hermesCommand: () => null,
    hermesHome: () => userRoot,
    hermesPythonRuntime: () => null,
    listFilesRecursive: async () => [],
    memoryRoot: () => join(userRoot, "memory"),
    opencodeCommand: () => null,
    opencodeRuntimeDiagnostics: () => ({ installed: false, searchedCommands: [], searchedPaths: [], searchedPathCount: 0, searchedPathOmitted: 0, overrideConfigured: false, overridePath: "", overrideFound: false }),
    platform: "linux",
    redactPathForDiagnostics: () => "",
    readProviderSecrets: async () => ({}),
    repoRoot,
    safeFileSlug: (s) => s,
    fs: { readFile: async () => { throw new Error("stub: not used"); } },
    isolationDependency: { resolve: false },
    spawnProcess: () => { throw new Error("stub: not used"); },
    socketOpen: async () => false,
    uniqueRuntimeId: () => "t7-endpoint",
    userRoot,
    timers: { setTimeout, clearTimeout },
    workspaceAddonRegistry: registry,
    workspaceAddonCredentialResolver: createWorkspaceAddonCredentialResolver({
      credentials: { [ID]: { bearer: BEARER, adminToken: ADMIN, adminUrl } },
    }),
  });
  return { service, registry, cleanup: async () => { try { await rm(userRoot, { recursive: true, force: true }); } catch {} } };
}

const regGranted = (registry) =>
  registry.snapshot().installations[ID].grantedCapabilities.find((g) => g.capability === "network").granted;

const ping = async (base, token = BEARER) => {
  const r = await fetch(`${base}/api/echo/message`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: "{}",
  });
  return r.status;
};

test("T7 fresh upstreams fail closed: direct loopback access cannot mutate without a host grant", async () => {
  const factories = [
    ["echo", createEchoServer, "/api/echo/message"],
    ["counter", createCounterServer, "/api/counter/increment"],
    ["sdk-guide", createSdkGuideServer, "/api/guide/ping"],
  ];
  for (const [name, factory, pathname] of factories) {
    const server = factory({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
    const started = await server.start();
    const res = await fetch(`http://127.0.0.1:${started.port}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${BEARER}` },
      body: "{}",
    });
    assert.equal(res.status, 403, `${name}: fresh upstream with no host grant must fail closed (403)`);
    assert.equal(server.getHostGranted(), false, `${name}: fresh upstream must default hostGranted=false`);
    await server.close();
  }
});

test("T7 authorized happy path: grant opens the endpoint", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildService(`${base}/admin/deny`);
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    assert.equal(await ping(base), 403, "precondition: fail closed before grant");
    const result = await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(regGranted(registry), true, "registry grant must be true");
    assert.equal(result.hostGranted, true, "grant must report upstream hostGranted=true");
    assert.equal(echo.getHostGranted(), true, "grant must open the upstream flag");
    assert.equal(await ping(base), 200, "authorized call must succeed after grant");
  } finally {
    await echo.close();
    await cleanup();
  }
});

test("T7 revoked authority remains denied (converged revoke)", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildService(`${base}/admin/deny`);
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(await ping(base), 200, "precondition: open after grant");
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    assert.equal(regGranted(registry), false, "registry grant must be denied after revoke");
    assert.equal(await ping(base), 403, "valid bearer + revoked policy must be 403");
  } finally {
    await echo.close();
    await cleanup();
  }
});

test("T7 stale bearer after revoke is denied even after an upstream restart", async () => {
  let echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  let started = await echo.start();
  const { service, registry, cleanup } = await buildService(`http://127.0.0.1:${started.port}/admin/deny`);
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    assert.equal(regGranted(registry), false, "registry must be denied");
    assert.equal(await ping(`http://127.0.0.1:${started.port}`), 403, "stale bearer denied before restart");

    await echo.close();
    echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
    started = await echo.start();
    assert.equal(echo.getHostGranted(), false, "restarted upstream must re-init closed");
    assert.equal(await ping(`http://127.0.0.1:${started.port}`), 403, "stale bearer must remain 403 after restart");
  } finally {
    await echo.close();
    await cleanup();
  }
});

test("T7 regrant after revoke re-opens the endpoint (symmetric convergence)", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildService(`${base}/admin/deny`);
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    assert.equal(await ping(base), 403, "precondition: revoked");

    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(regGranted(registry), true, "registry grant must be restored");
    assert.equal(echo.getHostGranted(), true, "regrant must re-open the upstream flag");
    assert.equal(await ping(base), 200, "regranted call must succeed");
  } finally {
    await echo.close();
    await cleanup();
  }
});

test("T7 grant fails closed (5xx) when the upstream cannot be opened", async () => {
  const { service, registry, cleanup } = await buildService("http://127.0.0.1:1/admin/deny");
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await assert.rejects(
      service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] }),
      (err) => err.code === "runtime-unavailable",
      "unreachable upstream must fail grant with runtime-unavailable (5xx)",
    );
    assert.equal(regGranted(registry), true, "registry grant is committed (source of truth) on allow-ordering failure");
  } finally {
    await cleanup();
  }
});

test("T7 grant rejects caller-forged credential/endpoint fields", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildService(`${base}/admin/deny`);
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await assert.rejects(
      service.executeWorkspaceAddonGrant({
        addonId: ID,
        grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop", upstreamAdminUrl: "http://attacker.example/admin/deny" }],
      }),
      (err) => err.code === "permission-denied",
      "caller-forged upstreamAdminUrl in a grant entry must be permission-denied",
    );
    assert.equal(regGranted(registry), false, "forged grant must not change the registry grant");
    assert.equal(await ping(base), 403, "forged grant must not open the endpoint");
  } finally {
    await echo.close();
    await cleanup();
  }
});

test("T7 discovery rejects bind-any (0.0.0.0) service.entrypoint", async () => {
  const { discoverWorkspaceAddonManifests } = await import("../host/workspace-addon-discovery.mjs");
  const tmpRoot = await mkdtemp(join(tmpdir(), "sdk-003r-t7-discovery-"));
  try {
    const good = {
      id: "addon.t7-good", name: "t7 good", version: "0.1.0", author: "x", classification: { category: "tool" },
      sdkVersion: "0.1.0", description: "ok", runtimeType: "local-service",
      surfaces: [{ id: "x", type: "panel", label: "X", description: "x" }],
      requestedCapabilities: [],
      provenance: { tier: "sideloaded-unverified", verificationState: "unverified", signed: false },
      runtimeIsolation: { boundary: "host-mediated-service", supportsDegradedMode: true, requiresReviewedGrant: true },
      grantPresets: [],
      providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
      archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
      health: { strategy: "http-json", endpoint: "http://127.0.0.1:65534/health" },
      installHooks: {},
      service: { protocol: "http-json", entrypoint: "http://127.0.0.1:65534" },
      compatibility: { shellVersion: "^0.1.0", platforms: ["linux"] },
    };
    const badBindAny = { ...good, id: "addon.t7-bad-bindany", service: { ...good.service, entrypoint: "http://0.0.0.0:65534" } };
    await mkdir(join(tmpRoot, "good"), { recursive: true });
    await mkdir(join(tmpRoot, "bad-bindany"), { recursive: true });
    await writeFile(join(tmpRoot, "good", "addon.json"), JSON.stringify(good));
    await writeFile(join(tmpRoot, "bad-bindany", "addon.json"), JSON.stringify(badBindAny));

    const result = await discoverWorkspaceAddonManifests({
      repoRoot: tmpRoot,
      discoveryRelativePath: ".",
      probeAvailability: async () => false,
    });
    const ids = result.manifests.map((m) => m.id);
    assert.ok(ids.includes("addon.t7-good"), "loopback entrypoint must be discovered");
    assert.ok(!ids.includes("addon.t7-bad-bindany"), "0.0.0.0 (bind-any) entrypoint must be rejected");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
