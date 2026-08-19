# Recipe: Travel planning

Travel-planning example from the Augmentor Future List. Compares candidate
hotels, flights, or itineraries across tabs, builds a decision packet,
and stops for human review before any booking or payment.

## Goal

Open several candidate hotels, flights, or itinerary pages in tabs, gather
their price ranges, cancellation policies, and review summaries, and produce
a single decision packet the human can review before booking.

## Augmentor features used

- [#237 Multi-step workflows](../augmentor-future-list-acceptance-matrix.md#automation)
  — supported
- [#218 Page content analysis / Q&A](../augmentor-future-list-acceptance-matrix.md#web-understanding)
  — supported
- [#220 Cross-tab comparison with tab provenance](../augmentor-future-list-acceptance-matrix.md#cross-tab-intelligence)
  — needs hardening
- [#227 Research-trail save and archive review handoff](../augmentor-future-list-acceptance-matrix.md#summarization-research)
  — future
- [#228 Living Archive context continuity acceptance proof](../augmentor-future-list-acceptance-matrix.md#cross-tab-intelligence)
  — needs hardening

## Safe automated steps

The Augmentor can:

- Read each open tab and extract the price, cancellation policy, included
  amenities, and review summary.
- Compare two or three options side-by-side with each tab cited.
- Save the comparison as a research-trail capture to the Living Archive
  intake (per `#227`).
- Build a decision packet listing the human's chosen constraints (dates,
  budget, party size, accessibility needs) and the candidates ranked against
  those constraints.
- Continue a chat after a restart and recover the open tabs and the decision
  packet (per `#228`).

## Human-only checkpoints

The Augmentor **must not** perform any of these autonomously:

- **Book** a flight, hotel, car, rail, or tour reservation.
- **Pay** for any travel reservation (credit card, wallet, third-party).
- **Send** an email or contact-form message to a venue, host, or concierge.
- **Add** the trip to a calendar.
- **Sign in** to a booking account or loyalty program on the human's behalf.
- **Type** into payment, billing, or credential fields.

Every one of those steps stops for an explicit human handoff per
[AGENTS.md](../../AGENTS.md) and the
[Augmentor tester runbook](../augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse).
The decision packet is **not** a confirmed booking — it is a draft the human
takes to the booking site.

## Suggested prompts

- "For each open tab, extract: nightly rate, total cost for our dates,
  cancellation policy, and review-score. Cite each tab."
- "Rank these three hotels against my constraints: under $250/night,
  free cancellation, walkable to the venue."
- "Save this comparison to my Living Archive intake as a research trail."
- "Resume this decision packet after I restart and confirm the open tabs
  match what we agreed on."

## Evidence to capture

- The side-by-side comparison with each tab cited.
- The Living Archive intake item id for the decision packet.
- A screenshot of the human-only checklist above being shown in the side
  panel after the human reviews the decision packet.

## Safety boundaries & references

- [AGENTS.md trust boundaries](../../AGENTS.md#secrets-and-local-state)
- [Product Guide — Run A Browser Task](../product/PRODUCT_GUIDE.md#run-a-browser-task)
- [Augmentor tester runbook — human-only boundaries](../augmentor-tester-runbook.md#4-human-only-boundaries-verify-these-refuse)
- [Future List acceptance matrix — Multi-step workflows](../augmentor-future-list-acceptance-matrix.md#automation)
