// Intent citation: docs/architecture/resonantos-browser-architecture/CP75-PHASE75-CONTINUATION.md
// Intent citation: docs/architecture/resonantos-browser-architecture/TOM-FEEDBACK-CROSS-REFERENCE.md
//
// CP-7.5 §7.5.2 (Version Enforcement). Verifies that the manifest-level
// semver range gate catches the four observable cases:
//   1. A manifest whose sdkVersion range accepts the runtime SDK passes.
//   2. A manifest whose sdkVersion range excludes the runtime SDK fails.
//   3. A manifest whose compatibility.shellVersion is not a valid semver
//      range (Tom's "banana" example) fails.
//   4. A manifest whose compatibility.shellVersion range excludes the
//      runtime shell fails.
//
// Plus regression coverage for:
//   - missing sdkVersion (hard error)
//   - missing compatibility.shellVersion (hard error)
//   - the bundled caret prerelease range ("^2.0.0-beta.1") accepting the
//     current beta, later beta prereleases, and stable 2.0.0 when
//     includePrerelease is honored.

import { describe, expect, it } from "vitest";

import { validateAddOnManifest } from "./validation.ts";

const RUNTIME_SDK = "2.0.5";
const RUNTIME_SHELL = "2.0.0-beta.1";

const baseManifest = (overrides: Record<string, unknown> = {}) => ({
  id: "addon.sdk-version-test",
  name: "SDK Version Test",
  version: "0.1.0",
  publisher: "resonantos-testing",
  author: "Resonant Alpha",
  category: "tool",
  description: "CP-7.5 §7.5.2 sdkVersion + shellVersion enforcement smoke test.",
  runtimeType: "local-service",
  surfaces: [{ id: "main", label: "Main", description: "Main surface.", type: "page" }],
  requestedCapabilities: [
    { capability: "network", granted: false, scope: "shared", revocationBehavior: "hard-stop" },
  ],
  providerRequirements: {
    sharedProfiles: [],
    supportsPrivateCredentials: false,
  },
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false,
  },
  health: { strategy: "ready" },
  installHooks: {},
  ...overrides,
});

const withSdk = (range: string, shellRange: string = RUNTIME_SHELL) => baseManifest({
  sdkVersion: range,
  compatibility: { shellVersion: shellRange, platforms: ["darwin"] },
});

describe("CP-7.5 §7.5.2 sdkVersion + shellVersion enforcement", () => {
  it("accepts a manifest whose sdkVersion range covers the runtime SDK", () => {
    const result = validateAddOnManifest(withSdk("2.0.x"), { runtimeShellVersion: RUNTIME_SHELL });
    const versionIssues = result.issues.filter((i) => i.code === "manifest-version-mismatch");
    expect(versionIssues).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  it("rejects a manifest whose sdkVersion range excludes the runtime SDK", () => {
    const result = validateAddOnManifest(withSdk("99.0.0"), { runtimeShellVersion: RUNTIME_SHELL });
    expect(result.valid).toBe(false);
    const mismatch = result.issues.find((i) => i.code === "manifest-version-mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.path).toBe("sdkVersion");
    expect(mismatch?.message).toContain(RUNTIME_SDK);
  });

  it("rejects a manifest whose compatibility.shellVersion is not a valid semver range (the 'banana' case)", () => {
    const result = validateAddOnManifest(withSdk(`^${RUNTIME_SDK.split(".")[0]}.x`, "banana"), { runtimeShellVersion: RUNTIME_SHELL });
    expect(result.valid).toBe(false);
    const invalid = result.issues.find((i) => i.code === "manifest-version-range-invalid");
    expect(invalid).toBeDefined();
    expect(invalid?.path).toBe("compatibility.shellVersion");
    expect(invalid?.message).toContain("banana");
  });

  it("rejects a manifest whose shellVersion range excludes the runtime shell", () => {
    const result = validateAddOnManifest(withSdk(`^${RUNTIME_SDK.split(".")[0]}.x`, "99.0.0"), { runtimeShellVersion: RUNTIME_SHELL });
    expect(result.valid).toBe(false);
    const mismatch = result.issues.find((i) => i.code === "manifest-version-mismatch");
    expect(mismatch?.path).toBe("compatibility.shellVersion");
    expect(mismatch?.message).toContain(RUNTIME_SHELL);
  });

  it("rejects a manifest missing sdkVersion outright", () => {
    const m = baseManifest({
      compatibility: { shellVersion: "^2.0.0", platforms: ["darwin"] },
    });
    const result = validateAddOnManifest(m, { runtimeShellVersion: RUNTIME_SHELL });
    const issue = result.issues.find((i) => i.code === "manifest-version-range-invalid" && i.path === "sdkVersion");
    expect(issue).toBeDefined();
  });

  it("rejects a manifest missing compatibility.shellVersion outright", () => {
    const m = baseManifest({ sdkVersion: `^${RUNTIME_SDK.split(".")[0]}.x` });
    // strip compatibility entirely
    delete (m as Record<string, unknown>).compatibility;
    const result = validateAddOnManifest(m, { runtimeShellVersion: RUNTIME_SHELL });
    const issue = result.issues.find(
      (i) => i.code === "manifest-version-range-invalid" && i.path === "compatibility.shellVersion",
    );
    expect(issue).toBeDefined();
  });

  it("accepts the bundled caret prerelease range across beta.x and stable 2.x", () => {
    // The bundled manifests declare `compatibility.shellVersion: "^2.0.0-beta.1"`.
    // The validator coerces the runtime shell (includePrerelease honored) and
    // checks it against the range, so this must accept the current beta
    // prereleases, later beta prereleases, and stable graduation to 2.0.0.
    for (const runtime of ["2.0.0-beta.1", "2.0.0-beta.2", "2.0.0"]) {
      const result = validateAddOnManifest(
        withSdk(`^${RUNTIME_SDK.split(".")[0]}.x`, "^2.0.0-beta.1"),
        { runtimeShellVersion: runtime },
      );
      const mismatch = result.issues.find(
        (i) => i.code === "manifest-version-mismatch" && i.path === "compatibility.shellVersion",
      );
      expect(mismatch, `runtime shell ${runtime} should satisfy ^2.0.0-beta.1`).toBeUndefined();
    }
  });

  it("accepts a fixed-version shellVersion that matches the runtime shell", () => {
    // Backward compatibility: a fixed shell version is itself a valid
    // single-version semver range. When the runtime shell matches, the
    // validator accepts.
    const result = validateAddOnManifest(withSdk(`^${RUNTIME_SDK.split(".")[0]}.x`, "2.0.0-beta.1"), { runtimeShellVersion: "2.0.0-beta.1" });
    const mismatch = result.issues.find((i) => i.code === "manifest-version-mismatch");
    expect(mismatch).toBeUndefined();
  });
});
