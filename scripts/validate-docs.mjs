#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import semver from "semver";
import { parseDocument } from "yaml";

const CANONICAL_ENTRYPOINTS = [
  "AGENTS.md",
  "README.md",
  "INSTALL.md",
  "CONTRIBUTING.md",
  "docs/README.md",
];

const NORMATIVE_DOCUMENTS = new Set([
  "AGENTS.md",
  "README.md",
  "INSTALL.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/STATUS.md",
  "docs/ROADMAP.md",
  "docs/PROJECT_GOVERNANCE.md",
  "docs/architecture/README.md",
  "docs/architecture/ALPHA_RUNTIME_BOUNDARY.md",
  "docs/architecture/MODULE_MAP.md",
  "docs/architecture/MODULE-OWNERSHIP.md",
  "docs/product/PRODUCT_GUIDE.md",
  "docs/release/ALPHA_DISTRIBUTION.md",
  "docs/reference/CAPABILITY_MATRIX.md",
  "browser-first/README.md",
  "browser-first/host/README.md",
]);

const COMPONENT_COMMAND_READMES = [
  "browser-first/README.md",
  "browser-first/host/README.md",
  "addons/resonant-browser-host/README.md",
];

const CURRENT_COMMAND_DOCUMENTS = new Set([
  ...NORMATIVE_DOCUMENTS,
  ...COMPONENT_COMMAND_READMES,
]);

const REQUIRED_DOCS_SCRIPTS = ["docs:check", "test:docs"];
const OBSOLETE_RUNTIME = /\b(?:tauri|electron|cef|rust|cargo|src-tauri|native packaging)\b/gi;
const ALLOWED_ADR_STATUSES = new Set(["Accepted", "Deferred", "Superseded", "Historical"]);
const NEGATIVE_RUNTIME_LIST_HEADINGS = new Set([
  "not included",
  "out of scope",
  "excluded",
  "historical components",
]);
const NPM_RUN_COMMAND = /\bnpm\s+run\s+([^\s`"'\\;&|()<>]+)/g;
const markdownParser = unified().use(remarkParse).use(remarkGfm);

function createFinding(path, line, message) {
  return { path, line, message };
}

function toRelative(root, path) {
  return relative(root, path).split(sep).join("/");
}

function lineNumber(markdown, offset) {
  return markdown.slice(0, offset).split("\n").length;
}

function walkFiles(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist", "coverage"].includes(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) walkFiles(root, path, files);
    else if (entry.isFile()) files.push(toRelative(root, path));
  }
  return files;
}

function readDocuments(root, files = walkFiles(root)) {
  return files
    .filter((path) => /\.md(?:own)?$/i.test(path))
    .sort()
    .map((path) => ({
      path,
      content: readFileSync(resolve(root, path), "utf8"),
    }));
}

function isPathInside(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`));
}

function safeRequiredPath(root, path, findings) {
  const repositoryRoot = realpathSync(root);
  const absolute = resolve(root, path);
  if (!isPathInside(resolve(root), absolute)) {
    findings.push(createFinding(path, 1, "required file path escapes the repository"));
    return null;
  }

  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    findings.push(createFinding(path, 1, "required file is missing"));
    return null;
  }
  if (stat.isSymbolicLink()) {
    findings.push(createFinding(path, 1, "required file must not be a symlink"));
    return null;
  }

  try {
    const canonicalPath = realpathSync(absolute);
    if (!isPathInside(repositoryRoot, canonicalPath)) {
      findings.push(createFinding(path, 1, "required file resolves outside the repository"));
      return null;
    }
    return canonicalPath;
  } catch {
    findings.push(createFinding(path, 1, "required file cannot be resolved safely"));
    return null;
  }
}

function walkMarkdown(node, callback) {
  if (!node) return;
  callback(node);
  for (const child of node.children ?? []) walkMarkdown(child, callback);
}

function markdownText(node) {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(markdownText).join("");
}

