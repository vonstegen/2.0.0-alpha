export function isLaunchServicesExecutableBlocked(message = "") {
  return /kLSNoExecutableErr|-10827|LaunchServices|LSOpenCore/.test(String(message));
}

export function canFallbackToDirectLauncher(installedApp = {}) {
  return Boolean(
    installedApp.exists &&
    installedApp.executableExists &&
    installedApp.bundleExecutableDeclared &&
    installedApp.launcherSourceExists &&
    installedApp.launcherRepoRootMatches &&
    installedApp.launcherScriptMatches &&
    installedApp.launcherLogPathMatches &&
    installedApp.launcherUsesExec !== false &&
    installedApp.launcherForksAndExits !== true &&
    installedApp.diagnostics?.codesign?.ok !== false &&
    installedApp.diagnostics?.plistLint?.ok !== false &&
    installedApp.diagnostics?.xattrs?.hasQuarantine !== true
  );
}

export function isLocalBridgeSandboxBlocked(summary = {}) {
  const bridge = summary?.bridge ?? {};
  const message = String(bridge.message ?? "");
  return Boolean(
    bridge.status === "failed" &&
    bridge.code === "EPERM" &&
    /listen EPERM/.test(message) &&
    /127\.0\.0\.1/.test(message)
  );
}
