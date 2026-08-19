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

test("redactSecrets strips provider keys, tokens, api_key/token/secret/password, and wallet private keys", () => {
  assert.equal(redactSecrets("key is sk-testtesttesttesttesttest here"), "key is [redacted] here");
  assert.equal(redactSecrets("auth: bearer abc.def-ghi"), "auth: [redacted]");
  assert.match(redactSecrets("api_key=abc123 secret=xyz token=t1 password=p1"), /\[redacted\].*\[redacted\].*\[redacted\].*\[redacted\]/);
  assert.equal(redactSecrets("wallet 0x" + "a".repeat(64)), "wallet [redacted]");
  // Non-secret text is preserved.
  assert.equal(redactSecrets("plain notes with no secrets"), "plain notes with no secrets");
  assert.equal(redactSecrets(undefined), "");
});

test("buildSessionSummaryArtifact redacts secrets embedded in the summary before persistence", () => {
  const artifact = buildSessionSummaryArtifact({ summary: "leaked sk-testtesttesttesttesttest key" });
  assert.match(artifact.summary, /\[redacted\]/);
  assert.equal(artifact.summary.includes("sk-testtesttesttesttesttest"), false);
});

test("buildSessionSummaryArtifact redacts query-string secrets in tab urls and titles before persistence", () => {
  const artifact = buildSessionSummaryArtifact({
    included: [{ title: "Doc api_key=LEAKED_TITLE", url: "https://x.test/p?token=sk-testtesttesttesttesttest&foo=bar" }],
    skipped: [{ title: "T", url: "https://y.test/?api_key=TESTKEYZ&v=1", reason: "redirect with password=testpassword0" }]
  });
  assert.equal(artifact.included[0].url.includes("sk-testtesttesttesttesttest"), false);
  assert.equal(artifact.included[0].url.includes("token="), false);
  assert.equal(artifact.included[0].url.includes("foo=bar"), true);
  assert.equal(artifact.included[0].title.includes("LEAKED_TITLE"), false);
  assert.equal(artifact.included[0].title.includes("[redacted]"), true);
  assert.equal(artifact.skipped[0].url.includes("api_key="), false);
  assert.equal(artifact.skipped[0].url.includes("v=1"), true);
  assert.equal(artifact.skipped[0].reason.includes("testpassword0"), false);
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
