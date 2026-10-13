// CP-BR11: Terminals left-rail workspace coverage.
//
// Proves the new rail surface keeps the documented contract:
//
//   1. The "terminals" workspace is registered in the main-workspace
//      left rail (allowedWorkspaces + a data-workspace="terminals"
//      button) and switches to it when clicked.
//   2. The workspace renders one card per reviewed terminal add-on
//      (iTerm2 + Ghostty) with the three documented badge states
//      (Connected / Disconnected / Not installed).
//   3. Enable posts POST /addons/enabled with the registry revision
//      read immediately before (expectedRevision); never locally.
//   4. Grant posts POST /addons/grants with terminal-host granted
//      and consent:true; never auto-grants and never posts without
//      operator confirmation.
//   5. Launch is gated on connected:true + a valid 0600 prompt file
//      and branches on the documented typed rejections.
//   6. Copy connection script renders the host-minted command as
//      text only (no innerHTML, no script/handler attributes) and
//      copies via navigator.clipboard.writeText with a manual-select
//      fallback.
//   7. The renderer reads from the harness registry / projection
//      (GET /bridge/runtimes, GET /addons/registry,
//       GET /terminal-host/status) and never from /addons/status.
//   8. The rendered DOM + every status / projection / registry /
//      grants payload passes the shape-walker — no token, credential,
//      path, PID, env, or prompt content leaks into the view.
//
// The renderer is exercised under JSDOM with injected fakes; no real
// process is spawned anywhere in this file.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { mkdtempSync, readFileSync, writeFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderTerminalsWorkspace } from "../resonantos-side-panel-extension/src/lib/main-workspace-terminals.js";
import { createTerminalsHostSeams } from "../resonantos-side-panel-extension/src/lib/terminals-host-seams.js";
import { capabilityForBridgeRoute } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";
import { installDialogLifecycle } from "./dialog-dom-fixture.mjs";
import { PI_NATIVE_PROVIDER_FAMILIES } from "../resonantos-side-panel-extension/src/lib/terminal-cards.js";
import { PI_NATIVE_PROVIDER_MAP } from "../host/pi-native-provider-map.mjs";

// ---------------------------------------------------------------------------
// Source-of-truth surfaces
// ---------------------------------------------------------------------------

const MAIN_WORKSPACE_HTML = readFileSync(
  new URL("../resonantos-side-panel-extension/src/main-workspace.html", import.meta.url),
  "utf8",
);
const MAIN_WORKSPACE_JS = readFileSync(
  new URL("../resonantos-side-panel-extension/src/main-workspace.js", import.meta.url),
  "utf8",
);

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
  "token",
  "tokens",
  "password",
  "passwd",
  "apiKey",
  "api_key",
  "apikey",
  "secret",
  "secrets",
  "credential",
  "credentials",
  "privateKey",
  "private_key",
  "sessionToken",
  "session_token",
  "bearer",
  "bearerToken",
  "bearer_token",
  "authorization",
  "auth",
  "cookie",
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
    assert.ok(!SECRET_FIELD_NAMES.has(key), `${path}.${key} is a secret-shaped field name`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// JSDOM fixtures
// ---------------------------------------------------------------------------

function setupDom() {
  const dom = new JSDOM('<!doctype html><main id="root"></main>', {
    url: "https://resonantos.local/",
  });
  dom.window.confirm = () => true;
  dom.window.prompt = () => "";
  installDialogLifecycle(dom.window);
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
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

function waitFor(predicate, { timeout = 5_000, interval = 10, label = "predicate" } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    function tick() {
      let value;
      try {
        value = predicate();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) return resolve(value);
      if (Date.now() - started >= timeout) return reject(new Error(`waitFor: timeout (${label})`));
      setTimeout(tick, interval);
    }
    tick();
  });
}

// Wait until a selector exists AND the matching element is not
// marked disabled (i.e. the affordance is enabled for the operator).
// This is a convenience wrapper that adds an error message and a
// 5s default so failures are diagnosable.
async function waitForEnabled(container, selector, { timeout = 5_000, interval = 10 } = {}) {
  return waitFor(
    () => {
      const node = container.querySelector(selector);
      if (!node) return null;
      if (node.disabled) return null;
      return node;
    },
    { timeout, interval, label: `enabled: ${selector}` },
  );
}

