// Deterministic fixture assertions for the Augmentor workflow recipes.
// Goals:
//  1. Each recipe file exists at its declared path.
//  2. Each recipe contains every required section heading.
//  3. Each recipe names at least one canonical issue under
//     "Augmentor features used".
//  4. Each recipe marks at least one human-only checkpoint that mentions a
//     recognised high-stakes action (purchase, booking, application, email,
//     calendar, payment, wallet, public-submit, login, or credential).
//  5. Each recipe links back to the Augmentor tester runbook or the
//     Product Guide trust boundaries.
//  6. docs/recipes/index.md exists and lists every recipe with a working
//     relative link to it.
//
// Acceptance criterion for #237: "Fixture/test plan exists for at least one
// recipe" — this file covers all four.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const RECIPES = [
  "docs/recipes/job-search.md",
  "docs/recipes/travel.md",
  "docs/recipes/education-tracking.md",
  "docs/recipes/product-research.md",
];

const INDEX_PATH = "docs/recipes/index.md";

const REQUIRED_SECTIONS = [
  /^## Goal\b/m,
  /^## Augmentor features used\b/m,
  /^## Safe automated steps\b/m,
  /^## Human-only checkpoints\b/m,
  /^## Suggested prompts\b/m,
  /^## Evidence to capture\b/m,
  /^## Safety boundaries & references\b/m,
];

// Recognised human-only action verbs at the start of a checkpoint bullet line.
// Each pattern matches a bullet at the start of a line.
// Trailing "/m" lets "^" pin to the start of any line, not just the start of
// the input string (which the matched section is a subset of).
const HUMAN_ONLY_VERBS = [
  /^[-*]\s+\*\*Book\b/im,
  /^[-*]\s+\*\*Purchase\b/im,
  /^[-*]\s+\*\*Pay\b/im,
  /^[-*]\s+\*\*Apply\b/im,
  /^[-*]\s+\*\*Send\b/im,
  /^[-*]\s+\*\*Add\b/im,
  /^[-*]\s+\*\*Connect\b/im,
  /^[-*]\s+\*\*Sign\b/im,
  /^[-*]\s+\*\*Upload\b/im,
  /^[-*]\s+\*\*Fill\b/im,
  /^[-*]\s+\*\*Submit\b/im,
  /^[-*]\s+\*\*Post\b/im,
  /^[-*]\s+\*\*Enroll\b/im,
  /^[-*]\s+\*\*Share\b/im,
  /^[-*]\s+\*\*Type\b/im,
  /^[-*]\s+\*\*Click\b/im,
];

// Either a tester-runbook or product-guide trust-boundary link must appear.
const SAFETY_REFERENCE_REGEX =
  /(?:augmentor-tester-runbook\.md|product\/PRODUCT_GUIDE\.md)/;

function readRelative(path) {
  return readFileSync(`${repoRoot}${path}`, "utf8");
}

export function listRecipes() {
  return [...RECIPES];
}

export function findMissingSections(path, source) {
  const missing = [];
  for (const [index, regex] of REQUIRED_SECTIONS.entries()) {
    if (!regex.test(source)) {
      missing.push({ path, section: regex.source });
      void index;
    }
  }
  return missing;
}

export function findMissingIssueCitation(path, source) {
  // Look for an "Augmentor features used" section that names at least one
  // canonical issue via "#NNN" or "epic #NNN".
  const featuresSection = source.match(
    /## Augmentor features used[\s\S]*?(?=\n## )/,
  );
  if (!featuresSection) {
    return [{ path, reason: "Missing 'Augmentor features used' section" }];
  }
  if (!/(?:\bepic )?#\d{2,4}\b/.test(featuresSection[0])) {
    return [
      {
        path,
        reason:
          "'Augmentor features used' must cite at least one canonical issue (#NNN)",
      },
    ];
  }
  return [];
}

export function findMissingHumanOnlyCheckpoint(path, source) {
  const checkpointsSection = source.match(
    /## Human-only checkpoints[\s\S]*?(?=\n## )/,
  );
  if (!checkpointsSection) {
    return [{ path, reason: "Missing 'Human-only checkpoints' section" }];
  }
  const hasRecognisedVerb = HUMAN_ONLY_VERBS.some((regex) =>
    regex.test(checkpointsSection[0]),
  );
  if (!hasRecognisedVerb) {
    return [
      {
        path,
        reason:
          "Human-only checkpoints must include at least one bullet that starts with a recognised verb (Book, Purchase, Pay, Apply, Send, Add, Connect, Sign, Upload, Fill, Submit, Post, Enroll, Share, Type, Click)",
      },
    ];
  }
  return [];
}

export function findMissingSafetyBoundary(path, source) {
  if (!SAFETY_REFERENCE_REGEX.test(source)) {
    return [
      {
        path,
        reason:
          "Each recipe must link to augmentor-tester-runbook.md or product/PRODUCT_GUIDE.md",
      },
    ];
  }
  return [];
}

export function validateRecipe(path) {
  const source = readRelative(path);
  return [
    ...findMissingSections(path, source),
    ...findMissingIssueCitation(path, source),
    ...findMissingHumanOnlyCheckpoint(path, source),
    ...findMissingSafetyBoundary(path, source),
  ];
}

export function validateIndex() {
  const findings = [];
  const source = readRelative(INDEX_PATH);
  for (const path of RECIPES) {
    const filename = path.split("/").pop();
    const link = new RegExp(`\\[.*\\]\\(${filename}\\)`);
    if (!link.test(source)) {
      findings.push({
        path: INDEX_PATH,
        reason: `Index does not link to recipe: ${filename}`,
      });
    }
  }
  return findings;
}
