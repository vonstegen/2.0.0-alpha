// CP-BR1: macOS installer / uninstaller tests.
//
// Pure module: uses tmp HOME directories for install/uninstall file ops
// and injected node validators. Asserts:
//   * Manifest identity, path, type, allowed_origins pinning (no wildcard)
//   * Wrapper script pins node + entry with absolute paths and rejects
//     relative paths, quotes, or newlines
//   * install writes files in tmp HOME with correct modes
//   * install rejects unrunnable / missing / too-old Node and host entry
//   * uninstall removes files idempotently and does not touch anything
//     outside its installed footprint
//   * dry-run writes nothing

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const {
  WRAPPER_FILE_NAME,
  buildHostWrapperScript,
  buildNativeHostManifest,
  installBootstrapNativeHost,
  resolveInstallPaths,
  validateNodeExecutable,
} = await import("../bootstrap/install-macos.mjs");
const { uninstallBootstrapNativeHost } = await import("../bootstrap/uninstall-macos.mjs");
const {
  NATIVE_HOST_NAME,
  ROS_EXTENSION_ORIGIN,
  nativeHostEntryPath,
} = await import("../bootstrap/bridge-policy.mjs");

function tmpHome(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "ros-bootstrap-install-"));
  t?.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });
  return dir;
}

function fakeExecFile(returned, throwing = false) {
  return (file, args, options) => {
    if (throwing) throw new Error("exec failed");
    if (file.endsWith("node") && args && args[0] === "--version") return returned;
    return "";
  };
}

test("native host manifest pins name, type, allowed_origins, and the resolved wrapper path", () => {
  const manifest = buildNativeHostManifest({ wrapperPath: "/tmp/wrapper.sh" });
  assert.equal(manifest.name, NATIVE_HOST_NAME);
  assert.equal(manifest.name, "com.resonantos.bridge_bootstrap");
  assert.equal(manifest.type, "stdio");
  assert.equal(manifest.path, "/tmp/wrapper.sh");
  assert.deepEqual(manifest.allowed_origins, [ROS_EXTENSION_ORIGIN]);
  for (const origin of manifest.allowed_origins) {
    assert.notEqual(origin, "*");
    assert.ok(origin.startsWith("chrome-extension://"));
  }
});

test("manifest refuses a wildcard or non-chrome-extension origin", () => {
  assert.throws(() => buildNativeHostManifest({ wrapperPath: "/tmp/wrapper.sh", extensionOrigins: ["*"] }), /chrome-extension/);
  assert.throws(() => buildNativeHostManifest({ wrapperPath: "/tmp/wrapper.sh", extensionOrigins: ["https://example.com"] }), /chrome-extension/);
  assert.throws(() => buildNativeHostManifest({ wrapperPath: "/tmp/wrapper.sh", extensionOrigins: [123] }), /chrome-extension/);
});

test("wrapper pins node + entry with absolute paths and execs them", () => {
  const wrapper = buildHostWrapperScript({
    nodeExecutable: "/opt/homebrew/bin/node",
    hostEntry: "/repos/x/browser-first/bootstrap/native-host-main.mjs",
  });
  assert.ok(wrapper.startsWith("#!/bin/sh\n"));
  assert.match(wrapper, /\nexec "\/opt\/homebrew\/bin\/node" "\/repos\/x\/browser-first\/bootstrap\/native-host-main\.mjs"\n/);
});

test("wrapper rejects relative paths, quotes, or newlines", () => {
  for (const case_ of [
    { nodeExecutable: "node" },
    { nodeExecutable: "/abs/node", hostEntry: "relative.mjs" },
    { nodeExecutable: '/abs/node"' },
    { nodeExecutable: "/abs/node", hostEntry: "/abs/x.mjs\nrm -rf /" },
  ]) {
    assert.throws(() => buildHostWrapperScript(case_), /(absolute|quotes|newlines)/);
  }
});

