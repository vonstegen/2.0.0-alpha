#!/usr/bin/env node

import { execFile } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_CONTENT_SCAN_LIMIT = DEFAULT_MAX_FILE_SIZE;
const FORBIDDEN_DIRECTORY_NAMES = new Set([
  "output",
  "runs",
  ".abacusai",
  ".codex",
  ".understand-anything",
  "ResonantOS_User",
  ".venv",
  "venv",
]);
const BROWSER_PROFILE_DATABASES = new Set([
  "Cookies",
  "Login Data",
  "History",
  "Web Data",
  "Local State",
]);
const CREDENTIAL_RULES = [
  {
    rule: "credential-anthropic",
    pattern: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-openai",
    pattern: /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:api-)?[A-Za-z0-9][A-Za-z0-9_-]{15,}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-google-ai",
    pattern: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-aws",
    pattern: /(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])/g,
  },
  {
    rule: "credential-xai",
    pattern: /(?<![A-Za-z0-9_-])xai-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-github",
    pattern: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{50,})(?![A-Za-z0-9_])/g,
  },
  {
    rule: "credential-groq",
    pattern: /(?<![A-Za-z0-9_])gsk_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-replicate",
    pattern: /(?<![A-Za-z0-9_])rpa_[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g,
  },
  {
    rule: "credential-minimax",
    pattern: /\bMINIMAX_API_KEY\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{19,}["']?/g,
  },
  {
    rule: "credential-zai",
    pattern: /\bZAI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{19,}["']?/g,
  },
  {
    rule: "credential-glm",
    pattern: /\bGLM_API_KEY\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{19,}["']?/g,
  },
  {
    rule: "credential-zhipu",
    pattern: /\bZHIPUAI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9._-]{19,}["']?/g,
  },
];

function normalizePath(path) {
  const nativePath = String(path);
  const separatorNormalized = sep === "\\" ? nativePath.replaceAll("\\", "/") : nativePath;
  return separatorNormalized.replace(/^\.\//, "");
}

function isAllowlisted(path, allowlist) {
  const normalizedPath = normalizePath(path);
  if (typeof allowlist === "function") {
    return Boolean(allowlist(normalizedPath));
  }
  if (allowlist instanceof Set) {
    return allowlist.has(normalizedPath) || allowlist.has(path);
  }
  return Array.isArray(allowlist)
    ? allowlist.some((entry) => normalizePath(entry) === normalizedPath)
    : false;
}

function violation(path, rule, message) {
  return { path: normalizePath(path), rule, message };
}

export function classifyPath(path, stat, options = {}) {
  const normalizedPath = normalizePath(path);
  const segments = normalizedPath.split("/").filter(Boolean);
  const forbiddenSegment = segments.find((segment) => FORBIDDEN_DIRECTORY_NAMES.has(segment));

  if (stat?.isSymbolicLink?.()) {
    return violation(
      normalizedPath,
      "symlink",
      "Remove symbolic links; repository hygiene candidates must be regular files.",
    );
  }

  if (forbiddenSegment) {
    return violation(
      normalizedPath,
      "forbidden-path",
      `Remove or archive repository-local ${forbiddenSegment}/ artifacts outside the repository.`,
    );
  }

  if (normalizedPath.toLowerCase().endsWith(".zip")) {
    return violation(
      normalizedPath,
      "archive",
      "Remove or archive ZIP artifacts outside the repository.",
    );
  }

  if (BROWSER_PROFILE_DATABASES.has(basename(normalizedPath))) {
    return violation(
      normalizedPath,
      "browser-profile",
      "Remove browser profile databases and keep them outside the repository.",
    );
  }

  const maximumSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const sizeAllowlist = options.sizeAllowlist ?? options.largeFileAllowlist;
  if (stat?.isFile?.() && stat.size > maximumSize && !isAllowlisted(normalizedPath, sizeAllowlist)) {
    return violation(
      normalizedPath,
      "large-file",
      `File is ${stat.size} bytes; reduce it or add it to the explicit size allowlist (limit ${maximumSize} bytes).`,
    );
  }

  return null;
}

function decodeText(content) {
  if (typeof content === "string") {
    return content.includes("\0") ? null : content;
  }
  if (!ArrayBuffer.isView(content)) {
    return null;
  }

  const bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  if (bytes.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function isObviousCredentialPlaceholder(candidate) {
  const assignment = candidate.match(/[:=]\s*["']?([^\s"']+)/);
  const value = (assignment?.[1] ?? candidate)
    .replace(/^(?:sk-ant-api\d*-|sk-api-|sk-|AIza|AKIA|xai-|gh[pousr]_|github_pat_|gsk_|rpa_)/i, "")
    .replace(/["']$/, "");
  const collapsed = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const placeholderWords = /^(?:(?:example|placeholder|redacted|replacewithyour(?:api)?(?:key|token)|dummy|fake|sample|test|your(?:api)?(?:key|token)|changeme|notareal(?:key|token)?))+(?:\d+)?$/;
  return placeholderWords.test(collapsed)
    || /^(?:[a-z0-9]+)?envcredential$/.test(collapsed)
    || /^([A-Za-z0-9])\1{11,}$/.test(value)
    || /^(?:(?:0123456789|1234567890|abcdefghijklmnop))+$/.test(value.toLowerCase());
}

export function classifyContent(path, content, options = {}) {
  const normalizedPath = normalizePath(path);
  const text = decodeText(content);
  if (text === null) {
    return null;
  }

  if (!isAllowlisted(normalizedPath, options.contentAllowlist)
      && /\/Users\/dr\.tom\//.test(text)) {
    return violation(
      normalizedPath,
      "founder-path",
      "Replace the founder-specific /Users/dr.tom/ path or add this historical fixture to the explicit content allowlist.",
    );
  }

  for (const { rule, pattern } of CREDENTIAL_RULES) {
    for (const match of text.matchAll(pattern)) {
      if (!isObviousCredentialPlaceholder(match[0])) {
        return violation(
          normalizedPath,
          rule,
          "Remove the detected credential from the repository and rotate it if it was active.",
        );
      }
    }
  }

  return null;
}

async function isGitRepository(root) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--is-inside-work-tree"],
      { encoding: "utf8" },
    );
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function listGitCandidates(root) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  const paths = [];
  const violations = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;

  while (offset < stdout.length) {
    const delimiter = stdout.indexOf(0, offset);
    const end = delimiter === -1 ? stdout.length : delimiter;
    const encodedPath = stdout.subarray(offset, end);
    offset = delimiter === -1 ? stdout.length : delimiter + 1;
    if (encodedPath.length === 0) {
      continue;
    }

    try {
      paths.push(normalizePath(decoder.decode(encodedPath)));
    } catch {
      const preview = encodedPath.subarray(0, 24).toString("hex");
      violations.push(violation(
        `<git-path:${preview}>`,
        "unsupported-path-encoding",
        "Git reported a candidate path that is not valid UTF-8; rename or remove it before scanning.",
      ));
    }
  }

  paths.sort();
  return { paths, violations };
}

async function listFilesystemCandidates(root) {
  const candidates = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else {
        candidates.push(normalizePath(relative(root, absolutePath)));
      }
    }
  }

  await visit(root);
  return { paths: candidates, violations: [] };
}

function contentScanLimit(options) {
  const limit = options.contentScanLimit ?? DEFAULT_CONTENT_SCAN_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new TypeError("contentScanLimit must be a non-negative safe integer");
  }
  return limit;
}

async function readBounded(handle, fileSize, limit) {
  const targetSize = Math.min(fileSize, limit);
  const content = Buffer.alloc(targetSize);
  let offset = 0;

  while (offset < targetSize) {
    const { bytesRead } = await handle.read(content, offset, targetSize - offset, offset);
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }

  return content.subarray(0, offset);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(left, right) {
  return sameFile(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function isContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  return relativePath === ""
    || (relativePath !== ".."
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath));
}

async function inspectContentNoFollow(repositoryRealPath, absolutePath, path, expectedStat, options) {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new Error("Content scanning requires filesystem O_NOFOLLOW support");
  }

  let candidateRealPath;
  try {
    candidateRealPath = await realpath(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { content: null };
    }
    throw error;
  }
  if (!isContainedPath(repositoryRealPath, candidateRealPath)) {
    return { violation: violation(
      path,
      "path-escape",
      "Candidate resolves outside the repository through a symbolic-link ancestor; remove the link.",
    ) };
  }

  let handle;
  try {
    handle = await open(
      absolutePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (error?.code === "ELOOP") {
      return { violation: violation(
        path,
        "symlink",
        "Candidate changed to a symbolic link before content scanning; remove the link.",
      ) };
    }
    if (error?.code === "ENOENT") {
      return { content: null };
    }
    throw error;
  }

  try {
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) {
      return { violation: violation(
        path,
        "file-type-changed",
        "Candidate changed file type before content scanning; retry after stabilizing the worktree.",
      ) };
    }
    if (!sameFile(expectedStat, openedStat)) {
      return { violation: violation(
        path,
        "file-changed",
        "Candidate was replaced before content scanning; retry after stabilizing the worktree.",
      ) };
    }

    const openedPathViolation = classifyPath(path, openedStat, options);
    if (openedPathViolation) {
      return { violation: openedPathViolation };
    }

    const content = await readBounded(handle, openedStat.size, contentScanLimit(options));
    const completedStat = await handle.stat();
    if (!sameFileSnapshot(openedStat, completedStat)) {
      return { violation: violation(
        path,
        "file-changed-during-read",
        "Candidate changed during bounded content scanning; retry after stabilizing the worktree.",
      ) };
    }

    return { content };
  } finally {
    await handle.close();
  }
}

export async function scanRepository(root, options = {}) {
  const absoluteRoot = resolve(root);
  const repositoryRealPath = await realpath(absoluteRoot);
  const inventory = await (await isGitRepository(absoluteRoot)
    ? listGitCandidates(absoluteRoot)
    : listFilesystemCandidates(absoluteRoot));
  const violations = [...inventory.violations];

  for (const path of inventory.paths) {
    const absolutePath = join(absoluteRoot, ...path.split("/"));
    let stat;
    try {
      stat = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const pathViolation = classifyPath(path, stat, options);
    if (pathViolation) {
      violations.push(pathViolation);
      continue;
    }

    if (options.checkContent && stat.isFile()) {
      const inspection = await inspectContentNoFollow(
        repositoryRealPath,
        absolutePath,
        path,
        stat,
        options,
      );
      if (inspection.violation) {
        violations.push(inspection.violation);
        continue;
      }
      if (inspection.content === null) {
        continue;
      }
      const contentViolation = classifyContent(path, inspection.content, options);
      if (contentViolation) {
        violations.push(contentViolation);
      }
    }
  }

  return violations;
}

function parseCliOptions(args) {
  const contentAllowlist = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--content-allowlist") {
      const path = args[index + 1];
      if (!path) {
        throw new Error("--content-allowlist requires a repository-relative path");
      }
      contentAllowlist.push(path);
      index += 1;
    } else if (argument.startsWith("--content-allowlist=")) {
      const path = argument.slice("--content-allowlist=".length);
      if (!path) {
        throw new Error("--content-allowlist requires a repository-relative path");
      }
      contentAllowlist.push(path);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return { checkContent: true, contentAllowlist };
}

async function main() {
  const violations = await scanRepository(process.cwd(), parseCliOptions(process.argv.slice(2)));
  const contentPolicy = `Content scan policy: prefix-only, first ${DEFAULT_CONTENT_SCAN_LIMIT} bytes (10 MiB) per file; size-allowlisted larger files are not fully scanned.`;
  if (violations.length === 0) {
    console.log(`Repository hygiene check passed. ${contentPolicy}`);
    return;
  }

  console.error(`Repository hygiene check found ${violations.length} violation(s):`);
  console.error(contentPolicy);
  for (const entry of violations) {
    console.error(`- ${quoteDiagnostic(entry.path)} [${entry.rule}]: ${entry.message}`);
  }
  process.exitCode = 1;
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
  }
}

function quoteDiagnostic(value) {
  return JSON.stringify(String(value)).replace(/[\u007f-\u009f]/g, (character) =>
    `\\u${character.codePointAt(0).toString(16).padStart(4, "0")}`);
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(`Repository hygiene check failed: ${quoteDiagnostic(error.message)}`);
    process.exitCode = 1;
  });
}
