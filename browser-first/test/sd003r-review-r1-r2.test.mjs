// SDK-DEMO-003R review — R1/R2 hardening regression (2026-09-29 review).
//
// R1: install trusted a caller-supplied manifest, derived the admin credential
//     destination from it, and used a loopback PREFIX check that accepted
//     hostile hostnames (`127.0.0.1.evil.com`, `127.evil.com`). A forged
//     same-ID manifest could therefore redirect the host-owned admin credential.
// R2: admin-revoke `{ addonId }` without an explicit boolean granted everything
//     (`granted !== false`).
//
// Acceptance coverage:
//   1. hostile loopback-prefix hostnames + userinfo/misleading URLs rejected
//   2. valid supported loopback forms accepted (127/8, ::1, localhost)
//   3. async boundary re-resolves hostnames and requires loopback answers
//   4. public install rejects a caller manifest (swap) and mutates nothing
//   5. trusted install validates loopback entrypoint; same-ID override blocked
//   6. admin enforcement refuses redirects and forwards no credential
//   7. missing/non-boolean intent is deterministic 4xx with no mutation
//   8. explicit boolean true/false semantics (revoke/regrant)
//   9. unknown identity is permission-denied
//  10. admin credential is never disclosed

import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  isLoopbackAddress,
  parseLoopbackHttpOrigin,
  resolveLoopbackHttpOrigin,
} from "../host/loopback-url.mjs";
import {
  createWorkspaceAddonCredentialResolver,
  deriveUpstreamAdminUrl,
} from "../host/workspace-addon-credentials.mjs";
import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";
import { createEchoServer } from "../../examples/sdk-demo/echo/server.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = "addon.resonant-echo";
const BEARER = "review-r1r2-bearer";
const ADMIN = "review-r1r2-admin";
const NETWORK_GRANT = { capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" };

const echoManifest = JSON.parse(
  await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"),
);

function memoryStore() {
  const data = new Map();
  return { read: async () => data.get("doc") ?? null, write: async (_k, v) => { data.set("doc", v); } };
}

function fn(p) { return () => p; }

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function buildHarness({ adminUrl, adminToken = ADMIN, bearer = BEARER } = {}) {
  const userRoot = mkdtempSync(join(tmpdir(), "sdk-003r-review-r1r2-"));
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
    uniqueRuntimeId: () => "review-r1r2",
    userRoot,
    timers: { setTimeout, clearTimeout },
    workspaceAddonRegistry: registry,
    workspaceAddonCredentialResolver: createWorkspaceAddonCredentialResolver({
      credentials: { [ID]: { bearer, adminToken, adminUrl } },
    }),
  });
  return { service, registry, cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} } };
}

const granted = (registry) => registry.snapshot().installations[ID].grantedCapabilities.find((g) => g.capability === "network").granted;

// --- R1: loopback validation ---

test("R1: hostile loopback-prefix hostnames and userinfo/misleading URLs are rejected", () => {
  const hostile = [
    "http://127.0.0.1.evil.com:8080/admin/deny",
    "http://127.evil.com:8080/admin/deny",
    "http://127.attacker/admin/deny",
    "http://127.0.0.1.attacker.io/",
  ];
  for (const url of hostile) {
    assert.equal(parseLoopbackHttpOrigin(url), null, `${url} must be rejected`);
    assert.throws(() => deriveUpstreamAdminUrl(url, "addon.a"), (e) => e.code === "credential-unavailable", `${url} must not be derivable`);
  }
  assert.equal(parseLoopbackHttpOrigin("http://user:pass@127.0.0.1:47321/admin/deny"), null, "userinfo URL rejected");
  assert.equal(parseLoopbackHttpOrigin("http://127.0.0.1@evil.com/admin/deny"), null, "misleading userinfo-hostname URL rejected");
  assert.equal(parseLoopbackHttpOrigin("http://0.0.0.0:47321/admin/deny"), null, "bind-any rejected");
  assert.equal(parseLoopbackHttpOrigin("http://127.0.0.999/admin/deny"), null, "out-of-range octet rejected");
});

