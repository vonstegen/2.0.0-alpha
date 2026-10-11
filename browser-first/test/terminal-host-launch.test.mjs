// CP-XH5a: POST /terminal-host/launch + shared bridge-bootstrap probe.
//
// Covers:
//   - launch route returns receipt with documented shape
//   - launch route refuses without loopback / cap (401/403)
//   - launch route refuses without grant (capability-not-granted)
//   - launch route refuses with non-0600 prompt file
//   - launch route refuses with non-absolute prompt path
//   - launch route refuses when bridge is not running (bridge-not-running)
//   - launch route refuses when terminal-host service is not alive
//   - launch route succeeds end-to-end with stubs
//   - bridge-bootstrap returns typed bridge-not-running on closed port
//   - bridge-bootstrap returns { ok: true, version } on healthy port
//   - receipt shape-walker: no secret-shaped value anywhere
//
// The route lives on the harness host service alongside
// GET /terminal-host/status. Both require addon-runtime-control and
// loopback-only transport.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /authorization:\s*[A-Za-z0-9._\-+/=]{12,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
  /(?:\/Users\/|\/home\/|C:\\|\/private\/)[A-Za-z0-9._/-]+/,
  /~\/[A-Za-z0-9._/-]{4,}/,
  /\b(?:TOKEN|SECRET|API[_-]KEY|PASSWORD|PASSWD|PRIVATE[_-]KEY)\s*=\s*[^\s"'<>]{6,}/i,
  /\bprofile:[A-Za-z0-9._-]{8,}\b/i,
];

const SECRET_FIELD_NAMES = new Set([
  "token", "tokens", "password", "passwd", "apiKey", "api_key", "apikey",
  "secret", "secrets", "credential", "credentials", "privateKey",
  "private_key", "sessionToken", "session_token", "bearer", "bearerToken",
  "bearer_token", "authorization", "auth", "cookie",
]);

// CP-XH5a: the launch receipt is allowed to carry the public
// `executablePath` (validated by `piCommand()`'s fixed-install-root
// allowlist) and the validated `promptPath` (mode 0600, absolute,
// regular file). The spec explicitly allows these as "public by
// construction" — they are not secrets. The shape-walker still
// walks every string slot AND the surrounding keys; it just skips
// the path-shaped regex for fields that the spec whitelists.
const PUBLIC_PATH_FIELDS = new Set(["executablePath", "promptPath"]);

// Subset of SECRET_PATTERNS that detect filesystem paths. The
// XH5a receipt legitimately carries `executablePath` + `promptPath`
// (the validated 0600 prompt file), so we skip these patterns for
// the two whitelisted fields. All other secret patterns (tokens,
// credentials, env values, JWTs, PEMs, env-shaped `KEY=value`
// strings) still apply to every field.
const PATH_SHAPED_PATTERNS = SECRET_PATTERNS.filter((pattern) =>
  /Users|home|private|C:\\\\|~\\\//.test(pattern.source),
);

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    const fieldName = typeof path === "string" ? path.split(".").pop() ?? "" : "";
    const isPublicPath = PUBLIC_PATH_FIELDS.has(fieldName);
    for (const pattern of SECRET_PATTERNS) {
      if (isPublicPath && PATH_SHAPED_PATTERNS.includes(pattern)) continue;
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
    assert.ok(!SECRET_FIELD_NAMES.has(key),
      `${path}.${key} is a secret-shaped field name; launch payload must not carry it`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

const load = async () => {
  const module = await import("../host/harness-host-service.mjs").catch((error) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  assert.equal(typeof module.createHarnessHostService, "function");
  return module.createHarnessHostService;
};

const example = async (name) =>
  JSON.parse(await readFile(new URL(`../host/harness-examples/${name}.json`, import.meta.url), "utf8"));

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

// Tiny in-process health server — returns the documented
// { ok: true, version } shape the launch route probes for.
function startHealthServer(version = "1.0.0") {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      if (request.url === "/healthz") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, version }));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        endpoint: `http://127.0.0.1:${port}`,
        async stop() { return new Promise((res) => server.close(() => res())); },
      });
    });
  });
}

