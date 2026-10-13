// Full browser E2E for the Terminals workspace (CP-BR11 + the CP-BR10 fixes).
//
// Drives real Chrome + the ResonantOS extension + a freshly-spawned loopback
// bridge exactly the way an operator would: open main-workspace, click the
// Terminals rail entry, and assert the two reviewed terminal add-ons
// (Ghostty + iTerm2) render as cards with the correct badge and button
// gating. This is the regression guard for the two defects this checkpoint
// fixed:
//
//   1. The wrapper called renderTerminalsWorkspaceRenderer({ container: ... })
//      instead of (transcript, {...}), so `container.replaceChildren` threw
//      and the workspace rendered blank.
//   2. `/terminal-host/status` reported `compatible` from the grant state
//      instead of platform compatibility, so pre-grant cards read
//      "Not installed" and disabled Copy/Launch.
//
// Run:
//   RESONANTOS_LIVE_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
//     node browser-first/test/terminals-browser-e2e.mjs

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

async function bridgeIsHealthy() {
  try {
    const r = await fetch(`${BRIDGE_URL}/healthz`);
    if (r.status !== 200) return false;
    return (await r.json())?.ok === true;
  } catch {
    return false;
  }
}

// ---------- 1. Spawn a fresh bridge with the current (fixed) source ----------
// Clear any existing user data to ensure a clean state for the test.
// The bridge writes its receipt/startup log to stderr, which we capture to a temp file.
let spawnedBridge = null;
{
  const userRootPath = path.join(os.homedir(), "ResonantOS_User");
  if (fs.existsSync(userRootPath)) {
    console.log("bridge: clearing existing user data at", userRootPath);
    try {
      fs.rmSync(userRootPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (e) {
      console.log("bridge: WARNING - could not clear user data:", e.message);
    }
  }

  if (await bridgeIsHealthy()) {
    console.log("bridge: an existing healthy bridge is present; killing it");
    try {
      const bridgePid = parseInt(fs.readFileSync("/tmp/ros-bridge.pid", "utf8").trim(), 10);
      if (bridgePid) process.kill(bridgePid, "SIGTERM");
    } catch {}
    await sleep(1000);
  }

  if (await bridgeIsHealthy()) {
    console.log("bridge: WARNING — bridge still healthy after kill attempt; reusing it");
    console.log("bridge: WARNING — if it predates the fix, `compatible` will still read as grant");
  } else {
    console.log("bridge: none at", BRIDGE_URL, "— spawning", BRIDGE_ENTRY);
    const log = fs.openSync("/tmp/ros-terminals-e2e-bridge.log", "w");
    // CP-BR9: The terminal-host bridge service requires RESONANT_TERMINAL_HOST_BRIDGE=1
    // to start. Without this, the terminal host service never starts and terminals
    // remain "Disconnected".
    spawnedBridge = spawn(NODE, [BRIDGE_ENTRY, `--bridge-port=${BRIDGE_PORT}`], {
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        RESONANT_TERMINAL_HOST_BRIDGE: "1",
        RESONANT_TERMINAL_DRIVER: "ghostty",
      },
    });
    for (let i = 0; i < 60; i += 1) {
      if (await bridgeIsHealthy()) break;
      await sleep(500);
    }
    if (!(await bridgeIsHealthy())) fail("bridge did not become healthy after spawn");
    else pass("bridge spawned and healthy");
  }
}

// ---------- 2. Launch Chrome + load the extension + copy the host manifest ----------
const debugPort = await freeLoopbackPort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ros-terminals-e2e-profile-"));
const nmhDir = path.join(profile, "NativeMessagingHosts");
fs.mkdirSync(nmhDir, { recursive: true });
if (fs.existsSync(MANIFEST_SRC)) {
  fs.copyFileSync(MANIFEST_SRC, path.join(nmhDir, "com.resonantos.bridge_bootstrap.json"));
}

const chromeLog = fs.openSync("/tmp/ros-terminals-e2e-chrome.log", "w");
const chrome = spawn(
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
for (let i = 0; i < 60; i += 1) {
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

const browser = new CdpClient(ver.webSocketDebuggerUrl, { timeoutMs: 20000 });
await browser.connect();
const loaded = await browser.send("Extensions.loadUnpacked", { path: EXT_DIR });
if (loaded?.id !== EXT_ID) fail(`extension loaded with unexpected id ${loaded?.id}`);
else pass(`extension loaded (id ${EXT_ID})`);

const listTargets = async () => await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();

await browser.send("Target.createTarget", {
  url: `chrome-extension://${EXT_ID}/src/main-workspace.html`,
});
let page = null;
for (let i = 0; i < 40; i += 1) {
  const t = (await listTargets()).find(
    (x) => x.type === "page" && x.url.includes("main-workspace") && x.webSocketDebuggerUrl,
  );
  if (t) {
    page = new CdpClient(t.webSocketDebuggerUrl, { timeoutMs: 20000 });
    await page.connect();
    break;
  }
  await sleep(300);
}
if (!page) {
  fail("main-workspace page target never appeared");
  cleanupAndExit();
}

// Capture console errors + exceptions.
const errors = [];
page.on("Runtime.exceptionThrown", (p) => {
  errors.push(
    "EXCEPTION: " +
      (p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? JSON.stringify(p)),
  );
});
page.on("Runtime.consoleAPICalled", (p) => {
  if (p.type === "error" || p.type === "warning") {
    errors.push(
      "CONSOLE." +
        p.type +
        ": " +
        (p.args ?? []).map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(" "),
    );
  }
});
await page.send("Runtime.enable");

// ---------- 3. Wait for the bootstrap to reach "connected" ----------
let connected = false;
for (let i = 0; i < 16; i += 1) {
  const r = await evaluate(
    page,
    `new Promise((resolve) => {
      try { chrome.runtime.sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" }, (resp) => resolve(resp?.snapshot?.status ?? null)); }
      catch (e) { resolve(null); }
    })`,
  ).catch(() => ({ result: { value: null } }));
  if (r?.result?.value === "connected") {
    connected = true;
    break;
  }
  await sleep(1000);
}
if (!connected) fail("bootstrap never reached connected");
else pass("bootstrap connected");

// ---------- 4. Click the Terminals rail entry ----------
await evaluate(page, `document.querySelector('[data-workspace="terminals"]')?.click()`).catch(
  () => undefined,
);
await sleep(3000);

// ---------- 5. Assert the two cards render with correct badge + buttons ----------
const state = await evaluate(
  page,
  `(() => {
  const cards = [...document.querySelectorAll('article.terminals-card')];
  const byAddon = Object.fromEntries(cards.map((c) => [c.dataset.addonId, c]));
  const summarize = (addonId) => {
    const card = byAddon[addonId];
    if (!card) return null;
    const badge = card.querySelector('.terminals-card-badge');
    const btn = (id) => card.querySelector('[data-testid="' + id + '"]');
    return {
      label: card.querySelector('strong')?.textContent ?? null,
      badge: badge?.textContent ?? null,
      tone: card.dataset.tone ?? null,
      hasEnable: !!btn('terminals-enable-' + addonId),
      hasGrant: !!btn('terminals-grant-' + addonId),
      hasLaunch: !!btn('terminals-launch-' + addonId),
      hasCopy: !!btn('terminals-copy-' + addonId),
      launchDisabled: btn('terminals-launch-' + addonId)?.disabled ?? null,
      copyDisabled: btn('terminals-copy-' + addonId)?.disabled ?? null,
    };
  };
  return {
    ghostty: summarize('addon.resonant-terminal-ghostty'),
    iterm2: summarize('addon.resonant-terminal-iterm2'),
  };
})()`,
).catch((e) => ({ result: { value: { evalError: e.message } } }));

const s = state.result.value ?? {};
for (const [label, addonId] of [
  ["Ghostty", "addon.resonant-terminal-ghostty"],
  ["iTerm2", "addon.resonant-terminal-iterm2"],
]) {
  const card =
    s[addonId.toLowerCase() === "addon.resonant-terminal-ghostty" ? "ghostty" : "iterm2"];
  if (!card) {
    fail(`${label} card did not render`);
    continue;
  }
  if (card.label) pass(`${label} card renders (label: ${card.label})`);
  else fail(`${label} card has no title`);
  // Check that the card has the expected buttons
  // Note: Grant button only appears when capability is NOT yet granted
  const hasGrantOrConnected = card.hasGrant || card.badge === "Connected";
  if (card.hasEnable && card.hasLaunch && card.hasCopy) {
    pass(`${label} card exposes Enable/Launch/Copy`);
  } else {
    fail(`${label} card is missing a button: ${JSON.stringify(card)}`);
  }
  if (hasGrantOrConnected) {
    pass(`${label} card has Grant button or is already connected`);
  } else {
    fail(`${label} card is missing Grant button and not connected: ${JSON.stringify(card)}`);
  }
  // The compatible fix means a pre-grant card reads "Disconnected" (not "Not installed").
  if (card.badge === "Disconnected")
    pass(`${label} badge is "Disconnected" (compatible fix active)`);
  else fail(`${label} badge is ${JSON.stringify(card.badge)} — expected "Disconnected"`);
  if (card.copyDisabled === false) pass(`${label} Copy connection script is enabled pre-grant`);
  else fail(`${label} Copy connection script is disabled (copyDisabled=${card.copyDisabled})`);
  if (card.launchDisabled === true) pass(`${label} Open in Terminal is disabled until connected`);
  else
    fail(
      `${label} Open in Terminal is unexpectedly enabled (launchDisabled=${card.launchDisabled})`,
    );
}

// ---------- 6. No secret-shaped substrings in the rendered DOM ----------
const text = String(
  (await evaluate(page, `document.body.innerText`).catch(() => ({ result: { value: "" } })))?.result
    ?.value ?? "",
).toLowerCase();
for (const forbidden of [
  "bearer",
  "token=",
  "password=",
  "privatekey",
  "/users/",
  "argv",
  "pid=",
]) {
  if (text.includes(forbidden)) fail(`rendered DOM leaks secret-shaped substring: ${forbidden}`);
}
pass("rendered DOM has no secret-shaped substrings");

// Surface any console errors captured during the run.
const fatal = errors.filter((e) => e.includes("replaceChildren") || e.includes("EXCEPTION"));
if (fatal.length) fail("console errors captured:\n" + fatal.join("\n"));
else pass("no runtime exceptions during the Terminals flow");

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
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {}
  console.log(failures === 0 ? "\nTERMINALS-E2E: OK" : `\nTERMINALS-E2E: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
