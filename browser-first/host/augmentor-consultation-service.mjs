import {
  CONSULTATION_AUDIENCE,
  CONSULTATION_EXPLANATION_PROFILES,
  CONSULTATION_EXPLANATION_SUPPORT_VERSION,
  CONSULTATION_RESULT_VERSION,
  DEFAULT_CONSULTATION_LIMITS,
  effectiveConsultationLimits,
  estimateConsultationTokens,
  loadConsultationProjectionBundle,
  validateConsultationQuery,
} from "./augmentor-consultation-contract.mjs";
import { ConsultationEvidenceCache, consultationCacheKey } from "./augmentor-consultation-cache.mjs";

const CLAIM_CEILING = "approved neutral projection evidence only";
const FORBIDDEN_INFERENCES = Object.freeze(["authority", "approval", "production-readiness", "permission-to-act"]);

function base(query, status) {
  return {
    schemaVersion: CONSULTATION_RESULT_VERSION,
    requestId: query?.requestId ?? "unknown",
    questionId: query?.questionId ?? "unknown",
    status,
  };
}

function words(value) {
  return new Set(String(value ?? "").toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []);
}

function overlap(queryWords, value) {
  if (!queryWords.size) return 0;
  const candidate = words(value);
  let matched = 0;
  for (const token of queryWords) if (candidate.has(token)) matched += 1;
  return matched / queryWords.size;
}

function checkExecution({ signal, deadlineAt, clock }) {
  if (signal?.aborted) {
    const error = new Error("Consultation request cancelled.");
    error.code = "CANCELLED";
    throw error;
  }
  if (clock() >= deadlineAt) {
    const error = new Error("Consultation deadline reached.");
    error.code = "DEADLINE_REACHED";
    throw error;
  }
}

function statementFor(record, predicate, object, relevance, manifest) {
  return {
    statementId: `stmt-${record.id.slice(4)}-${predicate}`,
    subjectId: record.id,
    predicate,
    object,
    displayText: String(object),
    transformation: {
      kind: "copied-reviewed-field",
      version: manifest.compilerVersion,
      inputFieldRefs: [`${record.id}.${predicate}`],
    },
    sourceHandles: [...new Set([record.fieldProvenance.sourceHandle, ...record.sourceHandles])],
    freshness: "current",
    claimCeiling: CLAIM_CEILING,
    forbiddenInferences: [...FORBIDDEN_INFERENCES],
    relevance: {
      algorithmId: "exact-token-overlap",
      algorithmVersion: "1.0.0",
      scale: "normalized-0-1",
      value: relevance,
      projectionDigest: manifest.outputDigest,
    },
    confidence: structuredClone(record.confidence),
  };
}

function publicRecord(record) {
  return {
    id: record.id,
    kind: record.kind,
    label: record.label,
    summary: record.summary,
    viewIds: [...record.viewIds],
    responsibility: record.fields.responsibility,
    boundary: record.fields.boundary,
    sourceHandles: [...record.sourceHandles],
    confidence: structuredClone(record.confidence),
  };
}

function explanationPack(record, profile) {
  const pack = structuredClone({ recordId: record.id, ...record.explanationSupport });
  if (profile === "brief") {
    delete pack.illustrativeScenario;
    delete pack.analogy;
  }
  return pack;
}

