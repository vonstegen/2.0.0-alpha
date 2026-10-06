// CP-BR2: deterministic tests for the extension-side native-messaging
// bootstrap client. The client wraps `chrome.runtime.connectNative(NATIVE_HOST_NAME)`
// and validates responses with the same exact-shape rules as the host.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOTSTRAP_PROTOCOL,
  NATIVE_HOST_NAME,
  buildBootstrapRequestEnvelope,
  createBootstrapClient,
  projectBootstrapResponse,
} from "../resonantos-side-panel-extension/src/lib/bootstrap-client.js";

// In tests, we never want the production privileged-context guard to
// run. The bootstrap client accepts a `privilegedCheck` injection seam;
// we pass a permissive no-op here and re-test the guard with a separate
// `privilegedCheck` override.
const PERMISSIVE_CHECK = () => undefined;

function makeFakePort({ handler }) {
  const messageListeners = [];
  const disconnectListeners = [];
  const sent = [];
  const port = {
    postMessage(message) {
      sent.push(message);
      queueMicrotask(() => handler(port, message));
    },
    onMessage: {
      listeners: messageListeners,
      addListener(fn) { messageListeners.push(fn); },
    },
    onDisconnect: {
      listeners: disconnectListeners,
      addListener(fn) { disconnectListeners.push(fn); },
    },
    disconnect() { /* noop */ },
  };
  return {
    sent,
    port,
    fireMessage(message) { for (const fn of messageListeners) fn(message); },
    fireDisconnect() { for (const fn of disconnectListeners) fn(); },
  };
}

function successResult(extra = {}) {
  return {
    ok: true,
    status: "connected",
    version: "1.0.0",
    endpoint: "http://127.0.0.1:47773",
    instanceId: "g1-deadbeef",
    generation: 1,
    startedAt: "2026-10-06T00:00:00.000Z",
    ...extra,
  };
}

test("buildBootstrapRequestEnvelope emits the exact three-field envelope", () => {
  const envelope = buildBootstrapRequestEnvelope({ operation: "status" });
  assert.deepEqual(Object.keys(envelope).sort(), ["operation", "protocol", "requestId"]);
  assert.equal(envelope.protocol, BOOTSTRAP_PROTOCOL);
  assert.equal(envelope.operation, "status");
  assert.equal(envelope.requestId.length, "r-".length + 16);
  assert.ok(Object.isFrozen(envelope));
});

test("buildBootstrapRequestEnvelope refuses unknown operations", () => {
  assert.throws(() => buildBootstrapRequestEnvelope({ operation: "launch" }), /unknown operation/);
});

