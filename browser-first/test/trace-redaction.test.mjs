import test from "node:test";
import assert from "node:assert/strict";

import { redactTraceText } from "../resonantos-side-panel-extension/src/lib/trace-redaction.js";

test("redactTraceText redacts secret URL query parameters and preserves benign ones", () => {
  const input = "https://example.test/login?token=abc123&email=a@b.com&api_key=sekrit&ref=home";
  const output = redactTraceText(input);
  assert.equal(output, "https://example.test/login?token=REDACTED&email=a@b.com&api_key=REDACTED&ref=home");
});

test("redactTraceText redacts secret assignment forms", () => {
  assert.equal(redactTraceText("password=hunter2secret"), "password=REDACTED");
  assert.equal(redactTraceText("password: hunter2secret"), "password: REDACTED");
  assert.equal(redactTraceText("password:hunter2secret"), "password:REDACTED");
  assert.equal(redactTraceText("api_key = super-secret-value"), "api_key = REDACTED");
  assert.equal(redactTraceText("pin: 9876"), "pin: REDACTED");
  assert.equal(redactTraceText("otp is 123456"), "otp is 123456");
});

test("redactTraceText redacts the token following a Bearer scheme", () => {
  const bearer = redactTraceText("Token: Bearer abc123");
  assert.match(bearer, /Token: REDACTED/);
  assert.doesNotMatch(bearer, /Bearer/);
  assert.doesNotMatch(bearer, /abc123/);
  const authorization = redactTraceText("Authorization: Bearer eyJhbGci.payload.signature-x");
  assert.match(authorization, /Authorization: REDACTED/);
  assert.doesNotMatch(authorization, /Bearer/);
  assert.doesNotMatch(authorization, /eyJhbGci/);
});

test("redactTraceText redacts session, sid, csrf, key, and code assignments", () => {
  assert.equal(redactTraceText("session=abc123def"), "session=REDACTED");
  assert.equal(redactTraceText("sid: s-778899"), "sid: REDACTED");
  assert.equal(redactTraceText("csrf=t0k3n-v4lue"), "csrf=REDACTED");
  assert.equal(redactTraceText("key = private-key-material"), "key = REDACTED");
  assert.equal(redactTraceText("code: 84h2k9"), "code: REDACTED");
  const oauth = redactTraceText("https://a.test/cb?code=4/0AbCdEf&state=xyz");
  assert.match(oauth, /code=REDACTED/);
  assert.doesNotMatch(oauth, /4\/0AbCdEf/);
});

test("redactTraceText redacts secrets inside percent-encoded nested URLs", () => {
  const nested = redactTraceText("https://a.test/login?next=https%3A%2F%2Fb.com%2F%3Ftoken%3Dabc123");
  assert.match(nested, /%3Ftoken%3DREDACTED/i);
  assert.doesNotMatch(nested, /abc123/);
  const chained = redactTraceText("?return=https%3A%2F%2Fc.com%2Fpage%3Fa%3D1%26api_key%3Dsekrit99%26b%3D2");
  assert.match(chained, /%26api_key%3DREDACTED/i);
  assert.doesNotMatch(chained, /sekrit99/);
  assert.match(chained, /%26b%3D2/i);
});

test("redactTraceText redacts full assignment values through commas and semicolons", () => {
  assert.equal(redactTraceText("password=abc,defsecret"), "password=REDACTED");
  assert.equal(redactTraceText("token: v1;part2;part3 done"), "token: REDACTED done");
  assert.doesNotMatch(redactTraceText("secret=left,right tail"), /right/);
});

test("redactTraceText redacts long hex tokens and preserves short hex and normal text", () => {
  const longHex = "7f3c9a1b2d4e5f68790a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f";
  assert.equal(redactTraceText(`token ${longHex} end`), "token [REDACTED-TOKEN] end");
  assert.equal(redactTraceText("color #f3c9a1"), "color #f3c9a1");
  assert.equal(redactTraceText("the quick brown fox"), "the quick brown fox");
});

test("redactTraceText returns an empty string for non-string input", () => {
  assert.equal(redactTraceText(undefined), "");
  assert.equal(redactTraceText(null), "");
  assert.equal(redactTraceText(42), "");
  assert.equal(redactTraceText({ token: "abc" }), "");
});

test("redactTraceText leaves clean trace text unchanged", () => {
  const clean = [
    "# Browser Job Report",
    "- status: completed",
    "1. Read page - ok - read product page",
    "## Boundary",
    "Intake artifact only."
  ].join("\n");
  assert.equal(redactTraceText(clean), clean);
});
