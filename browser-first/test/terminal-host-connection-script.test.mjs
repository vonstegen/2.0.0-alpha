// CP-BR10: GET /terminal-host/connection-script host route coverage.
//
// Proves the reviewed contract for the connection-script affordance:
//
//   - the route composes a non-secret shell snippet (no token, credential,
//     path, or env value in the body; the 0600 token rides in a file path
//     only);
//   - the route enforces the same gates as /terminal-host/launch
//     (installed + enabled + terminal-host grant + bridge reachable)
//     and returns the SAME typed rejections;
//   - the adopted session is tracked for disable / revoke / remove
//     cleanup (zero-leaked-windows invariant);
//   - the script's --token-file and --provider-profile-id are present;
//   - the renderer / host boundary carries no secret-shaped value (the
//     shape-walker covers every string in the receipt).
//
// No real process is spawned.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

import { createHarnessHostService } from "../host/harness-host-service.mjs";
import { evaluateBridgeRequestForSelfTest } from "../host/bridge-server.mjs";
import { loadTerminalAddonSeedInstallations } from "../host/terminal-addon-seed.mjs";

// ---------------------------------------------------------------------------
// Non-leak walker (mirrors the one in terminal-host-launch.test.mjs)
// ---------------------------------------------------------------------------

const SECRET_FIELD_NAMES = new Set([
  "token", "tokens", "password", "passwd", "apiKey", "api_key", "apikey",
  "secret", "secrets", "credential", "credentials", "privateKey",
  "private_key", "sessionToken", "session_token", "bearer", "bearerToken",
  "bearer_token", "authorization", "auth", "cookie",
]);

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
];

const PUBLIC_PATH_FIELDS = new Set(["executablePath", "promptPath", "tokenFilePath", "rosSessionPath"]);

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const fieldName = typeof path === "string" ? path.split(".").pop() ?? "" : "";
    const isPublicPath = PUBLIC_PATH_FIELDS.has(fieldName);
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(value, pattern, `${path} carries a secret-shaped value`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!SECRET_FIELD_NAMES.has(key), `${path}.${key} is a secret-shaped field name; receipt must not carry it`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

function startHealthServer() {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, version: "alpha" }));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        endpoint: `http://127.0.0.1:${server.address().port}`,
        stop: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function fixture(t, options = {}) {
  const health = options.health ?? (await startHealthServer());
  if (options.health === undefined) t.after(() => health.stop());
  let stored = null;
  const terminateSessionCalls = [];
  const host = await createHarnessHostService({
    env: {},
    store: {
      read: async () => stored,
      write: async (value) => { stored = structuredClone(value); },
    },
    providerHost: {
      executeProviderStatus: async () => ({ providers: [] }),
      executeBridgeChat: async () => ({}),
    },
    terminalHost: options.terminalHost ?? {
      service: {
        status: () => ({
          alive: true,
          driveId: "ghostty",
          adapterId: "addon.resonant-terminal-ghostty",
          sessions: [],
        }),
        launchBootstrap: async () => ({ sessionId: "x", accepted: true }),
        terminateSession: async (args) => {
          terminateSessionCalls.push(args);
          return { sessionId: args?.sessionId, terminated: true };
        },
      },
      start: { bus: {} },
    },
    ...(options.seedInstallations !== undefined ? { seedInstallations: options.seedInstallations } : {}),
    ...(options.rosSessionPath ? { rosSessionPath: options.rosSessionPath } : {}),
  });
  t.after(() => host.close());
  const call = (url, body = {}, overrides = {}) => {
    const method = url.startsWith("/terminal-host/status") || url.startsWith("/terminal-host/prompt-path") || url.startsWith("/addons/registry")
      ? "GET"
      : "POST";
    const baseUrl = url.split("?")[0];
    const route = host.harnessRoutes.find((r) => r.path === baseUrl);
    return evaluateBridgeRequestForSelfTest({
      method,
      url,
      body,
      routes: host.harnessRoutes,
      bridgeToken: "bridge-token",
      bridgeCapabilityTokens: tokens,
      listenerPort: 47773,
      headers: {
        host: "127.0.0.1:47773",
        "x-resonantos-bridge-token": "bridge-token",
        "x-resonantos-bridge-capability-token": tokens[route?.requiredCapability],
        ...overrides.headers,
      },
      rawHeaders: ["Host", "127.0.0.1:47773"],
      ...overrides,
    });
  };
  const install = async (manifest) => {
    const installResult = await call("/addons/install", { manifest, enabled: true });
    assert.equal(installResult.status, 200);
    const grantsResult = await call("/addons/grants", {
      addonId: manifest.id,
      grants: manifest.requestedCapabilities.map((g) => ({ ...g, granted: true })),
      consent: true,
      expectedRevision: host.registry.snapshot().revision,
    });
    assert.equal(grantsResult.status, 200);
  };
  return { host, health, call, install, terminateSessionCalls };
}

