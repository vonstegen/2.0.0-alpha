import assert from "node:assert/strict";
import test from "node:test";

import {
  canFallbackToDirectLauncher,
  isLaunchServicesExecutableBlocked,
  isLocalBridgeSandboxBlocked
} from "../host/installed-app-verifier-utils.mjs";

test("installed app verifier recognizes LaunchServices executable false negatives", () => {
  assert.equal(isLaunchServicesExecutableBlocked("NSOSStatusErrorDomain Code=-10827 kLSNoExecutableErr"), true);
  assert.equal(isLaunchServicesExecutableBlocked("LaunchServices LSOpenCore failed"), true);
  assert.equal(isLaunchServicesExecutableBlocked("The application cannot be opened: LSOpenCore.mm kLSNoExecutableErr"), true);
  assert.equal(isLaunchServicesExecutableBlocked("listen EPERM 127.0.0.1:47773"), false);
});

test("installed app verifier only falls back to direct launcher for current validated bundles", () => {
  const ready = {
    bundleExecutableDeclared: true,
    executableExists: true,
    exists: true,
    launcherLogPathMatches: true,
    launcherRepoRootMatches: true,
    launcherScriptMatches: true,
    launcherSourceExists: true,
    launcherUsesExec: true,
    launcherForksAndExits: false,
    diagnostics: {
      codesign: { ok: true },
      plistLint: { ok: true },
      xattrs: { hasQuarantine: false }
    }
  };
  assert.equal(canFallbackToDirectLauncher(ready), true);
  assert.equal(canFallbackToDirectLauncher({ ...ready, launcherRepoRootMatches: false }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, executableExists: false }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, launcherUsesExec: false }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, launcherForksAndExits: true }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, diagnostics: { ...ready.diagnostics, codesign: { ok: false } } }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, diagnostics: { ...ready.diagnostics, plistLint: { ok: false } } }), false);
  assert.equal(canFallbackToDirectLauncher({ ...ready, diagnostics: { ...ready.diagnostics, xattrs: { hasQuarantine: true } } }), false);
});

test("installed app verifier recognizes sandbox localhost bridge bind failures", () => {
  assert.equal(isLocalBridgeSandboxBlocked({
    bridge: {
      status: "failed",
      code: "EPERM",
      message: "listen EPERM: operation not permitted 127.0.0.1:47773"
    }
  }), true);
  assert.equal(isLocalBridgeSandboxBlocked({
    bridge: {
      status: "failed",
      code: "EADDRINUSE",
      message: "listen EADDRINUSE: address already in use 127.0.0.1:47773"
    }
  }), false);
  assert.equal(isLocalBridgeSandboxBlocked({
    bridge: {
      status: "failed",
      code: "EPERM",
      message: "listen EPERM: operation not permitted 0.0.0.0:47773"
    }
  }), false);
});
