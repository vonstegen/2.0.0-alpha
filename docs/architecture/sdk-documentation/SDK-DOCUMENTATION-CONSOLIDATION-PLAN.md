# ResonantOS SDK Documentation Consolidation Plan

**Document ID:** ROS-SDK-DOC-PLAN-001  
**Status:** Reviewable consolidation plan; source rewrites have not started.  
**Date:** 29 September 2026 (America/New_York).  
**Revision:** 1.0  
**Architecture scope:** The existing ResonantOS SDK set in [the inventory](SDK-DOCUMENTATION-INDEX.md); SAIF excluded.  
**Implementation status:** Documentation-only. Runtime architecture, feature branches and release scope remain governed by existing decisions.  
**Evidence/commits:** Inventory pins the seven-task cutoff `180f3067906d4782df5b923ca46ef77b80828333`, SDK Fabric `34a2be7`, Phase-II integration design `297e64a`, P2 evidence `5ac7c24` and Skills correction `0f4917f`.  
**Related ADRs:** ADR-006, 018, 022, 023, 026, 038–044 within their documented applicability.  
**Unresolved work:** Acceptance links, detailed Tom review, branch reconciliation, pair parity, proof-tree identity and required documentation checks.  
**Next phase:** C1 evidence register, then bounded C2–C6 editorial consolidation; no runtime implementation is authorized by this plan.

## Outcome and constraints

Produce one discoverable documentation set that tells Tom and future contributors what exists, what has been tested, what executed live and what remains planned. Markdown is the GitHub-native reference. Every official architecture/report body has a LaTeX counterpart derived from the same revision. PDFs are optional frozen presentation outputs.

Use `docs/architecture/sdk-fabric/` as the proposed synthesis destination because it already contains official-format pairs. This is an editorial destination recommendation, not a replacement runtime architecture or a new release authority. Keep ADRs in their existing paths and retain their decision history.

Preserve source files until successors contain all unique material, evidence links and explicit supersession metadata. Do not cherry-pick code, merge branches, change ADR acceptance status or start Memory/Tools/P2 integration in this documentation task.

## Work sequence and acceptance checkpoints

| Checkpoint | Work | Reviewable result / exit criterion |
| --- | --- | --- |
| C0 Inventory | Read relevant branch trees, Markdown, LaTeX, proof report and supplied review; register duplicates and missing pairs | Index and plan published for review before rewriting source documents. Complete for the inspected branch set. |
| C1 Evidence register | Map T1–T7/T7.1; record current dev vs Tom's upstream snapshot; resolve independent acceptance and P2 executed-tree identity | Every status claim has exact SHA, scope, source and limitation; unresolved items remain explicit. |
| C2 Architecture consolidation | Reconcile External/Internal/category/provider/contract narratives against scoped ADRs | No change to runtime decisions; full current/planned separation and related-ADR links. |
| C3 Resource and proof documents | Pair Project/Files, accepted Skills implementation, Memory/Tools roadmap, P2 report and integration design | No diagram implies composed/live behavior before proof; no native tool sandbox claim from cwd alone. |
| C4 References and qualification | Reconcile Echo/Guide targets, catalog proposal, Pi interface roadmaps and qualification matrices | One crosswalk preserving original phase/test IDs; execution ledger separate from planned test matrix. |
| C5 Official rendering | Generate matching .tex from reviewed .md; compile and visually inspect; freeze optional PDF | Same revision/status/evidence/limitations in both formats; readable tables and diagrams; no clipped text. |
| C6 Publication / history | Add navigable index, publish documentation-only PR into dev, apply approved successor notices | Required docs gates pass or baseline failures are named; no runtime diff; historical originals preserved. |

C0 is a publication checkpoint, not an architecture-acceptance vote. C1–C6 are bounded editorial work and verification under this documentation ownership. External/runtime decisions remain with their established owners and engineering lanes.

## Proposed official document set

These are proposed successor titles/paths, not files falsely presented as already created. Keep existing filenames where a narrow revision is sufficient.

