// SDK-DEMO-003R T5 — real-extension proof of the operator grant/revoke UI.
//
// Exercises the NEW Add-ons workspace card controls against the real unpacked
// extension + real bridge + real Echo upstream:
//   1. discovered (uninstalled) card shows "Discovered" and offers Install
//   2. explicit Install flips the card to "Denied" (install grants nothing)
//   3. explicit Grant calls the host grant route; card becomes "Granted"
//   4. explicit Revoke calls the converged T4 revoke route; card becomes
//      "Denied" AND the same bearer is denied (403) at the upstream.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

import { createEchoServer } from "../echo/server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const extensionPath = path.join(repoRoot, "browser-first", "resonantos-side-panel-extension");

const ECHO_BEARER = "t5-ui-echo-bearer";
const ECHO_ADMIN = "t5-ui-echo-admin";
const BRIDGE_TOKEN = "t5-ui-bridge-token";
const ECHO_PORT = 47321;

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
    } catch (error) { lastError = error; }
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
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Could not discover extension id from CDP targets");
}

async function readBridgeConfig(bridgePath = path.join(extensionPath, "src", "bridge-config.generated.js"), { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(bridgePath)) {
      try {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(bridgePath, "utf8");
        const match = /__RESONANTOS_BRIDGE_CONFIG__ = Object\.freeze\((.+?)\);/s.exec(content);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.bridgeToken === BRIDGE_TOKEN) return parsed;
        }
      } catch { /* keep polling */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("bridge-config.generated.js never appeared");
}

function spawnBridge(bridgePort, userRoot) {
  const bridgePath = path.join(repoRoot, "browser-first", "host", "run-bridge-minimal.mjs");
  const args = [
    bridgePath,
    `--bridge-port=${bridgePort}`,
    `--bridge-token=${BRIDGE_TOKEN}`,
    "--addon-runtime-read-token=t5-ui-addon-read",
    "--addon-runtime-control-token=t5-ui-addon-control",
    `--workspace-addon-credentials=${JSON.stringify({ "addon.resonant-echo": { bearer: ECHO_BEARER, adminToken: ECHO_ADMIN } })}`,
  ];
  // Isolate the durable harness registry to a fresh tmp root. The launcher
  // reads RESONANTOS_BROWSER_FIRST_USER_ROOT (its --user-root flag is not
  // wired), so this keeps the demo deterministic and avoids reusing grants
  // left by other live tests in ~/ResonantOS_User.
  return spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, RESONANTOS_BROWSER_FIRST_USER_ROOT: userRoot },
  });
}

test("T5 real extension exercises operator grant/revoke UI (install -> grant -> revoke)", async (t) => {
  if (!chromeAvailable()) {
    t.skip(`no launchable Chrome (set RESONANTOS_LIVE_CHROME_PATH or install Playwright Chromium at ${chromium.executablePath()})`);
    return;
  }
  if (!existsSync(extensionPath)) {
    t.skip(`extension not found at ${extensionPath}`);
    return;
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), "sd003-t5-ui-"));
  const userRoot = await mkdtemp(path.join(os.tmpdir(), "sd003-t5-ui-userroot-"));
  const cdpPort = await freePort();
  const bridgePort = await freePort();

  const echo = createEchoServer({ port: ECHO_PORT, bearerToken: ECHO_BEARER, adminToken: ECHO_ADMIN });
  await echo.start();
  const bridge = spawnBridge(bridgePort, userRoot);
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");
  bridge.stdout.on("data", () => {});
  bridge.stderr.on("data", () => {});

  const bridgeConfigPath = path.join(extensionPath, "src", "bridge-config.generated.js");
  try { (await import("node:fs")).unlinkSync(bridgeConfigPath); } catch {}

  let context;
  try {
    const bridgeConfig = await readBridgeConfig();
    assert.ok(bridgeConfig.bridgeUrl);

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

    const page = await context.newPage();
    await page.goto(workspaceUrl, { waitUntil: "load", timeout: 15_000 });
    await page.click('button[data-workspace="addons"]');
    await page.waitForSelector(".addons-workspace-addons", { timeout: 30_000, state: "attached" });

    const cardSelector = '.addons-workspace-addons .addon-card--workspace:has-text("Resonant Echo")';
    const card = page.locator(cardSelector);
    await card.waitFor({ timeout: 30_000 });

    const cardText = () => card.innerText();
    const waitForText = async (re, { timeoutMs = 15_000, intervalMs = 200 } = {}) => {
      const deadline = Date.now() + timeoutMs;
      let text = "";
      while (Date.now() < deadline) {
        text = await cardText().catch(() => "");
        if (re.test(text)) return text;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      throw new Error(`card did not reach ${re} (last text: ${JSON.stringify(text)})`);
    };
    const clickButton = async (label) => {
      const btn = card.locator("button").filter({ hasText: label }).first();
      await btn.waitFor({ timeout: 30_000 });
      await btn.click();
    };

    // 1. Discovered (uninstalled): no granted authority, explicit Install offered.
    await waitForText(/discovered/i);
    assert.match(await cardText(), /Install Resonant Echo/);

    // 2. Explicit install: card flips to Denied (install grants nothing).
    await clickButton("Install Resonant Echo");
    await waitForText(/denied/i);
    assert.match(await cardText(), /Grant requested capabilities/);

    // 3. Explicit grant: card flips to Granted (authoritative re-read).
    await clickButton("Grant requested capabilities");
    await waitForText(/granted/i);
    const grantedDirect = await fetch(`http://127.0.0.1:${ECHO_PORT}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "t5-ui" }),
    });
    assert.equal(grantedDirect.status, 200, "bearer must be accepted after grant");

    // 4. Explicit revoke: card flips to Denied AND upstream enforcement closes.
    await clickButton("Revoke granted capabilities");
    await waitForText(/denied/i);
    assert.match(await cardText(), /Grant requested capabilities/);
    const revokedDirect = await fetch(`http://127.0.0.1:${ECHO_PORT}/api/echo/message`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ECHO_BEARER}` },
      body: JSON.stringify({ message: "t5-ui" }),
    });
    assert.equal(revokedDirect.status, 403, "same bearer must be 403 after UI revoke (converged T4)");

    await page.close();
  } finally {
    if (context) await context.close().catch(() => undefined);
    bridge.kill("SIGTERM");
    await new Promise((resolve) => bridge.once("exit", resolve));
    await echo.close();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
    await rm(userRoot, { recursive: true, force: true }).catch(() => undefined);
  }
});