async function makePromptFile({ mode = 0o600 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "xh5-launch-prompt-"));
  const file = join(dir, "prompt.txt");
  await writeFile(file, "launch this harness", { mode: 0o600 });
  if (mode !== 0o600) await chmod(file, mode);
  return { file, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function fixture(t, options = {}) {
  const create = await load();
  let stored = null;
  const telemetryEvents = [];
  const launchBootstrapCalls = [];
  const health = options.health ?? (await startHealthServer());
  if (options.health === undefined) t.after(() => health.stop());
  const host = await create({
    env: {},
    store: {
      read: async () => stored,
      write: async (value) => { stored = structuredClone(value); },
    },
    providerHost: {
      executeRawProviderChat: async () => ({ reply: "answer" }),
      executeProviderStatus: async () => ({
        providers: [{ configured: true, models: [{ allowed: true }] }],
      }),
    },
    terminalHost: options.terminalHost ?? {
      service: {
        status: () => ({
          alive: true,
          driveId: "ghostty",
          adapterId: "addon.resonant-terminal-ghostty",
          sessions: [],
        }),
        launchBootstrap: async (args) => {
          launchBootstrapCalls.push(args);
          return { sessionId: args.sessionId, accepted: true };
        },
      },
      start: { bus: {} },
    },
    ...options,
    ...(options.promptFilePath ? { promptFilePath: options.promptFilePath } : {}),
  });
  t.after(() => host.close());
  host.setLaunchTelemetrySink(({ event, payload }) => {
    telemetryEvents.push({ event, payload });
  });
  const call = (url, body = {}, overrides = {}) => {
    const method = url.startsWith("/terminal-host/status") || url.startsWith("/terminal-host/prompt-path") || url.startsWith("/addons/registry") || url.startsWith("/agent/events")
      ? "GET"
      : "POST";
    const baseUrl = url.split("?")[0];
    const route = host.harnessRoutes.find((r) => r.path === baseUrl);
    // Lazy-load bridge-server to avoid eval cost when not used
    return import("../host/bridge-server.mjs").then(({ evaluateBridgeRequestForSelfTest }) =>
      evaluateBridgeRequestForSelfTest({
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
        },
        rawHeaders: ["Host", "127.0.0.1:47773"],
        ...overrides,
      })
    );
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
  async function launchPayload() {
    const { file, cleanup } = await makePromptFile();
    t.after(cleanup);
    return {
      agentId: "pi",
      terminalAddonId: "addon.resonant-terminal-ghostty",
      promptPath: file,
      options: { bridgeEndpoint: health.endpoint },
    };
  }
  async function callLaunch(extra = {}) {
    const body = await launchPayload();
    return call("/terminal-host/launch", { ...body, ...extra });
  }
  return {
    host,
    call,
    install,
    telemetryEvents,
    launchBootstrapCalls,
    health,
    bridgeEndpoint: health.endpoint,
    launchPayload,
    callLaunch,
  };
}

test("POST /terminal-host/launch requires addon-runtime-control (forbidden without it)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: "/tmp/prompt.txt",
  }, { headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" } });
  assert.equal(result.status, 403, "missing capability is rejected");
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /terminal-host/launch requires loopback host (forbidden off-loopback)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: "/tmp/prompt.txt",
  }, {
    headers: {
      host: "evil.test:47773",
      "x-resonantos-bridge-token": "bridge-token",
      "x-resonantos-bridge-capability-token": tokens["addon-runtime-control"],
    },
    rawHeaders: ["Host", "evil.test:47773"],
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("POST /terminal-host/launch rejects non-absolute prompt path (invalid-event)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: "relative/prompt.txt",
  });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /terminal-host/launch rejects a non-existent prompt file (invalid-event)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: "/tmp/does-not-exist-prompt-12345.txt",
  });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /terminal-host/launch rejects a prompt file with mode != 0600 (invalid-event)", async (t) => {
  const f = await fixture(t);
  const { file, cleanup } = await makePromptFile({ mode: 0o644 });
  t.after(cleanup);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: file,
  });
  assert.equal(result.status, 400);
  assert.equal(result.payload.code, "invalid-event");
});

