import { digestJson } from "./augmentor-consultation-contract.mjs";

function clone(value) {
  return structuredClone(value);
}

export function consultationCacheKey({
  opaquePrincipalRef,
  policyDigest,
  allowedViews,
  bundleDigest,
  contractVersion,
  query,
  limits,
} = {}) {
  return digestJson({
    opaquePrincipalRef,
    policyDigest,
    allowedViews: [...allowedViews].sort(),
    bundleDigest,
    contractVersion,
    operation: query.operation,
    query: query.query,
    explanation: query.explanation ?? null,
    scope: query.scope,
    limits,
  });
}

export class ConsultationEvidenceCache {
  constructor({ maxEntries = 128 } = {}) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 10000) throw new TypeError("invalid consultation cache size");
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    const value = this.entries.get(key);
    if (value === undefined) return null;
    this.entries.delete(key);
    this.entries.set(key, value);
    return clone(value);
  }

  set(key, value) {
    this.entries.delete(key);
    this.entries.set(key, clone(value));
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
