// Full end-to-end acceptance: real Chrome + the ResonantOS extension + the
// native-messaging bootstrap host + the loopback bridge.
//
// This drives the exact path a human takes in Settings and asserts the bridge
// reaches "connected" and the Bridge & Runtimes surface renders it. It exists
// so the two bootstrap regressions this checkpoint fixed — (1) bootstrap
// messages missing the `resonantos.browser_first` channel, and (2) the client
// reading `result.ok` instead of the top-level envelope `ok` — are caught by
// a machine instead of by a human clicking around.
//
// Prerequisites:
//   * A real Chrome/Chromium (Chrome 137+ blocks --load-extension, so we load
//     via CDP `Extensions.loadUnpacked`).
//   * The native host already installed (browser-first/bootstrap/install-macos.mjs);
//     its manifest is copied into the throwaway profile.
//   * Port 47773 free OR an already-healthy bridge there (we reuse it).
//
// Run:
//   RESONANTOS_LIVE_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node browser-first/test/bridge-extension-e2e.mjs

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, evaluate, freeLoopbackPort } from "./live-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const EXT_DIR = path.join(REPO_ROOT, "browser-first", "resonantos-side-panel-extension");
const EXT_ID = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const BRIDGE_PORT = 47773;
const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
const CHROME =
  process.env.RESONANTOS_LIVE_CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NODE = "/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node";
const BRIDGE_ENTRY = path.join(REPO_ROOT, "browser-first", "host", "run-bridge-minimal.mjs");
const MANIFEST_SRC = path.join(
  os.homedir(),
  "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.resonantos.bridge_bootstrap.json",
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const fail = (msg) => {
  console.error("FAIL:", msg);
  failures += 1;
};
const pass = (msg) => console.log("ok:", msg);

// ---------- 1. Ensure a healthy bridge at 47773 (reuse if present) ----------
async function bridgeIsHealthy() {
  try {
    const r = await fetch(`${BRIDGE_URL}/healthz`);
    if (r.status !== 200) return false;
    const b = await r.json();
    return b?.ok === true;
  } catch {
    return false;
  }
}

let spawnedBridge = null;
let chrome = null;
let browser = null;
if (await bridgeIsHealthy()) {
  console.log("bridge: reusing healthy bridge at", BRIDGE_URL);
} else {
  if (!fs.existsSync(MANIFEST_SRC)) fail(`native host manifest missing at ${MANIFEST_SRC}`);
  console.log("bridge: none at", BRIDGE_URL, "— spawning", BRIDGE_ENTRY);
  const log = fs.openSync("/tmp/ros-bridge-e2e-bridge.log", "w");
  spawnedBridge = spawn(NODE, [BRIDGE_ENTRY, `--bridge-port=${BRIDGE_PORT}`], {
    stdio: ["ignore", log, log],
  });
  for (let i = 0; i < 60; i++) {
    if (await bridgeIsHealthy()) break;
    await sleep(500);
  }
  if (!(await bridgeIsHealthy())) fail("bridge did not become healthy after spawn");
  else pass("bridge spawned and healthy");
}

// ---------- 2. Launch real Chrome + load the extension + copy host manifest ----------
const debugPort = await freeLoopbackPort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ros-bridge-e2e-profile-"));
const nmhDir = path.join(profile, "NativeMessagingHosts");
fs.mkdirSync(nmhDir, { recursive: true });
if (fs.existsSync(MANIFEST_SRC)) {
  fs.copyFileSync(MANIFEST_SRC, path.join(nmhDir, "com.resonantos.bridge_bootstrap.json"));
} else {
  fail(`native host manifest missing at ${MANIFEST_SRC} (run install-macos.mjs)`);
}

const chromeLog = fs.openSync("/tmp/ros-bridge-e2e-chrome.log", "w");
chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: ["ignore", chromeLog, chromeLog] },
);

let ver = null;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    ver = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
    break;
  } catch {}
}
if (!ver) {
  fail("Chrome CDP endpoint never came up");
  cleanupAndExit();
}
browser = new CdpClient(ver.webSocketDebuggerUrl, { timeoutMs: 20000 });
await browser.connect();
const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT_DIR });
if (loaded?.id !== EXT_ID) {
  fail(`extension loaded with unexpected id ${loaded?.id} (wanted ${EXT_ID})`);
} else {
  pass(`extension loaded (id ${EXT_ID})`);
}

