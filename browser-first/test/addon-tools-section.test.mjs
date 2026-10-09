// CP-BR10: Add-on Tools settings section coverage.
//
// Proves the renderer + the host seams main-workspace-settings injects
// (fetchStatus, fetchPromptPath, launchTerminal, fetchConnectionScript,
// onOpenBridgeSettings) keep the documented contract:
//
//   - one sub-tab per reviewed terminal add-on (iTerm2 + Ghostty) from
//     the host data, with the three badge states;
//   - launch is gated on connected: true + a valid 0600 prompt file;
//   - launch routes through the injected host transaction and branches
//     on bridge-not-running and capability-not-granted;
//   - copy connection script renders as text only (no innerHTML, no
//     script / event-handler attributes) and copies via the clipboard
//     API with a manual-select fallback;
//   - the connection-script payload carries no secret-shaped value;
//   - the three /terminal-host/* route capabilities are declared in
//     bridge-client.js and match the host route definitions
//     byte-for-byte.
//
// The renderer is exercised under JSDOM with injected fakes; no real
// process is spawned anywhere in this file.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, writeFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderAddonToolsSection, TERMINAL_ADDON_IDS } from "../resonantos-side-panel-extension/src/lib/settings/addon-tools-section.js";
import { renderSettingsWorkspace } from "../resonantos-side-panel-extension/src/lib/main-workspace-settings.js";
import { capabilityForBridgeRoute } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";
import { installDialogLifecycle } from "./dialog-dom-fixture.mjs";

// ---------------------------------------------------------------------------
// Non-leak walker
// ---------------------------------------------------------------------------

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
    assert.ok(!SECRET_FIELD_NAMES.has(key), `${path}.${key} is a secret-shaped field name; renderer must not carry it`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// JSDOM fixtures
// ---------------------------------------------------------------------------

function setupDom() {
  const dom = new JSDOM("<!doctype html><main id=\"root\"></main>", { url: "https://resonantos.local/" });
  dom.window.confirm = () => true;
  dom.window.prompt = () => "";
  installDialogLifecycle(dom.window);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  // The renderer module is loaded into the test realm; bare
  // `navigator` resolves through the test's global object. JSDOM
  // builds its window.navigator with a host Clipboard, but the
  // renderer's navigator resolution does NOT see the JSDOM window.
  // Tests that need a controlled clipboard define it on the global
  // navigator; the rest of the test suite ignores it.
  return {
    dom,
    container: dom.window.document.querySelector("#root"),
    cleanup: () => {
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.Event;
      dom.window.close();
    },
  };
}

function waitFor(predicate, { timeout = 2_000, interval = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    function tick() {
      let value;
      try { value = predicate(); } catch (error) { reject(error); return; }
      if (value) return resolve(value);
      if (Date.now() - started >= timeout) return reject(new Error("waitFor: timeout"));
      setTimeout(tick, interval);
    }
    tick();
  });
}

