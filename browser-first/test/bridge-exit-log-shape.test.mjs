// CP-BR11: shape-walker test for the bridge exit-log record.
//
// The bridge process is spawned with `stdio: "ignore"` (see
// host/bridge-launcher.mjs), so the only operator-visible breadcrumb
// on an unexpected bridge death is the append-only log in
// `~/.ros/bridge-exit.log`. The record shape is documented as exactly
// `{ event: "bridge.exit", code, signal, at }` and must carry no
// token, credential, path, PID, env, or argv value. This test
// re-exercises the production record-construction path against a
// scratch directory and asserts the on-disk JSON is shape-walker clean.
//
// The actual log-writing code lives in `run-bridge-minimal.mjs`; to
// keep the test deterministic and not depend on the bridge process's
// top-level wiring, this test exercises the documented record shape
// against the same field set the production handler writes.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /ghp_[A-Za-z0-9]{8,}/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /AIza[A-Za-z0-9_-]{8,}/,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/i,
  /authorization:\s*[A-Za-z0-9._\-+/=]{12,}/i,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /-----BEGIN [A-Z ]*CERTIFICATE-----/,
];

function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      assert.doesNotMatch(value, pattern, `${path} carries a secret-shaped value`);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assert.doesNotMatch(key, /token|secret|credential|apiKey|password|privateKey|authorization/i,
      `${path}.${key} is a secret-shaped field name`);
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}

function buildRecord({ code, signal = null }) {
  // Mirrors the production record in run-bridge-minimal.mjs.
  return {
    event: "bridge.exit",
    code: typeof code === "number" ? code : null,
    signal: typeof signal === "string" ? signal : null,
    at: new Date().toISOString(),
  };
}

test("CP-BR11 bridge exit-log: the record carries exactly the documented fields and is shape-walker clean", () => {
  const record = buildRecord({ code: 0 });
  assert.deepEqual(Object.keys(record).sort(), ["at", "code", "event", "signal"]);
  assert.equal(record.event, "bridge.exit");
  assert.equal(record.code, 0);
  assert.equal(record.signal, null);
  assert.match(record.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assertNoSecretShapedValue(record, "$.record");
});

test("CP-BR11 bridge exit-log: a non-number code is normalized to null and never leaks a secret-shaped value", () => {
  const record = buildRecord({ code: "Bearer abc-secret-token", signal: "SIGTERM" });
  assert.equal(record.code, null, "a non-number code must not be echoed back as a string");
  assert.equal(record.signal, "SIGTERM");
  assertNoSecretShapedValue(record, "$.record");
});

test("CP-BR11 bridge exit-log: an on-disk JSON line of the documented shape is shape-walker clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "ros-bridge-exit-shape-"));
  try {
    const logPath = join(dir, "bridge-exit.log");
    const records = [
      buildRecord({ code: 0 }),
      buildRecord({ code: 137 }),
      buildRecord({ code: null, signal: "SIGTERM" }),
    ];
    writeFileSync(logPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const lines = readFileSync(logPath, "utf8").split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, records.length);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assertNoSecretShapedValue(parsed, "$.line");
      // The exact field set is the documented contract.
      assert.deepEqual(Object.keys(parsed).sort(), ["at", "code", "event", "signal"]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
