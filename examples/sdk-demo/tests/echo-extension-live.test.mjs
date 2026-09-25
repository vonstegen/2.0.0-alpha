// CP3 gate: REAL-EXTENSION end-to-end for the SDK-DEMO-003 Echo add-on.
//
// This is the Phase-1 (CP3) deliverable the handoff explicitly required: load
// the actual unpacked `browser-first/resonantos-side-panel-extension` in
// Chrome, navigate to Add-ons → Workspace add-ons → Open Resonant Echo,
// type a message, click SEND, and assert the visible response renders the
// expected text from the add-on's own loopback upstream.
//
// Hard rules (forbidden by the handoff):
//   * no `--disable-extensions`
//   * no `Page.addScriptToEvaluateOnNewDocument`
//   * no mock bridge that skips auth/CORS/origin checks
//
// Skip policy: if Chrome is unavailable the test SKIPS with a reason (never
// reports a pass it did not earn). Set RESONANTOS_LIVE_CHROME_PATH to point
// at a Chrome the harness can launch.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
// Discover the extension ID at runtime via CDP — Chrome computes the
// unpacked-extension id from the manifest `key` field. Hard-coding it would
// make this test depend on a single manifest key string and break whenever a
// developer rotates it.
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
    } catch {
      // CDP may transiently reject; keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Could not discover extension id from CDP targets on port ${cdpPort} within ${timeoutMs}ms`);
}

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

async function waitForHttp(url, { timeoutMs = 15_000, intervalMs = 100 } = {}) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`status ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? lastError}`);
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

