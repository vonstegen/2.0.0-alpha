import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWikiLint } from "../host/memory-wiki-lint.mjs";

test("wiki lint writes a durable review artifact and appends wiki log entry", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-wiki-lint-"));
  const wikiRoot = path.join(memoryRoot, "AI_MEMORY", "wiki");
  await mkdir(wikiRoot, { recursive: true });
  await writeFile(path.join(wikiRoot, "index.md"), "# Index\n\n- [[claim]]\n");
  await writeFile(path.join(wikiRoot, "log.md"), "## [2026-05-30] ingest | seed\n");
  await writeFile(path.join(wikiRoot, "claim.md"), "# Claim\n\nThis open question needs verification.\n");
  try {
    const result = await runWikiLint({
      memoryRoot,
      actor: "test-runner",
      reason: "deterministic lint test",
      now: "2026-05-31T12:00:00.000Z",
    });
    assert.equal(result.ok, true);
    assert.equal(result.relativeArtifactPath, "REVIEW/lint/wiki-lint-2026-05-31T12-00-00-000Z.md");
    assert.equal(result.logAppended, true);
    assert.equal(existsSync(result.artifactPath), true);
    const artifact = await readFile(result.artifactPath, "utf8");
    assert.match(artifact, /kind: wiki-lint-report/);
    assert.match(artifact, /deterministic lint test/);
    assert.match(artifact, /missing-provenance/);
    assert.match(artifact, /open-questions-or-contradictions/);
    assert.match(artifact, /does not modify trusted AI Memory pages/);
    const log = await readFile(path.join(wikiRoot, "log.md"), "utf8");
    assert.match(log, /\[2026-05-31T12:00:00\.000Z\] lint \| Wiki health/);
    assert.match(log, /artifact: REVIEW\/lint\/wiki-lint-2026-05-31T12-00-00-000Z\.md/);
  } finally {
    await rm(memoryRoot, { recursive: true, force: true });
  }
});

test("wiki lint reports a missing log without creating one", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-wiki-lint-no-log-"));
  const wikiRoot = path.join(memoryRoot, "AI_MEMORY", "wiki");
  const logPath = path.join(wikiRoot, "log.md");
  await mkdir(wikiRoot, { recursive: true });
  await writeFile(path.join(wikiRoot, "index.md"), "# Index\n\n- [[claim]]\n");
  await writeFile(path.join(wikiRoot, "claim.md"), "# Claim\n\nSource-backed claim.\n\nSource: seed.md\n");
  try {
    const result = await runWikiLint({
      memoryRoot,
      actor: "test-runner",
      reason: "missing log should stay visible",
      now: "2026-05-31T12:15:00.000Z",
    });
    assert.equal(result.ok, true);
    assert.equal(result.health.exists, true);
    assert.equal(result.logAppended, false);
    assert.equal(existsSync(logPath), false);
    assert.equal(result.health.issues.some((issue) => issue.type === "missing-log"), true);
    const artifact = await readFile(result.artifactPath, "utf8");
    assert.match(artifact, /missing-log/);
    assert.match(artifact, /missing log should stay visible/);
  } finally {
    await rm(memoryRoot, { recursive: true, force: true });
  }
});

test("wiki lint still writes an artifact when the wiki root is missing", async () => {
  const memoryRoot = await mkdtemp(path.join(os.tmpdir(), "resonantos-wiki-lint-missing-"));
  try {
    const result = await runWikiLint({
      memoryRoot,
      now: "2026-05-31T12:30:00.000Z",
    });
    assert.equal(result.ok, true);
    assert.equal(result.health.exists, false);
    assert.equal(result.logAppended, false);
    assert.equal(existsSync(result.artifactPath), true);
    const artifact = await readFile(result.artifactPath, "utf8");
    assert.match(artifact, /AI_MEMORY\/wiki missing/);
    assert.match(artifact, /missing-wiki-root/);
  } finally {
    await rm(memoryRoot, { recursive: true, force: true });
  }
});
