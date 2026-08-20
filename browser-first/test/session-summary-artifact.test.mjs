import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionSummaryArtifact,
  redactSecrets,
  sessionSummaryRestoreLine
} from "../resonantos-side-panel-extension/src/lib/session-summary-artifact.js";

const included = [
  { id: 1, title: "Alpha", url: "https://alpha.test/", text: "raw page text", controls: [{}, {}], fields: [{ value: "secret" }] },
  { id: 2, title: "Beta", url: "https://beta.test/", text: "more raw text", fields: [{ value: "pw" }] }
];
const skipped = [{ title: "Internal", url: "chrome://settings/", reason: "not a readable web page" }];

test("buildSessionSummaryArtifact lists included and skipped tabs with provenance only", () => {
  const artifact = buildSessionSummaryArtifact({ included, skipped, summary: "notes" });

  assert.equal(artifact.kind, "session-summary");
  assert.equal(artifact.trigger, "explicit-command");
  assert.equal(artifact.included.length, 2);
  assert.equal(artifact.included[0].title, "Alpha");
  assert.equal(artifact.included[0].url, "https://alpha.test/");
  assert.equal(artifact.skipped.length, 1);
  assert.equal(artifact.skipped[0].reason, "not a readable web page");
  assert.equal(artifact.skipped[0].url, "chrome://settings/");
});

test("buildSessionSummaryArtifact never persists raw page content (no text/fields/controls)", () => {
  const artifact = buildSessionSummaryArtifact({ included, summary: "notes" });
  for (const tab of artifact.included) {
    assert.equal("text" in tab, false, "no raw text stored");
    assert.equal("controls" in tab, false, "no controls stored");
    assert.equal("fields" in tab, false, "no form fields stored");
  }
  assert.equal("text" in artifact, false, "no raw page text on the artifact");
});

test("redactSecrets redacts Authorization Bearer tokens", () => {
  assert.equal(redactSecrets("Authorization: Bearer abc.def-ghi"), "Authorization: [redacted]");
  assert.equal(redactSecrets("plain notes with no secrets"), "plain notes with no secrets");
  assert.equal(redactSecrets(undefined), "");
});

test("redactSecrets redacts simple URL parameter secrets (token/key/secret/password)", () => {
  // These are in the trace-redaction alternation and are the core blocker
  // resolution for #309. They produce the canonical REDACTED -> [redacted]
  // mapping for the value while preserving the rest of the URL structure.
  assert.equal(redactSecrets("https://idp/?token=ABC123XYZ"), "https://idp/?token=[redacted]");
  assert.equal(redactSecrets("https://idp/?key=ABC123XYZ"), "https://idp/?key=[redacted]");
  assert.equal(redactSecrets("https://idp/?secret=ABC123XYZ"), "https://idp/?secret=[redacted]");
  assert.equal(redactSecrets("https://idp/?password=ABC123XYZ"), "https://idp/?password=[redacted]");
  assert.equal(redactSecrets("https://idp/?api_key=ABC123XYZ&v=1"), "https://idp/?api_key=[redacted]&v=1");
  assert.equal(redactSecrets("https://idp/?access_token=ABC123XYZ"), "https://idp/?access_token=[redacted]");
  assert.equal(redactSecrets("https://idp/?refresh_token=ABC123XYZ"), "https://idp/?refresh_token=[redacted]");
});

test("redactSecrets redacts compound-name URL params the trace redactor missed (the blocker)", () => {
  // Tom's review flagged these: the trace redactor's alternation does not
  // include client_secret / client_id / csrf_token / jwt_token / session_*. The
  // supplemental compound-name layer in session-summary-artifact catches them.
  assert.equal(redactSecrets("https://idp/?client_secret=ABC123XYZ"), "https://idp/?client_secret=[redacted]");
  assert.equal(redactSecrets("https://idp/?client_id=ABC123XYZ"), "https://idp/?client_id=[redacted]");
  assert.equal(redactSecrets("https://idp/?csrf_token=ABC123XYZ"), "https://idp/?csrf_token=[redacted]");
  assert.equal(redactSecrets("https://idp/?jwt_token=ABC123XYZ"), "https://idp/?jwt_token=[redacted]");
  assert.equal(redactSecrets("https://idp/?session_id=ABC123XYZ"), "https://idp/?session_id=[redacted]");
});

test("redactSecrets redacts JSON-quoted compound-name secrets", () => {
  // The supplemental pattern allows an optional `"` between the key and the
  // separator so JSON literals like `{"client_secret":"abc"}` are also caught.
  const out = redactSecrets('body={"client_secret":"abc123def456"}');
  assert.equal(out.includes("abc123def456"), false);
  assert.match(out, /client_secret.{0,3}\[redacted\]/);
});

test("redactSecrets redacts URL-param form of multi-vendor provider keys", () => {
  assert.equal(redactSecrets("https://api/?key=AIzaSyA-EXAMPLE-key-1234567890"), "https://api/?key=[redacted]");
});

test("buildSessionSummaryArtifact redacts URL parameter secrets in tab urls and titles", () => {
  const artifact = buildSessionSummaryArtifact({
    included: [
      { title: "OAuth", url: "https://idp.example/?access_token=ABC123XYZ&scope=read" },
      { title: "Doc", url: "https://x.test/p?client_secret=ABC123XYZ&v=1" }
    ],
    skipped: [{ title: "T", url: "https://y.test/?v=1" }]
  });
  assert.equal(artifact.included[0].url.includes("ABC123XYZ"), false);
  assert.equal(artifact.included[0].url.includes("scope=read"), true);
  assert.equal(artifact.included[1].url.includes("ABC123XYZ"), false);
  assert.equal(artifact.included[1].url.includes("v=1"), true);
  assert.equal(artifact.skipped[0].url.includes("v=1"), true);
});

test("buildSessionSummaryArtifact is deterministic for identical input (modulo generatedAt)", () => {
  const a = buildSessionSummaryArtifact({ included, skipped, summary: "x", generatedAt: "T1" });
  const b = buildSessionSummaryArtifact({ included, skipped, summary: "x", generatedAt: "T1" });
  assert.deepEqual(a, b);
});

test("sessionSummaryRestoreLine restores a short context line from a valid artifact", () => {
  const artifact = buildSessionSummaryArtifact({ included, skipped, generatedAt: "2026-08-19T12:00:00.000Z" });
  const line = sessionSummaryRestoreLine(artifact);
  assert.match(line, /Restored session context from 2026-08-19T12:00:00.000Z/);
  assert.match(line, /2 tab\(s\) included/);
  assert.match(line, /1 skipped/);
});

test("sessionSummaryRestoreLine returns null for a missing or invalid artifact", () => {
  assert.equal(sessionSummaryRestoreLine(null), null);
  assert.equal(sessionSummaryRestoreLine({ kind: "other" }), null);
  assert.equal(sessionSummaryRestoreLine({}), null);
});