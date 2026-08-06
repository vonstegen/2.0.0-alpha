const POLICY = Object.freeze({
  ok: Object.freeze({ action: "answer", mayUseEvidence: true, reasonCode: "SUPPORTED_EVIDENCE" }),
  partial: Object.freeze({ action: "qualify", mayUseEvidence: true, reasonCode: "BOUNDED_PARTIAL_EVIDENCE" }),
  no_match: Object.freeze({ action: "clarify", mayUseEvidence: false, reasonCode: "NO_MATCH" }),
  conflict: Object.freeze({ action: "clarify", mayUseEvidence: false, reasonCode: "STRUCTURED_CONFLICT" }),
  insufficient_evidence: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "INSUFFICIENT_EVIDENCE" }),
  stale: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "STALE_PROJECTION" }),
  denied: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "ACCESS_DENIED" }),
  invalid_request: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "INVALID_REQUEST" }),
  budget_exceeded: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "BUDGET_EXCEEDED" }),
  temporary_failure: Object.freeze({ action: "abstain", mayUseEvidence: false, reasonCode: "TEMPORARY_FAILURE" }),
});

export const CONSULTATION_ANSWER_ACTIONS = Object.freeze(["answer", "qualify", "clarify", "abstain"]);

export function consultationAnswerPolicy(result) {
  const selected = POLICY[result?.status];
  if (!selected) throw new Error(`Unsupported consultation result status: ${result?.status ?? "missing"}`);
  return {
    ...selected,
    mustCiteSources: selected.mayUseEvidence,
    followRetrievedInstructions: false,
    authorityEffect: "none",
  };
}
