// SDK-DEMO-003R T5 — operator grant/revoke UI regression.
//
// The Add-ons workspace card must expose explicit install/grant/revoke that map
// to the host-owned lifecycle routes and derive state from an authoritative
// re-read — never from optimistic local-only state or the manifest's
// grantPresets. Coverage:
//   1. discovered-but-uninstalled add-on shows no granted authority
//   2. installed denied capability renders denied
//   3. explicit grant calls the host grant route and becomes granted after refresh
//   4. explicit revoke calls the converged T4 revoke route and becomes denied
//   5. 4xx policy denial surfaces an error and never renders false success
//   6. 5xx runtime failure surfaces an error and never renders false success
//   7. pending mutation disables/restricts duplicate actions
//   8. refresh alone causes no install/grant mutation
//   9. caller privileged URL/token fields are never emitted

import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { renderAddOnsWorkspace } from "../resonantos-side-panel-extension/src/lib/main-workspace-addons.js";

const NETWORK_REQUEST = { capability: "network", scope: "self", revocationBehavior: "hard-stop", granted: false };

function dom() {
  const d = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = d.window.document;
  return d.window.document.querySelector("#root");
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function echoManifest(overrides = {}) {
  return {
    id: "addon.resonant-echo",
    name: "Resonant Echo",
    available: true,
    mode: "workspace-addon",
    trust: "host-mediated workspace add-on",
    category: "tool",
    entrypoint: "http://127.0.0.1:47321",
    origin: "http://127.0.0.1:47321",
    runtimeType: "local-service",
    requestedCapabilities: [NETWORK_REQUEST],
    installed: true,
    grantedCapabilities: [],
    deniedCapabilities: ["network"],
    ...overrides,
  };
}

// Stateful bridge mock. `granted`/`installed` are the authoritative values
// reported on /addons/status; mutation routes mutate them so the following
// re-read reflects the converged host state. A statusful status response is
// derived from installed/granted (an uninstalled add-on reports no grants and
// no denials, matching executeAddonsStatus).
function makeBridge({ installed = true, granted = [] } = {}) {
  const calls = [];
  const fail = { grant: null, revoke: null };
  const bridgeRequest = async (route, options = {}) => {
    calls.push([route, options.body ?? null]);
    if (route === "/addons/status") {
      return {
        addons: [],
        workspaceAddonManifests: [echoManifest({
          installed,
          grantedCapabilities: installed ? granted : [],
          deniedCapabilities: installed ? (granted.length ? [] : ["network"]) : [],
        })],
      };
    }
    if (route === "/addons/workspace/grant") {
      if (fail.grant) throw fail.grant;
      granted = ["network"];
      return { addonId: options.body.addonId, installation: { grantedCapabilities: [{ capability: "network", granted: true }] } };
    }
    if (route === "/addons/workspace/revoke") {
      if (fail.revoke) throw fail.revoke;
      granted = [];
      return { addonId: options.body.addonId, installation: { grantedCapabilities: [{ capability: "network", granted: false }] } };
    }
    if (route === "/addons/delegate/list") return { delegations: [] };
    if (route === "/addons/draft/list") return { drafts: [] };
    throw new Error(`Unexpected route ${route}`);
  };
  return {
    calls,
    bridgeRequest,
    setGrantFail: (e) => { fail.grant = e; },
    setRevokeFail: (e) => { fail.revoke = e; },
  };
}

function button(card, re) {
  return [...card.querySelectorAll("button")].find((b) => re.test(b.textContent));
}

test("T5 discovered-but-uninstalled add-on shows no granted authority", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: false });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  const card = container.querySelector(".addon-card--workspace");
  assert.ok(card);
  assert.match(card.textContent, /Discovered/);
  assert.ok(button(card, /Install Resonant Echo/), "must offer Install");
  assert.equal(button(card, /Grant requested capabilities/), undefined, "uninstalled add-on must not offer grant");
  assert.equal(button(card, /Revoke granted capabilities/), undefined, "uninstalled add-on must not offer revoke");
  // No granted authority chips: requested network shows as "Needs review".
  const chips = card.querySelector(".settings-addon-capabilities").textContent;
  assert.match(chips, /Needs review/);
  assert.doesNotMatch(chips, /^Granted$|Grantednetwork/);
});

test("T5 installed denied capability renders denied", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: true, granted: [] });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  const card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /Denied/);
  assert.match(card.textContent, /Denied by policy/);
  assert.match(card.textContent, /network/);
  assert.ok(button(card, /Grant requested capabilities/), "denied capability must offer grant");
  assert.equal(button(card, /Revoke granted capabilities/), undefined);
});

test("T5 explicit grant calls host grant route and becomes granted after authoritative refresh", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: true, granted: [] });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  button(container.querySelector(".addon-card--workspace"), /Grant requested capabilities/).click();
  await flush();

  const grantCalls = bridge.calls.filter(([route]) => route === "/addons/workspace/grant");
  assert.equal(grantCalls.length, 1, "exactly one grant call");
  const [, body] = grantCalls[0];
  assert.equal(body.addonId, "addon.resonant-echo");
  assert.deepEqual(body.grants, [
    { capability: "network", scope: "self", revocationBehavior: "hard-stop", granted: true },
  ]);
  assert.ok(!("upstreamAdminUrl" in body) && !("adminToken" in body));

  const card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /Granted/);
  assert.ok(button(card, /Revoke granted capabilities/), "granted capability must offer revoke");
  assert.equal(button(card, /Grant requested capabilities/), undefined);
});

