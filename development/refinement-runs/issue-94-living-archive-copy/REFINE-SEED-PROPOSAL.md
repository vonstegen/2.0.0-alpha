# Refine Seed Proposal: Living Archive Human-First Copy

## Seed

Issue 94 requests that Living Archive explain memory as a human-first product promise before exposing implementation language.

## Primary Evidence

- `docs/UX_AUDIT_2026-06-01.md`: P1 says memory needs a human-first explanation and gives the exact sentence.
- `docs/PRODUCT_GUIDE_BROWSER_FIRST.md`: defines Human Knowledge, External Knowledge, AI Memory, and optional Obsidian workflows.
- `docs/product/SETTINGS-001-browser-first-settings-plan.md`: places Memory settings in the settings surface and keeps source management in the Memory workspace.

## Refined Target

Use the exact sentence wherever the user first encounters Living Archive memory:

> Human Knowledge is preserved; AI Memory is the maintained wiki.

Then explain:

- Original source material remains safe.
- AI Memory is maintained only after review.
- Obsidian-compatible vaults are optional and are only one way to manage the same files.

## Guardrails

- Keep implementation terminology secondary.
- Do not change archive runtime behavior.
- Do not alter source ingestion, provider routing, or memory service authority.
- Keep the implementation scoped to visible copy and regression tests.
