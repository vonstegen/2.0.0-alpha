import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveReviewRequiresHuman,
  assertArchiveReviewTransitionAllowed,
  isHumanReviewActor,
} from "../host/archive-review-policy.mjs";

test("archive review policy detects human-required review metadata", () => {
  assert.equal(archiveReviewRequiresHuman({ humanReviewRequired: "true" }), true);
  assert.equal(archiveReviewRequiresHuman({ reviewGate: "human-required" }), true);
  assert.equal(archiveReviewRequiresHuman({ escalationStatus: "escalated" }), true);
  assert.equal(archiveReviewRequiresHuman({ humanReviewReason: "doctrine-sensitive" }), true);
  assert.equal(archiveReviewRequiresHuman({ reviewMode: "routine" }), false);
});

test("archive review policy distinguishes human actors from AI/service actors", () => {
  assert.equal(isHumanReviewActor({ actor: "human" }), true);
  assert.equal(isHumanReviewActor({ actor: "human:manolo" }), true);
  assert.equal(isHumanReviewActor({ actorType: "human" }), true);
  assert.equal(isHumanReviewActor({ actor: "strategist-verifier" }), false);
  assert.equal(isHumanReviewActor({ actor: "resonantos-browser-first" }), false);
});

test("archive review policy blocks non-human approval of escalated work", () => {
  assert.throws(
    () => assertArchiveReviewTransitionAllowed({
      metadata: { escalationStatus: "escalated" },
      nextStatus: "approved",
      actor: "strategist-verifier",
    }),
    /explicit human approve\/reject/
  );
  assert.throws(
    () => assertArchiveReviewTransitionAllowed({
      metadata: { humanReviewRequired: "true" },
      nextStatus: "rejected",
      actor: "resonantos-browser-first",
    }),
    /explicit human approve\/reject/
  );
});

test("archive review policy allows routine AI approval and human escalation decisions", () => {
  assert.doesNotThrow(() => assertArchiveReviewTransitionAllowed({
    metadata: { reviewMode: "routine" },
    nextStatus: "approved",
    actor: "strategist-verifier",
  }));
  assert.doesNotThrow(() => assertArchiveReviewTransitionAllowed({
    metadata: { escalationStatus: "escalated" },
    nextStatus: "approved",
    actorType: "human",
  }));
  assert.doesNotThrow(() => assertArchiveReviewTransitionAllowed({
    metadata: { escalationStatus: "escalated" },
    nextStatus: "in-progress",
    actor: "strategist-verifier",
  }));
});