test("T5 explicit revoke calls converged T4 route and becomes denied after authoritative refresh", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: true, granted: ["network"] });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  button(container.querySelector(".addon-card--workspace"), /Revoke granted capabilities/).click();
  await flush();

  const revokeCalls = bridge.calls.filter(([route]) => route === "/addons/workspace/revoke");
  assert.equal(revokeCalls.length, 1);
  const [, body] = revokeCalls[0];
  assert.equal(body.addonId, "addon.resonant-echo");
  assert.deepEqual(body.capabilities, ["network"]);
  assert.ok(!("upstreamAdminUrl" in body) && !("adminToken" in body));

  const card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /Denied/);
  assert.match(card.textContent, /Denied by policy/);
  assert.ok(button(card, /Grant requested capabilities/));
});

test("T5 4xx policy denial surfaces error and never renders false success", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: true, granted: [] });
  bridge.setGrantFail(Object.assign(new Error("permission-denied"), { bridgeStatus: 403, code: "permission-denied" }));
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  button(container.querySelector(".addon-card--workspace"), /Grant requested capabilities/).click();
  await flush();

  const card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /denied by policy \(HTTP 403\)/);
  assert.match(card.textContent, /Denied/);
  assert.doesNotMatch(card.textContent, /Granted/);
  assert.ok(button(card, /Grant requested capabilities/), "retry grant must remain available");
});

test("T5 5xx runtime failure surfaces error and never renders false success", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: true, granted: ["network"] });
  bridge.setRevokeFail(Object.assign(new Error("runtime-unavailable"), { bridgeStatus: 503, code: "runtime-unavailable" }));
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  button(container.querySelector(".addon-card--workspace"), /Revoke granted capabilities/).click();
  await flush();

  const card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /failed \(HTTP 503\)/);
  assert.match(card.textContent, /Granted/);
  assert.doesNotMatch(card.textContent, /Denied by policy/);
  assert.ok(button(card, /Revoke granted capabilities/), "retry revoke must remain available");
});

test("T5 pending mutation disables/restricts duplicate actions", async () => {
  const container = dom();
  // Custom mock: grant is deferred so the pending state is observable.
  let resolveGrant;
  const grantGate = new Promise((resolve) => { resolveGrant = resolve; });
  const calls = [];
  let granted = [];
  const bridgeRequest = async (route, options = {}) => {
    calls.push([route, options.body ?? null]);
    if (route === "/addons/status") {
      return {
        addons: [],
        workspaceAddonManifests: [echoManifest({ installed: true, grantedCapabilities: granted, deniedCapabilities: granted.length ? [] : ["network"] })],
      };
    }
    if (route === "/addons/workspace/grant") {
      await grantGate;
      granted = ["network"];
      return { addonId: options.body.addonId };
    }
    if (route === "/addons/delegate/list") return { delegations: [] };
    if (route === "/addons/draft/list") return { drafts: [] };
    throw new Error(`Unexpected route ${route}`);
  };

  renderAddOnsWorkspace({ container, bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  button(container.querySelector(".addon-card--workspace"), /Grant requested capabilities/).click();
  await flush();

  // Mutation is gated: the button is disabled while pending and a second click
  // is ignored, so no duplicate grant fires.
  let card = container.querySelector(".addon-card--workspace");
  const pendingGrant = button(card, /Grant requested capabilities/);
  assert.equal(pendingGrant.disabled, true, "grant button must be disabled while pending");
  pendingGrant.click();
  await flush();
  assert.equal(calls.filter(([route]) => route === "/addons/workspace/grant").length, 1, "duplicate grant must be suppressed");

  resolveGrant();
  await flush();
  card = container.querySelector(".addon-card--workspace");
  assert.match(card.textContent, /Granted/);
});

test("T5 refresh alone causes no install/grant mutation", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: false });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  const mutationRoutes = bridge.calls.filter(([route]) => route.startsWith("/addons/workspace/"));
  assert.deepEqual(mutationRoutes, [], "status/read must not install or grant");
  assert.deepEqual(
    bridge.calls.map(([route]) => route),
    ["/addons/status", "/addons/delegate/list", "/addons/draft/list"],
  );
});

test("T5 UI never emits caller privileged URL/token fields", async () => {
  const container = dom();
  const bridge = makeBridge({ installed: false });
  renderAddOnsWorkspace({ container, bridgeRequest: bridge.bridgeRequest, onOpenWorkspace: () => undefined });
  await flush();

  const card = container.querySelector(".addon-card--workspace");
  const install = button(card, /Install Resonant Echo/);
  assert.ok(install);
  install.click();
  await flush();

  for (const [route, body] of bridge.calls) {
    if (!route.startsWith("/addons/workspace/")) continue;
    assert.ok(body && typeof body === "object", `${route} must send a body`);
    assert.ok(!("upstreamAdminUrl" in body), `${route} must not send upstreamAdminUrl`);
    assert.ok(!("adminToken" in body), `${route} must not send adminToken`);
  }
  const installCall = bridge.calls.find(([route]) => route === "/addons/workspace/install");
  assert.deepEqual(installCall[1], { addonId: "addon.resonant-echo" });
});
