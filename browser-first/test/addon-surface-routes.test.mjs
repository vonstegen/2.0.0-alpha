// Lock the host-side rail-menu-resolver contract. Mirrors
// src/sdk/addons/surface-routing.ts (which is TypeScript and not
// importable from this plain-.mjs host runtime). The extension's rail
// depends on `GET /addons/surface-routes` returning these grouped menus, so
// assert the bundled manifests resolve deterministically: harness add-ons
// (category `agent`) each get their own menu, memory providers collapse into
// a single "Memory" menu, and every other category collapses into "Tools".

import assert from "node:assert/strict";
import test from "node:test";
import { createAddOnRailMenus, discoverBundledAddonManifests } from "../host/addon-delegation-service.mjs";

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

test("bundled manifests resolve to grouped rail menus", async () => {
  const discovered = await discoverBundledAddonManifests(process.cwd());
  const manifests = discovered.map((entry) => entry.manifest);
  const menus = createAddOnRailMenus(manifests, installationsFor(discovered));

  assert.deepEqual(
    menus.map(({ menuId, kind, label, dockIcon, order }) => ({ menuId, kind, label, dockIcon, order })),
    [
      { menuId: "memory", kind: "memory", label: "Memory", dockIcon: "memory", order: 10 },
      { menuId: "hermes", kind: "harness", label: "Hermes", dockIcon: "messaging", order: 20 },
      { menuId: "opencode", kind: "harness", label: "OpenCode", dockIcon: "workspace", order: 30 },
      { menuId: "deepseek-harness", kind: "harness", label: "DeepSeek Harness", dockIcon: "harness", order: 40 },
      { menuId: "recursive-mas", kind: "harness", label: "RecursiveMAS", dockIcon: "recursion", order: 50 },
    ],
  );

  // Memory menu groups both memory-category add-ons (distinct sectionIds).
  const memory = menus[0];
  assert.deepEqual(
    memory.routes.map((route) => route.addonId).sort(),
    ["addon.living-archive", "addon.reference-memory"],
  );

  // Harness menus carry the add-on's tools for the workspace sub-rail.
  const byId = Object.fromEntries(menus.map((menu) => [menu.menuId, menu]));
  assert.equal(byId.hermes.tools.length, 6);
  assert.equal(byId.opencode.tools.length, 1);
  assert.equal(byId["deepseek-harness"].tools.length, 3);
  assert.ok(byId["deepseek-harness"].tools.some((tool) => tool.name === "deepseek_harness.run_task"));
  assert.equal(byId["recursive-mas"].tools.length, 3);

  // Grouped menus carry no tools payload.
  assert.equal(memory.tools, undefined);
});

test("hides a rail menu when a required surface capability is not granted", () => {
  const manifest = {
    id: "addon.gated",
    name: "Gated",
    category: "agent",
    surfaces: [{
      id: "gated-surface",
      label: "Gated",
      shellNavigation: {
        sectionId: "gated",
        dockIcon: "harness",
        eyebrow: "Gated",
        requiredCapabilities: ["agent-delegation"],
      },
    }],
  };
  const granted = { installed: true, enabled: true, grantedCapabilities: [{ capability: "agent-delegation", granted: true }] };
  const denied = { installed: true, enabled: true, grantedCapabilities: [{ capability: "agent-delegation", granted: false }] };

  assert.equal(createAddOnRailMenus([manifest], { "addon.gated": granted }).length, 1);
  assert.equal(createAddOnRailMenus([manifest], { "addon.gated": denied }).length, 0);
});