test("R1: valid supported loopback forms are accepted", () => {
  for (const url of [
    "http://127.0.0.1:47321/admin/deny",
    "http://127.0.0.2:47321/admin/deny",
    "http://127.8.9.10:1",
    "http://[::1]:1",
    "http://localhost:1",
  ]) {
    assert.ok(parseLoopbackHttpOrigin(url), `${url} must be accepted`);
  }
  assert.equal(deriveUpstreamAdminUrl("http://127.0.0.1:47321", "addon.a"), "http://127.0.0.1:47321/admin/deny");
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("93.184.216.34"), false);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), false);
});

test("R1: async boundary re-resolves hostnames and requires loopback answers", async () => {
  const good = await resolveLoopbackHttpOrigin("http://localhost:47321/admin/deny");
  assert.ok(good, "localhost resolving loopback is accepted");
  const bad = await resolveLoopbackHttpOrigin("http://localhost:47321/admin/deny", {
    lookup: async () => [{ address: "93.184.216.34" }],
  });
  assert.equal(bad, null, "non-loopback resolution is rejected");
  const dnsFail = await resolveLoopbackHttpOrigin("http://localhost:47321/admin/deny", {
    lookup: async () => { throw new Error("nxdomain"); },
  });
  assert.equal(dnsFail, null, "DNS failure is rejected (fail closed)");
});

// --- R1: install authority ---

test("R1: public install rejects a caller-supplied manifest (swap) and mutates nothing", async () => {
  const { service, registry, cleanup } = await buildHarness({ adminUrl: "http://127.0.0.1:9/admin/deny" });
  try {
    await assert.rejects(
      service.executeWorkspaceAddonInstall({ manifest: echoManifest }),
      (e) => e.code === "invalid-event",
      "caller manifest must be rejected",
    );
    assert.equal(Object.keys(registry.snapshot().installations).length, 0, "no installation created");

    const forged = { ...echoManifest, service: { ...echoManifest.service, entrypoint: "http://127.0.0.1.evil.com:8080" } };
    await assert.rejects(
      service.executeWorkspaceAddonInstall({ manifest: forged }),
      (e) => e.code === "invalid-event",
      "forged same-ID manifest must be rejected",
    );
    assert.equal(Object.keys(registry.snapshot().installations).length, 0, "forged manifest not installed");
  } finally { cleanup(); }
});

test("R1: trusted install validates loopback entrypoint; hostile entrypoint cannot seed the admin mapping", async () => {
  const { service, registry, cleanup } = await buildHarness({ adminUrl: "http://127.0.0.1:9/admin/deny" });
  try {
    const forged = { ...echoManifest, service: { ...echoManifest.service, entrypoint: "http://127.evil.com:1" } };
    await assert.rejects(
      service.installWorkspaceAddonManifest(forged),
      (e) => e.code === "invalid-event",
      "trusted install must refuse a non-loopback entrypoint",
    );
    assert.equal(Object.keys(registry.snapshot().installations).length, 0, "forged trusted manifest not installed");

    await service.installWorkspaceAddonManifest(echoManifest);
    assert.ok(registry.snapshot().installations[ID], "canonical manifest installs");
  } finally { cleanup(); }
});

test("R1: admin enforcement refuses redirects and forwards no credential", async () => {
  let attackerHits = 0;
  const attacker = http.createServer((_req, res) => { attackerHits += 1; res.end("stolen"); });
  const attackerPort = await listen(attacker);

  let adminHits = 0;
  const admin = http.createServer((req, res) => {
    adminHits += 1;
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let grantedFlag = false;
      try { grantedFlag = JSON.parse(raw || "{}").granted === false; } catch { /* default */ }
      if (grantedFlag) {
        // The deny direction redirects; the admin credential must not follow.
        res.writeHead(302, { location: `http://127.0.0.1:${attackerPort}/stolen` });
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ hostGranted: true }));
      }
    });
  });
  const adminPort = await listen(admin);

  const { service, registry, cleanup } = await buildHarness({ adminUrl: `http://127.0.0.1:${adminPort}/admin/deny` });
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(granted(registry), true, "precondition: granted");

    await assert.rejects(
      service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: false }),
      (e) => e.code === "runtime-unavailable",
      "redirect from the admin endpoint must fail the enforcement",
    );
    assert.equal(adminHits, 2, "the loopback admin endpoint received the grant and the redirecting revoke");
    assert.equal(attackerHits, 0, "the redirect target received NO credential (redirect refused)");
  } finally {
    await closeServer(attacker);
    await closeServer(admin);
    cleanup();
  }
});

