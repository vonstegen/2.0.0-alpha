// SDK-DEMO-003R T6 — generic host-owned credential provisioning.
//
// Proves the typed resolver contract and its non-disclosure boundaries:
//   - distinct scoped credentials per add-on;
//   - bearer never carries admin material and vice versa;
//   - unknown identity/purpose and missing credentials fail closed;
//   - the host-owned admin endpoint is loopback-only;
//   - caller-supplied credential fields are ignored (host-only resolution);
//   - error messages never leak secret material;
//   - the provisioning document is normalized (no invented material);
//   - bootstrap delivers only the intentionally-scoped bearer (never admin);
//   - status/discovery projects no credential material.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";

import {
  createWorkspaceAddonCredentialResolver,
  deriveUpstreamAdminUrl,
  loadWorkspaceAddonCredentials,
  normalizeWorkspaceAddonCredentials,
  parseWorkspaceAddonCredentials,
} from "../host/workspace-addon-credentials.mjs";
import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { createHarnessRegistry } from "../host/harness-registry.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const echoManifest = JSON.parse(await readFile(join(repoRoot, "examples/sdk-demo/echo/addon.json"), "utf8"));

function memoryStore() {
  const data = new Map();
  return { read: async () => data.get("doc") ?? null, write: async (_k, v) => { data.set("doc", v); } };
}

async function buildService({ credentials = {} } = {}) {
  const userRoot = mkdtempSync(join(tmpdir(), "t6-credentials-"));
  const registry = await createHarnessRegistry({ store: memoryStore() });
  const resolver = createWorkspaceAddonCredentialResolver({ credentials });
  const fn = (p) => () => p;
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
    uniqueRuntimeId: () => "t6-credentials",
    userRoot,
    timers: { setTimeout, clearTimeout },
    workspaceAddonRegistry: registry,
    workspaceAddonCredentialResolver: resolver,
  });
  return { service, registry, resolver, cleanup: () => { try { rmSync(userRoot, { recursive: true, force: true }); } catch {} } };
}

test("T6 resolver: two add-ons resolve distinct scoped bearer credentials", () => {
  const resolver = createWorkspaceAddonCredentialResolver({
    credentials: {
      "addon.a": { bearer: "a-bearer", adminToken: "a-admin" },
      "addon.b": { bearer: "b-bearer", adminToken: "b-admin" },
    },
  });
  const a = resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "bearer" });
  const b = resolver.resolveWorkspaceAddonCredential({ addonId: "addon.b", purpose: "bearer" });
  assert.equal(a.token, "a-bearer");
  assert.equal(b.token, "b-bearer");
  assert.notEqual(a.token, b.token, "distinct add-ons must resolve distinct scoped credentials");
});

test("T6 resolver: bearer result carries no admin material, and admin result carries no bearer", () => {
  const resolver = createWorkspaceAddonCredentialResolver({
    credentials: { "addon.a": { bearer: "a-bearer", adminToken: "a-admin" } },
  });
  const bearer = resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "bearer" });
  assert.deepEqual(Object.keys(bearer).sort(), ["addonId", "purpose", "token"]);
  assert.ok(!JSON.stringify(bearer).includes("a-admin"), "bearer resolution must not expose the admin credential");

  const admin = resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "admin", manifestEntrypoint: "http://127.0.0.1:47321" });
  assert.equal(admin.adminToken, "a-admin");
  assert.equal(admin.upstreamAdminUrl, "http://127.0.0.1:47321/admin/deny");
  assert.ok(!JSON.stringify(admin).includes("a-bearer"), "admin resolution must not expose the bearer");
});

test("T6 resolver: unknown add-on and unknown purpose fail closed", () => {
  const resolver = createWorkspaceAddonCredentialResolver({ credentials: { "addon.a": { bearer: "x" } } });
  assert.throws(
    () => resolver.resolveWorkspaceAddonCredential({ addonId: "addon.unknown", purpose: "bearer" }),
    (e) => e.code === "credential-unavailable",
  );
  assert.throws(
    () => resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "superuser" }),
    (e) => e.code === "invalid-event",
  );
});

test("T6 resolver: missing admin credential fails closed", () => {
  const resolver = createWorkspaceAddonCredentialResolver({ credentials: { "addon.a": { bearer: "x" } } });
  assert.throws(
    () => resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "admin", manifestEntrypoint: "http://127.0.0.1:47321" }),
    (e) => e.code === "credential-unavailable",
  );
});

test("T6 resolver: host-owned admin endpoint must be loopback http(s)", () => {
  const resolver = createWorkspaceAddonCredentialResolver({
    credentials: { "addon.a": { adminToken: "t", adminUrl: "http://attacker.example/admin/deny" } },
  });
  assert.throws(
    () => resolver.resolveWorkspaceAddonCredential({ addonId: "addon.a", purpose: "admin" }),
    (e) => e.code === "credential-unavailable",
  );
});