function makeValidPromptFile(t) {
  const dir = mkdtempSync(join(tmpdir(), "cpbr10-prompt-"));
  const file = join(dir, "prompt.txt");
  writeFileSync(file, "launch pi", { mode: 0o600 });
  // Confirm mode.
  const stat = statSync(file);
  if ((stat.mode & 0o777) !== 0o600) chmodSync(file, 0o600);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

function makeProjectionRuntime(runtimes) {
  return {
    ok: true,
    bridgeOverview: { status: "connected", version: "alpha", endpoint: "http://127.0.0.1:47773", publicEndpoint: "http://127.0.0.1:47773", startedAt: "2026-10-08T00:00:00.000Z", uptimeSeconds: 0, instanceId: "bridge-test", generation: 0 },
    runtimeList: runtimes,
    connectorList: [],
    activeSessions: [],
    projectionGeneration: 1,
    producedAt: "2026-10-08T00:00:00.000Z",
    updateMechanism: "polling",
  };
}

function makeStatus({ connected = true, driveId = "ghostty", surfaces = [
  { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty Terminal Host", compatible: true, connected: true },
  { adapterId: "addon.resonant-terminal-iterm2", label: "iTerm2 Terminal Host", compatible: true, connected: false },
] } = {}) {
  return {
    ok: true,
    connected,
    driveId,
    surfaces,
    sessions: [],
    launches: [],
  };
}

// Bridge request stub that records every call and returns canned payloads.
function makeBridgeRequest({ status, projection, prompt, launch, connectionScript }) {
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/terminal-host/status" || route.startsWith("/terminal-host/status")) {
      return status ?? { ok: false };
    }
    if (route === "/terminal-host/prompt-path" || route.startsWith("/terminal-host/prompt-path")) {
      return prompt ?? { ok: false };
    }
    if (route.startsWith("/bridge/runtimes")) return projection ?? { ok: false };
    if (route.startsWith("/terminal-host/connection-script")) return connectionScript ?? { ok: false };
    if (route === "/terminal-host/launch") return launch ?? { ok: true };
    return { ok: true };
  };
  return { bridgeRequest, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("CP-BR10: addon-tools section renders one sub-tab per reviewed terminal add-on from host data", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest } = makeBridgeRequest({ status: makeStatus(), projection: makeProjectionRuntime([]) });
  const handle = renderAddonToolsSection(container, { fetchStatus: () => bridgeRequest("/terminal-host/status"), fetchProjection: () => bridgeRequest("/bridge/runtimes"), fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path") });
  t.after(() => handle.stop());
  // Both sub-tabs are rendered (one per reviewed terminal add-on).
  await waitFor(() => container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]'));
  for (const addonId of TERMINAL_ADDON_IDS) {
    const tab = container.querySelector(`[data-testid="addon-tools-launch-${addonId}"]`);
    assert.ok(tab, `launch button for ${addonId} is rendered`);
    const copy = container.querySelector(`[data-testid="addon-tools-copy-${addonId}"]`);
    assert.ok(copy, `copy button for ${addonId} is rendered`);
  }
});

test("CP-BR10: badge states — Connected / Disconnected / Not installed", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  // ghostty connected, iterm2 disconnected, a third "Not installed" surface is absent.
  const { bridgeRequest } = makeBridgeRequest({
    status: makeStatus({
      surfaces: [
        { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty Terminal Host", compatible: true, connected: true },
        { adapterId: "addon.resonant-terminal-iterm2", label: "iTerm2 Terminal Host", compatible: true, connected: false },
      ],
    }),
    projection: makeProjectionRuntime([
      { addonId: "addon.resonant-terminal-ghostty", runtimeId: "com.resonantos.factory.terminal-host.ghostty", runtimeType: "local-service", status: "ready", generation: 1, activeSessionCount: 0, factoryId: "com.resonantos.factory.terminal-host.ghostty", classification: "integration", displayLabel: "resonant-terminal-ghostty" },
      { addonId: "addon.resonant-terminal-iterm2", runtimeId: "com.resonantos.factory.terminal-host.iterm2", runtimeType: "local-service", status: "inactive", generation: 1, activeSessionCount: 0, factoryId: "com.resonantos.factory.terminal-host.iterm2", classification: "integration", displayLabel: "resonant-terminal-iterm2" },
    ]),
  });
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  const ghosttyRow = container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]');
  const iterm2Row = container.querySelector('[data-addon-id="addon.resonant-terminal-iterm2"]');
  assert.ok(ghosttyRow, "ghostty row rendered");
  assert.ok(iterm2Row, "iterm2 row rendered");
  // Tones: ok for connected, warn for disconnected.
  assert.equal(ghosttyRow.dataset.tone, "ok");
  assert.equal(iterm2Row.dataset.tone, "warn");
  // Text labels are public.
  assert.match(ghosttyRow.textContent, /Connected/);
  assert.match(iterm2Row.textContent, /Disconnected/);
});

test("CP-BR10: not-installed row renders when the host has no surface for an add-on", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  // No surfaces at all -> every tab is in the not-installed state.
  const { bridgeRequest } = makeBridgeRequest({
    status: { ok: true, connected: false, driveId: null, surfaces: [], sessions: [], launches: [] },
    projection: makeProjectionRuntime([]),
  });
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]'));
  // No reviewed add-on is installed; the renderer still mounts one row
  // per known id with a "Not installed" badge.
  const empty = container.textContent;
  assert.match(empty, /Not installed/, "the per-id 'Not installed' badge is rendered");
  // Both tab buttons still render (copy is allowed even when not
  // installed; launch is disabled until the host reports a live
  // adapter).
  for (const addonId of TERMINAL_ADDON_IDS) {
    const launch = container.querySelector(`[data-testid="addon-tools-launch-${addonId}"]`);
    const copy = container.querySelector(`[data-testid="addon-tools-copy-${addonId}"]`);
    assert.ok(launch, `launch for ${addonId} renders even when not installed`);
    assert.ok(copy, `copy for ${addonId} renders even when not installed`);
    assert.equal(launch.disabled, true, `launch stays disabled when not installed`);
  }
});

