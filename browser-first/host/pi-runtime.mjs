// Host-owned executable allowlist for the native Pi (OpenCode `pi`) CLI.
// Mirrors the opencode-runtime.mjs canonical-path discipline: a candidate is
// accepted only when it is a regular executable file whose realpath stays
// inside a fixed install root (or that root's npm-global lib/node_modules
// sibling). This is the ONLY place the `pi` command name is trusted — never a
// manifest field or a caller-supplied argv.
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const PI_COMMAND_NAMES = ["pi"];
export const PI_INSTALL_COMMAND = "npm install -g @earendil-works/pi-coding-agent";

function pathInside(candidatePath, root) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function installRoots({ homeDir, platform, npmPrefix }) {
  if (platform === "win32") return [];
  const npmGlobal = path.normalize(npmPrefix || path.join(homeDir, "npm-global"));
  return [
    { bin: path.join(npmGlobal, "bin"), canonicalRoots: [path.join(npmGlobal, "lib", "node_modules")], source: "npm-global" },
    { bin: path.join(homeDir, ".local", "bin"), canonicalRoots: [path.join(homeDir, ".local", "lib", "node_modules")], source: "fixed-user-install-root" },
    { bin: "/usr/local/bin", canonicalRoots: ["/usr/local/lib/node_modules"], source: "fixed-system-root" },
    { bin: "/usr/bin", canonicalRoots: [], source: "fixed-system-root" },
    { bin: "/bin", canonicalRoots: [], source: "fixed-system-root" },
  ];
}

// Returns { command, canonicalPath, source, validated_by } or null.
export function piCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return null;
  const homeDir = options.homeDir ?? os.homedir();
  const exists = options.exists ?? existsSync;
  const realpath = options.realpath ?? ((candidatePath) => realpathSync.native(candidatePath));
  const stat = options.stat ?? statSync;
  for (const { bin, canonicalRoots, source } of installRoots({
    homeDir, platform, npmPrefix: options.npmPrefix ?? process.env.NPM_CONFIG_PREFIX,
  })) {
    for (const name of PI_COMMAND_NAMES) {
      const candidatePath = path.join(bin, name);
      if (!exists(candidatePath)) continue;
      try {
        const details = stat(candidatePath);
        if (!details.isFile() || (details.mode & 0o111) === 0) continue;
        const canonicalPath = realpath(candidatePath);
        if (![bin, ...canonicalRoots].some((root) => pathInside(canonicalPath, root))) continue;
        return { command: candidatePath, canonicalPath, source, validated_by: "piRuntimeAllowlist" };
      } catch {
        // next candidate
      }
    }
  }
  return null;
}
