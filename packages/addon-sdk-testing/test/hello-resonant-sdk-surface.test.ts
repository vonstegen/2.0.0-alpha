// Intent citation: docs/architecture/ADR-040-provider-fabric-boundary-external-agent-runtimes.md
// Intent citation: docs/architecture/ADR-041-addon-isolation-boundary.md
// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
//
// Runs the "Hello Resonant" smoke-test addon through the SDK's own
// testing architecture: manifest validation, trust-tier classification,
// isolation/worker-key derivation, and the in-process mock host's
// capability-enforcement surfaces.
//
// Hello Resonant is a zero-capability `ui-module`, so it is not an
// external-agent-runtime subject for the F1–F10 negative harness
// (that harness requires the `providers` + `agent-delegation`
// conjunction from ADR-040 §3). This file covers the generic SDK
// surfaces that apply to every add-on.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AddOnManifest, Capability } from "../../../src/core/contracts.ts";
import { validateAddOnManifest } from "../../../src/sdk/addons/validation.ts";
import { buildWorkerKey, validateRuntimeIsolationForManifest } from "../src/isolation.ts";
import { mockHost } from "../src/mock-host.ts";
import { getTrustTierFromManifest, trustNoticeForManifest } from "../src/trust-tier.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..");
const manifestPath = resolve(repoRoot, "examples", "addons", "addon.hello-resonant.json");

const load = (): AddOnManifest => JSON.parse(readFileSync(manifestPath, "utf8")) as AddOnManifest;
const CALLER_ID = "caller.addon.hello-resonant";

describe("Hello Resonant through the SDK architecture", () => {
  it("validates with no errors", () => {
    const result = validateAddOnManifest(load(), { source: "sideload" });
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("classifies to the personal trust tier (sideloaded-unverified)", () => {
    expect(getTrustTierFromManifest(load())).toBe("personal");
  });

  it("reports an untrusted, not-tested-or-approved verdict", () => {
    const verdict = trustNoticeForManifest(load());
    expect(verdict.tier).toBe("personal");
    expect(verdict.untrusted).toBe(true);
    expect(verdict.notice).toMatch(/not tested or approved/i);
  });

  it("validates the shell-ui isolation boundary and derives a stable worker key", () => {
    const manifest = load();
    const isolation = validateRuntimeIsolationForManifest(manifest);

    expect(isolation.valid).toBe(true);
    expect(buildWorkerKey(manifest)).toBe("addon.hello-resonant@local:0.1.0|shell-ui");
  });

  it("is denied every privileged surface by the mock host (zero capability grants)", () => {
    const host = mockHost();
    const manifest = load();
    const granted: readonly Capability[] = (manifest.requestedCapabilities ?? []).map((g) => g.capability);

    // No declared tools -> any tool invocation is unknown-tool.
    const tool = host.invokeTool(
      { callerId: CALLER_ID, toolName: "memory.search", payload: {} },
      (manifest.tools ?? []).map((t) => t.name),
    );
    expect(tool.ok).toBe(false);
    if (!tool.ok) expect(tool.code).toBe("unknown-tool");

    // No granted capabilities -> privileged archive access is capability-denied.
    const intake = host.callArchiveIntakeWrite({
      callerId: CALLER_ID,
      granted,
      requested: "archive-read",
      itemRef: "hello-resonant-note",
    });
    expect(intake.ok).toBe(false);
    if (!intake.ok) expect(intake.code).toBe("capability-denied");

    // Path escape is still rejected regardless of capability grants.
    const workspace = host.accessWorkspace({
      callerId: CALLER_ID,
      requestedPath: "/etc/passwd",
      workspaceRoot: "/tmp/hello-resonant",
    });
    expect(workspace.ok).toBe(false);
    if (!workspace.ok) expect(workspace.code).toBe("workspace-escape");
  });
});