function htmlMarkupOnly(value) {
  const uncommented = value.replace(/<!--[\s\S]*?-->/g, "");
  const rawTextOpening = /<(script|style|textarea|title|xmp|iframe|noembed|noframes|plaintext)\b(?:(?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  let markup = "";
  let cursor = 0;
  let opening;

  while ((opening = rawTextOpening.exec(uncommented))) {
    markup += uncommented.slice(cursor, opening.index);
    markup += opening[0];

    const tagName = opening[1].toLowerCase();
    if (tagName === "plaintext") return markup;

    const closing = new RegExp(`</${tagName}\\s*>`, "gi");
    closing.lastIndex = rawTextOpening.lastIndex;
    const closingMatch = closing.exec(uncommented);
    if (!closingMatch) return markup;

    markup += closingMatch[0];
    cursor = closing.lastIndex;
    rawTextOpening.lastIndex = cursor;
  }

  return markup + uncommented.slice(cursor);
}

function htmlAnchorHrefs(value) {
  const hrefs = [];
  const markup = htmlMarkupOnly(value);
  const expression = /<a\b(?:(?:"[^"]*"|'[^']*'|[^'">])*)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of markup.matchAll(expression)) hrefs.push(match[1] ?? match[2] ?? match[3]);
  return hrefs;
}

function parsedMarkdownLinks(markdown) {
  const tree = markdownParser.parse(markdown);
  const definitions = new Map();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });

  const links = [];
  walkMarkdown(tree, (node) => {
    const line = node.position?.start?.line ?? 1;
    const index = node.position?.start?.offset ?? 0;
    if (node.type === "link") {
      links.push({ label: markdownText(node), target: node.url, line, index });
    } else if (node.type === "linkReference") {
      const target = definitions.get(node.identifier);
      if (target) links.push({ label: markdownText(node), target, line, index });
    } else if (node.type === "html") {
      for (const target of htmlAnchorHrefs(node.value)) links.push({ label: "", target, line, index });
    }
  });
  return links.sort((left, right) => left.index - right.index || left.target.localeCompare(right.target));
}

export function extractMarkdownLinks(markdown) {
  return parsedMarkdownLinks(markdown).map(({ label, target }) => ({ label, target }));
}

function normalizeNpmScriptToken(token, literal) {
  return literal ? token : token.replace(/[.,:]+$/, "");
}

function npmScriptLine(markdown, node, offset) {
  let line = node.position?.start?.line ?? 1;
  if (node.type === "code") {
    const start = node.position?.start?.offset ?? 0;
    const lineEnd = markdown.indexOf("\n", start);
    const sourceLine = markdown.slice(start, lineEnd === -1 ? undefined : lineEnd);
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(sourceLine)) line += 1;
  }
  return line + lineNumber(node.value, offset) - 1;
}

function parsedNpmScripts(markdown) {
  const scripts = [];
  const tree = markdownParser.parse(markdown);
  walkMarkdown(tree, (node) => {
    const literal = node.type === "inlineCode" || node.type === "code";
    if (!literal && node.type !== "text") return;

    for (const match of node.value.matchAll(NPM_RUN_COMMAND)) {
      const name = normalizeNpmScriptToken(match[1], literal);
      if (!name) continue;
      scripts.push({
        name,
        line: npmScriptLine(markdown, node, match.index),
        index: (node.position?.start?.offset ?? 0) + match.index,
      });
    }
  });
  return scripts.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));
}

export function extractNpmScripts(markdown) {
  const names = new Set();
  for (const script of parsedNpmScripts(markdown)) names.add(script.name);
  return [...names].sort();
}

