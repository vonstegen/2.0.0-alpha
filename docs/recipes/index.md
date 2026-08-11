# Augmentor Workflow Recipes

Workflow recipes for the Augmentor example jobs that the
[Future List acceptance matrix](../augmentor-future-list-acceptance-matrix.md)
identifies as **Multi-step workflows (#237)**. Every recipe follows the same
skeleton so a tester can scan them quickly:

1. **Goal** — what the example job is
2. **Augmentor features used** — matrix citations
3. **Safe automated steps** — what Augmentor can do without an approval gate
4. **Human-only checkpoints** — every step the human must perform
5. **Suggested prompts** — copy-paste-able Augmentor prompt templates
6. **Evidence to capture** — what the tester should save or screenshot
7. **Safety boundaries & references** — links to the canonical docs

## Recipes

| Recipe | Example job | Status |
| --- | --- | --- |
| [job-search.md](job-search.md) | Compare postings, draft a cover-letter outline, list open tabs | ✅ supported (Multi-step workflows) |
| [travel.md](travel.md) | Gather options across tabs, build a decision packet | ✅ supported (Multi-step workflows) |
| [education-tracking.md](education-tracking.md) | Read course pages, summarize syllabus, save a tracking intake | ✅ supported (Multi-step workflows) |
| [product-research.md](product-research.md) | Compare products, save multi-tab research trail, draft decision notes | 🔧 needs hardening (research-trail handoff #227) |

## Safety Boundaries (applies to every recipe)

The recipes must mark every **purchase, booking, application, email, calendar,
payment, wallet, public-submit, login, or credential** step as
**human-only** unless a separate approved issue changes that classification.
Each recipe below links back to the canonical statements in the
[Augmentor tester runbook](../augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse)
and the
[trust boundaries](../product/PRODUCT_GUIDE.md#trust-boundaries)
section of the Product Guide.

## Verification

```bash
# Deterministic fixtures verify the recipes exist and contain the required
# sections, canonical issue citations, and human-only checkpoints.
npm run test:recipes
# Or target just the recipe fixtures:
node --test scripts/recipe-doc-fixtures.test.mjs
```

Docs-gate checks:

```bash
npm run docs:check
npm run test:docs
```
