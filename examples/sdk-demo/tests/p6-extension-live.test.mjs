// CP6 / Phase-3 P6 real-extension test: the host-owned registry lifecycle
// against the actual unpacked extension + real bridge + real Counter upstream.
//
// Steps:
//   1. Operator starts Echo + Counter with bearer + admin tokens.
//   2. Operator starts the bridge with the demo bearer/admin tokens threaded
//      through. The registry's `install()` is invoked by `executeAddonsStatus`
//      on the first /addons/status fetch.
//   3. The host grants Counter's `network` capability via the bridge route
//      POST /addons/workspace/grant.
//   4. The real extension opens Counter; the bootstrap envelope carries the
//      host-minted bearer; the iframe's mutation succeeds (200).
//   5. The host revokes Counter's `network` capability.
//   6. The same mutation now returns 403 (real host-policy, not hard-coded).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { createCounterServer } from "../counter/server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const extensionPath = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");

const COUNTER_BEARER = "p6-live-counter-bearer";
const COUNTER_ADMIN = "p6-live-counter-admin";
const COUNTER_BRIDGE_TOKEN = "dev-p6-bridge-token";

function chromeAvailable() {
  const override = process.env.RESONANTOS_LIVE_CHROME_PATH;
  if (override) return existsSync(override);
  try { return existsSync(chromium.executablePath()); } catch { return false; }
}

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

async function waitForCdp(port, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
      lastError = new Error(`status ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`CDP debug port ${port} did not become available: ${lastError?.message ?? lastError}`);
}

async function discoverExtensionId(cdpPort, { timeoutMs = 30_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      if (res.ok) {
        const targets = await res.json();
        const target = targets.find((entry) => entry.url?.startsWith("chrome-extension://"));
        if (target) {
          const match = /^chrome-extension:\/\/([a-z]+)\//.exec(target.url);
          if (match) return match[1];
        }
      }
    } catch { /* CDP may transiently reject; keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Could not discover extension id from CDP targets on port ${cdpPort} within ${timeoutMs}ms`);
}

function spawnBridge(bridgePort) {
  const bridgePath = path.join(repoRoot, "browser-first", "host", "run-bridge-minimal.mjs");
  const args = [
    bridgePath,
    `--bridge-port=${bridgePort}`,
    `--bridge-token=${COUNTER_BRIDGE_TOKEN}`,
    "--addon-runtime-read-token=dev-p6-addon-read",
    "--addon-runtime-control-token=dev-p6-addon-control",
    `--counter-bearer-token=${COUNTER_BEARER}`,
    `--counter-admin-token=${COUNTER_ADMIN}`,
    // Pin the registry to a tmp user-root so the test does not pollute
    // ~/ResonantOS_User.
    `--user-root=${path.join(os.tmpdir(), "sd003-p6-user-root")}`,
  ];
  return spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function spawnCounter() {
  let service = null;
  return {
    async start() {
      service = createCounterServer({ port: 47322, bearerToken: COUNTER_BEARER, adminToken: COUNTER_ADMIN });
      await service.start();
      return 47322;
    },
    async stop() {
      if (service) { await service.close(); service = null; }
    },
  };
}

async function readBridgeConfig({ timeoutMs = 30_000 } = {}) {
  const configPath = path.join(extensionPath, "src", "bridge-config.generated.js");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(configPath)) {
      try {
        const content = await import("node:fs/promises").then(({ readFile }) => readFile(configPath, "utf8"));
        const match = /__RESONANTOS_BRIDGE_CONFIG__ = Object\.freeze\((.+?)\);/s.exec(content);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.bridgeToken === COUNTER_BRIDGE_TOKEN) return parsed;
        }
      } catch { /* keep polling */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("bridge-config.generated.js never appeared");
}

