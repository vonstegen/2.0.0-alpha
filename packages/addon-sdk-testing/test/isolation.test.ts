// Intent citation: docs/architecture/ADR-041-addon-isolation-boundary.md
//
// Tests for the worker-key builder, the isolation validator, and
// the rebind classifier. The fixture mirrors the base manifest
// from manifest-fixtures.ts so the contracts stay synchronized.

import { describe, expect, it } from "vitest";

import type { AddOnManifest } from "../../../src/core/contracts.ts";

import {
  buildWorkerKey,
  externalAgentRuntimeFixture,
  shouldRebindWorker,
  validateRuntimeIsolationForManifest,
} from "../src/index.ts";

function manifest(overrides: Partial<AddOnManifest> = {}): AddOnManifest {
  const base = externalAgentRuntimeFixture();
  return { ...base, ...overrides };
}

describe("buildWorkerKey", () => {
  it("produces a stable key for the same manifest", () => {
    const m = manifest();
    const k1 = buildWorkerKey(m);
    const k2 = buildWorkerKey(m);
    expect(k1).toBe(k2);
    expect(k1).toContain(m.id);
    expect(k1).toContain(m.publisher);
    expect(k1).toContain(m.version);
  });

  it("encodes each component of the worker key", () => {
    const m = manifest({
      id: "addon.alpha",
      publisher: "acme",
      version: "1.2.3",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: false,
      },
    });
    expect(buildWorkerKey(m)).toBe(
      "addon.alpha@acme:1.2.3|host-mediated-agent",
    );
  });

  it("uses (none) when no isolation boundary is declared", () => {
    const m = manifest({
      runtimeIsolation: undefined,
    });
    expect(buildWorkerKey(m)).toContain("|(none)");
  });
});

describe("validateRuntimeIsolationForManifest", () => {
  it("accepts host-mediated-service + local-service", () => {
    const result = validateRuntimeIsolationForManifest(manifest());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.workerKey).toContain("|host-mediated-service");
    }
  });

  it("rejects host-mediated-service + ui-module", () => {
    const m = manifest({
      runtimeType: "ui-module",
      runtimeIsolation: {
        boundary: "host-mediated-service",
        supportsDegradedMode: true,
        requiresReviewedGrant: false,
      },
    });
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe("isolation-runtime-type-mismatch");
    }
  });

  it("rejects host-mediated-agent + embedded-module", () => {
    const m = manifest({
      runtimeType: "embedded-module",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: false,
      },
    });
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(false);
  });

  it("rejects requiresReviewedGrant with no non-trivial grant", () => {
    const m = manifest({
      runtimeType: "agent-addon",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
      requestedCapabilities: [
        {
          capability: "notifications",
          granted: false,
          scope: "self",
          revocationBehavior: "degrade",
        },
      ],
    });
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe(
        "isolation-missing-non-trivial-grant",
      );
    }
  });

  it("accepts requiresReviewedGrant with a hard-stop capability", () => {
    const m = manifest({
      runtimeType: "agent-addon",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
      requestedCapabilities: [
        {
          capability: "shell",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(true);
  });

  it("rejects supportsDegradedMode: false + degrade-revoking capability", () => {
    const m = manifest({
      runtimeType: "agent-addon",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: false,
        requiresReviewedGrant: false,
      },
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "shared",
          revocationBehavior: "degrade",
        },
      ],
    });
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].code).toBe(
        "isolation-degraded-mode-conflict",
      );
    }
  });

  it("rejects missing identity fields", () => {
    const m = {
      ...manifest(),
      id: undefined,
    } as unknown;
    const result = validateRuntimeIsolationForManifest(m);
    expect(result.valid).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(validateRuntimeIsolationForManifest(null).valid).toBe(false);
    expect(validateRuntimeIsolationForManifest("string").valid).toBe(false);
    expect(validateRuntimeIsolationForManifest(42).valid).toBe(false);
  });
});

describe("shouldRebindWorker", () => {
  it("returns false for identical manifests", () => {
    const m = manifest();
    expect(shouldRebindWorker(m, m)).toBe(false);
  });

  it("returns true for boundary widening", () => {
    const prior = manifest({
      runtimeIsolation: {
        boundary: "host-mediated-service",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
    });
    const next = manifest({
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
    });
    expect(shouldRebindWorker(prior, next)).toBe(true);
  });

  it("returns true for version change", () => {
    const prior = manifest({ version: "1.0.0" });
    const next = manifest({ version: "1.0.1" });
    expect(shouldRebindWorker(prior, next)).toBe(true);
  });

  it("returns true for publisher change", () => {
    const prior = manifest({ publisher: "local" });
    const next = manifest({ publisher: "acme" });
    expect(shouldRebindWorker(prior, next)).toBe(true);
  });

  it("returns true for id change", () => {
    const prior = manifest({ id: "addon.first" });
    const next = manifest({ id: "addon.second" });
    expect(shouldRebindWorker(prior, next)).toBe(true);
  });

  it("returns false for description-only changes", () => {
    const prior = manifest();
    const next = manifest({ description: "Updated description" });
    expect(shouldRebindWorker(prior, next)).toBe(false);
  });
});
