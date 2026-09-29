// SDK-DEMO-003R regression: the live bridge's /addons/workspace/admin-revoke
// must resolve the trusted upstreamAdminUrl + adminToken from the host-owned
// addonId mapping (T1), not from the caller. On 4e7a144 the host mapping had a
// malformed `${DEMO_*_ADMIN_PORT || 34xx}` URL (and the live extension tests
// still injected the privileged URL/token), so the bridge returned HTTP 500.
//
// This test drives the real bridge launcher against a real Counter upstream on
// the manifest-declared port (47322) without a browser, proving:
//   1. `{ addonId, granted }` reaches the host-owned mapping and flips the
//      upstream's hostGranted flag (200, not 500);
//   2. a caller that still tries to inject upstreamAdminUrl/adminToken is
//      denied at the bridge boundary (T1 injection guard preserved).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCounterServer } from "../../examples/sdk-demo/counter/server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bridgePath = path.join(repoRoot, "browser-first", "host", "run-bridge-minimal.mjs");
const extensionRoot = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");

const COUNTER_BEARER = "admin-revoke-bridge-counter-bearer";
const COUNTER_ADMIN = "admin-revoke-bridge-counter-admin";
const BRIDGE_TOKEN = "admin-revoke-bridge-bridge-token";
const CONTROL_TOKEN = "admin-revoke-bridge-control-token";
const READ_TOKEN = "admin-revoke-bridge-read-token";
const COUNTER_PORT = 47322;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForBridgeConfig(configPath, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, "utf8");
        const match = /__RESONANTOS_BRIDGE_CONFIG__ = Object\.freeze\((.+?)\);/s.exec(content);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.bridgeToken === BRIDGE_TOKEN) return parsed;
        }
      } catch { /* keep polling */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("bridge-config.generated.js never appeared with the expected bridgeToken");
}

test("live bridge admin-revoke uses host-owned mapping (T1) and flips the Counter upstream", async () => {
  const bridgePort = await freePort();
  const userRoot = await mkdtemp(path.join(os.tmpdir(), "sdk-003r-admin-revoke-"));
  const configPath = path.join(extensionRoot, "src", "bridge-config.generated.js");
  // Drop any stale generated config so the freshly-minted port/token is read.
  try { await unlink(configPath); } catch { /* none */ }

  const counter = createCounterServer({ port: COUNTER_PORT, bearerToken: COUNTER_BEARER, adminToken: COUNTER_ADMIN });
  await counter.start();

  // T6.1: no raw secret material in argv. Write the provisioning document into
  // the already-isolated tmp user root and pass a *reference* (path) instead.
  const credentialFile = path.join(userRoot, "workspace-addon-credentials.json");
  writeFileSync(credentialFile, JSON.stringify({ "addon.resonant-counter": { bearer: COUNTER_BEARER, adminToken: COUNTER_ADMIN } }), "utf8");

  const bridge = spawn(process.execPath, [
    bridgePath,
    `--bridge-port=${bridgePort}`,
    `--bridge-token=${BRIDGE_TOKEN}`,
    `--addon-runtime-control-token=${CONTROL_TOKEN}`,
    `--addon-runtime-read-token=${READ_TOKEN}`,
    `--workspace-addon-credentials-file=${credentialFile}`,
    `--user-root=${userRoot}`,
  ], {
    stdio: ["ignore", "ignore", "pipe"],
    // The bridge resolves its user root from RESONANTOS_BROWSER_FIRST_USER_ROOT,
    // not the `--user-root` argv (which the launcher ignores). Pin the env so
    // the freshly-minted isolated root is authoritative; otherwise the test
    // would read the operator's persistent ~/ResonantOS_User governance state.
    env: { ...process.env, RESONANTOS_BROWSER_FIRST_USER_ROOT: userRoot },
  });

  let bridgeStderr = "";
  bridge.stderr.on("data", (chunk) => { bridgeStderr += chunk.toString("utf8"); });

  const bridgePost = async (routePath, body, capabilityToken = CONTROL_TOKEN) => {
    const cfg = await waitForBridgeConfig(configPath);
    return fetch(`${cfg.bridgeUrl.replace(/\/$/, "")}${routePath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-token": BRIDGE_TOKEN,
        "x-resonantos-bridge-capability-token": capabilityToken,
      },
      body: JSON.stringify(body ?? {}),
    });
  };

  const bridgeGet = async (routePath) => {
    const cfg = await waitForBridgeConfig(configPath);
    return fetch(`${cfg.bridgeUrl.replace(/\/$/, "")}${routePath}`, {
      method: "GET",
      headers: {
        "x-resonantos-bridge-token": BRIDGE_TOKEN,
        "x-resonantos-bridge-capability-token": READ_TOKEN,
      },
    });
  };

  try {
    // 0. Install the Counter add-on so the converged admin-revoke path has a
    //    registry grant surface to flip (T4: registry + upstream converge).
    //    Public install is intent-only: first populate the host-owned discovery
    //    cache (GET /addons/status), then install by addonId. A caller-supplied
    //    manifest is rejected by the bridge (R1).
    const statusRes = await bridgeGet("/addons/status");
    assert.equal(statusRes.status, 200, `status must succeed (got ${statusRes.status})`);
    const installRes = await bridgePost("/addons/workspace/install", { addonId: "addon.resonant-counter" });
    assert.equal(installRes.status, 200, `counter install must succeed (got ${installRes.status})`);

    // 1. Host-owned intent-only revoke must converge BOTH the registry grant
    //    and the upstream flag.
    const revokeRes = await bridgePost("/addons/workspace/admin-revoke", { addonId: "addon.resonant-counter", granted: false });
    const revokeBody = await revokeRes.json().catch(() => null);
    assert.equal(
      revokeRes.status,
      200,
      `admin-revoke via host-owned mapping must be 200; got ${revokeRes.status} body=${JSON.stringify(revokeBody)}`,
    );
    assert.equal(counter.getHostGranted(), false, "Counter upstream hostGranted must be false after revoke");

    // 2. Caller-supplied upstreamAdminUrl/adminToken must be denied at the
    //    bridge boundary; the upstream state must be untouched by the attempt.
    const injectRes = await bridgePost("/addons/workspace/admin-revoke", {
      addonId: "addon.resonant-counter",
      upstreamAdminUrl: "http://127.0.0.1:1/admin/deny",
      adminToken: "attacker-admin",
      granted: true,
    });
    assert.equal(
      injectRes.status,
      403,
      `caller-injected upstreamAdminUrl/adminToken must be denied 403; got ${injectRes.status}`,
    );
    assert.equal(counter.getHostGranted(), false, "injection attempt must not flip the upstream flag");
  } finally {
    bridge.kill("SIGTERM");
    await new Promise((resolve) => bridge.once("exit", resolve));
    await counter.close();
    await rm(userRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  void bridgeStderr;
});
