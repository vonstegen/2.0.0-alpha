# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability in this project, please
report it privately. **Do not open a public issue for security reports.**

- **Disclosure contact:** Vladimir Rondelli (rondellivladimir@gmail.com)
- **Report channel:** email the disclosure contact above with the subject line
  prefix `[SECURITY]`. Provide a description, reproduction steps, affected
  version/commit, and impact assessment. PGP key fingerprint: _TBD placeholder_.

The disclosure contact is the single accountable owner for triage and
coordinated-disclosure decisions for this repository.

## Response SLA

> **Placeholder — to be ratified by the disclosure owner.**

| Stage | Target |
| --- | --- |
| Acknowledgement of report | _TBD (placeholder) — e.g. within 3 business days_ |
| Triage / severity assignment | _TBD (placeholder)_ |
| Fix or mitigation plan | _TBD (placeholder)_ |
| Coordinated public disclosure | _TBD (placeholder)_ |

These targets are placeholders pending owner ratification and MUST be filled
with concrete values.

## Supported Scope

Security reports are accepted for the following in-scope surfaces:

- The application IPC / capability surface (Tauri command handlers and bridge
  routes).
- Subprocess / shell invocation and environment handling.
- Provider URL handling, the memory-service listener, and LAN exposure.
- Installed-skill trust (`allowed-tools` declarations, allowlist/denylist).
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
| `dev` (latest) | yes |
| Tagged releases | _TBD (placeholder)_ |

## Safe Harbor

Good-faith research conducted in accordance with this policy will not be pursued
or reported as abuse. _Detailed safe-harbor terms: TBD placeholder._
