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
  "docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md",
  "docs/FEATURE_INVENTORY_2026-05-26.md",
  "docs/PRODUCT_GUIDE_BROWSER_FIRST.md",
  "docs/PROJECT_STATUS.md",
  "docs/README.md",
  "docs/UX_AUDIT_2026-06-01.md",
  "docs/architecture/addon-skills/living-archive/SOURCE_TO_WIKI_INTAKE.md",
]);

const includeNativeBrowser = new Set([
  "addons/resonant-browser-host/test/browser-host.test.mjs",
  "addons/resonant-browser-native/native_host/src/resonant_browser_native_bridge_mac.mm",
  "addons/resonant-browser-native/native_host/src/resonant_browser_native_host.cc",
]);

function classify(path) {
  if (path.startsWith("browser-first/")) {
    return {
      bucket: "include",
      reason: "browser-first product code, tests, or docs",
    };
  }
  if (includeDocs.has(path)) {
    return {
      bucket: "include",
      reason: "browser-first release documentation",
    };
  }
  if (includeNativeBrowser.has(path)) {
    return {
      bucket: "include",
      reason: "native browser host behavior required by browser-first",
    };
  }
  if (path === "scripts/browser-first-release-scope-audit.mjs") {
    return {
      bucket: "include",
      reason: "browser-first release hygiene tool",
    };
  }
  if (path === "package.json") {
    return {
      bucket: "include",
      reason: "exposes browser-first release audit command",
    };
  }
  if (path.startsWith("electron-host/")) {
    return {
      bucket: "defer",
      reason: "Electron host is experimental/deprecated for current browser-first branch",
    };
  }
  if (path.startsWith("examples/living-archive-")) {
    return {
      bucket: "defer",
      reason: "Living Archive MCP/example bridge scope needs separate release decision",
    };
  }
  if (path.startsWith("src/") || path.startsWith("src-tauri/") || path.startsWith("public/addons/") || path.startsWith("scripts/")) {
    return {
      bucket: "defer",
      reason: "legacy desktop/shared vNext change; keep separate unless explicitly tied to browser-first",
    };
  }
  if (path.startsWith("docs/architecture/AUDIO2TOL_INTAKE_ANALYSIS.md")) {
    return {
      bucket: "defer",
      reason: "Audio2TOL example update is not browser-first stabilization scope",
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

const missing = [...includeDocs, ...includeNativeBrowser]
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
