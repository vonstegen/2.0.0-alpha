# Recipe: Product research

Product-research example from the Augmentor Future List. Compares candidate
products across tabs, saves a multi-tab research trail to Living Archive, and
drafts decision notes the human reviews before any purchase or add-to-cart
on a shared account.

## Goal

Open several candidate product pages in tabs, capture specifications,
pricing, warranty, and independent review summaries, save a multi-tab
research trail to Living Archive intake, and produce a side-by-side decision
note the human can act on.

## Augmentor features used

- [#237 Multi-step workflows](../augmentor-future-list-acceptance-matrix.md#automation)
  — supported
- [#218 Page content analysis / Q&A](../augmentor-future-list-acceptance-matrix.md#web-understanding)
  — supported
- [#221 One-click / question-driven summaries](../augmentor-future-list-acceptance-matrix.md#summarization-research)
  — supported
- [#227 Research-trail save and archive review handoff](../augmentor-future-list-acceptance-matrix.md#summarization-research)
  — future
- [#232 Spreadsheet and document artifact contract](../augmentor-future-list-acceptance-matrix.md#multi-model-backend-provider-routing)
  — future

## Safe automated steps

The Augmentor can:

- Read each open product page and extract specifications, price, warranty,
  and a bounded excerpt of independent reviews (`#218`).
- Compare two or three products side-by-side with each tab cited, and
  produce a single tabular summary inside the chat.
- Save the multi-tab comparison as a research-trail capture to the Living
  Archive intake (per `#227`).
- Draft decision notes with the human's chosen constraints (budget, use
  case, accessibility, ecosystem), without adding facts the human did not
  supply.
- Resume after a restart and surface the saved comparison (per Living
  Archive continuity acceptance `#228`).

## Human-only checkpoints

The Augmentor **must not** perform any of these autonomously:

- **Purchase** any product (cart checkout, one-click buy, saved payment).
- **Add to cart** on any shared or family account.
- **Pay** for a warranty, subscription, or protection plan.
- **Apply** any coupon, promo code, or store credit on the human's behalf.
- **Sign in** to an account or vendor portal on the human's behalf.
- **Send** a question or contact-form message to a vendor about a personal
  order.
- **Type** into payment, billing, address, or credential fields.
- **Share** the comparison to a public forum or social account.

Every one of those steps stops for an explicit human handoff per
[AGENTS.md](../../AGENTS.md) and the
[Augmentor tester runbook](../augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse).
The decision notes are **not** a confirmed order; they are a draft the human
takes to the vendor site.

## Suggested prompts

- "For each open tab, extract: product name, key specs, current price,
  warranty, and the top three independent-review snippets. Cite each tab."
- "Build a comparison table against my constraints: under $700, two
  USB-C ports, and a 30-day return policy."
- "Save the comparison to my Living Archive intake as a research trail so
  I can pick this up tomorrow."
- "Resume tomorrow: confirm the comparison still matches the open tabs and
  my constraints."

## Evidence to capture

- The comparison table with each tab cited.
- The Living Archive intake item id for the research trail.
- A screenshot of the human-only checklist above being shown in the side
  panel after the human reviews the decision notes.

## Safety boundaries & references

- [AGENTS.md trust boundaries](../../AGENTS.md#secrets-and-local-state)
- [Product Guide — Run A Browser Task](../product/PRODUCT_GUIDE.md#run-a-browser-task)
- [Augmentor tester runbook — human-only boundaries](../augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse)
- [Future List acceptance matrix — Multi-step workflows](../augmentor-future-list-acceptance-matrix.md#automation)
- [Future List acceptance matrix — Summarization & research](../augmentor-future-list-acceptance-matrix.md#summarization-research)
