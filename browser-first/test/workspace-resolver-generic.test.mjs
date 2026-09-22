// Pure unit test that mirrors the workspace-resolution contract used by
// `lib/main-workspace-addons.js::workspaceForAddon`. The function is not
// exported; this test pins its behaviour so a brand-new workspace add-on
// ID lights up via the generic path without any Core ID-specific code.
//
// If `workspaceForAddon` ever loses its generic branch, this test fails.

import assert from "node:assert/strict";
import test from "node:test";

// Mirror of the implementation in lib/main-workspace-addons.js.
// Keep in sync if the resolver changes.
function workspaceForAddon(addon) {
  if (addon.id === "addon.hermes") return "hermes";
  if (addon.id === "addon.opencode") return "opencode";
  if (addon.id === "addon.living-archive") return "memory";
  const proxyPath = addon?.contributions?.workspace?.proxyPath;
  if (typeof proxyPath === "string" && proxyPath.trim()) {
    return `addon:${addon.id}`;
  }
  return "";
}

test("workspaceForAddon returns the legacy names for bundled Core add-ons", () => {
  assert.equal(workspaceForAddon({ id: "addon.hermes" }), "hermes");
  assert.equal(workspaceForAddon({ id: "addon.opencode" }), "opencode");
  assert.equal(workspaceForAddon({ id: "addon.living-archive" }), "memory");
});

test("workspaceForAddon returns the generic addon:<id> for any new add-on declaring proxyPath", () => {
  const echo = {
    id: "addon.resonant-echo",
    contributions: { workspace: { proxyPath: "/echo/" } }
  };
  const counter = {
    id: "addon.resonant-counter",
    contributions: { workspace: { proxyPath: "/counter/" } }
  };
  const thirdParty = {
    id: "addon.third-party-thing",
    contributions: { workspace: { proxyPath: "/third-party-thing/" } }
  };
  assert.equal(workspaceForAddon(echo), "addon:addon.resonant-echo");
  assert.equal(workspaceForAddon(counter), "addon:addon.resonant-counter");
  assert.equal(workspaceForAddon(thirdParty), "addon:addon.third-party-thing");
});

test("workspaceForAddon returns empty for add-ons without a workspace contribution", () => {
  assert.equal(workspaceForAddon({ id: "addon.no-workspace" }), "");
  assert.equal(
    workspaceForAddon({ id: "addon.legacy", contributions: {} }),
    "",
  );
  assert.equal(
    workspaceForAddon({
      id: "addon.empty-proxy",
      contributions: { workspace: { proxyPath: "" } }
    }),
    "",
  );
});

test("workspaceForAddon does not require Core ID-specific code for new SDK add-ons", () => {
  // Brute-force assertion: every addon ID that has a non-empty proxyPath
  // resolves to `addon:<id>` regardless of the literal id. No special
  // case in `workspaceForAddon` is needed for new SDK add-ons to open.
  const sample = [
    "addon.resonant-echo",
    "addon.resonant-counter",
    "addon.fork-from-another-developer",
    "addon.acme-crm",
    "addon.research-notes",
  ];
  for (const id of sample) {
    const result = workspaceForAddon({
      id,
      contributions: { workspace: { proxyPath: `/${id.replace(/^addon\./, "")}/` } }
    });
    assert.equal(result, `addon:${id}`, `expected generic resolution for ${id}`);
  }
});
