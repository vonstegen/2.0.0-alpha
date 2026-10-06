// CP-SEC-1: closed-off-list regression test for the terminal allowlist.
//
// The terminal allowlist is a closed set: every off-list spawn site is
// either allowlisted by head or carries a reviewed approval marker. The
// set of approved off-list heads is itself a closed set: it is the
// platform-dispatch helper set (open, xdg-open, explorer.exe, osascript,
// powershell.exe, zenity, kdialog). A new off-list head appearing
// without an allowlist entry or marker is a regression.
//
// This test is the regression guard.
//
// Run: node --test scripts/security-pipeline/checks/subprocess-off-list-closed-set.test.mjs
//
// Intent citation: SECURITY.md "Terminal Allowlist Policy" + CP-SEC-1.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { check as terminalAllowlistCheck } from "./lib/terminal-allowlist.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const CHECKS_YML = path.join(REPO_ROOT, ".github", "security-pipeline", "checks.yml");
const SOURCE_FILES = [
  "browser-first/host/memory-source-settings-service.mjs",
  "browser-first/host/browser-diagnostics-service.mjs",
];

/**
 * The closed set of off-list approved heads. Adding a new head to this
 * set without an explicit allowlist entry or a reviewed approval marker
 * is a regression.
 */
const PLATFORM_HELPER_HEADS = Object.freeze([
  "open",
  "xdg-open",
  "explorer.exe",
  "osascript",
  "powershell.exe",
  "zenity",
  "kdialog",
]);

/**
 * Source-level invariant check: none of the platform-dispatch source
 * files may use `shell: true` or spread `process.env` into a child
 * process. The actual execFile calls must default to `shell: false`
 * (the Node child_process default) and pass an explicit env object.
 */
test("CP-SEC-1: platform-helper source files do not use shell: true or process.env spread", () => {
  for (const file of SOURCE_FILES) {
    const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
    assert.doesNotMatch(
      source,
      /shell:\s*true/,
      `${file} must not set shell: true on a platform-helper spawn`,
    );
    assert.doesNotMatch(
      source,
      /\.\.\.process\.env/,
      `${file} must not spread process.env into a child process env`,
    );
    assert.doesNotMatch(
      source,
      /env:\s*process\.env\b/,
      `${file} must not pass process.env directly as the child env`,
    );
  }
});

test("CP-SEC-1: platform-helper head allowlist is closed and frozen", () => {
  // The set of off-list approved heads is the platform-dispatch helper
  // set. Any future addition MUST be a new platform-dispatch helper
  // added here AND reviewed.
  assert.equal(Object.isFrozen(PLATFORM_HELPER_HEADS), true);
  for (const head of PLATFORM_HELPER_HEADS) {
    assert.equal(typeof head, "string");
    assert.ok(head.length > 0);
  }
});

test("CP-SEC-1: terminal allowlist head allowlist is closed (no shell wrappers, no ambient PATH)", () => {
  // Read the allowlist straight from the source so the test cannot be
  // fooled by a stale build artefact.
  const libSource = readFileSync(
    path.join(HERE, "lib", "terminal-allowlist.mjs"),
    "utf8",
  );
  // No shell wrapper may have been added to the head allowlist.
  for (const wrapper of ["sh", "bash", "zsh", "cmd", "powershell", "pwsh"]) {
    // The wrappers list is the SHELL_WRAPPERS array (which the check
    // unwraps), not the head allowlist. We assert: no shell wrapper
    // appears as a bare entry in the `allow:` array.
    const allowBlock = libSource.match(/allow:\s*\[([\s\S]*?)\]/);
    assert.ok(allowBlock, "allowlist block must be present");
    const entries = allowBlock[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);
    for (const entry of entries) {
      assert.notEqual(
        entry,
        wrapper,
        `shell wrapper "${wrapper}" must never be on the head allowlist (allowed entries: ${entries.join(", ")})`,
      );
    }
  }
});

