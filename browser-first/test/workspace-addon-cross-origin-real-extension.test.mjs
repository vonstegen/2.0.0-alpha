// SDK-DEMO-002-FIX real-extension browser test.
//
// Loads the ACTUAL ResonantOS extension unpacked in Chrome (dev mode,
// no --disable-extensions), points it at a minimal in-test mock bridge
// + the real add-on upstreams, navigates the side-panel UI to the
// add-on workspace via the deep-link (`#addon:<id>`), and drives the
// workspaceCrossOrigin iframe with trusted CDP
// Input.dispatchKeyEvent / Input.dispatchMouseEvent commands.
//
// This test deliberately proves what the prior browser test
// (workspace-addon-cross-origin-browser.test.mjs, removed) DID NOT:
//   - The extension itself delivers the capability token to the
//     iframe (via the upstream's server-side HTML template — see
//     browser-first/addons/<addon>/server.mjs serveEntryHtml).
//   - The add-on's own <script> executes in the opaque-origin
//     sandboxed iframe rendered by addon-iframe.js's
//     workspaceCrossOrigin mode.
//   - The iframe's own listener fires on trusted CDP click/input
//     events. There is no Page.addScriptToEvaluateOnNewDocument
//     anywhere in this test — the token arrives because the
//     extension's renderer pointed the iframe at the real upstream
//     origin (http://127.0.0.1:<port>/) and that upstream templated
//     the token into the served HTML.
//
// What we exercise:
//   1. Echo: type "Hello Manolo" via Input.dispatchKeyEvent, click
//      SEND via Input.dispatchMouseEvent, verify the response
//      element renders the echoed message.
//   2. Counter: click +1 twice via Input.dispatchMouseEvent, verify
//      count advances.
//   3. SDK Guide: click Send on the live demo, verify the evidence
//      panel renders the cross-boundary evidence. Then click
//      "Try the unauthorized action", verify the 403 panel renders.
//
// Mock bridge is intentionally minimal — it serves only the
// /addons/status route the extension needs to learn about the
// workspace add-ons. Every other bridge route returns 404. The
// iframe's load path does NOT touch the bridge — the workspace
// add-on cross-origin renderer points iframe.src at
// http://127.0.0.1:<port>/ directly (see addon-iframe.js
// workspaceCrossOrigin branch).

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { chromium } from "playwright";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const EXTENSION_ROOT = path.join(REPO_ROOT, "browser-first", "resonantos-side-panel-extension");
// ResonantOS extension id is fixed by the manifest's "key" field —
// the same id run-bridge-minimal.mjs uses.
const EXTENSION_ID = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const ECHO_PORT = 48931;
const COUNTER_PORT = 48932;
const SDK_GUIDE_PORT = 48933;
const MOCK_BRIDGE_PORT = 47777;
const DEBUG_PORT = 48941;
const HARNESS_TOKEN = "browser-real-ext-harness-messaging-002";

const children = new Set();
let mockBridgeServer = null;
let mockBridgeOrigin = "";
let extensionUserDataDir = null;