test("R1: pinned hostile adminUrl is rejected before any send (no credential disclosure)", () => {
  const resolver = createWorkspaceAddonCredentialResolver({
    credentials: { [ID]: { adminToken: "SECRET-ADMIN", adminUrl: "http://127.0.0.1.evil.com/admin/deny" } },
  });
  assert.throws(
    () => resolver.resolveWorkspaceAddonCredential({ addonId: ID, purpose: "admin" }),
    (e) => e.code === "credential-unavailable",
    "hostile pinned adminUrl must not resolve",
  );
});

// --- R2: explicit boolean intent ---

test("R2: admin-revoke without an explicit boolean is deterministic 4xx and mutates nothing", async () => {
  const { service, registry, cleanup } = await buildHarness({ adminUrl: "http://127.0.0.1:9/admin/deny" });
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    assert.equal(granted(registry), false, "precondition: denied");

    for (const bad of [undefined, null, "false", "true", 0, 1, {}, []]) {
      await assert.rejects(
        service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: bad }),
        (e) => e.code === "invalid-event",
        `granted=${JSON.stringify(bad)} must be invalid-event`,
      );
      assert.equal(granted(registry), false, `granted=${JSON.stringify(bad)} must not mutate the registry`);
    }

    // Missing field entirely.
    await assert.rejects(
      service.executeWorkspaceAddonAdminRevoke({ addonId: ID }),
      (e) => e.code === "invalid-event",
      "missing granted must be invalid-event",
    );
    assert.equal(granted(registry), false, "missing granted must not grant");
  } finally { cleanup(); }
});

test("R2: explicit boolean true/false round-trip revoke/regrant semantics", async () => {
  const echo = createEchoServer({ port: 0, bearerToken: BEARER, adminToken: ADMIN });
  const started = await echo.start();
  const base = `http://127.0.0.1:${started.port}`;
  const { service, registry, cleanup } = await buildHarness({ adminUrl: `${base}/admin/deny` });
  try {
    await service.installWorkspaceAddonManifest(echoManifest);
    await service.executeWorkspaceAddonGrant({ addonId: ID, grants: [NETWORK_GRANT] });
    assert.equal(granted(registry), true, "grant opens the surface");

    await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: false });
    assert.equal(granted(registry), false, "granted:false denies the surface");
    assert.equal(echo.getHostGranted(), false, "upstream hostGranted converges to false");

    await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: true });
    assert.equal(granted(registry), true, "granted:true regrants the surface");
    assert.equal(echo.getHostGranted(), true, "upstream hostGranted converges to true");
  } finally {
    await echo.close();
    cleanup();
  }
});

test("R2: unknown identity is permission-denied", async () => {
  const { service, cleanup } = await buildHarness({ adminUrl: "http://127.0.0.1:9/admin/deny" });
  try {
    await assert.rejects(
      service.executeWorkspaceAddonAdminRevoke({ addonId: "addon.unknown", granted: false }),
      (e) => e.code === "permission-denied",
    );
  } finally { cleanup(); }
});

test("R2: admin credential is never disclosed to the caller", async () => {
  const { service, cleanup } = await buildHarness({ adminToken: "SECRET-ADMIN-TOKEN-123", adminUrl: "http://127.0.0.1:9/admin/deny" });
  try {
    const err = await service.executeWorkspaceAddonAdminRevoke({ addonId: ID, granted: false }).catch((e) => e);
    const text = JSON.stringify(err);
    assert.ok(!text.includes("SECRET-ADMIN-TOKEN-123"), "error must not leak the admin credential");
  } finally { cleanup(); }
});