const listTargets = async () => await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();

// Attach the service worker.
let sw = null;
for (let i = 0; i < 40; i++) {
  const t = (await listTargets()).find(
    (x) => x.url === `chrome-extension://${EXT_ID}/src/background.js` && x.webSocketDebuggerUrl,
  );
  if (t) {
    sw = new CdpClient(t.webSocketDebuggerUrl, { timeoutMs: 20000 });
    await sw.connect();
    await sw.send("Runtime.enable");
    break;
  }
  await sleep(300);
}
if (!sw) fail("service worker target never appeared");
else pass("service worker attached");

// Open a page (any extension page) to query the SW.
await browser.send("Target.createTarget", {
  url: `chrome-extension://${EXT_ID}/src/main-workspace.html`,
});
let page = null;
for (let i = 0; i < 40; i++) {
  const t = (await listTargets()).find(
    (x) => x.type === "page" && x.url.includes("main-workspace") && x.webSocketDebuggerUrl,
  );
  if (t) {
    page = new CdpClient(t.webSocketDebuggerUrl, { timeoutMs: 20000 });
    await page.connect();
    await page.send("Runtime.enable");
    break;
  }
  await sleep(300);
}
if (!page) fail("main-workspace page target never appeared");

// ---------- 3. Assert the bootstrap reaches "connected" ----------
await sleep(6000);
let status = null;
for (let i = 0; i < 8; i++) {
  const r = await evaluate(
    page,
    `new Promise((resolve) => {
      try { chrome.runtime.sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" }, (resp) => resolve({ resp: resp ?? null, lastError: chrome.runtime.lastError?.message ?? null })); }
      catch (e) { resolve({ threw: e?.message ?? String(e) }); }
    })`,
  ).catch((e) => ({ result: { value: { error: e.message } } }));
  const val = r?.result?.value;
  if (val?.resp?.snapshot?.status) {
    status = val.resp.snapshot;
    break;
  }
  await sleep(1500);
}

if (!status) {
  fail("no bootstrap snapshot returned");
} else if (status.status !== "connected") {
  fail(`bootstrap status = ${status.status} (failureCode=${status.failureCode}), wanted connected`);
} else {
  pass(`bootstrap connected (endpoint=${status.endpoint}, version=${status.version})`);
}

// ---------- 4. Assert the Bridge & Runtimes surface renders it ----------
await evaluate(page, `(location.hash = "#settings/bridge-runtimes", true)`).catch(() => undefined);
let text = "";
let connectedSeen = false;
for (let i = 0; i < 20; i++) {
  const ui = await evaluate(page, `document.body?.innerText ?? ""`).catch(() => ({
    result: { value: "" },
  }));
  text = String(ui?.result?.value ?? "");
  if (text.toLowerCase().includes("connected")) {
    connectedSeen = true;
    break;
  }
  await sleep(1000);
}
if (!connectedSeen) {
  fail("Bridge & Runtimes did not render a connected state. Text:\n" + text.slice(0, 1200));
} else {
  pass("Bridge & Runtimes renders 'connected'");
}

// ---------- 5. No secret-shaped values leak into the rendered DOM ----------
const normalized = text.toLowerCase();
const forbidden = [
  "bearer",
  "password=",
  "token=",
  "--secret",
  "privatekey",
  "/users/",
  "argv",
  "pid=",
];
const leaks = forbidden.filter((p) => normalized.includes(p));
if (leaks.length) fail("rendered DOM contains secret-shaped substrings: " + leaks.join(", "));
else pass("rendered DOM has no secret-shaped substrings");

cleanupAndExit();

function cleanupAndExit() {
  try {
    browser?.close();
  } catch {}
  try {
    chrome.kill();
  } catch {}
  if (spawnedBridge) {
    try {
      spawnedBridge.kill();
    } catch {}
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {}
  console.log(failures === 0 ? "\nBRIDGE-E2E: OK" : `\nBRIDGE-E2E: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
