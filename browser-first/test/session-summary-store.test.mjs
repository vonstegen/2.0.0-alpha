import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_SUMMARY_ARTIFACT_KEY,
  deleteSessionSummaryArtifact,
  loadSessionSummaryArtifact,
  saveSessionSummaryArtifact
} from "../resonantos-side-panel-extension/src/lib/session-summary-store.js";
import { buildSessionSummaryArtifact } from "../resonantos-side-panel-extension/src/lib/session-summary-artifact.js";

// A chrome.storage.local mock backed by an in-memory map (the real API persists
// across reloads; this mock proves the round-trip + deletion contract).
function createChromeMock() {
  const store = new Map();
  return {
    storage: {
      local: {
        async get(key) {
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(patch) {
          for (const [key, value] of Object.entries(patch)) store.set(key, value);
        },
        async remove(key) {
          store.delete(key);
        }
      }
    },
    _store: store
  };
}

test("saveSessionSummaryArtifact persists the artifact under the canonical key", async () => {
  const chrome = createChromeMock();
  const artifact = buildSessionSummaryArtifact({ included: [{ title: "A", url: "https://a.test/" }], summary: "notes" });

  const saved = await saveSessionSummaryArtifact(chrome, artifact);
  assert.equal(saved, true);
  assert.ok(chrome._store.has(SESSION_SUMMARY_ARTIFACT_KEY));
});

test("loadSessionSummaryArtifact restores a saved artifact (restart round-trip)", async () => {
  const chrome = createChromeMock();
  const artifact = buildSessionSummaryArtifact({
    included: [{ title: "Alpha", url: "https://alpha.test/" }, { title: "Beta", url: "https://beta.test/" }],
    skipped: [{ title: "Internal", url: "chrome://settings/", reason: "not a readable web page" }],
    summary: "session notes",
    generatedAt: "2026-08-19T12:00:00.000Z"
  });
  await saveSessionSummaryArtifact(chrome, artifact);

  // A fresh load (simulating an extension reload) restores the same artifact.
  const restored = await loadSessionSummaryArtifact(chrome);
  assert.equal(restored.kind, "session-summary");
  assert.equal(restored.included.length, 2);
  assert.equal(restored.skipped.length, 1);
  assert.equal(restored.generatedAt, "2026-08-19T12:00:00.000Z");
});

test("loadSessionSummaryArtifact returns null when nothing is stored or the kind is wrong", async () => {
  const chrome = createChromeMock();
  assert.equal(await loadSessionSummaryArtifact(chrome), null);
  await chrome.storage.local.set({ [SESSION_SUMMARY_ARTIFACT_KEY]: { kind: "other" } });
  assert.equal(await loadSessionSummaryArtifact(chrome), null);
});

test("deleteSessionSummaryArtifact removes the artifact and the deletion persists across a reload", async () => {
  const chrome = createChromeMock();
  const artifact = buildSessionSummaryArtifact({ included: [{ title: "A", url: "https://a.test/" }] });
  await saveSessionSummaryArtifact(chrome, artifact);
  assert.ok(await loadSessionSummaryArtifact(chrome));

  const removed = await deleteSessionSummaryArtifact(chrome);
  assert.equal(removed, true);
  // A fresh load (simulating restart) honors the deletion — storage is the source of truth.
  assert.equal(await loadSessionSummaryArtifact(chrome), null);
});

test("store functions degrade safely without chrome.storage.local", async () => {
  assert.equal(await saveSessionSummaryArtifact({}, {}), false);
  assert.equal(await loadSessionSummaryArtifact({}), null);
  assert.equal(await deleteSessionSummaryArtifact({}), false);
});
