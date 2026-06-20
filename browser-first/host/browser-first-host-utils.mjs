import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export function uniqueRuntimeId(prefix) {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export function parseArgs(argv) {
  const parsed = new Map();
  for (const arg of argv) {
    const [key, ...valueParts] = arg.replace(/^--/, "").split("=");
    parsed.set(key, valueParts.length ? valueParts.join("=") : "true");
  }
  return parsed;
}

export function expandUserPath(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

export function redactPathForDiagnostics(filePath) {
  return String(filePath ?? "").replace(os.homedir(), "~");
}

export function redactDiagnosticText(value) {
  return String(value ?? "")
    .replace(/sk-[a-z0-9_-]+/gi, "[redacted-key]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted-token]")
    .replace(/api[_-]?key\s*[:=]\s*[^\s]+/gi, "api_key=[redacted]")
    .replace(/token\s*[:=]\s*[^\s]+/gi, "token=[redacted]")
    .replace(/secret\s*[:=]\s*[^\s]+/gi, "secret=[redacted]")
    .replace(os.homedir(), "~");
}

export function executableCandidates(commandName) {
  const names = process.platform === "win32"
    ? [`${commandName}.cmd`, `${commandName}.exe`, commandName]
    : [commandName];
  return String(process.env.PATH ?? "")
    .split(path.delimiter)
    .flatMap((entry) => names.map((name) => path.join(entry, name)));
}

export async function execFileStdout(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const needsWindowsCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(String(command));
    execFile(command, args, {
      timeout: 120_000,
      windowsHide: true,
      shell: needsWindowsCommandShell,
      ...options,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(String(stderr || error.message || "Command failed.").trim()));
        return;
      }
      resolve(String(stdout ?? "").trim());
    });
  });
}

export function firstExistingExecutable(commandName) {
  return executableCandidates(commandName).find((candidate) => existsSync(candidate)) ?? null;
}

export function dashboardTarget(host = "127.0.0.1", port = 9119) {
  const normalizedHost = String(host || "127.0.0.1").trim().toLowerCase();
  if (!["127.0.0.1", "localhost"].includes(normalizedHost)) {
    throw new Error("Hermes dashboard can only bind to localhost or 127.0.0.1 from ResonantOS.");
  }
  const normalizedPort = Number(port || 9119);
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error("Hermes dashboard port must be between 1 and 65535.");
  }
  return { host: "127.0.0.1", port: normalizedPort, url: `http://127.0.0.1:${normalizedPort}` };
}

export async function socketOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(350);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

export function safeFileSlug(value) {
  return String(value ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

export function stableMemorySourceId(kind, expandedPath) {
  const readablePrefix = safeFileSlug(`${kind}-${path.basename(expandedPath) || "source"}`);
  const hash = createHash("sha256").update(`${kind}\0${expandedPath}`).digest("hex").slice(0, 12);
  return `source-${readablePrefix.slice(0, 80 - hash.length - 1)}-${hash}`;
}

export function isInsidePath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function listFilesRecursive(root, predicate, limit = 300) {
  const files = [];
  async function walk(current) {
    if (files.length >= limit || !existsSync(current)) {
      return;
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= limit || entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  await walk(root);
  return files;
}

export async function countFiles(root, predicate) {
  return (await listFilesRecursive(root, predicate, 10_000)).length;
}

export async function pathSummary(filePath) {
  if (!existsSync(filePath)) {
    return { exists: false, path: filePath };
  }
  const details = await stat(filePath);
  return {
    exists: true,
    path: filePath,
    bytes: details.size,
    modifiedAt: details.mtime.toISOString(),
  };
}