function slugifyHeading(heading) {
  return heading
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\\`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  const tree = markdownParser.parse(markdown);
  walkMarkdown(tree, (node) => {
    if (node.type === "heading") {
      const base = slugifyHeading(markdownText(node));
      if (base) {
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);
        anchors.add(count === 0 ? base : `${base}-${count}`);
      }
    }
    if (node.type === "html") {
      const markup = htmlMarkupOnly(node.value);
      for (const anchor of markup.matchAll(/<[A-Za-z][\w:-]*\b[^>]*\b(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)) {
        anchors.add(anchor[1] ?? anchor[2] ?? anchor[3]);
      }
    }
  });
  return anchors;
}

function isExternalTarget(target) {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target);
}

function splitTarget(target) {
  const hash = target.indexOf("#");
  const beforeHash = hash === -1 ? target : target.slice(0, hash);
  const query = beforeHash.indexOf("?");
  return {
    file: query === -1 ? beforeHash : beforeHash.slice(0, query),
    anchor: hash === -1 ? "" : target.slice(hash + 1),
  };
}

function resolveLocalDocument(root, sourcePath, target) {
  const { file, anchor } = splitTarget(target);

  let decoded;
  try {
    decoded = decodeURIComponent(file);
  } catch {
    return { error: `local Markdown target \"${file}\" has invalid URL encoding` };
  }
  if (isExternalTarget(decoded)) return null;
  if (decoded && !/\.md(?:own)?$/i.test(decoded)) return null;

  const absolute = decoded
    ? resolve(root, dirname(sourcePath), decoded)
    : resolve(root, sourcePath);
  const resolved = toRelative(root, absolute);
  if (resolved === ".." || resolved.startsWith("../")) {
    return { error: `local Markdown target \"${file}\" escapes the repository` };
  }
  try {
    return { path: resolved, anchor: decodeURIComponent(anchor) };
  } catch {
    return { error: `heading anchor \"${anchor}\" has invalid URL encoding` };
  }
}

function validateMarkdownLinks(context) {
  const findings = [];
  const documentByPath = new Map(context.documents.map((document) => [document.path, document]));
  for (const document of context.documents) {
    for (const link of parsedMarkdownLinks(document.content)) {
      const destination = resolveLocalDocument(context.root, document.path, link.target);
      if (!destination) continue;
      const line = link.line;
      if (destination.error) {
        findings.push(createFinding(document.path, line, destination.error));
        continue;
      }
      const targetDocument = documentByPath.get(destination.path);
      if (!targetDocument) {
        findings.push(createFinding(document.path, line, `local Markdown target \"${splitTarget(link.target).file}\" does not exist`));
        continue;
      }
      if (!destination.anchor) continue;
      if (!markdownAnchors(targetDocument.content).has(destination.anchor)) {
        findings.push(createFinding(
          document.path,
          line,
          `heading anchor \"${destination.anchor}\" does not exist in ${destination.path}`,
        ));
      }
    }
  }
  return findings;
}

function documentedNpmScripts(context) {
  const scripts = [];
  for (const document of context.documents) {
    if (!CURRENT_COMMAND_DOCUMENTS.has(document.path)) continue;
    for (const script of parsedNpmScripts(document.content)) {
      scripts.push({
        path: document.path,
        line: script.line,
        name: script.name,
      });
    }
  }
  return scripts;
}

function readJson(root, path, findings) {
  const absolute = safeRequiredPath(root, path, findings);
  if (!absolute) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    findings.push(createFinding(path, 1, `invalid JSON: ${error.message}`));
    return null;
  }
}

function validateNpmScripts(context) {
  const findings = [];
  const packageJson = readJson(context.root, "package.json", findings);
  if (!packageJson) return findings;
  const scripts = packageJson.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    findings.push(createFinding("package.json", 1, "package.json scripts must be an object"));
    return findings;
  }
  for (const name of REQUIRED_DOCS_SCRIPTS) {
    if (!Object.hasOwn(scripts, name)) {
      findings.push(createFinding("package.json", 1, `package.json must define required documentation script ${name}`));
    }
  }
  for (const documented of documentedNpmScripts(context)) {
    if (!Object.hasOwn(scripts, documented.name)) {
      findings.push(createFinding(
        documented.path,
        documented.line,
        `documented npm run ${documented.name} is absent from package.json scripts`,
      ));
    }
  }
  return findings;
}

