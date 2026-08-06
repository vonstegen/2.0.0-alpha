import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const CONSULTATION_QUERY_VERSION = "augmentor.consultation.query@1.1.0";
export const CONSULTATION_RESULT_VERSION = "augmentor.consultation.result@1.1.0";
export const CONSULTATION_PROJECTION_VERSION = "augmentor.consultation.projection@1.1.0";
export const CONSULTATION_MANIFEST_VERSION = "augmentor.consultation.projection-manifest@1.1.0";
export const CONSULTATION_EVIDENCE_STATEMENT_VERSION = "augmentor.consultation.evidence-statement@1.1.0";
export const CONSULTATION_GLOSSARY_VERSION = "augmentor.consultation.glossary@1.1.0";
export const CONSULTATION_EXPLANATION_SUPPORT_VERSION = "augmentor.consultation.explanation-support@1.1.0";
export const CONSULTATION_AUDIENCE = "augmentor-consultation";
export const CONSULTATION_ACCESS_HEADER = "x-resonantos-consultation-key";
export const CONSULTATION_PROJECTION_ALLOWLIST = Object.freeze([
  "id", "kind", "label", "summary", "viewIds", "fields.responsibility", "fields.boundary",
  "explanationSupport.state", "explanationSupport.process", "explanationSupport.illustrativeScenario",
  "explanationSupport.analogy", "explanationSupport.boundary", "explanationSupport.glossaryRefs",
  "explanationSupport.keywords", "fieldProvenance", "sourceHandles", "confidence",
  "glossary.terms", "structuredConflicts",
]);

export const CONSULTATION_EXPLANATION_PROFILES = Object.freeze({
  brief: Object.freeze({ maxBytes: 6144, maxTokens: 1200, maxPacks: 1, maxTerms: 2 }),
  guided: Object.freeze({ maxBytes: 16384, maxTokens: 2400, maxPacks: 1, maxTerms: 5 }),
  deep: Object.freeze({ maxBytes: 32768, maxTokens: 4800, maxPacks: 20, maxTerms: 5 }),
});

export const LIMIT_KEYS = Object.freeze([
  "maxCandidates",
  "maxRecords",
  "maxSources",
  "maxBytes",
  "maxTokens",
  "maxMillis",
]);

export const DEFAULT_CONSULTATION_LIMITS = Object.freeze({
  maxCandidates: 250,
  maxRecords: 20,
  maxSources: 40,
  maxBytes: 65536,
  maxTokens: 8192,
  maxMillis: 1500,
});

const MAXIMUM_LIMITS = Object.freeze({
  maxCandidates: 2000,
  maxRecords: 100,
  maxSources: 200,
  maxBytes: 1048576,
  maxTokens: 262144,
  maxMillis: 30000,
});

