// CP-BR0: Bridge Target must not expose the superseded bridge-hosted self-start action.

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

async function setup(t) {
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
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
    },
  };
  globalThis.__RESONANTOS_BRIDGE_CONFIG__ = {
    bridgeUrl: "http://127.0.0.1:47773",
    bridgeToken: "generated-test-token",
    capabilityBootstrapToken: "generated-bootstrap-test-token",
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });

  const { renderBridgeTargetSection } =
    await import("../resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js");
  const root = document.querySelector("main");
  renderBridgeTargetSection(root);
  return root;
}

test("CP-BR0 keeps Bridge Target diagnostics but removes Launch Bridge", async (t) => {
  const root = await setup(t);
  assert.ok(root.querySelector(".settings-health-grid"));
  assert.equal(root.querySelector('[data-testid="bridge-launch-button"]'), null);
  assert.equal(root.querySelector('[data-testid="bridge-launch-status"]'), null);
  assert.doesNotMatch(root.textContent, /Launch Bridge/i);
});
