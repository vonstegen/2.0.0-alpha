import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAddOnManifest } from "../../../packages/addon-sdk/src/validation";

const here = dirname(fileURLToPath(import.meta.url));

describe("Ghostty terminal host manifest", () => {
  it("is a valid AddOnSdkManifest (sideload)", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/ghostty/addon.json"), "utf8"),
    );
    const result = validateAddOnManifest(manifest, { source: "sideload" });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("declares the terminal-host capability and a terminal embedded workspace", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/ghostty/addon.json"), "utf8"),
    );
    expect(manifest.id).toBe("addon.resonant-terminal-ghostty");
    expect(manifest.runtimeType).toBe("local-service");
    expect(manifest.service.protocol).toBe("stdio-json-rpc");
    expect(manifest.service.entrypoint).toBe("node adapter.mjs");
    expect(manifest.requestedCapabilities.map((grant) => grant.capability)).toContain(
      "terminal-host",
    );
    expect(manifest.embeddedWorkspace?.mode).toBe("terminal");
    expect(manifest.embeddedWorkspace?.requiredCapabilities).toContain("terminal-host");
    expect(manifest.surfaces[0].shellNavigation).toEqual({
      sectionId: "terminal",
      dockIcon: "terminal",
      eyebrow: "Terminal",
      requiredCapabilities: ["terminal-host"],
    });
  });

  it("shellNavigation.requiredCapabilities resolves to the granted terminal-host capability", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/ghostty/addon.json"), "utf8"),
    );
    // surface.shellNavigation.requiredCapabilities must be a subset of the
    // manifest's requestable capabilities: the host only projects grants it
    // can resolve. The grantPresets declare the post-authorization grant set
    // the host will project when the user consents.
    const requestable = new Set(
      manifest.requestedCapabilities.map((grant: { capability: string }) => grant.capability),
    );
    for (const capability of manifest.surfaces[0].shellNavigation.requiredCapabilities) {
      expect(requestable.has(capability)).toBe(true);
    }
    expect(requestable.has("terminal-host")).toBe(true);
    const projectedGrants = manifest.grantPresets.flatMap(
      (preset: { grants: Array<{ capability: string; granted: boolean }> }) => preset.grants,
    );
    const projectedCapabilitySet = new Set(
      projectedGrants
        .filter((grant) => grant.granted)
        .map((grant) => grant.capability),
    );
    for (const capability of manifest.surfaces[0].shellNavigation.requiredCapabilities) {
      expect(projectedCapabilitySet.has(capability)).toBe(true);
    }
  });

  it("type:panel + embeddedWorkspace.mode:terminal is accepted by the validator", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "../terminal-host/ghostty/addon.json"), "utf8"),
    );
    expect(manifest.surfaces[0].type).toBe("panel");
    expect(manifest.embeddedWorkspace.mode).toBe("terminal");
    const result = validateAddOnManifest(manifest, { source: "sideload" });
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors.map((issue) => `${issue.path}: ${issue.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
