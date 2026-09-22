// Verify that disabling a single workspace add-on (by removing its
// addon.json) does NOT take down the rest of the Core add-on contract.
// Resonant Echo is the demo target; Hermes/OpenCode/Living Archive must
// continue to register and respond to /addons/status and their existing
// routes must continue to be served.
//
// Procedure:
//   1. Write two addon manifests into a scratch browser-first tree:
//        addon.resonant-echo     (the SDK demo)
//        addon.resonant-counter  (an unrelated workspace add-on)
//      plus the bundled Core add-ons.
//   2. Call executeAddonsStatus() — both workspace add-ons are listed.
//   3. Disable addon.resonant-echo by moving its addon.json out.
//   4. Re-call executeAddonsStatus() — addon.resonant-echo is gone,
//      addon.resonant-counter and Core add-ons are still present.
//   5. Re-enable addon.resonant-echo — it reappears in /addons/status.
//   6. The bridge route arrays still contain addon-counter routes
//      throughout the disable/re-enable cycle, proving that the Core
//      add-on contract is not coupled to any single SDK add-on.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";
import { buildWorkspaceAddonRoutes } from "../host/addon-delegation-host-service.mjs";

const ROOT_PARENT = path.join(os.tmpdir(), "sdk-demo-001-disable-");

async function writeManifest(browserFirstRoot, manifest) {
  const addonDir = path.join(browserFirstRoot, "addons", manifest.id);
  await rm(addonDir, { recursive: true, force: true });
  await mkdir(addonDir, { recursive: true });
  await writeFile(path.join(addonDir, "addon.json"), JSON.stringify(manifest, null, 2), "utf8");
}

async function disableAddon(browserFirstRoot, addonId) {
  const addonDir = path.join(browserFirstRoot, "addons", addonId);
  await rm(addonDir, { recursive: true, force: true });
}

const ECHO_MANIFEST = {
  id: "addon.resonant-echo",
  name: "Resonant Echo",
  version: "0.1.0",
  mode: "workspace-addon",
  trust: "sdk-reference",
  boundary: "Replaceable.",
  capabilities: ["harness-messaging"],
  contributions: {
    workspace: {
      type: "iframe",
      proxyPath: "/echo/",
      apiBasePath: "/api/echo",
      iframeMode: "srcdoc",
      entry: "index.html",
      upstreamPortEnvVar: "RESONANTOS_TEST_ECHO_PORT",
      mirrorPaths: [
        { bridge: "/echo", upstream: "" },
        { bridge: "/api/echo", upstream: "/api/echo" }
      ],
      runtime: { command: "node", args: ["server.mjs"], port: 47321 }
    }
  },
  messaging: {
    channel: "addon.resonant-echo",
    requestCapability: "harness-messaging",
    routes: [
      { method: "POST", path: "/api/echo/message", requiredCapability: "harness-messaging" }
    ]
  }
};

const COUNTER_MANIFEST = {
  id: "addon.resonant-counter",
  name: "Resonant Counter",
  version: "0.1.0",
  mode: "workspace-addon",
  trust: "sdk-reference",
  boundary: "Replaceable.",
  capabilities: ["harness-messaging"],
  contributions: {
    workspace: {
      type: "iframe",
      proxyPath: "/counter/",
      apiBasePath: "/api/counter",
      iframeMode: "srcdoc",
      entry: "index.html",
      upstreamPortEnvVar: "RESONANTOS_TEST_COUNTER_PORT",
      mirrorPaths: [
        { bridge: "/counter", upstream: "" },
        { bridge: "/api/counter", upstream: "/api/counter" }
      ],
      runtime: { command: "node", args: ["server.mjs"], port: 47422 }
    }
  },
  messaging: {
    channel: "addon.resonant-counter",
    requestCapability: "harness-messaging",
    routes: [
      { method: "POST", path: "/api/counter/increment", requiredCapability: "harness-messaging" }
    ]
  }
};

