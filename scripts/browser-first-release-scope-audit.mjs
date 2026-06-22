#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const stagedOnly = args.has("--staged");
const includePathsOnly = args.has("--include-paths");
const nullSeparated = args.has("--null");

const runGit = (args) =>
  execFileSync("git", args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }).trim();

const splitLines = (value) => value.split("\n").map((line) => line.trim()).filter(Boolean);

const worktreeChangedPaths = () => [
  ...splitLines(runGit(["diff", "--name-only"])).map((path) => ({ path, state: "modified" })),
  ...splitLines(runGit(["ls-files", "--others", "--exclude-standard"])).map((path) => ({ path, state: "untracked" })),
];

const stagedChangedPaths = () =>
  splitLines(runGit(["diff", "--cached", "--name-only"])).map((path) => ({ path, state: "staged" }));

const changedPaths = stagedOnly ? stagedChangedPaths() : worktreeChangedPaths();

const includeDocs = new Set([
  "docs/ALPHA_PREVIEW_AUDIT_2026-04-28.md",
  "docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md",
  "docs/FEATURE_INVENTORY_2026-05-26.md",
  "docs/PRODUCT_GUIDE_BROWSER_FIRST.md",
  "docs/PROJECT_STATUS.md",
  "docs/README.md",
  "docs/UX_AUDIT_2026-06-01.md",
  "docs/architecture/addon-skills/living-archive/SOURCE_TO_WIKI_INTAKE.md",
]);

function classify(path) {
  if (path.startsWith("browser-first/")) {
    return {
      bucket: "include",
      reason: "Chrome extension, Node bridge host, or browser-first tests/docs",
    };
  }
  if (includeDocs.has(path)) {
    return {
      bucket: "include",
      reason: "browser-first release documentation",
    };
  }
  if (path.startsWith("addons/resonant-browser-host/")) {
    return {
      bucket: "include",
      reason: "pure Node browser host support package",
    };
  }
  if (path.startsWith("src/") || path.startsWith("public/addons/") || path.startsWith("scripts/") || path.startsWith(".github/")) {
    return {
      bucket: "include",
      reason: "shared alpha code, addon registry, release script, or CI",
    };
  }
  if (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "README.md" ||
    path === "SECURITY.md" ||
    path === "LICENSE.txt" ||
    path === "run-bridge-minimal.mjs" ||
    path === "vite.config.ts"
  ) {
    return {
      bucket: "include",
      reason: "alpha package metadata or release-facing documentation",
    };
  }
  if (/^(AUDIT-.*\.md|SECURITY-RED-TEAM-REPORT\.md)$/.test(path)) {
    return {
      bucket: "include",
      reason: "internal audit artifact removed from the public alpha surface",
    };
  }
  if (
    path.startsWith("electron-host/") ||
    path.startsWith("src-tauri/") ||
    path.startsWith("addons/resonant-browser-native/") ||
    path.startsWith("build/native-browser/") ||
    path === "rust-toolchain.toml"
  ) {
    return {
      bucket: "include",
      reason: "desktop/native host removal required for the Chrome extension alpha",
    };
  }
  if (path.startsWith("public/icons/custom/audio2tol") || path === "public/icons/icon-preview.html") {
    return {
      bucket: "include",
      reason: "alpha icon catalog cleanup for removed workspaces",
    };
  }
  if (path.startsWith("examples/living-archive-")) {
    return {
      bucket: "defer",
      reason: "Living Archive MCP/example bridge scope needs separate release decision",
    };
  }
  if (path.startsWith("docs/architecture/AUDIO2TOL_INTAKE_ANALYSIS.md")) {
    return {
      bucket: "defer",
      reason: "specialist media-intake documentation is not browser-first stabilization scope",
    };
  }
  if (path.startsWith("docs/")) {
    return {
      bucket: "review",
      reason: "documentation changed outside the approved browser-first docs list",
    };
  }
  return {
    bucket: "review",
    reason: "path is outside known browser-first release scope",
  };
}

const groups = new Map([
  ["include", []],
  ["defer", []],
  ["review", []],
]);

for (const entry of changedPaths) {
  const decision = classify(entry.path);
  groups.get(decision.bucket).push({ ...entry, ...decision });
}

if (includePathsOnly) {
  const paths = groups.get("include").map((entry) => entry.path);
  process.stdout.write(nullSeparated ? `${paths.join("\0")}${paths.length ? "\0" : ""}` : `${paths.join("\n")}${paths.length ? "\n" : ""}`);
  process.exit(0);
}

const printGroup = (label, rows) => {
  console.log(`\n${label}: ${rows.length}`);
  for (const row of rows) {
    console.log(`- ${row.state.padEnd(9)} ${row.path} :: ${row.reason}`);
  }
};

console.log("Browser-first release scope audit");
console.log(`Mode: ${stagedOnly ? "staged index" : "worktree"}`);
console.log(`Changed paths: ${changedPaths.length}`);
printGroup("Include with browser-first", groups.get("include"));
printGroup("Defer to separate commit/release", groups.get("defer"));
printGroup("Needs manual review", groups.get("review"));

const missing = [...includeDocs]
  .filter((path) => !existsSync(new URL(`../${path}`, import.meta.url)))
  .filter((path) => path !== "docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md");

if (missing.length > 0) {
  console.log("\nMissing expected release-scope files:");
  for (const path of missing) {
    console.log(`- ${path}`);
  }
}

const largeIncluded = groups.get("include")
  .map((entry) => ({ ...entry, absolute: new URL(`../${entry.path}`, import.meta.url) }))
  .filter((entry) => existsSync(entry.absolute) && statSync(entry.absolute).isFile())
  .map((entry) => ({ ...entry, size: statSync(entry.absolute).size }))
  .filter((entry) => entry.size > 1_000_000);

if (largeIncluded.length > 0) {
  console.log("\nLarge included files require review:");
  for (const entry of largeIncluded) {
    console.log(`- ${entry.path} (${entry.size} bytes)`);
  }
}

const hasBlockingScope = groups.get("review").length > 0 || groups.get("defer").length > 0 || missing.length > 0 || largeIncluded.length > 0;

if (strict && hasBlockingScope) {
  console.error("\nStrict mode failed: deferred/review/missing/large paths are present. Stage only approved browser-first paths or split commits.");
  process.exitCode = 1;
} else if (hasBlockingScope) {
  console.log("\nNon-strict audit complete: deferred or review paths exist. Do not push a mixed release without splitting or documenting them.");
}
