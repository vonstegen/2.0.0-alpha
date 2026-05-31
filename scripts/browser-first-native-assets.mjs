import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

const requiredMenus = ["ResonantOS Browser", "File", "Edit", "View", "Assistant", "History", "Bookmarks", "Profiles", "Tab", "Window", "Help"];

export function browserFirstAssetPaths(repoRoot) {
  const root = path.resolve(repoRoot);
  const nativeApp = path.join(root, "addons", "resonant-browser-native", "build", "ResonantBrowserNativeHost.app");
  const nativeBridgeDylib = path.join(root, "addons", "resonant-browser-native", "build", "libResonantBrowserNativeBridgeShared.dylib");
  const nativeHostRoot = path.join(root, "addons", "resonant-browser-native", "native_host");
  return {
    nativeApp,
    nativeExecutable: path.join(nativeApp, "Contents", "MacOS", "ResonantBrowserNativeHost"),
    nativeInfoPlist: path.join(nativeApp, "Contents", "Info.plist"),
    nativeBridgeDylib,
    nativeHostSourceFiles: [
      path.join(nativeHostRoot, "src", "resonant_browser_native_host.cc"),
      path.join(nativeHostRoot, "src", "resonant_browser_native_host_mac.mm"),
    ],
    nativeBridgeSourceFiles: [
      path.join(nativeHostRoot, "include", "resonant_browser_native_bridge.h"),
      path.join(nativeHostRoot, "src", "resonant_browser_native_bridge.cc"),
      path.join(nativeHostRoot, "src", "resonant_browser_native_bridge_mac.mm"),
    ],
    stagedAppZip: path.join(root, "build", "native-browser", "ResonantBrowserNativeHost.app.zip"),
    stagedBridgeDylib: path.join(root, "build", "native-browser", "libResonantBrowserNativeBridgeShared.dylib"),
    resonantExtensionManifest: path.join(root, "browser-first", "resonantos-side-panel-extension", "manifest.json"),
    launcherScript: path.join(root, "browser-first", "host", "run-browser-first.mjs"),
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function mtimeMs(filePath) {
  return (await stat(filePath)).mtimeMs;
}

export async function validateBrowserFirstNativeAssets({ repoRoot }) {
  const paths = browserFirstAssetPaths(repoRoot);
  const issues = [];
  const missing = [];

  for (const [name, filePath] of Object.entries({
    nativeApp: paths.nativeApp,
    nativeExecutable: paths.nativeExecutable,
    nativeInfoPlist: paths.nativeInfoPlist,
    nativeBridgeDylib: paths.nativeBridgeDylib,
    stagedAppZip: paths.stagedAppZip,
    stagedBridgeDylib: paths.stagedBridgeDylib,
    resonantExtensionManifest: paths.resonantExtensionManifest,
    launcherScript: paths.launcherScript,
  })) {
    if (!(await exists(filePath))) {
      missing.push({ name, path: filePath });
    }
  }

  for (const filePath of [...paths.nativeHostSourceFiles, ...paths.nativeBridgeSourceFiles]) {
    if (!(await exists(filePath))) {
      missing.push({ name: "nativeSourceFile", path: filePath });
    }
  }

  if (missing.length) {
    issues.push(...missing.map((item) => `Missing ${item.name}: ${item.path}`));
    return {
      ok: false,
      issues,
      paths,
      nextAction: "Run `npm run browser-native:build:required` before installing or verifying the browser-first app.",
    };
  }

  const nativeInfoPlist = await readFile(paths.nativeInfoPlist, "utf8");
  if (!nativeInfoPlist.includes("<string>ResonantBrowserNativeHost</string>")) {
    issues.push("Native host Info.plist does not declare ResonantBrowserNativeHost as CFBundleExecutable.");
  }
  if (!nativeInfoPlist.includes("<string>ResonantOS Browser</string>")) {
    issues.push("Native host Info.plist does not declare ResonantOS Browser as CFBundleName.");
  }

  const extensionManifest = JSON.parse(await readFile(paths.resonantExtensionManifest, "utf8"));
  if (extensionManifest.manifest_version !== 3) {
    issues.push("ResonantOS browser extension must be Manifest V3.");
  }
  if (extensionManifest.name !== "ResonantOS Browser Layer") {
    issues.push("ResonantOS browser extension manifest name is not ResonantOS Browser Layer.");
  }

  const nativeExecutableMtime = await mtimeMs(paths.nativeExecutable);
  const nativeBridgeDylibMtime = await mtimeMs(paths.nativeBridgeDylib);
  const stagedBridgeDylibMtime = await mtimeMs(paths.stagedBridgeDylib);
  const newestNativeHostSourceMtime = Math.max(...(await Promise.all(paths.nativeHostSourceFiles.map(mtimeMs))));
  const newestNativeBridgeSourceMtime = Math.max(...(await Promise.all(paths.nativeBridgeSourceFiles.map(mtimeMs))));
  if (nativeExecutableMtime < newestNativeHostSourceMtime) {
    issues.push("Native host executable is older than native host source; rebuild with `npm run browser-native:build:required`.");
  }
  if (nativeBridgeDylibMtime < newestNativeBridgeSourceMtime) {
    issues.push("Native bridge dylib is older than native bridge source; rebuild with `npm run browser-native:build:required`.");
  }

  const stagedAppZipMtime = await mtimeMs(paths.stagedAppZip);
  if (stagedAppZipMtime < nativeExecutableMtime) {
    issues.push("Staged native app zip is older than the native executable; rebuild with `npm run browser-native:build:required`.");
  }
  if (stagedBridgeDylibMtime < nativeBridgeDylibMtime) {
    issues.push("Staged native bridge dylib is older than the built native bridge dylib; rebuild with `npm run browser-native:build:required`.");
  }

  return {
    ok: issues.length === 0,
    issues,
    paths,
    requiredMenus,
    nextAction: issues.length
      ? "Run `npm run browser-native:build:required` and rerun the browser-first verification."
      : "",
  };
}
