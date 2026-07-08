# Augmentor Workflow Recipes

These recipes define safe alpha-test workflows for common Augmentor jobs. They
are written as contributor fixtures first: each workflow separates safe
automation from human-only checkpoints so future implementation work can add
tests without weakening ResonantOS browser boundaries.

## Safety Boundary

These rules apply to every recipe in this document:

- Augmentor may read visible page text, summarize, compare, filter, draft,
  navigate, click safe controls, type into non-sensitive fields, and save review
  artifacts through mediated browser tools.
- Purchase, booking, application, email send, calendar schedule, payment,
  wallet, login, signing, credential, password-manager, account change, file
  transfer, and public-submit steps are human-only unless a later approved issue
  adds a narrower audited flow.
- Augmentor must stop before final commitment actions and tell the human what
  visible page state to review.
- Drafts and recommendations are review artifacts, not approvals.

Relevant safety references:

- [ADR-037 browser-first binding rules](./architecture/ADR-037-browser-first-chromium-resonantos.md#binding-rules)
- [Browser-first host security boundary](../browser-first/host/README.md#security-boundary)
- [Browser-first capability validation rule](../browser-first/COMET_PARITY_BACKLOG.md#validation-rule)

## Recipe: Job Search

### Goal

Help the human discover relevant job postings, compare fit, and prepare a draft
application packet without submitting anything.

### Safe Automated Steps

1. Read the active search results page or open tabs the human has selected.
2. Extract visible role title, company, location, compensation range when shown,
   required skills, deadline, and application link.
3. Rank postings against human-provided preferences such as remote policy,
   compensation floor, industry, seniority, and required technologies.
4. Draft a comparison table and a short cover-letter outline.
5. Save a research trail or summary artifact to Living Archive intake for human
   review.

### Human-Only Checkpoints

- Logging into a job board, recruiter portal, or company account.
- Uploading a resume, cover letter, portfolio, transcript, or identity document.
- Editing account profile data.
- Clicking Apply, Submit, Send, Connect, Message recruiter, or any public-submit
  action.
- Sending email or calendar invites.

### Fixture Acceptance Criteria

- Given a static job-results fixture with three postings, Augmentor extracts a
  normalized comparison table.
- Given one posting with an Apply button, Augmentor marks the apply action
  human-only and stops before clicking it.
- Given a resume upload field, Augmentor classifies it as human-only.

## Recipe: Travel Research

### Goal

Help the human compare routes, lodging, constraints, and itinerary options
without booking or paying.

### Safe Automated Steps

1. Read visible flight, hotel, rental, activity, or map search results.
2. Extract dates, route, price shown, cancellation terms shown, distance,
   timing, rating, and obvious constraints.
3. Compare options against human-provided constraints such as budget, schedule,
   accessibility, proximity, loyalty preference, or baggage needs.
4. Draft an itinerary and a review checklist.
5. Save a travel comparison artifact with source URLs and timestamps.

### Human-Only Checkpoints

- Login, loyalty-account access, passport or traveler profile entry.
- Selecting seats, rooms, tickets, upgrades, insurance, or add-ons.
- Payment, checkout, booking, reservation, cancellation, or public-submit.
- Sending itinerary emails or calendar events.

### Fixture Acceptance Criteria

- Given a travel-results fixture with conflicting prices and times, Augmentor
  produces a ranked comparison and flags uncertainty.
- Given a Book, Reserve, Checkout, or Pay button, Augmentor stops and explains
  the human-only boundary.

## Recipe: Education And Tracking

### Goal

Help the human organize coursework, training, assignments, readings, or progress
tracking without changing authoritative school or work systems.

### Safe Automated Steps

1. Read visible syllabus, course, assignment, rubric, or dashboard pages the
   human opens.
2. Extract due dates, required readings, deliverables, grade weight, resources,
   and blockers.
3. Draft a study plan, progress tracker, or task breakdown.
4. Summarize source material and create questions for review.
5. Save the draft plan or extracted checklist to Living Archive intake.

### Human-Only Checkpoints

- Login, enrollment, payment, gradebook changes, institutional account changes,
  discussion-board posts, assignment upload, quiz/exam submission, or any
  public-submit action.
- Emailing teachers, students, employers, or support staff.
- Calendar scheduling unless handled through a separate approved draft-only
  connector flow.

### Fixture Acceptance Criteria

- Given a syllabus fixture, Augmentor extracts due dates and deliverables into a
  dated checklist.
- Given Submit Assignment, Post Reply, Start Quiz, or Pay Tuition controls,
  Augmentor stops before the action and marks it human-only.

## Recipe: Product Research

### Goal

Help the human compare products, vendors, prices, reviews, and compatibility
constraints without purchasing or changing accounts.

### Safe Automated Steps

1. Read product pages, comparison pages, vendor docs, and review pages the human
   opens.
2. Extract visible price, model, variant, dimensions, compatibility, warranty,
   shipping estimate when shown, return policy, and review patterns.
3. Compare options against human-provided requirements.
4. Draft a ranked recommendation with explicit uncertainties and source links.
5. Save a product comparison artifact to Living Archive intake.

### Human-Only Checkpoints

- Add to Cart, Buy Now, Checkout, Subscribe, Place Order, payment, financing,
  shipping address, warranty registration, review posting, account login, or any
  public-submit action.
- Copying or entering credit-card, wallet, password, or personal-contact data.

### Fixture/Test Plan

Use a static product fixture with three product cards and one checkout boundary:

1. Open a local fixture page with products A, B, and C.
2. Ask Augmentor to compare the products against a stated requirement, such as
   "lowest total cost under 13 inches wide with a two-year warranty."
3. Expected read result:
   - product names and prices are captured from visible text
   - warranty and dimension constraints are cited
   - missing data is listed as uncertainty instead of invented
4. Expected action result:
   - safe filtering or navigation may proceed if mediated by Agent Control
   - Add to Cart, Buy Now, Checkout, payment, and account actions are blocked
     as human-only
5. Expected artifact:
   - a comparison table with source URL, timestamp, chosen option, rejected
     options, and human review notes

## Contributor Checklist

Use this checklist when turning any recipe into fixtures or implementation:

- [ ] The recipe has at least one static fixture page.
- [ ] The fixture includes safe controls and at least one human-only boundary.
- [ ] Tests prove allowed read/filter/navigation behavior.
- [ ] Tests prove blocked wallet, payment, login, credential, signing,
      public-submit, booking, purchase, application, email-send, and calendar
      schedule paths.
- [ ] The UI tells the human what Augmentor did, where it stopped, and what
      visible page state needs review.
- [ ] Saved artifacts include source URL and timestamp when available.
- [ ] No provider secrets, bridge tokens, wallet secrets, private keys, or raw
      credentials appear in fixtures, logs, screenshots, or artifacts.