| Proposed official body | Existing material to preserve | Required .md/.tex action |
| --- | --- | --- |
| Architecture baseline and authority | F/01, predecessor K/01, Alpha boundary, dev status | Revise dated overview; separate shipped Alpha and candidate work. |
| External SDK architecture | F/02, K/02, SDK package README, ADR-006/018/023 | Synchronize pair; public contract and future packaging separately. |
| Internal SDK and module boundaries | F/03, K/03, ownership/ADR-026/038 | Synchronize pair; uniform ports remain PLANNED. |
| Dynamic Category Framework | ADR-040, category registry guide | New paired narrative referencing the ADR; retain guide as operational source. |
| Provider Profiles | ADR-039 and provider metadata/credential source boundary | New pair; session credential behavior vs durable vault roadmap. |
| Harness Provider Connection | ADR-041, 1.1A–1.1D history and credential planner | New pair; reconcile protocol migration chronology and qualification evidence. |
| Generic Harness Resource Contract | ADR-042 | New pair; request/grant/projection and supported operations. |
| Project + Files Projection | ADR-043 at 2B.1 | New pair; current-authority fencing and containment limits. |
| Skills Projection | ADR-044 accepted architecture and accepted staging candidate | New pair after independent implementation acceptance is linked. |
| Memory and Tools Roadmap | F/11, resource R&D, phase plan | New pair; bounded search/read and explicit invocation remain roadmap scope. Do not invent module readiness. |
| Pi Reference Harness Architecture | F/11 and native-interface R&D | Revise existing pair; native projection, adapters and gateway are status-qualified. |
| Add-on Catalog / Card Architecture | F/10 | Preserve proposal; synchronize full pair, distinguish Installation Record and current UI. |
| P2 Native Credential Live Proof | Original P2 TeX and implementation/evidence commits | Create Markdown counterpart preserving original report; resolve executed SHA and retain original frozen report. |
| P2 + Phase-II Integration Architecture | I integration contract | Add LaTeX; keep design-only status and staging prerequisite. |
| Tom September 28 Requirements | Source PDF, detailed review when located, branch-local traceability | Add .tex and full numbered issue/evidence mapping; no unverified closure. |
| Qualification and Evidence Model | F/08, Phase-II roadmap, P2 evidence, browser/docs gates | Full pair and execution ledger; distinguish deterministic, graphical and live proof. |
| SDK Echo / SDK Guide | F/07 and earlier demo implementations | Split current reference from 2.0 target; preserve existing pair through reviewed revision. |
| Pi Demo and Add-on Roadmap | F/06/08, native-interface M0–M12, Phase-II 2A–2G, integration I1–I8 | One paired roadmap crosswalk; terminal/PTY stays PLANNED unless explicit release decisions/evidence support it. |

F/K/I refer to pinned source families in the index. Original CSV matrices remain source data; generate reduced presentation tables from that data with declared selected columns rather than maintaining divergent copies.

The ResonantOS Sovereign SDK Fabric R&D documents remain in a labeled R&D annex. Their name and scope alone do not prove identity with SAIF. They must contain only ResonantOS-specific proposed seams; omit independent SAIF research and avoid treating general future ports as implementation.

## Mandatory document header

Every official body must carry:

- document ID/title, revision, status, date and owner;
- architecture scope and Alpha applicability;
- implementation status using IMPLEMENTED, TESTED, PROVEN LIVE, PLANNED and NOT YET IMPLEMENTED at claim level;
- evidence branch/commit, relevant code/tests and execution/acceptance source;
- unresolved work and limitations;
- related ADRs and exact applicable revision;
- next phase or gate;
- supersedes/superseded-by when an approved successor exists.

“TESTED” must name whether the result was independently observed or reported by the implementation agent. An Accepted ADR never substitutes for a test result. A live result is specific to the tested process/version/provider/model and authorization path.

## Diagram and proof rules

Separate implemented component relationships from target composition. Label planned nodes/edges in the diagram itself and in its caption. A full ROS-to-Pi diagram must show Memory/Tools, session composer, terminal/PTY and gateway as planned where the inspected line lacks them.

Retain standalone P2 and standalone Phase-II proof lanes. The future combined lane is NOT YET IMPLEMENTED until composer/launcher/resource integration and re-proof exist. Pi's native tools retain no claimed OS confinement merely because cwd came from an authorized projection.

