# T6 / T6.1 — Generic Credential Provisioning

## Finding
Workspace add-ons required demo-specific token maps, literal admin endpoints, and per-demo CLI/env token wiring. This did not scale as a generic SDK credential contract.

## T6 decision
Introduce a typed host-owned resolver keyed by `addonId + purpose` while preserving credential classes:
- **bearer** — add-on-scoped token intentionally deliverable to its sandbox/bootstrap boundary;
- **admin** — host-only credential + admin destination, never exposed to iframe/status/bootstrap.

Backing is environment/config JSON only. There is no encrypted vault. Credentials are read at bridge startup; rotation is restart-bound.

## T6.1 audit corrections
The T6 audit found three narrow issues:
1. raw credential JSON could be passed in argv;
2. `0.0.0.0` was accepted as a credential-bearing admin destination;
3. resolver isolation wording implied authentication the lookup does not provide.

Corrections:
- raw-secret CLI source removed;
- precedence: CLI credential-file reference → env credential-file reference → env JSON → fail closed;
- admin destinations limited to 127.0.0.0/8, ::1, localhost;
- resolver explicitly documented as internal host lookup, not authentication boundary;
- production call sites audited: authoritative manifest entrypoint comes from host cache; privileged routes remain capability-gated; caller credential material cannot override provisioning; no identity escalation found.

## Security conclusions
- admin credential never enters status/bootstrap/UI;
- scoped bearer is the only credential intentionally delivered to the add-on boundary;
- unknown identity/purpose and missing credentials fail closed;
- no raw secrets in argv;
- no encryption-at-rest or live-rotation claim.

## Acceptance
Original T6 SHA `30197261cb179a43126fc0890dd56de9354ffec9` is superseded.

Final accepted SHA:
`b8735970315a8f5ab4a4656dfe6702d31ad47d13`

VIGIL Test Lab #45:
- candidate = actual SHA
- status PASS
- source mutation none
- Browser-host 13/13
- Security/adversarial 12/12
- T2 6/6 + 2/2
- Browser-first 2250/2251, exit 0
- Extension 5/5
- artifact verification PASS

## Deferred hardening
Encrypted-at-rest store, live rotation/expiry, credential-file ownership/mode enforcement, and host-mediated enforcement proxy remain explicit future work.

## Status
CLOSED / independently verified.
