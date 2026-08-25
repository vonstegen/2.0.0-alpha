// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// Tests for `diffAddOnManifest`. Each case is one prior/next pair;
// the assertions pin the classification (hard vs soft) and the
// detail payload of every entry. Every test uses the base fixture
// from `manifest-fixtures.ts` so the manifest contract stays
// self-consistent — adjusting the fixture for a broken case is not
// permitted.

import { describe, expect, it } from "vitest";

import type { AddOnManifest } from "../../../src/core/contracts.ts";

import {
  diffAddOnManifest,
  externalAgentRuntimeFixture,
  type AddOnPermissionDelta,
} from "../src/index.ts";

function fixture(overrides: Partial<AddOnManifest> = {}): AddOnManifest {
  const base = externalAgentRuntimeFixture();
  return { ...base, ...overrides };
}

function expectHardOnly(
  delta: AddOnPermissionDelta,
  paths: string[],
): void {
  expect(delta.softChanges).toEqual([]);
  expect(
    delta.hardChanges.map((entry) => entry.path).sort(),
  ).toEqual([...paths].sort());
}

describe("diffAddOnManifest", () => {
  it("returns empty deltas when nothing changes", () => {
    const manifest = fixture();
    const delta = diffAddOnManifest(manifest, manifest);
    expect(delta.hardChanges).toEqual([]);
    expect(delta.softChanges).toEqual([]);
    expect(delta.identityChanged).toBe(false);
  });

  it("treats description edits as soft", () => {
    const prior = fixture();
    const next = fixture({ description: "New description" });
    const delta = diffAddOnManifest(prior, next);
    expect(delta.hardChanges).toEqual([]);
    expect(delta.softChanges).toHaveLength(1);
    expect(delta.softChanges[0]).toMatchObject({
      path: "description",
      kind: "string-changed",
      severity: "soft",
    });
  });

  it("flags an added capability as a hard change", () => {
    const prior = fixture();
    const baseCaps = prior.requestedCapabilities ?? [];
    const next = fixture({
      requestedCapabilities: [
        ...baseCaps,
        {
          capability: "shell",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expect(delta.softChanges).toEqual([]);
    const added = delta.hardChanges.find(
      (entry) => entry.kind === "capability-added",
    );
    expect(added).toBeDefined();
    expect(added!.detail).toEqual({
      capability: "shell",
      scope: "system",
      revocationBehavior: "hard-stop",
    });
  });

  it("treats capability scope widening as hard", () => {
    const prior = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const next = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["requestedCapabilities"]);
    expect(delta.hardChanges[0].kind).toBe("capability-scope-widened");
    expect(delta.hardChanges[0].detail).toMatchObject({
      capability: "filesystem",
      scope: "system",
    });
  });

  it("treats capability scope narrowing as a hard change too", () => {
    const prior = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const next = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expect(delta.hardChanges[0].kind).toBe("capability-scope-narrowed");
    expect(delta.softChanges).toEqual([]);
  });

  it("treats revocation weakening as hard", () => {
    const prior = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const next = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "degrade",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["requestedCapabilities"]);
    expect(delta.hardChanges[0].kind).toBe("capability-revocation-weakened");
  });

  it("treats capability removal as hard", () => {
    const prior = fixture({
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
        {
          capability: "network",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const next = fixture({
      requestedCapabilities: [
        {
          capability: "network",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expect(
      delta.hardChanges.some((e) => e.kind === "capability-removed"),
    ).toBe(true);
  });

  it("treats runtime type change as hard", () => {
    const prior = fixture({ runtimeType: "local-service" });
    const next = fixture({ runtimeType: "agent-addon" });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["runtimeType"]);
    expect(delta.hardChanges[0].kind).toBe("runtime-type-changed");
  });

  it("treats isolation boundary widening as hard", () => {
    const prior = fixture({
      runtimeIsolation: {
        boundary: "shell-ui",
        supportsDegradedMode: true,
        requiresReviewedGrant: false,
      },
    });
    const next = fixture({
      runtimeIsolation: {
        boundary: "host-mediated-service",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
    });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["runtimeIsolation.boundary"]);
    expect(delta.hardChanges[0].kind).toBe("isolation-boundary-widened");
  });

  it("treats publisher change as hard and sets identityChanged", () => {
    const prior = fixture();
    const next = fixture({ publisher: "verifying.acme" });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["publisher"]);
    expect(delta.hardChanges[0].kind).toBe("identity-publisher-changed");
    expect(delta.identityChanged).toBe(true);
  });

  it("treats id change as hard and sets identityChanged", () => {
    const prior = fixture();
    const next = fixture({
      id: "addon.testing.external-agent-runtime-v2",
    });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["id"]);
    expect(delta.identityChanged).toBe(true);
  });

  it("treats version downgrade as hard", () => {
    const prior = fixture({ version: "0.2.0" });
    const next = fixture({ version: "0.1.5" });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["version"]);
    expect(delta.hardChanges[0].kind).toBe("identity-version-downgrade");
  });

  it("treats major version bump as hard", () => {
    const prior = fixture({ version: "0.9.3" });
    const next = fixture({ version: "1.0.0" });
    const delta = diffAddOnManifest(prior, next);
    expectHardOnly(delta, ["version"]);
    expect(delta.hardChanges[0].kind).toBe("identity-version-major-bump");
  });

  it("treats a minor bump as unchanged (no version delta)", () => {
    const prior = fixture({ version: "0.1.0" });
    const next = fixture({ version: "0.2.0" });
    const delta = diffAddOnManifest(prior, next);
    expect(delta.hardChanges).toEqual([]);
    expect(delta.softChanges).toEqual([]);
  });

  it("accumulates multiple kinds of hard change into hardChanges", () => {
    const prior = fixture({
      runtimeIsolation: {
        boundary: "shell-ui",
        supportsDegradedMode: true,
        requiresReviewedGrant: false,
      },
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "self",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const next = fixture({
      runtimeType: "agent-addon",
      runtimeIsolation: {
        boundary: "host-mediated-agent",
        supportsDegradedMode: true,
        requiresReviewedGrant: true,
      },
      requestedCapabilities: [
        {
          capability: "filesystem",
          granted: false,
          scope: "system",
          revocationBehavior: "hard-stop",
        },
      ],
    });
    const delta = diffAddOnManifest(prior, next);
    expect(delta.softChanges).toEqual([]);
    const kinds = delta.hardChanges.map((e) => e.kind).sort();
    expect(kinds).toEqual([
      "capability-scope-widened",
      "isolation-boundary-widened",
      "runtime-type-changed",
    ]);
  });
});
