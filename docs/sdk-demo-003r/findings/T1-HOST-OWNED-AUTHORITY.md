# T1 — Host-Owned Privileged Authority

## Finding
The admin-revoke request path could carry caller-selected privileged endpoint/credential data.

## Decision
**REQUEST DESCRIBES INTENT. HOST DETERMINES AUTHORITY.**

The caller identifies the add-on and requested action. The host resolves trusted administrative URL and credential from host-owned configuration. Caller attempts to inject `upstreamAdminUrl` or `adminToken` are rejected.

## Evidence
Adversarial coverage includes valid host-owned authority, unknown/missing configuration, caller URL/token injection, malformed request shapes, and credential non-disclosure in tested error paths.

## Status
CLOSED. Preserved through later T4/T5 regression runs.
