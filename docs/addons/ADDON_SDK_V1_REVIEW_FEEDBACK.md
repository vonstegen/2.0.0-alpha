# Add-on SDK V1 Review Feedback

## Review metadata

- Review date: 2026-08-25
- Review target: `vonstegen/2.0.0-alpha`
- Baseline reviewed: `dev` at `530b753`
- Relevant sub-project: the Add-on SDK defined by
  `docs/architecture/ADR-006-addon-runtime-sdk.md`,
  `docs/architecture/ADR-018-addon-sdk-v0.md`,
  `docs/architecture/ADR-023-addon-repository-registry-model.md`, and
  `src/sdk/addons/`
- Purpose: preserve architectural feedback from the Plugin SDK research review
  against the updated fork

## Current architecture found in the fork

The fork already has the foundation of an extension framework. ADR-006 is the
accepted trust and runtime decision: add-ons use explicit manifests, provenance
tiers, capability grants, runtime categories, host mediation, lifecycle rules,
and revocation behavior. Provenance influences warnings, recommended grants,
upgrade trust, and support posture, but it does not override capability checks.

ADR-018 makes that architecture concrete as Add-on SDK V0. The binding internal
implementation is under `src/sdk/addons/`, including contracts, validation,
registry modeling, and surface routing. Tests cover manifest and registry
behavior. The document correctly describes V0 as an internal standard rather
than a finished public marketplace SDK.

ADR-023 already establishes the intended external boundary. It calls for an
eventual extracted SDK package, a separate registry, and creator-owned add-on
repositories while keeping installation state and capability authority in the
host. That direction matches the useful parts of the proposed Resonant
Extension Framework without requiring a second architecture.

## Security branch and merge status

The remote branch `sdk/p1b-p1e-slots-provenance` remains at commit `ca8ff57`
(`sdk: Gate add-on systemSlots and mark missing provenance as unreviewed`). It
has no pull request in `vonstegen/2.0.0-alpha`, and it is not an ancestor of the
current `dev` ref under that commit identity.

The same patch is already present on `dev` as commit `ff25748`. A direct patch
comparison between `ca8ff57` and `ff25748` is identical. Therefore, the branch
should be treated as landed by equivalent/cherry-picked commit, not as missing
work and not as a normally merged branch. Its important outcomes are already in
the current baseline: privileged system slots are capability-gated and missing
provenance is forced to an unreviewed posture.

## Recommendation

Do not create a competing REF architecture beside the existing Add-on SDK.
Evolve the accepted ADR-006/ADR-018 model toward a public, third-party Add-on
SDK V1. This avoids duplicate manifests, trust vocabularies, registries, and
host boundaries while preserving the security work already implemented.

The V1 effort should retain these proposed extension-framework properties:

1. **External package boundary.** Extract the stable public contracts,
   manifest schema, validator, fixtures, and author documentation into a
   versioned package, as anticipated by ADR-023. Keep privileged execution and
   installation state host-owned.
2. **Developer CLI.** Provide commands to scaffold, validate, test, pack, and
   inspect an add-on without granting the CLI runtime authority. CLI output
   should be reproducible and suitable for CI.
3. **`.rpkg`-style packaging.** Define one documented, inspectable archive
   format for manifests, code/assets, declared entrypoints, license and review
   metadata. The exact extension may change, but one canonical format should
   replace ad hoc installation shapes.
4. **Deterministic hashes.** Canonicalize archive construction and manifest
   serialization so the same inputs yield the same artifact hash. Registry,
   review, certification, and signature records must bind to that digest.
5. **Version-specific certification.** Certification applies to an exact
   add-on version, SDK compatibility range, artifact digest, and relevant host
   policy version. Updating any bound input requires re-certification.
6. **Publisher and Resonant signing.** Keep publisher identity signatures
   separate from Resonant review/curation signatures. A publisher signature
   proves origin; a Resonant signature records a review decision. Neither
   signature grants capabilities or bypasses host enforcement.
7. **Review records.** Store structured, auditable records containing artifact
   digest, manifest digest, reviewer or review authority, checks performed,
   result, timestamp, compatibility target, and any limitations. ADR-023's
   registry record can be extended rather than replaced.
8. **Revocation.** Support revocation of publisher keys, individual artifacts,
   certifications, and registry listings. The host should fail safely, explain
   the reason to the user, and preserve the existing grant lifecycle rather
   than silently substituting trust.
9. **External Plugin M0 Test.** Before redesigning the core, prove the boundary
   with one add-on maintained outside the core repository. It must consume only
   the public SDK package, build a deterministic package, validate in CI,
   sideload through a documented host path, request and lose capabilities
   correctly, expose a health result, and uninstall without leaving authority
   or trusted state behind.

## Suggested V1 progression

Use incremental evidence gates:

1. Freeze and document the smallest public contract already exercised by
   `src/sdk/addons`.
2. Extract that contract and its validator without changing host authority.
3. Build the External Plugin M0 Test in a separate repository.
4. Add the developer CLI and deterministic package builder around the proven
   contract.
5. Bind review and version-specific certification records to package hashes.
6. Add publisher signing, Resonant signing, registry publication, and
   revocation handling only after sideload lifecycle tests pass.

## Compatibility constraints

- Preserve ADR-006 provenance tiers and explicit capability grants.
- Preserve the ADR-018 rule that add-ons cannot obtain privileged access
  directly or write directly to trusted Living Archive knowledge.
- Preserve ADR-023's separation between discovery metadata and host-owned
  installation, enablement, and grants.
- Treat packaging, signatures, certification, and registry presence as evidence
  about an artifact, never as ambient runtime authority.
- Keep the current browser-first Alpha boundary explicit: a future public SDK
  plan is not a claim that external registry distribution is implemented in the
  Alpha today.

## Decision requested from maintainers

Adopt “Add-on SDK V1” as the continuation of ADR-006, ADR-018, and ADR-023, and
use the External Plugin M0 Test as the entry criterion for public SDK work. If
accepted, capture the binding decision in a new ADR or an explicit amendment to
the existing ADR set; this feedback note itself is not architectural authority.
