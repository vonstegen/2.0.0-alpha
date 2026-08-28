# 13 — Current Repository to Target Mapping

## Baseline note

This map reflects the supplied `resonantos-alpha` mirror, described as the `vonstegen/2.0.0-alpha` `dev` baseline. It is a planning crosswalk, not a substitute for repository ADR authority or a live GitHub branch comparison.

| Current asset | What it already provides | Target change |
| --- | --- | --- |
| `docs/architecture/ADR-006-addon-runtime-sdk.md` | signed/provenance-aware add-ons, categories, explicit grants, isolation, lifecycle | add extension classes, nested authority rule, temporal/task grant semantics |
| `docs/architecture/ADR-018-addon-sdk-v0.md` | manifest validation, tools, services, Augmentor skills, agent operating contracts | define AugmentorExtension and HarnessProvider protocols; typed task/event/result/resource contracts |
| `src/sdk/addons/contracts.ts` | SDK facade and stable V0 capability list | split richer identity/authority/task contracts into focused modules; retain compatibility facade |
| `src/core/contracts.ts` | broad capabilities, `CapabilityGrant`, delegation and compute shapes, replaceable slots | add principals, lineage, structured scopes, grant lifecycle, budgets; resolve `primary-agent` vs orchestrator terminology |
| `browser-first/host/bridge-server.mjs` and route services | authenticated host mediation and capability gates | require governed request envelope at effects; validate grant handle, audience, chain, time, and route scope |
| `browser-first/host/addon-delegation-service.mjs` | bounded Hermes/OpenCode packets, lifecycle, cancellation, artifact-root checks, constrained environments | extract generic harness service; replace provider-specific duplication with adapters; persist event/lineage/resource records |
| `browser-first/host/addon-delegation-host-service.mjs` | Hermes/OpenCode start/status/artifact/cancel routes | add generic versioned harness routes while retaining compatibility endpoints |
| `browser-first/host/hermes-runtime.mjs` | fixed-root runtime integration and supervision | implement HarnessProviderAdapter and child/sandbox reporting |
| `browser-first/host/opencode-runtime.mjs` | OpenCode runtime integration | implement same adapter; validate workspace leases and coding result contract |
| `public/addons/hermes.json`, `opencode.json`, `openclaw.json` | manifest footholds for complete agent add-ons | mark `extensionClass: harness-provider`; add protocol, resource, context, cancellation, and child policy |
| `src/modules/hermes/`, `src/modules/opencode/`, `src/modules/delegation/` | provider workspaces and review UI | render generic task/event/authority/budget state without erasing provider-specific UX |
| `docs/architecture/ADR-016-context-memory-compaction.md` and context-memory code | structured, source-linked, provider-independent continuity | add context envelopes, retention labels, delegation links, last-known-good snapshot metadata |
| archive intake/review boundaries | no direct trusted knowledge writes from agent add-ons | preserve; generalize through memory-provider broker and artifact provenance |
| `docs/architecture/ADR-010-recovery-ladder.md` and `src/modules/recovery/` | staged Engineer workflow and route promotion | introduce Ground-0 as Core state beneath workflow; quarantine optional executable state and revoke grants |
| `docs/architecture/ADR-026-minimal-kernel-replaceable-default-addons.md` | minimal kernel, replaceable primary agent/chat/memory, Core Engineer | ratify Augmentor as the permanent fused orchestrator; keep policy authority in Core (Augmentor is not the security root) |
| `docs/architecture/ADR-032-resonantos-compute-fabric.md` and compute contracts | typed compute nodes/jobs and mediated execution direction | add cross-harness admission, reservation, budget roll-up, leases, and recovery reserve |

## Preserve

- Browser extension + authenticated Node bridge as the active runtime boundary.
- Manifest-first validation, provenance separate from authority, and explicit enablement/grants.
- Host-owned credentials and route-level resource checks.
- Artifact return and human review.
- Intake-only writes to trusted memory.
- Existing provider-specific UX where it adds value.
- Core-owned Engineer and recovery floor.

## Refactor carefully

- Do not rename `Strategist`, `Augmentor`, and `primary-agent` mechanically. Ratify one vocabulary and migrate state with compatibility aliases.
- Do not turn the generic harness service into an unrestricted shell runner.
- Do not store delegated bearer authority in browser storage or task Markdown.
- Do not make Ground-0 depend on optional Augmentor Chat or Living Archive UI; consume continuity through Core-owned read paths.
- Do not make ADR-032 an Alpha requirement merely because its types support the target.

## Proposed ADR set

1. Browser-first multi-harness architecture and terminology.
2. Principal/delegation chain and task-scoped temporal authority.
3. Augmentor extension and harness provider SDK contracts.
4. Ground-0 state and executable-state quarantine.
5. Concurrent resource governance.

These may amend existing ADRs, but the repository should retain clear supersession and Alpha-applicability metadata.
