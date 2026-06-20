export const cefBuild = Object.freeze({
  cefVersion: "147.0.10+gd58e84d+chromium-147.0.7727.118",
  chromiumVersion: "147.0.7727.118",
  channel: "stable",
  fileType: "standard",
});

export function cefBuildDirectoryName(platform) {
  return `cef_binary_${cefBuild.cefVersion}_${platform}`;
}

export function cefArchiveName(platform) {
  return `${cefBuildDirectoryName(platform)}.tar.bz2`;
}