async function scriptDir() {
  const dir = await mkdtemp(join(tmpdir(), "cpbr10-script-"));
  const file = join(dir, "ros-session.mjs");
  await writeFile(file, "echo 'cp-br10 stub';\n", { mode: 0o644 });
  return { dir, file, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("CP-BR10: POST /terminal-host/connection-script requires addon-runtime-read (forbidden without it)", async (t) => {
  const { call } = await fixture(t, { seedInstallations: await loadTerminalAddonSeedInstallations() });
  const result = await call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" }, {
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" },
  });
  assert.equal(result.status, 403, "missing capability is rejected");
  assert.equal(result.payload.code, "permission-denied");
});

test("CP-BR10: the route refuses when the add-on is not installed", async (t) => {
  const f = await fixture(t, { seedInstallations: [] });
  const result = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "capability-not-granted");
});

test("CP-BR10: the route refuses when the add-on is installed but the terminal-host grant is missing", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const f = await fixture(t, { seedInstallations: seeds });
  const ghostty = seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest;
  await f.call("/addons/install", { manifest: ghostty, enabled: true });
  const result = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "capability-not-granted");
});

test("CP-BR10: the route returns bridge-not-running when the bridge is unreachable", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const f = await fixture(t, { seedInstallations: seeds });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const result = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty", bridgeEndpoint: "http://127.0.0.1:1" });
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-not-running");
});

