import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { validateBrowserFirstNativeAssets } from "../../scripts/browser-first-native-assets.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const repoNativeAssets = await validateBrowserFirstNativeAssets({ repoRoot }).catch((error) => ({
  ok: false,
  issues: [error instanceof Error ? error.message : String(error)],
}));
const nativeAssetsMissing = !repoNativeAssets.ok
  && repoNativeAssets.issues.every((issue) => /^Missing /.test(issue));
const nativeInstallerSkip = process.platform !== "darwin"
  ? "macOS app bundle installer is only meaningful on darwin."
  : repoNativeAssets.ok
    ? false
    : nativeAssetsMissing
      ? "Native browser assets are not built in this checkout."
      : false;

const readyLaunchLog = [
  '{"event":"browser.first.launch_mode","mode":"mac-app-bundle","appBundle":"/tmp/ResonantBrowserNativeHost.app"}',
  '{"event":"browser.first.bridge_started","requestedPort":47773,"attemptedPort":47773,"actualPort":47773,"recovered":false}',
  '{"hostId":"resonant-browser-native"}',
  '{"phantomLoaded":true,"pinnedExtensions":["cdpdmmalhmokbfcfgogoepnjplaakgnl","bfnaelmomeimhlpmgjnjophhpkkoljpa"]}',
  '{"event":"browser.native.cef_initialize_ok"}',
  '{"event":"browser.native.appkit_menu.installed","phase":"post-cef","menus":["ResonantOS Browser","File","Edit","View","Assistant","History","Bookmarks","Profiles","Tab","Window","Help"]}',
  '{"event":"browser.native.load_end","url":"chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html","title":"ResonantOS"}',
].join("\n");

