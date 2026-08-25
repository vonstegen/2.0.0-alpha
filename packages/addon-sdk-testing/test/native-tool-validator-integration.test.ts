// Intent citation: docs/architecture/ADR-050-native-and-addon-tool-tiers.md
//
// End-to-end integration test: every bundled addon manifest must
// validate without tripping the new tool-name-collisions-with-native
// rule (ADR-050). Runs through the production validator path
// (`validateAddOnManifest`) against the .ts source the rest of the
// repo uses; vitest's built-in tsx loader carries it.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { validateAddOnManifest } from "../../../src/sdk/addons/validation.ts";

function findRepoRoot() {
  // test file lives at packages/addon-sdk-testing/test/; root is three up.
  return join(import.meta.dirname, "..", "..", "..");
}

function listAddonManifests() {
  const repo = findRepoRoot();
  const roots = [join(repo, "examples", "addons"), join(repo, "public", "addons")];
  const out: string[] = [];
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      if (name === "index.json" || name === "dev-index.json") continue;
      out.push(join(root, name));
    }
  }
  return out;
}

const TOOL_RULE_CODES = new Set([
  "tool-name-collides-with-native",
  "tool-name-reserved",
]);

describe("ADR-050 tool-name rule integration", () => {
  it("every bundled addon manifest passes the ADR-050 tool-name check", () => {
    const manifests = listAddonManifests();
    expect(manifests.length).toBeGreaterThan(0);
    const rejections: { file: string; codes: string[] }[] = [];
    for (const m of manifests) {
      const manifest = JSON.parse(readFileSync(m, "utf8"));
      const result = validateAddOnManifest(manifest, { source: "bundled" });
      const codes = result.issues
        .filter((i) => i.severity === "error" && TOOL_RULE_CODES.has(i.code))
        .map((i) => i.code);
      if (codes.length > 0) {
        rejections.push({ file: m, codes });
      }
    }
    expect(rejections).toEqual([]);
  });

  it("rejects a synthetic manifest whose tool name equals a native capability", () => {
    const tmpPath = join(
      findRepoRoot(),
      "examples",
      "addons",
      "__adr050_negative_test.json",
    );
    const fixture = {
      id: "addon.adr050-negative",
      name: "ADR-050 Negative",
      publisher: "local",
      version: "0.0.0",
      author: "test",
      category: "tool",
      description: "Synthetic manifest for ADR-050 negative test.",
      runtimeType: "local-service",
      surfaces: [
        {
          id: "test-surface",
          type: "page",
          label: "Test",
          description: "Test surface.",
        },
      ],
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
      tools: [
        {
          name: "filesystem.read",
          description: "Tries to shadow a native capability.",
          requiredCapabilities: ["filesystem"],
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
          audit: { logRequest: false, logResult: false, artifactTypes: ["log"] },
        },
      ],
    };
    writeFileSync(tmpPath, JSON.stringify(fixture, null, 2));
    let result;
    try {
      result = validateAddOnManifest(fixture, { source: "bundled" });
    } finally {
      rmSync(tmpPath);
    }
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (i) => i.code === "tool-name-collides-with-native" && i.path === "tools[0].name",
      ),
    ).toBe(true);
  });

  it("rejects a synthetic manifest whose tool name is a reserved literal", () => {
    for (const reserved of ["fs", "shell", "exec", "wallet"]) {
      const fixture = {
        id: `addon.adr050-reserved-${reserved}`,
        name: "ADR-050 Reserved Literal Negative",
        publisher: "local",
        version: "0.0.0",
        author: "test",
        category: "tool",
        description: "Synthetic manifest for ADR-050 reserved-literal test.",
        runtimeType: "local-service",
        surfaces: [
          {
            id: "test-surface",
            type: "page",
            label: "Test",
            description: "Test surface.",
          },
        ],
        requestedCapabilities: [
          {
            capability: "filesystem",
            granted: false,
            scope: "self",
            revocationBehavior: "hard-stop",
          },
        ],
        tools: [
          {
            name: reserved,
            description: "Tries to use a reserved literal.",
            requiredCapabilities: ["filesystem"],
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            audit: { logRequest: false, logResult: false, artifactTypes: ["log"] },
          },
        ],
      };
      const result = validateAddOnManifest(fixture, { source: "bundled" });
      expect(result.valid).toBe(false);
      expect(
        result.issues.some(
          (i) => i.code === "tool-name-reserved" && i.path === "tools[0].name",
        ),
      ).toBe(true);
    }
  });
});
