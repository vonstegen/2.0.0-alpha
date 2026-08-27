// Intent citation: docs/architecture/ADR-041-addon-isolation-boundary.md
// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
//
// Pure helpers for the dev panel. Mirrors the rule sets in
// `packages/addon-sdk-testing/src/{trust-tier,isolation}.ts` so the
// bridge can surface publisher, trust tier, and worker key on
// /dev/external-agent-runtimes without a tsx loader. The dev
// panel is a read-only inspection surface; production-bound
// validation stays in the TypeScript modules.
//
// The bridge intentionally does not depend on the .ts modules to
// keep the privileged runtime as JS-only. When the two diverge,
// the .ts modules are authoritative — see ADR-041 §"Wire and
// bridge changes" and ADR-042 §"Wire and registry changes".

/**
 * @typedef {Object} AddOnTrustSnapshot
 * @property {string} trustTier one of "personal" | "verified" | "approved" | "system"
 * @property {string} publisher
 * @property {string} [publisherNote] empty when publisher is well-formed
 */

/**
 * @typedef {Object} AddOnIsolationSnapshot
 * @property {string} workerKey
 * @property {string|null} boundary
 * @property {boolean} hostMediated true iff boundary is host-mediated-*
 */

const HOST_MEDIATED = new Set([
  "host-mediated-service",
  "host-mediated-agent",
  "host-mediated-channel",
]);

/**
 * Derive the trust tier from a manifest. Mirrors
 * `getTrustTierFromManifest` in trust-tier.ts.
 *
 *   provenance.tier  | publisher           | tier
 *   -----------------+---------------------+----------
 *   bundled-core     | (any)               | system
 *   enterprise-signed| enterprise.*        | approved
 *   curated-signed   | (any)               | verified
 *   verified         | local               | developer  (no contract value)
 *   sideloaded-*     | local               | personal
 *   (default)        | local               | personal
 *
 * @param {{ provenance?: { tier?: string }, publisher?: string }} manifest
 */
export function classifyTrustTier(manifest) {
  const tier = manifest?.provenance?.tier;
  const publisher = manifest?.publisher ?? "";
  if (tier === "bundled-core") return "system";
  if (tier === "enterprise-signed") {
    return publisher.startsWith("enterprise.") ? "approved" : "verified";
  }
  if (tier === "curated-signed") return "verified";
  return "personal";
}

/**
 * Human-readable trust verdict, keyed off the tier. Mirrors
 * `trustNoticeForTier` in packages/addon-sdk-testing/src/trust-tier.ts.
 * `untrusted` is true only for `personal` — a sideloaded or
 * unprovenanced add-on that ResonantOS has not tested or approved.
 */
export function trustVerdict(manifest) {
  const tier = classifyTrustTier(manifest);
  switch (tier) {
    case "system":
      return { tier, untrusted: false, notice: "Bundled core add-on (system trust tier)." };
    case "approved":
      return { tier, untrusted: false, notice: "Enterprise-signed add-on (approved trust tier)." };
    case "verified":
      return { tier, untrusted: false, notice: "Curated-signed add-on (verified trust tier)." };
    case "personal":
    default:
      return {
        tier: "personal",
        untrusted: true,
        notice: "Not tested or approved — no verified or approved signature (personal trust tier).",
      };
  }
}

/**
 * Compute the canonical worker key for an addon manifest:
 *   `${id}@${publisher}:${version}|${boundary ?? "(none)"}`
 * Mirrors `buildWorkerKey` in isolation.ts.
 */
export function buildWorkerKey(manifest) {
  const id = manifest?.id ?? "";
  const publisher = manifest?.publisher ?? "";
  const version = manifest?.version ?? "";
  const boundary = manifest?.runtimeIsolation?.boundary ?? "(none)";
  return `${id}@${publisher}:${version}|${boundary}`;
}

/**
 * Combined snapshot used by the dev-panel renderer. Fields are
 * strings so they serialize cleanly into the bridge JSON.
 */
export function addonTrustAndIsolationSnapshot(manifest) {
  const verdict = trustVerdict(manifest);
  const boundary = manifest?.runtimeIsolation?.boundary ?? null;
  return {
    trustTier: verdict.tier,
    publisher: manifest?.publisher ?? "(missing)",
    publisherNote: manifest?.publisher?.startsWith("enterprise.")
      ? "enterprise.* publisher"
      : "",
    untrusted: verdict.untrusted,
    trustNotice: verdict.notice,
    workerKey: buildWorkerKey(manifest),
    boundary: boundary ?? "(none)",
    hostMediated: boundary ? HOST_MEDIATED.has(boundary) : false,
  };
}
