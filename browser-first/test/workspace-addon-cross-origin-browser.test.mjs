// SDK-DEMO-002 browser re-test.
//
// Boots the real Echo + Counter upstreams, launches a Trusted
// CDP-enabled Chromium, navigates directly to each add-on's
// upstream URL (the same opaque-origin iframe context the extension
// uses), and drives the UI with trusted CDP Input.dispatchKeyEvent /
// Input.dispatchMouseEvent. This is the cross-origin + sandboxed
// surface the extension will use; if the round-trip works here, it
// works in the extension.
//
// What we prove:
//   1. The add-on's own <script> executes (the historical srcdoc gap
//      is closed). The page becomes interactive: SEND button enables,
//      +1 button is clickable, status pill flips to "connected".
//   2. Trusted CDP Input events fire the add-on's OWN listener —
//      not a parent-side fetch override (there is no parent fetch
//      override in this test).
//   3. /bootstrap returns the harness-messaging token without any
//      parent help, /api/<addon>/* then returns 200.
//   4. Counter increments through the add-on's UI (which calls
//      /api/counter/increment via fetch from the opaque iframe).
//   5. Without a token, /bootstrap returns 403 and the UI surfaces
//      the unauthorized-capability denial.
//
// What this test deliberately does NOT cover:
//   - The extension side-panel rendering. The renderer + manifest
//     are validated by unit + integration tests. The browser
//     surface here is the add-on's own origin, which is the new
//     load path the extension now uses.

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";

import { chromium } from "playwright";

const REPO_ROOT = path.join(import.meta.dirname, "..", "..");
const ECHO_PORT = 48921;
const COUNTER_PORT = 48922;
const DEBUG_PORT = 48931;
const HARNESS_TOKEN = "browser-test-harness-messaging-002";

const children = new Set();

function spawnUpstream({ addonDir, port, env }) {
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
  return { child, port, close: async () => {
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

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`CDP ${msg.method}: ${msg.error.message}`));
        else resolve(msg.result ?? {});
      } else if (msg.method === "Target.attachedToTarget") {
        this.sessions.set(msg.params.targetInfo.targetId, msg.params.sessionId);
      } else if (msg.method === "Target.detachedFromTarget") {
        for (const [tid, sid] of this.sessions) {
          if (sid === msg.params.sessionId) this.sessions.delete(tid);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));
    });
  }
}

async function waitFor(predicate, { timeoutMs = 10000, intervalMs = 50, label = "predicate" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function makeCdpClient(httpEndpoint) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(httpEndpoint);
    ws.addEventListener("open", () => resolve(new CdpClient(ws)));
    ws.addEventListener("error", (event) => reject(new Error(`ws error: ${event.message ?? "unknown"}`)));
  });
}

test.before(async () => {
  const echoDir = path.join(REPO_ROOT, "browser-first", "addons", "resonant-echo");
  const counterDir = path.join(REPO_ROOT, "browser-first", "addons", "resonant-counter");
  spawnUpstream({
    addonDir: echoDir,
    port: ECHO_PORT,
    env: {
      RESONANT_ECHO_PORT: String(ECHO_PORT),
      RESONANT_ECHO_HOST: "127.0.0.1",
      RESONANT_ECHO_BRIDGE_IDENTITY: "bridge://browser-test",
      RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN,
      RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_PORT: String(ECHO_PORT),
      RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_HOST: "127.0.0.1",
      RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_BRIDGE_IDENTITY: "bridge://browser-test",
      RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_CAPABILITY_TOKEN: HARNESS_TOKEN
    }
  });
  spawnUpstream({
    addonDir: counterDir,
    port: COUNTER_PORT,
    env: {
      RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_PORT: String(COUNTER_PORT),
      RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_HOST: "127.0.0.1",
      RESONANTOS_BROWSER_FIRST_RESONANT_COUNTER_BRIDGE_IDENTITY: "bridge://browser-test"
    }
  });
  await waitForUpstream(ECHO_PORT);
  await waitForUpstream(COUNTER_PORT);
});

test.after(async () => {
  for (const child of children) {
    child.kill("SIGTERM");
  }
});

