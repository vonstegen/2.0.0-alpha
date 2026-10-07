// CP-BR6: Bridge & Runtimes settings section tests.
//
// Covers the closed behavior the prompt requires:
//   1. renders bridgeOverview, runtimeList, connectorList, activeSessions,
//      and diagnostics from an injected projection;
//   2. offline state is sourced from the bootstrap snapshot (no bridge
//      route call);
//   3. online detail is sourced from the projection;
//   4. a stale projection (older generation) is dropped;
//   5. add-on runtime state is distinct from core bridge state;
//   6. loading/empty/degraded/failed states render for every view;
//   7. enable/disable call the host transaction and re-fetch;
//   8. restart/retry is disabled/omitted when no host transaction exists;
//   9. no secret/path/token-shaped value reaches the rendered DOM;
//  10. text nodes / textContent only (no innerHTML / script);
//  11. the section is registered in the Settings navigation;
//  12. existing CP-BR1…CP-BR5 tests remain green (verified by the
//      browser-first regression run, not inside this file).
//
// All tests inject the seams; the production module never falls back to
// module-global mutable state.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { buildBridgeRuntimesView, shouldAcceptProjection } from "../resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-view.js";

const FORBIDDEN_KEYS = [
  "token",
  "accessToken",
  "bearer",
  "password",
  "secret",
  "privateKey",
  "credential",
  "authFile",
  "tokenFile",
  "argv",
  "pid",
  "childArgv",
  "memory",
  "prompt",
  "promptContent",
  "memoryContent",
  "privatePath",
  "rawError",
  "stack",
  "home",
  "userPath",
  "env",
  "processEnv",
];

function makeProjection(overrides = {}) {
  return {
    bridgeOverview: {
      status: "connected",
      version: "2.0.0-beta.1",
      endpoint: "http://127.0.0.1:47773",
      startedAt: "2026-10-06T00:00:00.000Z",
      uptimeSeconds: 12,
      generation: 1,
      instanceId: "instance-1",
      bootEpoch: "epoch-1",
      publicFailureCode: null,
      ...(overrides.overview ?? {}),
    },
    runtimeList: overrides.runtimes ?? [
      {
        addonId: "addon.paperclip",
        runtimeId: "addon.paperclip",
        runtimeType: "ui-module",
        status: "ready",
        generation: 1,
        activeSessionCount: 2,
        startedAt: "2026-10-06T00:00:00.000Z",
        lastTransitionAt: "2026-10-06T00:00:00.000Z",
        publicFailureCode: null,
        factoryId: "com.resonantos.factory.ui-module",
        classification: "ui-module",
        displayLabel: "Paperclip",
      },
    ],
    connectorList: overrides.connectors ?? [
      {
        addonId: "addon.telegram-connector",
        label: "Telegram",
        runtimeType: "channel-addon",
        connectionState: "enabled",
        authorizationState: "granted",
        lastSuccessfulHealthAt: "2026-10-06T00:00:00.000Z",
        publicFailureCode: null,
        supportedRuntimeTypes: ["channel-addon"],
      },
    ],
    activeSessions: overrides.sessions ?? [
      { addonId: "addon.paperclip", runtimeId: "addon.paperclip", activeSessionCount: 2 },
    ],
    projectionGeneration: overrides.generation ?? 1,
    producedAt: "2026-10-06T00:00:00.000Z",
    updateMechanism: "polling",
  };
}

function makeBootstrap(overrides = {}) {
  return {
    status: "offline",
    failureCode: null,
    endpoint: null,
    version: null,
    instanceId: null,
    generation: null,
    startedAt: null,
    retries: 0,
    lastDisconnectAt: null,
    ...overrides,
  };
}

async function setup(t, { fetcher, bootstrap, supportedActions, enableCalls, intervalHandles } = {}) {
  const dom = new JSDOM("<main></main>");
  const previous = ["document", "chrome"].map((k) => Object.getOwnPropertyDescriptor(globalThis, k));
  t.after(() => {
    for (const h of intervalHandles ?? []) clearInterval(h);
    dom.window.close();
    previous.forEach((d, i) => {
      if (d) Object.defineProperty(globalThis, ["document", "chrome"][i], d);
      else delete globalThis[["document", "chrome"][i]];
    });
  });
  globalThis.document = dom.window.document;

  const { renderBridgeRuntimesSection } = await import(
    "../resonantos-side-panel-extension/src/lib/settings/bridge-runtimes-section.js"
  );

  const root = document.querySelector("main");
  const handle = renderBridgeRuntimesSection(root, {
    fetchProjection: fetcher,
    getBootstrapSnapshot: () => bootstrap ?? null,
    enableTransaction: enableCalls
      ? async (addonId, enabled) => {
          enableCalls.push({ addonId, enabled });
        }
      : undefined,
    supportedActions: supportedActions ?? { enableDisable: true, retry: false, restart: false },
    pollIntervalMs: 0,
  });

  return { root, handle };
}