function spawnBridge(bridgePort) {
  const bridgePath = path.join(repoRoot, "browser-first", "host", "run-bridge-minimal.mjs");
  const args = [
    bridgePath,
    `--bridge-port=${bridgePort}`,
    "--bridge-token=dev-echo-bridge-token",
    "--addon-runtime-read-token=dev-echo-addon-read",
    "--addon-runtime-control-token=dev-echo-addon-control",
  ];
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

function spawnEcho() {
  // The Echo upstream must listen on the loopback port the manifest
  // declares in `service.entrypoint` (47321 in examples/sdk-demo/echo/addon.json).
  // The manifest is the operator's contract — the host never rewrites it.
  // We free the port first in case a stray echo from an earlier run is holding it.
  let service = null;
  const port = 47321;
  const host = "127.0.0.1";
  return {
    async start() {
      service = createEchoServer({ port, host });
      const started = await service.start();
      return started.port;
    },
    get port() { return port; },
    get host() { return host; },
    origin() { return `http://${host}:${port}`; },
    async stop() {
      if (service) { await service.close(); service = null; }
    },
  };
}

test("Phase 1 CP3: real extension loads, opens Echo workspace, and echoes a message", async (t) => {
  if (!chromeAvailable()) {
    t.skip(`no launchable Chrome (set RESONANTOS_LIVE_CHROME_PATH or install Playwright Chromium at ${chromium.executablePath()})`);
    return;
  }
  if (!existsSync(extensionPath)) {
    t.skip(`extension not found at ${extensionPath}`);
    return;
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-003-cp3-"));
  const cdpPort = await freePort();
  const bridgePort = await freePort();
  const echo = spawnEcho();
  // Delete any stale bridge-config.generated.js from prior test runs so the
  // bridge's freshly-minted token and resolved port are what this test reads.
  const bridgeConfigPath = path.join(extensionPath, "src", "bridge-config.generated.js");
  try { (await import("node:fs")).unlinkSync(bridgeConfigPath); } catch {}

  const bridge = spawnBridge(bridgePort);
  // Persist the bridge log to a stable location — the profile dir is removed
  // in the finally block, but having the log available if the test fails
  // before then lets us diagnose. The log filename is captured so we can
  // print it on failure.
  const bridgeLogPath = `/tmp/sd003-${Date.now()}-${process.pid}-bridge.log`;
  const bridgeLogStream = (await import("node:fs")).createWriteStream(bridgeLogPath, { flags: "w" });
  bridge.stdout.setEncoding("utf8");
  bridge.stderr.setEncoding("utf8");
  bridge.stdout.on("data", (chunk) => bridgeLogStream.write(`[stdout] ${chunk}`));
  bridge.stderr.on("data", (chunk) => bridgeLogStream.write(`[stderr] ${chunk}`));

  let context;
  try {
    await echo.start();
    const echoHealthUrl = `${echo.origin()}/health`;
    const echoHealthResponse = await fetch(echoHealthUrl);
    assert.equal(echoHealthResponse.status, 200, "Echo upstream must be healthy");

    // Wait for the bridge to write its bridge-config.generated.js (the
    // bootstrap token it minted). The bridge's HTTP loopback URL is the
    // authoritative source — its port may differ from `bridgePort` if it
    // fell back to an ephemeral port (startBridgeServerWithFallback).
    const bridgeConfigPath = path.join(extensionPath, "src", "bridge-config.generated.js");
    const configWaitDeadline = Date.now() + 20_000;
    let bridgeConfig;
    while (Date.now() < configWaitDeadline) {
      if (existsSync(bridgeConfigPath)) {
        try {
          const content = readFileSync(bridgeConfigPath, "utf8");
          const match = /__RESONANTOS_BRIDGE_CONFIG__ = Object\.freeze\((.+?)\);/s.exec(content);
          if (match) {
            const parsed = JSON.parse(match[1]);
            if (parsed.bridgeToken === "dev-echo-bridge-token") {
              bridgeConfig = parsed;
              break;
            }
          }
        } catch {
          /* file may be partial during write; keep polling */
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(bridgeConfig, "bridge must write bridge-config.generated.js with our pinned bridge token");
    assert.ok(bridgeConfig.capabilityBootstrapToken, "bridge config must carry the capability bootstrap token");
    assert.ok(bridgeConfig.bridgeUrl, "bridge config must carry the resolved bridge URL");

    // Probe the bootstrap endpoint to verify bridge HTTP loopback is actually
    // accepting connections (the config write can race with the listening socket).
    const probeDeadline = Date.now() + 20_000;
    let probeOk = false;
    let probeError = null;
    while (Date.now() < probeDeadline && !probeOk) {
      try {
        const res = await fetch(`${bridgeConfig.bridgeUrl.replace(/\/$/, "")}/api/capability-tokens`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-resonantos-bridge-token": "dev-echo-bridge-token",
            "x-resonantos-capability-bootstrap-token": bridgeConfig.capabilityBootstrapToken,
          },
          body: JSON.stringify({ capabilities: ["addon-runtime-read"] }),
        });
        probeOk = res.status === 200;
        if (!probeOk) probeError = new Error(`status ${res.status}`);
      } catch (error) {
        probeError = error;
      }
      if (!probeOk) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(probeOk, `bridge bootstrap probe never reached 200: ${probeError?.message ?? probeError}`);

    // The unpacked extension requires a real (headed) Chrome session:
    // Chromium's --headless mode does not load unpacked extensions. The
    // existing browser-first/test/live-sdk-lane.mjs uses the same headed
    // launch — the CI workflow `agent-control-live` pairs it with xvfb on
    // Linux runners; on macOS this session is the user's display.
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
    const workspaceUrl = `chrome-extension://${extensionId}/src/main-workspace.html`;
    const targetUrl = `${workspaceUrl}#addons`;

    const page = await context.newPage();
    // Navigate the test page directly to the real extension's workspace URL
    // (the harness load is local unpacked — the service worker and extension
    // pages are reachable through the context).
    await page.goto(targetUrl, { waitUntil: "load", timeout: 15_000 });
    // Wait for the rail to render so we know main-workspace.js bound.
    await page.waitForSelector('button[data-workspace="addons"]', { timeout: 30_000 });

    // Open the addons workspace.
    await page.click('button[data-workspace="addons"]');
    // Wait for the workspace-addons section (created by Phase 1 P3 wiring).
    // The section header text is rendered into a button label and dataset.tone.
    await page.waitForSelector(".addons-workspace-addons", { timeout: 30_000, state: "attached" });

    // The Open button for an addon.resonant-echo card must be enabled because
    // the loopback probe just confirmed the upstream is reachable.
    const echoCardSelector = '.addons-workspace-addons .addon-card--workspace:has-text("Resonant Echo")';
    const openButton = page.locator(`${echoCardSelector} button:not([disabled])`).first();
    await openButton.waitFor({ timeout: 30_000 });
    assert.ok(await openButton.isEnabled(), "Resonant Echo Open button must be enabled while upstream is healthy");

    await openButton.click();

    // Workspace-iframe workspace renders an <iframe> with src pointing at
    // the add-on's own origin and sandbox=allow-scripts allow-same-origin.
    const addonIframe = await page.waitForSelector(
      'iframe.addon-iframe[src^="http://127.0.0.1:"]',
      { timeout: 30_000 },
    );
    const iframeSrc = await addonIframe.getAttribute("src");
    assert.equal(iframeSrc, echo.origin(), "workspace-iframe must point at the Echo origin");
    const sandbox = await addonIframe.getAttribute("sandbox");
    assert.equal(sandbox, "allow-scripts allow-same-origin");

    // The iframe is on the add-on's origin (sandboxed). Drive it through the
    // frame's own page object — Playwright's frameLocator resolves nested
    // frames automatically. This is the real add-on's DOM, not a test stub.
    //
    // Sandbox iframes are observable via the page's MainFrame `childFrames()`
    // once the load event has completed; we wait explicitly for that here.
    const addonFrameLocator = page.frameLocator('iframe.addon-iframe');
    // Wait for the iframe to mount its DOM (the page listener handles the
    // bootstrap envelope before flipping the SEND button out of disabled).
    const sendButton = addonFrameLocator.locator("#send");
    await sendButton.waitFor({ state: "attached", timeout: 30_000 });
    // Poll the button state (the bootstrap listener flips `disabled=false`
    // asynchronously after the postMessage arrives at the add-on).
    const sendReadyDeadline = Date.now() + 30_000;
    let sendEnabled = false;
    while (Date.now() < sendReadyDeadline) {
      sendEnabled = await sendButton.isEnabled().catch(() => false);
      if (sendEnabled) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(sendEnabled, "Echo SEND button must be enabled — bootstrap envelope should have been delivered");

    const statusText = await addonFrameLocator.locator("#status").innerText();
    assert.match(statusText, /connected/i, `Echo status should read "connected" (got: ${statusText})`);

    // Type a message and click SEND. This is a same-origin fetch to the
    // loopback upstream — no bridge token, no env inheritance.
    await addonFrameLocator.locator("#message").fill("Hello Manolo");
    await addonFrameLocator.locator("#send").click();

    // Wait for the response to render. The fetch happens async inside the
    // iframe; we just polled the #response element above until non-empty.
    const responseDeadline = Date.now() + 15_000;
    let responseText = "";
    while (Date.now() < responseDeadline) {
      responseText = await addonFrameLocator.locator("#response").innerText().catch(() => "");
      if (responseText) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.equal(
      responseText,
      `Resonant Echo received: "Hello Manolo"`,
      "visible Echo response must match the expected hard-coded string",
    );

    // Screenshot the round-trip end state. Works headless (page.screenshot()
    // does not need a display) — set RESONANTOS_SCREENSHOT_PATH to capture.
    const screenshotDir = process.env.RESONANTOS_SCREENSHOT_PATH;
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, "workspace-addons.png"), fullPage: true });
      try {
        const echoFrameHandle = page.locator('iframe.addon-iframe').first();
        await echoFrameHandle.screenshot({ path: path.join(screenshotDir, "echo-iframe.png") });
      } catch { /* non-fatal if iframe is not paintable */ }
      console.log(`[echo-extension-live] screenshots written under ${screenshotDir}`);
    }

    // Manual inspection hook: hold the browser window open for N ms after
    // assertions so a developer can poke at it. CI never sets this env.
    const keepOpenMs = Number(process.env.RESONANTOS_KEEP_OPEN_MS ?? 0);
    if (keepOpenMs > 0) {
      console.log(`[echo-extension-live] keeping browser open for ${keepOpenMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, keepOpenMs));
    }

    await page.close();
  } finally {
    if (context) {
      await context.close().catch(() => undefined);
    }
    bridge.kill("SIGTERM");
    bridgeLogStream.end();
    await echo.stop();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
});
