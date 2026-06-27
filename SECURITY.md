# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project, please
report it privately. **Do not open a public issue for security reports.**

- **Disclosure contact:** Vladimir Rondelli (rondellivladimir@gmail.com)
- **Report channel:** email the disclosure contact above with the subject line
  prefix `[SECURITY]`. Provide a description, reproduction steps, affected
  version/commit, and impact assessment. No project PGP key is published for
  the private internal alpha; use the disclosure contact's agreed secure channel
  if encrypted material must be exchanged.

The disclosure contact is the single accountable owner for triage and
coordinated-disclosure decisions for this repository.

## Response SLA

| Stage | Target |
| --- | --- |
| Acknowledgement of report | Within 3 business days |
| Triage / severity assignment | Within 7 business days |
| Fix or mitigation plan | Within 14 business days for confirmed high-impact findings |
| Coordinated public disclosure | Not applicable to private internal alpha unless the owner approves external disclosure |

These targets apply to the private internal alpha. Public-release support terms
must be reviewed before broader external distribution.

## Supported Scope

Security reports are accepted for the following in-scope surfaces:

- The Chrome extension capability surface, including side-panel, new-tab,
  content-script, and background-service-worker message routing.
- The local Node.js bridge routes and capability-token boundaries.
- Subprocess / shell invocation and environment handling.
- Provider URL handling, the memory-service listener, and loopback/LAN exposure.
- Add-on trust (`allowed-tools` declarations, allowlist/denylist, scoped bridge
  APIs).
- The release-trust surface (action pinning, signing, provenance) — see
  [`docs/security-pipeline/sha-pin-policy.md`](docs/security-pipeline/sha-pin-policy.md)
  and
  [`docs/security-pipeline/release-trust-roadmap.md`](docs/security-pipeline/release-trust-roadmap.md)
  (owner: release-trust lane, Tom Pennington / @tompennington).

**Out of scope** (non-exhaustive): findings in third-party dependencies that
have no demonstrated impact on this project, social-engineering reports, and
denial-of-service that requires privileged local access already granted by the
threat model.

## Supported Versions

| Version / branch | Supported |
| --- | --- |
| `dev` (latest browser-first alpha) | yes |
| Internal alpha tags | yes, while actively used for internal testing |
| Public releases | not yet supported |

## Safe Harbor

Good-faith research conducted in accordance with this policy will not be pursued
or reported as abuse. Researchers must avoid accessing third-party accounts,
exfiltrating secrets, disrupting provider services, modifying trusted memory
outside test data, or publishing vulnerability details before the disclosure
owner confirms remediation or an approved disclosure plan.