const RECORD_ID = /^rec-[a-f0-9]{12}$/;
const SOURCE_HANDLE = /^src-[a-f0-9]{12}$/;
const OWNER_REF = /^own-[a-f0-9]{12}$/;
const TERM_ID = /^term-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const VIEW_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KIND = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTROLLED_CONFIDENCE_BASIS = new Set(["owner_assertion", "source_derived", "verified_test"]);
const CONFIDENCE_LEVEL = new Set(["low", "medium", "high"]);
const OPERATIONS = new Set(["lookup", "search", "context"]);
const LEAKAGE_PATTERNS = Object.freeze([
  /(?:^|[\s"'])\/(?:home|Users|private|var\/lib)\//i,
  /authority_effect|internal_note|private_id/i,
  /(?:secret|password|private[_ -]?key|bearer)\s*[:=]/i,
  /x-resonantos-(?:bridge|capability|consultation)/i,
]);

export function sha256(value) {
  return createHash("sha256")
    .update(Buffer.isBuffer(value) ? value : String(value))
    .digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestJson(value) {
  return sha256(canonicalJson(value));
}

export const APPROVED_CONSULTATION_ALLOWLIST_DIGEST = digestJson(CONSULTATION_PROJECTION_ALLOWLIST);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, required, optional = []) {
  if (!isObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value, min, max) {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

function isIsoDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isUniqueStringArray(value, { min = 0, max = Infinity, pattern = null } = {}) {
  return Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && (!pattern || pattern.test(item))) &&
    new Set(value).size === value.length;
}

function validateLimits(value, at, errors) {
  if (!exactKeys(value, LIMIT_KEYS)) {
    errors.push(`${at}: limits must contain only ${LIMIT_KEYS.join(", ")}`);
    return;
  }
  for (const key of LIMIT_KEYS) {
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > MAXIMUM_LIMITS[key]) {
      errors.push(`${at}.${key}: invalid positive bounded integer`);
    }
  }
  if (value.maxBytes < 256) errors.push(`${at}.maxBytes: must be at least 256`);
  if (value.maxTokens < 64) errors.push(`${at}.maxTokens: must be at least 64`);
}

export function validateConsultationQuery(value) {
  const errors = [];
  if (!exactKeys(value, ["schemaVersion", "requestId", "questionId", "operation", "query", "scope", "limits"], ["explanation"])) {
    return ["$: request must be a closed consultation query"];
  }
  if (value.schemaVersion !== CONSULTATION_QUERY_VERSION) errors.push("$.schemaVersion: unsupported version");
  if (!isBoundedString(value.requestId, 1, 128)) errors.push("$.requestId: invalid string");
  if (!isBoundedString(value.questionId, 1, 128)) errors.push("$.questionId: invalid string");
  if (!OPERATIONS.has(value.operation)) errors.push("$.operation: unsupported operation");
  if (!exactKeys(value.query, [], ["id", "text", "kind"]) || (!value.query.id && !value.query.text)) {
    errors.push("$.query: id or text is required and undeclared fields are forbidden");
  } else {
    if (value.query.id !== undefined && !isBoundedString(value.query.id, 1, 256)) errors.push("$.query.id: invalid string");
    if (value.query.text !== undefined && !isBoundedString(value.query.text, 1, 1000)) errors.push("$.query.text: invalid string");
    if (value.query.kind !== undefined && !KIND.test(value.query.kind)) errors.push("$.query.kind: invalid kind");
  }
  if (!exactKeys(value.scope, ["viewIds"], ["maxFreshnessAgeSeconds"]) ||
      !isUniqueStringArray(value.scope?.viewIds, { min: 1, max: 8, pattern: VIEW_ID })) {
    errors.push("$.scope: invalid closed view scope");
  }
  if (value.scope?.maxFreshnessAgeSeconds !== undefined &&
      (!Number.isInteger(value.scope.maxFreshnessAgeSeconds) || value.scope.maxFreshnessAgeSeconds < 0 || value.scope.maxFreshnessAgeSeconds > 31536000)) {
    errors.push("$.scope.maxFreshnessAgeSeconds: invalid freshness bound");
  }
  validateLimits(value.limits, "$.limits", errors);
  if (value.explanation !== undefined && (!exactKeys(value.explanation, ["profile"]) || !Object.hasOwn(CONSULTATION_EXPLANATION_PROFILES, value.explanation.profile))) {
    errors.push("$.explanation: invalid closed explanation profile");
  }
  return errors;
}

function findLeakage(value, at = "$", hits = []) {
  if (typeof value === "string") {
    for (const pattern of LEAKAGE_PATTERNS) {
      if (pattern.test(value)) hits.push(`${at}: ${String(pattern)}`);
    }
    return hits;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findLeakage(item, `${at}[${index}]`, hits));
    return hits;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) findLeakage(child, `${at}.${key}`, hits);
  }
  return hits;
}

export function projectionLeakage(value) {
  return findLeakage(value);
}

function validateTextWithSource(value, at, errors) {
  if (!exactKeys(value, ["text", "sourceHandle"]) ||
      !isBoundedString(value?.text, 1, 2000) || !SOURCE_HANDLE.test(value?.sourceHandle ?? "")) {
    errors.push(`${at}: invalid source-bound text`);
  }
}

