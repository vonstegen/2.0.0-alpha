import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserDiagnosticsHostService } from "../host/browser-diagnostics-host-service.mjs";

function createService(overrides = {}) {
  return createBrowserDiagnosticsHostService({
    repoRoot: "/tmp/resonantos-repo",
    resonantExtension: "/tmp/resonantos-extension",
    userRoot: () => "/tmp/resonantos-user",
    browserFirstRoot: () => "/tmp/resonantos-user/BrowserFirst",
    memoryRoot: () => "/tmp/resonantos-user/Memory",
    profileDir: "/tmp/resonantos-profile",
    browserLaunchLogPath: () => "/tmp/resonantos-browser.log",
    readProviderSecrets: async () => ({ "shared-minimax": "redacted", "shared-openai": "" }),
    executeProviderStatus: async () => ({ providers: [] }),
    executeAddonsStatus: async () => ({ addons: [{ id: "living-archive" }] }),
    executeMemoryStatus: async () => ({ exists: true }),
    countFiles: async (root) => root.includes("Goals") ? 2 : 3,
    redactPathForDiagnostics: (value) => String(value ?? "").replace("/tmp", "~"),
    redactDiagnosticText: (value) => String(value ?? ""),
    ...overrides,
  });
}

test("browser diagnostics host service owns status, diagnostics, and download routes", () => {
  const service = createService();
  const routes = new Map(service.browserDiagnosticsRoutes.map((route) => [`${route.method} ${route.path}`, route]));

  assert.equal(typeof routes.get("GET /status")?.handler, "function");
  assert.equal(typeof routes.get("GET /browser/downloads")?.handler, "function");
  assert.equal(typeof routes.get("GET /browser/launch-diagnostics")?.handler, "function");
  assert.equal(typeof routes.get("POST /browser/downloads/action")?.handler, "function");
  assert.equal(typeof routes.get("POST /diagnostics/report")?.handler, "function");
  assert.equal(routes.get("POST /browser/downloads/action")?.requiredCapability, "browser-download-action");
  assert.equal(routes.get("POST /diagnostics/report")?.requiredCapability, "diagnostics-report-export");
});

test("browser diagnostics host service aggregates system status without exposing secrets", async () => {
  const service = createService();
  const status = await service.executeSystemStatus();

  assert.equal(status.bridge, "resonantos-browser-first");
  assert.deepEqual(status.providers, {
    "shared-minimax": true,
    "shared-openai": false,
  });
  assert.deepEqual(status.memory, { exists: true });
  assert.deepEqual(status.addons, [{ id: "living-archive" }]);
  assert.deepEqual(status.records, { goals: 2, delegations: 3 });
});

test("browser diagnostics host service fails fast when a dependency is missing", () => {
  assert.throws(
    () => createService({ executeMemoryStatus: null }),
    /Browser diagnostics host service missing dependency: executeMemoryStatus/,
  );
});