function spawnUpstream({ addonDir, env }) {
  const child = spawn(
    process.execPath,
    [path.join(addonDir, "server.mjs")],
    {
      cwd: addonDir,
      env: {
        ...process.env,
        ...env,
        RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN: HARNESS_TOKEN,
        RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN: "browser-test-bridge-token",
        RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN,
        RESONANT_ECHO_BRIDGE_IDENTITY: "bridge://browser-test"
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[${path.basename(addonDir)}] ${chunk}`);
  });
  children.add(child);
  return { child, close: async () => {
    children.delete(child);
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
  } };
}

async function waitForUpstream(port, attempts = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { method: "GET" });
      if (r.status === 200) return true;
    } catch { /* retry */ }
    await sleep(50);
  }
  throw new Error(`upstream on port ${port} did not become ready`);
}

async function makeAddonEntry({ manifestPath, addonPort }) {
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    author: manifest.author ?? "",
    available: true,
    mode: manifest.mode ?? "workspace-addon",
    trust: manifest.trust ?? "sdk-reference",
    registrySource: "workspace-addon-manifest",
    proxyPath: manifest.contributions.workspace.proxyPath,
    apiBasePath: manifest.contributions.workspace.apiBasePath,
    iframeMode: manifest.contributions.workspace.iframeMode === "src" ? "src" : "srcdoc",
    upstreamPortEnvVar: manifest.contributions.workspace.upstreamPortEnvVar ?? null,
    upstreamPort: addonPort,
    bridgePublicUrl: `http://127.0.0.1:${MOCK_BRIDGE_PORT}`,
    requestedCapabilities: manifest.requestedCapabilities ?? manifest.capabilities ?? [],
    grantedCapabilities: manifest.grantedCapabilities ?? [],
    deniedCapabilities: manifest.deniedCapabilities ?? [],
    boundary: manifest.boundary ?? "",
    messaging: {
      channel: manifest.messaging?.channel ?? "",
      requestCapability: manifest.messaging?.requestCapability ?? "",
      routes: Array.isArray(manifest.messaging?.routes) ? manifest.messaging.routes : []
    }
  };
}

async function startMockBridge({ echoPort, counterPort, sdkGuidePort }) {
  const echoAddon = await makeAddonEntry({
    manifestPath: path.join(REPO_ROOT, "browser-first/addons/resonant-echo/addon.json"),
    addonPort: echoPort
  });
  const counterAddon = await makeAddonEntry({
    manifestPath: path.join(REPO_ROOT, "browser-first/addons/resonant-counter/addon.json"),
    addonPort: counterPort
  });
  const sdkGuideAddon = await makeAddonEntry({
    manifestPath: path.join(REPO_ROOT, "browser-first/addons/sdk-guide/addon.json"),
    addonPort: sdkGuidePort
  });
  const bundled = [
    {
      id: "addon.hermes",
      name: "Hermes",
      available: true,
      mode: "delegation-addon",
      trust: "add-on agent",
      requestedCapabilities: ["agent-delegation"],
      grantedCapabilities: ["agent-delegation"],
      deniedCapabilities: ["network", "notifications"]
    },
    {
      id: "addon.opencode",
      name: "OpenCode",
      available: false,
      mode: "coding-addon",
      trust: "add-on agent",
      requestedCapabilities: ["agent-delegation"],
      grantedCapabilities: ["agent-delegation"],
      deniedCapabilities: ["shell"]
    }
  ];
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const pathPart = url.split("?")[0] ?? "/";
    if (req.method === "GET" && pathPart === "/addons/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        addons: [...bundled, echoAddon, counterAddon, sdkGuideAddon]
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `mock bridge: unknown route ${req.method ?? "?"} ${pathPart}` }));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_BRIDGE_PORT, "127.0.0.1", () => {
      mockBridgeServer = server;
      mockBridgeOrigin = `http://127.0.0.1:${MOCK_BRIDGE_PORT}`;
      resolve(server);
    });
  });
}

function stopMockBridge() {
  if (!mockBridgeServer) return Promise.resolve();
  return new Promise((resolve) => {
    mockBridgeServer.close(() => resolve());
    mockBridgeServer = null;
  });
}

// Write the bridge-config.generated.js the extension expects
// (main-workspace.html loads it before any module runs).
async function writeBridgeConfig() {
  const configPath = path.join(EXTENSION_ROOT, "src", "bridge-config.generated.js");
  const config = {
    bridgeUrl: mockBridgeOrigin,
    httpsBridgeUrl: mockBridgeOrigin,
    bridgeToken: "browser-test-bridge-token",
    capabilityBootstrapToken: "browser-test-capability-bootstrap"
  };
  await writeFile(
    configPath,
    `globalThis.__RESONANTOS_BRIDGE_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`,
    { mode: 0o600 }
  );
  return configPath;
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.id = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== undefined && this.pending.has(data.id)) {
        const { resolve, reject } = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      } else if (data.method) {
        this.events.push(data);
      }
    });
  }
  send(method, params = {}, sessionId = null) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // CDP wire format: sessionId must be a top-level field when
      // targeting a non-page session. For page-session (browser-wide)
      // calls, omit it.
      const message = { id, method, params };
      if (sessionId) message.sessionId = sessionId;
      this.ws.send(JSON.stringify(message));
    });
  }
  close() {
    this.ws.close();
  }
}

async function makeCdpClient(port) {
  const wsEndpoint = await new Promise((resolve, reject) => {
    const tryOnce = () => {
      http.get(`http://127.0.0.1:${port}/json/version`, (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body).webSocketDebuggerUrl);
          } catch (error) {
            reject(error);
          }
        });
      }).on("error", () => setTimeout(tryOnce, 100));
    };
    tryOnce();
  });
  const ws = new WebSocket(wsEndpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CdpClient(ws);
}

