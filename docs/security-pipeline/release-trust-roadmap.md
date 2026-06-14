# Release-Trust Roadmap

- **Owner:** Tom Pennington (@tompennington) — release-trust lane.
- **Scope:** signing, provenance, and action-pinning hardening for the release
  pipeline. Paired with `sha-pin-policy.md`.

## Status

- Supply-chain checks run via the security-observe workflow (see
  `.github/workflows/security.yml`) in **observe/warn** mode only.
- No check is a required/blocking gate. Promotion requires the release-trust
  owner's sign-off.

## Milestones

### M1 — Action pinning (observe → enforce)
- Adopt `sha-pin-policy.md`: pin every `uses:` ref to a full 40-char commit SHA.
- Stand up the actions-hardening observe check to report unpinned refs.
- Exit: zero unpinned `uses:` refs across all workflows (still observe).

### M2 — Build provenance (SLSA-style attestation)
- Emit provenance attestation for release artifacts describing how/where each
  artifact was built (source commit, builder identity, build parameters).
- Exit: every release artifact has a verifiable provenance attestation.

### M3 — Artifact signing
- Sign release artifacts (e.g. Sigstore/cosign or platform code-signing) and
  publish the public verification material in the release notes / SECURITY.md.
- Exit: all published artifacts are signed and signatures are verifiable by
  consumers.

### M4 — Verification + enforcement promotion (gated)
- Promote pinning/provenance/signing checks from observe to required, gated by
  the release-trust owner's sign-off. Document the verification command
  consumers run.
- Exit: release-trust checks are required gates; provenance + signatures are
  verified in CI.

## Promotion guardrail

Promotion of any milestone's check from observe/warn to a required/blocking gate
requires the release-trust owner's sign-off.
