// Offline tests for the http-json transport (M3).
// `dispatch()` is exercised directly (no socket), and a guarded live test binds
// 127.0.0.1:0 to prove the real POST round-trip — skipped where the sandbox denies
// a loopback bind (mirrors addons/resonant-browser-host/test/browser-host.test.mjs).

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createCommunityHubServer, dispatch, listen } from "../src/http-server.mjs";

function fakeService() {
  return {
    signedIn: false,
    signIn(token) {
      this.token = token;
      this.signedIn = true;
      return { signedIn: true };
    },
    signOut() {
      this.signedIn = false;
      return { signedIn: false };
    },
    isSignedIn() {
      return this.signedIn;
    },
    audit() {
      return [{ event: "x" }];
    },
    async status() {
      return { ok: true, service: "community-hub", signedIn: this.signedIn };
    },
    async call(method, params) {
      this.lastCall = { method, params };
      return { called: method, params };
    },
  };
}

const fakePoller = { getSnapshot: () => ({ events: [], tasks: [], presence: [], degraded: false }) };

describe("dispatch (host-local control methods)", () => {
  it("routes community.status to service.status", async () => {
    const service = fakeService();
    const { status, body } = await dispatch({ service, poller: fakePoller }, { method: "community.status" });
    assert.equal(status, 200);
    assert.equal(body.result.service, "community-hub");
  });

  it("routes community.snapshot to the poller snapshot", async () => {
    const { body } = await dispatch({ service: fakeService(), poller: fakePoller }, { method: "community.snapshot" });
    assert.deepEqual(body.result.events, []);
  });

  it("routes sign_in / sign_out through the service", async () => {
    const service = fakeService();
    await dispatch({ service, poller: fakePoller }, { method: "community.sign_in", params: { token: "abc" } });
    assert.equal(service.token, "abc");
    assert.equal(service.isSignedIn(), true);
    await dispatch({ service, poller: fakePoller }, { method: "community.sign_out" });
    assert.equal(service.isSignedIn(), false);
  });

  it("routes community.* tool calls into service.call", async () => {
    const service = fakeService();
    const { body } = await dispatch({ service, poller: fakePoller }, { method: "community.rsvp", params: { eventId: "e1" } });
    assert.equal(body.result.called, "community.rsvp");
    assert.deepEqual(service.lastCall, { method: "community.rsvp", params: { eventId: "e1" } });
  });
});

describe("createCommunityHubServer (live loopback round-trip)", () => {
  let bound;
  let bindDenied = false;

  before(async () => {
    const server = createCommunityHubServer({ service: fakeService(), poller: fakePoller });
    try {
      bound = await listen(server, { port: 0 });
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        bindDenied = true;
        return;
      }
      throw error;
    }
  });

  after(async () => {
    if (bound?.server?.listening) {
      await new Promise((resolve) => bound.server.close(() => resolve()));
    }
  });

  it("answers GET /status", async (t) => {
    if (bindDenied) return t.skip("loopback bind denied in this sandbox");
    const res = await fetch(`${bound.url}/status`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.result.service, "community-hub");
  });

  it("answers a POST JSON-RPC method call and echoes the id", async (t) => {
    if (bindDenied) return t.skip("loopback bind denied in this sandbox");
    const res = await fetch(bound.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "42", method: "community.list_events" }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.id, "42");
    assert.equal(body.result.called, "community.list_events");
  });

  it("rejects non-POST/GET verbs with 405", async (t) => {
    if (bindDenied) return t.skip("loopback bind denied in this sandbox");
    const res = await fetch(bound.url, { method: "DELETE" });
    assert.equal(res.status, 405);
  });
});
