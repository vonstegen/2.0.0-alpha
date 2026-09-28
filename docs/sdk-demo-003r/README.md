# SDK-DEMO-003R R&D / Audit Record

This directory is the durable technical record for SDK-DEMO-003R. It separates mechanically observed findings, architectural decisions, exact-SHA verification evidence, and future hardening recommendations.

## Current accepted lineage
- T1–T3/live integration: `c869a92841511fc444ef42772bdae2e985303890` — PASS (#28)
- T4: `c57d4d0f579f601de91fcf3b7d7faca343d68c7d` — PASS (#39)
- T5: `20726e395909e135782205d7fdad37d481aa5400` — PASS (#41)
- T6 engineering: `30197261cb179a43126fc0890dd56de9354ffec9` — superseded by T6.1
- T6/T6.1 final: `b8735970315a8f5ab4a4656dfe6702d31ad47d13` — PASS (#45)

Every transition above is a linear one-commit advance with no dropped accepted history.

## Core invariants
**T1:** REQUEST DESCRIBES INTENT. HOST DETERMINES AUTHORITY.  
**T2:** READ/DISCOVERY REPORTS STATE. EXPLICIT INSTALL MUTATES STATE.  
**T4:** Registry grant state is authoritative; upstream enforcement is its projection. Successful revoke/regrant converges both; partial failure is fail-closed.  
**T5:** Browser UI represents host authority; it does not own privileged authority.  
**T6/T6.1:** Credential material is host-resolved by add-on identity + purpose. Scoped bearer may cross only its intended boundary; admin material remains host-only; raw credential JSON is not supported in argv.

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
- [T6/T6.1](findings/T6-GENERIC-CREDENTIAL-PROVISIONING.md)

## Acceptance model
Engineering-agent PASS is not final acceptance:

`Build work order → candidate SHA → independent VIGIL Test Lab exact-SHA run → code/evidence audit → closure`.

## Current status
T1–T6.1 are CLOSED and independently verified. Accepted pre-T7 baseline:

`b8735970315a8f5ab4a4656dfe6702d31ad47d13`