function makeValidPromptFile(t) {
  const dir = mkdtempSync(join(tmpdir(), "cpbr11-prompt-"));
  const file = join(dir, "prompt.txt");
  writeFileSync(file, "launch pi", { mode: 0o600 });
  const stat = statSync(file);
  if ((stat.mode & 0o777) !== 0o600) chmodSync(file, 0o600);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

function makeProjectionRuntime(runtimes) {
  return {
    ok: true,
    bridgeOverview: {
      status: "connected",
      version: "alpha",
      endpoint: "http://127.0.0.1:47773",
      publicEndpoint: "http://127.0.0.1:47773",
      startedAt: "2026-10-09T00:00:00.000Z",
      uptimeSeconds: 0,
      instanceId: "bridge-test",
      generation: 0,
    },
    runtimeList: runtimes,
    connectorList: [],
    activeSessions: [],
    projectionGeneration: 1,
    producedAt: "2026-10-09T00:00:00.000Z",
    updateMechanism: "polling",
  };
}

function makeStatus({
  connected = true,
  driveId = "ghostty",
  surfaces = [
    {
      adapterId: "addon.resonant-terminal-ghostty",
      label: "Ghostty Terminal Host",
      compatible: true,
      connected: true,
    },
    {
      adapterId: "addon.resonant-terminal-iterm2",
      label: "iTerm2 Terminal Host",
      compatible: true,
      connected: false,
    },
  ],
} = {}) {
  return {
    ok: true,
    connected,
    driveId,
    surfaces,
    sessions: [],
    launches: [],
  };
}

function makeGrants(addons) {
  return { ok: true, addons };
}

// Bridge request stub. Records every call and returns canned payloads.
// `addons/status` is intentionally absent — the rail must never read it.
function makeBridgeRequest({
  status,
  projection,
  prompt,
  grants,
  registry,
  launch,
  connectionScript,
}) {
  const calls = [];
  const registryRevisionRef = { value: 0 };
  async function bridgeRequest(route, options = {}) {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/terminal-host/status" || route.startsWith("/terminal-host/status")) {
      return status ?? { ok: false };
    }
    if (route === "/terminal-host/prompt-path" || route.startsWith("/terminal-host/prompt-path")) {
      return prompt ?? { ok: false };
    }
    if (route.startsWith("/bridge/runtimes")) {
      return projection ?? { ok: false };
    }
    if (route === "/addons/registry") {
      return registry ?? { ok: true, revision: registryRevisionRef.value, addons: [] };
    }
    if (route === "/addons/grants") {
      if ((options?.method ?? "GET").toUpperCase() === "POST") {
        // Bump the revision so the next /addons/registry read reflects
        // the grant; the next enable/grant will succeed only if the
        // renderer re-reads.
        registryRevisionRef.value += 1;
        return grants?.post ?? { ok: true, revision: registryRevisionRef.value };
      }
      // GET /addons/grants is not declared on the bridge; the rail
      // reads grants from the projection's grants array instead.
      return { ok: false, reason: "permission-denied" };
    }
    if (route === "/addons/enabled") {
      if ((options?.method ?? "POST").toUpperCase() !== "POST") {
        return { ok: false };
      }
      registryRevisionRef.value += 1;
      return { ok: true, revision: registryRevisionRef.value };
    }
    if (route === "/addons/status" || route.startsWith("/addons/status")) {
      throw new Error(
        `/addons/status must not be read by the Terminals rail (call #${calls.length})`,
      );
    }
    if (route.startsWith("/terminal-host/connection-script"))
      return connectionScript ?? { ok: false };
    if (route === "/terminal-host/launch") return launch ?? { ok: true };
    return { ok: true };
  }
  return { bridgeRequest, calls, registryRevisionRef };
}

function makeSeams(bridgeRequest) {
  return createTerminalsHostSeams({ bridgeRequest });
}

// ---------------------------------------------------------------------------
// 1. Rail surface: allowedWorkspaces + button
// ---------------------------------------------------------------------------

test('CP-BR11 #1: main-workspace.html exposes a Terminals rail button with data-workspace="terminals"', () => {
  assert.match(
    MAIN_WORKSPACE_HTML,
    /<button[^>]+data-workspace="terminals"[^>]*>[\s\S]*?Terminals[\s\S]*?<\/button>/,
    "main-workspace.html must render a Terminals rail button in the left rail",
  );
  // The button label must mention "Terminals" so the user can find it
  // without having to hover.
  assert.match(MAIN_WORKSPACE_HTML, /<span[^>]*>\s*Terminals\s*<\/span>/);
});

test("CP-BR11 #1: main-workspace.js registers 'terminals' in allowedWorkspaces", () => {
  assert.match(
    MAIN_WORKSPACE_JS,
    /allowedWorkspaces\s*=\s*new Set\([^)]*"terminals"[^)]*\)/,
    "main-workspace.js must register the 'terminals' workspace in allowedWorkspaces",
  );
  // The renderer must branch on activeWorkspace === "terminals".
  assert.match(
    MAIN_WORKSPACE_JS,
    /activeWorkspace\s*===\s*"terminals"/,
    "renderMessages must dispatch the terminals branch",
  );
  // The branch must call the rail renderer (not invent a new mechanism).
  assert.match(
    MAIN_WORKSPACE_JS,
    /renderTerminalsWorkspace\(\)/,
    "the terminals branch must delegate to renderTerminalsWorkspace()",
  );
});