function runtimeClause(line, index) {
  const sentenceStart = Math.max(
    line.lastIndexOf(".", index - 1),
    line.lastIndexOf("!", index - 1),
    line.lastIndexOf("?", index - 1),
  ) + 1;
  const sentenceEndMatch = /[.!?]/.exec(line.slice(index));
  const sentenceEnd = sentenceEndMatch ? index + sentenceEndMatch.index : line.length;
  const sentence = line.slice(sentenceStart, sentenceEnd);
  const matchOffset = index - sentenceStart;
  const separators = /:|;|,\s+(?:but|however|yet|while)\s+/gi;
  let start = 0;
  let separator;
  while ((separator = separators.exec(sentence))) {
    if (matchOffset < separator.index) return sentence.slice(start, separator.index);
    start = separator.index + separator[0].length;
  }
  return sentence.slice(start);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPositiveRuntimeRequirement(clause, term) {
  const escapedTerm = escapeRegExp(term);
  const termIsRequired = new RegExp(
    `\\b${escapedTerm}\\b(?:\\s+(?:is|are|must be|should be|remains?))*\\s+(?:required|needed|mandatory|supported|enabled|included)\\b`,
    "i",
  );
  const actionRequiresTerm = new RegExp(
    `\\b(?:must|should|need to|use|install|run|build with|depend on)\\b[^.;]{0,64}\\b${escapedTerm}\\b`,
    "i",
  );
  return termIsRequired.test(clause) || actionRequiresTerm.test(clause);
}

function isNegativeOrOutOfScope(text, match, structuralNegative = false) {
  const clause = runtimeClause(text, match.index);
  const negative = /\b(?:not|no|never|without|removed|retired|historical|superseded|legacy|excluded?|out[- ]of[- ]scope|do not|does not|cannot|must not)\b/i.test(clause);
  return (structuralNegative || negative) && !hasPositiveRuntimeRequirement(clause, match[0]);
}

function appendRuntimeClaimBlock(blocks, node, structuralNegative = false) {
  const text = markdownText(node).replace(/\s+/g, " ").trim();
  if (text) blocks.push({
    text,
    line: node.position?.start?.line ?? 1,
    structuralNegative,
  });
}

function collectRuntimeClaimBlocks(node, blocks, structuralNegative = false) {
  if (node.type === "paragraph") {
    appendRuntimeClaimBlock(blocks, node, structuralNegative);
  } else if (node.type === "list") {
    for (const item of node.children) appendRuntimeClaimBlock(blocks, item, structuralNegative);
  } else if (node.type === "table") {
    for (const row of node.children) {
      for (const cell of row.children) appendRuntimeClaimBlock(blocks, cell, false);
    }
  } else if (node.type === "blockquote") {
    for (const child of node.children) collectRuntimeClaimBlocks(child, blocks, false);
  }
}

function runtimeClaimBlocks(markdown) {
  const blocks = [];
  let negativeListHeading = false;
  for (const node of markdownParser.parse(markdown).children) {
    if (node.type === "heading") {
      const heading = markdownText(node).replace(/\s+/g, " ").trim().toLowerCase();
      negativeListHeading = NEGATIVE_RUNTIME_LIST_HEADINGS.has(heading);
      continue;
    }
    collectRuntimeClaimBlocks(node, blocks, node.type === "list" && negativeListHeading);
    negativeListHeading = false;
  }
  return blocks;
}

function isMainDevelopmentBranch(line) {
  return /\b(?:active\s+)?development\s+branch\s*(?:is|:|=|remains|should be)?\s*[`"']?main\b/i.test(line)
    || /\bmain\b.{0,48}\b(?:active\s+)?development\s+branch\b/i.test(line);
}

function isFixedTestCount(line) {
  return /\b\d+\s+(?:tests?|checks?)\s+(?:are\s+)?(?:pass(?:ed|ing)?|green|successful|complete)\b/i.test(line);
}

function isStatusAuthorityClaim(line) {
  const normalized = line.replace(/[`*_]/g, "");
  if (!/\b(?:current|canonical|authoritative)\s+status\s+source\s+of\s+truth\b/i.test(normalized)) return false;
  if (/\bonly\s+docs\/status\.md\s+may\s+claim\b/i.test(normalized)) return false;
  return /\b(?:this|the)\s+(?:document|guide|page|file|status(?:\s+page)?)\s+(?:is|remains|serves as)\b/i.test(normalized)
    || /\bthis\s+is\s+(?:the\s+)?(?:current|canonical|authoritative)\s+status\s+source\s+of\s+truth\b/i.test(normalized)
    || /\b[A-Za-z0-9_./-]+\.md\s+(?:is|remains|serves as)\s+(?:the\s+)?(?:current|canonical|authoritative)\s+status\s+source\s+of\s+truth\b/i.test(normalized);
}

