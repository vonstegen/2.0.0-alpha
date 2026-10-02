import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAddOnManifest } from "../../../packages/addon-sdk/src/validation";

const here = dirname(fileURLToPath(import.meta.url));

describe("iTerm2 terminal host manifest", () => {
  it("is a valid AddOnSdkManifest (sideload)", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/iterm2/addon.json"), "utf8"),
    );
    const result = validateAddOnManifest(manifest, { source: "sideload" });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("declares the terminal-host capability and a terminal embedded workspace", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/iterm2/addon.json"), "utf8"),
    );
    expect(manifest.id).toBe("addon.resonant-terminal-iterm2");
    expect(manifest.runtimeType).toBe("local-service");
    expect(manifest.requestedCapabilities.map((grant) => grant.capability)).toContain(
      "terminal-host",
    );
    expect(manifest.embeddedWorkspace?.mode).toBe("terminal");
    expect(manifest.embeddedWorkspace?.requiredCapabilities).toContain("terminal-host");
  });
});
