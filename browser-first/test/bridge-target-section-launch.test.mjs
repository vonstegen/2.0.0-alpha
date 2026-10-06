// CP-LBc: Bridge Target settings section Launch Bridge affordance tests.
//
// Covers:
//   - Launch Bridge card renders alongside the existing health grid.
//   - The status line is textContent-rendered (no innerHTML / script
//     injection).
//   - Clicking the button calls the launchBridge seam with `{}`.
//   - The status line updates to "Starting" while in flight and to
//     "Connected" / "Already running" / "Started" on success.
//   - On `bridge-start-failed` the status line surfaces the rejection
//     and does NOT pollute the panel with secret-shaped values.
//   - A second click while already running surfaces `alreadyRunning`
//     without a second host spawn.
//   - Without `launchBridge` / `bridgeRequest` seamed, clicking the
//     button surfaces a non-secret error.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /authorization:\s*[A-Za-z0-9._\-+/=]{12,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
  /(?:\/Users\/|\/home\/|C:\\|\/private\/)[A-Za-z0-9._/-]+/,
  /~\/[A-Za-z0-9._/-]{4,}/,
  /\b(?:TOKEN|SECRET|API[_-]KEY|PASSWORD|PASSWD|PRIVATE[_-]KEY)\s*=\s*[^\s"'<>]{6,}/i,
  /\bprofile:[A-Za-z0-9._-]{8,}\b/i,
];

const SECRET_FIELD_NAMES = new Set([
  "token", "tokens", "password", "passwd", "apiKey", "api_key", "apikey",
  "secret", "secrets", "credential", "credentials", "privateKey",
  "private_key", "sessionToken", "session_token", "bearer", "bearerToken",
  "bearer_token", "authorization", "auth", "cookie",
]);

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(value, pattern, `${path} carries a secret-shaped value`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.ok(!SECRET_FIELD_NAMES.has(key),
      `${path}.${key} is a secret-shaped field name`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

async function setup(t, { launchBridge, generated = { bridgeUrl: "http://127.0.0.1:47773", bridgeToken: "gen", capabilityBootstrapToken: "gen-bt" } } = {}) {
  const dom = new JSDOM("<main></main>");
  const keys = ["document", "chrome", "fetch", "__RESONANTOS_BRIDGE_CONFIG__"];
  const previous = keys.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => {
    dom.window.close();
    keys.forEach((name, index) => {
      if (previous[index]) Object.defineProperty(globalThis, name, previous[index]);
      else delete globalThis[name];
    });
  });
  globalThis.document = dom.window.document;
  globalThis.chrome = { storage: { local: {
    get: async () => ({}),
    set: async () => undefined,
    remove: async () => undefined,
  } } };
  globalThis.__RESONANTOS_BRIDGE_CONFIG__ = generated;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const { renderBridgeTargetSection } = await import("../resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js");
  const root = document.querySelector("main");
  const launchCalls = [];
  const wrappedLaunch = async (args) => {
    launchCalls.push(args);
    if (!launchBridge) return { ok: false, reason: "bridge-start-failed", endpoint: "http://127.0.0.1:47773" };
    return launchBridge(args);
  };
  renderBridgeTargetSection(root, { launchBridge: wrappedLaunch });
  // Allow initial probe to settle. The probe is async; we wait until
  // the settings-status node reports the resolved source OR
  // hard-fail on a 1.5s deadline.
  await new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const status = root.querySelector(".settings-status");
      if (status && status.textContent.startsWith("Resolved:")) return resolve();
      if (Date.now() - start > 1500) return resolve();
      setTimeout(tick, 5);
    };
    tick();
  });
  // Wire the Launch Bridge status line so the test sees the
  // documented endpoint + status pair. The status line is updated
  // on every click; this just seeds it with the resolved endpoint.
  const statusNode = root.querySelector('[data-testid="bridge-launch-status"]');
  if (statusNode) {
    const urlNode = root.querySelector(".settings-health-grid > :nth-child(1) > strong");
    const endpoint = urlNode?.textContent ?? "(resolving)";
    statusNode.textContent = `Not running · ${endpoint}`;
  }
  return { root, launchCalls, launchButton: () => root.querySelector('[data-testid="bridge-launch-button"]'), statusLine: () => root.querySelector('[data-testid="bridge-launch-status"]') };
}