function validateExplanationPack(pack, at, errors, expectedRecordId = null, requireComplete = false) {
  if (!exactKeys(pack, ["recordId", "state", "process", "boundary", "glossaryRefs", "keywords"], ["illustrativeScenario", "analogy"]) ||
      (requireComplete && (!Object.hasOwn(pack ?? {}, "illustrativeScenario") || !Object.hasOwn(pack ?? {}, "analogy")))) {
    errors.push(`${at}: explanation pack is not closed`);
    return;
  }
  if (!RECORD_ID.test(pack.recordId) || (expectedRecordId && pack.recordId !== expectedRecordId)) errors.push(`${at}.recordId: invalid or mismatched`);
  if (!exactKeys(pack.state, ["scope", "posture", "text", "verifiedAt", "sourceHandle", "doesNotEstablish"]) ||
      pack.state?.scope !== "ontology-model" ||
      !new Set(["observed", "designed", "absent", "deferred", "unknown"]).has(pack.state?.posture) ||
      !isBoundedString(pack.state?.text, 1, 1600) || !isIsoDate(pack.state?.verifiedAt) ||
      !SOURCE_HANDLE.test(pack.state?.sourceHandle ?? "") ||
      !isUniqueStringArray(pack.state?.doesNotEstablish, { min: 1, max: 8 })) {
    errors.push(`${at}.state: invalid scoped state`);
  }
  validateTextWithSource(pack.process, `${at}.process`, errors);
  validateTextWithSource(pack.boundary, `${at}.boundary`, errors);
  if (pack.illustrativeScenario !== undefined && (!exactKeys(pack.illustrativeScenario, ["kind", "text", "sourceHandles"]) ||
      !new Set(["illustrative", "source-derived"]).has(pack.illustrativeScenario?.kind) ||
      !isBoundedString(pack.illustrativeScenario?.text, 1, 2000) ||
      !isUniqueStringArray(pack.illustrativeScenario?.sourceHandles, { max: 8, pattern: SOURCE_HANDLE }) ||
      (pack.illustrativeScenario?.kind === "source-derived" && pack.illustrativeScenario.sourceHandles.length === 0))) {
    errors.push(`${at}.illustrativeScenario: invalid example and provenance`);
  }
  if (pack.analogy !== undefined && (!exactKeys(pack.analogy, ["text", "limitation", "sourceHandle"]) ||
      !isBoundedString(pack.analogy?.text, 1, 1600) || !isBoundedString(pack.analogy?.limitation, 1, 1600) ||
      !SOURCE_HANDLE.test(pack.analogy?.sourceHandle ?? ""))) {
    errors.push(`${at}.analogy: analogy and limitation are required together`);
  }
  if (!isUniqueStringArray(pack.glossaryRefs, { min: 2, max: 5, pattern: TERM_ID })) errors.push(`${at}.glossaryRefs: invalid refs`);
  if (!isUniqueStringArray(pack.keywords, { min: 1, max: 12 })) errors.push(`${at}.keywords: invalid reviewed keywords`);
}