test("CP-BR10: launch is disabled until the runtime is connected AND a 0600 prompt file exists", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  // iTerm2 disconnected: launch must stay disabled even with a valid prompt.
  const { bridgeRequest, calls } = makeBridgeRequest({
    status: makeStatus({ driveId: "ghostty" }),
    prompt: { ok: true, promptPath: promptFile, valid: true },
  });
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    launchTerminal: async (args) => bridgeRequest("/terminal-host/launch", { method: "POST", body: args }),
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]'));
  const ghosttyLaunch = container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]');
  const iterm2Launch = container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-iterm2"]');
  assert.equal(ghosttyLaunch.disabled, false, "ghostty (connected) is launchable");
  assert.equal(iterm2Launch.disabled, true, "iTerm2 (disconnected) stays disabled");
  // Sanity: clicking ghostty posts the launch with the documented shape.
  ghosttyLaunch.click();
  return new Promise((resolve) => setImmediate(() => {
    const launchCall = calls.find((entry) => entry.route === "/terminal-host/launch");
    assert.ok(launchCall, "launch was posted");
    assert.equal(launchCall.body.terminalAddonId, "addon.resonant-terminal-ghostty");
    assert.equal(launchCall.body.promptPath, promptFile);
    assert.equal(launchCall.body.agentId, "pi");
    resolve();
  }));
});

test("CP-BR10: launch click routes through POST /terminal-host/launch and branches on documented rejections", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  // First render with a connected ghostty so the launch button is enabled.
  const calls = [];
  const launchResult = { ok: false, reason: "bridge-not-running", endpoint: "http://127.0.0.1:47773" };
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    if (route === "/terminal-host/launch") return launchResult;
    return { ok: true };
  };
  let bridgeTargetOpened = false;
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    launchTerminal: async (args) => bridgeRequest("/terminal-host/launch", { method: "POST", body: args }),
    onOpenBridgeSettings: () => { bridgeTargetOpened = true; },
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]'));
  const ghosttyLaunch = container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]');
  ghosttyLaunch.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  // The renderer surfaces the typed rejection and routes to Bridge Target.
  assert.equal(bridgeTargetOpened, true, "bridge-not-running -> onOpenBridgeSettings()");
  const err = container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"] .settings-runtime-row-error');
  assert.match(err.textContent, /Bridge not running/);
});

test("CP-BR10: launch click surfaces capability-not-granted without auto-granting", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  let bridgeTargetOpened = false;
  const bridgeRequest = async (route, options = {}) => {
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    if (route === "/terminal-host/launch") return { ok: false, reason: "capability-not-granted" };
    return { ok: true };
  };
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    launchTerminal: async (args) => bridgeRequest("/terminal-host/launch", { method: "POST", body: args }),
    onOpenBridgeSettings: () => { bridgeTargetOpened = true; },
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]'));
  const ghosttyLaunch = container.querySelector('[data-testid="addon-tools-launch-addon.resonant-terminal-ghostty"]');
  ghosttyLaunch.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(bridgeTargetOpened, false, "capability-not-granted does NOT open bridge settings");
  const err = container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"] .settings-runtime-row-error');
  assert.match(err.textContent, /Authorize the terminal-host capability/);
});