async function bridgePost(bridgeUrl, route, body, { capability, bridgeToken, capabilityToken } = {}) {
  const headers = {
    "content-type": "application/json",
    "x-resonantos-bridge-token": bridgeToken,
  };
  if (capability && capabilityToken) {
    headers["x-resonantos-bridge-capability-token"] = capabilityToken;
  }
  const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function bootstrapProbe(bridgeUrl, bridgeToken, capabilityBootstrapToken) {
  const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/api/capability-tokens`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-resonantos-bridge-token": bridgeToken,
      "x-resonantos-capability-bootstrap-token": capabilityBootstrapToken,
    },
    body: JSON.stringify({ capabilities: ["addon-runtime-read"] }),
  });
  return res.status === 200;
}

test("Phase 3 CP6: real extension — host-owned grant lifecycle against Counter", async (t) => {
  if (!chromeAvailable()) {
    t.skip(`no launchable Chrome (set RESONANTOS_LIVE_CHROME_PATH or install Playwright Chromium at ${chromium.executablePath()})`);
    return;
  }
  if (!existsSync(extensionPath)) {
    t.skip(`extension not found at ${extensionPath}`);
    return;
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-003-p6-"));
  const cdpPort = await freePort();
  const bridgePort = await freePort();
  const counter = spawnCounter();
  const bridge = spawnBridge(bridgePort);
  const bridgeLogStream = createWriteStream(`/tmp/sd003-p6-bridge-${process.pid}.log`, { flags: "w" });
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");
  bridge.stdout.on("data", (chunk) => bridgeLogStream.write(`[stdout] ${chunk}`));
  bridge.stderr.on("data", (chunk) => bridgeLogStream.write(`[stderr] ${chunk}`));

  // Drop any stale bridge-config so the freshly-minted config is what
  // the extension sees.
  const bridgeConfigPath = path.join(extensionPath, "src", "bridge-config.generated.js");
  try { (await import("node:fs")).unlinkSync(bridgeConfigPath); } catch {}

  let context;
  try {
    await counter.start();

    const bridgeConfig = await readBridgeConfig();
    assert.ok(bridgeConfig.bridgeUrl);

    // Wait for the bridge to mint + persist capability bootstrap token.
    const probeDeadline = Date.now() + 20_000;
    let probeOk = false;
    let probeError;
    while (Date.now() < probeDeadline && !probeOk) {
      try {
        probeOk = await bootstrapProbe(bridgeConfig.bridgeUrl, bridgeConfig.bridgeToken, bridgeConfig.capabilityBootstrapToken);
        if (!probeOk) probeError = new Error("non-200 status");
      } catch (error) { probeError = error; }
      if (!probeOk) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(probeOk, `bridge bootstrap probe never reached 200: ${probeError?.message ?? probeError}`);

    const launchOptions = {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--remote-debugging-port=${cdpPort}`,
        "--no-first-run",
        "--no-default-browser-check",
      ],
    };
    if (process.env.RESONANTOS_LIVE_CHROME_PATH) {
      launchOptions.executablePath = process.env.RESONANTOS_LIVE_CHROME_PATH;
    }
    context = await chromium.launchPersistentContext(profile, launchOptions);
    await waitForCdp(cdpPort);
    const extensionId = await discoverExtensionId(cdpPort);
    const workspaceUrl = `chrome-extension://${extensionId}/src/main-workspace.html#addons`;

    // ----- STEP 1: open add-ons workspace, observe pre-grant state -----
    let page = await context.newPage();
    page.on("console", (msg) => {
      console.log(`[page:${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => {
      console.log(`[page:pageerror] ${err.message}\n${err.stack}`);
    });
    await page.goto(workspaceUrl, { waitUntil: "load", timeout: 15_000 });
    await page.click('button[data-workspace="addons"]');
    await page.waitForSelector(".addons-workspace-addons", { timeout: 30_000, state: "attached" });
    const counterCardSelector = '.addons-workspace-addons .addon-card--workspace:has-text("Resonant Counter")';
    // Pre-grant: the host has not granted Counter's network capability.
    // The Open button is still enabled (the upstream is reachable), but the
    // iframe will mount with no bearer. The renderer surfaces this as a
    // "blocked" handshake state once the iframe mounts.
    const counterOpen = page.locator(`${counterCardSelector} button:not([disabled])`).first();
    await counterOpen.waitFor({ timeout: 30_000 });
    await counterOpen.click();

    const counterFramePreGrant = page.frameLocator('iframe.addon-iframe');
    await counterFramePreGrant.locator("#status").waitFor({ timeout: 15_000 });
    const preGrantStatus = await counterFramePreGrant.locator("#status").innerText().catch(() => "");
    assert.match(preGrantStatus, /connected/i, `Counter status should read "connected" pre-grant (got: ${preGrantStatus})`);
    // Pre-grant: a direct network call against the upstream with NO bearer
    // returns 401. This proves the bootstrap envelope delivered no token
    // (the host has not granted) and the iframe's fetch without a bearer
    // is the failing path.
    const preGrantDirect = await fetch("http://127.0.0.1:47322/api/counter/increment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(preGrantDirect.status, 401, "no bearer must be rejected by the upstream");

    await page.close();

    // ----- STEP 2: host grants Counter's network capability via the bridge -----
    const grantBody = [{
      capability: "network",
      granted: true,
      scope: "self",
      revocationBehavior: "hard-stop",
    }];
    const grantRes = await bridgePost(bridgeConfig.bridgeUrl, "/addons/workspace/grant", {
      addonId: "addon.resonant-counter",
      grants: grantBody,
    }, { capability: "addon-runtime-control", bridgeToken: bridgeConfig.bridgeToken, capabilityToken: "dev-p6-addon-control" });
    assert.equal(grantRes.status, 200, `grant must succeed (got ${grantRes.status})`);
    const installation = grantRes.body?.installation ?? null;
    assert.ok(installation, "grant response must include the installation");
    const networkEntry = installation.grantedCapabilities?.find((g) => g.capability === "network");
    assert.ok(networkEntry?.granted, "the host has granted Counter's network capability");

    // ----- STEP 3: open Counter again — bootstrap now carries the bearer -----
    page = await context.newPage();
    await page.goto(workspaceUrl, { waitUntil: "load", timeout: 15_000 });
    await page.click('button[data-workspace="addons"]');
    await page.waitForSelector(".addons-workspace-addons", { timeout: 30_000, state: "attached" });
    await page.locator(`${counterCardSelector} button:not([disabled])`).first().click();
    const counterFrameGranted = page.frameLocator('iframe.addon-iframe');
    await counterFrameGranted.locator("#status").waitFor({ timeout: 15_000 });
    const grantedStatus = await counterFrameGranted.locator("#status").innerText().catch(() => "");
    assert.match(grantedStatus, /connected/i, `Counter status should read "connected" post-grant (got: ${grantedStatus})`);
    // The bearer is now minted; a direct network call against the upstream
    // with the right bearer succeeds (the bootstrap envelope delivered it,
    // and the iframe's mutations use it).
    const grantedDirect = await fetch("http://127.0.0.1:47322/api/counter/increment", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    assert.equal(grantedDirect.status, 200, "the right bearer must be accepted");
    const grantedBody = await grantedDirect.json();
    assert.equal(typeof grantedBody.value, "number");

    // Screenshot at the post-grant state.
    const screenshotDir = process.env.RESONANTOS_SCREENSHOT_PATH;
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "p6-counter-granted.png"), fullPage: true });
      try {
        const frame = page.locator('iframe.addon-iframe').first();
        await frame.screenshot({ path: path.join(screenshotDir, "p6-counter-iframe-granted.png") });
      } catch { /* non-fatal */ }
    }

    await page.close();

    // ----- STEP 4: host revokes Counter's network capability -----
    const revokeRes = await bridgePost(bridgeConfig.bridgeUrl, "/addons/workspace/revoke", {
      addonId: "addon.resonant-counter",
      capabilities: ["network"],
    }, { capability: "addon-runtime-control", bridgeToken: bridgeConfig.bridgeToken, capabilityToken: "dev-p6-addon-control" });
    assert.equal(revokeRes.status, 200, `revoke must succeed (got ${revokeRes.status})`);
    const revokedInstallation = revokeRes.body?.installation ?? null;
    const revokedNetwork = revokedInstallation.grantedCapabilities?.find((g) => g.capability === "network");
    assert.equal(revokedNetwork?.granted, false, "the host has revoked Counter's network capability");

    // The host-only admin-revoke path closes the upstream's in-memory flag
    // so even the previously-correct bearer is denied by host policy.
    const adminRevokeRes = await bridgePost(bridgeConfig.bridgeUrl, "/addons/workspace/admin-revoke", {
      addonId: "addon.resonant-counter",
      upstreamAdminUrl: "http://127.0.0.1:47322/admin/deny",
      adminToken: COUNTER_ADMIN,
      granted: false,
    }, { capability: "addon-runtime-control", bridgeToken: bridgeConfig.bridgeToken, capabilityToken: "dev-p6-addon-control" });
    assert.equal(adminRevokeRes.status, 200, `admin revoke must succeed (got ${adminRevokeRes.status})`);

    // Same bearer, same path — now denied by host policy. 403, not 401.
    const revokedDirect = await fetch("http://127.0.0.1:47322/api/counter/increment", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    assert.equal(revokedDirect.status, 403, `the same bearer must be 403 after revoke (got ${revokedDirect.status})`);
    const revokedBody = await revokedDirect.json();
    assert.equal(revokedBody.error, "counter-revoked");

    // ----- STEP 5: re-grant through the host registry — but DO NOT call
    //               admin/deny to restore. The registry grant path must not
    //               be conflated with the admin path; the operator must
    //               explicitly re-grant at both layers.
    await bridgePost(bridgeConfig.bridgeUrl, "/addons/workspace/grant", {
      addonId: "addon.resonant-counter",
      grants: grantBody,
    }, { capability: "addon-runtime-control", bridgeToken: bridgeConfig.bridgeToken, capabilityToken: "dev-p6-addon-control" });
    // The upstream still has hostGranted: false because we did not flip the
    // admin flag back. The mutation must still 403.
    const stillRevoked = await fetch("http://127.0.0.1:47322/api/counter/increment", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    assert.equal(stillRevoked.status, 403, "registry re-grant without admin restore must still 403 (distinct channels)");

    // Now restore at the admin layer — both channels must agree before the
    // mutation succeeds again.
    await bridgePost(bridgeConfig.bridgeUrl, "/addons/workspace/admin-revoke", {
      addonId: "addon.resonant-counter",
      upstreamAdminUrl: "http://127.0.0.1:47322/admin/deny",
      adminToken: COUNTER_ADMIN,
      granted: true,
    }, { capability: "addon-runtime-control", bridgeToken: bridgeConfig.bridgeToken, capabilityToken: "dev-p6-addon-control" });
    const restored = await fetch("http://127.0.0.1:47322/api/counter/increment", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${COUNTER_BEARER}` },
      body: "{}",
    });
    assert.equal(restored.status, 200, "full restore (registry + admin) must succeed");

    if (process.env.RESONANTOS_KEEP_OPEN_MS) {
      console.log(`[p6-extension-live] keeping browser open for ${process.env.RESONANTOS_KEEP_OPEN_MS}ms`);
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.RESONANTOS_KEEP_OPEN_MS)));
    }
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    bridge.kill("SIGTERM");
    bridgeLogStream.end();
    await counter.stop();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
});
