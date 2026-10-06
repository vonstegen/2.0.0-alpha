// CP-BR1: native-host main entry tests.
//
// Drives the host with fake stdio and a fake lifecycle (plus one
// end-to-end test using a real lifecycle against dead ports). Asserts:
//   * Status requests round-trip with the documented envelope and
//     projected public result.
//   * Malformed JSON, unknown fields, arrays, null, wrong protocol,
//     and unsupported operations all return invalid-request with
//     requestId null (or echoed when known).
//   * Oversized declared inbound length triggers the terminal
//     decoder error and exits with code 2.
//   * stdout contains only framed protocol messages.
//   * stderr contains no caller-supplied request payload or secrets.
//   * The fixture remains callable with no bridge HTTP server running.

import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

const {
  BOOTSTRAP_PROTOCOL,
  createBridgePolicy,
} = await import("../bootstrap/bridge-policy.mjs");
const {
  createStdoutFramer,
  createFrameDecoder,
  encodeFrame,
} = await import("../bootstrap/native-framing.mjs");
const {
  runBootstrapNativeHost,
  createStderrLogger,
} = await import("../bootstrap/native-host-main.mjs");
const {
  createBootstrapLifecycle,
} = await import("../bootstrap/bootstrap-lifecycle.mjs");

class FakeStdout extends EventEmitter {
  constructor() {
    super();
    this.writes = [];
    this.backpressure = false;
  }
  write(chunk) {
    this.writes.push(chunk);
    if (this.backpressure) {
      this.backpressure = false;
      return false;
    }
    return true;
  }
  once(event, listener) { return super.once(event, listener); }
}

function parseCapturedFrames(writes) {
  const buf = Buffer.concat(writes);
  const out = [];
  let p = 0;
  while (p + 4 <= buf.length) {
    const len = buf.readUInt32LE(p);
    if (len > 1024 * 1024) throw new Error("oversized captured frame");
    p += 4;
    if (p + len > buf.length) break;
    out.push(JSON.parse(buf.subarray(p, p + len).toString("utf8")));
    p += len;
  }
  return { frames: out, leftoverBytes: buf.length - p };
}

function setup({ lifecycle, policy = createBridgePolicy({ nodeExecutable: "/pinned/node" }) } = {}) {
  const stdin = new EventEmitter();
  stdin.resume = () => {};
  const stdout = new FakeStdout();
  const stderr = new EventEmitter();
  const writes = [];
  stderr.write = (chunk) => { writes.push(String(chunk)); return true; };
  stderr.writes = writes;
  const exits = [];
  const exitImpl = (code) => { exits.push(code); };
  const result = runBootstrapNativeHost({
    stdin, stdout, stderr, lifecycle, policy, exitImpl,
  });
  return { stdin, stdout, stderr, exits, host: result, policy };
}

function sendFramed(stdin, payload) {
  stdin.emit("data", encodeFrame(payload));
}

const hostileRequestId = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhdHRhY2tlciJ9.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa PATH=/Users/attacker/sk-mac-BG12345";
const hostileStderrBlacklist = ["Bearer", "sk-", "/Users/", "secret", "OPENAI_API_KEY"];

test("status request round-trips with the documented envelope + projected result", async () => {
  const lifecycle = {
    status: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    start: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout, stderr } = setup({ lifecycle });
  sendFramed(stdin, { protocol: BOOTSTRAP_PROTOCOL, requestId: "r-1", operation: "status" });
  // Wait for the serialized dispatch chain to flush.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames, leftoverBytes } = parseCapturedFrames(stdout.writes);
  assert.equal(leftoverBytes, 0, "every stdout byte is accounted for in framed responses");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].protocol, BOOTSTRAP_PROTOCOL);
  assert.equal(frames[0].requestId, "r-1");
  assert.equal(frames[0].ok, true);
  assert.deepEqual(frames[0].result, { status: "offline", endpoint: "http://127.0.0.1:47773" });
  // stderr contains only event codes + operation; no caller payload.
  const stderrText = stderr.writes.join("\n");
  assert.ok(!hostileStderrBlacklist.some((needle) => stderrText.includes(needle)), `stderr leaked: ${stderrText}`);
});

test("hostile envelope fields are rejected with invalid-request (requestId null only when JSON is unparseable)", async () => {
  const lifecycle = {
    status: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    start: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout } = setup({ lifecycle });
  sendFramed(stdin, { protocol: BOOTSTRAP_PROTOCOL, requestId: hostileRequestId, operation: "start", command: "/bin/echo" });
  sendFramed(stdin, [1, 2, 3]);
  sendFramed(stdin, null);
  sendFramed(stdin, "start");
  sendFramed(stdin, { protocol: "resonantos/bootstrap/v2", requestId: "r-x", operation: "status" });
  sendFramed(stdin, { protocol: BOOTSTRAP_PROTOCOL, requestId: "r-y", operation: "nope" });
  sendFramed(stdin, encodeFrame("{not json"));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames } = parseCapturedFrames(stdout.writes);
  assert.equal(frames.length, 7, "every invalid input gets exactly one error frame");
  for (const frame of frames) {
    assert.equal(frame.ok, false);
    assert.equal(frame.failureCode, "invalid-request");
  }
  // Parseable objects echo their requestId; non-object and unparseable JSON get null.
  assert.equal(frames[0].requestId, hostileRequestId);
  assert.equal(frames[1].requestId, null); // array
  assert.equal(frames[2].requestId, null); // null
  assert.equal(frames[3].requestId, null); // string
  assert.equal(frames[4].requestId, "r-x"); // wrong protocol version
  assert.equal(frames[5].requestId, "r-y"); // unknown operation
  assert.equal(frames[6].requestId, null); // malformed JSON
});