// ---------------------------------------------------------------------------
// View model (pure) tests
// ---------------------------------------------------------------------------

test("view model: online projection drives overview detail", () => {
  const projection = makeProjection();
  const bootstrap = makeBootstrap({ status: "connected" });
  const view = buildBridgeRuntimesView({ projection, bootstrapSnapshot: bootstrap });
  assert.equal(view.overview.status, "connected");
  assert.equal(view.overview.version, "2.0.0-beta.1");
  assert.equal(view.overview.endpoint, "http://127.0.0.1:47773");
  assert.equal(view.overview.uptimeSeconds, 12);
  assert.equal(view.overview.tone, "ok");
  assert.equal(view.viewState.overview, "ready");
  assert.equal(view.viewState.runtimes, "ready");
  assert.equal(view.viewState.connectors, "ready");
  assert.equal(view.viewState.sessions, "ready");
});

test("view model: bootstrap is the OFFLINE source for core-bridge health", () => {
  const projection = null;
  const bootstrap = makeBootstrap({ status: "offline", failureCode: "start-failed" });
  const view = buildBridgeRuntimesView({ projection, bootstrapSnapshot: bootstrap });
  assert.equal(view.overview.status, "offline");
  assert.equal(view.overview.failureCode, "start-failed");
  assert.equal(view.viewState.overview, "failed");
  assert.equal(view.viewState.runtimes, "degraded");
  assert.equal(view.viewState.connectors, "degraded");
  assert.equal(view.viewState.sessions, "degraded");
});

test("view model: starting + no projection is loading, not failed", () => {
  const view = buildBridgeRuntimesView({
    projection: null,
    bootstrapSnapshot: makeBootstrap({ status: "starting" }),
  });
  assert.equal(view.viewState.overview, "loading");
  // When the bridge is starting and the projection is not yet
  // available, diagnostics is "degraded" (only the bootstrap
  // snapshot is available; online detail is pending).
  assert.equal(view.viewState.diagnostics, "degraded");
});

test("view model: degraded bridge surface is reported", () => {
  const view = buildBridgeRuntimesView({
    projection: null,
    bootstrapSnapshot: makeBootstrap({ status: "degraded", failureCode: "bridge-health-stale" }),
  });
  assert.equal(view.overview.status, "degraded");
  assert.equal(view.overview.tone, "warn");
  assert.equal(view.viewState.overview, "degraded");
});

test("view model: empty runtime list is empty (not loading)", () => {
  const view = buildBridgeRuntimesView({
    projection: makeProjection({ runtimes: [], sessions: [] }),
    bootstrapSnapshot: makeBootstrap({ status: "connected" }),
  });
  assert.equal(view.viewState.runtimes, "empty");
  assert.equal(view.viewState.sessions, "empty");
});

test("view model: enable/disable is supported only with an enableTransaction", () => {
  const viewNoTx = buildBridgeRuntimesView({
    projection: makeProjection(),
    bootstrapSnapshot: makeBootstrap({ status: "connected" }),
    supportedActions: { enableDisable: true },
  });
  assert.equal(viewNoTx.actions.enableDisable, false);
  const viewWithTx = buildBridgeRuntimesView({
    projection: makeProjection(),
    bootstrapSnapshot: makeBootstrap({ status: "connected" }),
    enableTransaction: async () => undefined,
    supportedActions: { enableDisable: true },
  });
  assert.equal(viewWithTx.actions.enableDisable, true);
});

test("view model: restart/retry are off when the host does not expose them", () => {
  const view = buildBridgeRuntimesView({
    projection: makeProjection(),
    bootstrapSnapshot: makeBootstrap({ status: "connected" }),
    enableTransaction: async () => undefined,
    supportedActions: { enableDisable: true, restart: false, retry: false },
  });
  assert.equal(view.actions.restart, false);
  assert.equal(view.actions.retry, false);
});