function validateRecord(record, index, errors) {
  const at = `$.records[${index}]`;
  if (!exactKeys(record, [
    "id", "kind", "label", "summary", "viewIds", "fields", "explanationSupport", "fieldProvenance", "sourceHandles", "confidence",
  ])) {
    errors.push(`${at}: record is not closed`);
    return;
  }
  if (!RECORD_ID.test(record.id)) errors.push(`${at}.id: invalid opaque record id`);
  if (!KIND.test(record.kind)) errors.push(`${at}.kind: invalid controlled kind`);
  if (!isBoundedString(record.label, 1, 160)) errors.push(`${at}.label: invalid reviewed label`);
  if (!isBoundedString(record.summary, 1, 1200)) errors.push(`${at}.summary: invalid reviewed summary`);
  if (!isUniqueStringArray(record.viewIds, { min: 1, max: 8, pattern: VIEW_ID })) errors.push(`${at}.viewIds: invalid views`);
  if (!exactKeys(record.fields, ["responsibility", "boundary"]) ||
      !isBoundedString(record.fields?.responsibility, 1, 1600) ||
      !isBoundedString(record.fields?.boundary, 1, 1600)) {
    errors.push(`${at}.fields: invalid reviewed fields`);
  }
  validateExplanationPack(record.explanationSupport, `${at}.explanationSupport`, errors, record.id, true);
  if (!exactKeys(record.fieldProvenance, ["sourceHandle"]) ||
      !SOURCE_HANDLE.test(record.fieldProvenance?.sourceHandle ?? "")) {
    errors.push(`${at}.fieldProvenance: invalid opaque provenance`);
  }
  if (!isUniqueStringArray(record.sourceHandles, { min: 1, max: 16, pattern: SOURCE_HANDLE })) {
    errors.push(`${at}.sourceHandles: invalid opaque sources`);
  }
  if (!exactKeys(record.confidence, ["level", "ownerRef", "basis", "assessedAt", "sourceHandle"]) ||
      !CONFIDENCE_LEVEL.has(record.confidence?.level) ||
      !OWNER_REF.test(record.confidence?.ownerRef ?? "") ||
      !CONTROLLED_CONFIDENCE_BASIS.has(record.confidence?.basis) ||
      !isIsoDate(record.confidence?.assessedAt) ||
      !SOURCE_HANDLE.test(record.confidence?.sourceHandle ?? "")) {
    errors.push(`${at}.confidence: invalid controlled confidence`);
  }
}

function validateGlossaryEntry(entry, index, errors) {
  const at = `$.terms[${index}]`;
  if (!exactKeys(entry, ["id", "term", "plainMeaning", "formalName", "whyItMatters", "sourceHandles", "authorityEffect", "forbiddenInferences"])) {
    errors.push(`${at}: glossary entry is not closed`);
    return;
  }
  if (!TERM_ID.test(entry.id)) errors.push(`${at}.id: invalid opaque term id`);
  if (!isBoundedString(entry.term, 1, 80) || !isBoundedString(entry.plainMeaning, 1, 600) ||
      !(entry.formalName === null || isBoundedString(entry.formalName, 1, 120)) ||
      !isBoundedString(entry.whyItMatters, 1, 600)) errors.push(`${at}: invalid plain-language content`);
  if (!isUniqueStringArray(entry.sourceHandles, { min: 1, max: 8, pattern: SOURCE_HANDLE })) errors.push(`${at}.sourceHandles: invalid`);
  if (entry.authorityEffect !== "none") errors.push(`${at}.authorityEffect: must be none`);
  if (!isUniqueStringArray(entry.forbiddenInferences, { min: 1, max: 8 })) errors.push(`${at}.forbiddenInferences: invalid`);
}

export function validateConsultationGlossary(value) {
  const errors = [];
  if (!exactKeys(value, ["schemaVersion", "terms"])) return ["$: glossary must be closed"];
  if (value.schemaVersion !== CONSULTATION_GLOSSARY_VERSION) errors.push("$.schemaVersion: unsupported version");
  if (!Array.isArray(value.terms) || value.terms.length < 1 || value.terms.length > 256) errors.push("$.terms: invalid collection");
  else {
    value.terms.forEach((entry, index) => validateGlossaryEntry(entry, index, errors));
    if (new Set(value.terms.map((entry) => entry.id)).size !== value.terms.length) errors.push("$.terms: duplicate ids");
  }
  for (const hit of projectionLeakage(value)) errors.push(`leakage:${hit}`);
  return errors;
}

