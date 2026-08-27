# ResonantOS Browser Architecture — Review Checklists

Companion to the [master implementation checklist](14-master-phased-implementation-checklist.md).
These checklists are for **review**, not implementation: use them at every gate
review, at PR review for any checkpoint work, and for the reviewer walkthrough
of this package (see the reviewer guide at
[`docs/review/TOM_REVIEW_GUIDE.md`](../../review/TOM_REVIEW_GUIDE.md)).

## 1. Package review checklist (one-time)

- [ ] Docs 01–14 use baseline/target/implication separation consistently.
- [ ] Every `MUST` names a verifiable requirement with a test or route that can enforce it.
- [ ] Doc 13's migration map cites real files at this commit (re-run `ls`/`read` for each cited path).
- [ ] Doc 14's exit gates are falsifiable (a failure is observable).
- [ ] No document broadens the Alpha runtime beyond extension + authenticated local bridge.
- [ ] The Linux/true-OS exclusion is stated and respected in every doc.

## 2. Gate review checklist (per checkpoint, per doc 14)

- [ ] Every task in the checkpoint's phase list is done or explicitly deferred with a reason.
- [ ] The exit gate's conditions are demonstrated by a committed test or run evidence, not by assertion.
- [ ] Cross-phase non-negotiables (doc 14) still hold: no grant-by-UI, no credential exposure, no child superset, no direct trusted-memory writes, no history-as-executable confusion.
- [ ] Affected bridge routes reject the negative cases (forged identity, expired grant, path escape, widening).
- [ ] Existing behavior was not regressed: dev-channel extension still loads; stable channel still passes SDK tests.
- [ ] The gate evidence is recorded in `ROADMAP.md`'s gate evidence log.

## 3. Documentation contract checklist (before any doc commit)

Run `node scripts/validate-docs.mjs`. All reported issues must be resolved or
pre-existing (and noted). Concretely:

- [ ] New ADR is listed in `docs/architecture/README.md` with decision status, Alpha applicability, supersession, owner, and scope note.
- [ ] New doc is reachable from a canonical entrypoint (`AGENTS.md`, `README.md`, `INSTALL.md`, `CONTRIBUTING.md`, `docs/README.md`) via the link graph.
- [ ] No new implicit consumer was added without updating `IMPLICIT_DOCUMENT_CONSUMERS` in `scripts/validate-docs.mjs`.
- [ ] Any STATUS.md change is a verified fact with evidence.

## 4. Release / fork hygiene checklist (used today for the Tom review fork)

- [ ] Stable channel (`browser-first/release/`) is frozen at the stamped commit in `release-info.json`; no unstamped edits.
- [ ] Dev channel loads with the same extension ID as stable (same manifest `key`).
- [ ] The review branch contains: the package docs, the roadmap/checklists, the G0-ROS panel + mirror test, the two-channel workbench scripts, and the reviewer guide.
- [ ] The branch was built from a committed tree — no dependence on an uncommitted working tree.
- [ ] Nothing was pushed to `upstream`; the branch lives on the fork (`origin`) only.

## 5. Reviewer walkthrough checklist (Tom)

This is the reviewer's reading/verification path; the guide walks it end to end.

- [ ] Read the package README first, then docs 01–14 in order.
- [ ] Verify the checkpoint map in ROADMAP.md against doc 14's phases (1:1, no dropped gates).
- [ ] Verify doc 13's cited files exist (spot-check at least three).
- [ ] Run the snapshot drift test: `node --test browser-first/test/ros-architecture-snapshot.test.mjs`.
- [ ] Open the G0-ROS panel via the dev bridge at `/dev/g0-ros` and confirm the architecture section matches ADR-051.
- [ ] Confirm the two-channel split: stable dir is 0.1.14 frozen; dev dir is 0.2.0 working.
- [ ] Record findings as line-anchored comments on the branch.
