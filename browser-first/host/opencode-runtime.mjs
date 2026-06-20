import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { redactPathForDiagnostics } from "./browser-first-host-utils.mjs";

export const OPENCODE_INSTALL_COMMAND = "curl -fsSL https://opencode.ai/install | bash";
export const OPENCODE_NPM_INSTALL_COMMAND = "npm install -g opencode-ai";
export const OPENCODE_BREW_INSTALL_COMMAND = "brew install anomalyco/tap/opencode";
export const OPENCODE_CONFIGURE_COMMAND = "OPENCODE_COMMAND=/absolute/path/to/opencode";
export const OPENCODE_COMMAND_NAMES = ["opencode", "opencode-ai"];

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function expandUserPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function executableNames(commandName) {
  return process.platform === "win32"
    ? [`${commandName}.cmd`, `${commandName}.exe`, `${commandName}.bat`, commandName]
    : [commandName];
}

function executableCandidatesFromPath(commandName, env = process.env) {
  return String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => executableNames(commandName).map((name) => path.join(entry, name)));
}

function commonOpenCodeBaseDirs(env = process.env) {
  const home = os.homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, "node_modules", ".bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".yarn", "bin"),
    path.join(home, ".config", "yarn", "global", "node_modules", ".bin"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, "Library", "pnpm"),
  ];
  if (process.platform === "darwin") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  }
  if (process.platform === "win32") {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    dirs.push(path.join(home, "scoop", "shims"));
  }
  return unique(dirs);
}

function commonOpenCodeCandidates(env = process.env) {
  const names = OPENCODE_COMMAND_NAMES.flatMap(executableNames);
  const candidates = commonOpenCodeBaseDirs(env).flatMap((dir) => names.map((name) => path.join(dir, name)));
  if (process.platform === "darwin") {
    candidates.push("/Applications/OpenCode.app/Contents/MacOS/opencode-cli");
    candidates.push("/Applications/OpenCode Desktop.app/Contents/MacOS/opencode-cli");
  }
  return candidates;
}

function fileExists(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function opencodeInstallHint() {
  return [
    `Install OpenCode with \`${OPENCODE_INSTALL_COMMAND}\`.`,
    `Node users can use \`${OPENCODE_NPM_INSTALL_COMMAND}\`; Homebrew users can use \`${OPENCODE_BREW_INSTALL_COMMAND}\`.`,
    `If OpenCode is already installed outside PATH, set \`${OPENCODE_CONFIGURE_COMMAND}\` and restart ResonantOS.`
  ].join(" ");
}

export function opencodeCandidatePaths(options = {}) {
  const env = options.env ?? process.env;
  const includeCommonCandidates = options.includeCommonCandidates !== false;
  const overridePath = expandUserPath(env.OPENCODE_COMMAND);
  return unique([
    overridePath,
    ...OPENCODE_COMMAND_NAMES.flatMap((commandName) => executableCandidatesFromPath(commandName, env)),
    ...(includeCommonCandidates ? commonOpenCodeCandidates(env) : []),
  ]);
}

export function opencodeRuntimeDiagnostics(options = {}) {
  const env = options.env ?? process.env;
  const displayLimit = Number.isInteger(options.displayLimit) && options.displayLimit > 0 ? options.displayLimit : 48;
  const overridePath = expandUserPath(env.OPENCODE_COMMAND);
  const candidates = opencodeCandidatePaths(options);
  const command = candidates.find(fileExists) ?? null;
  const searchedPaths = candidates.map(redactPathForDiagnostics).slice(0, displayLimit);
  return {
    installed: Boolean(command),
    command,
    commandRedacted: command ? redactPathForDiagnostics(command) : "",
    installHint: opencodeInstallHint(),
    installCommand: OPENCODE_INSTALL_COMMAND,
    alternativeInstallCommands: [OPENCODE_NPM_INSTALL_COMMAND, OPENCODE_BREW_INSTALL_COMMAND],
    configureCommand: OPENCODE_CONFIGURE_COMMAND,
    searchedCommands: OPENCODE_COMMAND_NAMES,
    searchedPaths,
    searchedPathCount: candidates.length,
    searchedPathOmitted: Math.max(0, candidates.length - searchedPaths.length),
    overrideConfigured: Boolean(overridePath),
    overridePath: overridePath ? redactPathForDiagnostics(overridePath) : "",
    overrideFound: overridePath ? fileExists(overridePath) : false,
  };
}

export function opencodeCommand(options = {}) {
  return opencodeRuntimeDiagnostics(options).command;
}
