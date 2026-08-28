// Intent citation: docs/architecture/ADR-042-addon-trust-tier-transitions.md
// Intent citation: docs/architecture/ADR-023-addon-repository-registry-model.md
// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// Phase 2 of the add-on lifecycle: verification. Exercises the SDK's
// verification primitives against the hello-resonant smoke-test add-on
// as it moves from sideloaded-unverified (personal) to curated-signed
// (verified).
//
// The SDK's model is that verification is a HOST action, not something
// an add-on can claim about itself:
//   - a sideloaded registry source is forced to sideloaded-unverified /
//     unverified / unreviewed regardless of the manifest's provenance;
//   - promoting personal -> verified returns a `host-claim` decision
//     (the host must record the claim);
//   - the re-signed manifest differs only in `provenance`, so the
//     permission diff is empty (verification grants no new authority).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AddOnManifest } from "../../../src/core/contracts.ts";
import { createAddOnRegistryEntry } from "../../../src/sdk/addons/registry.ts";
import { validateAddOnManifest } from "../../../src/sdk/addons/validation.ts";
import { diffAddOnManifest } from "../src/permission-diff.ts";
import {
  canTransitionBetweenTiers,
  getTrustTierFromManifest,
  trustNoticeForManifest,
} from "../src/trust-tier.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..", "..", "..");
const manifestPath = resolve(repoRoot, "examples", "addons", "addon.hello-resonant.json");

const load = (): AddOnManifest => JSON.parse(readFileSync(manifestPath, "utf8")) as AddOnManifest;

/** The host re-signs the manifest after verification. Only `provenance` changes. */
const verifiedVariant = (): AddOnManifest => ({
  ...load(),
  provenance: {
    tier: "curated-signed",
    verificationState: "verified",
    signed: true,
    signer: "resonantos-curator",
    signatureRef: "curated/addon.hello-resonant@0.1.0.sig",
  },
});

describe("Hello Resonant — verification (personal -> verified)", () => {
  it("cannot self-verify: a sideloaded manifest claiming curated provenance is overridden", () => {
    const result = validateAddOnManifest(verifiedVariant(), { source: "sideload" });
    expect(
      result.issues.some(
        (issue) => issue.severity === "warning" && issue.code === "sideload-provenance-overridden",
      ),
    ).toBe(true);
  });

  it("a sideloaded registry source stays unverified even for a curated-signed manifest", () => {
    const entry = createAddOnRegistryEntry(verifiedVariant(), { registrySource: "sideloaded-local" });
    expect(entry.addonId).toBe("addon.hello-resonant");
    expect(entry.provenanceTier).toBe("sideloaded-unverified");
    expect(entry.verificationState).toBe("unverified");
    expect(entry.reviewState).toBe("unreviewed");
  });

  it("promoting personal -> verified requires a recorded host-side claim", () => {
    expect(canTransitionBetweenTiers("personal", "verified")).toEqual({
      kind: "host-claim",
      reason: "Tier promotion personal -> verified requires a recorded host-side claim.",
    });
  });

  it("verification is non-invasive: the permission delta is empty", () => {
    const delta = diffAddOnManifest(load(), verifiedVariant());
    expect(delta.hardChanges).toEqual([]);
    expect(delta.softChanges).toEqual([]);
    expect(delta.identityChanged).toBe(false);
  });

  it("the curated-registry entry records the verified state", () => {
    const entry = createAddOnRegistryEntry(verifiedVariant(), { registrySource: "curated-registry" });
    expect(entry.addonId).toBe("addon.hello-resonant");
    expect(entry.version).toBe("0.1.0");
    expect(entry.provenanceTier).toBe("curated-signed");
    expect(entry.verificationState).toBe("verified");
    expect(entry.reviewState).toBe("approved");
    expect(entry.manifestRef.signatureRef).toBe("curated/addon.hello-resonant@0.1.0.sig");
  });

  it("classifies the re-signed manifest as verified and trusted", () => {
    const manifest = verifiedVariant();
    expect(getTrustTierFromManifest(manifest)).toBe("verified");
    const verdict = trustNoticeForManifest(manifest);
    expect(verdict.untrusted).toBe(false);
    expect(verdict.notice).toBe("Curated-signed add-on (verified trust tier).");
  });
});
