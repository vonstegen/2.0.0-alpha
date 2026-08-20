import assert from "node:assert/strict";
import test from "node:test";

import {
  SUMMARY_TEMPLATES,
  buildSummaryIntakeTitle,
  buildSummaryPrompt,
  getSummaryTemplate,
  isSummaryTemplateId,
  isTemplateSupported,
  normalizeSummaryTemplateId
} from "../resonantos-side-panel-extension/src/lib/summary-templates.js";

// A representative read_page snapshot (the content.js extraction contract).
const article = {
  title: "Quantum Computing Breakthrough",
  url: "https://example.com/article",
  text: "Scientists demonstrated a 256-qubit processor with low error rates.",
  links: [{ text: "MIT", href: "https://example.com/mit" }],
  controls: [],
  fields: []
};

const mediaOnly = {
  title: "Product Gallery",
  url: "https://example.com/gallery",
  text: "\n\n\n",
  links: [],
  controls: [],
  fields: []
};

const EXPECTED_IDS = ["summary", "tldr", "pros-cons", "decision-notes", "bullets"];

test("summary templates registry exposes the expected template ids", () => {
  assert.deepEqual(SUMMARY_TEMPLATES.map((t) => t.id), EXPECTED_IDS);
  for (const id of EXPECTED_IDS) {
    assert.equal(isSummaryTemplateId(id), true, `${id} recognised`);
  }
  assert.equal(isSummaryTemplateId("unknown"), false);
  assert.equal(isSummaryTemplateId(undefined), false);
});

test("unknown template ids normalize to the behavior-preserving default", () => {
  assert.equal(normalizeSummaryTemplateId("tldr"), "tldr");
  assert.equal(normalizeSummaryTemplateId("unknown"), "summary");
  assert.equal(normalizeSummaryTemplateId(undefined), "summary");
  assert.equal(normalizeSummaryTemplateId(""), "summary");
});

test("the default summary template reproduces the pre-existing prompt verbatim", () => {
  const prompt = buildSummaryPrompt("summary", article);
  assert.equal(
    prompt,
    [
      "Summarize this browser page for Living Archive intake.",
      "Return concise markdown with:",
      "- What this page is",
      "- Key facts visible in the page",
      "- Why it may matter",
      "- Questions or uncertainties for review",
      "- Suggested wiki entities/concepts to consider"
    ].join("\n")
  );
  // The default is intentionally not source-grounded in the user message
  // (provenance lives in pageContext), so it must NOT embed the title/url.
  assert.equal(prompt.includes(article.title), false);
  assert.equal(prompt.includes(article.url), false);
});

test("each opt-in template is deterministic and references the page title and url", () => {
  const optIn = ["tldr", "pros-cons", "decision-notes", "bullets"];
  const markers = {
    tldr: "TL;DR",
    "pros-cons": "Pros / Cons",
    "decision-notes": "Decision notes",
    bullets: "Bullets-for-notes"
  };
  for (const id of optIn) {
    const prompt = buildSummaryPrompt(id, article);
    // Determinism: same input yields byte-identical output.
    assert.equal(prompt, buildSummaryPrompt(id, article), `${id} is deterministic`);
    // The prompt contract requires source grounding (acceptance: output
    // references the page title/url).
    assert.ok(prompt.includes(article.title), `${id} references the page title`);
    assert.ok(prompt.includes(article.url), `${id} references the page url`);
    assert.ok(prompt.includes("Source page:"), `${id} carries a provenance line`);
    assert.ok(prompt.includes("## Page text"), `${id} embeds the page text`);
    assert.ok(prompt.includes(markers[id]), `${id} carries its template marker`);
  }
});

test("opt-in templates embed the captured page text excerpt", () => {
  const prompt = buildSummaryPrompt("tldr", article);
  assert.ok(prompt.includes("256-qubit processor"), "tldr embeds the page text");
});

test("structured templates are unsupported on pages with no readable text", () => {
  // The default template never gates (behavior-preserving), even on media-only.
  assert.equal(isTemplateSupported("summary", mediaOnly), true);
  assert.equal(isTemplateSupported("summary", article), true);
  // Structured templates require readable text.
  for (const id of ["tldr", "pros-cons", "decision-notes", "bullets"]) {
    assert.equal(isTemplateSupported(id, article), true, `${id} supported with text`);
    assert.equal(isTemplateSupported(id, mediaOnly), false, `${id} unsupported without text`);
    assert.equal(isTemplateSupported(id, { ...mediaOnly, text: "" }), false, `${id} unsupported on empty text`);
  }
});

test("the intake title is source-grounded and template-labelled for opt-in templates", () => {
  assert.equal(buildSummaryIntakeTitle("summary", article), "Summary: Quantum Computing Breakthrough");
  assert.equal(buildSummaryIntakeTitle("tldr", article), "Summary (TL;DR): Quantum Computing Breakthrough");
  assert.equal(buildSummaryIntakeTitle("pros-cons", article), "Summary (Pros / Cons): Quantum Computing Breakthrough");
  // Falls back to url, then Untitled, when no title is present.
  assert.equal(buildSummaryIntakeTitle("tldr", { url: "https://example.com/x" }), "Summary (TL;DR): https://example.com/x");
  assert.equal(buildSummaryIntakeTitle("tldr", {}), "Summary (TL;DR): Untitled");
  // Unknown template id normalizes to the default title.
  assert.equal(buildSummaryIntakeTitle("nope", article), "Summary: Quantum Computing Breakthrough");
});

test("getSummaryTemplate returns the normalized template metadata", () => {
  assert.equal(getSummaryTemplate("tldr").label, "TL;DR");
  assert.equal(getSummaryTemplate("unknown").id, "summary");
});

test("summary templates registry is deeply frozen", () => {
  const template = SUMMARY_TEMPLATES.find((entry) => entry.id === "tldr");
  assert.throws(() => { template.label = "mutated"; }, TypeError);
});

test("summary template page excerpt never splits a surrogate pair at the 12000 cut", () => {
  const text = "a".repeat(11999) + "\u{1F600}" + "tail after the emoji";
  const prompt = buildSummaryPrompt("tldr", { title: "T", url: "https://t.test", text });
  const excerptSection = prompt.split("## Page text\n")[1];
  assert.equal(excerptSection.length, 11999);
  assert.equal(excerptSection.includes("\uD83D"), false);
});
