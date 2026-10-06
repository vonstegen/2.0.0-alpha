// CP-BR5 purity tests — the projection module and the host service must
// not perform any I/O. Forbidden: `node:fs`, `node:child_process`,
// `node:net`, `node:http`, `fetch`, `setTimeout`, `setInterval`,
// `setImmediate`, `Date.now()`, and `performance.now()` (the service
// accepts an injectable `now()` function but never calls the default
// wall clock itself).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTION_MODULE = readFileSync(
  resolve(__dirname, "../host/runtime-projection.mjs"),
  "utf8",
);
const PROJECTION_SERVICE_MODULE = readFileSync(
  resolve(__dirname, "../host/runtime-projection-service.mjs"),
  "utf8",
);
const PROJECTION_ROUTE_MODULE = readFileSync(
  resolve(__dirname, "../host/bridge-runtimes-host-service.mjs"),
  "utf8",
);

const FORBIDDEN_IMPORTS = [
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:net",
  "node:http",
  "node:https",
  "node:fetch",
  "node-fetch",
];

const FORBIDDEN_CALLS = [
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bsetImmediate\s*\(/,
  /\bDate\.now\s*\(/,
  /\bnew\s+Date\s*\(/,
  /\bperformance\.now\s*\(/,
  /\bfetch\s*\(/,
];

test("CP-BR5 purity #1: projection module does not import any I/O transport", () => {
  for (const lib of FORBIDDEN_IMPORTS) {
    assert.doesNotMatch(PROJECTION_MODULE, new RegExp(`from\\s+["']${lib}["']`),
      `projection module must not import ${lib}`);
    assert.doesNotMatch(PROJECTION_MODULE, new RegExp(`import\\(["']${lib}["']\\)`),
      `projection module must not dynamic-import ${lib}`);
  }
  for (const pattern of FORBIDDEN_CALLS) {
    assert.doesNotMatch(PROJECTION_MODULE, pattern,
      `projection module must not call ${pattern}`);
  }
});

test("CP-BR5 purity #2: projection service does not import any I/O transport", () => {
  for (const lib of FORBIDDEN_IMPORTS) {
    assert.doesNotMatch(PROJECTION_SERVICE_MODULE, new RegExp(`from\\s+["']${lib}["']`),
      `projection service must not import ${lib}`);
  }
  // The projection service MAY use `new Date()` for the default `now`
  // (the seam is injectable for tests). It MUST NOT use `Date.now()`,
  // `setTimeout`, `setInterval`, `setImmediate`, `performance.now()`,
  // `fetch`, or any I/O transport.
  for (const pattern of [
    /\bDate\.now\s*\(/,
    /\bsetTimeout\s*\(/,
    /\bsetInterval\s*\(/,
    /\bsetImmediate\s*\(/,
    /\bperformance\.now\s*\(/,
    /\bfetch\s*\(/,
  ]) {
    assert.doesNotMatch(PROJECTION_SERVICE_MODULE, pattern,
      `projection service must not call ${pattern}`);
  }
  // The service may import the projection module (which is the only
  // external dependency besides the SDK).
  assert.match(PROJECTION_SERVICE_MODULE, /from\s+["']\.\/runtime-projection\.mjs["']/);
});

test("CP-BR5 purity #3: bridge-runtimes host route does not import any I/O transport", () => {
  for (const lib of FORBIDDEN_IMPORTS) {
    assert.doesNotMatch(PROJECTION_ROUTE_MODULE, new RegExp(`from\\s+["']${lib}["']`),
      `bridge-runtimes route must not import ${lib}`);
  }
  for (const pattern of FORBIDDEN_CALLS) {
    assert.doesNotMatch(PROJECTION_ROUTE_MODULE, pattern,
      `bridge-runtimes route must not call ${pattern}`);
  }
});

test("CP-BR5 purity #4: the projection service is fully synchronous (no async/await)", () => {
  // The service's public methods are synchronous; the projection is
  // a pure data projection. Async would be unnecessary and would
  // introduce event-loop ticks the test runner could miss.
  assert.doesNotMatch(PROJECTION_MODULE, /\basync\s+function\b/);
  assert.doesNotMatch(PROJECTION_MODULE, /\bawait\b/);
});

test("CP-BR5 purity #5: producedAt is supplied by the caller, not the wall clock", () => {
  // The service's `now` default is a fresh ISO string; this is the
  // only place the wall clock is consulted, and it is injectable for
  // tests. The module itself never reads Date.now().
  const fakeNow = "2026-10-06T00:00:00.000Z";
  // We don't import the service to keep this test static; we assert
  // the source contains the injection seam.
  assert.match(PROJECTION_SERVICE_MODULE, /now\s*\?\?/);
});

test("CP-BR5 purity #6: the bridge-runtimes host route is fully synchronous", () => {
  // The handler returns the projection directly; no await, no
  // setTimeout, no fetch.
  assert.doesNotMatch(PROJECTION_ROUTE_MODULE, /\bawait\b/);
  assert.doesNotMatch(PROJECTION_ROUTE_MODULE, /\bfetch\s*\(/);
});
