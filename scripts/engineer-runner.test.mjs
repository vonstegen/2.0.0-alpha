#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  buildOpenCodePrompt,
  runCommand,
  evaluateScope,
  normalizeTaskContract,
  parseGitStatusPorcelain,
  verifyTaskContract,
} from "./engineer-runner.mjs";

function makeGitRepo() {
  const repo = mkdtempSync(join(tmpdir(), "engineer-runner-"));
  spawnSync("git init", { cwd: repo, shell: true, stdio: "ignore" });
  spawnSync("git config user.email test@example.com", { cwd: repo, shell: true, stdio: "ignore" });
  spawnSync("git config user.name Test", { cwd: repo, shell: true, stdio: "ignore" });
  mkdirSync(join(repo, "scripts"));
  writeFileSync(join(repo, "scripts", "allowed.txt"), "base\n");
  writeFileSync(join(repo, "package.json"), "{\"type\":\"module\",\"scripts\":{\"check\":\"node -e \\\"process.exit(0)\\\"\"}}\n");
  spawnSync("git add . && git commit -m initial", { cwd: repo, shell: true, stdio: "ignore" });
  return repo;
}

test("normalizeTaskContract rejects missing allowed files", () => {
  const repo = makeGitRepo();
  try {
    assert.throws(
      () => normalizeTaskContract({ repo, goal: "test", allowedFiles: [] }),
      /at least one allowed file/,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("buildOpenCodePrompt includes allowed files, requirements, and loop", () => {
  const repo = makeGitRepo();
  try {
    const contract = normalizeTaskContract({
      repo,
      goal: "Add JSON mode",
      allowedFiles: ["scripts/allowed.txt"],
      requiredCommands: ["npm run check"],
      requirements: ["Do not edit package.json"],
    });
    const prompt = buildOpenCodePrompt(contract);
    assert.match(prompt, /Allowed files:/);
    assert.match(prompt, /scripts\/allowed\.txt/);
    assert.match(prompt, /Do not edit any file outside/);
    assert.match(prompt, /Implement pass/);
    assert.match(prompt, /Review pass/);
    assert.match(prompt, /npm run check/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("evaluateScope fails when changed files include files outside allowed set", () => {
  const result = evaluateScope(["package.json", "scripts/allowed.txt"], ["scripts/allowed.txt"]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.outsideAllowedFiles, ["package.json"]);
});

test("parseGitStatusPorcelain includes modified, renamed, and untracked files", () => {
  const files = parseGitStatusPorcelain([
    " M scripts/allowed.txt",
    " M scripts\\windows.txt",
    "?? scripts/new-file.mjs",
    "R  docs/old.md -> docs/new.md",
    "",
  ].join("\n"));
  assert.deepEqual(files, ["docs/new.md", "docs/old.md", "scripts/allowed.txt", "scripts/new-file.mjs", "scripts/windows.txt"]);
});

test("verifyTaskContract verifies scoped changes and required commands", () => {
  const repo = makeGitRepo();
  try {
    writeFileSync(join(repo, "scripts", "allowed.txt"), "changed\n");
    const contract = normalizeTaskContract({
      repo,
      goal: "Change allowed file",
      allowedFiles: ["scripts/allowed.txt"],
      requiredCommands: ["npm run check"],
    });
    const report = verifyTaskContract(contract);
    assert.equal(report.status, "verified");
    assert.equal(report.scope.ok, true);
    assert.deepEqual(report.scope.changedFiles, ["scripts/allowed.txt"]);
    assert.equal(report.commands[0].status, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("verifyTaskContract fails when scope gate catches an extra file", () => {
  const repo = makeGitRepo();
  try {
    writeFileSync(join(repo, "scripts", "allowed.txt"), "changed\n");
    writeFileSync(join(repo, "package.json"), "{\"type\":\"module\",\"scripts\":{\"check\":\"node -e \\\"process.exit(0)\\\"\"},\"extra\":true}\n");
    const contract = normalizeTaskContract({
      repo,
      goal: "Change allowed file",
      allowedFiles: ["scripts/allowed.txt"],
      requiredCommands: ["npm run check"],
    });
    const report = verifyTaskContract(contract);
    assert.equal(report.status, "failed");
    assert.equal(report.scope.ok, false);
    assert.deepEqual(report.scope.outsideAllowedFiles, ["package.json"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("verifyTaskContract fails when an untracked file is outside the allowed set", () => {
  const repo = makeGitRepo();
  try {
    writeFileSync(join(repo, "scripts", "allowed.txt"), "changed\n");
    writeFileSync(join(repo, "scripts", "untracked.txt"), "new\n");
    const contract = normalizeTaskContract({
      repo,
      goal: "Change allowed file",
      allowedFiles: ["scripts/allowed.txt"],
      requiredCommands: ["npm run check"],
    });
    const report = verifyTaskContract(contract);
    assert.equal(report.status, "failed");
    assert.equal(report.scope.ok, false);
    assert.deepEqual(report.scope.outsideAllowedFiles, ["scripts/untracked.txt"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("verifyTaskContract fails when a required command fails", () => {
  const repo = makeGitRepo();
  try {
    writeFileSync(join(repo, "scripts", "allowed.txt"), "changed\n");
    const contract = normalizeTaskContract({
      repo,
      goal: "Change allowed file",
      allowedFiles: ["scripts/allowed.txt"],
      requiredCommands: ["node -e \"process.exit(7)\""],
    });
    const report = verifyTaskContract(contract);
    assert.equal(report.status, "failed");
    assert.equal(report.scope.ok, true);
    assert.equal(report.commands[0].status, 7);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});


test("runCommand executes argv commands without a shell", () => {
  const res = runCommand(process.cwd(), "git --version");
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /git version/);
});

test("runCommand keeps quoted arguments as single literal argv words", () => {
  const res = runCommand(process.cwd(), 'node -e "process.exit(7)"');
  assert.equal(res.status, 7, `stderr: ${res.stderr}`);
});

test("runCommand refuses unquoted shell metacharacters (injection guard, issue #163 class)", () => {
  for (const bad of ["echo hi; touch /tmp/pwn", "echo `id`", "echo $(id)", "echo a && echo b", "echo x > /tmp/pwn", "echo | id"]) {
    const res = runCommand(process.cwd(), bad);
    assert.equal(res.status, 126, `should refuse: ${bad}`);
    assert.match(res.stderr, /refused/);
  }
});

test("runCommand refuses empty commands and unterminated quotes", () => {
  assert.equal(runCommand(process.cwd(), "   ").status, 126);
  assert.equal(runCommand(process.cwd(), 'echo "unterminated').status, 126);
  assert.equal(runCommand(process.cwd(), "echo a\u0000b").status, 126);
});
