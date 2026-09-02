#!/usr/bin/env node
// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md
// Intent citation: docs/architecture/resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md (decision 4)
//
// CP-5 follow-up: `npm run validate:manifest <path>` — makes Tom's
// "Make validate:manifest real" recommendation concrete.
//
// Usage:
//   node scripts/validate-addon-manifest.mjs <manifest.json> [<manifest.json> ...]
//   node scripts/validate-addon-manifest.mjs --all    # validate every manifest under public/addons/
//
// Exits 0 if all manifests are valid, 1 otherwise. Prints a per-file
// summary to stdout; details for invalid files go to stderr.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateAddOnManifest } from "../src/sdk/addons/validation.ts";

function loadManifest(path) {
  const absolute = resolve(path);
  const raw = readFileSync(absolute, "utf8");
  return { absolute, raw: JSON.parse(raw) };
}

function validateOne(path) {
  let loaded;
  try {
    loaded = loadManifest(path);
  } catch (error) {
    return {
      path,
      ok: false,
      fatal: true,
      error: `could not read/parse manifest: ${error.message}`,
    };
  }
  const result = validateAddOnManifest(loaded.raw);
  return {
    path,
    ok: result.valid,
    issues: result.issues ?? [],
    fatal: false,
  };
}

function discoverAllManifests() {
  const root = resolve("public/addons");
  return readdirSync(root)
    .filter((entry) => entry.endsWith(".json") && entry !== "index.json" && entry !== "dev-index.json")
    .map((entry) => resolve(root, entry));
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.error("usage: validate:manifest <manifest.json> [...] | --all");
    process.exit(2);
  }
  const paths = argv[0] === "--all" ? discoverAllManifests() : argv;
  const results = paths.map(validateOne);

  let failed = 0;
  for (const entry of results) {
    if (entry.fatal) {
      console.error(`FAIL  ${entry.path}  (${entry.error})`);
      failed += 1;
      continue;
    }
    if (entry.ok) {
      console.log(`ok    ${entry.path}`);
      continue;
    }
    failed += 1;
    console.error(`FAIL  ${entry.path}`);
    for (const issue of entry.issues) {
      console.error(`      - ${JSON.stringify(issue)}`);
    }
  }

  const total = results.length;
  const passed = total - failed;
  console.log(`\n${passed}/${total} manifests valid.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();