export function buildConsultationExplanationSupport(items, glossary, manifest, profile, limits) {
  const budget = CONSULTATION_EXPLANATION_PROFILES[profile];
  const termById = new Map(glossary.terms.map((entry) => [entry.id, entry]));
  const packs = [];
  const selectedTerms = new Set();
  const omitted = new Set();
  for (const { record } of items.slice(0, budget.maxPacks)) {
    const pack = explanationPack(record, profile);
    if (pack.glossaryRefs.length > budget.maxTerms) {
      pack.glossaryRefs = pack.glossaryRefs.slice(0, budget.maxTerms);
      omitted.add("glossaryEntries");
    }
    const nextTerms = [...new Set([...selectedTerms, ...pack.glossaryRefs])];
    if (nextTerms.length > budget.maxTerms) {
      omitted.add("additionalPacks");
      continue;
    }
    pack.glossaryRefs.forEach((ref) => selectedTerms.add(ref));
    packs.push(pack);
  }
  if (items.length > packs.length) omitted.add("additionalPacks");
  if (profile === "brief") {
    omitted.add("illustrativeScenario");
    omitted.add("analogy");
  }
  const makeSupport = () => ({
    schemaVersion: CONSULTATION_EXPLANATION_SUPPORT_VERSION,
    profile,
    bundleDigest: manifest.bundleDigest,
    packs: structuredClone(packs),
    glossaryEntries: [...selectedTerms].map((id) => termById.get(id)).filter(Boolean),
    omittedSections: [...omitted].sort(),
  });
  let support = makeSupport();
  const maxBytes = Math.min(budget.maxBytes, limits.maxBytes);
  const maxTokens = Math.min(budget.maxTokens, limits.maxTokens);
  const exceeds = () => Buffer.byteLength(JSON.stringify(support)) > maxBytes || estimateConsultationTokens(support) > maxTokens;
  while (exceeds() && packs.length > 1) {
    packs.pop();
    omitted.add("additionalPacks");
    selectedTerms.clear();
    packs.flatMap((pack) => pack.glossaryRefs).forEach((ref) => selectedTerms.add(ref));
    support = makeSupport();
  }
  if (exceeds() && packs.some((pack) => pack.analogy)) {
    packs.forEach((pack) => { delete pack.analogy; });
    omitted.add("analogy");
    support = makeSupport();
  }
  if (exceeds() && packs.some((pack) => pack.illustrativeScenario)) {
    packs.forEach((pack) => { delete pack.illustrativeScenario; });
    omitted.add("illustrativeScenario");
    support = makeSupport();
  }
  return exceeds() ? null : support;
}

function evidenceFor(items, manifest, maxSources) {
  const statements = [];
  const sources = new Set();
  for (const { record, relevance } of items) {
    for (const [predicate, object] of Object.entries({
      label: record.label,
      summary: record.summary,
      responsibility: record.fields.responsibility,
      boundary: record.fields.boundary,
    })) {
      const statement = statementFor(record, predicate, object, relevance, manifest);
      const needed = statement.sourceHandles.filter((handle) => !sources.has(handle));
      if (sources.size + needed.length > maxSources) continue;
      needed.forEach((handle) => sources.add(handle));
      statements.push(statement);
    }
  }
  return { statements, sources: [...sources] };
}

function fitResult({ query, status, result, explanationSupport, manifest, limits, limitsHit }) {
  let records = [...result.records];
  let statements = [...result.statements];
  let support = explanationSupport ? structuredClone(explanationSupport) : null;
  const hit = new Set(limitsHit);
  while (true) {
    const payload = {
      ...base(query, status),
      result: { ...result, records, statements },
      ...(support ? { explanationSupport: support } : {}),
      projectionDigest: manifest.outputDigest,
      complete: hit.size === 0,
      ...(hit.size ? { limitsHit: [...hit].sort() } : {}),
    };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    const tokens = estimateConsultationTokens(payload);
    if (bytes <= limits.maxBytes && tokens <= limits.maxTokens) {
      return hit.size ? { ...payload, status: "partial", complete: false } : payload;
    }
    if (support?.packs.length > 1) {
      support.packs.pop();
      support.omittedSections = [...new Set([...support.omittedSections, "additionalPacks"])].sort();
      const usedTerms = new Set(support.packs.flatMap((pack) => pack.glossaryRefs));
      support.glossaryEntries = support.glossaryEntries.filter((entry) => usedTerms.has(entry.id));
    } else if (support?.packs.some((pack) => pack.analogy)) {
      support.packs.forEach((pack) => { delete pack.analogy; });
      support.omittedSections = [...new Set([...support.omittedSections, "analogy"])].sort();
    } else if (support?.packs.some((pack) => pack.illustrativeScenario)) {
      support.packs.forEach((pack) => { delete pack.illustrativeScenario; });
      support.omittedSections = [...new Set([...support.omittedSections, "illustrativeScenario"])].sort();
    } else if (support) support = null;
    else if (statements.length) statements.pop();
    else if (records.length) records.pop();
    else return { ...base(query, "budget_exceeded"), limitCodes: [bytes > limits.maxBytes ? "bytes" : "tokens"] };
    if (bytes > limits.maxBytes) hit.add("bytes");
    if (tokens > limits.maxTokens) hit.add("tokens");
  }
}