test("disabling a single SDK add-on does not break Core add-on contract", async () => {
  process.env["RESONANTOS_TEST_ECHO_PORT"] = "47321";
  process.env["RESONANTOS_TEST_COUNTER_PORT"] = "47422";

  const browserFirstRootPath = await mkdtemp(ROOT_PARENT);
  try {
    const browserFirstRoot = () => browserFirstRootPath;
    const service = createAddonDelegationService({
      browserFirstRoot,
      repoRoot: path.join(browserFirstRootPath, "Repo"),
      memoryRoot: () => path.join(browserFirstRootPath, "Memory"),
      userRoot: () => path.join(browserFirstRootPath, "User"),
      socketOpen: async () => false,
      hermesCommand: () => null,
      opencodeCommand: () => null
    });

    // Step 1 — both add-ons registered.
    await writeManifest(browserFirstRootPath, ECHO_MANIFEST);
    await writeManifest(browserFirstRootPath, COUNTER_MANIFEST);

    const initial = await service.executeAddonsStatus();
    const initialEcho = initial.addons.find((a) => a.id === ECHO_MANIFEST.id);
    const initialCounter = initial.addons.find((a) => a.id === COUNTER_MANIFEST.id);
    assert.ok(initialEcho, "step 1: addon.resonant-echo must be registered");
    assert.ok(initialCounter, "step 1: addon.resonant-counter must be registered");
    assert.equal(initialEcho.proxyPath, "/echo/");
    assert.equal(initialCounter.proxyPath, "/counter/");

    // The Core add-ons are still present too.
    assert.ok(initial.addons.find((a) => a.id === "addon.hermes"), "step 1: addon.hermes must be present");
    assert.ok(initial.addons.find((a) => a.id === "addon.opencode"), "step 1: addon.opencode must be present");
    assert.ok(initial.addons.find((a) => a.id === "addon.living-archive"), "step 1: addon.living-archive must be present");

    // Build the bridge routes — both workspace add-ons contribute.
    const initialRoutes = buildWorkspaceAddonRoutes({
      workspaceAddons: [initialEcho, initialCounter].map((addon) => ({
        id: addon.id,
        name: addon.name,
        version: addon.version,
        mode: addon.mode,
        trust: addon.trust,
        boundary: addon.boundary,
        contributions: {
          workspace: {
            proxyPath: addon.proxyPath,
            apiBasePath: addon.apiBasePath,
            iframeMode: addon.iframeMode,
            entry: "index.html"
          }
        },
        messaging: addon.messaging
      })),
      executeWorkspaceAddonRequest: async () => ({ status: 200, body: { ok: true, stub: true } })
    });
    assert.equal(initialRoutes.length, 2, "step 1: both workspace add-ons contribute one route each");

    // Step 2 — disable addon.resonant-echo.
    await disableAddon(browserFirstRootPath, ECHO_MANIFEST.id);

    const afterDisable = await service.executeAddonsStatus();
    assert.ok(!afterDisable.addons.find((a) => a.id === ECHO_MANIFEST.id), "step 2: addon.resonant-echo must be gone");
    assert.ok(afterDisable.addons.find((a) => a.id === COUNTER_MANIFEST.id), "step 2: addon.resonant-counter must still be registered");
    assert.ok(afterDisable.addons.find((a) => a.id === "addon.hermes"), "step 2: addon.hermes must still be present");
    assert.ok(afterDisable.addons.find((a) => a.id === "addon.opencode"), "step 2: addon.opencode must still be present");
    assert.ok(afterDisable.addons.find((a) => a.id === "addon.living-archive"), "step 2: addon.living-archive must still be present");

    // The bridge route array for the surviving SDK add-on is still constructable.
    const survivingCounter = afterDisable.addons.find((a) => a.id === COUNTER_MANIFEST.id);
    const afterDisableRoutes = buildWorkspaceAddonRoutes({
      workspaceAddons: [{
        id: survivingCounter.id,
        name: survivingCounter.name,
        version: survivingCounter.version,
        mode: survivingCounter.mode,
        trust: survivingCounter.trust,
        boundary: survivingCounter.boundary,
        contributions: {
          workspace: {
            proxyPath: survivingCounter.proxyPath,
            apiBasePath: survivingCounter.apiBasePath,
            iframeMode: survivingCounter.iframeMode,
            entry: "index.html"
          }
        },
        messaging: survivingCounter.messaging
      }],
      executeWorkspaceAddonRequest: async () => ({ status: 200, body: { ok: true, stub: true } })
    });
    assert.equal(afterDisableRoutes.length, 1, "step 2: only the surviving workspace add-on contributes a route");
    assert.equal(afterDisableRoutes[0].path, "/api/counter/increment");

    // Step 3 — re-enable addon.resonant-echo.
    await writeManifest(browserFirstRootPath, ECHO_MANIFEST);
    const afterReenable = await service.executeAddonsStatus();
    assert.ok(afterReenable.addons.find((a) => a.id === ECHO_MANIFEST.id), "step 3: addon.resonant-echo must reappear");
    assert.ok(afterReenable.addons.find((a) => a.id === COUNTER_MANIFEST.id), "step 3: addon.resonant-counter must still be present");
    assert.ok(afterReenable.addons.find((a) => a.id === "addon.hermes"), "step 3: addon.hermes must still be present");
  } finally {
    delete process.env["RESONANTOS_TEST_ECHO_PORT"];
    delete process.env["RESONANTOS_TEST_COUNTER_PORT"];
    await rm(browserFirstRootPath, { recursive: true, force: true });
  }
});
