// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
//
// Pure trust-tier classification and the transition matrix. The
// host installer calls `getTrustTierFromManifest(manifest)` to learn
// a manifest's tier and `canTransitionBetweenTiers(from, to)` to
// decide whether a manifest swap (install/update) is allowed.
//
// Module is host-free; imports only the shared contracts plus the
// `publisher` field added by ADR-038. Same inputs -> same outputs.

import type { AddOnManifest } from "../../../src/core/contracts.ts";

export type TrustTier =
  | "personal"
  | "verified"
  | "approved"
  | "system";

const TRUST_RANK: Record<TrustTier, number> = {
  personal: 0,
  verified: 1,
  approved: 2,
  system: 3,
};

export type TrustTransitionDecision =
  | { kind: "same-tier" }
  | { kind: "host-claim"; reason: string }
  | { kind: "deny"; reason: string };

/**
 * Derive the trust tier from a validated manifest. The matrix (per
 * ADR-042):
 *
 *   provenance.tier  | publisher                  | tier
 *   -----------------+----------------------------+--------
 *   bundled-core     | (any)                      | system
 *   enterprise-signed| startsWith("enterprise.")  | approved
 *   curated-signed   | (any)                      | verified
 *   enterprise-signed| (otherwise)                | verified
 *   sideloaded-*     | local                      | personal
 *   (default)        | local                      | personal
 */
export function getTrustTierFromManifest(manifest: AddOnManifest): TrustTier {
  const tier = manifest.provenance?.tier;
  const publisher = manifest.publisher;
  if (tier === "bundled-core") return "system";
  if (tier === "enterprise-signed") {
    return publisher.startsWith("enterprise.") ? "approved" : "verified";
  }
  if (tier === "curated-signed") return "verified";
  // sideloaded-unverified / undefined / anything else
  return "personal";
}
export type TrustTierNotice = {
  tier: TrustTier;
  /** True when the add-on carries no verified or approved signature. */
  untrusted: boolean;
  /** Human-readable verdict for status/panel surfaces. */
  notice: string;
};

/**
 * Human-readable verdict for a trust tier. `untrusted` is true only
 * for `personal` — a sideloaded or unprovenanced add-on that
 * ResonantOS has not tested or approved. Mirrored in
 * browser-first/host/dev-panel-addon-snapshot.mjs.
 */
export function trustNoticeForTier(tier: TrustTier): TrustTierNotice {
  switch (tier) {
    case "system":
      return { tier, untrusted: false, notice: "Bundled core add-on (system trust tier)." };
    case "approved":
      return { tier, untrusted: false, notice: "Enterprise-signed add-on (approved trust tier)." };
    case "verified":
      return { tier, untrusted: false, notice: "Curated-signed add-on (verified trust tier)." };
    case "personal":
      return {
        tier,
        untrusted: true,
        notice: "Not tested or approved — no verified or approved signature (personal trust tier).",
      };
  }
}

export function trustNoticeForManifest(manifest: AddOnManifest): TrustTierNotice {
  return trustNoticeForTier(getTrustTierFromManifest(manifest));
}

/**
 * Returns the canonical verdict for an attempted move between two
 * tiers. The matrix matches ADR-042 §"What is and isn't permitted":
 *
 *   from\To   personal  verified  approved  system
 *   personal  ok        host-claim deny      deny
 *   verified  deny      ok        host-claim deny
 *   approved  deny      deny      ok        host-claim
 *   system    deny      deny      deny      ok
 */
export function canTransitionBetweenTiers(
  from: TrustTier,
  to: TrustTier,
): TrustTransitionDecision {
  if (from === to) return { kind: "same-tier" };
  const fromRank = TRUST_RANK[from];
  const toRank = TRUST_RANK[to];

  if (toRank < fromRank) {
    if (toRank === fromRank - 1) {
      return {
        kind: "host-claim",
        reason:
          "One-step tier demotion requires a recorded host-side claim.",
      };
    }
    return {
      kind: "deny",
      reason: `Cannot demote trust tier from ${from} to ${to}.`,
    };
  }

  if (toRank - fromRank === 1) {
    return {
      kind: "host-claim",
      reason: `Tier promotion ${from} -> ${to} requires a recorded host-side claim.`,
    };
  }
  return {
    kind: "deny",
    reason: `Cannot skip trust tiers in a single transition (${from} -> ${to}).`,
  };
}

export const __testing = { TRUST_RANK };