export class AugmentorConsultationService {
  constructor({
    projectionRoot,
    serviceLimits = DEFAULT_CONSULTATION_LIMITS,
    cache = new ConsultationEvidenceCache(),
    clock = Date.now,
    loadProjection = loadConsultationProjectionBundle,
    recordHook = null,
  } = {}) {
    if (!projectionRoot) throw new TypeError("consultation projection root is required");
    this.projectionRoot = projectionRoot;
    this.serviceLimits = effectiveConsultationLimits(DEFAULT_CONSULTATION_LIMITS, serviceLimits);
    this.cache = cache;
    this.clock = clock;
    this.loadProjection = loadProjection;
    this.recordHook = recordHook;
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      candidates: 0,
      records: 0,
      responseBytes: 0,
      totalLatencyMs: 0,
      maxLatencyMs: 0,
      cancelled: 0,
      timedOut: 0,
      failures: 0,
      statuses: {},
    };
  }

  metricsSnapshot() {
    return structuredClone({ ...this.metrics, cacheEntries: this.cache.size });
  }

  async consult(query, context = {}) {
    const startedAt = this.clock();
    const finish = (value) => this.#finish(value, startedAt);
    this.metrics.requests += 1;
    let result;
    try {
      const queryErrors = validateConsultationQuery(query);
      if (queryErrors.length) return finish({ ...base(query, "invalid_request"), issueCodes: ["QUERY_INVALID"] });
      if (context.audience !== CONSULTATION_AUDIENCE || !context.opaquePrincipalRef || !context.policyDigest) {
        return finish({ ...base(query, "denied"), reasonCode: "ACCESS_NOT_AVAILABLE", retryable: false });
      }
      const allowedViews = [...new Set(context.allowedViews ?? [])];
      if (!query.scope.viewIds.every((view) => allowedViews.includes(view))) {
        return finish({ ...base(query, "denied"), reasonCode: "VIEW_NOT_AVAILABLE", retryable: false });
      }
      const limits = effectiveConsultationLimits(this.serviceLimits, context.limits, query.limits);
      const deadlineAt = Math.min(Number(context.deadlineAt ?? Infinity), startedAt + limits.maxMillis);
      checkExecution({ signal: context.signal, deadlineAt, clock: this.clock });
      const { projection, glossary, manifest } = await this.loadProjection({ root: this.projectionRoot, signal: context.signal });
      checkExecution({ signal: context.signal, deadlineAt, clock: this.clock });
      if (query.scope.maxFreshnessAgeSeconds !== undefined &&
          startedAt - Date.parse(manifest.generatedAt) > query.scope.maxFreshnessAgeSeconds * 1000) {
        return finish({ ...base(query, "stale"), projectionDigest: manifest.outputDigest, freshness: "stale" });
      }
      const cacheKey = consultationCacheKey({
        opaquePrincipalRef: context.opaquePrincipalRef,
        policyDigest: `${context.registryRevision ?? 0}:${context.policyDigest}`,
        allowedViews,
        bundleDigest: manifest.bundleDigest,
        contractVersion: CONSULTATION_RESULT_VERSION,
        query,
        limits,
      });
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.metrics.cacheHits += 1;
        return finish({ ...cached, requestId: query.requestId, questionId: query.questionId });
      }

      const queryText = [query.query.id, query.query.text, query.query.kind].filter(Boolean).join(" ");
      const queryWords = words(queryText);
      const candidates = [];
      let candidatesLimited = false;
      for (const record of projection.records) {
        checkExecution({ signal: context.signal, deadlineAt, clock: this.clock });
        await this.recordHook?.({ record, signal: context.signal });
        checkExecution({ signal: context.signal, deadlineAt, clock: this.clock });
        if (!record.viewIds.some((view) => query.scope.viewIds.includes(view))) continue;
        if (query.query.kind && record.kind !== query.query.kind) continue;
        const exact = query.query.id && record.id === query.query.id;
        const score = exact ? 1 : overlap(queryWords, [record.id, record.kind, record.label, record.summary, record.fields.responsibility, record.fields.boundary, ...(record.explanationSupport?.keywords ?? [])].join(" "));
        if ((query.operation === "lookup" && !exact) || (!exact && score <= 0)) continue;
        if (candidates.length >= limits.maxCandidates) { candidatesLimited = true; break; }
        candidates.push({ record, relevance: score });
      }
      candidates.sort((left, right) => right.relevance - left.relevance || left.record.id.localeCompare(right.record.id));
      this.metrics.candidates += candidates.length;
      if (!candidates.length) {
        result = { ...base(query, "no_match"), searchedProjectionDigest: manifest.outputDigest };
      } else {
        const selected = candidates.slice(0, limits.maxRecords);
        const conflict = projection.structuredConflicts.find((entry) => selected.some(({ record }) => record.id === entry.subjectId));
        if (conflict) result = { ...base(query, "conflict"), statementIds: [...conflict.statementIds] };
        else {
          const { statements, sources } = evidenceFor(selected, manifest, limits.maxSources);
          if (!statements.length || !sources.length) result = { ...base(query, "insufficient_evidence"), gapCodes: ["SOURCE_BINDING_MISSING"] };
          else {
            const kind = query.operation === "context" ? "context" : query.operation === "lookup" ? "records" : "statements";
            const limitsHit = [];
            if (candidatesLimited) limitsHit.push("candidates");
            if (candidates.length > selected.length) limitsHit.push("records");
            if (statements.length < selected.length * 4) limitsHit.push("sources");
            const explanationSupport = query.explanation
              ? buildConsultationExplanationSupport(selected, glossary, manifest, query.explanation.profile, limits)
              : null;
            if (query.explanation && !explanationSupport) limitsHit.push("bytes");
            result = fitResult({
              query,
              status: "ok",
              result: {
                kind,
                records: kind === "statements" ? [] : selected.map(({ record }) => publicRecord(record)),
                statements: kind === "records" ? [] : statements,
                sourceHandles: sources,
              },
              explanationSupport,
              manifest,
              limits,
              limitsHit,
            });
            this.metrics.records += selected.length;
          }
        }
      }
      if (!["temporary_failure", "denied"].includes(result.status)) this.cache.set(cacheKey, result);
      return finish(result);
    } catch (error) {
      const code = error?.code === "CANCELLED" || context.signal?.aborted
        ? "CANCELLED"
        : error?.code === "DEADLINE_REACHED" ? "DEADLINE_REACHED" : "DEPENDENCY_UNAVAILABLE";
      if (code === "CANCELLED") this.metrics.cancelled += 1;
      else if (code === "DEADLINE_REACHED") this.metrics.timedOut += 1;
      else this.metrics.failures += 1;
      return finish({ ...base(query, "temporary_failure"), reasonCode: code, retryable: code !== "CANCELLED" });
    }
  }

  #finish(result, startedAt) {
    this.metrics.statuses[result.status] = (this.metrics.statuses[result.status] ?? 0) + 1;
    this.metrics.responseBytes += Buffer.byteLength(JSON.stringify(result));
    const latency = Math.max(0, this.clock() - startedAt);
    this.metrics.totalLatencyMs += latency;
    this.metrics.maxLatencyMs = Math.max(this.metrics.maxLatencyMs, latency);
    return result;
  }
}
