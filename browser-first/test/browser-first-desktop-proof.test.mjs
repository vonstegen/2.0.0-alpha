import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

test("desktop proof runner passes only when verification and audit pass", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-proof-"));
  try {
    const bin = path.join(tmp, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "npm"), [
      "#!/bin/sh",
      "if [ \"$2\" = \"browser-first:verify-desktop\" ]; then",
      "  echo '{\"status\":\"ready\",\"step\":\"verify\"}'",
      "  exit 0",
      "fi",
      "if [ \"$2\" = \"browser-first:audit-desktop\" ]; then",
      "  echo '{\"status\":\"ready\",\"step\":\"audit\"}'",
      "  exit 0",
      "fi",
      "echo \"unexpected npm command: $@\" >&2",
      "exit 9",
      ""
    ].join("\n"));
    await chmod(path.join(bin, "npm"), 0o755);

    const { stdout } = await execFileAsync("node", [
      path.join(repoRoot, "scripts", "prove-browser-first-desktop.mjs"),
    ], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    const output = JSON.parse(stdout);

    assert.equal(output.status, "ready");
    assert.deepEqual(output.failedSteps, []);
    assert.deepEqual(output.passedSteps, ["verify-desktop", "audit-desktop"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("desktop proof runner fails when audit fails after verification", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-proof-fail-"));
  try {
    const bin = path.join(tmp, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(path.join(bin, "npm"), [
      "#!/bin/sh",
      "if [ \"$2\" = \"browser-first:verify-desktop\" ]; then",
      "  echo '{\"status\":\"ready\",\"step\":\"verify\"}'",
      "  exit 0",
      "fi",
      "if [ \"$2\" = \"browser-first:audit-desktop\" ]; then",
      "  echo '{\"status\":\"attention\",\"issues\":[\"missing proof\"]}'",
      "  exit 2",
      "fi",
      "exit 9",
      ""
    ].join("\n"));
    await chmod(path.join(bin, "npm"), 0o755);

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "prove-browser-first-desktop.mjs"),
      ], {
        cwd: repoRoot,
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      }),
      (error) => {
        const output = JSON.parse(error.stdout);
        assert.equal(output.status, "attention");
        assert.deepEqual(output.failedSteps, ["audit-desktop"]);
        assert.deepEqual(output.passedSteps, ["verify-desktop"]);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
