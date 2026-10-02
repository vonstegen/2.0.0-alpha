import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAddOnManifest } from "../../../packages/addon-sdk/src/validation";

const here = dirname(fileURLToPath(import.meta.url));

describe("SDK demo: Resonant Pi manifest", () => {
  it("is a valid AddOnSdkManifest (sideload)", () => {
    const manifest = JSON.parse(readFileSync(join(here, "../pi/addon.json"), "utf8"));
    const result = validateAddOnManifest(manifest, { source: "sideload" });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("declares a distinct id and entrypoint port from Echo, Counter, and SDK Guide", () => {
    const echo = JSON.parse(readFileSync(join(here, "../echo/addon.json"), "utf8"));
    const counter = JSON.parse(readFileSync(join(here, "../counter/addon.json"), "utf8"));
    const guide = JSON.parse(readFileSync(join(here, "../sdk-guide/addon.json"), "utf8"));
    const pi = JSON.parse(readFileSync(join(here, "../pi/addon.json"), "utf8"));

    expect(pi.id).toBe("addon.resonant-pi");
    for (const other of [echo, counter, guide]) {
      expect(pi.service.entrypoint).not.toBe(other.service.entrypoint);
      expect(pi.id).not.toBe(other.id);
    }
  });
});