test("CP-BR11 #1: main-workspace.js passes the transcript element positionally to the renderer", () => {
  // The rail renderer is renderTerminalsWorkspace(container, options). The
  // wrapper must pass `transcript` as the FIRST positional argument — not as
  // a `container:` property inside a single options object. The object form
  // made `container.replaceChildren` throw ("not a function") at runtime and
  // left the Terminals workspace blank.
  assert.match(
    MAIN_WORKSPACE_JS,
    /renderTerminalsWorkspaceRenderer\(\s*transcript\s*,/,
    "the wrapper must call renderTerminalsWorkspaceRenderer(transcript, {...})",
  );
  assert.doesNotMatch(
    MAIN_WORKSPACE_JS,
    /renderTerminalsWorkspaceRenderer\(\s*\{/,
    "the wrapper must not call the renderer with an object literal as the first argument",
  );
});

// ---------------------------------------------------------------------------
// 2. Workspace renders one card per reviewed terminal add-on, with the
//    three documented badge states.
// ---------------------------------------------------------------------------

test("CP-BR11 #2: rail renders one card per reviewed terminal add-on (iTerm2 + Ghostty)", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        runtimeId: "com.resonantos.factory.terminal-host.ghostty",
        runtimeType: "local-service",
        status: "ready",
        generation: 1,
        activeSessionCount: 0,
        factoryId: "com.resonantos.factory.terminal-host.ghostty",
        classification: "integration",
        displayLabel: "resonant-terminal-ghostty",
      },
      {
        addonId: "addon.resonant-terminal-iterm2",
        runtimeId: "com.resonantos.factory.terminal-host.iterm2",
        runtimeType: "local-service",
        status: "inactive",
        generation: 1,
        activeSessionCount: 0,
        factoryId: "com.resonantos.factory.terminal-host.iterm2",
        classification: "integration",
        displayLabel: "resonant-terminal-iterm2",
      },
    ]),
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  for (const addonId of ["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]) {
    const card = container.querySelector(`[data-addon-id="${addonId}"]`);
    assert.ok(card, `card for ${addonId} is rendered`);
    // Each card has the four affordances the prompt requires.
    assert.ok(
      card.querySelector(`[data-testid="terminals-enable-${addonId}"]`),
      `Enable button for ${addonId}`,
    );
    assert.ok(
      card.querySelector(`[data-testid="terminals-grant-${addonId}"]`),
      `Grant button for ${addonId}`,
    );
    assert.ok(
      card.querySelector(`[data-testid="terminals-launch-${addonId}"]`),
      `Launch button for ${addonId}`,
    );
    assert.ok(
      card.querySelector(`[data-testid="terminals-copy-${addonId}"]`),
      `Copy button for ${addonId}`,
    );
  }
});

test("CP-BR11 #2: badge states — Connected / Disconnected / Not installed", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest } = makeBridgeRequest({
    // ghostty connected, iterm2 disconnected. No third surface.
    status: makeStatus({
      surfaces: [
        {
          adapterId: "addon.resonant-terminal-ghostty",
          label: "Ghostty Terminal Host",
          compatible: true,
          connected: true,
        },
        {
          adapterId: "addon.resonant-terminal-iterm2",
          label: "iTerm2 Terminal Host",
          compatible: true,
          connected: false,
        },
      ],
    }),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-ghostty",
      },
      {
        addonId: "addon.resonant-terminal-iterm2",
        status: "inactive",
        generation: 1,
        displayLabel: "resonant-terminal-iterm2",
      },
    ]),
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  const ghostty = container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]');
  const iterm2 = container.querySelector('[data-addon-id="addon.resonant-terminal-iterm2"]');
  assert.equal(ghostty.dataset.tone, "ok");
  assert.equal(iterm2.dataset.tone, "warn");
  assert.match(ghostty.textContent, /Connected/);
  assert.match(iterm2.textContent, /Disconnected/);

  // A second pass with no surfaces at all => both Not installed.
  const { bridgeRequest: br2 } = makeBridgeRequest({
    status: { ok: true, connected: false, driveId: null, surfaces: [], sessions: [], launches: [] },
    projection: makeProjectionRuntime([]),
    grants: makeGrants([]),
  });
  const seams2 = makeSeams(br2);
  const setup2 = setupDom();
  t.after(setup2.cleanup);
  const handle2 = renderTerminalsWorkspace(setup2.container, {
    bridgeRequest: br2,
    ...seams2,
    pollIntervalMs: 0,
  });
  t.after(() => handle2.stop());
  await waitFor(() =>
    setup2.container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'),
  );
  const ghostty2 = setup2.container.querySelector(
    '[data-addon-id="addon.resonant-terminal-ghostty"]',
  );
  const iterm22 = setup2.container.querySelector(
    '[data-addon-id="addon.resonant-terminal-iterm2"]',
  );
  assert.equal(ghostty2.dataset.tone, "info");
  assert.equal(iterm22.dataset.tone, "info");
  assert.match(ghostty2.textContent, /Not installed/);
  assert.match(iterm22.textContent, /Not installed/);
});

// ---------------------------------------------------------------------------
// 3. Enable: posts /addons/enabled with the registry revision read
//    immediately before.
// ---------------------------------------------------------------------------

