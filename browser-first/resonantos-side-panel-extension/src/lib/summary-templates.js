// Summary/extraction templates for the Augmentor one-click / question-driven
// summarization path (#221).
//
// Pure functions: given a page snapshot (the content.js `read_page` contract —
// { title, url, text, links, ... }), build a deterministic prompt contract for
// each template. Templates only shape the user prompt; they never write to the
// trusted Living Archive. The summarize flow in browser-page-actions.js still
// routes every summary through /archive/intake + /archive/review/request, so a
// human review handoff always precedes any trusted-memory promotion.

// `summary` reproduces the pre-existing summarize prompt so the default
// one-click path (Alt+S / the summarize action) is unchanged. The remaining
// templates are opt-in, structured extraction shapes.
export const SUMMARY_TEMPLATES = Object.freeze([
  { id: "summary", label: "Summary", needsReadableText: false },
  { id: "tldr", label: "TL;DR", needsReadableText: true },
  { id: "pros-cons", label: "Pros / Cons", needsReadableText: true },
  { id: "decision-notes", label: "Decision notes", needsReadableText: true },
  { id: "bullets", label: "Bullets for notes", needsReadableText: true }
].map(Object.freeze));

const TEMPLATE_BY_ID = new Map(SUMMARY_TEMPLATES.map((template) => [template.id, template]));
const DEFAULT_TEMPLATE_ID = "summary";

export function isSummaryTemplateId(value) {
  return TEMPLATE_BY_ID.has(String(value ?? "").trim());
}

// Normalize to a valid template id, falling back to the default. Keeps the
// default one-click path behavior-preserving when no template is supplied or
// an unknown one is passed.
export function normalizeSummaryTemplateId(value) {
  const id = String(value ?? "").trim();
  return TEMPLATE_BY_ID.has(id) ? id : DEFAULT_TEMPLATE_ID;
}

export function getSummaryTemplate(templateId) {
  return TEMPLATE_BY_ID.get(normalizeSummaryTemplateId(templateId));
}

// A template is "supported" for a page when the page has the content the
// template needs. Structured templates require readable text; a media-only or
// empty page is unsupported, so the summarize flow can surface that visibly
// instead of silently emitting an empty summary.
export function isTemplateSupported(templateId, snapshot) {
  // getSummaryTemplate always resolves (unknown ids fall back to the default
  // template), so there is no unresolved case here.
  const template = getSummaryTemplate(templateId);
  if (!template.needsReadableText) return true;
  return String(snapshot?.text ?? "").trim().length > 0;
}

function provenanceLine(snapshot) {
  const title = snapshot?.title || "Untitled";
  const url = snapshot?.url || "(no url)";
  return `Source page: ${title} — ${url}`;
}

function pageExcerpt(snapshot) {
  const text = String(snapshot?.text ?? "").trim();
  let excerpt = text.slice(0, 12000);
  // Never split a surrogate pair at the cut: a trailing lone high surrogate
  // would embed a broken character in the prompt.
  const last = excerpt.charCodeAt(excerpt.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) excerpt = excerpt.slice(0, -1);
  return excerpt || "(no readable text on this page)";
}

const SHAPES = {
  // Reproduces the pre-existing summarize prompt exactly (default path).
  summary: [
    "Summarize this browser page for Living Archive intake.",
    "Return concise markdown with:",
    "- What this page is",
    "- Key facts visible in the page",
    "- Why it may matter",
    "- Questions or uncertainties for review",
    "- Suggested wiki entities/concepts to consider"
  ],
  tldr: [
    "Summarize this browser page for Living Archive intake using the TL;DR template.",
    "Return concise markdown:",
    "- TL;DR: one or two sentences.",
    "- Key facts: up to 5 bullets.",
    "- Why it may matter: one bullet.",
    "- Questions or uncertainties for review: up to 3 bullets.",
    "Do not claim trusted wiki promotion; cite only visible source facts."
  ],
  "pros-cons": [
    "Summarize this browser page for Living Archive intake using the Pros / Cons template.",
    "Return concise markdown:",
    "- Overview: one sentence.",
    "- Pros: bullets for what the page argues or shows in favor.",
    "- Cons: bullets for what it argues or shows against, or risks it raises.",
    "- Caveats / uncertainties for review: bullets.",
    "Do not claim trusted wiki promotion; cite only visible source facts."
  ],
  "decision-notes": [
    "Summarize this browser page for Living Archive intake using the Decision notes template.",
    "Return concise markdown:",
    "- Decision question: the choice this page informs.",
    "- Options considered: bullets.",
    "- Evidence or risks per option: bullets.",
    "- Recommendation or open question for review: one bullet.",
    "Do not claim trusted wiki promotion; cite only visible source facts."
  ],
  bullets: [
    "Summarize this browser page for Living Archive intake using the Bullets-for-notes template.",
    "Return concise markdown:",
    "- Up to 10 concise note bullets capturing the page's content.",
    "- One final bullet: an open question for review.",
    "Do not claim trusted wiki promotion; cite only visible source facts."
  ]
};

// Deterministic prompt contract for a template + page snapshot. Every opt-in
// template references the page title and URL (provenance line) and embeds the
// page text so the generated summary stays source-grounded. The default
// `summary` template reproduces the pre-existing prompt verbatim.
export function buildSummaryPrompt(templateId, snapshot) {
  const id = normalizeSummaryTemplateId(templateId);
  const shape = SHAPES[id];
  if (id === DEFAULT_TEMPLATE_ID) {
    return shape.join("\n");
  }
  return [
    ...shape,
    "",
    provenanceLine(snapshot),
    "",
    "## Page text",
    pageExcerpt(snapshot)
  ].join("\n");
}

// Intake artifact title for a template + page. The default reproduces the
// pre-existing `Summary: <title>` title; opt-in templates are prefixed so a
// reviewer can see which extraction shape produced the intake.
export function buildSummaryIntakeTitle(templateId, snapshot) {
  const id = normalizeSummaryTemplateId(templateId);
  const subject = snapshot?.title || snapshot?.url || "Untitled";
  if (id === DEFAULT_TEMPLATE_ID) return `Summary: ${subject}`;
  const label = TEMPLATE_BY_ID.get(id).label;
  return `Summary (${label}): ${subject}`;
}
