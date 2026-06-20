import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

async function writeNpmShim(bin, rules) {
  const shimPath = path.join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  if (process.platform === "win32") {
    await writeFile(shimPath, [
      "@echo off",
      ...rules.flatMap(({ script, stdout, exitCode }) => [
        `if "%2"=="${script}" (`,
        stdout ? `  echo ${stdout}` : "",
        `  exit /b ${exitCode}`,
        ")",
      ]),
      "echo unexpected npm command: %* 1>&2",
      "exit /b 9",
      "",
    ].filter((line) => line !== "").join("\r\n"));
  } else {
    await writeFile(shimPath, [
      "#!/bin/sh",
      ...rules.flatMap(({ script, stdout, exitCode }) => [
        `if [ "$2" = "${script}" ]; then`,
        stdout ? `  echo '${stdout}'` : "",
        `  exit ${exitCode}`,
        "fi",
      ]),
      "echo \"unexpected npm command: $@\" >&2",
      "exit 9",
      "",
    ].join("\n"));
    await chmod(shimPath, 0o755);
  }
}

test("desktop proof runner passes only when verification and audit pass", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-proof-"));
  try {
    const bin = path.join(tmp, "bin");
    await mkdir(bin, { recursive: true });
    await writeNpmShim(bin, [
      { script: "browser-first:verify-desktop", stdout: "{\"status\":\"ready\",\"step\":\"verify\"}", exitCode: 0 },
      { script: "browser-first:audit-desktop", stdout: "{\"status\":\"ready\",\"step\":\"audit\"}", exitCode: 0 },
    ]);

    const { stdout } = await execFileAsync("node", [
      path.join(repoRoot, "scripts", "prove-browser-first-desktop.mjs"),
    ], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
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
    await writeNpmShim(bin, [
      { script: "browser-first:verify-desktop", stdout: "{\"status\":\"ready\",\"step\":\"verify\"}", exitCode: 0 },
      { script: "browser-first:audit-desktop", stdout: "{\"status\":\"attention\",\"issues\":[\"missing proof\"]}", exitCode: 2 },
    ]);

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "prove-browser-first-desktop.mjs"),
      ], {
        cwd: repoRoot,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
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