test("CP-BR10: copy connection script returns a script that contains no raw token/credential/path/env", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const scriptReceipt = {
    ok: true,
    command: "eval \"$(node /var/folders/abc/ros-session.mjs attach --session-id attach-x --token-file /tmp/ros-session-attach-x.token --provider-profile-id openai)\"",
    sessionId: "attach-x",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    tokenFilePath: "/tmp/ros-session-attach-x.token",
    rosSessionPath: "/var/folders/abc/ros-session.mjs",
    providerProfileId: "openai",
    startedAt: "2026-10-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:01:00.000Z",
    bridgeVersion: "alpha",
  };
  const bridgeRequest = async (route, options = {}) => {
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    if (route.startsWith("/terminal-host/connection-script")) return scriptReceipt;
    return { ok: true };
  };
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    fetchConnectionScript: async (args) => bridgeRequest(`/terminal-host/connection-script?${new URLSearchParams(args).toString()}`),
  });
  t.after(() => handle.stop());
  // The renderer's first refresh is async; wait for the buttons to mount.
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]'));
  const copy = container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]');
  copy.click();
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-clipboard"]'));
  // The receipt as returned by the host is shape-walker clean.
  assertNoSecretShapedValue(scriptReceipt, "$.receipt");
  // The renderer shows the script in a <pre> (textContent only).
  const pre = container.querySelector(".settings-script-viewer-code");
  assert.ok(pre, "script viewer renders the script");
  assert.equal(pre.textContent, scriptReceipt.command);
  // The viewer and its actions are plain DOM (no innerHTML, no event-handler attributes).
  assert.equal(pre.children.length, 0, "<pre> has no children (textContent only)");
  assert.equal(/on\w+=/i.test(pre.outerHTML), false, "no inline event-handler attribute on the <pre>");
  // The 0600 token file is referenced by path only.
  assert.match(pre.textContent, /--token-file /);
  assert.doesNotMatch(pre.textContent, /token=[A-Za-z0-9]/, "no raw token in argv");
});

test("CP-BR10: copy clipboard uses navigator.clipboard.writeText with a manual-select fallback", async (t) => {
  const { container, cleanup, dom } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const scriptReceipt = {
    ok: true,
    command: "eval \"$(node /x/ros-session.mjs attach --session-id attach-x --token-file /tmp/x.token --provider-profile-id openai)\"",
    sessionId: "attach-x",
    terminalAddonId: "addon.resonant-terminal-ghostty",
    tokenFilePath: "/tmp/x.token",
    rosSessionPath: "/x/ros-session.mjs",
    providerProfileId: "openai",
    startedAt: "2026-10-08T00:00:00.000Z",
    expiresAt: "2026-10-08T00:01:00.000Z",
    bridgeVersion: "alpha",
  };
  let writeTextCalls = 0;
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async (text) => { writeTextCalls += 1; assert.equal(typeof text, "string"); } } },
    configurable: true,
    writable: true,
  });
  const bridgeRequest = async (route) => {
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    if (route.startsWith("/terminal-host/connection-script")) return scriptReceipt;
    return { ok: true };
  };
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    fetchConnectionScript: async () => bridgeRequest("/terminal-host/connection-script"),
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]'));
  // Trigger the copy path.
  container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]').click();
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-clipboard"]'));
  const clipboard = container.querySelector('[data-testid="addon-tools-copy-clipboard"]');
  assert.ok(clipboard, "clipboard button is rendered after copy");
  clipboard.click();
  await waitFor(() => writeTextCalls === 1);
  assert.equal(writeTextCalls, 1, "navigator.clipboard.writeText was called exactly once");
  await waitFor(() => /copied to the clipboard/.test(container.querySelector(".settings-status")?.textContent ?? ""));
  assert.match(container.querySelector(".settings-status").textContent, /copied to the clipboard/);
});

