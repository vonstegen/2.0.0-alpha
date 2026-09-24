import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAddOnManifest } from "../../../packages/addon-sdk/src/validation";

const here = dirname(fileURLToPath(import.meta.url));

describe("SDK demo: Resonant Echo manifest", () => {
  it("is a valid AddOnSdkManifest (sideload)", () => {
    const manifest = JSON.parse(readFileSync(join(here, "../echo/addon.json"), "utf8"));
    const result = validateAddOnManifest(manifest, { source: "sideload" });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
