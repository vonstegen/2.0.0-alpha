// Lock the host-side surface-dock-resolver contract. Mirrors
// src/sdk/addons/surface-routing.ts (which is TypeScript and not
// importable from this plain-.mjs host runtime). The extension's
// Tools rail depends on `GET /addons/surface-routes` returning these
// routes, so assert the bundled manifests resolve deterministically.

import assert from "node:assert/strict";
import test from "node:test";
import { createAddOnSurfaceDockRoutes, discoverBundledAddonManifests } from "../host/addon-delegation-service.mjs";

function installationsFor(discovered) {
  const installations = {};
  for (const { id, manifest } of discovered) {
    installations[id] = {
      installed: true,
      enabled: true,
      status: "enabled",
      grantedCapabilities: (manifest.requestedCapabilities ?? []).map((entry) => ({
        capability: entry?.capability,
        granted: true,
        scope: entry?.scope ?? "shared",
        revocationBehavior: entry?.revocationBehavior ?? "hard-stop",
      })),
    };
  }
  return installations;
}

test("bundled manifests resolve to the expected shell dock routes", async () => {
  const discovered = await discoverBundledAddonManifests(process.cwd());
  const manifests = discovered.map((entry) => entry.manifest);
  const routes = createAddOnSurfaceDockRoutes(manifests, installationsFor(discovered));

  // sectionId -> { order, dockIcon, surfaceId } for every surface that
  // declares shellNavigation in the bundled + example catalogs.
  const bySection = Object.fromEntries(routes.map((route) => [route.sectionId, route]));

  assert.deepEqual(Object.keys(bySection).sort(), [
    "deepseek-harness",
    "hermes",
    "memory",
    "opencode",
    "recursive-mas",
    "reference-memory",
  ]);
  assert.equal(bySection.memory.addonId, "addon.living-archive");
  assert.equal(bySection.hermes.addonId, "addon.hermes");
  assert.equal(bySection.opencode.addonId, "addon.opencode");
  assert.equal(bySection["deepseek-harness"].addonId, "addon.deepseek-harness");
  assert.equal(bySection.memory.dockIcon, "archive");
  assert.equal(bySection["deepseek-harness"].dockIcon, "runtime");

  // Order is ascending and stable.
  assert.deepEqual(routes.map((route) => route.order), [10, 20, 30, 40, 50, 60]);
});

test("hides a dock route when a required capability is not granted", () => {
  const manifest = {
    id: "addon.gated",
    name: "Gated",
    surfaces: [{
      id: "gated-surface",
      label: "Gated",
      shellNavigation: {
        sectionId: "gated",
        dockIcon: "runtime",
        eyebrow: "Gated",
        requiredCapabilities: ["agent-delegation"],
      },
    }],
  };
  const granted = { installed: true, enabled: true, grantedCapabilities: [{ capability: "agent-delegation", granted: true }] };
  const denied = { installed: true, enabled: true, grantedCapabilities: [{ capability: "agent-delegation", granted: false }] };

  assert.equal(createAddOnSurfaceDockRoutes([manifest], { "addon.gated": granted }).length, 1);
  assert.equal(createAddOnSurfaceDockRoutes([manifest], { "addon.gated": denied }).length, 0);
});
