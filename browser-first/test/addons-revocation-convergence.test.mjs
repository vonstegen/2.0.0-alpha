// SDK-DEMO-003R T4 — revocation/enforcement convergence regression.
//
// Baseline c869a928 had TWO independent revocation channels:
//   - POST /addons/workspace/revoke        → registry grant only
//   - POST /addons/workspace/admin-revoke  → upstream /admin/deny only
// A registry-only revoke left a live bearer accepted upstream (200), and an
// upstream-only revoke left the registry/bootstrap projection granted. This
// suite proves the converged contract: the registry grant is the single source
// of truth, the upstream flag is its enforcement projection, and every revoke
// route coordinates BOTH writes so revocation has one coherent outcome.
//
// Acceptance coverage:
//   1. converged revoke success (registry route) → both denied
//   2. converged admin-revoke success            → both denied
//   3. direct upstream access denied after revoke (403, not 401)
//   4. registry projection + bootstrap denied after revoke
//   5. bootstrap cannot resurrect revoked authority
//   6. caller privileged-field injection denied
//   7. partial failure is never reported as success (fail-closed)
//   8. retry / idempotency
//   9. supported regrant behavior

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";
import { createEchoServer } from "../../examples/sdk-demo/echo/server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = "addon.resonant-echo";
const BEARER = "convergence-bearer";
const ADMIN = "convergence-admin";
const NETWORK_GRANT = { capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" };

const echoManifest = JSON.parse(
  await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"),
);

function memoryStore() {
  const data = new Map();
  return { read: async () => data.get("doc") ?? null, write: async (_k, v) => { data.set("doc", v); } };
}

function fn(p) { return () => p; }

async function buildHarness({ adminUrl, adminToken = ADMIN } = {}) {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-003r-t4-convergence-"));
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
    uniqueRuntimeId: () => "convergence-test",
    userRoot,
    timers: { setTimeout, clearTimeout },
    workspaceAddonRegistry: registry,
    workspaceAddonBearerTokens: { [ID]: BEARER },
    workspaceAddonAdminTokens: { [ID]: { upstreamAdminUrl: adminUrl, adminToken } },
  });
  return {
    service,
    registry,
    cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} },
  };
}

const regGranted = (registry) => registry.snapshot().installations[ID].grantedCapabilities.find((g) => g.capability === "network").granted;
const bootToken = async (service) => (await service.executeWorkspaceAddonBootstrap({ addonId: ID })).capabilityTokens?.network?.token ?? null;
const upstreamPing = async (base) => {
  const r = await fetch(`${base}/api/echo/message`, { method: "POST", headers: { authorization: `Bearer ${BEARER}` }, body: "{}" });
  return r.status;
};

test("T4 converged revoke: registry route denies BOTH registry and upstream", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(regGranted(registry), true, "precondition: granted");
    assert.equal(await upstreamPing(base), 200, "precondition: upstream open");

    const result = await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    assert.equal(regGranted(registry), false, "registry grant must be denied after revoke");
    assert.equal(result.installation.grantedCapabilities.find((g) => g.capability === "network").granted, false, "revoke result projects denial");
    assert.equal(await bootToken(service), null, "bootstrap must stop delivering the bearer after revoke");
    assert.equal(await upstreamPing(base), 403, "direct upstream access must be denied (403) after revoke");
  } finally {
    await echo.close();
    cleanup();
  }
});

test("T4 converged admin-revoke: enforcement route denies BOTH upstream and registry", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(regGranted(registry), true, "precondition: granted");

    const result = await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: false });
    assert.equal(echo.getHostGranted(), false, "upstream hostGranted must be false");
    assert.equal(regGranted(registry), false, "registry grant must be denied after admin-revoke");
    assert.equal(result.installation.grantedCapabilities.find((g) => g.capability === "network").granted, false, "admin-revoke result projects denial");
    assert.equal(await bootToken(service), null, "bootstrap must stop delivering the bearer after admin-revoke");
    assert.equal(await upstreamPing(base), 403, "direct upstream access must be denied (403) after admin-revoke");
  } finally {
    await echo.close();
    cleanup();
  }
});

