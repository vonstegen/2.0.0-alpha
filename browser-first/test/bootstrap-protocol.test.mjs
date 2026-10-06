// CP-BR1: bootstrap protocol envelope validation + public result projection.
//
// Covers:
//   * Unknown fields rejected with closed "invalid-request"
//   * Unsupported protocol versions rejected
//   * Non-object / arrays / null / scalars rejected
//   * Unknown operations rejected
//   * requestId bounds (1..128 chars, string only)
//   * Public projection whitelist: only documented fields leak through,
//     non-primitive values are dropped, status/failureCode vocabularies
//     are closed, no PID/path/env/token/argv/secret/private-key fields.

import assert from "node:assert/strict";
import test from "node:test";

const {
  BOOTSTRAP_OPERATIONS,
  PUBLIC_FAILURE_CODES,
  PUBLIC_STATUS_VALUES,
  buildErrorResponse,
  buildSuccessResponse,
  projectPublicResult,
  validateBootstrapRequest,
} = await import("../bootstrap/bootstrap-protocol.mjs");
const { BOOTSTRAP_PROTOCOL } = await import("../bootstrap/bridge-policy.mjs");

const baseValid = (overrides = {}) => ({
  protocol: BOOTSTRAP_PROTOCOL,
  requestId: "r-1",
  operation: "status",
  ...overrides,
});

test("validate accepts every documented operation", () => {
  for (const op of BOOTSTRAP_OPERATIONS) {
    const result = validateBootstrapRequest({ protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: op }, { protocol: BOOTSTRAP_PROTOCOL });
    assert.equal(result.ok, true);
    assert.equal(result.request.operation, op);
  }
});

test("validate rejects every caller-controlled process input by exact-shape rule", () => {
  const hostile = [
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", command: "/bin/echo" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", argv: ["--bridge-port=1"] },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", cwd: "/tmp" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", path: "/etc/passwd" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", entry: "/tmp/x.mjs" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", endpoint: "http://10.0.0.1:9999" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", env: { OPENAI_API_KEY: "sk-leak" } },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", token: "Bearer leak" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", secret: "shhh" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", bridgeConfig: { url: "http://example/" } },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", pid: 12345 },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "start", exec: { command: "/bin/echo" } },
  ];
  for (const value of hostile) {
    const result = validateBootstrapRequest(value, { protocol: BOOTSTRAP_PROTOCOL });
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.equal(result.failureCode, "invalid-request");
  }
});

test("validate rejects arrays, null, scalars, and unsupported protocols", () => {
  for (const value of [
    [],
    null,
    "start",
    42,
    { protocol: "resonantos/bootstrap/v2", requestId: "r1", operation: "status" },
    { protocol: "resonantos/bootstrap", requestId: "r1", operation: "status" },
    { protocol: 1, requestId: "r1", operation: "status" },
  ]) {
    const result = validateBootstrapRequest(value, { protocol: BOOTSTRAP_PROTOCOL });
    assert.equal(result.ok, false);
    assert.equal(result.failureCode, "invalid-request");
  }
});

test("validate rejects missing fields, wrong-type fields, and bad requestId", () => {
  for (const value of [
    { protocol: BOOTSTRAP_PROTOCOL, operation: "status" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1" },
    { requestId: "r1", operation: "status" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "", operation: "status" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r".repeat(129), operation: "status" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: 1, operation: "status" },
    { protocol: BOOTSTRAP_PROTOCOL, requestId: "r1", operation: "nope" },
  ]) {
    const result = validateBootstrapRequest(value, { protocol: BOOTSTRAP_PROTOCOL });
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.equal(result.failureCode, "invalid-request");
  }
});

test("validate accepts requestId at exactly 128 characters", () => {
  const value = { protocol: BOOTSTRAP_PROTOCOL, requestId: "r".repeat(128), operation: "status" };
  const result = validateBootstrapRequest(value, { protocol: BOOTSTRAP_PROTOCOL });
  assert.equal(result.ok, true);
});

test("projection whitelist drops private fields, non-primitive values, and unknown vocabulary", () => {
  const internal = {
    status: "connected",
    version: "2.0.0",
    endpoint: "http://127.0.0.1:47773",
    instanceId: "g3-ab12cd34",
    startedAt: "2026-10-06T00:00:00.000Z",
    alreadyRunning: false,
    failureCode: "start-failed",
    // Private fields that must be dropped:
    pid: 12345,
    child: { secret: "k" },
    argv: ["--bridge-port=1"],
    env: { OPENAI_API_KEY: "sk-leak" },
    path: "/Users/host/secret",
    error: new Error("contains private stack"),
    nested: { token: "Bearer leak" },
    nonSecret: { /* empty */ },
  };
  const out = projectPublicResult(internal);
  assert.deepEqual(Object.keys(out).sort(), [
    "alreadyRunning",
    "endpoint",
    "failureCode",
    "instanceId",
    "startedAt",
    "status",
    "version",
  ].sort());
  assert.equal(out.failureCode, "start-failed");
});

test("projection coerces unknown status to 'failed' and drops unknown failure codes", () => {
  const out = projectPublicResult({ status: "rainbow", failureCode: "magic" });
  assert.equal(out.status, "failed");
  assert.equal(out.failureCode, undefined);
});

test("buildSuccessResponse and buildErrorResponse carry only the envelope + projected result", () => {
  const ok = buildSuccessResponse({
    protocol: BOOTSTRAP_PROTOCOL,
    requestId: "r1",
    result: { status: "offline", endpoint: "http://127.0.0.1:47773", pid: 9999 },
  });
  assert.equal(ok.protocol, BOOTSTRAP_PROTOCOL);
  assert.equal(ok.requestId, "r1");
  assert.equal(ok.ok, true);
  assert.equal(ok.result.pid, undefined);

  const err = buildErrorResponse({
    protocol: BOOTSTRAP_PROTOCOL,
    requestId: "r2",
    failureCode: "start-failed",
    result: { status: "failed", endpoint: "http://127.0.0.1:47773", error: "boom" },
  });
  assert.equal(err.ok, false);
  assert.equal(err.failureCode, "start-failed");
  assert.equal(err.result.failureCode, "start-failed");
  assert.equal(err.result.error, undefined);
});

test("buildErrorResponse substitutes 'internal-error' when no closed code is provided", () => {
  const err = buildErrorResponse({ protocol: BOOTSTRAP_PROTOCOL, requestId: "r3", failureCode: "rainbow", result: { status: "failed" } });
  assert.equal(err.failureCode, "internal-error");
});

test("vocabularies are the documented closed lists", () => {
  assert.deepEqual([...PUBLIC_STATUS_VALUES].sort(), [
    "connected", "degraded", "failed", "offline", "restarting", "starting",
  ]);
  assert.deepEqual([...PUBLIC_FAILURE_CODES].sort(), [
    "health-timeout", "internal-error", "invalid-request",
    "restart-failed", "start-failed", "stop-failed",
    "unexpected-exit", "version-mismatch",
  ]);
});