export function validateConsultationProjection(value) {
  const errors = [];
  if (!exactKeys(value, ["schemaVersion", "records", "structuredConflicts"])) {
    return ["$: projection must be closed"];
  }
  if (value.schemaVersion !== CONSULTATION_PROJECTION_VERSION) errors.push("$.schemaVersion: unsupported version");
  if (!Array.isArray(value.records) || value.records.length < 1 || value.records.length > 10000) {
    errors.push("$.records: invalid record collection");
  } else {
    value.records.forEach((record, index) => validateRecord(record, index, errors));
    if (new Set(value.records.map((record) => record.id)).size !== value.records.length) errors.push("$.records: duplicate record ids");
  }
  if (!Array.isArray(value.structuredConflicts)) {
    errors.push("$.structuredConflicts: array required");
  } else {
    for (const [index, conflict] of value.structuredConflicts.entries()) {
      const at = `$.structuredConflicts[${index}]`;
      if (!exactKeys(conflict, ["subjectId", "predicate", "statementIds"]) ||
          !RECORD_ID.test(conflict?.subjectId ?? "") ||
          !KIND.test(conflict?.predicate ?? "") ||
          !isUniqueStringArray(conflict?.statementIds, { min: 2, max: 32 })) {
        errors.push(`${at}: invalid structured conflict`);
      }
    }
  }
  for (const hit of projectionLeakage(value)) errors.push(`leakage:${hit}`);
  return errors;
}

export function validateConsultationManifest(value, projection) {
  const errors = [];
  if (!exactKeys(value, [
    "schemaVersion", "compilerVersion", "compilerDigest", "allowlistDigest", "opaqueIdMapVersion",
    "inputSources", "schemaVersions", "schemaDigests", "recordCounts", "generatedAt", "outputDigest",
    "glossaryDigest", "bundleDigest", "ownerApprovalRef",
  ])) {
    return ["$: projection manifest must be closed"];
  }
  if (value.schemaVersion !== CONSULTATION_MANIFEST_VERSION) errors.push("$.schemaVersion: unsupported version");
  if (!isBoundedString(value.compilerVersion, 1, 128)) errors.push("$.compilerVersion: invalid");
  for (const key of ["compilerDigest", "allowlistDigest", "outputDigest", "glossaryDigest", "bundleDigest"]) {
    if (!SHA256.test(value[key] ?? "")) errors.push(`$.${key}: invalid sha256`);
  }
  if (value.allowlistDigest !== APPROVED_CONSULTATION_ALLOWLIST_DIGEST) errors.push("$.allowlistDigest: not the approved neutral projection allowlist");
  if (value.opaqueIdMapVersion !== "sha256-prefix@1.0.0") errors.push("$.opaqueIdMapVersion: unsupported");
  if (!Array.isArray(value.inputSources) || value.inputSources.length < 1 ||
      !value.inputSources.every((source) => exactKeys(source, ["sourceHandle", "sha256"]) &&
        SOURCE_HANDLE.test(source.sourceHandle) && SHA256.test(source.sha256))) {
    errors.push("$.inputSources: invalid opaque source bindings");
  }
  const expectedVersions = {
    projection: CONSULTATION_PROJECTION_VERSION,
    manifest: CONSULTATION_MANIFEST_VERSION,
    glossary: CONSULTATION_GLOSSARY_VERSION,
    explanationSupport: CONSULTATION_EXPLANATION_SUPPORT_VERSION,
  };
  if (!exactKeys(value.schemaVersions, Object.keys(expectedVersions)) ||
      Object.entries(expectedVersions).some(([key, version]) => value.schemaVersions?.[key] !== version)) {
    errors.push("$.schemaVersions: mixed or unsupported bundle versions");
  }
  if (!exactKeys(value.schemaDigests, Object.keys(expectedVersions)) ||
      !Object.values(value.schemaDigests ?? {}).every((digest) => SHA256.test(digest))) {
    errors.push("$.schemaDigests: invalid schema digest closure");
  }
  if (!exactKeys(value.recordCounts, ["records", "structuredConflicts", "terms"]) || !Object.values(value.recordCounts ?? {}).every((count) => Number.isInteger(count) && count >= 0)) {
    errors.push("$.recordCounts: invalid counts");
  }
  if (!isIsoDate(value.generatedAt)) errors.push("$.generatedAt: invalid date");
  if (!/^approval-[a-f0-9]{12}$/.test(value.ownerApprovalRef ?? "")) errors.push("$.ownerApprovalRef: invalid opaque approval ref");
  if (projection && value.outputDigest !== digestJson(projection)) errors.push("$.outputDigest: projection digest mismatch");
  return errors;
}

