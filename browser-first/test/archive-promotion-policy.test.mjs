import assert from "node:assert/strict";
import test from "node:test";

import { assertPromotionVerifierMatchesDraft } from "../host/archive-promotion-policy.mjs";

const verifiedPromotion = {
  draftArtifactPath: "REVIEW/artifacts/browser/source-draft.md",
  requestPath: "REVIEW/requests/browser/source.md",
  sourceArtifactPath: "INTAKE/sources/source.md",
  proposedPage: "AI_MEMORY/wiki/source.md",
  artifactVerificationStatus: "verified",
  verifierStatus: "verified",
  verifierDraftArtifactPath: "REVIEW/artifacts/browser/source-draft.md",
  verifierRequestPath: "REVIEW/requests/browser/source.md",
  verifierSourceArtifactPath: "INTAKE/sources/source.md",
  verifierProposedPage: "AI_MEMORY/wiki/source.md",
};

test("promotion policy accepts a verifier tied to the same draft request source and page", () => {
  assert.doesNotThrow(() => assertPromotionVerifierMatchesDraft(verifiedPromotion));
});

test("promotion policy rejects unverified artifact state", () => {
  assert.throws(
    () => assertPromotionVerifierMatchesDraft({
      ...verifiedPromotion,
      artifactVerificationStatus: "needs-revision",
    }),
    /artifact verification status verified/i,
  );
});

test("promotion policy rejects unverified verifier artifacts", () => {
  assert.throws(
    () => assertPromotionVerifierMatchesDraft({
      ...verifiedPromotion,
      verifierStatus: "needs-revision",
    }),
    /verified verifier artifact/i,
  );
});

test("promotion policy rejects verifier artifacts for another draft", () => {
  assert.throws(
    () => assertPromotionVerifierMatchesDraft({
      ...verifiedPromotion,
      verifierDraftArtifactPath: "REVIEW/artifacts/browser/other-draft.md",
    }),
    /draftArtifactPath/i,
  );
});

test("promotion policy rejects verifier artifacts for another source or proposed page", () => {
  assert.throws(
    () => assertPromotionVerifierMatchesDraft({
      ...verifiedPromotion,
      verifierSourceArtifactPath: "INTAKE/sources/other-source.md",
    }),
    /sourceArtifactPath/i,
  );
  assert.throws(
    () => assertPromotionVerifierMatchesDraft({
      ...verifiedPromotion,
      verifierProposedPage: "AI_MEMORY/wiki/other-page.md",
    }),
    /proposedPage/i,
  );
});
