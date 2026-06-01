function normalizePathToken(value) {
  return String(value ?? "").trim();
}

function assertEqualField(field, actual, expected) {
  if (normalizePathToken(actual) !== normalizePathToken(expected)) {
    throw new Error(`Draft promotion verifier mismatch: ${field} does not match the draft artifact.`);
  }
}

export function assertPromotionVerifierMatchesDraft({
  draftArtifactPath,
  requestPath,
  sourceArtifactPath,
  proposedPage,
  artifactVerificationStatus,
  verifierStatus,
  verifierDraftArtifactPath,
  verifierRequestPath,
  verifierSourceArtifactPath,
  verifierProposedPage,
} = {}) {
  if (normalizePathToken(artifactVerificationStatus) !== "verified") {
    throw new Error("Draft promotion requires artifact verification status verified.");
  }
  if (normalizePathToken(verifierStatus) !== "verified") {
    throw new Error("Draft promotion requires a verified verifier artifact.");
  }
  assertEqualField("draftArtifactPath", verifierDraftArtifactPath, draftArtifactPath);
  assertEqualField("requestPath", verifierRequestPath, requestPath);
  assertEqualField("sourceArtifactPath", verifierSourceArtifactPath, sourceArtifactPath);
  assertEqualField("proposedPage", verifierProposedPage, proposedPage);
}