export function effectiveConsultationLimits(...sources) {
  const result = {};
  for (const key of LIMIT_KEYS) {
    const values = sources.map((source) => source?.[key]);
    if (!values.every((value) => Number.isInteger(value) && value > 0)) throw new TypeError(`invalid limit ${key}`);
    result[key] = Math.min(...values);
  }
  return result;
}

export function estimateConsultationTokens(value) {
  return Math.ceil(Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8") / 4);
}

export async function loadConsultationProjectionBundle({ root, signal } = {}) {
  if (!root) throw new TypeError("consultation projection root is required");
  if (signal?.aborted) throw signal.reason ?? new Error("consultation request cancelled");
  const [projectionText, glossaryText, manifestText, projectionSchemaText, manifestSchemaText, glossarySchemaText, explanationSchemaText] = await Promise.all([
    readFile(path.join(root, "projection.json"), "utf8"),
    readFile(path.join(root, "glossary.json"), "utf8"),
    readFile(path.join(root, "projection-manifest.json"), "utf8"),
    readFile(path.join(root, "schemas", "projection.schema.json"), "utf8"),
    readFile(path.join(root, "schemas", "projection-manifest.schema.json"), "utf8"),
    readFile(path.join(root, "schemas", "glossary.schema.json"), "utf8"),
    readFile(path.join(root, "schemas", "explanation-support.schema.json"), "utf8"),
  ]);
  if (signal?.aborted) throw signal.reason ?? new Error("consultation request cancelled");
  const projection = JSON.parse(projectionText);
  const glossary = JSON.parse(glossaryText);
  const manifest = JSON.parse(manifestText);
  const projectionErrors = validateConsultationProjection(projection);
  const glossaryErrors = validateConsultationGlossary(glossary);
  const manifestErrors = validateConsultationManifest(manifest, projection);
  const schemaTexts = { projection: projectionSchemaText, manifest: manifestSchemaText, glossary: glossarySchemaText, explanationSupport: explanationSchemaText };
  for (const [name, text] of Object.entries(schemaTexts)) {
    if (sha256(text) !== manifest.schemaDigests?.[name]) manifestErrors.push(`$.schemaDigests.${name}: installed schema digest mismatch`);
  }
  if (manifest.glossaryDigest !== digestJson(glossary)) manifestErrors.push("$.glossaryDigest: glossary digest mismatch");
  const bundleDigest = digestJson({ outputDigest: manifest.outputDigest, glossaryDigest: manifest.glossaryDigest, schemaVersions: manifest.schemaVersions, schemaDigests: manifest.schemaDigests });
  if (manifest.bundleDigest !== bundleDigest) manifestErrors.push("$.bundleDigest: combined bundle digest mismatch");
  if (manifest.recordCounts?.records !== projection.records?.length || manifest.recordCounts?.terms !== glossary.terms?.length) manifestErrors.push("$.recordCounts: artifact counts mismatch");
  const glossaryIds = new Set(glossary.terms?.map((entry) => entry.id));
  for (const [index, record] of (projection.records ?? []).entries()) {
    for (const ref of record.explanationSupport?.glossaryRefs ?? []) if (!glossaryIds.has(ref)) projectionErrors.push(`$.records[${index}].explanationSupport.glossaryRefs: unknown term ${ref}`);
  }
  if (projectionErrors.length || glossaryErrors.length || manifestErrors.length) {
    throw new Error(`Invalid consultation projection: ${[...projectionErrors, ...glossaryErrors, ...manifestErrors].join("; ")}`);
  }
  return { projection, glossary, manifest };
}