test("T6 resolver: caller-supplied credential fields are ignored (host-only resolution)", () => {
  const resolver = createWorkspaceAddonCredentialResolver({ credentials: { "addon.a": { bearer: "host-bearer" } } });
  const result = resolver.resolveWorkspaceAddonCredential({
    addonId: "addon.a",
    purpose: "bearer",
    token: "caller-token",
    bearer: "caller-bearer",
    adminToken: "caller-admin",
    upstreamAdminUrl: "http://attacker.example/admin/deny",
  });
  assert.equal(result.token, "host-bearer", "host-provisioned material must win over caller-supplied fields");
});

test("T6 resolver: errors redact secret material", () => {
  const resolver = createWorkspaceAddonCredentialResolver({
    credentials: { "addon.a": { bearer: "SECRET-bearer-123", adminToken: "SECRET-admin-456" } },
  });
  let err;
  try { resolver.resolveWorkspaceAddonCredential({ addonId: "addon.unknown", purpose: "bearer" }); } catch (e) { err = e; }
  assert.ok(err, "unknown add-on must throw");
  assert.ok(!String(err.message).includes("SECRET"), "error message must not leak the secret");
  assert.ok(!String(err.message).includes("123"), "error message must not leak the secret");
});

test("T6 document: normalization drops non-string and empty material", () => {
  const table = normalizeWorkspaceAddonCredentials({
    "addon.a": { bearer: "b", adminToken: "a", adminUrl: "" },
    "addon.b": { bearer: 123, adminToken: null, adminUrl: {} },
    "addon.empty": { bearer: "  ", adminToken: "" },
    "addon.dropped": { bearer: "b" },
  });
  assert.deepEqual(table, {
    "addon.a": { bearer: "b", adminToken: "a", adminUrl: "" },
    "addon.dropped": { bearer: "b", adminToken: "", adminUrl: "" },
  });
});

test("T6 document: malformed JSON parses to an empty table (fail closed)", () => {
  assert.deepEqual(parseWorkspaceAddonCredentials("{not json"), {});
  assert.deepEqual(parseWorkspaceAddonCredentials("[]"), {});
});

test("T6 document: loader precedence is arg > env > file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "t6-load-"));
  const filePath = join(dir, "creds.json");
  await writeFile(filePath, JSON.stringify({ "addon.file": { bearer: "file-bearer" } }), "utf8");

  // env wins over file
  const envOnly = await loadWorkspaceAddonCredentials({
    env: { RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE: filePath },
  });
  assert.equal(envOnly["addon.file"].bearer, "file-bearer");

  const envWins = await loadWorkspaceAddonCredentials({
    env: {
      RESONANTOS_WORKSPACE_ADDON_CREDENTIALS: JSON.stringify({ "addon.env": { bearer: "env-bearer" } }),
      RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE: filePath,
    },
  });
  assert.equal(envWins["addon.env"].bearer, "env-bearer");

  const argWins = await loadWorkspaceAddonCredentials({
    args: { get: (name) => (name === "workspace-addon-credentials" ? JSON.stringify({ "addon.arg": { bearer: "arg-bearer" } }) : undefined) },
    env: { RESONANTOS_WORKSPACE_ADDON_CREDENTIALS: JSON.stringify({ "addon.env": { bearer: "env-bearer" } }) },
  });
  assert.equal(argWins["addon.arg"].bearer, "arg-bearer");
  rmSync(dir, { recursive: true, force: true });
});

test("T6 service: bootstrap delivers only the intentionally-scoped bearer, never the admin credential", async () => {
  const { service, cleanup } = await buildService({
    credentials: { "addon.resonant-echo": { bearer: "echo-bearer-secret", adminToken: "echo-admin-secret" } },
  });
  try {
    await service.executeWorkspaceAddonInstall({ manifest: echoManifest });
    await service.executeWorkspaceAddonGrant({
      addonId: "addon.resonant-echo",
      grants: [{ capability: "network", granted: true, scope: "self", revocationBehavior: "hard-stop" }],
    });
    const bootstrap = await service.executeWorkspaceAddonBootstrap({ addonId: "addon.resonant-echo" });
    assert.equal(bootstrap.capabilityTokens?.network?.token, "echo-bearer-secret", "bootstrap must deliver the scoped bearer");
    assert.ok(!JSON.stringify(bootstrap).includes("echo-admin-secret"), "bootstrap must never carry the admin credential");
  } finally { cleanup(); }
});

test("T6 service: status/discovery projects no credential material", async () => {
  const { service, cleanup } = await buildService({
    credentials: { "addon.resonant-echo": { bearer: "echo-bearer-secret", adminToken: "echo-admin-secret" } },
  });
  try {
    const status = await service.executeAddonsStatus();
    const text = JSON.stringify(status);
    assert.ok(!text.includes("echo-bearer-secret"), "status must not carry the bearer");
    assert.ok(!text.includes("echo-admin-secret"), "status must not carry the admin credential");
    assert.ok(!text.includes("admin/deny"), "status must not carry the host-only admin URL");
  } finally { cleanup(); }
});

test("T6 derive: non-loopback entrypoint is refused", () => {
  assert.throws(
    () => deriveUpstreamAdminUrl("http://attacker.example:1", "addon.a"),
    (e) => e.code === "credential-unavailable",
  );
  assert.equal(deriveUpstreamAdminUrl("http://127.0.0.1:47321", "addon.a"), "http://127.0.0.1:47321/admin/deny");
});