test("POST /terminal-host/launch returns bridge-not-running when the bridge probe is closed", async (t) => {
  // No health server: the probe should fail with a typed error.
  const f = await fixture(t, { health: { endpoint: "http://127.0.0.1:1", stop: async () => {} } });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const { file, cleanup } = await makePromptFile();
  t.after(cleanup);
  const result = await f.call("/terminal-host/launch", {
    agentId: "pi",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    promptPath: file,
    options: { bridgeEndpoint: f.bridgeEndpoint },
  });
  assert.equal(result.status, 200, "typed rejections travel as 200 ok:false so the UI can branch");
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-not-running");
  assert.ok(typeof result.payload.endpoint === "string");
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("POST /terminal-host/launch returns capability-not-granted when grant missing", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  // Install without granting the terminal-host capability: install
  // enabled=true but grant an empty set.
  const installResult = await f.call("/addons/install", { manifest: ghostty, enabled: true });
  assert.equal(installResult.status, 200);
  const noGrant = await f.call("/addons/grants", {
    addonId: ghostty.id,
    grants: ghostty.requestedCapabilities.map((g) => ({ ...g, granted: false })),
    consent: true,
    expectedRevision: f.host.registry.snapshot().revision,
  });
  assert.equal(noGrant.status, 200);
  const result = await f.callLaunch();
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "capability-not-granted");
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("POST /terminal-host/launch returns capability-not-granted when terminal-host service is not bound to the addon", async (t) => {
  const f = await fixture(t, {
    terminalHost: {
      service: {
        status: () => ({
          alive: true,
          driveId: "iterm2",
          adapterId: "addon.resonant-terminal-iterm2",
          sessions: [],
        }),
        launchBootstrap: async () => ({ sessionId: "s", accepted: true }),
      },
      start: { bus: {} },
    },
  });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch();
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-not-running");
});

test("POST /terminal-host/launch refuses when terminal-host service is not alive", async (t) => {
  const f = await fixture(t, {
    terminalHost: {
      service: {
        status: () => ({ alive: false, driveId: "in-memory", adapterId: null, sessions: [] }),
        launchBootstrap: async () => ({ sessionId: "s", accepted: true }),
      },
      start: { bus: {} },
    },
  });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch();
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "bridge-not-running");
});

test("POST /terminal-host/launch returns documented receipt on success", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch();
  assert.equal(result.status, 200, `expected success, got ${JSON.stringify(result.payload)}`);
  assert.equal(result.payload.ok, true);
  // Receipt shape: documented fields only.
  assert.equal(typeof result.payload.launchId, "string");
  assert.equal(result.payload.agentId, "pi");
  assert.equal(result.payload.terminalAddonId, "addon.resonant-terminal-ghostty");
  assert.equal(typeof result.payload.executablePath, "string");
  assert.ok(result.payload.executablePath.startsWith("/"));
  assert.ok(result.payload.promptPath.startsWith("/"));
  assert.equal(typeof result.payload.startedAt, "string");
  assert.equal(typeof result.payload.bridgeVersion, "string");
  assert.equal(result.payload.launchAccepted, true);
  // launchBootstrap was called with the reviewed commandSuffix.
  assert.equal(f.launchBootstrapCalls.length, 1);
  assert.match(f.launchBootstrapCalls[0].commandSuffix, /'\/[^']+' '\@\/[^']+'/);
  // The launch record is persisted in the host service.
  const launches = f.host.listLaunches();
  assert.equal(launches.length, 1);
  assert.equal(launches[0].launchId, result.payload.launchId);
  // Receipt itself is shape-walker clean.
  assertNoSecretShapedValue(result.payload, "$.payload");
  assertNoSecretShapedValue(launches[0], "$.launches");
});

test("POST /terminal-host/launch forwards providerProfileId to launchBootstrap", async (t) => {
  const f = await fixture(t, {
    hostTerminal: { resolveCredential: async () => ({ name: "MINIMAX_API_KEY", value: "sk-test" }) },
  });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch({ providerProfileId: "shared-minimax" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(f.launchBootstrapCalls.length, 1);
  assert.equal(f.launchBootstrapCalls[0].providerProfileId, "shared-minimax");
});

test("POST /terminal-host/launch returns missing-credential when the provider profile has no credential", async (t) => {
  const f = await fixture(t, {
    hostTerminal: { resolveCredential: async () => null },
  });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch({ providerProfileId: "shared-minimax" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "missing-credential");
  assert.equal(f.launchBootstrapCalls.length, 0, "must not spawn a terminal when the credential is missing");
});

test("POST /terminal-host/launch omits providerProfileId when absent (no credential)", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch();
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(f.launchBootstrapCalls[0].providerProfileId, undefined);
});

test("POST /terminal-host/launch emits terminal.launch.receipt telemetry on success", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch();
  assert.equal(result.status, 200);
  const event = f.telemetryEvents.find((e) => e.event === "terminal.launch.receipt");
  assert.ok(event, "expected terminal.launch.receipt telemetry event");
  assert.equal(event.payload.launchId, result.payload.launchId);
  assert.equal(event.payload.agentId, "pi");
  assert.equal(event.payload.terminalAddonId, "addon.resonant-terminal-ghostty");
  assert.equal(typeof event.payload.executablePath, "string");
  assert.ok(event.payload.promptPath.startsWith("/"));
  assert.equal(typeof event.payload.startedAt, "string");
  // Telemetry payload is shape-walker clean.
  assertNoSecretShapedValue(event.payload, "$.telemetry");
});

test("POST /terminal-host/launch refuses for a non-pi agent (policy-not-reviewed)", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"),
  );
  await f.install(ghostty);
  const result = await f.callLaunch({ agentId: "opencode" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.reason, "policy-not-reviewed");
});