Do not turn the catalog proposal into a diagram of existing card generation. Do not depict SDK Guide's proposed registry-driven onboarding as delivered merely because a demo Guide exists.

When diagram portability requires separate figures, keep the explanatory text and implementation labels equivalent in Markdown and LaTeX. Exact mappings and status comparisons should remain tables.

## Source reconciliation decisions

| Conflict | Evidence-led resolution |
| --- | --- |
| Knowledge Pack and SDK Fabric overlap | Compare sections, preserve unique text/data, then mark predecessor historical with successor link. No destructive archive move is necessary. |
| SDK Fabric Markdown vs abbreviated TeX | Treat current TeX as summaries. Generate full same-revision LaTeX from reviewed Markdown; explicitly label any retained separate executive summary. |
| ADR-041 says protocol migration is future | Verify code/tests and 1.1C/1.1D history; record amendment date and evidence without altering the original historical claim silently. |
| ADR-043 earlier wording says Skills remains future | Scope that statement to its original phase; the overall overview separately references ADR-044. |
| Skills architecture vs rejected staging candidate | Preserve 2C design acceptance, 2C.1 rejection and 2C.2 correction separately. Latest pushed ADR is not automatically final authority. |
| P2 report names planner SHA in results | Preserve original; identify planner, launcher implementation and actual executed tree from proof provenance. Never substitute the report commit as executed candidate without evidence. |
| Phase-II traceability vs sibling R1/R2 hardening | Record status per line; integrated closure requires combined candidate evidence. |
| Tom review dev vs fork dev | Cite both immutable snapshots and perform explicit ancestry/integration review; do not infer merge status. |
| Earlier Tom draft still says P2/2B pending | Freeze Revision 1.1 as historical review draft; new update uses repository evidence and references successor documents. |

## Missing evidence register

1. Exact per-task independent acceptance links for the seven-task baseline and T7.1.
2. Tom's separate detailed September 28 SDK review with eight additional findings; the action-items PDF is not that companion review.
3. Identity and correction evidence for the two root documents mentioned by Tom; Phase-II traceability lists observable divergences but explicitly cannot enumerate the original review list.
4. Independent 2C.2 staging acceptance, distinct from work-order #74 producer PASS report.
5. Exact P2 executed candidate tree and version qualification; proof currently documents Pi 0.74.2 against expected 0.80.3.
6. Cross-branch integration and upstream/fork baseline reconciliation.
7. Shared capability-floor decision and the exact two ADRs/review findings covered by #462/#496; do not guess which ADRs need status changes.
8. Full required docs:check / test:docs results on the final documentation candidate.

Unresolved external evidence does not prevent indexing or preserving current documents. It prevents stronger completion or acceptance claims. Read-only retrieval can continue without modifying the Phase-II engineering line.

## Formatting, build and publication

Retain presentation conventions: article layout, one-inch margins, readable fonts, booktabs/longtable, wrapping links, date/revision/status visible and consistent. Prefer a reproducible Markdown-to-LaTeX path rather than independently editing both narratives.

For this inventory checkpoint, LaTeX is generated from the entire Markdown index/plan; no architecture source is rewritten. Compile for QA, inspect table wrapping and page breaks, and keep temporary QA PDFs out of the official frozen deliverable set.

Final documentation candidates must run `npm run docs:check` and `npm run test:docs` under the repository toolchain. Keep existing failures named separately and never weaken checks. Add an entry-point link so the index is reachable from the canonical documentation router. A documentation-only branch starts from current dev and PR targets dev; no automatic merge.

A PR, review or documentation publication is not release qualification. No model credential, local bridge configuration, raw transcript, browser profile or private runtime evidence belongs in the publication.

## Completion criteria

The consolidation is complete when all scoped official bodies have matching .md/.tex revisions; every status claim is commit-scoped; current and planned diagrams are unambiguous; Tom's requirements map to proof or named unresolved work; predecessor documents retain provenance and approved successors; the index is reachable; required documentation checks are reported honestly; and a bounded documentation-only PR is reviewable by Tom. Runtime integration, deployment, feature merges and final SDK release remain outside this documentation result.