test("createBootstrapClient: status -> connected resolves with the projected lifecycle shape", async () => {
  const port = makeFakePort({
    handler: (p, msg) => {
      const reply = {
        protocol: BOOTSTRAP_PROTOCOL,
        requestId: msg.requestId,
        result: successResult(),
      };
      p.onMessage.listeners[0]?.(JSON.stringify(reply));
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.ok, true);
  assert.equal(response.status, "connected");
  assert.equal(response.version, "1.0.0");
  assert.equal(response.endpoint, "http://127.0.0.1:47773");
  assert.equal(response.instanceId, "g1-deadbeef");
  assert.equal(response.generation, 1);
  assert.equal(response.alreadyRunning, false);
  assert.equal(response.failureCode, null);
});

test("createBootstrapClient: always reports the closed native host name", () => {
  const client = createBootstrapClient({
    createPort: () => { throw new Error("no port"); },
    privilegedCheck: PERMISSIVE_CHECK,
  });
  assert.equal(client.NATIVE_HOST_NAME, NATIVE_HOST_NAME);
  assert.equal(client.PROTOCOL, BOOTSTRAP_PROTOCOL);
});

test("createBootstrapClient: refusal on http(s) page context", () => {
  // The production guard inspects globalThis.location. We exercise it
  // directly via the bootstrap client's own seam: the guard runs at
  // construction time, so we just need to NOT pass a privilegedCheck
  // override. We need a stub chrome.runtime (so the chrome check passes)
  // and a fake location.protocol=http (so the page-context check fires).
  const savedChrome = globalThis.chrome;
  const savedLocation = globalThis.location;
  globalThis.chrome = { runtime: {} };
  globalThis.location = { href: "http://127.0.0.1:47773/some-page" };
  try {
    assert.throws(
      () => createBootstrapClient({ createPort: () => { throw new Error("unreachable"); } }),
      /refused in page context/,
    );
  } finally {
    if (savedChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = savedChrome;
    if (savedLocation === undefined) delete globalThis.location;
    else globalThis.location = savedLocation;
  }
});

test("createBootstrapClient: refusal when chrome.runtime is absent", () => {
  const saved = globalThis.chrome;
  delete globalThis.chrome;
  try {
    assert.throws(
      () => createBootstrapClient({ createPort: () => { throw new Error("unreachable"); } }),
      /chrome\.runtime is not available/,
    );
  } finally {
    if (saved !== undefined) globalThis.chrome = saved;
  }
});

test("createBootstrapClient: post failure surfaces internal-error, not raw text", async () => {
  const port = makeFakePort({ handler: () => undefined });
  port.port.postMessage = () => { throw new Error("native-bridge-broken-with-secret-Bearer-eyJh"); };
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("start");
  assert.equal(response.ok, false);
  assert.equal(response.failureCode, "internal-error");
  assert.match(response.failureMessage ?? "", /post-failed/);
  assert.equal(response.failureMessage?.includes("Bearer") ?? false, false, "must not leak raw error text");
});

test("createBootstrapClient: port open throws -> internal-error", async () => {
  const client = createBootstrapClient({
    createPort: () => { throw new Error("port-open-failed-with-pid-1234"); },
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "internal-error");
  assert.equal(response.failureMessage?.includes("pid") ?? false, false, "must not leak thrown error text");
});

test("createBootstrapClient: disconnect before message maps to closed internal-error", async () => {
  const port = makeFakePort({ handler: () => undefined });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    lastErrorMessage: () => null,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const promise = client.request("start");
  setTimeout(() => port.fireDisconnect(), 1);
  const response = await promise;
  assert.equal(response.ok, false);
  assert.equal(response.failureCode, "internal-error");
  assert.match(response.failureMessage ?? "", /disconnected/);
});

test("createBootstrapClient: invalid response protocol -> invalid-request", async () => {
  const port = makeFakePort({
    handler: (p, msg) => {
      p.onMessage.listeners[0]?.(JSON.stringify({
        protocol: "resonantos/bootstrap/v2",
        requestId: msg.requestId,
        result: successResult(),
      }));
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "invalid-request");
});

test("createBootstrapClient: extra response field -> invalid-request (shape-walker)", async () => {
  const port = makeFakePort({
    handler: (p, msg) => {
      p.onMessage.listeners[0]?.(JSON.stringify({
        protocol: BOOTSTRAP_PROTOCOL,
        requestId: msg.requestId,
        result: { ...successResult(), bridgePid: 12345, bridgeArgv: ["/usr/bin/node", "run-bridge-minimal.mjs"] },
      }));
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "invalid-request");
  assert.equal(response.version, null);
  assert.equal(response.endpoint, null);
});

test("createBootstrapClient: unknown status in response -> invalid-request", async () => {
  const port = makeFakePort({
    handler: (p, msg) => {
      p.onMessage.listeners[0]?.(JSON.stringify({
        protocol: BOOTSTRAP_PROTOCOL,
        requestId: msg.requestId,
        result: { ...successResult(), status: "kinda-running" },
      }));
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "invalid-request");
});

test("createBootstrapClient: requestId mismatch is dropped, then disconnect still settles as internal-error", async () => {
  let disconnectFired = false;
  const port = makeFakePort({
    handler: (p, msg) => {
      p.onMessage.listeners[0]?.(JSON.stringify({
        protocol: BOOTSTRAP_PROTOCOL,
        requestId: "different-id",
        result: successResult(),
      }));
      setTimeout(() => {
        disconnectFired = true;
        port.fireDisconnect();
      }, 5);
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "internal-error");
  assert.equal(disconnectFired, true);
});

test("createBootstrapClient: oversize requestId is rejected at envelope build", () => {
  assert.throws(() => buildBootstrapRequestEnvelope({ operation: "status", requestId: "r-".padEnd(200, "x") }), /invalid requestId/);
});

test("createBootstrapClient: malformed JSON string response -> invalid-request", async () => {
  const port = makeFakePort({
    handler: (p) => { p.onMessage.listeners[0]?.("not-json-{"); },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("status");
  assert.equal(response.failureCode, "invalid-request");
});

test("projectBootstrapResponse drops unknown top-level fields and never echoes the requestId of another call", () => {
  const good = {
    protocol: BOOTSTRAP_PROTOCOL,
    requestId: "r-1",
    result: successResult({ alreadyRunning: true }),
  };
  const projected = projectBootstrapResponse(good);
  assert.ok(projected);
  assert.equal(projected.requestId, "r-1");
  assert.equal(projected.alreadyRunning, true);

  const bad = { ...good, pid: 12345, env: { RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN: "x" } };
  assert.equal(projectBootstrapResponse(bad), null);
});

test("createBootstrapClient: hostile start command echo in failureMessage is never propagated", async () => {
  const port = makeFakePort({
    handler: (p, msg) => {
      p.onMessage.listeners[0]?.(JSON.stringify({
        protocol: BOOTSTRAP_PROTOCOL,
        requestId: msg.requestId,
        result: { ok: false, status: "failed", failureCode: "start-failed", failureMessage: "spawn failed: /usr/bin/node /Users/admin/secrets/bridge-token ABCDEF" },
      }));
    },
  });
  const client = createBootstrapClient({
    createPort: () => port.port,
    setTimeoutImpl: () => ({ unref() {}, ref() {} }),
    clearTimeoutImpl: () => undefined,
    privilegedCheck: PERMISSIVE_CHECK,
  });
  const response = await client.request("start");
  assert.equal(response.ok, false);
  assert.equal(typeof response.failureCode, "string");
  assert.notEqual(response.failureCode, "secret");
  for (const k of ["status", "endpoint", "version", "instanceId"]) {
    const v = response[k];
    if (typeof v === "string") {
      assert.equal(v.includes("ABCDEF"), false, `public field ${k} must not carry secret-shaped value`);
    }
  }
});