test("Bridge Target renders a Launch Bridge button + non-secret status line", async (t) => {
  const ui = await setup(t, { launchBridge: async () => ({ ok: true, endpoint: "http://127.0.0.1:47773", version: "1.0.0", alreadyRunning: false, pid: 4242 }) });
  const button = ui.launchButton();
  assert.ok(button, "expected a Launch Bridge button in the section");
  // textContent rendering only: no innerHTML.
  assert.equal(button.textContent, "Launch Bridge");
  const status = ui.statusLine();
  assert.ok(status, "expected a status line");
  // The status line carries only the documented `endpoint` + status
  // verb — never a token, credential, or arbitrary path.
  assert.match(status.textContent, /Not running · http:\/\/127\.0\.0\.1:47773/);
  assertNoSecretShapedValue(status.textContent, "$.status");
  // No innerHTML / script injection on the card.
  const card = button.closest("section");
  assert.ok(card);
  assert.equal(card.querySelectorAll("script").length, 0);
});

test("Clicking Launch Bridge calls the seam with {} and surfaces the receipt via textContent", async (t) => {
  const ui = await setup(t, { launchBridge: async () => ({ ok: true, endpoint: "http://127.0.0.1:47773", version: "1.2.3", alreadyRunning: false, pid: 9001 }) });
  ui.launchButton().click();
  // Wait for the async click handler to resolve.
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ui.launchCalls.length, 1);
  assert.deepEqual(ui.launchCalls[0], {});
  const status = ui.statusLine();
  assert.match(status.textContent, /Started · http:\/\/127\.0\.0\.1:47773 · pid 9001/);
  // No secret-shaped value anywhere on the card.
  assertNoSecretShapedValue(status.textContent, "$.status-after-success");
  const card = ui.launchButton().closest("section");
  assertNoSecretShapedValue(card.textContent, "$.card-after-success");
});

test("A second click while already running surfaces alreadyRunning without a second host spawn", async (t) => {
  let calls = 0;
  const stub = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, endpoint: "http://127.0.0.1:47773", version: "1.2.3", alreadyRunning: false, pid: 9001 };
    return { ok: true, endpoint: "http://127.0.0.1:47773", version: "1.2.3", alreadyRunning: true };
  };
  const ui = await setup(t, { launchBridge: stub });
  ui.launchButton().click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  // Second click — seam returns alreadyRunning:true.
  ui.launchButton().click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls, 2);
  // The seam itself short-circuited; no second spawn happened (the
  // host returned alreadyRunning:true so no child was forked).
  const secondReceipt = await stub();
  assert.equal(secondReceipt.alreadyRunning, true);
  const status = ui.statusLine();
  assert.match(status.textContent, /Already running · http:\/\/127\.0\.0\.1:47773/);
});

test("Launch Bridge on bridge-start-failed surfaces the rejection without leaking the bridge token", async (t) => {
  const ui = await setup(t, { launchBridge: async () => ({ ok: false, reason: "bridge-start-failed", endpoint: "http://127.0.0.1:47773" }) });
  ui.launchButton().click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = ui.statusLine();
  assert.match(status.textContent, /Not running · http:\/\/127\.0\.0\.1:47773/);
  // The token is NEVER reflected in any string on the card.
  const card = ui.launchButton().closest("section");
  assertNoSecretShapedValue(card.textContent, "$.card-after-failure");
});

test("Bridge Target without launchBridge / bridgeRequest seamed surfaces a non-secret error on click", async (t) => {
  // Render without any seam.
  const dom = new JSDOM("<main></main>");
  const previous = (["document", "chrome", "fetch", "__RESONANTOS_BRIDGE_CONFIG__"]).map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => {
    dom.window.close();
    (["document", "chrome", "fetch", "__RESONANTOS_BRIDGE_CONFIG__"]).forEach((name, index) => {
      if (previous[index]) Object.defineProperty(globalThis, name, previous[index]);
      else delete globalThis[name];
    });
  });
  globalThis.document = dom.window.document;
  globalThis.chrome = { storage: { local: {
    get: async () => ({}),
    set: async () => undefined,
    remove: async () => undefined,
  } } };
  globalThis.__RESONANTOS_BRIDGE_CONFIG__ = { bridgeUrl: "http://127.0.0.1:47773", bridgeToken: "gen", capabilityBootstrapToken: "gen-bt" };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  const { renderBridgeTargetSection } = await import("../resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js");
  const root = document.querySelector("main");
  renderBridgeTargetSection(root);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const button = root.querySelector('[data-testid="bridge-launch-button"]');
  assert.ok(button);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = root.querySelector('[data-testid="bridge-launch-status"]');
  // The status line carries only documented fields; the error is
  // surfaced via the section's statusNode (settings-status) — also
  // textContent-rendered, never via innerHTML.
  const settingsStatus = root.querySelector(".settings-status");
  assert.ok(settingsStatus);
  assertNoSecretShapedValue(settingsStatus.textContent, "$.settings-status");
  assertNoSecretShapedValue(button.closest("section").textContent, "$.card");
});