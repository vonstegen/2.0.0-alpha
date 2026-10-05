// CP-XH4c: terminal-host status projection
//
// GET /terminal-host/status lives on the harness host service. It MUST be:
//   * loopback-only (loopbackHostOnly is set by route() — enforced by the
//     shared transport test in harness-host-service.test.mjs).
//   * require addon-runtime-control capability (control token).
//   * return { connected, driveId, surfaces, sessions } with NO secret-
//     shaped values anywhere in any string field.
//
// This test installs the two reference terminal-host manifests
// (addon.resonant-terminal-ghostty + addon.resonant-terminal-iterm2),
// grants terminal-host on both, calls the route, and asserts the
// payload shape + the shape-walker invariant.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  createBridgeRequestHandler,
  evaluateBridgeRequestForSelfTest,
} from "../host/bridge-server.mjs";

const SECRET_PATTERNS = [
  // Bearer / OAuth / API key shapes
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /authorization:\s*[A-Za-z0-9._\-+/=]{12,}/i,
  // JWT
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  // PEM blocks
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
  // File paths (absolute or home-relative)
  /(?:\/Users\/|\/home\/|C:\\|\/private\/)[A-Za-z0-9._/-]+/,
  /~\/[A-Za-z0-9._/-]{4,}/,
  // Env key=value with sensitive name
  /\b(?:TOKEN|SECRET|API[_-]KEY|PASSWORD|PASSWD|PRIVATE[_-]KEY)\s*=\s*[^\s"'<>]{6,}/i,
  // Provider-profile id-shaped strings
  /\bprofile:[A-Za-z0-9._-]{8,}\b/i,
];

const SECRET_FIELD_NAMES = new Set([
  "token",
  "tokens",
  "password",
  "passwd",
  "apiKey",
  "api_key",
  "apikey",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "privateKey",
  "private_key",
  "sessionToken",
  "session_token",
  "bearer",
  "bearerToken",
  "bearer_token",
  "authorization",
  "auth",
  "cookie",
]);

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
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
    assert.ok(
      !SECRET_FIELD_NAMES.has(key),
      `${path}.${key} is a secret-shaped field name; status payload must not carry it`,
    );
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
  JSON.parse(await readFile(new URL(`../host/harness-examples/${name}.json`, import.meta.url)));

const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

async function fixture(t, options = {}) {
  const create = await load();
  let stored = null;
  const host = await create({
    env: {},
    store: {
      read: async () => stored,
      write: async (value) => {
        stored = structuredClone(value);
      },
    },
    providerHost: {
      executeRawProviderChat: async () => ({ reply: "answer" }),
      executeProviderStatus: async () => ({
        providers: [{ configured: true, models: [{ allowed: true }] }],
      }),
    },
    ...options,
  });
  t.after(() => host.close());
  const call = (url, body = {}, overrides = {}) => {
    const method = url.startsWith("/addons/registry") || url.startsWith("/agent/events") || url.startsWith("/terminal-host/status")
      ? "GET"
      : "POST";
    const route = host.harnessRoutes.find((r) => r.path === url.split("?")[0]);
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
  return { host, call, install };
}

test("GET /terminal-host/status requires addon-runtime-control (forbidden without it)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/status", {}, {
    headers: { host: "127.0.0.1:47773", "x-resonantos-bridge-token": "bridge-token" },
  });
  assert.equal(result.status, 403, "missing capability is rejected");
  assert.equal(result.payload.code, "permission-denied");
});

test("GET /terminal-host/status requires loopback host (forbidden off-loopback)", async (t) => {
  const f = await fixture(t);
  const result = await f.call("/terminal-host/status", {}, {
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

test("GET /terminal-host/status projects installed terminal surfaces with the expected shape", async (t) => {
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url)),
  );
  const iterm2 = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-iterm2.json", import.meta.url)),
  );
  await f.install(ghostty);
  await f.install(iterm2);

  const result = await f.call("/terminal-host/status");
  assert.equal(result.status, 200);
  const payload = result.payload;
  assert.equal(typeof payload.connected, "boolean");
  assert.equal(typeof payload.driveId, "string");
  assert.ok(Array.isArray(payload.surfaces));
  assert.ok(Array.isArray(payload.sessions));

  // Each terminal surface appears with { adapterId, label, compatible, connected }.
  const surfaceIds = payload.surfaces.map((s) => s.adapterId).sort();
  assert.deepEqual(surfaceIds, [
    "addon.resonant-terminal-ghostty",
    "addon.resonant-terminal-iterm2",
  ]);
  for (const surface of payload.surfaces) {
    assert.equal(typeof surface.adapterId, "string");
    assert.equal(typeof surface.label, "string");
    assert.equal(typeof surface.compatible, "boolean");
    assert.equal(typeof surface.connected, "boolean");
    // With no live terminalHost.service injected, both surfaces are
    // Disconnected (compatible: true because terminal-host grant is
    // granted, but the bridge has not started so connected is false).
    assert.equal(surface.compatible, true);
    assert.equal(surface.connected, false);
  }
});

