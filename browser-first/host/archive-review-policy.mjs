function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isTrueLike(value) {
  return ["true", "yes", "required", "1"].includes(normalized(value));
}

export function archiveReviewRequiresHuman(metadata = {}) {
  return isTrueLike(metadata.humanReviewRequired) ||
    isTrueLike(metadata.requiresHumanReview) ||
    ["human", "human-required", "manual", "manual-human"].includes(normalized(metadata.reviewMode)) ||
    ["human", "human-required", "manual", "manual-human"].includes(normalized(metadata.reviewGate)) ||
    ["escalated", "human-review", "human-required"].includes(normalized(metadata.escalationStatus)) ||
    Boolean(String(metadata.humanReviewReason ?? "").trim());
}

export function isHumanReviewActor({ actor = "", actorType = "" } = {}) {
  const normalizedActor = normalized(actor);
  return normalized(actorType) === "human" ||
    normalizedActor === "human" ||
    normalizedActor === "user" ||
    normalizedActor === "manual-human" ||
    normalizedActor.startsWith("human:");
}

export function assertArchiveReviewTransitionAllowed({ metadata = {}, nextStatus = "", actor = "", actorType = "" } = {}) {
  const status = normalized(nextStatus);
  if (!["approved", "rejected"].includes(status)) {
    return;
  }
  if (archiveReviewRequiresHuman(metadata) && !isHumanReviewActor({ actor, actorType })) {
    throw new Error("Escalated Living Archive review requests require explicit human approve/reject actions.");
  }
}
