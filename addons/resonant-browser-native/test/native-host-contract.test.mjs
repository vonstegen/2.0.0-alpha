import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { cefArchiveName, cefBuild, cefBuildDirectoryName } from "../scripts/cef-build-config.mjs";

const execFileAsync = promisify(execFile);
const addonRoot = path.resolve(import.meta.dirname, "..");

test("native Browser host source satisfies the ADR-025 contract markers", async () => {
  const { stdout } = await execFileAsync("node", [path.join(addonRoot, "scripts", "probe-native-host.mjs")], {
    cwd: addonRoot,
  });
  const result = JSON.parse(stdout);

  assert.equal(result.hostId, "resonant-browser-native");
  assert.equal(result.engineCandidate, "cef-chrome-runtime");
  assert.equal(result.sourceContractOk, true);
  assert.deepEqual(result.failures, []);
});

test("native Browser host contains unsafe caller launch arguments before Chromium sees them", async () => {
  const source = await readFile(
    path.join(addonRoot, "native_host", "src", "resonant_browser_native_host.cc"),
    "utf8",
  );

  assert.match(source, /SafeBrowserUserDataDir/);
  assert.match(source, /SafeExtensionDirs/);
  assert.match(source, /extension_dirs = SafeExtensionDirs\(extension_dirs\)/);
  assert.match(source, /AppendSwitchWithValue\("remote-debugging-port", "0"\)/);
  assert.match(source, /AppendSwitchWithValue\("remote-debugging-address", "127\.0\.0\.1"\)/);
  assert.match(
    source,
    /SafeBrowserUserDataDir\(command_line->GetSwitchValue\("resonantos-user-data-dir"\)\)/,
  );
  assert.match(
    source,
    /SafeBrowserUserDataDir\(initial_command_line->GetSwitchValue\("resonantos-user-data-dir"\)\)/,
  );
  assert.doesNotMatch(source, /requested_debug_port/);
  assert.doesNotMatch(source, /AppendSwitchWithValue\("remote-debugging-port",\s*requested/);
  assert.doesNotMatch(source, /AppendSwitchWithValue\("user-data-dir",\s*user_data_dir\)/);
});

test("bundled Browser add-on manifest stays aligned with the native product path", async () => {
  const { stdout } = await execFileAsync("node", [path.join(addonRoot, "scripts", "audit-browser-addon-drift.mjs")], {
    cwd: addonRoot,
  });
  const result = JSON.parse(stdout);

  assert.equal(result.driftAuditOk, true);
  assert.equal(result.addonId, "addon.browser");
  assert.equal(result.protocol, "host-command");
});

test("CEF fetch, build, and native tests use the same pinned Chromium build", async () => {
  assert.equal(cefBuild.cefVersion, "147.0.10+gd58e84d+chromium-147.0.7727.118");
  assert.equal(cefBuild.chromiumVersion, "147.0.7727.118");
  assert.equal(
    cefArchiveName("macosarm64"),
    "cef_binary_147.0.10+gd58e84d+chromium-147.0.7727.118_macosarm64.tar.bz2",
  );

  const repoRoot = path.resolve(addonRoot, "..", "..");
  const [fetchScript, buildScript, embedTest] = await Promise.all([
    readFile(path.join(addonRoot, "scripts", "fetch-cef.mjs"), "utf8"),
    readFile(path.join(repoRoot, "scripts", "build-native-browser.mjs"), "utf8"),
    readFile(path.join(addonRoot, "test", "native-cef-embed.test.mjs"), "utf8"),
  ]);

  assert.match(fetchScript, /cefArchiveName/);
  assert.match(buildScript, /cefBuildDirectoryName/);
  assert.match(embedTest, /cefBuildDirectoryName/);
  assert.equal(cefBuildDirectoryName("unsupported"), "cef_binary_147.0.10+gd58e84d+chromium-147.0.7727.118_unsupported");
});
