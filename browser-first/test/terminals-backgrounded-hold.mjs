// CP-BR11 verification: a ~2 minute backgrounded hold proves the MV3
// service-worker stays alive and the bridge status remains "connected"
// while the Chrome window is unfocused (the exact failure mode the
// keepalive + recovery work is meant to close).
//
// Run:
//   RESONANTOS_LIVE_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node browser-first/test/terminals-backgrounded-hold.mjs
//
// Requires: real Chrome and a `node` binary matching the project's
// Node 24.21.0+ requirement (the bridge entry imports .ts).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CdpClient, evaluate, freeLoopbackPort, resonantExtensionId } from "./live-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const EXT_DIR = path.join(REPO_ROOT, "browser-first", "resonantos-side-panel-extension");
const BRIDGE_PORT = 47773;
const CHROME = process.env.RESONANTOS_LIVE_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const NODE = "/Users/andrewjochl/.nvm/versions/node/v24.21.0/bin/node";
const BRIDGE_ENTRY = path.join(REPO_ROOT, "browser-first", "host", "run-bridge-minimal.mjs");

const HOLD_MS = Number(process.env.CP_BR11_HOLD_MS ?? 120_000);
const POLL_MS = 5_000;

const passes = [];
const failures = [];
function pass(msg) { console.log(`ok: ${msg}`); passes.push(msg); }
function fail(msg) { console.log(`FAIL: ${msg}`); failures.push(msg); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridgeHealthy(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(800) });
    if (r.status !== 200) return false;
    const body = await r.json();
    return body?.ok === true;
  } catch {
    return false;
  }
}

let bridgeProc = null;
let chromeProc = null;
let browser = null;
let profile = null;
let userRoot = null;

