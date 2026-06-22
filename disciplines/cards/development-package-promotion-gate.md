# Development Package Promotion Gate

Status: active-pattern
Steward: ResonantOS maintainers / Arcanum issue loop users

## Purpose

Keep raw development and run packages out of ResonantOS product pull requests
unless a repository guideline explicitly promotes a distilled artifact as
source, release documentation, review evidence, or durable validation evidence.

## Boundary

This discipline governs ResonantOS commit and pull request surfaces. It does
not forbid source, tests, contributor docs, architecture docs, review reports,
release-scope docs, or curated evidence that the repository already treats as
durable. It also does not own Arcanum's framework-level discipline catalog; if a
practice should be reusable beyond ResonantOS, promote a product-neutral version
to Arcanum after the local rule is in place.

## Evidence

- [VLAD PR guide](../../docs/VLAD-PR-GUIDE.md) - explicitly excludes `development/`, refinement runs, and research packages from the product PR scope.
- [Browser-first stabilization release rules](../../docs/BROWSER_FIRST_STABILIZATION_2026-06-02.md) - excludes generated memory, runtime logs, private vault contents, credentials, and mixed release-scope artifacts.
- [Agent instructions](../../AGENTS.md) - requires the smallest safe write set, deterministic validation, and explicit reporting of the mutation boundary.
- [Local-first routing reflection](../reflections/2026-06-22-local-first-discipline-routing.md) - records the correction that local ResonantOS discipline should precede framework promotion.

## Validation

- Mode: mixed
- Check: `npm run discipline:validate` plus `npm run browser-first:audit-scope:staged` before publishing PRs that touch governance or release-scope files.
- Latest result: pass (2026-06-22 local catalog validation and staged scope audit).

## Quality Bar

A ResonantOS pull request satisfies this discipline when:

- raw `development/`, refinement, invoke, task-session, runtime, observability, research, or scratch package paths are absent unless explicitly promoted;
- the PR contains only the source, tests, docs, scripts, or curated evidence needed for the actual change;
- any non-committed run evidence is summarized in the PR body or issue comment instead of bundled as raw process output;
- the final changed-file set matches the stated dependency map and affected-only hypothesis;
- local discipline validation runs before any Arcanum/framework promotion claim.

## Promotion Guardrail

This discipline can recommend an Arcanum discipline, validator, release-scope
rule, or issue-loop contract update, but it cannot promote raw development
packages or framework guidance by itself. Framework promotion must keep this
local-first rule visible.
