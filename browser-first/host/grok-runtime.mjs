// Host-owned executable allowlist for the official Grok CLI ("Grok Build",
// installed via `curl -fsSL https://x.ai/cli/install.sh | bash`). Mirrors the
// pi-runtime.mjs canonical-path discipline: a candidate is accepted only when
// it is a regular executable file whose realpath stays inside a fixed install
// root — `~/.grok/bin` (default install) or the GROK_BIN_DIR override.
// This is the ONLY place the `grok` command name is trusted — never a manifest
// field or a caller-supplied argv.
import { existsSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const GROK_COMMAND_NAMES = ["grok"];
export const GROK_INSTALL_COMMAND = "curl -fsSL https://x.ai/cli/install.sh | bash";

function pathInside(candidatePath, root) {
  const relative = path.relative(root, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function installRoots({ homeDir, env, platform }) {
  if (platform === "win32") return [];
  const explicit = typeof env?.GROK_BIN_DIR === "string" && env.GROK_BIN_DIR.trim();
  if (explicit) {
    const bin = path.normalize(explicit);
    return [{ bin, canonicalRoots: [bin], source: "GROK_BIN_DIR" }];
  }
  const defaultBin = path.join(homeDir, ".grok", "bin");
  return [{
    bin: defaultBin,
    // Realpath of `~/.grok/bin/grok` may resolve into the install root itself
    // (the installer drops the binary there) or into the npm-global sibling
    // (a symlink target). Either satisfies canonicality.
    canonicalRoots: [path.join(homeDir, ".grok"), path.normalize(path.join(homeDir, ".grok", "bin"))],
    source: "~/.grok/bin",
  }];
}

// Returns { command, canonicalPath, source, validated_by } or null.
export function grokCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return null;
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const realpath = options.realpath ?? ((candidatePath) => realpathSync.native(candidatePath));
  const stat = options.stat ?? statSync;
  for (const { bin, canonicalRoots, source } of installRoots({ homeDir, env, platform })) {
    for (const name of GROK_COMMAND_NAMES) {
      const candidate = path.join(bin, name);
      let stats;
      try { stats = stat(candidate); } catch { continue; }
      if (!stats.isFile() && !stats.isSymbolicLink()) continue;
      try {
        if (stats.isFile() && (stats.mode & 0o111) === 0) continue;
      } catch { continue; }
      if (typeof options.exists === "function" ? !exists(candidate) : !exists(candidate)) continue;
      let canonical;
      try { canonical = realpath(candidate); } catch { continue; }
      try { canonical = realpath(canonical); } catch { /* follow-through; canonical already from first call */ }
      if (!canonicalRoots.some((root) => pathInside(canonical, root))) continue;
      return {
        command: candidate,
        canonicalPath: canonical,
        source,
        validated_by: "grok-runtime.mjs#grokCommand",
      };
    }
  }
  return null;
}