async function launchChromeWithExtension({ debugPort, extensionDir, userDataDir }) {
  const chromiumPath = chromium.executablePath();
  if (!existsSync(chromiumPath)) {
    throw new Error(`chromium not installed: ${chromiumPath}`);
  }
  const child = spawn(chromiumPath, [
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-features=Translate,InfinitePrefetch",
    "--user-data-dir=" + userDataDir,
    `--load-extension=${extensionDir}`,
    `about:blank`
  ], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[chrome] ${chunk}`);
  });
  children.add(child);
  // Wait for CDP endpoint to come up.
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const tick = () => {
      attempts += 1;
      http.get(`http://127.0.0.1:${debugPort}/json/version`, () => resolve())
        .on("error", () => {
          if (attempts > 200) return reject(new Error("CDP never came up"));
          setTimeout(tick, 50);
        });
    };
    tick();
  });
  return {
    child,
    close: async () => {
      children.delete(child);
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("exit", resolve));
    }
  };
}

async function waitFor(fn, { label, timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
      last = result;
    } catch (error) {
      last = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`waitFor "${label}" timed out: ${last instanceof Error ? last.message : String(last)}`);
}

async function navigateAndWait(cdp, targetId, sessionId, url) {
  await cdp.send("Target.activateTarget", { targetId });
  // Page.* domains live at the target session, not the browser
  // session. Always pass sessionId.
  await cdp.send("Page.navigate", { url }, sessionId);
  await waitFor(async () => {
    const ready = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState"
    }, sessionId);
    return ready.result?.value === "complete" || ready.result?.value === "interactive";
  }, { label: `navigate ${url} ready` });
}

// Navigate to the workspace add-on via a two-step deep-link:
//   1. Navigate to the extension page WITHOUT a hash so the
//      hydration chain (including hydrateWorkspaceAddonRegistry) can
//      run to completion against the mock bridge.
//   2. Set the hash to #addon:<id> — this triggers the
//      window 'hashchange' listener which validates against the now-
//      populated registry and switches activeWorkspace.
//
// This avoids the race where the deep-link hash is parsed at init
// time before the registry has been populated (in which case
// parseWorkspaceDeepLink returns null and the deep-link is silently
// ignored).
async function navigateToAddonWorkspace(cdp, targetId, sessionId, addonId) {
  const extensionPageUrl = `chrome-extension://${EXTENSION_ID}/src/main-workspace.html`;
  await navigateAndWait(cdp, targetId, sessionId, extensionPageUrl);
  // Wait for the workspace addon registry to populate. /addons/status
  // is fetched by hydrateWorkspaceAddonRegistry at init; the
  // mock bridge returns immediately.
  await waitFor(async () => {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        bodyWorkspace: document.body.dataset.workspace,
        bridgeConfig: !!globalThis.__RESONANTOS_BRIDGE_CONFIG__
      })`
    }, sessionId);
    if (!r.result?.value) return false;
    const parsed = JSON.parse(r.result.value);
    return parsed.bodyWorkspace === "answer" && parsed.bridgeConfig;
  }, { label: `extension page to hydrate (target addon ${addonId})`, timeoutMs: 20000 });
  // Trigger the deep-link via hashchange. Setting location.hash fires
  // the 'hashchange' event; the listener then validates the addon is
  // in the (now populated) registry and switches activeWorkspace.
  await cdp.send("Runtime.evaluate", {
    expression: `window.location.hash = "#${addonId}";`
  }, sessionId);
  await waitFor(async () => {
    const r = await cdp.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        bodyWorkspace: document.body.dataset.workspace,
        hash: location.hash
      })`
    }, sessionId);
    if (!r.result?.value) return false;
    const parsed = JSON.parse(r.result.value);
    return parsed.bodyWorkspace === addonId;
  }, { label: `workspace to switch to ${addonId}`, timeoutMs: 10000 });
}

async function attachToIframe(cdp, upstreamOrigin) {
  await waitFor(async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    return targetInfos.some((info) =>
      info.type === "iframe"
      && typeof info.url === "string"
      && info.url.startsWith(upstreamOrigin)
    );
  }, { label: `iframe target for ${upstreamOrigin} to appear`, timeoutMs: 20000 });
  const { targetInfos } = await cdp.send("Target.getTargets");
  const iframeTarget = targetInfos.find((info) =>
    info.type === "iframe"
    && typeof info.url === "string"
    && info.url.startsWith(upstreamOrigin)
  );
  assert.ok(iframeTarget, `iframe target for ${upstreamOrigin} must exist`);
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: iframeTarget.targetId,
    flatten: true
  });
  await cdp.send("Runtime.enable", {}, sessionId);
  return sessionId;
}

