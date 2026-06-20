import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPENCODE_INSTALL_COMMAND,
  OPENCODE_NPM_INSTALL_COMMAND,
  opencodeCandidatePaths,
  opencodeRuntimeDiagnostics,
} from "../host/opencode-runtime.mjs";

test("opencode diagnostics surface install and override guidance when runtime is missing", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "resonantos-opencode-missing-"));
  try {
    const diagnostics = opencodeRuntimeDiagnostics({
      env: {
        PATH: tempDir,
        OPENCODE_COMMAND: path.join(tempDir, "missing-opencode"),
      },
      includeCommonCandidates: false,
    });

    assert.equal(diagnostics.installed, false);
    assert.equal(diagnostics.command, null);
    assert.equal(diagnostics.overrideConfigured, true);
    assert.equal(diagnostics.overrideFound, false);
    assert.equal(diagnostics.installCommand, OPENCODE_INSTALL_COMMAND);
    assert.ok(diagnostics.alternativeInstallCommands.includes(OPENCODE_NPM_INSTALL_COMMAND));
    assert.match(diagnostics.configureCommand, /OPENCODE_COMMAND/);
    assert.deepEqual(diagnostics.searchedCommands, ["opencode", "opencode-ai"]);
    assert.ok(diagnostics.searchedPaths.some((candidate) => candidate.includes("missing-opencode")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("opencode diagnostics detect opencode from PATH before packet-only fallback", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "resonantos-opencode-path-"));
  const binaryName = process.platform === "win32" ? "opencode.cmd" : "opencode";
  const fakeOpenCode = path.join(tempDir, binaryName);
  try {
    writeFileSync(fakeOpenCode, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n");
    chmodSync(fakeOpenCode, 0o755);

    const diagnostics = opencodeRuntimeDiagnostics({
      env: { PATH: tempDir },
      includeCommonCandidates: false,
    });

    assert.equal(diagnostics.installed, true);
    assert.equal(diagnostics.command, fakeOpenCode);
    assert.equal(diagnostics.commandRedacted, fakeOpenCode.replace(os.homedir(), "~"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("opencode candidate paths include both official command names", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "resonantos-opencode-candidates-"));
  try {
    const candidates = opencodeCandidatePaths({
      env: { PATH: tempDir },
      includeCommonCandidates: false,
    });
    assert.ok(candidates.some((candidate) => path.basename(candidate).startsWith("opencode")));
    assert.ok(candidates.some((candidate) => path.basename(candidate).startsWith("opencode-ai")));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
