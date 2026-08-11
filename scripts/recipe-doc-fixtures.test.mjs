#!/usr/bin/env node
// Acceptance fixtures for docs/recipes/. Run via `node --test` or the
// `test:recipes` npm script. See recipe-doc-fixtures.mjs for the source of
// each assertion.
//
// Pulled into the docs gate via `npm run test:docs` so it runs on every PR
// that touches docs/, recipes/, or the recipes index. Test-cost is
// bounded (small file reads, deterministic) and the suite is intentionally
// independent of the network, the bridge, and Chrome.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  listRecipes,
  validateIndex,
  validateRecipe,
} from "./recipe-doc-fixtures.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("Augmentor recipes fixture (issue #237)", () => {
  it("lists exactly four recipe files", () => {
    const recipes = listRecipes();
    assert.equal(
      recipes.length,
      4,
      `Expected 4 recipes; got ${recipes.length}: ${recipes.join(", ")}`,
    );
  });

  it("every declared recipe file exists on disk", () => {
    for (const path of listRecipes()) {
      assert.ok(
        existsSync(`${repoRoot}${path}`),
        `Missing recipe file: ${path}`,
      );
    }
  });

  it("every recipe has all required sections, an issue citation, a human-only checkpoint, and a safety link", () => {
    const findings = [];
    for (const path of listRecipes()) {
      findings.push(...validateRecipe(path));
    }
    assert.deepEqual(
      findings,
      [],
      `Recipe fixture findings:\n${findings
        .map((finding) => `  - ${finding.path}: ${finding.reason}`)
        .join("\n")}`,
    );
  });

  it("docs/recipes/index.md links to every recipe", () => {
    const findings = validateIndex();
    assert.deepEqual(
      findings,
      [],
      `Index fixture findings:\n${findings
        .map((finding) => `  - ${finding.path}: ${finding.reason}`)
        .join("\n")}`,
    );
  });
});
