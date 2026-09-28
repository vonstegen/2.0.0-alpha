// SDK-CATEGORY-001 graphical proof (CP12): the dynamic right-side tool rail
// derives a Pi entry from its validated tool-panel surface declaration and
// lifecycle, with no Pi-specific code. Requires a headed browser (xvfb) and a
// loopback bridge; SKIPs when Chrome is unavailable.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

import {
  CdpClient,
  captureScreenshotArtifact,
  evaluate,
  freeLoopbackPort,
  launchExtensionContext,
  resonantExtensionId,
  stageExtensionCopy,
} from "./live-harness.mjs";
import { RUNTIME_CAPABILITY_ALLOWLIST } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function chromeAvailable() {
  const override = process.env.RESONANTOS_LIVE_CHROME_PATH;
  if (override) return existsSync(override);
  try { return existsSync(chromium.executablePath()); } catch { return false; }
}

async function readGeneratedConfig(configPath) {
  let source;
  try { source = await readFile(configPath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const match = source.trim().match(/^globalThis\.__RESONANTOS_BRIDGE_CONFIG__ = Object\.freeze\(([\s\S]+)\);$/);
  return match ? JSON.parse(match[1]) : null;
}

async function waitFor(fn, { timeoutMs = 20_000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("dynamic tool rail derives Pi from surface declaration and honors disable lifecycle", { concurrency: false }, async (t) => {
  if (!chromeAvailable()) {
    t.skip("no launchable Chrome (set RESONANTOS_LIVE_CHROME_PATH or install Playwright Chromium)");
    return;
  }
  if (!process.env.DISPLAY) {
    t.skip("no X display for headed Chromium (run under xvfb-run -a)");
    return;
  }
  const userRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-tool-rail-user-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "resonantos-tool-rail-artifacts-"));
  const staged = await stageExtensionCopy(repoRoot);
  const bridgeConfigPath = path.join(staged.extensionRoot, "src", "bridge-config.generated.js");
  const bridgePort = await freeLoopbackPort();
  const debugPort = await freeLoopbackPort();
  let bridge = null;
  let browserContext = null;
  let page = null;

  const manifest = JSON.parse(await readFile(path.join(repoRoot, "examples/addons/pi-harness.json"), "utf8"));
  const bindings = JSON.stringify([{
    name: "openai.compatible",
    addonId: "addon.pi-harness",
    adapterId: "openai-compatible-v1",
    authScheme: "bearer",
    source: { providerProfileId: "graphical-test-profile" },
  }]);

  try {
    bridge = spawn(process.execPath, ["browser-first/host/run-bridge-minimal.mjs", `--bridge-port=${bridgePort}`], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RESONANTOS_BROWSER_FIRST_USER_ROOT: userRoot,
        RESONANTOS_BROWSER_FIRST_BRIDGE_PORT: String(bridgePort),
        RESONANTOS_EXTENSION_ROOT: staged.extensionRoot,
        RESONANTOS_HARNESS_BINDINGS: bindings,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const config = await waitFor(async () => readGeneratedConfig(bridgeConfigPath), { label: "generated bridge config" });
    const bridgeUrl = config.bridgeUrl;

    const tokensResponse = await fetch(`${bridgeUrl}/api/capability-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ResonantOS-Bridge-Token": config.bridgeToken,
        "X-ResonantOS-Capability-Bootstrap-Token": config.capabilityBootstrapToken,
      },
      body: JSON.stringify({ capabilities: RUNTIME_CAPABILITY_ALLOWLIST }),
    });
    const tokensPayload = await tokensResponse.json().catch(() => ({}));
    assert.equal(tokensResponse.status, 200, `capability bootstrap failed: ${JSON.stringify(tokensPayload)}`);
    const capabilityToken = tokensPayload.capabilityTokens?.["addon-runtime-control"] ?? tokensPayload.capabilityTokens?.["addon-runtime-read"];

    const bridgeCall = async (route, body) => {
      const response = await fetch(`${bridgeUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ResonantOS-Bridge-Token": config.bridgeToken,
          "X-ResonantOS-Bridge-Capability-Token": tokensPayload.capabilityTokens["addon-runtime-control"],
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return response.json().catch(() => ({}));
    };

    // Install + grant + enable + assign Pi through the host-owned routes.
    const installed = await bridgeCall("/addons/install", { manifest, enabled: true });
    assert.equal(installed.ok, true, `install failed: ${JSON.stringify(installed)}`);
    const revision = installed.revision;
    const grants = manifest.requestedCapabilities.map((g) => ({ ...g, granted: true }));
    const granted = await bridgeCall("/addons/grants", { addonId: manifest.id, grants, consent: true, expectedRevision: revision });
    assert.equal(granted.ok, true, `grant failed: ${JSON.stringify(granted)}`);
    const assigned = await bridgeCall("/addons/slots/assign", { slot: "primary-agent", addonId: manifest.id, expectedGeneration: 0, replace: true });
    assert.equal(assigned.ok, true, `assign failed: ${JSON.stringify(assigned)}`);

    // Open the real main-workspace page and verify the dynamic rail entry.
    const launched = await launchExtensionContext({ repoRoot, debugPort, executablePath: process.env.RESONANTOS_LIVE_CHROME_PATH, extensionPath: staged.extensionRoot });
    browserContext = launched.browserContext;
    const first = browserContext.pages()[0] ?? await browserContext.newPage();
    await first.goto("about:blank").catch(() => undefined);
    const pageUrl = `chrome-extension://${resonantExtensionId}/src/main-workspace.html`;
    const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: "PUT" }).then((r) => r.json());
    page = new CdpClient(created.webSocketDebuggerUrl);
    await page.connect();
    await page.send("Runtime.enable");
    await page.send("Page.enable");

    await waitFor(async () => {
      const state = await evaluate(page, `(() => {
        const item = document.querySelector('#tool-rail-list button[data-addon-id="addon.pi-harness"]');
        return item ? { found: true, label: item.textContent } : null;
      })()`).then((r) => r.result?.value ?? null);
      return state;
    }, { label: "Pi tool-rail entry" });

    // Click the Pi entry and verify the harness workspace/options panel.
    await evaluate(page, `document.querySelector('#tool-rail-list button[data-addon-id="addon.pi-harness"]')?.click()`);
    const panel = await waitFor(async () => {
      const state = await evaluate(page, `(() => {
        const panel = document.querySelector('.tool-workspace');
        return panel ? { text: panel.textContent } : null;
      })()`).then((r) => r.result?.value ?? null);
      return state;
    }, { label: "Pi workspace panel" });
    assert.match(panel.text, /Pi Harness/);
    assert.match(panel.text, /provider-profile/);
    assert.match(panel.text, /active/); // primary-agent assigned
    const panelScreenshot = path.join(artifactDir, "pi-tool-rail-panel.png");
    await captureScreenshotArtifact(page, panelScreenshot);

    // Disable Pi through the host route; the rail must drop the entry.
    const disabled = await bridgeCall("/addons/enabled", { addonId: manifest.id, enabled: false, expectedRevision: assigned.revision });
    assert.equal(disabled.ok, true, `disable failed: ${JSON.stringify(disabled)}`);
    await evaluate(page, `location.reload()`);
    await waitFor(async () => {
      const state = await evaluate(page, `(() => {
        const item = document.querySelector('#tool-rail-list button[data-addon-id="addon.pi-harness"]');
        const empty = document.querySelector('#tool-rail-empty');
        return item === null && (empty ? !empty.hidden : true) ? { gone: true } : null;
      })()`).then((r) => r.result?.value ?? null);
      return state;
    }, { label: "Pi rail entry removal after disable" });

    return "Pi dynamic rail entry + workspace panel + disable lifecycle proven";
  } finally {
    page?.close();
    await browserContext?.close().catch(() => undefined);
    if (bridge && bridge.exitCode === null) bridge.kill("SIGTERM");
    await rm(userRoot, { recursive: true, force: true });
    await rm(staged.root, { recursive: true, force: true });
    await rm(artifactDir, { recursive: true, force: true });
  }
});