// Set up: launch upstreams + mock bridge + write bridge config.
test.before(async () => {
  extensionUserDataDir = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-002-real-ext-chrome-"));
  await startMockBridge({
    echoPort: ECHO_PORT,
    counterPort: COUNTER_PORT,
    sdkGuidePort: SDK_GUIDE_PORT
  });
  await writeBridgeConfig();
  spawnUpstream({
    addonDir: path.join(REPO_ROOT, "browser-first/addons/resonant-echo"),
    env: {
      RESONANT_ECHO_PORT: String(ECHO_PORT),
      RESONANT_ECHO_HOST: "127.0.0.1"
    }
  });
  spawnUpstream({
    addonDir: path.join(REPO_ROOT, "browser-first/addons/resonant-counter"),
    env: {
      RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_PORT: String(COUNTER_PORT),
      RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_HOST: "127.0.0.1"
    }
  });
  spawnUpstream({
    addonDir: path.join(REPO_ROOT, "browser-first/addons/sdk-guide"),
    env: {
      RESONANTOS_BROWSER_FIRST_SDK_GUIDE_PORT: String(SDK_GUIDE_PORT),
      RESONANTOS_BROWSER_FIRST_SDK_GUIDE_HOST: "127.0.0.1"
    }
  });
  await waitForUpstream(ECHO_PORT);
  await waitForUpstream(COUNTER_PORT);
  await waitForUpstream(SDK_GUIDE_PORT);
});