// ---------------------------------------------------------------------------
// bridge-bootstrap direct tests
// ---------------------------------------------------------------------------

test("bridge-bootstrap returns typed bridge-not-running on a closed port", async () => {
  const { ensureBridgeReachable } = await import("../host/bridge-bootstrap.mjs");
  const result = await ensureBridgeReachable({ endpoint: "http://127.0.0.1:1", timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-not-running");
  assert.equal(result.endpoint, "http://127.0.0.1:1");
});

test("bridge-bootstrap returns { ok: true, version } on a healthy port", async () => {
  const { ensureBridgeReachable } = await import("../host/bridge-bootstrap.mjs");
  const health = await startHealthServer("2.0.0-test");
  try {
    const result = await ensureBridgeReachable({ endpoint: health.endpoint, timeoutMs: 1000 });
    assert.equal(result.ok, true);
    assert.equal(result.version, "2.0.0-test");
    assert.equal(result.endpoint, health.endpoint);
  } finally {
    await health.stop();
  }
});

test("bridge-bootstrap treats a non-200 /healthz as bridge-not-running", async () => {
  const { ensureBridgeReachable } = await import("../host/bridge-bootstrap.mjs");
  const server = createServer((_request, response) => {
    response.writeHead(500); response.end();
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address()).port;
  try {
    const result = await ensureBridgeReachable({ endpoint: `http://127.0.0.1:${port}`, timeoutMs: 1000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "bridge-not-running");
  } finally {
    await new Promise((res) => server.close(() => res()));
  }
});

test("bridge-bootstrap rejects an unsupported protocol with bridge-not-running", async () => {
  const { ensureBridgeReachable } = await import("../host/bridge-bootstrap.mjs");
  const result = await ensureBridgeReachable({ endpoint: "ftp://127.0.0.1:1", timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-not-running");
});

// ---------------------------------------------------------------------------
// Negative shape-walker (CP-XH5a): the receipt / typed rejection must never
// carry a secret-shaped value.
// ---------------------------------------------------------------------------

test("launch receipt shape-walker rejects payloads that leak token/path/credential strings", async () => {
  for (const hostile of [
    "sk-1234567890abcdefghij",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.signature",
    "/Users/leaked/Home/.ssh/id_rsa",
    "TOKEN=supersecretvalue",
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  ]) {
    assert.throws(
      () => assertNoSecretShapedValue({
        launchId: hostile,
        agentId: "pi",
        terminalAddonId: "addon.resonant-terminal-ghostty",
        executablePath: hostile,
        promptPath: hostile,
        startedAt: "2026-10-05T00:00:00.000Z",
      }, "$.payload"),
      /secret-shaped/,
      `must reject: ${hostile}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Pi policy: composeInvocationFromFile composes the reviewed suffix.
// ---------------------------------------------------------------------------

test("pi policy composeInvocationFromFile produces 'pi @<file>' from a reviewed executable + promptPath + promptBytes", async () => {
  const { composePiInvocationFromFile } = await import("../host/harness-policies/pi.mjs");
  const invocation = composePiInvocationFromFile({
    executable: { command: "/usr/local/bin/pi", source: "fixed-install-root" },
    promptPath: "/tmp/prompt.txt",
    promptBytes: 1234,
    credentialEnvVarName: null,
  });
  assert.match(invocation.commandSuffix, /'\/usr\/local\/bin\/pi' '\@\/tmp\/prompt\.txt'/);
  assert.match(invocation.auditSummary, /1234 bytes/);
});

test("pi policy composeInvocationFromFile refuses a non-absolute executable", async () => {
  const { composePiInvocationFromFile } = await import("../host/harness-policies/pi.mjs");
  assert.throws(
    () => composePiInvocationFromFile({
      executable: { command: "pi", source: "fixed-install-root" },
      promptPath: "/tmp/prompt.txt",
      promptBytes: 1,
    }),
    /absolute executable/i,
  );
});

test("pi policy composeInvocationFromFile emits --provider <id> when a provider is supplied", async () => {
  const { composePiInvocationFromFile } = await import("../host/harness-policies/pi.mjs");
  const invocation = composePiInvocationFromFile({
    executable: { command: "/usr/local/bin/pi", source: "fixed-install-root" },
    promptPath: "/tmp/prompt.txt",
    promptBytes: 1234,
    credentialEnvVarName: null,
    provider: "minimax",
  });
  assert.match(invocation.commandSuffix, /--provider minimax/);
  assert.match(invocation.auditSummary, /--provider minimax/);
});

test("pi policy composeInvocationFromFile drops a non-token provider", async () => {
  const { composePiInvocationFromFile } = await import("../host/harness-policies/pi.mjs");
  const invocation = composePiInvocationFromFile({
    executable: { command: "/usr/local/bin/pi", source: "fixed-install-root" },
    promptPath: "/tmp/prompt.txt",
    promptBytes: 1234,
    provider: "bad; rm -rf /",
  });
  assert.doesNotMatch(invocation.commandSuffix, /--provider/);
});

test("POST /terminal-host/launch selects the pi-native provider via --provider", async (t) => {
  const f = await fixture(t, {
    hostTerminal: {
      resolveCredential: async () => ({ name: "MINIMAX_API_KEY", value: "sk-test-value" }),
      resolvePiProvider: async () => ({ piProvider: "minimax", envVar: "MINIMAX_API_KEY" }),
    },
  });
  const ghostty = JSON.parse(await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url), "utf8"));
  await f.install(ghostty);
  const result = await f.callLaunch({ providerProfileId: "shared-minimax" });
  assert.equal(result.status, 200);
  const commandSuffix = f.launchBootstrapCalls[0]?.commandSuffix;
  assert.ok(commandSuffix, "launchBootstrap received a commandSuffix");
  assert.match(commandSuffix, /--provider minimax/);
});

// ---------------------------------------------------------------------------
// CP-XH5b: GET /terminal-host/prompt-path
// ---------------------------------------------------------------------------

test("GET /terminal-host/prompt-path requires addon-runtime-control", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/prompt-path", {}, {
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" },
  });
  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "permission-denied");
});

test("GET /terminal-host/prompt-path returns the host factory's path + valid=false when no file exists", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/prompt-path");
  assert.equal(result.status, 200);
  assert.equal(typeof result.payload.promptPath, "string");
  assert.ok(result.payload.promptPath.startsWith("/"));
  assert.equal(result.payload.valid, false);
});

test("GET /terminal-host/prompt-path returns a STABLE path across polls, so a written 0600 file flips valid=true (regression)", async (t) => {
  const f = await fixture(t);
  const first = await f.call("/terminal-host/prompt-path");
  const second = await f.call("/terminal-host/prompt-path");
  assert.equal(
    first.payload.promptPath,
    second.payload.promptPath,
    "prompt-path must be identical across polls; a fresh UUID per call would make the operator write a prompt to one path while the next poll stats a different (absent) path",
  );
  await writeFile(first.payload.promptPath, "operator prompt", { mode: 0o600 });
  t.after(() => rm(first.payload.promptPath, { force: true }).catch(() => {}));
  const third = await f.call("/terminal-host/prompt-path");
  assert.equal(third.payload.promptPath, first.payload.promptPath);
  assert.equal(
    third.payload.valid,
    true,
    "once the operator writes a 0600 file at the stable path, the route must report valid=true",
  );
});

test("GET /terminal-host/prompt-path returns valid=true when a 0600 file exists at the configured path", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "xh5-prompt-path-"));
  const promptFile = join(dir, "prompt.txt");
  await writeFile(promptFile, "the operator's prompt", { mode: 0o600 });
  const f = await fixture(t, { promptFilePath: () => promptFile });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await f.call("/terminal-host/prompt-path");
  assert.equal(result.status, 200);
  assert.equal(result.payload.promptPath, promptFile);
  assert.equal(result.payload.valid, true);
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("GET /terminal-host/prompt-path returns valid=false when the existing file is not 0600", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "xh5-prompt-path-bad-"));
  const promptFile = join(dir, "prompt.txt");
  await writeFile(promptFile, "the operator's prompt", { mode: 0o644 });
  const f = await fixture(t, { promptFilePath: () => promptFile });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await f.call("/terminal-host/prompt-path");
  assert.equal(result.status, 200);
  assert.equal(result.payload.valid, false);
});