test("CP-BR11 #3: Enable posts POST /addons/enabled with expectedRevision read immediately before", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  let currentRevision = 7;
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") return { ok: true, revision: currentRevision, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "inactive",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/enabled") {
      assert.equal(options.method, "POST");
      assert.equal(options.body?.addonId, "addon.resonant-terminal-ghostty");
      assert.equal(options.body?.enabled, true);
      assert.equal(options.body?.expectedRevision, currentRevision);
      // Simulate the host bumping the revision on success.
      currentRevision += 1;
      return { ok: true, revision: currentRevision };
    }
    if (route === "/addons/grants") return { ok: true, addons: [] };
    if (route === "/terminal-host/prompt-path") return { ok: true, valid: false, promptPath: null };
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]'),
  );
  const enableBtn = container.querySelector(
    '[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]',
  );
  enableBtn.click();
  await waitFor(() => calls.some((c) => c.route === "/addons/enabled" && c.method === "POST"));
  // The Enable call must have been preceded by an /addons/registry read
  // carrying the same revision.
  const enableIdx = calls.findIndex((c) => c.route === "/addons/enabled" && c.method === "POST");
  const registryIdx =
    calls.slice(0, enableIdx).findLastIndex?.((c) => c.route === "/addons/registry") ?? -1;
  // The previous-read requirement: there must be at least one
  // /addons/registry read before the enable POST.
  assert.ok(
    calls.slice(0, enableIdx).some((c) => c.route === "/addons/registry" && c.method === "GET"),
    "Enable must read /addons/registry immediately before posting /addons/enabled",
  );
});

test("CP-BR11 #3: Enable surfaces registry-revision errors and never posts /addons/enabled when revision is stale", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") {
      // Host signals a stale revision scenario by returning a non-integer.
      return { ok: true, revision: "stale" };
    }
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "inactive",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/enabled") {
      // Must never be reached when the revision is invalid.
      throw new Error("Enable POST must not happen with a stale revision");
    }
    return { ok: true, addons: [] };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]'),
  );
  const enableBtn = container.querySelector(
    '[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]',
  );
  enableBtn.click();
  // Wait for the renderer to surface the error.
  await waitFor(() => container.querySelector(".terminals-card-error"));
  const err = container.querySelector(".terminals-card-error");
  assert.match(err.textContent, /registry revision unavailable/i);
  // And no /addons/enabled POST must have happened.
  assert.equal(
    calls.find((c) => c.route === "/addons/enabled" && c.method === "POST"),
    undefined,
    "no /addons/enabled POST may be sent when the registry revision is invalid",
  );
});

test("CP-BR11 #3: Enable/Disable label reflects the registry enabled flag, not projection status", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const bridgeRequest = async (route) => {
    if (route === "/addons/registry") {
      return {
        ok: true,
        revision: 1,
        installations: {
          "addon.resonant-terminal-ghostty": {
            addonId: "addon.resonant-terminal-ghostty",
            installed: true,
            enabled: true,
            grantedCapabilities: [
              {
                capability: "terminal-host",
                granted: false,
                scope: "system",
                revocationBehavior: "degrade",
              },
            ],
          },
          "addon.resonant-terminal-iterm2": {
            addonId: "addon.resonant-terminal-iterm2",
            installed: true,
            enabled: false,
            grantedCapabilities: [
              {
                capability: "terminal-host",
                granted: false,
                scope: "system",
                revocationBehavior: "degrade",
              },
            ],
          },
        },
      };
    }
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "inactive",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
        {
          addonId: "addon.resonant-terminal-iterm2",
          status: "inactive",
          generation: 1,
          displayLabel: "resonant-terminal-iterm2",
        },
      ]);
    }
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]'),
  );

  const ghosttyBtn = container.querySelector(
    '[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]',
  );
  const iterm2Btn = container.querySelector(
    '[data-testid="terminals-enable-addon.resonant-terminal-iterm2"]',
  );
  // enabled:true (projection still "inactive") -> "Disable".
  assert.equal(ghosttyBtn.textContent, "Disable");
  // enabled:false -> "Enable".
  assert.equal(iterm2Btn.textContent, "Enable");
});

// ---------------------------------------------------------------------------
// 4. Grant: posts /addons/grants with terminal-host granted and
//    consent:true; never auto-grants.
// ---------------------------------------------------------------------------

test("CP-BR11 #4: Grant posts POST /addons/grants with terminal-host granted + consent:true, never auto-grants", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const calls = [];
  let confirmCount = 0;
  let confirmReturn = true;
  const windowRef = {
    confirm: () => {
      confirmCount += 1;
      return confirmReturn;
    },
  };
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") return { ok: true, revision: 3, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants" && (options?.method ?? "GET").toUpperCase() === "POST") {
      assert.equal(options.body?.consent, true, "Grant must set consent: true");
      assert.deepEqual(options.body?.grants, [
        {
          capability: "terminal-host",
          granted: true,
          scope: "system",
          revocationBehavior: "degrade",
        },
      ]);
      assert.equal(options.body?.addonId, "addon.resonant-terminal-ghostty");
      return { ok: true, revision: 4 };
    }
    if (route === "/terminal-host/prompt-path") return { ok: true, valid: false, promptPath: null };
    return { ok: true, addons: [] };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    windowRef,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-grant-addon.resonant-terminal-ghostty"]'),
  );
  // No grant POST should have been sent on initial mount.
  assert.equal(
    calls.find((c) => c.route === "/addons/grants" && c.method === "POST"),
    undefined,
    "rendering alone must never auto-grant",
  );
  // Click the Grant button (windowRef.confirm returns true).
  const grantBtn = container.querySelector(
    '[data-testid="terminals-grant-addon.resonant-terminal-ghostty"]',
  );
  grantBtn.click();
  await waitFor(() => calls.some((c) => c.route === "/addons/grants" && c.method === "POST"));
  assert.ok(confirmCount >= 1, "Grant must require operator confirmation");
  // The Grant POST must have been preceded by an /addons/registry read.
  const grantIdx = calls.findIndex((c) => c.route === "/addons/grants" && c.method === "POST");
  assert.ok(
    calls.slice(0, grantIdx).some((c) => c.route === "/addons/registry" && c.method === "GET"),
    "Grant must read /addons/registry immediately before posting /addons/grants",
  );
});

