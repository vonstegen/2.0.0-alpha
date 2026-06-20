# Glossary Consistency Report

## Status

`pass` with non-blocker gaps.

## Terms

| Term | Meaning | Status |
| --- | --- | --- |
| Security Pipeline | Dedicated CI control plane for security checks. | stable |
| Check Registry | Declarative config listing security checks and policies. | stable |
| Check Adapter | Script or command that runs one check and emits normalized result evidence. | stable |
| Check Family | Group of related checks, such as supply chain or secrets. | stable |
| Policy Mode | Enforcement state: `observe`, `warn`, `block`, or `disabled`. | stable |
| Supply Chain MVP | First check family focused on dependency, lockfile, registry, and CI-action compromise paths. | stable |
| Result Envelope | Normalized output shape for each check. | candidate |
| Security Control Plane | The combined workflow, registry, runner, and adapter contract. | candidate |

## Consistency Notes

- The previous phrase "supply-chain CI" is now narrowed to the MVP family, not the whole architecture.
- "Pipeline" means security-only orchestration, not a replacement for `alpha-build.yml`.
- "Check" means one discrete security verification unit. It should not secretly bundle unrelated policy decisions.
- "Family" gives room to add or remove groups of checks without flattening every concern into one workflow.

## Gaps

- The final registry schema should become canonical only after the MVP implementation validates it.
- Result envelope fields may change during the first runner implementation.