test("malformed JSON frame returns invalid-request (no native stream crash)", async () => {
  const lifecycle = {
    status: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    start: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout } = setup({ lifecycle });
  stdin.emit("data", encodeFrame("{not json"));
  stdin.emit("data", encodeFrame(JSON.stringify({ protocol: BOOTSTRAP_PROTOCOL, requestId: "ok-1", operation: "status" })));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames } = parseCapturedFrames(stdout.writes);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].failureCode, "invalid-request");
  assert.equal(frames[0].requestId, null);
  assert.equal(frames[1].ok, true);
  assert.equal(frames[1].requestId, "ok-1");
});

test("oversized declared frame triggers the terminal decoder error and exits with code 2", async () => {
  const lifecycle = {
    status: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    start: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout, exits } = setup({ lifecycle });
  const oversized = Buffer.alloc(8);
  oversized.writeUInt32LE(2_147_483_648, 0);
  stdin.emit("data", oversized);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits.length, 1);
  assert.equal(exits[0], 2);
  // No framed response is produced; stdout purity preserved.
  assert.equal(stdout.writes.length, 0);
});

test("split frames and a frame straddling two chunks all decode correctly", async () => {
  const lifecycle = {
    status: async () => ({ ok: true, status: "connected", version: null, endpoint: "http://127.0.0.1:47773" }),
    start: async () => ({ ok: true, status: "connected", version: null, endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "connected", version: null, endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "connected", version: null, endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout } = setup({ lifecycle });
  const a = encodeFrame({ protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "status" });
  const b = encodeFrame({ protocol: BOOTSTRAP_PROTOCOL, requestId: "r2", operation: "status" });
  const all = Buffer.concat([a, b]);
  stdin.emit("data", all.subarray(0, a.length - 3));
  stdin.emit("data", all.subarray(a.length - 3));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames, leftoverBytes } = parseCapturedFrames(stdout.writes);
  assert.equal(leftoverBytes, 0);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].requestId, "r1");
  assert.equal(frames[1].requestId, "r2");
});

test("the bootstrap fixture is callable with no bridge HTTP server running", async () => {
  const probe = async () => ({ ok: false, reason: "bridge-not-running", endpoint: "http://127.0.0.1:47773", code: "ECONNREFUSED" });
  const spawnCalls = [];
  const lifecycle = createBootstrapLifecycle({
    policy: createBridgePolicy({ nodeExecutable: "/pinned/node" }),
    probe,
    spawnImpl: (...args) => {
      spawnCalls.push(args);
      const child = new EventEmitter();
      child.pid = 4242;
      child.unref = () => {};
      child.kill = () => true;
      return child;
    },
    delayImpl: async () => undefined,
    nowImpl: () => 0,
  });
  const { stdin, stdout } = setup({ lifecycle });
  sendFramed(stdin, { protocol: BOOTSTRAP_PROTOCOL, requestId: "r-status", operation: "status" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames } = parseCapturedFrames(stdout.writes);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ok, true);
  assert.equal(frames[0].result.status, "offline");
  assert.equal(spawnCalls.length, 0, "status never spawns");
});

test("stderr logger truncates long lines and never echoes caller payloads", () => {
  const stderr = new EventEmitter();
  const lines = [];
  stderr.write = (line) => { lines.push(String(line)); return true; };
  const log = createStderrLogger({ stderr });
  log("bootstrap.request", { operation: "start", failureCode: hostileRequestId, status: hostileRequestId });
  const text = lines.join("\n");
  assert.ok(text.length < 400 + 2, "stderr line bounded");
  assert.ok(!text.includes("Bearer"));
  assert.ok(!text.includes("/Users/"));
});

test("a hostile lifecycle result never leaks forbidden fields through the response", async () => {
  const lifecycle = {
    status: async () => ({
      ok: true,
      status: "offline",
      endpoint: "http://127.0.0.1:47773",
      pid: 12345,
      path: "/Users/host/secret",
      argv: ["--bridge-port=1"],
      env: { OPENAI_API_KEY: "sk-leak" },
      token: "Bearer leak",
      secret: "shhh",
    }),
    start: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    restart: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
    stopForShutdown: async () => ({ ok: true, status: "offline", endpoint: "http://127.0.0.1:47773" }),
  };
  const { stdin, stdout } = setup({ lifecycle });
  sendFramed(stdin, { protocol: BOOTSTRAP_PROTOCOL, requestId: "r-leak", operation: "status" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const { frames } = parseCapturedFrames(stdout.writes);
  assert.equal(frames.length, 1);
  const serialized = JSON.stringify(frames[0]);
  for (const forbidden of ["Bearer", "/Users/", "sk-leak", "pid", "path", "argv", "env", "token", "secret"]) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `public response leaked "${forbidden}"`);
  }
});