export function validateCanonicalClaims(context) {
  const resolvedContext = buildContext(context.root, context);
  const findings = [];

  for (const document of resolvedContext.documents) {
    const lines = document.content.split("\n");

    if (NORMATIVE_DOCUMENTS.has(document.path)) {
      for (const block of runtimeClaimBlocks(document.content)) {
        const matches = [...block.text.matchAll(OBSOLETE_RUNTIME)];
        for (const match of matches) {
          if (!isNegativeOrOutOfScope(block.text, match, block.structuralNegative)) {
            findings.push(createFinding(
              document.path,
              block.line,
              `current normative documentation positively prescribes obsolete runtime \"${match[0]}\"; state that it is historical or out of scope instead`,
            ));
          }
        }
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      if (NORMATIVE_DOCUMENTS.has(document.path)) {
        if (/\bbrowser-first-preview\b/i.test(line)) {
          findings.push(createFinding(document.path, index + 1, "browser-first-preview must not be presented as the current runtime"));
        }
        if (isMainDevelopmentBranch(line)) {
          findings.push(createFinding(document.path, index + 1, "main must not be presented as the development branch; use dev"));
        }
        if (isFixedTestCount(line)) {
          findings.push(createFinding(document.path, index + 1, "fixed test count must not be presented as current truth"));
        }
        if (/\/Users\/dr\.tom(?:\/|$)/.test(line)) {
          findings.push(createFinding(document.path, index + 1, "founder-specific absolute path is not portable"));
        }
      }

      if (
        document.path !== "docs/STATUS.md"
        && isStatusAuthorityClaim(line)
      ) {
        findings.push(createFinding(
          document.path,
          index + 1,
          "only docs/STATUS.md may claim to be the current status source of truth",
        ));
      }
    }
  }

  return findings;
}

function relativeLinkTarget(root, sourcePath, target) {
  const destination = resolveLocalDocument(root, sourcePath, target);
  return destination?.path ?? null;
}

function entrypointLinks(context, sourcePath) {
  const document = context.documents.find((candidate) => candidate.path === sourcePath);
  if (!document) return [];
  return parsedMarkdownLinks(document.content).map((link) => ({
    ...link,
    path: relativeLinkTarget(context.root, sourcePath, link.target),
  }));
}

function validateEntrypoints(context) {
  const findings = [];
  const documentPaths = new Set(context.documents.map((document) => document.path));
  for (const path of CANONICAL_ENTRYPOINTS) {
    safeRequiredPath(context.root, path, findings);
    if (!documentPaths.has(path)) findings.push(createFinding(path, 1, `Missing canonical entrypoint ${path}`));
  }
  if (findings.length > 0) return findings;

  const orderedLinks = entrypointLinks(context, "AGENTS.md");
  const positions = CANONICAL_ENTRYPOINTS.map((path) => orderedLinks.find((link) => link.path === path)?.index ?? -1);
  if (positions.some((position) => position === -1) || positions.some((position, index) => index > 0 && position < positions[index - 1])) {
    findings.push(createFinding(
      "AGENTS.md",
      1,
      "AGENTS.md must link to AGENTS.md, README.md, INSTALL.md, CONTRIBUTING.md, and docs/README.md in canonical reading order",
    ));
  }

  for (const [source, destination] of [
    ["README.md", "INSTALL.md"],
    ["INSTALL.md", "CONTRIBUTING.md"],
    ["CONTRIBUTING.md", "docs/README.md"],
  ]) {
    if (!entrypointLinks(context, source).some((link) => link.path === destination)) {
      findings.push(createFinding(source, 1, `${source} must link to ${destination} in the canonical reading order`));
    }
  }
  return findings;
}

function trackedFiles(root, fallback) {
  try {
    return execFileSync("git", ["-C", root, "ls-files"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return fallback;
  }
}

function normalizeTableCell(cell) {
  return markdownText(cell).replace(/[\`*_]/g, "").trim();
}

function parseAdrIndexTable(markdown) {
  const tree = markdownParser.parse(markdown);
  const definitions = new Map();
  walkMarkdown(tree, (node) => {
    if (node.type === "definition" && !definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
  });

  let result = null;
  walkMarkdown(tree, (node) => {
    if (result || node.type !== "table" || node.children.length < 2) return;
    const headers = node.children[0].children;
    const normalizedHeaders = headers.map((header) => normalizeTableCell(header).toLowerCase());
    const adr = normalizedHeaders.indexOf("adr");
    const status = normalizedHeaders.indexOf("decision status");
    const alphaApplicability = normalizedHeaders.indexOf("alpha applicability");
    if (adr === -1 || status === -1 || alphaApplicability === -1) return;
    result = {
      adr,
      status,
      alphaApplicability,
      definitions,
      rows: node.children.slice(1).map((row) => ({
        line: row.position?.start?.line ?? 1,
        cells: row.children,
      })),
    };
  });
  return result;
}

function adrCellMatches(cell, id, filename, definitions) {
  let matches = false;
  walkMarkdown(cell, (node) => {
    const target = node.type === "link"
      ? node.url
      : node.type === "linkReference"
        ? definitions.get(node.identifier)
        : null;
    if (!target) return;
    const { file } = splitTarget(target);
    try {
      const normalizedFile = decodeURIComponent(file).replace(/^\.\//, "");
      if (normalizedFile === filename && markdownText(node).includes(id)) matches = true;
    } catch {
      // Invalid targets cannot be exact ADR filename matches.
    }
  });
  return matches;
}

export function validateAdrIndex(context) {
  const resolvedContext = buildContext(context.root, context);
  const findings = [];
  const index = resolvedContext.documents.find((document) => document.path === "docs/architecture/README.md");
  const discovered = resolvedContext.documents.map((document) => document.path);
  const tracked = context.trackedFiles ?? trackedFiles(resolvedContext.root, discovered);
  const adrs = tracked
    .filter((path) => /^docs\/architecture\/ADR-\d+.*\.md$/i.test(path))
    .sort();

  const safeIndexPath = safeRequiredPath(resolvedContext.root, "docs/architecture/README.md", findings);
  if (!index || !safeIndexPath) {
    if (adrs.length > 0) findings.push(createFinding("docs/architecture/README.md", 1, "ADR index is required for tracked ADR files"));
    return findings;
  }

  const table = parseAdrIndexTable(index.content);
  if (!table) {
    findings.push(createFinding(
      "docs/architecture/README.md",
      1,
      "ADR index must contain a Markdown table with ADR, Decision status, and Alpha applicability columns",
    ));
    return findings;
  }

  for (const adr of adrs) {
    const id = adr.match(/ADR-\d+/i)[0];
    const row = table.rows.find(({ cells }) => {
      return adrCellMatches(cells[table.adr], id, adr.split("/").pop(), table.definitions);
    });
    if (!row) {
      findings.push(createFinding(adr, 1, `${adr} is missing from docs/architecture/README.md`));
      continue;
    }

    const status = normalizeTableCell(row.cells[table.status]);
    if (![...ALLOWED_ADR_STATUSES].some((candidate) => candidate.toLowerCase() === status.toLowerCase())) {
      findings.push(createFinding(adr, 1, `${adr} must declare an allowed decision status: Accepted, Deferred, Superseded, or Historical`));
    }

    if (!normalizeTableCell(row.cells[table.alphaApplicability])) {
      findings.push(createFinding(adr, 1, `${adr} must declare Alpha applicability in docs/architecture/README.md`));
    }
  }

  return findings;
}

function yamlMapValue(node, key) {
  return node?.items?.find((pair) => pair.key?.value === key)?.value;
}

function yamlString(node) {
  return node?.value === undefined || node?.value === null ? "" : String(node.value);
}

function yamlLine(content, node) {
  return typeof node?.range?.[0] === "number" ? lineNumber(content, node.range[0]) : 1;
}

function yamlMatrixValues(job) {
  const matrix = yamlMapValue(yamlMapValue(job, "strategy"), "matrix");
  const values = new Map();
  for (const pair of matrix?.items ?? []) {
    const key = yamlString(pair.key);
    const entries = pair.value?.items ?? [pair.value];
    values.set(key, entries.map(yamlString).filter(Boolean));
  }
  return values;
}

function resolveWorkflowVersion(value, matrixValues) {
  const matrixReference = value.match(/^\${{\s*matrix\.([A-Za-z0-9_-]+)\s*}}$/);
  if (!matrixReference) return [value];
  return matrixValues.get(matrixReference[1]) ?? [value];
}

function workflowNodeVersions(context, findings) {
  const versions = [];
  for (const path of context.files.filter((file) => /^\.github\/workflows\/.*\.ya?ml$/i.test(file))) {
    const content = readFileSync(resolve(context.root, path), "utf8");
    const document = parseDocument(content);
    if (document.errors.length > 0) {
      const error = document.errors[0];
      const line = error.linePos?.[0]?.line ?? 1;
      findings.push(createFinding(path, line, `invalid workflow YAML: ${error.message}`));
      continue;
    }

    const jobs = yamlMapValue(document.contents, "jobs");
    for (const job of jobs?.items ?? []) {
      const matrixValues = yamlMatrixValues(job.value);
      const steps = yamlMapValue(job.value, "steps");
      for (const step of steps?.items ?? []) {
        if (!/^actions\/setup-node@/i.test(yamlString(yamlMapValue(step, "uses")))) continue;
        const withValues = yamlMapValue(step, "with");
        const nodeVersion = yamlMapValue(withValues, "node-version");
        if (nodeVersion) {
          for (const value of resolveWorkflowVersion(yamlString(nodeVersion), matrixValues)) {
            versions.push({ path, line: yamlLine(content, nodeVersion), value });
          }
        }

        const nodeVersionFile = yamlMapValue(withValues, "node-version-file");
        if (nodeVersionFile) {
          const versionFilePath = yamlString(nodeVersionFile);
          const safePath = safeRequiredPath(context.root, versionFilePath, findings);
          if (safePath) {
            versions.push({
              path,
              line: yamlLine(content, nodeVersionFile),
              value: readFileSync(safePath, "utf8").trim(),
            });
          }
        }
      }
    }
  }
  return versions;
}

function workflowVersionAgrees(version, nvmVersion) {
  const normalized = version.replace(/^v/i, "");
  const range = semver.validRange(normalized);
  return Boolean(range) && semver.satisfies(nvmVersion, range);
}

function trackedPackageSurfacePaths(context, filename) {
  const tracked = context.trackedFiles ?? trackedFiles(context.root, context.files);
  const paths = tracked.filter((path) => path === filename || path.endsWith(`/${filename}`));
  if (filename === "package.json" && !paths.includes("package.json")) paths.unshift("package.json");
  return [...new Set(paths)].sort();
}

function validateEngineFloor(metadata, path, nvmVersion, findings) {
  const range = metadata?.engines?.node;
  const normalizedRange = typeof range === "string" ? semver.validRange(range) : null;
  const floor = normalizedRange ? semver.minVersion(normalizedRange) : null;
  if (!floor) {
    findings.push(createFinding(path, 1, `${path} must declare engines.node with a >= Node version floor`));
  } else if (!semver.eq(nvmVersion, floor.version)) {
    findings.push(createFinding(
      path,
      1,
      `${path} engines.node ${range} does not agree with .nvmrc ${nvmVersion}`,
    ));
  }
}

function validateNodeVersions(context) {
  const findings = [];
  const nvmPath = safeRequiredPath(context.root, ".nvmrc", findings);
  if (!nvmPath) return findings;
  const nvmVersion = semver.valid(readFileSync(nvmPath, "utf8").trim());
  if (!nvmVersion) {
    findings.push(createFinding(".nvmrc", 1, "must contain an exact Node version"));
    return findings;
  }

  const versions = workflowNodeVersions(context, findings);
  if (versions.length === 0) {
    findings.push(createFinding(".github/workflows", 1, "no workflow declares a Node version"));
  }
  for (const workflow of versions) {
    if (!workflowVersionAgrees(workflow.value, nvmVersion)) {
      findings.push(createFinding(
        workflow.path,
        workflow.line,
        `workflow Node version ${workflow.value} does not agree with .nvmrc ${nvmVersion}`,
      ));
    }
  }

  for (const path of trackedPackageSurfacePaths(context, "package.json")) {
    const packageJson = readJson(context.root, path, findings);
    if (packageJson) validateEngineFloor(packageJson, path, nvmVersion, findings);
  }

  for (const lockPath of trackedPackageSurfacePaths(context, "package-lock.json")) {
    const lockfile = readJson(context.root, lockPath, findings);
    if (!lockfile?.packages) {
      if (lockfile) findings.push(createFinding(lockPath, 1, `${lockPath} must expose a packages map`));
      continue;
    }

    const rootPackage = lockfile.packages[""];
    if (!rootPackage || typeof rootPackage !== "object" || Array.isArray(rootPackage)) {
      findings.push(createFinding(lockPath, 1, `${lockPath} has malformed root package metadata`));
    } else {
      validateEngineFloor(rootPackage, lockPath, nvmVersion, findings);
    }

    for (const [dependencyPath, metadata] of Object.entries(lockfile.packages)) {
      if (!dependencyPath) continue;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        findings.push(createFinding(lockPath, 1, `${dependencyPath} has malformed package metadata`));
        continue;
      }
      if (!metadata.engines?.node) continue;
      const range = semver.validRange(metadata.engines.node);
      if (!range) {
        findings.push(createFinding(lockPath, 1, `${dependencyPath} (${metadata.version ?? "unknown"}) has invalid Node engine ${metadata.engines.node}`));
      } else if (!semver.satisfies(nvmVersion, range)) {
        findings.push(createFinding(
          lockPath,
          1,
          `${dependencyPath} (${metadata.version ?? "unknown"}) declares Node engine ${metadata.engines.node}, which .nvmrc ${nvmVersion} does not satisfy`,
        ));
      }
    }
  }
  return findings;
}

function buildContext(root, options = {}) {
  const resolvedRoot = resolve(root);
  const files = options.files ?? walkFiles(resolvedRoot);
  return {
    root: resolvedRoot,
    files,
    trackedFiles: options.trackedFiles,
    documents: options.documents ?? readDocuments(resolvedRoot, files),
  };
}

export function validateRepositoryDocs(root, options = {}) {
  const context = buildContext(root, options);
  const findings = [
    ...validateMarkdownLinks(context),
    ...validateNpmScripts(context),
    ...validateCanonicalClaims(context),
    ...validateEntrypoints(context),
    ...validateAdrIndex({ ...context, ...options }),
    ...validateNodeVersions(context),
  ].sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.message.localeCompare(right.message)
  ));
  return { findings };
}

function isMainModule() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const { findings } = validateRepositoryDocs(process.cwd());
  if (findings.length === 0) {
    console.log("Documentation contract validation passed.");
  } else {
    console.error(`Documentation contract validation found ${findings.length} issue(s):`);
    for (const finding of findings) console.error(`${finding.path}:${finding.line}: ${finding.message}`);
    process.exitCode = 1;
  }
}
