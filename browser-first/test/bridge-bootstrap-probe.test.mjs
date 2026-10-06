// CP-BR1: probe signature tests for the shared bridge-bootstrap health probe.
//
// Validates that `ensureBridgeReachable` now correctly identifies a
// ResonantOS bridge (the bridge serves no unauthenticated health route
// and answers every unauthenticated request with the documented 401
// body), while still rejecting any other process answering the loopback
// port. The implementation probe is the same function shared by the
// `POST /terminal-host/launch` route and the CP-BR1 native bootstrap host.

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";

const { ensureBridgeReachable, DEFAULT_BRIDGE_ENDPOINT } = await import("../host/bridge-bootstrap.mjs");

function fakeRequestFactory(responses) {
  let index = 0;
  return (url, options, callback) => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const res = {
      statusCode: response.status,
      on(event, handler) {
        if (event === "data") {
          setImmediate(() => handler(Buffer.from(response.body)));
        } else if (event === "end") {
          setImmediate(handler);
        } else if (event === "error") {
          // never fires in these fakes
        }
        return this;
      },
    };
    const fake = {
      on(event, handler) {
        if (event === "error") { /* never */ }
        return this;
      },
      end() {
        setImmediate(() => callback(res));
      },
    };
    return fake;
  };
}

test("DEFAULT_BRIDGE_ENDPOINT is the authoritative Alpha port 47773", () => {
  assert.equal(DEFAULT_BRIDGE_ENDPOINT, "http://127.0.0.1:47773");
});

test("a 200 {ok:true, version} response is healthy with that version", async () => {
  const probe = ensureBridgeReachable.bind(null);
  const result = await probe({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.resolve(),
    _request: fakeRequestFactory([{ status: 200, body: JSON.stringify({ ok: true, version: "2.0.0" }) }]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, "2.0.0");
  assert.equal(result.endpoint, "http://127.0.0.1:0");
});

test("the bridge's unauthenticated 401 signature is healthy with version null", async () => {
  const result = await ensureBridgeReachable({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.resolve(),
    _request: fakeRequestFactory([
      { status: 401, body: JSON.stringify({ ok: false, error: "Unauthorized browser-first bridge request." }) },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.version, null);
});

test("an arbitrary 401 with a different body is bridge-not-running", async () => {
  const result = await ensureBridgeReachable({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.resolve(),
    _request: fakeRequestFactory([{ status: 401, body: JSON.stringify({ error: "login" }) }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bridge-not-running");
  assert.equal(result.code, "HTTP_401");
});

test("a 200 with malformed JSON body is bridge-not-running", async () => {
  const result = await ensureBridgeReachable({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.resolve(),
    _request: fakeRequestFactory([{ status: 200, body: "not json" }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BAD_HEALTHZ");
});

test("a 500 status is bridge-not-running", async () => {
  const result = await ensureBridgeReachable({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.resolve(),
    _request: fakeRequestFactory([{ status: 500, body: "" }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "HTTP_500");
});

test("a closed TCP port is bridge-not-running with ECONNREFUSED", async () => {
  const result = await ensureBridgeReachable({
    endpoint: "http://127.0.0.1:0",
    _probeTcp: () => Promise.reject(Object.assign(new Error("closed"), { code: "ECONNREFUSED" })),
    _request: fakeRequestFactory([{ status: 200, body: "" }]),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ECONNREFUSED");
});

test("end-to-end against a local HTTP server emitting the bridge 401 body", async () => {
  const server = createServer((request, response) => {
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "Unauthorized browser-first bridge request." }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await ensureBridgeReachable({
      endpoint: `http://127.0.0.1:${port}`,
      timeoutMs: 1500,
      _request: httpRequest,
    });
    assert.equal(result.ok, true);
    assert.equal(result.version, null);
    assert.equal(result.endpoint, `http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});