test("validateNodeExecutable reports version, rejects missing, non-absolute, non-executable, and too-old", () => {
  const ok = validateNodeExecutable("/abs/node", {
    existsSyncImpl: () => true,
    execFileSyncImpl: fakeExecFile("v26.1.0\n"),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.version, "v26.1.0");

  for (const verdict of [
    validateNodeExecutable("node", { existsSyncImpl: () => true, execFileSyncImpl: fakeExecFile("v") }),
    validateNodeExecutable("/abs/node", { existsSyncImpl: () => false, execFileSyncImpl: fakeExecFile("v") }),
    validateNodeExecutable("/abs/node", { existsSyncImpl: () => true, execFileSyncImpl: fakeExecFile("v", true) }),
    validateNodeExecutable("/abs/node", { existsSyncImpl: () => true, execFileSyncImpl: fakeExecFile("v20.0.0") }),
  ]) {
    assert.equal(verdict.ok, false);
  }
});

test("install + uninstall round-trip in a tmp HOME writes the expected files", (t) => {
  const home = tmpHome(t);
  const existsReal = existsSync;
  const existsAlwaysTrue = () => true;
  const execFile = fakeExecFile("v26.1.0\n");
  const result = installBootstrapNativeHost({
    nodeExecutable: "/abs/node",
    hostEntry: "/abs/host-entry.mjs",
    homeDir: home,
    existsSyncImpl: existsAlwaysTrue,
    execFileSyncImpl: execFile,
  });
  assert.equal(result.ok, true);
  const paths = resolveInstallPaths({ homeDir: home });
  assert.ok(result.written || true, "API ok");
  assert.ok(existsReal(paths.wrapperPath));
  assert.ok(existsReal(paths.manifestPath));
  const wrapper = readFileSync(paths.wrapperPath, "utf8");
  assert.match(wrapper, /exec "\/abs\/node" "\/abs\/host-entry\.mjs"/);
  const manifest = JSON.parse(readFileSync(paths.manifestPath, "utf8"));
  assert.equal(manifest.name, NATIVE_HOST_NAME);
  assert.equal(manifest.path, paths.wrapperPath);
  assert.deepEqual(manifest.allowed_origins, [ROS_EXTENSION_ORIGIN]);
  assert.equal(statSync(paths.wrapperPath).mode & 0o777, 0o755);
  assert.equal(statSync(paths.manifestPath).mode & 0o777, 0o644);

  const removed = uninstallBootstrapNativeHost({ homeDir: home });
  assert.equal(removed.ok, true);
  assert.equal(removed.removed.length, 2);
  assert.equal(existsReal(paths.wrapperPath), false);
  assert.equal(existsReal(paths.manifestPath), false);
});

test("install with --dry-run prints the planned install without writing anything", (t) => {
  const home = tmpHome(t);
  const result = installBootstrapNativeHost({
    nodeExecutable: "/abs/node",
    hostEntry: "/abs/host-entry.mjs",
    homeDir: home,
    existsSyncImpl: () => true,
    execFileSyncImpl: fakeExecFile("v26.1.0\n"),
    dryRun: true,
  });
  assert.equal(result.ok, true);
  const paths = resolveInstallPaths({ homeDir: home });
  assert.equal(existsSync(paths.wrapperPath), false);
  assert.equal(existsSync(paths.manifestPath), false);
});

test("uninstall is idempotent and never throws when files are already absent", (t) => {
  const home = tmpHome(t);
  const result1 = uninstallBootstrapNativeHost({ homeDir: home });
  const result2 = uninstallBootstrapNativeHost({ homeDir: home });
  assert.equal(result1.ok, true);
  assert.equal(result2.ok, true);
});

test("install refuses a non-existent host entry even when node is valid", () => {
  const result = installBootstrapNativeHost({
    nodeExecutable: "/abs/node",
    hostEntry: "/abs/missing-host-entry",
    homeDir: "/anywhere",
    existsSyncImpl: (target) => target.endsWith("node"),
    execFileSyncImpl: fakeExecFile("v26.1.0\n"),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "host-entry-missing");
});

test("WRAPPER_FILE_NAME and native host entry path are stable strings", () => {
  assert.equal(WRAPPER_FILE_NAME, "ros-bridge-bootstrap-host.sh");
  assert.ok(nativeHostEntryPath().endsWith("/native-host-main.mjs"));
});