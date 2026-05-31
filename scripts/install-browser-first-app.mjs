import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrowserFirstNativeAssets } from "./browser-first-native-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installRoot = process.env.RESONANTOS_BROWSER_INSTALL_ROOT ?? path.join(os.homedir(), "Applications");
const targetApp = path.join(installRoot, "ResonantOS Browser.app");
const contentsDir = path.join(targetApp, "Contents");
const macosDir = path.join(contentsDir, "MacOS");
const resourcesDir = path.join(contentsDir, "Resources");
const executableName = "ResonantOSBrowserLauncher";
const executablePath = path.join(macosDir, executableName);
const launcherSourcePath = path.join(resourcesDir, `${executableName}.c`);
const macosDeploymentTarget = process.env.MACOSX_DEPLOYMENT_TARGET ?? "12.0";
const logPath = path.join(repoRoot, "logs", "browser-first-installed-app.log");
const launchScriptPath = path.join(repoRoot, "browser-first", "host", "run-browser-first.mjs");
const launchServicesRegisterPath =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function runBestEffort(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe" });
  return {
    command,
    args,
    ok: result.status === 0,
    status: result.status,
    stderr: result.stderr?.toString().trim() ?? "",
    stdout: result.stdout?.toString().trim() ?? "",
  };
}

function removeExtendedAttribute(attributeName) {
  const remove = runBestEffort("xattr", ["-dr", attributeName, targetApp]);
  const probe = spawnSync("xattr", ["-p", attributeName, targetApp], { stdio: "pipe" });
  return {
    ...remove,
    attributeName,
    verifiedAbsent: probe.status !== 0,
  };
}

const nativeAssets = await validateBrowserFirstNativeAssets({ repoRoot });
if (!nativeAssets.ok) {
  throw new Error(`Browser-first native assets are not ready:\n- ${nativeAssets.issues.join("\n- ")}\n${nativeAssets.nextAction}`);
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleExecutable</key>
  <string>${executableName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.resonantos.browser-first.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>ResonantOS Browser</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

const cString = (value) => JSON.stringify(value);
const launcherSource = `#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>

int main(void) {
  setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", 1);
  if (chdir(${cString(repoRoot)}) != 0) {
    return 70;
  }
  system("mkdir -p logs");
  int log_fd = open(${cString(logPath)}, O_CREAT | O_WRONLY | O_APPEND, 0644);
  if (log_fd >= 0) {
    dup2(log_fd, STDOUT_FILENO);
    dup2(log_fd, STDERR_FILENO);
    close(log_fd);
  }
  execlp("node", "node", ${cString(launchScriptPath)}, (char*)0);
  return 71;
}
`;

await rm(targetApp, { recursive: true, force: true });
await mkdir(macosDir, { recursive: true });
await mkdir(resourcesDir, { recursive: true });
await writeFile(path.join(contentsDir, "Info.plist"), plist);
await writeFile(path.join(contentsDir, "PkgInfo"), "APPL????");
await writeFile(launcherSourcePath, launcherSource);
const compile = spawnSync("clang", [`-mmacosx-version-min=${macosDeploymentTarget}`, launcherSourcePath, "-o", executablePath], {
  stdio: "pipe",
});
if (compile.status !== 0) {
  throw new Error(`Failed to compile app launcher: ${compile.stderr?.toString() || compile.stdout?.toString()}`);
}
await chmod(executablePath, 0o755);
const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", targetApp], { stdio: "pipe" });
if (sign.status !== 0) {
  throw new Error(`Failed to sign app launcher: ${sign.stderr?.toString() || sign.stdout?.toString()}`);
}

const postInstall = {
  clearQuarantine: removeExtendedAttribute("com.apple.quarantine"),
  clearProvenance: removeExtendedAttribute("com.apple.provenance"),
  registerLaunchServices: runBestEffort(launchServicesRegisterPath, ["-f", targetApp]),
};

console.log(JSON.stringify({
  ok: true,
  targetApp,
  executablePath,
  repoRoot,
  logPath,
  macosDeploymentTarget,
  nativeAssets: {
    ok: nativeAssets.ok,
    nativeApp: nativeAssets.paths.nativeApp,
    stagedAppZip: nativeAssets.paths.stagedAppZip,
  },
  postInstall,
}, null, 2));