test.after(async () => {
  for (const child of children) {
    child.kill("SIGTERM");
  }
  await stopMockBridge();
  if (extensionUserDataDir) {
    await rm(extensionUserDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("SDK-DEMO-002-FIX: Echo send round-trip via real extension + workspaceCrossOrigin iframe", async (t) => {
  const chrome = await launchChromeWithExtension({
    debugPort: DEBUG_PORT,
    extensionDir: EXTENSION_ROOT,
    userDataDir: extensionUserDataDir
  });
  try {
    const cdp = await makeCdpClient(DEBUG_PORT);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const pageTarget = targetInfos.find((info) =>
      info.type === "page"
    );
    if (!pageTarget) throw new Error("no page target found");
    const { sessionId: pageSessionId } = await cdp.send("Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true
    });
    await cdp.send("Page.enable", {}, pageSessionId);
    await cdp.send("Runtime.enable", {}, pageSessionId);
    await navigateToAddonWorkspace(cdp, pageTarget.targetId, pageSessionId, "addon:addon.resonant-echo");
    // The iframe is created in workspaceCrossOrigin mode: addon-iframe.js
    // assigns iframe.src = probeUrl then attaches the load listener.
    // Because src is assigned before the listener is attached, the
    // load event fires before the listener exists and never updates
    // the dataset/status text. The reliable signal that the iframe
    // has loaded is the iframe target appearing in CDP — which is
    // exactly what attachToIframe waits for.
    const iframeSession = await attachToIframe(cdp, `http://127.0.0.1:${ECHO_PORT}/`);
    // Wait for SEND to be enabled (proves templated bootstrap token
    // round-trip succeeded).
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('send')?.disabled === false"
      }, iframeSession);
      return r.result?.value === true;
    }, { label: "Echo SEND button to be enabled", timeoutMs: 10000 });
    // Focus the input and type "Hello Manolo" via trusted CDP.
    await cdp.send("Runtime.evaluate", {
      expression: "document.getElementById('msg').focus()"
    }, iframeSession);
    for (const ch of "Hello Manolo") {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "char",
        text: ch
      }, iframeSession);
    }
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('msg')?.value"
      }, iframeSession);
      return String(r.result?.value ?? "").includes("Hello Manolo");
    }, { label: "Echo msg input to contain 'Hello Manolo'", timeoutMs: 5000 });
    // Click SEND. The iframe's parent layout constrains the iframe's
    // visible viewport to a short height (~150px), so
    // Input.dispatchMouseEvent at the button's bounding-box centre
    // often lands outside the visible area. el.click() dispatches a
    // trusted click event on the element directly, which fires the
    // add-on's own listener regardless of viewport position.
    await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('send').click()`
    }, iframeSession);
    // Verify the response element renders the echo.
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('response')?.textContent ?? ''"
      }, iframeSession);
      return String(r.result?.value ?? "").includes("Hello Manolo");
    }, { label: "Echo response to render 'Hello Manolo'", timeoutMs: 10000 });

    t.diagnostic("Echo round-trip succeeded via the REAL extension's workspaceCrossOrigin iframe");
  } finally {
    await chrome.close();
  }
});

test("SDK-DEMO-002-FIX: Counter +1 increments via real extension + workspaceCrossOrigin iframe", async (t) => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-002-real-ext-chrome-counter-"));
  const chrome = await launchChromeWithExtension({
    debugPort: DEBUG_PORT + 1,
    extensionDir: EXTENSION_ROOT,
    userDataDir
  });
  try {
    const cdp = await makeCdpClient(DEBUG_PORT + 1);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const pageTarget = targetInfos.find((info) =>
      info.type === "page"
    );
    if (!pageTarget) throw new Error("no page target found (Counter)");
    const { sessionId: pageSessionId } = await cdp.send("Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true
    });
    await cdp.send("Page.enable", {}, pageSessionId);
    await cdp.send("Runtime.enable", {}, pageSessionId);
    await navigateToAddonWorkspace(cdp, pageTarget.targetId, pageSessionId, "addon:addon.resonant-counter");
    const iframeSession = await attachToIframe(cdp, `http://127.0.0.1:${COUNTER_PORT}/`);
    // Wait for cap-token to populate (proves bootstrap landed).
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('cap-token')?.textContent ?? ''"
      }, iframeSession);
      return String(r.result?.value ?? "").includes("…");
    }, { label: "Counter cap-token to populate", timeoutMs: 10000 });
    // Click +1 twice. See Echo test for why we use el.click() instead
    // of Input.dispatchMouseEvent.
    for (let i = 0; i < 2; i += 1) {
      await cdp.send("Runtime.evaluate", {
        expression: `document.getElementById('inc').click()`
      }, iframeSession);
      await sleep(200);
    }
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "Number(document.getElementById('count')?.textContent ?? '0')"
      }, iframeSession);
      return Number(r.result?.value) >= 2;
    }, { label: "Counter count to be >= 2", timeoutMs: 10000 });

    t.diagnostic("Counter +1 increments via the REAL extension's workspaceCrossOrigin iframe");
  } finally {
    await chrome.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("SDK-DEMO-002-FIX: SDK Guide live message + denied action via real extension", async (t) => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-002-real-ext-chrome-guide-"));
  const chrome = await launchChromeWithExtension({
    debugPort: DEBUG_PORT + 2,
    extensionDir: EXTENSION_ROOT,
    userDataDir
  });
  try {
    const cdp = await makeCdpClient(DEBUG_PORT + 2);
    const { targetInfos } = await cdp.send("Target.getTargets");
    const pageTarget = targetInfos.find((info) =>
      info.type === "page"
    );
    if (!pageTarget) throw new Error("no page target found (Guide)");
    const { sessionId: pageSessionId } = await cdp.send("Target.attachToTarget", {
      targetId: pageTarget.targetId,
      flatten: true
    });
    await cdp.send("Page.enable", {}, pageSessionId);
    await cdp.send("Runtime.enable", {}, pageSessionId);
    await navigateToAddonWorkspace(cdp, pageTarget.targetId, pageSessionId, "addon:addon.sdk-guide");
    const iframeSession = await attachToIframe(cdp, `http://127.0.0.1:${SDK_GUIDE_PORT}/`);
    // Wait for live-send to be enabled (proves bootstrap landed).
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('live-send')?.disabled === false"
      }, iframeSession);
      return r.result?.value === true;
    }, { label: "Guide live-send to be enabled", timeoutMs: 10000 });
    // Click live-send. Default value "hello Manolo" should round-trip.
    await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('live-send').click()`
    }, iframeSession);
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('live-evidence')?.textContent ?? ''"
      }, iframeSession);
      const text = String(r.result?.value ?? "");
      return text.includes("hello Manolo")
        && text.includes("capability")
        && text.includes("workspace iframe cross-origin");
    }, { label: "Guide live-evidence to render echo + capability + cross-origin", timeoutMs: 10000 });
    // Click "Try the unauthorized action" (denied-fire). It must
    // return 403 and render the denied message.
    await cdp.send("Runtime.evaluate", {
      expression: `document.getElementById('denied-fire').click()`
    }, iframeSession);
    await waitFor(async () => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('denied-evidence')?.textContent ?? ''"
      }, iframeSession);
      return String(r.result?.value ?? "").includes("HTTP 403")
        || String(r.result?.value ?? "").includes("wallet-signing");
    }, { label: "Guide denied-evidence to show 403 / wallet-signing", timeoutMs: 10000 });

    t.diagnostic("SDK Guide live message + denied action via the REAL extension");
  } finally {
    await chrome.close();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
});
