import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

function ensureInside(child, parent, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

export function resolveSourceRelativeFile(sourcePath, relativePath) {
  const normalized = String(relativePath ?? "").replace(/\\/g, "/");
  if (
    !normalized ||
    normalized === "." ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Selected source file path must stay inside the connected source.");
  }
  const resolved = path.resolve(sourcePath, normalized);
  const root = path.resolve(sourcePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Selected source file path escapes the connected source.");
  }
  return resolved;
}

export async function assertResolvedSourceFileInsideSource(sourcePath, sourceFile) {
  const details = await lstat(sourceFile);
  if (details.isSymbolicLink()) {
    throw new Error("Selected source file is a symbolic link and cannot be imported.");
  }
  if (!details.isFile()) {
    throw new Error("Selected source path must be a regular file.");
  }
  const [realSourceRoot, realSourceFile] = await Promise.all([
    realpath(sourcePath),
    realpath(sourceFile),
  ]);
  ensureInside(realSourceFile, realSourceRoot, "Selected source file resolves outside the connected source.");
  return details;
}