async function cleanup(code = 0) {
  try { browser?.close(); } catch { /* best-effort */ }
  try { chromeProc?.kill("SIGTERM"); } catch { /* best-effort */ }
  try { bridgeProc?.kill("SIGTERM"); } catch { /* best-effort */ }
  // Give the bridge ~500ms to flush its exit log via the new CP-BR11
  // `process.on("exit")` handler.
  await sleep(500);
  try { if (profile) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best-effort */ }
  try { if (userRoot) fs.rmSync(userRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best-effort */ }
  if (failures.length === 0) {
    console.log("\nCP-BR11 BACKGROUNDED-HOLD: PASS");
  } else {
    console.log(`\nCP-BR11 BACKGROUNDED-HOLD: ${failures.length} FAILURE(S)`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(code || (failures.length === 0 ? 0 : 1));
}

async function main() {
  // 1. Reserve a loopback port for the bridge and a fresh user root.
  const port = await freeLoopbackPort(BRIDGE_PORT);
  userRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ros-cp-br11-user-"));

  // 2. Spawn the bridge. The new CP-BR11 `process.on("exit")` handler
  //    in run-bridge-minimal.mjs appends the redacted record to
  //    ~/.ros/bridge-exit.log on shutdown.
  const bridgeLog = fs.openSync("/tmp/ros-cp-br11-bridge.log", "w");
  bridgeProc = spawn(NODE, [BRIDGE_ENTRY, `--bridge-port=${port}`], {
    stdio: ["ignore", bridgeLog, bridgeLog],
    env: {
      ...process.env,
      RESONANTOS_BROWSER_FIRST_USER_ROOT: userRoot,
    },
  });
  for (let i = 0; i < 60; i += 1) {
    if (await bridgeHealthy(port)) break;
    await sleep(500);
  }
  if (await bridgeHealthy(port)) {
    pass(`bridge spawned and healthy (user root=${path.basename(userRoot)}, port=${port})`);
  } else {
    fail(`bridge did not become healthy on port ${port}`);
    await cleanup(1);
  }

  // 3. Launch Chrome with a fresh profile. The
  //    --disable-extensions-except / --load-extension flags pin our
  //    unpacked extension; the e2e script does the same.
  const debugPort = await freeLoopbackPort(9222);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "ros-cp-br11-profile-"));
  // Stage the native-messaging manifest inside the profile's
  // NativeMessagingHosts dir so the bootstrap host can find the
  // extension by id.
  const nmhDir = path.join(profile, "NativeMessagingHosts");
  fs.mkdirSync(nmhDir, { recursive: true });
  const manifestSrc = path.join(
    os.homedir(),
    "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.resonantos.bridge_bootstrap.json",
  );
  if (fs.existsSync(manifestSrc)) {
    fs.copyFileSync(manifestSrc, path.join(nmhDir, "com.resonantos.bridge_bootstrap.json"));
  }

  const chromeLog = fs.openSync("/tmp/ros-cp-br11-chrome.log", "w");
  chromeProc = spawn(
    CHROME,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${debugPort}`,
      "--no-first-run",
      "--no-default-browser-check",
      `about:blank`,
    ],
    { stdio: ["ignore", chromeLog, chromeLog] },
  );

  let ver = null;
  for (let i = 0; i < 60; i += 1) {
    await sleep(500);
    try {
      ver = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
      break;
    } catch { /* keep polling */ }
  }
  if (!ver) {
    fail("Chrome CDP endpoint never came up");
    await cleanup(1);
  }
  pass("Chrome CDP endpoint up");

  browser = new CdpClient(ver.webSocketDebuggerUrl, { timeoutMs: 20_000 });
  await browser.connect();
  const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT_DIR });
  if (loaded?.id !== resonantExtensionId) {
    fail(`extension loaded with unexpected id ${loaded?.id}`);
    await cleanup(1);
  } else {
    pass(`extension loaded (id ${loaded.id})`);
  }

  // 4. Open main-workspace and wait for the bridge to be "connected".
  await browser.send("Target.createTarget", {
    url: `chrome-extension://${resonantExtensionId}/src/main-workspace.html`,
  });
  let mainPage = null;
  const listTargets = async () => await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  for (let i = 0; i < 40; i += 1) {
    const t = (await listTargets()).find(
      (x) => x.type === "page" && x.url.includes("main-workspace") && x.webSocketDebuggerUrl,
    );
    if (t) {
      mainPage = new CdpClient(t.webSocketDebuggerUrl, { timeoutMs: 20_000 });
      await mainPage.connect();
      break;
    }
    await sleep(300);
  }
  if (!mainPage) {
    fail("main-workspace page target never appeared");
    await cleanup(1);
  }
  pass("main-workspace page target connected");
  await mainPage.send("Runtime.enable");

  // 5. Wait for the bridge status to be "connected" via the SW.
  let connected = false;
  for (let i = 0; i < 30; i += 1) {
    const r = await evaluate(
      mainPage,
      `new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" }, (resp) => resolve(resp?.snapshot?.status ?? null)); } catch (e) { resolve(null); } })`,
    ).catch(() => ({ result: { value: null } }));
    if (r?.result?.value === "connected") {
      connected = true;
      break;
    }
    await sleep(500);
  }
  if (connected) {
    pass("bridge status reached 'connected'");
  } else {
    fail("bridge did not reach status=connected within 15s");
    await cleanup(1);
  }

  // 6. Background the window: open a NEW tab pointed at about:blank
  //    and bring it to the front. The main-workspace page is now
  //    hidden from the user's perspective; the renderer's 1s poll
  //    pauses on `visibilityState === "hidden"`, and Chromium is free
  //    to idle-kill the SW. The keepalive port (CP-BR11) is what keeps
  //    the SW alive across this window.
  await browser.send("Target.createTarget", { url: "about:blank" });
  let hiddenPage = null;
  for (let i = 0; i < 20; i += 1) {
    const t = (await listTargets()).find(
      (x) => x.type === "page" && x.url === "about:blank" && x.webSocketDebuggerUrl,
    );
    if (t) {
      hiddenPage = new CdpClient(t.webSocketDebuggerUrl, { timeoutMs: 10_000 });
      await hiddenPage.connect();
      break;
    }
    await sleep(200);
  }
  if (!hiddenPage) {
    fail("could not open a hidden about:blank page");
    await cleanup(1);
  }
  await browser.send("Target.activateTarget", { targetId: (await listTargets()).find((t) => t.url === "about:blank")?.id });
  pass("Chrome window backgrounded (extension page hidden)");

  // 7. The hold. Every POLL_MS, query the SW's snapshot via the kept
  //    CDP target. The snapshot must remain "connected" the entire
  //    window. A snapshot that flips to "offline" or "failed" during
  //    the hold means the keepalive did not work.
  const start = Date.now();
  let lastSnapshot = null;
  let polls = 0;
  let okPolls = 0;
  while (Date.now() - start < HOLD_MS) {
    const r = await evaluate(
      mainPage,
      `new Promise((resolve) => { try { chrome.runtime.sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" }, (resp) => resolve(resp?.snapshot ?? null)); } catch (e) { resolve(null); } })`,
    ).catch(() => null);
    const snap = r?.result?.value;
    polls += 1;
    if (snap && snap.status === "connected") okPolls += 1;
    lastSnapshot = snap;
    await sleep(POLL_MS);
  }
  if (lastSnapshot?.status === "connected" && okPolls === polls && polls >= 10) {
    pass(`held connected across ${polls} polls over ${Math.round(HOLD_MS / 1000)}s with window backgrounded`);
  } else {
    fail(`hold ended with last snapshot=${JSON.stringify(lastSnapshot)} (${okPolls}/${polls} polls connected)`);
  }

  await cleanup(0);
}

main().catch(async (error) => {
  console.error("UNCAUGHT:", error?.stack ?? error);
  await cleanup(1);
});