test("T4 supported regrant: admin-revoke { granted: true } converges BOTH layers", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    assert.equal(await upstreamPing(base), 403, "precondition: revoked");

    await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: true });
    assert.equal(regGranted(registry), true, "registry grant must be restored");
    assert.equal(echo.getHostGranted(), true, "upstream hostGranted must be restored");
    assert.equal(await bootToken(service), BEARER, "bootstrap must deliver the bearer again");
    assert.equal(await upstreamPing(base), 200, "direct upstream access must succeed after regrant");
  } finally {
    await echo.close();
    cleanup();
  }
});

test("T4 bootstrap cannot resurrect revoked authority (even after registry removal)", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    // Populate the manifest cache via discovery so bootstrap has a cached
    // manifest it could theoretically re-install from.
    await service.executeAddonsStatus();
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });

    // Revoke leaves the installation present; bootstrap delivers no token.
    assert.equal(await bootToken(service), null, "bootstrap must not deliver a token after revoke");

    // Even if the installation is removed entirely, bootstrap re-installs the
    // cached manifest with grants reset to granted:false (install never grants).
    await registry.remove(ID);
    assert.equal(await bootToken(service), null, "bootstrap re-install must not resurrect the bearer");
    assert.equal(
      registry.snapshot().installations[ID].grantedCapabilities.find((g) => g.capability === "network").granted,
      false,
      "bootstrap re-install must leave the grant denied",
    );
  } finally {
    await echo.close();
    cleanup();
  }
});

test("T4 caller privileged-field injection is denied and mutates nothing", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });

    await assert.rejects(
      service.executeWorkspaceAddonAdminRevoke({ addonId: ID, upstreamAdminUrl: "http://attacker.example/admin/deny", granted: false }),
      (err) => err.code === "permission-denied",
      "caller-injected upstreamAdminUrl must be permission-denied",
    );
    await assert.rejects(
      service.executeWorkspaceAddonAdminRevoke({ addonId: ID, adminToken: "attacker-token", granted: false }),
      (err) => err.code === "permission-denied",
      "caller-injected adminToken must be permission-denied",
    );

    assert.equal(regGranted(registry), true, "injection attempt must not change the registry grant");
    assert.equal(echo.getHostGranted(), true, "injection attempt must not change the upstream flag");
    assert.equal(await upstreamPing(base), 200, "injection attempt must not close upstream access");
  } finally {
    await echo.close();
    cleanup();
  }
});

test("T4 partial upstream failure is reported as runtime-unavailable, never success", async () => {
  // Admin URL points at a port with no listener: the upstream write fails.
  const { service, registry, cleanup } = await buildHarness({ adminUrl: "http://127.0.0.1:1/admin/deny" });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    const before = registry.snapshot().revision;

    await assert.rejects(
      service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] }),
      (err) => err.code === "runtime-unavailable",
      "unreachable upstream must fail with runtime-unavailable (5xx), not success",
    );
    // Fail-closed deny ordering: upstream is attempted FIRST. Since it failed,
    // the registry grant is untouched — no split-state success was reported.
    assert.equal(registry.snapshot().revision, before, "registry must be untouched when the upstream write fails");
    assert.equal(regGranted(registry), true, "registry grant must remain granted on upstream failure");
  } finally {
    cleanup();
  }
});

test("T4 revoke is idempotent and retry-safe", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });

    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    await service.executeWorkspaceAddonRevoke({ addonId: ID, capabilities: ["network"] });
    await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: false });

    assert.equal(regGranted(registry), false, "grant stays denied across repeated revokes");
    assert.equal(echo.getHostGranted(), false, "upstream stays denied across repeated revokes");
    assert.equal(await upstreamPing(base), 403, "upstream stays denied across repeated revokes");
  } finally {
    await echo.close();
    cleanup();
  }
});