test("installed-app verifier accepts a ready Chromium launch log without launching", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-verify-ready-"));
  try {
    const logPath = path.join(tmp, "ready.log");
    await writeFile(logPath, `${readyLaunchLog}\n`);

    const { stdout } = await execFileAsync("node", [
      path.join(repoRoot, "scripts", "verify-browser-first-app.mjs"),
      "--no-launch",
      `--log=${logPath}`,
      "--timeout-ms=10",
    ], { cwd: repoRoot });
    const result = JSON.parse(stdout);

    assert.equal(result.status, "ready");
    assert.equal(result.appkitMenu, "installed");
    assert.equal(result.postCefMenuInstalled, true);
    assert.equal(result.bridge.status, "started");
    assert.equal(result.nativeHostStarted, true);
    assert.equal(result.cefInitialized, true);
    assert.equal(result.mainWorkspaceLoaded, true);
    assert.equal(result.phantomLoaded, true);
    assert.deepEqual(result.nativeLive, { status: "skipped" });
    assert.deepEqual(result.missingMenus, []);
    assert.deepEqual(result.pinnedExtensions, {
      resonantOS: true,
      phantom: true,
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("installed-app verifier can require strict native live verification", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-verify-native-live-required-"));
  try {
    const logPath = path.join(tmp, "ready.log");
    await writeFile(logPath, `${readyLaunchLog}\n`);

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "verify-browser-first-app.mjs"),
        "--no-launch",
        "--require-native-live=true",
        `--log=${logPath}`,
        "--timeout-ms=10",
      ], {
        cwd: repoRoot,
        env: { ...process.env, CODEX_SANDBOX: "1" },
      }),
      (error) => {
        const result = JSON.parse(error.stdout);
        assert.equal(result.status, "attention");
        assert.equal(result.nativeLive.reason, "native-live-verification-requires-unsandboxed-desktop");
        assert.match(result.issues.join("\n"), /strict native Chromium live verification did not pass/);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("native live verifier reports skipped smoke tests as incomplete", async () => {
  const { stdout } = await execFileAsync("node", [
    path.join(repoRoot, "scripts", "verify-browser-native-live.mjs"),
    "--self-test",
  ], { cwd: repoRoot });
  const result = JSON.parse(stdout);

  assert.equal(result.skipped, 1);
  assert.match(result.skipLines[0], /native CEF bridge embeds/);
});

test("native live verifier refuses sandboxed desktop verification", async () => {
  await assert.rejects(
    execFileAsync("node", [path.join(repoRoot, "scripts", "verify-browser-native-live.mjs")], {
      cwd: repoRoot,
      env: { ...process.env, CODEX_SANDBOX: "1" },
    }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.status, "attention");
      assert.equal(result.reason, "native-live-verification-requires-unsandboxed-desktop");
      assert.match(result.command, /browser-native:verify-live/);
      return true;
    },
  );
});

test("browser-first installer creates a launchable macOS app bundle with a compatible launcher", {
  skip: nativeInstallerSkip,
}, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-install-root-"));
  try {
    const { stdout } = await execFileAsync("node", [path.join(repoRoot, "scripts", "install-browser-first-app.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RESONANTOS_BROWSER_INSTALL_ROOT: tmp,
        MACOSX_DEPLOYMENT_TARGET: "12.0",
      },
    });
    const result = JSON.parse(stdout);
    const appPath = path.join(tmp, "ResonantOS Browser.app");
    const executablePath = path.join(appPath, "Contents", "MacOS", "ResonantOSBrowserLauncher");
    const infoPlist = await readFile(path.join(appPath, "Contents", "Info.plist"), "utf8");
    const launcherSource = await readFile(path.join(appPath, "Contents", "Resources", "ResonantOSBrowserLauncher.c"), "utf8");

    assert.equal(result.targetApp, appPath);
    assert.equal(result.executablePath, executablePath);
    assert.equal(result.macosDeploymentTarget, "12.0");
    assert.equal(result.nativeAssets.ok, true);
    assert.match(result.nativeAssets.nativeApp, /ResonantBrowserNativeHost\.app$/);
    assert.match(result.nativeAssets.stagedAppZip, /ResonantBrowserNativeHost\.app\.zip$/);
    assert.equal(result.postInstall.clearQuarantine.command, "xattr");
    assert.deepEqual(result.postInstall.clearQuarantine.args, ["-dr", "com.apple.quarantine", appPath]);
    assert.equal(result.postInstall.clearQuarantine.attributeName, "com.apple.quarantine");
    assert.equal(result.postInstall.clearQuarantine.verifiedAbsent, true);
    assert.equal(result.postInstall.clearProvenance.command, "xattr");
    assert.deepEqual(result.postInstall.clearProvenance.args, ["-dr", "com.apple.provenance", appPath]);
    assert.equal(result.postInstall.clearProvenance.attributeName, "com.apple.provenance");
    assert.equal(typeof result.postInstall.clearProvenance.verifiedAbsent, "boolean");
    assert.match(result.postInstall.registerLaunchServices.command, /lsregister$/);
    assert.deepEqual(result.postInstall.registerLaunchServices.args, ["-f", appPath]);
    assert.match(infoPlist, /<key>CFBundleExecutable<\/key>\s*<string>ResonantOSBrowserLauncher<\/string>/);
    assert.match(infoPlist, /<key>CFBundlePackageType<\/key>\s*<string>APPL<\/string>/);
    assert.match(launcherSource, new RegExp(repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(launcherSource, /browser-first\/host\/run-browser-first\.mjs/);
    assert.match(launcherSource, /logs\/browser-first-installed-app\.log/);
    assert.match(launcherSource, /execlp\("node", "node"/);
    assert.doesNotMatch(launcherSource, /fork\(\)|setsid\(\)/);

    const { stdout: otool } = await execFileAsync("otool", ["-l", executablePath], { cwd: repoRoot });
    assert.match(otool, /LC_BUILD_VERSION/);
    assert.match(otool, /minos 12\.0/);

    await execFileAsync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], { cwd: repoRoot });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("installed-app verifier rejects fork-and-exit launchers before launch", {
  skip: nativeInstallerSkip,
}, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-fork-launcher-"));
  try {
    const { stdout } = await execFileAsync("node", [path.join(repoRoot, "scripts", "install-browser-first-app.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RESONANTOS_BROWSER_INSTALL_ROOT: tmp,
        MACOSX_DEPLOYMENT_TARGET: "12.0",
      },
    });
    const result = JSON.parse(stdout);
    const launcherSourcePath = path.join(result.targetApp, "Contents", "Resources", "ResonantOSBrowserLauncher.c");
    const launcherSource = await readFile(launcherSourcePath, "utf8");
    await writeFile(
      launcherSourcePath,
      launcherSource.replace(
        /execlp\("node", "node", [\s\S]*?return 71;/,
        'pid_t pid = fork();\n  if (pid == 0) { setsid(); }\n  return 0;'
      ),
    );

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "verify-browser-first-app.mjs"),
        `--app=${result.targetApp}`,
        "--timeout-ms=10",
      ], { cwd: repoRoot }),
      (error) => {
        const output = JSON.parse(error.stdout);
        assert.equal(output.status, "attention");
        assert.equal(output.installedApp.launcherUsesExec, false);
        assert.equal(output.installedApp.launcherForksAndExits, true);
        assert.match(output.issues.join("\n"), /forks and exits/);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("installed-app verifier rejects stale installed launcher source before launch", {
  skip: nativeInstallerSkip,
}, async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-stale-launcher-"));
  try {
    const { stdout } = await execFileAsync("node", [path.join(repoRoot, "scripts", "install-browser-first-app.mjs")], {
      cwd: repoRoot,
      env: {
        ...process.env,
        RESONANTOS_BROWSER_INSTALL_ROOT: tmp,
        MACOSX_DEPLOYMENT_TARGET: "12.0",
      },
    });
    const result = JSON.parse(stdout);
    const launcherSourcePath = path.join(result.targetApp, "Contents", "Resources", "ResonantOSBrowserLauncher.c");
    const launcherSource = await readFile(launcherSourcePath, "utf8");
    await writeFile(launcherSourcePath, launcherSource.replace(repoRoot, "/tmp/old-resonantos-vnext"));

    await assert.rejects(
      execFileAsync("node", [
        path.join(repoRoot, "scripts", "verify-browser-first-app.mjs"),
        `--app=${result.targetApp}`,
        "--timeout-ms=10",
      ], { cwd: repoRoot }),
      (error) => {
        const output = JSON.parse(error.stdout);
        assert.equal(output.status, "attention");
        assert.equal(output.installedApp.launcherRepoRootMatches, false);
        assert.match(output.issues.join("\n"), /launcher does not point at the current repository root/);
        return true;
      },
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("browser-first native asset validator reports missing native host assets before launch", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-missing-assets-"));
  try {
    await mkdir(path.join(tmp, "browser-first", "host"), { recursive: true });
    await writeFile(path.join(tmp, "browser-first", "host", "run-browser-first.mjs"), "console.log('placeholder');\n");

    const result = await validateBrowserFirstNativeAssets({ repoRoot: tmp });

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => /Missing nativeExecutable/.test(issue)));
    assert.ok(result.issues.some((issue) => /Missing nativeBridgeDylib/.test(issue)));
    assert.ok(result.issues.some((issue) => /Missing stagedAppZip/.test(issue)));
    assert.match(result.nextAction, /browser-native:build:required/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("browser-first native asset validator rejects stale staged bridge assets", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "resonantos-stale-bridge-assets-"));
  try {
    const nativeApp = path.join(tmp, "addons", "resonant-browser-native", "build", "ResonantBrowserNativeHost.app");
    const nativeMacos = path.join(nativeApp, "Contents", "MacOS");
    const nativeSource = path.join(tmp, "addons", "resonant-browser-native", "native_host", "src");
    const nativeInclude = path.join(tmp, "addons", "resonant-browser-native", "native_host", "include");
    const staged = path.join(tmp, "build", "native-browser");
    const extension = path.join(tmp, "browser-first", "resonantos-side-panel-extension");
    const host = path.join(tmp, "browser-first", "host");

    await mkdir(nativeMacos, { recursive: true });
    await mkdir(nativeSource, { recursive: true });
    await mkdir(nativeInclude, { recursive: true });
    await mkdir(staged, { recursive: true });
    await mkdir(extension, { recursive: true });
    await mkdir(host, { recursive: true });

    await writeFile(path.join(nativeMacos, "ResonantBrowserNativeHost"), "host");
    await writeFile(path.join(nativeApp, "Contents", "Info.plist"), [
      "<plist><dict>",
      "<key>CFBundleExecutable</key><string>ResonantBrowserNativeHost</string>",
      "<key>CFBundleName</key><string>ResonantOS Browser</string>",
      "</dict></plist>",
    ].join(""));
    await writeFile(path.join(tmp, "addons", "resonant-browser-native", "build", "libResonantBrowserNativeBridgeShared.dylib"), "bridge");
    await writeFile(path.join(staged, "ResonantBrowserNativeHost.app.zip"), "zip");
    await writeFile(path.join(staged, "libResonantBrowserNativeBridgeShared.dylib"), "old bridge");
    await writeFile(path.join(extension, "manifest.json"), JSON.stringify({
      manifest_version: 3,
      name: "ResonantOS Browser Layer",
    }));
    await writeFile(path.join(host, "run-browser-first.mjs"), "console.log('host');\n");
    await writeFile(path.join(nativeSource, "resonant_browser_native_host.cc"), "host source");
    await writeFile(path.join(nativeSource, "resonant_browser_native_host_mac.mm"), "host mac source");
    await writeFile(path.join(nativeInclude, "resonant_browser_native_bridge.h"), "bridge header");
    await writeFile(path.join(nativeSource, "resonant_browser_native_bridge.cc"), "bridge source");
    await writeFile(path.join(nativeSource, "resonant_browser_native_bridge_mac.mm"), "bridge mac source");

    const oldDate = new Date("2026-01-01T00:00:00.000Z");
    const newDate = new Date("2026-01-02T00:00:00.000Z");
    await utimes(path.join(staged, "libResonantBrowserNativeBridgeShared.dylib"), oldDate, oldDate);
    await utimes(path.join(tmp, "addons", "resonant-browser-native", "build", "libResonantBrowserNativeBridgeShared.dylib"), newDate, newDate);
    await utimes(path.join(nativeMacos, "ResonantBrowserNativeHost"), newDate, newDate);
    await utimes(path.join(staged, "ResonantBrowserNativeHost.app.zip"), newDate, newDate);

    const result = await validateBrowserFirstNativeAssets({ repoRoot: tmp });

    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => /Staged native bridge dylib is older/.test(issue)));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