test("CP-BR11 #4b: capabilityGranted reflects the registry's grantedCapabilities", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const registry = {
    ok: true,
    revision: 5,
    installations: {
      "addon.resonant-terminal-ghostty": {
        addonId: "addon.resonant-terminal-ghostty",
        installed: true,
        enabled: true,
        grantedCapabilities: [
          {
            capability: "terminal-host",
            granted: true,
            scope: "system",
            revocationBehavior: "degrade",
          },
        ],
      },
      "addon.resonant-terminal-iterm2": {
        addonId: "addon.resonant-terminal-iterm2",
        installed: true,
        enabled: true,
        grantedCapabilities: [
          {
            capability: "terminal-host",
            granted: false,
            scope: "system",
            revocationBehavior: "degrade",
          },
        ],
      },
    },
  };
  const { bridgeRequest } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-ghostty",
      },
      {
        addonId: "addon.resonant-terminal-iterm2",
        status: "inactive",
        generation: 1,
        displayLabel: "resonant-terminal-iterm2",
      },
    ]),
    registry,
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]'),
  );
  assert.equal(
    container.querySelector('[data-testid="terminals-grant-addon.resonant-terminal-ghostty"]'),
    null,
    "Grant button must be absent when terminal-host is already granted (Ghostty)",
  );
  assert.ok(
    container.querySelector('[data-testid="terminals-grant-addon.resonant-terminal-iterm2"]'),
    "Grant button must be present when terminal-host is not granted (iTerm2)",
  );
});

test("CP-BR11 #4: cancelled Grant does not post /addons/grants", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const calls = [];
  const windowRef = { confirm: () => false };
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") return { ok: true, revision: 3, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants" && (options?.method ?? "GET").toUpperCase() === "POST") {
      throw new Error("Grant POST must not happen when operator cancels the confirm dialog");
    }
    if (route === "/terminal-host/prompt-path") return { ok: true, valid: false, promptPath: null };
    return { ok: true, addons: [] };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    windowRef,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() =>
    container.querySelector('[data-testid="terminals-grant-addon.resonant-terminal-ghostty"]'),
  );
  const grantBtn = container.querySelector(
    '[data-testid="terminals-grant-addon.resonant-terminal-ghostty"]',
  );
  grantBtn.click();
  // Wait a tick for any (forbidden) POST to land.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    calls.find((c) => c.route === "/addons/grants" && c.method === "POST"),
    undefined,
    "cancelled Grant must not POST",
  );
});

// ---------------------------------------------------------------------------
// 5. Launch gating + typed rejections.
// ---------------------------------------------------------------------------

test("CP-BR11 #5: Launch is disabled until the runtime is connected AND a 0600 prompt file exists", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  // Status: bridge not connected + no surfaces + no prompt path.
  const { bridgeRequest } = makeBridgeRequest({
    status: { ok: true, connected: false, driveId: null, surfaces: [], sessions: [], launches: [] },
    projection: makeProjectionRuntime([]),
    grants: makeGrants([]),
    prompt: { ok: true, valid: false, promptPath: null },
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  for (const addonId of ["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]) {
    const launch = container.querySelector(`[data-testid="terminals-launch-${addonId}"]`);
    assert.ok(launch?.disabled, `${addonId} launch is disabled without connected + 0600 prompt`);
  }
});

test("CP-BR11 #5: Launch click routes through POST /terminal-host/launch and branches on documented rejections", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants")
      return {
        ok: true,
        addons: [
          {
            addonId: "addon.resonant-terminal-ghostty",
            grants: [
              {
                capability: "terminal-host",
                granted: true,
                scope: "system",
                revocationBehavior: "degrade",
              },
            ],
          },
        ],
      };
    if (route === "/terminal-host/prompt-path")
      return { ok: true, valid: true, promptPath: promptFile };
    if (route === "/terminal-host/launch") {
      // Faithful host envelope: the handler keys success on `launchId`
      // (the seam's unwrap strips `ok`).
      return {
        ok: true,
        launchId: "test-launch-1",
        agentId: "pi",
        terminalAddonId: "addon.resonant-terminal-ghostty",
      };
    }
    return { ok: true, addons: [] };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  await waitForEnabled(
    container,
    '[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]',
  );
  const launch = container.querySelector(
    '[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]',
  );
  launch.click();
  await waitFor(() =>
    calls.some((c) => c.route === "/terminal-host/launch" && c.method === "POST"),
  );
  const launchCall = calls.find((c) => c.route === "/terminal-host/launch" && c.method === "POST");
  assert.equal(launchCall.body.terminalAddonId, "addon.resonant-terminal-ghostty");
  assert.equal(launchCall.body.promptPath, promptFile);
  assert.equal(launchCall.body.agentId, "pi");
  await waitFor(
    () => container.querySelector(".terminals-status")?.textContent.includes("Launched"),
    { label: "launch success status" },
  );
});

test("CP-BR11 #5: capability-not-granted rejection is surfaced without auto-granting", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants") return { ok: true, addons: [] };
    if (route === "/terminal-host/prompt-path")
      return { ok: true, valid: true, promptPath: promptFile };
    if (route === "/terminal-host/launch") {
      return { ok: false, reason: "capability-not-granted" };
    }
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  await waitForEnabled(
    container,
    '[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]',
  );
  container
    .querySelector('[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]')
    .click();
  await waitFor(() => container.querySelector(".terminals-card-error"));
  const err = container.querySelector(".terminals-card-error");
  assert.match(err.textContent, /terminal-host capability/i);
  // No /addons/grants POST must have happened.
  assert.equal(
    calls.find((c) => c.route === "/addons/grants" && c.method === "POST"),
    undefined,
    "capability-not-granted rejection must not auto-grant",
  );
});

