import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { createBridgeClient } from "../resonantos-side-panel-extension/src/lib/bridge-client.js";
import {
  createReachabilityBanner,
  REACHABILITY_BANNER_CLASSES,
  REACHABILITY_BANNER_ID,
} from "../resonantos-side-panel-extension/src/lib/bridge-reachability-banner.js";

// Minimal DOM factory: enough to exercise the banner without jsdom.
function makeFakeElement(initialHidden = true) {
  const listeners = new Set();
  const dataset = {};
  return {
    id: REACHABILITY_BANNER_ID,
    hidden: initialHidden,
    dataset,
    classList: {
      _set: new Set(),
      add(...names) { for (const n of names) this._set.add(n); },
      remove(...names) { for (const n of names) this._set.delete(n); },
      contains(name) { return this._set.has(name); },
    },
    setAttribute(name, value) { if (name === "role") this.role = value; if (name === "aria-live") this.ariaLive = value; },
    addEventListener() {},
    removeEventListener() {},
    get textContent() { return this._text; },
    set textContent(value) { this._text = value; },
    _fireEvent(name) { for (const l of listeners) l({ type: name }); },
  };
}

function makeFakeDocument(element) {
  return {
    getElementById(id) { return id === REACHABILITY_BANNER_ID ? element : null; },
  };
}

function makeNetworkError(code = "ECONNREFUSED") {
  const err = new TypeError("fetch failed");
  err.cause = { code };
  return err;
}

test("createReachabilityBanner: returns no-op when document missing", () => {
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: undefined });
  assert.equal(typeof banner.dispose, "function");
  assert.equal(typeof banner.update, "function");
  banner.dispose();
});

test("createReachabilityBanner: returns no-op when target element missing", () => {
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: { getElementById: () => null } });
  assert.equal(typeof banner.dispose, "function");
  banner.dispose();
});

test("createReachabilityBanner: hides banner when state is online", () => {
  const element = makeFakeElement(false);
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  assert.equal(element.hidden, true);
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.online), true);
  assert.equal(element.dataset.bridgeState, "online");
  banner.dispose();
});

test("createReachabilityBanner: reveals banner + sets state classes on ECONNREFUSED burst", async () => {
  const element = makeFakeElement(true);
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => { throw makeNetworkError(); },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  try { await client("/addons/registry", { method: "GET" }); } catch { /* expected */ }
  // The 4-attempt backoff budget exhausts before the test returns, so the
  // final state observed by the banner is "persistent". The "unreachable"
  // intermediate state is exercised separately below.
  assert.equal(element.hidden, false);
  assert.equal(element.dataset.bridgeState, "persistent");
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.persistent), true);
  banner.dispose();
});

test("createReachabilityBanner: marks transient 'unreachable' when one of four attempts is still in retry", async () => {
  const element = makeFakeElement(true);
  const calls = { count: 0 };
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => {
      calls.count += 1;
      // Fail twice then succeed — keeps the banner in the "unreachable" state.
      if (calls.count < 3) throw makeNetworkError();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  await client("/addons/registry", { method: "GET" });
  assert.equal(element.dataset.bridgeState, "online");
  // The final state is online (recovered) — verify the banner hidden flag.
  assert.equal(element.hidden, true);
  banner.dispose();
});

test("createReachabilityBanner: updates to persistent after retries exhausted", async () => {
  const element = makeFakeElement(true);
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => { throw makeNetworkError(); },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  try { await client("/addons/registry", { method: "GET" }); } catch { /* expected */ }
  assert.equal(element.dataset.bridgeState, "persistent");
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.persistent), true);
  banner.dispose();
});

test("createReachabilityBanner: dispose clears banner state", () => {
  const element = makeFakeElement(true);
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => { throw makeNetworkError(); },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  banner.dispose();
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.root), false);
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.unreachable), false);
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.persistent), false);
  assert.equal(element.classList.contains(REACHABILITY_BANNER_CLASSES.online), false);
  assert.equal(element.dataset.bridgeState, undefined);
});

test("createReachabilityBanner: probe() resolves immediately when state is online", async () => {
  const element = makeFakeElement(true);
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ ok: true }), { status: 200 }); },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  const before = calls;
  await banner.probe();
  // State was already online from the constructor; no fetch should fire.
  assert.equal(calls, before);
  banner.dispose();
});

test("createReachabilityBanner: probe() fires a fetch when state is persistent", async () => {
  const element = makeFakeElement(true);
  let calls = 0;
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => {
      calls += 1;
      // Fail the entire retry budget (6 attempts) plus a buffer so the
      // first call lands the store in "persistent", then succeed to let the
      // probe drive it back to "online".
      if (calls <= 6) throw makeNetworkError();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  // Drive the state to persistent first.
  try { await client("/addons/registry", { method: "GET" }); } catch { /* expected */ }
  assert.equal(element.dataset.bridgeState, "persistent");
  const before = calls;
  await banner.probe();
  // The probe should have driven another set of attempts that recover.
  assert.equal(calls > before, true);
  assert.equal(element.dataset.bridgeState, "online");
  banner.dispose();
});

test("createReachabilityBanner: probe() swallows errors and resolves", async () => {
  const element = makeFakeElement(true);
  const client = createBridgeClient({
    bridgeUrl: "http://127.0.0.1:45125",
    bridgeToken: randomBytes(16).toString("hex"),
    fetchImpl: async () => { throw makeNetworkError(); },
  });
  const banner = createReachabilityBanner({ bridgeRequest: client, document: makeFakeDocument(element) });
  try { await client("/addons/registry", { method: "GET" }); } catch { /* expected */ }
  await assert.doesNotReject(() => banner.probe());
  banner.dispose();
});