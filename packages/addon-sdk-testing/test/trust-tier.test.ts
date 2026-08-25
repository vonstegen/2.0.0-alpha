// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
//
// Tests for the trust-tier classifier and the transition matrix.
// The 4x4 transition table is exercised exhaustively.

import { describe, expect, it } from "vitest";

import type {
  AddOnManifest,
  AddOnProvenance,
  AddOnProvenanceTier,
} from "../../../src/core/contracts.ts";

import {
  canTransitionBetweenTiers,
  externalAgentRuntimeFixture,
  getTrustTierFromManifest,
  type TrustTier,
  type TrustTransitionDecision,
} from "../src/index.ts";

const PROVENANCE: Record<AddOnProvenanceTier, AddOnProvenance> = {
  "bundled-core": {
    tier: "bundled-core",
    verificationState: "verified",
    signed: true,
  },
  "curated-signed": {
    tier: "curated-signed",
    verificationState: "verified",
    signed: true,
  },
  "enterprise-signed": {
    tier: "enterprise-signed",
    verificationState: "verified",
    signed: true,
  },
  "sideloaded-unverified": {
    tier: "sideloaded-unverified",
    verificationState: "unverified",
    signed: false,
  },
};

function fixture(
  overrides: {
    publisher?: string;
    provenanceTier?: AddOnProvenanceTier;
    omitProvenance?: boolean;
  } = {},
): AddOnManifest {
  const base = externalAgentRuntimeFixture();
  const publisher = overrides.publisher ?? base.publisher;
  if (overrides.omitProvenance) {
    const { provenance: _omit, ...rest } = base;
    return {
      ...rest,
      publisher,
    } as AddOnManifest;
  }
  if (overrides.provenanceTier !== undefined) {
    return {
      ...base,
      publisher,
      provenance: PROVENANCE[overrides.provenanceTier],
    };
  }
  return {
    ...base,
    publisher,
  };
}

describe("getTrustTierFromManifest", () => {
  it("classifies sideloaded + local as Personal", () => {
    expect(
      getTrustTierFromManifest(
        fixture({
          publisher: "local",
          provenanceTier: "sideloaded-unverified",
        }),
      ),
    ).toBe("personal");
  });

  it("classifies curated-signed as Verified", () => {
    expect(
      getTrustTierFromManifest(
        fixture({
          publisher: "directory.tld",
          provenanceTier: "curated-signed",
        }),
      ),
    ).toBe("verified");
  });

  it("classifies enterprise-signed + enterprise publisher as Approved", () => {
    expect(
      getTrustTierFromManifest(
        fixture({
          publisher: "enterprise.acme-corp",
          provenanceTier: "enterprise-signed",
        }),
      ),
    ).toBe("approved");
  });

  it("classifies enterprise-signed + non-enterprise publisher as Verified", () => {
    expect(
      getTrustTierFromManifest(
        fixture({
          publisher: "directory.tld",
          provenanceTier: "enterprise-signed",
        }),
      ),
    ).toBe("verified");
  });

  it("classifies bundled-core as System regardless of publisher", () => {
    expect(
      getTrustTierFromManifest(
        fixture({
          publisher: "anything",
          provenanceTier: "bundled-core",
        }),
      ),
    ).toBe("system");
  });

  it("falls back to Personal when provenance is missing", () => {
    expect(
      getTrustTierFromManifest(fixture({ omitProvenance: true })),
    ).toBe("personal");
  });
});

describe("canTransitionBetweenTiers", () => {
  const ALL: TrustTier[] = [
    "personal",
    "verified",
    "approved",
    "system",
  ];

  it("returns same-tier for identical tiers", () => {
    for (const tier of ALL) {
      expect(canTransitionBetweenTiers(tier, tier)).toEqual({
        kind: "same-tier",
      });
    }
  });

  it("admits one-step promotion as host-claim", () => {
    expect(canTransitionBetweenTiers("personal", "verified")).toEqual({
      kind: "host-claim",
      reason:
        "Tier promotion personal -> verified requires a recorded host-side claim.",
    });
    expect(canTransitionBetweenTiers("verified", "approved")).toEqual({
      kind: "host-claim",
      reason:
        "Tier promotion verified -> approved requires a recorded host-side claim.",
    });
    expect(canTransitionBetweenTiers("approved", "system")).toEqual({
      kind: "host-claim",
      reason:
        "Tier promotion approved -> system requires a recorded host-side claim.",
    });
  });

  it("admits one-step demotion as host-claim", () => {
    expect(canTransitionBetweenTiers("verified", "personal")).toEqual({
      kind: "host-claim",
      reason:
        "One-step tier demotion requires a recorded host-side claim.",
    });
    expect(canTransitionBetweenTiers("approved", "verified")).toEqual({
      kind: "host-claim",
      reason:
        "One-step tier demotion requires a recorded host-side claim.",
    });
    expect(canTransitionBetweenTiers("system", "approved")).toEqual({
      kind: "host-claim",
      reason:
        "One-step tier demotion requires a recorded host-side claim.",
    });
  });

  it("denies two-step demotion", () => {
    expect(canTransitionBetweenTiers("system", "verified").kind).toBe("deny");
    expect(canTransitionBetweenTiers("system", "personal").kind).toBe("deny");
    expect(canTransitionBetweenTiers("approved", "personal").kind).toBe(
      "deny",
    );
  });

  it("denies multi-rank tier promotion", () => {
    expect(canTransitionBetweenTiers("personal", "approved").kind).toBe(
      "deny",
    );
    expect(canTransitionBetweenTiers("verified", "system").kind).toBe("deny");
    expect(canTransitionBetweenTiers("personal", "system").kind).toBe("deny");
  });

  it("matches the full 4x4 matrix", () => {
    const verdictMap: Record<
      `${TrustTier}-${TrustTier}`,
      TrustTransitionDecision["kind"]
    > = {
      "personal-personal": "same-tier",
      "personal-verified": "host-claim",
      "personal-approved": "deny",
      "personal-system": "deny",
      "verified-personal": "host-claim",
      "verified-verified": "same-tier",
      "verified-approved": "host-claim",
      "verified-system": "deny",
      "approved-personal": "deny",
      "approved-verified": "host-claim",
      "approved-approved": "same-tier",
      "approved-system": "host-claim",
      "system-personal": "deny",
      "system-verified": "deny",
      "system-approved": "host-claim",
      "system-system": "same-tier",
    };
    for (const from of ALL) {
      for (const to of ALL) {
        const key = `${from}-${to}` as const;
        const decision = canTransitionBetweenTiers(from, to);
        expect(decision.kind).toBe(verdictMap[key]);
      }
    }
  });
});