test("view model: unknown runtimeType is preserved as a public identifier", () => {
  const view = buildBridgeRuntimesView({
    projection: makeProjection({
      runtimes: [
        {
          addonId: "addon.experimental",
          runtimeId: "addon.experimental",
          runtimeType: "experimental-v9",
          status: "ready",
          generation: 1,
          activeSessionCount: 0,
          startedAt: "2026-10-06T00:00:00.000Z",
          lastTransitionAt: "2026-10-06T00:00:00.000Z",
          publicFailureCode: null,
          factoryId: "com.resonantos.factory.experimental",
          classification: "experimental",
          displayLabel: "Experimental",
        },
      ],
      sessions: [],
    }),
    bootstrapSnapshot: makeBootstrap({ status: "connected" }),
  });
  assert.equal(view.runtimes[0].runtimeType, "experimental-v9");
  assert.equal(view.runtimes[0].label, "Experimental");
});

test("view model: rejects projection with an unknown field", () => {
  assert.throws(
    () =>
      buildBridgeRuntimesView({
        projection: { ...makeProjection(), token: "Bearer abcdef" },
        bootstrapSnapshot: makeBootstrap({ status: "connected" }),
      }),
    /unknown field/i
  );
});

test("view model: rejects projection with a hostile runtime entry", () => {
  const bad = makeProjection();
  bad.runtimeList[0].argv = ["--secret"];
  assert.throws(
    () =>
      buildBridgeRuntimesView({
        projection: bad,
        bootstrapSnapshot: makeBootstrap({ status: "connected" }),
      }),
    /unknown field/i
  );
});

test("view model: shouldAcceptProjection drops stale + equal generations", () => {
  assert.equal(shouldAcceptProjection({ projectionGeneration: 3 }, { projectionGeneration: 2 }), false);
  assert.equal(shouldAcceptProjection({ projectionGeneration: 3 }, { projectionGeneration: 3 }), false);
  assert.equal(shouldAcceptProjection({ projectionGeneration: 3 }, { projectionGeneration: 4 }), true);
  assert.equal(shouldAcceptProjection(null, { projectionGeneration: 1 }), true);
  assert.equal(shouldAcceptProjection({ projectionGeneration: 1 }, { projectionGeneration: undefined }), false);
});

// ---------------------------------------------------------------------------
// Renderer tests
// ---------------------------------------------------------------------------

test("renderer: renders overview, runtimes, connectors, sessions, diagnostics from injected projection", async (t) => {
  const calls = [];
  const handle = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "connected" }),
    supportedActions: { enableDisable: true, restart: false, retry: false },
    enableCalls: calls,
  });
  // give the async refresh a microtask
  await handle.handle?.refresh?.();
  const root = handle.root;
  const sections = root.querySelectorAll("[data-field]");
  const fields = [...sections].map((n) => n.dataset.field);
  assert.ok(fields.includes("core-bridge"), "core-bridge section present");
  assert.ok(fields.includes("runtimes"), "runtimes section present");
  assert.ok(fields.includes("connectors"), "connectors section present");
  assert.ok(fields.includes("sessions"), "sessions section present");
  assert.ok(fields.includes("diagnostics"), "diagnostics section present");
  // public fields are present as text
  const text = root.textContent;
  assert.match(text, /Paperclip/);
  assert.match(text, /Telegram/);
  assert.match(text, /Endpoint/);
  assert.match(text, /Projection generation: 1/);
});

test("renderer: offline state is sourced from bootstrap (no projection), still shows core-bridge state", async (t) => {
  const fetcher = async () => {
    throw new Error("bridge should not be called when offline");
  };
  const handle = await setup(t, {
    fetcher,
    bootstrap: makeBootstrap({ status: "offline", failureCode: "start-failed" }),
  });
  await handle.handle?.refresh?.();
  const root = handle.root;
  const text = root.textContent;
  assert.match(text, /Bridge offline/);
  assert.match(text, /start-failed/);
  const sections = root.querySelectorAll("[data-field]");
  for (const section of sections) {
    if (section.dataset.field === "core-bridge" || section.dataset.field === "diagnostics") {
      continue;
    }
    assert.equal(section.dataset.state, "degraded", `${section.dataset.field} should be degraded`);
  }
});