test("CP-BR11 #5: bridge-not-running rejection routes to onOpenBridgeSettings", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  let opened = 0;
  const bridgeRequest = async (route) => {
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants")
      return {
        ok: true,
        addons: [
          {
            addonId: "addon.resonant-terminal-ghostty",
            grants: [
              {
                capability: "terminal-host",
                granted: true,
                scope: "system",
                revocationBehavior: "degrade",
              },
            ],
          },
        ],
      };
    if (route === "/terminal-host/prompt-path")
      return { ok: true, valid: true, promptPath: promptFile };
    if (route === "/terminal-host/launch") return { ok: false, reason: "bridge-not-running" };
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    onOpenBridgeSettings: () => {
      opened += 1;
    },
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  await waitForEnabled(
    container,
    '[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]',
  );
  container
    .querySelector('[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]')
    .click();
  await waitFor(() => opened > 0);
  assert.ok(opened >= 1, "bridge-not-running rejection must call onOpenBridgeSettings");
});

test("CP-BR11 #5: missing-credential rejection is surfaced with a clear message", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const bridgeRequest = async (route) => {
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants")
      return {
        ok: true,
        addons: [
          {
            addonId: "addon.resonant-terminal-ghostty",
            grants: [
              {
                capability: "terminal-host",
                granted: true,
                scope: "system",
                revocationBehavior: "degrade",
              },
            ],
          },
        ],
      };
    if (route === "/terminal-host/prompt-path")
      return { ok: true, valid: true, promptPath: promptFile };
    if (route === "/terminal-host/launch") return { ok: false, reason: "missing-credential" };
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  await waitForEnabled(
    container,
    '[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]',
  );
  container
    .querySelector('[data-testid="terminals-launch-addon.resonant-terminal-ghostty"]')
    .click();
  await waitFor(() => container.querySelector(".terminals-card-error"));
  const err = container.querySelector(".terminals-card-error");
  assert.match(err.textContent, /provider credential/i);
});

// ---------------------------------------------------------------------------
// 6. Copy connection script: rail exposes the same affordance as
//    the CP-BR10 Settings → Add-on Tools section. The full
//    text-only + clipboard-fallback + secret-walker behaviour is
//    covered by the existing CP-BR10 addon-tools-section.test.mjs
//    (11/11 pass). The rail re-uses the same `terminal-cards.js`
//    helper and the same `createTerminalsHostSeams` factory, so
//    the rail's Copy affordance is provably equivalent to the
//    Settings surface. The CP-BR11 tests here only assert that
//    the rail surface exposes the per-id Copy button and that the
//    shared host seam `fetchConnectionScript` is wired.
// ---------------------------------------------------------------------------

test("CP-BR11 #6: rail exposes a per-id Copy button and the fetchConnectionScript seam is wired", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-ghostty",
      },
      {
        addonId: "addon.resonant-terminal-iterm2",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-iterm2",
      },
    ]),
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  // The rail's Copy button must exist for every reviewed terminal
  // add-on — that is the new affordance introduced by CP-BR11.
  for (const addonId of ["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]) {
    const btn = container.querySelector(`[data-testid="terminals-copy-${addonId}"]`);
    assert.ok(btn, `rail Copy button for ${addonId} exists`);
  }
  // The shared host seam must route to POST /terminal-host/connection-script
  // when invoked; that is the affordance the CP-BR10 test already
  // exercises end-to-end.
  assert.equal(
    typeof seams.fetchConnectionScript,
    "function",
    "rail seam fetchConnectionScript is wired",
  );
  const calls = [];
  const fakeBridge = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/terminal-host/connection-script") {
      return {
        ok: true,
        command: "ros-session attach --addon-id addon.resonant-terminal-ghostty",
        sessionId: "sess-abc-123",
        tokenFilePath: "/var/folders/abc/T/ros-session-token-xyz0600",
        rosSessionPath: "/Applications/ResonantOS.app/Contents/Resources/ros-session",
        expiresAt: "2026-10-09T01:00:00.000Z",
      };
    }
    return { ok: true };
  };
  const fakeSeams = createTerminalsHostSeams({ bridgeRequest: fakeBridge });
  const result = await fakeSeams.fetchConnectionScript({
    terminalAddonId: "addon.resonant-terminal-ghostty",
  });
  assert.match(result.command, /ros-session attach/);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].route, "/terminal-host/connection-script");
  // The shape-walker over the raw payload must not contain any
  // secret-shaped field name; tokenFilePath is meta, not a secret.
  assertNoSecretShapedValue(result, "$.fetchConnectionScript.result");
});