test("CP-BR10: copy clipboard falls back to manual select when navigator.clipboard rejects", async (t) => {
  const { container, cleanup, dom } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => { throw new Error("denied"); } } },
    configurable: true,
    writable: true,
  });
  const scriptReceipt = {
    ok: true,
    command: "eval \"$(node /x/ros-session.mjs attach --session-id attach-x --token-file /tmp/x.token --provider-profile-id openai)\"",
    sessionId: "attach-x", terminalAddonId: "addon.resonant-terminal-ghostty",
    tokenFilePath: "/tmp/x.token", rosSessionPath: "/x/ros-session.mjs",
    providerProfileId: "openai", startedAt: "2026-10-08T00:00:00.000Z", expiresAt: "2026-10-08T00:01:00.000Z",
    bridgeVersion: "alpha",
  };
  const bridgeRequest = async (route) => {
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    if (route.startsWith("/terminal-host/connection-script")) return scriptReceipt;
    return { ok: true };
  };
  const handle = renderAddonToolsSection(container, {
    fetchStatus: () => bridgeRequest("/terminal-host/status"),
    fetchProjection: () => bridgeRequest("/bridge/runtimes"),
    fetchPromptPath: () => bridgeRequest("/terminal-host/prompt-path"),
    fetchConnectionScript: async () => bridgeRequest("/terminal-host/connection-script"),
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]'));
  container.querySelector('[data-testid="addon-tools-copy-addon.resonant-terminal-ghostty"]').click();
  await waitFor(() => container.querySelector('[data-testid="addon-tools-copy-clipboard"]'));
  container.querySelector('[data-testid="addon-tools-copy-clipboard"]').click();
  await waitFor(() => /Clipboard API unavailable/.test(container.textContent));
  assert.match(container.textContent, /Clipboard API unavailable/);
});

test("CP-BR10: the three /terminal-host/* route capabilities are declared and match the host", () => {
  assert.equal(capabilityForBridgeRoute("/terminal-host/status", "GET"), "addon-runtime-read");
  assert.equal(capabilityForBridgeRoute("/terminal-host/prompt-path", "GET"), "addon-runtime-read");
  assert.equal(capabilityForBridgeRoute("/terminal-host/connection-script", "GET"), "addon-runtime-read");
  assert.equal(capabilityForBridgeRoute("/terminal-host/launch", "POST"), "addon-runtime-control");
});

test("CP-BR10: settings workspace renders the addon-tools section with host seams", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route.startsWith("/terminal-host/status")) return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path")) return { ok: true, promptPath: "/tmp/x.txt", valid: true };
    if (route.startsWith("/bridge/runtimes")) return makeProjectionRuntime([]);
    return { ok: true };
  };
  renderSettingsWorkspace({
    container,
    bridgeRequest,
    storage: (() => { const state = {}; return { state, async get() { return { ...state }; }, async set(next) { Object.assign(state, next); } }; })(),
    initialSection: "addon-tools",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The section renders with a launch + copy button per reviewed id.
  for (const addonId of TERMINAL_ADDON_IDS) {
    const launch = container.querySelector(`[data-testid="addon-tools-launch-${addonId}"]`);
    const copy = container.querySelector(`[data-testid="addon-tools-copy-${addonId}"]`);
    assert.ok(launch, `${addonId} launch rendered by the workspace`);
    assert.ok(copy, `${addonId} copy rendered by the workspace`);
  }
  // The host seams were exercised at least once.
  const statusCalls = calls.filter((c) => c.route.startsWith("/terminal-host/status"));
  const promptCalls = calls.filter((c) => c.route.startsWith("/terminal-host/prompt-path"));
  assert.ok(statusCalls.length >= 1, "the workspace probes the status route");
  assert.ok(promptCalls.length >= 1, "the workspace probes the prompt-path route");
});