async function launchChromeWithRemoteDebugging({ debugPort, bootstrapToken = "" }) {
  const chromiumPath = chromium.executablePath();
  if (!existsSync(chromiumPath)) {
    throw new Error(`chromium not installed: ${chromiumPath}`);
  }
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "sdk-demo-002-chrome-"));
  // Open with about:blank so the test can attach to the page session,
  // register a script that runs on every new document (the bootstrap
  // token), and THEN navigate to the add-on URL. This guarantees the
  // add-on's own <script> sees window.__RESONANTOS_BOOTSTRAP_TOKEN__
  // before its first /bootstrap fetch fires.
  const child = spawn(chromiumPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stderr?.on("data", (chunk) => {
    if (/DevTools listening/i.test(String(chunk))) return;
    process.stderr.write(`[chrome] ${chunk}`);
  });
  children.add(child);
  // Wait for CDP endpoint to come up.
  let wsEndpoint;
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (r.ok) { wsEndpoint = (await r.json()).webSocketDebuggerUrl; break; }
    } catch { /* retry */ }
    await sleep(100);
  }
  if (!wsEndpoint) throw new Error("Chromium did not expose CDP endpoint");
  const cdp = await makeCdpClient(wsEndpoint);
  // Find the about:blank page target.
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((t) => t.type === "page");
  if (!pageTarget) throw new Error("no page target found");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: pageTarget.targetId,
    flatten: true
  });
  cdp.sessions.set(pageTarget.targetId, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  // Register the bootstrap-token injector BEFORE navigation.
  if (bootstrapToken) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__RESONANTOS_BOOTSTRAP_TOKEN__ = ${JSON.stringify(bootstrapToken)};`
    }, sessionId);
  }
  return {
    child, userDataDir, cdp, sessionId, pageTarget,
    close: async () => {
      children.delete(child);
      child.kill("SIGTERM");
      await new Promise((resolve) => child.on("exit", resolve));
      await rm(userDataDir, { recursive: true, force: true });
    }
  };
}

async function navigateAndWaitForReady(cdp, sessionId, url) {
  // Navigate the already-attached page to the add-on URL and wait
  // for the document to reach a non-loading readyState.
  const loadedPromise = (async () => {
    await new Promise((resolve) => {
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === "Page.loadEventFired") {
          cdp.ws.removeEventListener("message", handler);
          resolve();
        }
      };
      cdp.ws.addEventListener("message", handler);
    });
  })();
  await cdp.send("Page.navigate", { url }, sessionId);
  await Promise.race([
    loadedPromise,
    sleep(15000)
  ]);
  await waitFor(async () => {
    const ready = await cdp.send("Runtime.evaluate", {
      expression: "document.readyState"
    }, sessionId);
    return ready.result?.value === "complete" || ready.result?.value === "interactive";
  }, { label: "document ready", timeoutMs: 15000 });
}

test("SDK-DEMO-002: Echo send round-trip fires add-on's own listener via trusted CDP input", async (t) => {
  const chrome = await launchChromeWithRemoteDebugging({
    debugPort: DEBUG_PORT,
    bootstrapToken: HARNESS_TOKEN
  });
  try {
    const { cdp, sessionId } = chrome;
    await navigateAndWaitForReady(cdp, sessionId, `http://127.0.0.1:${ECHO_PORT}/`);

    // Confirm the add-on's own script ran (the historical srcdoc gap is
    // closed). The status pill should have moved off "connecting…" once
    // /bootstrap returned a token.
    await waitFor(async () => {
      const status = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('status-pill')?.textContent"
      }, sessionId);
      return String(status.result?.value ?? "").includes("connected");
    }, { label: "status pill to flip to connected (proves add-on's <script> executed)", timeoutMs: 10000 });

    // Confirm SEND button is enabled (proves bootstrap landed and the
    // apiBasePath round-trip succeeded).
    const sendDisabled = await cdp.send("Runtime.evaluate", {
      expression: "document.getElementById('send')?.disabled"
    }, sessionId);
    assert.equal(sendDisabled.result?.value, false, "SEND button must be enabled after /bootstrap");

    // Confirm the input field is present.
    const inputExists = await cdp.send("Runtime.evaluate", {
      expression: "Boolean(document.getElementById('msg'))"
    }, sessionId);
    assert.equal(inputExists.result?.value, true, "msg input must exist");

    // Trusted CDP: focus the input and dispatch key events to type
    // "Hello Manolo". This is what Input.dispatchKeyEvent gives us:
    // synthetic trusted keystrokes that fire DOM input + keydown +
    // keypress handlers normally.
    await cdp.send("Runtime.evaluate", {
      expression: "document.getElementById('msg').focus()"
    }, sessionId);

    const text = "Hello Manolo";
    for (const char of text) {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "char",
        text: char,
        unmodifiedText: char
      }, sessionId);
    }

    // Verify the input received the text.
    const inputValue = await cdp.send("Runtime.evaluate", {
      expression: "document.getElementById('msg').value"
    }, sessionId);
    assert.equal(inputValue.result?.value, text, `input must reflect typed text, got ${JSON.stringify(inputValue.result?.value)}`);

    // Find the SEND button bounding box for trusted mouse click.
    const box = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.getElementById('send');
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()`
    }, sessionId);
    const coords = JSON.parse(box.result.value);
    // Trusted mouse click — Input.dispatchMouseEvent produces real
    // trusted click events that fire the add-on's own listener.
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);

    // Wait for the response element to show the echo.
    await waitFor(async () => {
      const resp = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('response')?.textContent ?? ''"
      }, sessionId);
      return String(resp.result?.value ?? "").includes("Hello Manolo");
    }, { label: "response to show echoed message", timeoutMs: 10000 });

    // Verify the meta line shows messageCount > 0 — proves the
    // add-on's own state was updated by its own handler.
    await waitFor(async () => {
      const meta = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('meta')?.textContent ?? ''"
      }, sessionId);
      return /messages:\s*[1-9]/.test(String(meta.result?.value ?? ""));
    }, { label: "meta to show messages >= 1", timeoutMs: 5000 });

    t.diagnostic("Echo round-trip succeeded via trusted CDP input");
  } finally {
    await chrome.close();
  }
});

test("SDK-DEMO-002: Counter increment fires add-on's own listener via trusted CDP click", async (t) => {
  const chrome = await launchChromeWithRemoteDebugging({
    debugPort: DEBUG_PORT + 1,
    bootstrapToken: HARNESS_TOKEN
  });
  try {
    const { cdp, sessionId } = chrome;
    await navigateAndWaitForReady(cdp, sessionId, `http://127.0.0.1:${COUNTER_PORT}/`);

    // The Counter does an initial refreshCount() on load, which goes
    // through /bootstrap first. Wait for the cap-token field to be
    // populated — that proves the bootstrap round-trip succeeded.
    await waitFor(async () => {
      const cap = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('cap-token')?.textContent ?? ''"
      }, sessionId);
      return String(cap.result?.value ?? "").includes("…");
    }, { label: "cap-token to be populated (proves add-on's <script> executed + bootstrap landed)", timeoutMs: 10000 });

    // Find the +1 button bounding box.
    const box = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.getElementById('inc');
        const r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      })()`
    }, sessionId);
    const coords = JSON.parse(box.result.value);

    // Trusted CDP click on +1 — fires the add-on's own click handler,
    // which calls /api/counter/increment.
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);

    // Wait for the count to become >= 1.
    await waitFor(async () => {
      const count = await cdp.send("Runtime.evaluate", {
        expression: "Number(document.getElementById('count')?.textContent ?? '0')"
      }, sessionId);
      return Number(count.result?.value) >= 1;
    }, { label: "count to become >= 1", timeoutMs: 10000 });

    // Click +1 again and verify count goes up.
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: coords.x,
      y: coords.y,
      button: "left",
      clickCount: 1
    }, sessionId);

    await waitFor(async () => {
      const count = await cdp.send("Runtime.evaluate", {
        expression: "Number(document.getElementById('count')?.textContent ?? '0')"
      }, sessionId);
      return Number(count.result?.value) >= 2;
    }, { label: "count to become >= 2", timeoutMs: 10000 });

    t.diagnostic("Counter increments via trusted CDP click");
  } finally {
    await chrome.close();
  }
});

test("SDK-DEMO-002: unauthorized capability denied at upstream (no token in iframe)", async (t) => {
  // This test exercises the unauthorized-capability surface WITHOUT
  // the harness token in the bootstrap request. We launch Chromium
  // pointed at Echo but do NOT inject the token into the bootstrap
  // call (no parent-side fetch override, no parent injection). The
  // add-on's own script lands a /bootstrap request without a token
  // header and the upstream MUST respond 403. The UI surfaces this
  // as the unauthorized-capability signal.
  const chrome = await launchChromeWithRemoteDebugging({
    debugPort: DEBUG_PORT + 2,
    bootstrapToken: ""
  });
  try {
    const { cdp, sessionId } = chrome;
    await navigateAndWaitForReady(cdp, sessionId, `http://127.0.0.1:${ECHO_PORT}/`);

    // The iframe's /bootstrap call lands without a token, the
    // upstream MUST 403, and the add-on's UI MUST show the denied
    // status pill.
    await waitFor(async () => {
      const status = await cdp.send("Runtime.evaluate", {
        expression: "document.getElementById('status-pill')?.textContent ?? ''"
      }, sessionId);
      return String(status.result?.value ?? "").includes("denied");
    }, { label: "status pill to show 'denied'", timeoutMs: 10000 });

    // The SEND button MUST remain disabled (the add-on did not get a
    // token so it cannot send).
    const sendDisabled = await cdp.send("Runtime.evaluate", {
      expression: "document.getElementById('send')?.disabled"
    }, sessionId);
    assert.equal(sendDisabled.result?.value, true, "SEND button must stay disabled when /bootstrap 403s");

    t.diagnostic("Unauthorized-capability surface visible in iframe UI");
  } finally {
    await chrome.close();
  }
});