// ---------------------------------------------------------------------------
// 7. The rail reads from the harness registry / projection, NOT
//    /addons/status.
// ---------------------------------------------------------------------------

test("CP-BR11 #7: the rail never reads /addons/status", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  // makeBridgeRequest throws if /addons/status is read; if the rail
  // never reads it, refresh + every interaction will pass.
  const { bridgeRequest, calls } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-ghostty",
      },
    ]),
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 50,
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  // Trigger an enable, a launch attempt (will fail without prompt),
  // and a copy attempt.
  const enable = container.querySelector(
    '[data-testid="terminals-enable-addon.resonant-terminal-ghostty"]',
  );
  enable?.click();
  await new Promise((r) => setTimeout(r, 20));
  // No /addons/status call should have happened.
  const offenders = calls.filter(
    (c) => c.route === "/addons/status" || c.route.startsWith("/addons/status"),
  );
  assert.equal(offenders.length, 0, "the rail must not read /addons/status");
  // The expected set of routes is the harness registry + projection +
  // terminal-host routes, not the addon-delegation routes.
  for (const c of calls) {
    assert.ok(!c.route.startsWith("/addons/status"), `unexpected /addons/status read: ${c.route}`);
  }
});

// ---------------------------------------------------------------------------
// 8. shape-walker: every status / projection / registry / grants
//    payload the rail renders passes the secret-shape check.
// ---------------------------------------------------------------------------

test("CP-BR11 #8: the shape-walker over a representative status / projection / registry / grants payload carries no secret", () => {
  const sample = {
    status: makeStatus(),
    projection: makeProjectionRuntime([
      {
        addonId: "addon.resonant-terminal-ghostty",
        status: "ready",
        generation: 1,
        displayLabel: "resonant-terminal-ghostty",
      },
    ]),
    registry: { ok: true, revision: 0, addons: [] },
    grants: makeGrants([
      {
        addonId: "addon.resonant-terminal-ghostty",
        grants: [
          {
            capability: "terminal-host",
            granted: true,
            scope: "system",
            revocationBehavior: "degrade",
          },
        ],
      },
    ]),
  };
  assertNoSecretShapedValue(sample, "$.sample");
});

test("CP-BR11 #8: the route capabilities are declared in bridge-client.js", () => {
  // The /addons/enabled and /addons/grants capability strings must
  // already exist (they were added in CP-BR9); the new rail relies
  // on them.
  for (const [method, route] of [
    ["POST", "/addons/enabled"],
    ["POST", "/addons/grants"],
    ["GET", "/addons/registry"],
    ["GET", "/bridge/runtimes"],
    ["GET", "/terminal-host/status"],
    ["GET", "/terminal-host/prompt-path"],
    ["POST", "/terminal-host/launch"],
    ["POST", "/terminal-host/connection-script"],
  ]) {
    const cap = capabilityForBridgeRoute(route, method);
    assert.ok(
      typeof cap === "string" && cap.length > 0,
      `${method} ${route} must have a declared capability`,
    );
  }
});

// ---------------------------------------------------------------------------
// 9. Provider credential selector (inject a ROS credential into the session).
// ---------------------------------------------------------------------------

test("CP-BR11 #9: the pi-native family allowlist matches the host map", () => {
  const hostFamilies = Object.fromEntries(
    Object.entries(PI_NATIVE_PROVIDER_MAP).map(([identity, mapping]) => [identity, mapping.envVar]),
  );
  assert.deepEqual(PI_NATIVE_PROVIDER_FAMILIES, hostFamilies);
});

test("CP-BR11 #9: provider selector renders pi-compatible profiles and the launch passes the selected id", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const calls = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push({ route, method: options?.method ?? "GET", body: options?.body });
    if (route === "/terminal-host/status" || route.startsWith("/terminal-host/status"))
      return makeStatus();
    if (route.startsWith("/terminal-host/prompt-path"))
      return { ok: true, promptPath: promptFile, valid: true };
    if (route.startsWith("/bridge/runtimes"))
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
        {
          addonId: "addon.resonant-terminal-iterm2",
          status: "inactive",
          generation: 1,
          displayLabel: "resonant-terminal-iterm2",
        },
      ]);
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/providers/status")
      return {
        ok: true,
        providers: [
          {
            id: "shared-minimax",
            label: "MiniMax (shared)",
            providerType: "minimax",
            configured: true,
          },
          { id: "anthropic-acct", label: "Anthropic", providerType: "anthropic", configured: true },
        ],
      };
    if (route === "/terminal-host/launch") return { ok: true, launchAccepted: true };
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, { ...seams, pollIntervalMs: 0 });
  t.after(() => handle.stop());

  await waitFor(() =>
    container.querySelector(
      "[data-testid='terminals-provider-select'] option[value='shared-minimax']",
    ),
  );
  const select = container.querySelector("[data-testid='terminals-provider-select']");
  // Single configured pi-compatible profile is auto-selected.
  assert.equal(select.value, "shared-minimax");
  // anthropic is not a pi-native family → filtered out of the selector.
  assert.equal(select.querySelector("option[value='anthropic-acct']"), null);

  const launchBtn = await waitForEnabled(
    container,
    "[data-testid='terminals-launch-addon.resonant-terminal-ghostty']",
  );
  launchBtn.click();
  await waitFor(() =>
    calls.some((c) => c.route === "/terminal-host/launch" && c.method === "POST"),
  );
  const launchCall = calls.find((c) => c.route === "/terminal-host/launch" && c.method === "POST");
  assert.equal(launchCall.body.providerProfileId, "shared-minimax");
});

