import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");

async function writeNpmShim(bin) {
  const shimPath = path.join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  if (process.platform === "win32") {
    await writeFile(shimPath, [
      "@echo off",
      "if \"%2\"==\"browser-first:verify-installed\" (",
      "  echo ^> fake npm wrapper",
      "  echo {\"status\":\"ready\",\"step\":\"installed\"}",
      "  exit /b 0",
      ")",
      "echo {\"status\":\"ready\",\"step\":\"native\"}",
      "exit /b 0",
      "",
    ].join("\r\n"));
  } else {
    await writeFile(shimPath, [
      "#!/bin/sh",
      "if [ \"$2\" = \"browser-first:verify-installed\" ]; then",
      "  echo '> fake npm wrapper'",
      "  echo '{\"status\":\"ready\",\"step\":\"installed\"}'",
      "  exit 0",
      "fi",
      "echo '{\"status\":\"ready\",\"step\":\"native\"}'",
      "exit 0",
      ""
    ].join("\n"));
    await chmod(shimPath, 0o755);
  }
}

test("desktop verifier dry-run writes the command plan and report path", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-verifier-"));
  try {
    const reportPath = path.join(tmp, "desktop-report.json");
    const { stdout } = await execFileAsync("node", [
      path.join(repoRoot, "scripts", "verify-browser-first-desktop.mjs"),
      "--dry-run",
      `--report=${reportPath}`,
    ], { cwd: repoRoot });
    const output = JSON.parse(stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    assert.equal(output.status, "dry-run");
    assert.equal(output.reportPath, reportPath);
    assert.equal(report.reportPath, reportPath);
    assert.deepEqual(report.commands.map((command) => command.id), ["installed-app", "native-live"]);
    assert.deepEqual(report.commands[0].args, ["run", "browser-first:verify-installed", "--", "--require-native-live=false"]);
    assert.deepEqual(report.commands[1].args, ["run", "browser-native:verify-live"]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("desktop verifier captures parsed child verifier JSON in the durable report", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-desktop-verifier-parse-"));
  try {
    const bin = path.join(tmp, "bin");
    const reportPath = path.join(tmp, "desktop-report.json");
    await mkdir(bin, { recursive: true });
    await writeNpmShim(bin);

    const { stdout } = await execFileAsync("node", [
      path.join(repoRoot, "scripts", "verify-browser-first-desktop.mjs"),
      `--report=${reportPath}`,
    ], {
      cwd: repoRoot,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    });
    const output = JSON.parse(stdout);
    const report = JSON.parse(await readFile(reportPath, "utf8"));

    assert.equal(output.status, "ready");
    assert.equal(report.steps[0].parsed.status, "ready");
    assert.equal(report.steps[0].parsed.step, "installed");
    assert.equal(report.steps[1].parsed.status, "ready");
    assert.equal(report.steps[1].parsed.step, "native");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