test("GET /terminal-host/status marks a surface Connected only for the active drive's adapter", async (t) => {
  // Wire a stub terminalHost.service with status() reporting alive +
  // adapterId = addon.resonant-terminal-iterm2 (the bridge's owning addon).
  const f = await fixture(t, {
    terminalHost: {
      service: {
        status: () => ({
          alive: true,
          driveId: "iterm2",
          adapterId: "addon.resonant-terminal-iterm2",
          sessions: [{ sessionId: "s-1", status: "running" }],
        }),
        start: { bus: {} },
      },
    },
  });
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url)),
  );
  const iterm2 = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-iterm2.json", import.meta.url)),
  );
  await f.install(ghostty);
  await f.install(iterm2);

  const result = await f.call("/terminal-host/status");
  assert.equal(result.status, 200);
  assert.equal(result.payload.connected, true);
  assert.equal(result.payload.driveId, "iterm2");
  const byAddon = Object.fromEntries(result.payload.surfaces.map((s) => [s.adapterId, s]));
  assert.equal(byAddon["addon.resonant-terminal-iterm2"].connected, true);
  assert.equal(byAddon["addon.resonant-terminal-ghostty"].connected, false);
  assert.equal(byAddon["addon.resonant-terminal-ghostty"].compatible, true);
  // Sessions come from the live service.
  assert.deepEqual(result.payload.sessions, [{ sessionId: "s-1", status: "running" }]);
});

test("GET /terminal-host/status shape-walker: no secret-shaped value in any string field (clean payload)", async (t) => {
  // Walk every string slot with the production shape-walker and assert
  // nothing token-, credential-, path-, or env-shaped leaks. The
  // walker's job is to lock the payload shape: the route's contract
  // is `{ connected, driveId, surfaces, sessions }` where every
  // string is an opaque addon id, drive name, or session id — never
  // a token or path.
  const f = await fixture(t);
  const ghostty = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-ghostty.json", import.meta.url)),
  );
  const iterm2 = JSON.parse(
    await readFile(new URL("../../public/addons/terminal-host-iterm2.json", import.meta.url)),
  );
  await f.install(ghostty);
  await f.install(iterm2);

  const result = await f.call("/terminal-host/status");
  assert.equal(result.status, 200);
  assertNoSecretShapedValue(result.payload, "$.payload");
});

test("GET /terminal-host/status shape-walker rejects payloads that leak token/path/credential strings", () => {
  // Negative shape-walker enforcement: if the route were ever to embed
  // a hostile value, the walker would catch it. This is the regression
  // guard for CP-XH4c.
  for (const hostile of [
    "sk-1234567890abcdefghij",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.signature",
    "/Users/leaked/Home/.ssh/id_rsa",
    "TOKEN=supersecretvalue",
    "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789",
  ]) {
    assert.throws(
      () => assertNoSecretShapedValue({ driveId: hostile, surfaces: [], connected: false, sessions: [] }),
      /secret-shaped/,
      `must reject: ${hostile}`,
    );
  }
});

test("createTerminalHostService.status() returns the CP-XH4c snapshot shape", async (t) => {
  const { createTerminalHostService } = await import(
    "../host/terminal-host-service.mjs"
  ).catch((error) => {
    if (error.code === "ERR_MODULE_NOT_FOUND") return {};
    throw error;
  });
  if (typeof createTerminalHostService !== "function") {
    t.skip("terminal-host-service not built for this environment");
    return;
  }
  const svc = createTerminalHostService({
    env: { RESONANT_TERMINAL_DRIVER: "in-memory" },
    spawn: () => ({
      stdin: null,
      stdout: { on() {}, setEncoding() {}, pause() {}, resume() {} },
      stderr: { on() {}, setEncoding() {}, pause() {}, resume() {} },
      on() {},
      kill() {},
      killed: true,
    }),
  });
  await svc.start();
  const snapshot = svc.status();
  assert.equal(typeof snapshot.alive, "boolean");
  assert.equal(typeof snapshot.driveId, "string");
  assert.equal(typeof snapshot.adapterId, "string");
  assert.ok(Array.isArray(snapshot.sessions));
  for (const session of snapshot.sessions) {
    assert.equal(typeof session.sessionId, "string");
    assert.ok(session.status === "running" || session.status === "stopped");
  }
  // The snapshot itself is shape-walker-clean.
  assertNoSecretShapedValue(snapshot, "$.status");
  await svc.stop();
});