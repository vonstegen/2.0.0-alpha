# SDK-DEMO-003R R&D / Audit Record

This directory is the durable technical record for SDK-DEMO-003R.

It separates four classes of information:

1. **Findings** — mechanically observed defects or architectural gaps.
2. **Decisions** — architecture choices made in response and the invariants they establish.
3. **Verification** — exact-SHA evidence used to accept a correction.
4. **Hardening backlog** — worthwhile future work that is not claimed as complete.

## Current lineage

- Tom-reviewed baseline: `c92bf898d0f801a2a189cd111000fc8a24f88c19`
- T1–T3/live-integration accepted candidate: `c869a92841511fc444ef42772bdae2e985303890`
- T4 independently accepted candidate: `c57d4d0f579f601de91fcf3b7d7faca343d68c7d`
- T5 engineering candidate: `20726e395909e135782205d7fdad37d481aa5400`
- T5 independent verification: tracked separately; do not treat T5 as closed until its exact-SHA Test Lab run is final.

## Core invariants

**T1 — Host-owned authority**  
REQUEST DESCRIBES INTENT. HOST DETERMINES AUTHORITY.

**T2 — Read versus mutation**  
READ/DISCOVERY REPORTS STATE. EXPLICIT INSTALL MUTATES STATE.

**T4 — Converged revocation**  
Registry grant state is authoritative; upstream enforcement is its projection. Successful operator revoke/regrant converges both. Partial failure is fail-closed and never reported as successful convergence.

## Index

- [Findings](SDK-DEMO-003R-FINDINGS.md)
- [Decision Log](SDK-DEMO-003R-DECISION-LOG.md)
- [Verification Ledger](SDK-DEMO-003R-VERIFICATION-LEDGER.md)
- [Hardening Backlog](SDK-DEMO-003R-HARDENING-BACKLOG.md)
- [T1](findings/T1-HOST-OWNED-AUTHORITY.md)
- [T2](findings/T2-READ-ONLY-DISCOVERY.md)
- [T3](findings/T3-INSTALL-HANDLER-CONTRACT.md)
- [T4](findings/T4-REVOCATION-CONVERGENCE.md)
- [T5](findings/T5-OPERATOR-GRANT-REVOKE-UI.md)

## Acceptance model

Engineering-agent PASS is not final acceptance. The normal path is:

`Build work order → candidate SHA → independent VIGIL Test Lab exact-SHA run → code/evidence audit → closure`.

The Test Lab is deterministic and does not use an LLM to decide PASS/FAIL.