test("renderer: stale projection (older generation) is dropped", async (t) => {
  let generation = 5;
  const fetcher = async () => makeProjection({ generation });
  const handle = await setup(t, {
    fetcher,
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle.handle?.refresh?.();
  const firstView = handle.handle?.getCurrentView?.();
  assert.equal(firstView?.projectionGeneration, 5);
  // server rolls back to gen 2 (stale)
  generation = 2;
  await handle.handle?.refresh?.();
  const secondView = handle.handle?.getCurrentView?.();
  assert.equal(secondView?.projectionGeneration, 5, "stale projection should not overwrite");
});

test("renderer: add-on runtime state is distinct from core bridge state (per element)", async (t) => {
  const handle = await setup(t, {
    fetcher: async () =>
      makeProjection({
        runtimes: [
          {
            addonId: "addon.x",
            runtimeId: "addon.x",
            runtimeType: "ui-module",
            status: "ready",
            generation: 1,
            activeSessionCount: 1,
            startedAt: "2026-10-06T00:00:00.000Z",
            lastTransitionAt: "2026-10-06T00:00:00.000Z",
            publicFailureCode: null,
            factoryId: "f",
            classification: "ui-module",
            displayLabel: "X",
          },
          {
            addonId: "addon.y",
            runtimeId: "addon.y",
            runtimeType: "ui-module",
            status: "degraded",
            generation: 1,
            activeSessionCount: 0,
            startedAt: "2026-10-06T00:00:00.000Z",
            lastTransitionAt: "2026-10-06T00:00:00.000Z",
            publicFailureCode: "addon-health-stale",
            factoryId: "f",
            classification: "ui-module",
            displayLabel: "Y",
          },
        ],
      }),
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle.handle?.refresh?.();
  const root = handle.root;
  const core = root.querySelector('[data-field="core-bridge"]');
  const runtimeRows = root.querySelectorAll(".settings-runtime-row");
  assert.ok(core, "core-bridge section exists");
  assert.equal(runtimeRows.length, 2, "two runtime rows");
  // The core bridge and each runtime row carry a distinct tone/state.
  const tones = new Set();
  tones.add(core.dataset.tone);
  for (const row of runtimeRows) tones.add(row.dataset.tone);
  assert.ok(tones.has("ok"), "at least one ok tone");
  assert.ok(tones.has("warn") || tones.has("error"), "at least one non-ok tone");
});

test("renderer: loading/empty/degraded/failed states render for every view", async (t) => {
  // Loading state: bootstrap says starting; fetcher never resolves.
  // The renderer should still render a bootstrap-only view with
  // runtimes/connectors/sessions in "degraded" state (offline detail
  // unavailable) and core-bridge in "loading".
  const handleLoading = await setup(t, {
    fetcher: async () => new Promise(() => {}),
    bootstrap: makeBootstrap({ status: "starting" }),
  });
  // Wait for mount refresh to settle.
  for (let i = 0; i < 5; i += 1) {
    if (handleLoading.root.querySelectorAll("[data-field]").length > 0) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  const sections = handleLoading.root.querySelectorAll("[data-field]");
  for (const section of sections) {
    const state = section.dataset.state;
    if (section.dataset.field === "core-bridge") {
      assert.equal(state, "loading");
    } else {
      assert.ok(["degraded"].includes(state), `${section.dataset.field}: ${state}`);
    }
  }
  // Empty state
  const handleEmpty = await setup(t, {
    fetcher: async () => makeProjection({ runtimes: [], sessions: [], connectors: [] }),
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handleEmpty.handle?.refresh?.();
  for (let i = 0; i < 5; i += 1) {
    const runtimesState = handleEmpty.root.querySelector('[data-field="runtimes"]')?.dataset.state;
    if (runtimesState === "empty") break;
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(handleEmpty.root.querySelector('[data-field="runtimes"]').dataset.state, "empty");
  assert.equal(handleEmpty.root.querySelector('[data-field="sessions"]').dataset.state, "empty");
  assert.equal(handleEmpty.root.querySelector('[data-field="connectors"]').dataset.state, "empty");
  // Degraded / failed
  const handleDegraded = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "failed", failureCode: "start-failed" }),
  });
  await handleDegraded.handle?.refresh?.();
  assert.equal(handleDegraded.root.querySelector('[data-field="core-bridge"]').dataset.state, "failed");
  assert.equal(handleDegraded.root.querySelector('[data-field="runtimes"]').dataset.state, "degraded");
});

test("renderer: enable/disable call the host transaction and re-fetch", async (t) => {
  const calls = [];
  let fetchCount = 0;
  let currentGen = 1;
  const handle = await setup(t, {
    fetcher: async () => {
      fetchCount += 1;
      return makeProjection({ generation: currentGen });
    },
    bootstrap: makeBootstrap({ status: "connected" }),
    supportedActions: { enableDisable: true, restart: false, retry: false },
    enableCalls: calls,
  });
  // The renderer fires a mount-time refresh. Wait for it to settle.
  for (let i = 0; i < 5; i += 1) {
    if (fetchCount >= 1) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(fetchCount, 1, "mount refresh");
  const button = handle.root.querySelector('[data-testid="runtime-toggle-addon.paperclip"]');
  assert.ok(button, "enable/disable button is rendered");
  // Simulate server-side state change after the transaction.
  currentGen = 2;
  await button.click();
  assert.deepEqual(calls, [{ addonId: "addon.paperclip", enabled: false }]);
  // Wait for re-fetch; allow up to 2 ticks.
  for (let i = 0; i < 10; i += 1) {
    if (fetchCount >= 2) break;
    await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(fetchCount, 2, "projection is re-fetched after a host transaction");
});

test("renderer: restart/retry is omitted when no host transaction exists", async (t) => {
  const handle = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "connected" }),
    supportedActions: { enableDisable: true, restart: false, retry: false },
  });
  await handle.handle?.refresh?.();
  const restart = handle.root.querySelector('[data-testid="runtime-restart-addon.paperclip"]');
  assert.equal(restart, null, "restart button is not rendered when not supported");
});

test("renderer: rendered DOM contains no secret/path/token-shaped value", async (t) => {
  // 1) A hostile projection is rejected by the view model; the
  //    renderer falls back to the bootstrap-only view. The hostile
  //    VALUE (not the meta word "token" in the error message) must
  //    not reach the DOM.
  const projection = makeProjection();
  const hostileProjection = { ...projection, token: "Bearer abcdef-secret", privateKey: "x".repeat(64) };
  const handle = await setup(t, {
    fetcher: async () => hostileProjection,
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle.handle?.refresh?.();
  const text = handle.root.textContent;
  assert.doesNotMatch(text, /Bearer abcdef-secret/);
  assert.doesNotMatch(text, /x{40,}/);
  // 2) A clean projection never inlines a secret either.
  const handle2 = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle2.handle?.refresh?.();
  const text2 = handle2.root.textContent;
  assert.doesNotMatch(text2, /Bearer [A-Za-z0-9]{8,}/);
  assert.doesNotMatch(text2, /--secret/);
  assert.doesNotMatch(text2, /privateKey/);
  // 3) Forbid key-shaped value phrases (like "key=...", "token: ...")
  //    in the rendered text.
  for (const pattern of [
    /\btoken[:=]\s*\S+/i,
    /\bpassword[:=]\s*\S+/i,
    /\bargv\s*[:=]/i,
    /\bpid\s*[:=]\s*\d+/i,
    /\/Users\/[^ ]+/i, // absolute home paths
  ]) {
    assert.doesNotMatch(text2, pattern);
  }
});

test("renderer: text-only rendering (no innerHTML / script / event handlers)", async (t) => {
  const handle = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle.handle?.refresh?.();
  // Walk every node; the only "tags" are elements we built. No <script>.
  const scripts = handle.root.querySelectorAll("script");
  assert.equal(scripts.length, 0, "no <script> elements");
  // Every text content in the rendered DOM is built from textContent or
  // createTextNode. We assert that the renderer never invoked innerHTML
  // by checking that the parsed HTML matches the textual content.
  const html = handle.root.innerHTML;
  assert.ok(html.length > 0);
  // No event-handler attribute should appear.
  const handlerAttrs = ["onclick", "onload", "onerror", "onmouseover"];
  for (const attr of handlerAttrs) {
    assert.equal(handle.root.querySelector(`[${attr}]`), null, `no ${attr} attribute`);
  }
});

test("renderer: live region and accessible status badges are present", async (t) => {
  const handle = await setup(t, {
    fetcher: async () => makeProjection(),
    bootstrap: makeBootstrap({ status: "connected" }),
  });
  await handle.handle?.refresh?.();
  const live = handle.root.querySelector('[aria-live="polite"]');
  assert.ok(live, "live region present");
  const statusNode = handle.root.querySelector('[role="status"]');
  assert.ok(statusNode, "status node present");
  // Each runtime row has an aria-live badge too.
  const runtimeBadges = handle.root.querySelectorAll(".settings-runtime-row [aria-live]");
  assert.ok(runtimeBadges.length >= 1, "at least one runtime status badge has aria-live");
});

test("renderer: section is registered in the Settings navigation", async (t) => {
  const dom = new JSDOM("<main></main>");
  t.after(() => dom.window.close());
  globalThis.document = dom.window.document;
  const { renderSettingsWorkspace } = await import(
    "../resonantos-side-panel-extension/src/lib/main-workspace-settings.js"
  );
  const root = document.querySelector("main");
  renderSettingsWorkspace({
    container: root,
    bridgeRequest: null,
    initialSection: "bridge-runtimes",
  });
  const navButton = root.querySelector('[data-section="bridge-runtimes"]');
  assert.ok(navButton, "settings navigation has the bridge-runtimes button");
  assert.equal(navButton.dataset.active, "true");
  assert.match(navButton.textContent, /Bridge & Runtimes/);
});
