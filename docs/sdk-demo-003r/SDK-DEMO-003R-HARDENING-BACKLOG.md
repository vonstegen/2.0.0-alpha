# SDK-DEMO-003R Future Hardening Backlog

These are recommendations and follow-up risks, not claims of unresolved acceptance blockers unless explicitly marked.

## H1 — Per-capability operator consent
**Origin:** T5 audit.  
**Current state:** UI grants all currently ungranted requested capabilities in one action.  
**Recommendation:** consider per-capability toggles/consent if the long-term SDK requires finer operator control.  
**Priority:** Medium.  
**Status:** Future hardening.

## H2 — Public vs trusted install contract
**Origin:** T5.  
**Current state:** public UI uses intent-only `{addonId}`; trusted host-side callers may still supply canonical `{manifest}`.  
**Recommendation:** document and enforce this distinction explicitly in the public SDK contract.  
**Priority:** Medium.

## H3 — Partial-failure recovery for converged revocation
**Origin:** T4 audit.  
**Current state:** deny is fail-closed; a failure after upstream denial but before registry persistence may leave a safe split state while returning failure.  
**Recommendation:** define operator-visible reconciliation/retry tooling and durable recovery semantics. Do not claim impossible cross-system atomicity.  
**Priority:** High for production hardening.

## H4 — Bootstrap reinstall semantics
**Origin:** T2/T4 audit.  
**Current state:** bootstrap may reinstall a cached manifest after registry removal, but install initializes grants denied and does not resurrect bearer authority.  
**Recommendation:** document this behavior as an explicit lifecycle rule and keep regression coverage.  
**Priority:** Medium.

## H5 — Error taxonomy stability
**Origin:** T1/T4/T5.  
**Current state:** harness routes distinguish policy 4xx from runtime 5xx.  
**Recommendation:** make the error-family mapping part of the SDK contract and regression-lock new privileged routes.  
**Priority:** Medium.

## H6 — Test-state isolation
**Origin:** T5 engineering.  
**Current state:** older graphical tests had relied on durable registry state left by previous runs. T5 corrected affected tests and added fresh user-root isolation.  
**Recommendation:** require isolated user/registry roots for every live SDK certification lane.  
**Priority:** High.

## H7 — VIGIL-MCP operator-session isolation warnings
**Origin:** infrastructure observations during earlier engineering runs.  
**Scope:** VIGIL-MCP, not SDK acceptance.  
**Recommendation:** separately investigate reports of pre-existing operator OMP PIDs disappearing during managed work.  
**Priority:** Medium infrastructure hardening.

## H8 — Verification-plan coverage growth
**Origin:** T4/T5.  
**Current state:** standard Test Lab plan catches broad regressions; task-specific tests live in the candidate and are reached through browser-first/unit stages.  
**Recommendation:** maintain an explicit mapping from each closed finding to the exact test(s) that prevent recurrence.  
**Priority:** Medium.