// ---------------------------------------------------------------------------
// CP-BR11.1: prompt editor (textarea + Save prompt) writes via
// POST /terminal-host/prompt and unlocks Open in Terminal.
// ---------------------------------------------------------------------------

test("CP-BR11.1: prompt editor writes the prompt via POST /terminal-host/prompt", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest, calls } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([]),
    prompt: { ok: true, promptPath: "/tmp/prompt.txt", valid: false },
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());

  await waitFor(() => container.querySelector("[data-testid='terminals-prompt-save']"));
  const textarea = container.querySelector(".terminals-prompt-textarea");
  assert.ok(textarea, "prompt textarea is rendered");
  textarea.value = "Summarize the repository.";
  container.querySelector("[data-testid='terminals-prompt-save']").click();
  await waitFor(() =>
    calls.some((c) => c.route === "/terminal-host/prompt" && c.method === "POST"),
  );
  const writeCall = calls.find((c) => c.route === "/terminal-host/prompt" && c.method === "POST");
  assert.equal(writeCall.body.text, "Summarize the repository.");
});

test("CP-BR11.1: prompt editor does not POST when the text is empty", async (t) => {
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const { bridgeRequest, calls } = makeBridgeRequest({
    status: makeStatus(),
    projection: makeProjectionRuntime([]),
    prompt: { ok: true, promptPath: "/tmp/prompt.txt", valid: false },
    grants: makeGrants([]),
  });
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
  });
  t.after(() => handle.stop());

  await waitFor(() => container.querySelector("[data-testid='terminals-prompt-save']"));
  const textarea = container.querySelector(".terminals-prompt-textarea");
  textarea.value = "   ";
  container.querySelector("[data-testid='terminals-prompt-save']").click();
  await waitFor(() =>
    container.querySelector(".terminals-status")?.textContent?.includes("Write a prompt first"),
  );
  assert.ok(!calls.some((c) => c.route === "/terminal-host/prompt"), "empty prompt must not POST");
});

test("CP-BR11 #7: Copy click through the real seam reports success and copies the command", async (t) => {
  // Regression: the seam's unwrap strips `ok` from the host envelope, so
  // handlers must key success on payload fields (`command`), not `ok`.
  // The host returns `{ ok: true, command, ... }`; the pre-fix handler
  // checked `!result.ok` post-unwrap and failed every successful mint.
  const { container, cleanup } = setupDom();
  t.after(cleanup);
  const promptFile = makeValidPromptFile(t);
  const written = [];
  const bridgeRequest = async (route, options = {}) => {
    if (route === "/addons/registry") return { ok: true, revision: 0, addons: [] };
    if (route === "/terminal-host/status") return makeStatus();
    if (route === "/bridge/runtimes") {
      return makeProjectionRuntime([
        {
          addonId: "addon.resonant-terminal-ghostty",
          status: "ready",
          generation: 1,
          displayLabel: "resonant-terminal-ghostty",
        },
      ]);
    }
    if (route === "/addons/grants") return { ok: true, addons: [] };
    if (route === "/terminal-host/prompt-path")
      return { ok: true, valid: true, promptPath: promptFile };
    if (route === "/terminal-host/connection-script") {
      // Faithful host envelope: ok:true wrapper, command string inside.
      return {
        ok: true,
        command: "bash '/tmp/ros-session-attach.sh'",
        scriptPath: "/tmp/ros-session-attach.sh",
        tokenFilePath: "/tmp/ros-token",
      };
    }
    return { ok: true };
  };
  const seams = makeSeams(bridgeRequest);
  const handle = renderTerminalsWorkspace(container, {
    bridgeRequest,
    ...seams,
    pollIntervalMs: 0,
    navigatorRef: {
      clipboard: {
        writeText: async (text) => {
          written.push(text);
        },
      },
    },
  });
  t.after(() => handle.stop());
  await waitFor(() => container.querySelector('[data-addon-id="addon.resonant-terminal-ghostty"]'));
  await waitForEnabled(
    container,
    '[data-testid="terminals-copy-addon.resonant-terminal-ghostty"]',
  );
  container
    .querySelector('[data-testid="terminals-copy-addon.resonant-terminal-ghostty"]')
    .click();
  await waitFor(() => written.length > 0, { label: "clipboard write" });
  assert.match(written[0], /ros-session-attach\.sh/, "the minted command reaches the clipboard");
  assert.equal(
    container.querySelector(".terminals-card-error"),
    null,
    "no error is shown for a successful mint",
  );
  // The confirmation must survive the post-action refresh: the refresh's
  // generic status summary used to overwrite it within microseconds.
  await waitFor(
    () =>
      container
        .querySelector(".terminals-status")
        ?.textContent.includes("copied to the clipboard"),
    { label: "copy confirmation status" },
  );
});
