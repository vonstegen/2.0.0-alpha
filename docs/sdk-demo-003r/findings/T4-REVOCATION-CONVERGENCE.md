# T4 — Revocation / Enforcement Convergence

## Finding
Two independent channels could diverge:
- registry revoke could deny projected grants while an already-valid bearer remained accepted upstream;
- upstream admin revoke could deny enforcement while registry/bootstrap still reported granted authority.

## Decision
Registry grant state is authoritative; upstream host enforcement is its projection. Both revoke routes coordinate both writes through a common host-owned convergence operation.

Deny ordering is fail-closed: upstream closes first, then registry denial persists. Allow/regrant persists authority before opening upstream enforcement.

This is not represented as a distributed transaction. Partial failure returns failure and is never reported as converged success.

## Additional conclusions
Bootstrap does not resurrect revoked authority: reinstall initializes grants denied. Expected policy errors map to 4xx; runtime/upstream failures remain 5xx.

## Evidence
Candidate `c57d4d0f579f601de91fcf3b7d7faca343d68c7d`; independent VIGIL Test Lab #39 PASS with source mutation none.

## Status
CLOSED / independently verified.
