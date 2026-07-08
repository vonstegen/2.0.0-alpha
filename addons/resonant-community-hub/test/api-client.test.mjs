// Offline tests for the outbound Community API client (M3).
// A fake fetch records the exact request the host would make to the hosted API,
// so we can assert method/path/headers/body/bearer without any network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCommunityApiClient,
  normalizeApiBaseUrl,
  CommunityApiError,
  CommunityNetworkError,
} from "../src/api-client.mjs";

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

describe("normalizeApiBaseUrl", () => {
  it("accepts https and strips trailing slashes", () => {
    assert.equal(normalizeApiBaseUrl("https://hub.example.com/"), "https://hub.example.com");
  });
  it("allows plain http only for local/preview backends", () => {
    assert.equal(normalizeApiBaseUrl("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
    assert.equal(normalizeApiBaseUrl("http://localhost:3000"), "http://localhost:3000");
  });
  it("rejects plain http to a public host", () => {
    assert.throws(() => normalizeApiBaseUrl("http://hub.example.com"), /must use HTTPS/);
  });
  it("rejects embedded credentials, query, fragment, and non-http schemes", () => {
    assert.throws(() => normalizeApiBaseUrl("https://user:pw@hub.example.com"), /credentials/);
    assert.throws(() => normalizeApiBaseUrl("https://hub.example.com/?x=1"), /query string/);
    assert.throws(() => normalizeApiBaseUrl("https://hub.example.com/#f"), /fragment/);
    assert.throws(() => normalizeApiBaseUrl("ftp://hub.example.com"), /http or https/);
    assert.throws(() => normalizeApiBaseUrl(""), /required/);
  });
});

describe("createCommunityApiClient reads", () => {
  it("GETs the public read endpoints with no bearer", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ events: [] }));
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    await client.listEvents();
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, "https://hub.example.com/v1/events");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, undefined);
  });

  it("parses JSON bodies", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ tasks: [{ id: "t1" }] }));
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    const res = await client.listTasks();
    assert.deepEqual(res.tasks, [{ id: "t1" }]);
  });
});

describe("createCommunityApiClient writes", () => {
  it("attaches the bearer token and JSON body for rsvp", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ rsvp: { state: "going" } }));
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    await client.rsvp({ eventId: "e 1", state: "going", token: "tok123" });
    const { url, init } = fetchImpl.calls[0];
    assert.equal(url, "https://hub.example.com/v1/events/e%201/rsvp");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.authorization, "Bearer tok123");
    assert.equal(init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(init.body), { state: "going" });
  });

  it("encodes clear vs set for presence", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ presence: null }));
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    await client.setPresence({ clear: true, token: "t" });
    assert.deepEqual(JSON.parse(fetchImpl.calls[0].init.body), { clear: true });
    await client.setPresence({ status: "around", note: "prepping", token: "t" });
    assert.deepEqual(JSON.parse(fetchImpl.calls[1].init.body), { status: "around", note: "prepping" });
    assert.equal(fetchImpl.calls[1].init.method, "PUT");
  });
});

describe("createCommunityApiClient errors", () => {
  it("throws CommunityApiError on non-2xx and carries the parsed body", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: "rate_limited", message: "slow down" }, { status: 429 }));
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    await assert.rejects(
      () => client.rsvp({ eventId: "e1", state: "going", token: "t" }),
      (e) => e instanceof CommunityApiError && e.status === 429 && e.code === "rate_limited" && /slow down/.test(e.message),
    );
  });

  it("maps fetch rejections to CommunityNetworkError", async () => {
    const fetchImpl = fakeFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl });
    await assert.rejects(() => client.listEvents(), (e) => e instanceof CommunityNetworkError && e.code === "network");
  });

  it("maps an aborted (timed-out) request to CommunityNetworkError", async () => {
    const fetchImpl = fakeFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const client = createCommunityApiClient({ baseUrl: "https://hub.example.com", fetchImpl, timeoutMs: 5 });
    await assert.rejects(() => client.listEvents(), (e) => e instanceof CommunityNetworkError && /timed out/.test(e.message));
  });
});