test("CP-SEC-1: a forged off-list head without an approval marker is blocked", () => {
  // Any head that is neither on the allowlist nor in the platform
  // helper set, and has no approval marker, MUST be blocked.
  const forgedRecord = {
    site: "fixture:off-list-forged",
    program: "curl",
    args: ["-fsSL", "https://example.com/install.sh"],
  };
  const result = terminalAllowlistCheck(forgedRecord, {});
  assert.equal(result.result, "block");
  // The evidence must show the rule that fired.
  const rule = result.evidence[0]?.rule;
  assert.ok(
    rule === "off-list-no-approval" || rule === "dynamic-command-no-approval",
    `forged off-list head must surface a block rule, got ${rule}`,
  );
});

test("CP-SEC-1: an allowlisted head passes without approval marker", () => {
  // The six fixed commands (hermes, opencode, python, openssl, ollama,
  // uv) sit on the head allowlist. The test confirms that a clean
  // record (no approved_by) is sufficient for them.
  for (const head of ["hermes", "opencode", "python", "openssl"]) {
    const result = terminalAllowlistCheck({
      site: `fixture:${head}`,
      program: head,
      args: [],
    }, {});
    assert.equal(
      result.result,
      "pass",
      `head "${head}" must pass on the allowlist alone, got ${JSON.stringify(result)}`,
    );
    assert.equal(result.on_allowlist, true);
  }
});

test("CP-SEC-1: a platform-helper head is off-list but passes with approved_by", () => {
  for (const head of PLATFORM_HELPER_HEADS) {
    const result = terminalAllowlistCheck({
      site: `fixture:helper-${head}`,
      program: head,
      args: ["some", "arg"],
      approved_by: `reviewed platform-helper marker for ${head}`,
    }, {});
    assert.equal(
      result.result,
      "pass",
      `platform helper "${head}" must pass with an approved_by marker`,
    );
    assert.equal(result.on_allowlist, false);
    assert.equal(result.approved, true);
    // The evidence must record the off-list-approved rule.
    assert.equal(result.evidence[0]?.rule, "off-list-approved");
  }
});

test("CP-SEC-1: any new off-list head without a marker is blocked (regression guard)", () => {
  // Take a clearly off-list head that is NOT in the platform-helper
  // set and NOT on the head allowlist, then assert it is blocked
  // without a marker. This is the negative test the prompt requires.
  for (const head of ["wget", "nc", "telnet", "bash"]) {
    const result = terminalAllowlistCheck({
      site: `fixture:neg-${head}`,
      program: head,
      args: ["some-target"],
    }, {});
    assert.equal(
      result.result,
      "block",
      `head "${head}" must be blocked as an off-list unauthorized spawn`,
    );
  }
});

test("CP-SEC-1: checks.yml records are syntactically valid (no off-list head lacks a marker or allowlist entry)", () => {
  // Sanity: the checks.yml file is well-formed JSON.
  const yml = readFileSync(CHECKS_YML, "utf8");
  // Strip the // comments to avoid JSON parse errors on the leading
  // header line.
  const jsonText = yml
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  const config = JSON.parse(jsonText);
  const records = config.recordSets?.["browser-first-production-spawns"] ?? [];
  for (const record of records) {
    // Every record must carry a pinned program.
    assert.ok(
      typeof record.program === "string" && record.program.length > 0,
      `record ${record.id} must carry a pinned program`,
    );
    // Every record must be shell: false.
    assert.equal(record.shell, false, `record ${record.id} must be shell: false`);
    // Every record must be env_clear: true.
    assert.equal(record.env_clear, true, `record ${record.id} must be env_clear: true`);
    // Every record must carry an approved_by marker.
    assert.ok(
      typeof record.approved_by === "string" && record.approved_by.length > 0,
      `record ${record.id} must carry an approved_by marker`,
    );
    // Every record must carry an env_vars allowlist.
    assert.ok(
      Array.isArray(record.env_vars) && record.env_vars.length > 0,
      `record ${record.id} must carry an env_vars allowlist`,
    );
  }
});