test("CP-BR10: the route composes a non-secret script, references the 0600 token file, and supports providerProfileId", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const result = await f.call(
    "/terminal-host/connection-script",
    { terminalAddonId: "addon.resonant-terminal-ghostty", providerProfileId: "openai" },
  );
  assert.equal(result.status, 200);
  const receipt = result.payload;
  assert.equal(receipt.ok, true);
  // Receipt shape.
  assert.equal(receipt.terminalAddonId, "addon.resonant-terminal-ghostty");
  assert.equal(receipt.providerProfileId, "openai");
  assert.equal(receipt.rosSessionPath, stub.file);
  assert.ok(receipt.tokenFilePath.startsWith("/"), "0600 token file path is absolute");
  assert.ok(typeof receipt.sessionId === "string" && receipt.sessionId.startsWith("attach-"));
  assert.ok(typeof receipt.expiresAt === "string");
  assert.ok(typeof receipt.startedAt === "string");
  // Script content.
  assert.equal(typeof receipt.command, "string");
  assert.match(receipt.command, /eval "\$\(node /);
  assert.match(receipt.command, /--session-id ['"]?attach-/);
  assert.match(receipt.command, new RegExp(`--token-file ['"]?${receipt.tokenFilePath.replace(/[/]/g, "\\/")}['"]?`));
  assert.match(receipt.command, /--provider-profile-id ['"]?openai['"]?/);
  // 0600 token file exists on disk.
  const fileStat = await stat(receipt.tokenFilePath);
  assert.equal(fileStat.isFile(), true);
  assert.equal(fileStat.mode & 0o777, 0o600, "token file is mode 0600");
  // The token itself is NEVER in the receipt, the command, the script, or
  // any other string field the renderer may copy verbatim.
  assertNoSecretShapedValue(receipt, "$.receipt");
  assertNoSecretShapedValue(receipt.command, "$.command");
  // The 0600 token file content is a UUID-shaped string + a prefix; the
  // shape-walker rejects long opaque tokens. The token is local to the
  // host; the renderer never reads it.
  const fileContent = await readFile(receipt.tokenFilePath, "utf8");
  for (const pattern of SECRET_PATTERNS) {
    assert.doesNotMatch(fileContent, pattern, "the 0600 token file does not match long opaque token shapes");
  }
});

test("CP-BR10: the script is provider-profile-id-free when the body field is absent", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const result = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.providerProfileId, null);
  assert.match(result.payload.command, /--provider-profile-id ['"]['"]?/);
});

test("CP-BR10: a second connection-script call mints a fresh grant (single-use audience-bound)", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const first = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  const second = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.notEqual(first.payload.sessionId, second.payload.sessionId, "each call mints a fresh sessionId");
  assert.notEqual(first.payload.tokenFilePath, second.payload.tokenFilePath, "each call writes a fresh 0600 file");
  // Each token file is 0600 + readable.
  for (const receipt of [first.payload, second.payload]) {
    const fileStat = await stat(receipt.tokenFilePath);
    assert.equal(fileStat.mode & 0o777, 0o600);
  }
});

test("CP-BR10: adoption is dropped on disable; terminateSession is called best-effort", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const r1 = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.equal(r1.status, 200);
  assert.equal(f.terminateSessionCalls.length, 0, "no terminate until disable");
  // Disable the add-on; the host iterates the adoption map and asks
  // the live terminal-host service to terminate the adopted session.
  const r2 = await f.call("/addons/enabled", { addonId: "addon.resonant-terminal-ghostty", enabled: false, expectedRevision: f.host.registry.snapshot().revision });
  assert.equal(r2.status, 200);
  assert.equal(f.terminateSessionCalls.length, 1);
  assert.equal(f.terminateSessionCalls[0].sessionId, r1.payload.sessionId);
});

test("CP-BR10: adoption is dropped on remove; terminateSession is called best-effort", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const r1 = await f.call("/terminal-host/connection-script", { terminalAddonId: "addon.resonant-terminal-ghostty" });
  assert.equal(r1.status, 200);
  const r2 = await f.call("/addons/remove", { addonId: "addon.resonant-terminal-ghostty" });
  assert.equal(r2.status, 200);
  assert.equal(f.terminateSessionCalls.length, 1);
  assert.equal(f.terminateSessionCalls[0].sessionId, r1.payload.sessionId);
});

test("CP-BR10: the route rejects a malformed add-on id (the host character set is the boundary)", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const f = await fixture(t, { seedInstallations: seeds });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  const result = await f.call("/terminal-host/connection-script", { terminalAddonId: "evil;rm -rf /" });
  // The host body's id() check rejects the malformed id with
  // invalid-event (400). The renderer / UI surface the typed
  // rejection.
  assert.equal(result.status, 400, "malformed id is rejected at the route boundary");
  assert.equal(result.payload.code, "invalid-event");
});

test("CP-BR10: an extra providerProfileId body field is shape-walker clean", async (t) => {
  const seeds = await loadTerminalAddonSeedInstallations();
  const stub = await scriptDir();
  t.after(stub.cleanup);
  const f = await fixture(t, { seedInstallations: seeds, rosSessionPath: stub.file });
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-ghostty").manifest);
  await f.install(seeds.find((entry) => entry.manifest.id === "addon.resonant-terminal-iterm2").manifest);
  const result = await f.call(
    "/terminal-host/connection-script",
    { terminalAddonId: "addon.resonant-terminal-iterm2", providerProfileId: "openrouter" },
  );
  assert.equal(result.status, 200);
  // Receipt carries the iTerm2 addon id (not ghostty).
  assert.equal(result.payload.terminalAddonId, "addon.resonant-terminal-iterm2");
  assertNoSecretShapedValue(result.payload, "$.iterm2-receipt");
  // Command's --provider-profile-id is openrouter (composer's
  // shellQuote wraps the value in single quotes; the assertion
  // tolerates either form).
  assert.match(result.payload.command, /--provider-profile-id ['"]?openrouter['"]?/);
});
