import { createHash } from "node:crypto";
import path from "node:path";

function backupTimestampSegment(timestamp) {
  return String(timestamp ?? "")
    .trim()
    .replace(/[:.]/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown-time";
}

export function promotionBackupFilename(pagePath) {
  const normalized = String(pagePath ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^AI_MEMORY\/wiki\//, "")
    .replace(/^\/+/, "");
  const extension = [".md", ".markdown"].includes(path.extname(normalized).toLowerCase())
    ? path.extname(normalized).toLowerCase()
    : ".md";
  const withoutExtension = normalized.slice(0, normalized.length - path.extname(normalized).length) || normalized || "page";
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "page";
  const hash = createHash("sha256").update(normalized || "page").digest("hex").slice(0, 12);
  return `${slug}-${hash}${extension}`;
}

export function promotionBackupPath({ memoryRoot, pagePath, timestamp, category = "promotions" } = {}) {
  const safeCategory = category === "restores" ? "restores" : "promotions";
  return path.join(
    memoryRoot,
    "AI_MEMORY",
    "backups",
    safeCategory,
    backupTimestampSegment(timestamp),
    promotionBackupFilename(pagePath)
  );
}
