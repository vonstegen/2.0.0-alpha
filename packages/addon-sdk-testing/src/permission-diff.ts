// Intent citation: docs/architecture/ADR-039-addon-permission-diff-on-update.md
//
// Pure diff between two validated AddOnManifest objects. The host
// installer calls `diffAddOnManifest(prior, next)` before persisting a
// new version of an installed add-on (matched by `id@publisher`). The
// returned `AddOnPermissionDelta` separates hard changes (capability /
// identity / isolation / trust churn) from soft changes (cosmetic) so
// the host can prompt the user for the former while auto-accepting
// the latter.
//
// This module is deliberately host-free. It imports only the shared
// contracts; no I/O, no clock, no randomness. Same input → same
// output. The diff is computed in memory; large manifests fit.

import type {
  AddOnManifest,
  Capability,
  CapabilityGrant,
  CapabilityScope,
  RevocationBehavior,
  RuntimeIsolationBoundary,
} from "../../../src/core/contracts.ts";

export type AddOnPermissionDeltaKind =
  | "identity-id-changed"
  | "identity-publisher-changed"
  | "identity-version-downgrade"
  | "identity-version-major-bump"
  | "capability-added"
  | "capability-removed"
  | "capability-scope-widened"
  | "capability-scope-narrowed"
  | "capability-revocation-weakened"
  | "capability-revocation-strengthened"
  | "runtime-type-changed"
  | "isolation-boundary-widened"
  | "isolation-boundary-narrowed"
  | "string-changed"
  | "array-order-changed"
  | "field-added"
  | "field-removed";

export type AddOnPermissionDeltaSeverity = "soft" | "hard";

export interface AddOnPermissionDeltaEntry {
  /** Dotted JSON path for the changed field. */
  path: string;
  /** What changed. */
  kind: AddOnPermissionDeltaKind;
  /** Stable categorization that drives user prompts. */
  severity: AddOnPermissionDeltaSeverity;
  /** Prior value (or undefined for new fields). */
  before?: unknown;
  /** Next value (or undefined for removed fields). */
  after?: unknown;
  /** Detail payload — stable shape per kind. */
  detail?: {
    capability?: Capability;
    scope?: CapabilityScope;
    revocationBehavior?: RevocationBehavior;
    isolationBoundary?: RuntimeIsolationBoundary;
    version?: string;
  };
}

export interface AddOnPermissionDelta {
  /** Hard changes gate the install on a user prompt. */
  hardChanges: AddOnPermissionDeltaEntry[];
  /** Soft changes are auto-accepted but logged. */
  softChanges: AddOnPermissionDeltaEntry[];
  /**
   * True iff `id` or `publisher` differs. The host treats that as a
   * fresh install, never an update.
   */
  identityChanged: boolean;
}

const HARD_KIND: Record<AddOnPermissionDeltaKind, true | false> = {
  "identity-id-changed": true,
  "identity-publisher-changed": true,
  "identity-version-downgrade": true,
  "identity-version-major-bump": true,
  "capability-added": true,
  "capability-removed": true,
  "capability-scope-widened": true,
  "capability-scope-narrowed": true,
  "capability-revocation-weakened": true,
  "capability-revocation-strengthened": true,
  "runtime-type-changed": true,
  "isolation-boundary-widened": true,
  "isolation-boundary-narrowed": true,
  "string-changed": false,
  "array-order-changed": false,
  "field-added": false,
  "field-removed": false,
};

const SCOPE_RANK: Record<CapabilityScope, number> = {
  none: 0,
  self: 1,
  workspace: 2,
  shared: 3,
  "intake-only": 4,
  system: 5,
};

const REVOCATION_RANK: Record<RevocationBehavior, number> = {
  "hard-stop": 0,
  degrade: 1,
  "hide-surface": 2,
};

const ISOLATION_RANK: Record<RuntimeIsolationBoundary, number> = {
  "shell-ui": 0,
  "embedded-surface": 1,
  "host-mediated-service": 2,
  "host-mediated-agent": 3,
  "host-mediated-channel": 4,
};

function harden(
  entry: Omit<AddOnPermissionDeltaEntry, "severity">,
): AddOnPermissionDeltaEntry {
  return {
    ...entry,
    severity: HARD_KIND[entry.kind] ? "hard" : "soft",
  };
}

function parseSemver(
  raw: string,
): { major: number; minor: number; patch: number } | null {
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function diffCapabilityGrants(
  prior: CapabilityGrant[] | undefined,
  next: CapabilityGrant[] | undefined,
): AddOnPermissionDeltaEntry[] {
  const out: AddOnPermissionDeltaEntry[] = [];
  const priorByCapability: Record<Capability, CapabilityGrant> = {} as Record<
    Capability,
    CapabilityGrant
  >;
  for (const grant of prior ?? []) {
    priorByCapability[grant.capability] = grant;
  }
  const nextByCapability: Record<Capability, CapabilityGrant> = {} as Record<
    Capability,
    CapabilityGrant
  >;
  for (const grant of next ?? []) {
    nextByCapability[grant.capability] = grant;
  }

  for (const [capability, nextGrant] of Object.entries(
    nextByCapability,
  ) as [Capability, CapabilityGrant][]) {
    const priorGrant = priorByCapability[capability];
    if (!priorGrant) {
      out.push(
        harden({
          path: "requestedCapabilities",
          kind: "capability-added",
          after: nextGrant,
          detail: {
            capability,
            scope: nextGrant.scope,
            revocationBehavior: nextGrant.revocationBehavior,
          },
        }),
      );
      continue;
    }
    if (priorGrant.scope !== nextGrant.scope) {
      const widening =
        SCOPE_RANK[nextGrant.scope] > SCOPE_RANK[priorGrant.scope];
      out.push(
        harden({
          path: "requestedCapabilities",
          kind: widening
            ? "capability-scope-widened"
            : "capability-scope-narrowed",
          before: priorGrant.scope,
          after: nextGrant.scope,
          detail: { capability, scope: nextGrant.scope },
        }),
      );
    }
    if (priorGrant.revocationBehavior !== nextGrant.revocationBehavior) {
      const weakening =
        REVOCATION_RANK[nextGrant.revocationBehavior] >
        REVOCATION_RANK[priorGrant.revocationBehavior];
      out.push(
        harden({
          path: "requestedCapabilities",
          kind: weakening
            ? "capability-revocation-weakened"
            : "capability-revocation-strengthened",
          before: priorGrant.revocationBehavior,
          after: nextGrant.revocationBehavior,
          detail: {
            capability,
            revocationBehavior: nextGrant.revocationBehavior,
          },
        }),
      );
    }
  }
  for (const [capability, priorGrant] of Object.entries(
    priorByCapability,
  ) as [Capability, CapabilityGrant][]) {
    if (nextByCapability[capability]) continue;
    out.push(
      harden({
        path: "requestedCapabilities",
        kind: "capability-removed",
        before: priorGrant,
        detail: {
          capability,
          scope: priorGrant.scope,
          revocationBehavior: priorGrant.revocationBehavior,
        },
      }),
    );
  }
  return out;
}

function diffRuntimeIsolation(
  prior: AddOnManifest["runtimeIsolation"],
  next: AddOnManifest["runtimeIsolation"],
): AddOnPermissionDeltaEntry[] {
  const priorBoundary = prior?.boundary;
  const nextBoundary = next?.boundary;
  if (priorBoundary === nextBoundary) return [];
  const out: AddOnPermissionDeltaEntry[] = [];
  if (priorBoundary === undefined && nextBoundary !== undefined) {
    out.push(
      harden({
        path: "runtimeIsolation.boundary",
        kind: "isolation-boundary-widened",
        after: nextBoundary,
        detail: { isolationBoundary: nextBoundary },
      }),
    );
  } else if (priorBoundary !== undefined && nextBoundary === undefined) {
    out.push(
      harden({
        path: "runtimeIsolation.boundary",
        kind: "isolation-boundary-narrowed",
        before: priorBoundary,
        detail: { isolationBoundary: priorBoundary },
      }),
    );
  } else if (priorBoundary && nextBoundary) {
    const widening =
      ISOLATION_RANK[nextBoundary] > ISOLATION_RANK[priorBoundary];
    out.push(
      harden({
        path: "runtimeIsolation.boundary",
        kind: widening
          ? "isolation-boundary-widened"
          : "isolation-boundary-narrowed",
        before: priorBoundary,
        after: nextBoundary,
        detail: { isolationBoundary: nextBoundary },
      }),
    );
  }
  return out;
}

function diffStringField(
  prior: unknown,
  next: unknown,
  path: string,
): AddOnPermissionDeltaEntry[] {
  if (typeof prior === "string" && typeof next === "string" && prior === next) {
    return [];
  }
  if (prior === undefined && next !== undefined) {
    return [
      harden({
        path,
        kind: "field-added",
        after: next,
      }),
    ];
  }
  if (prior !== undefined && next === undefined) {
    return [
      harden({
        path,
        kind: "field-removed",
        before: prior,
      }),
    ];
  }
  return [
    {
      path,
      kind: "string-changed",
      severity: "soft",
      before: prior,
      after: next,
    },
  ];
}

/**
 * Pure diff between two validated manifests. Both `prior` and `next`
 * MUST have been run through `validateAddOnManifest`; this function
 * does not re-validate.
 */
export function diffAddOnManifest(
  prior: AddOnManifest,
  next: AddOnManifest,
): AddOnPermissionDelta {
  const all: AddOnPermissionDeltaEntry[] = [];

  if (prior.id !== next.id) {
    all.push(
      harden({
        path: "id",
        kind: "identity-id-changed",
        before: prior.id,
        after: next.id,
      }),
    );
  }
  if (prior.publisher !== next.publisher) {
    all.push(
      harden({
        path: "publisher",
        kind: "identity-publisher-changed",
        before: prior.publisher,
        after: next.publisher,
      }),
    );
  }
  if (prior.version !== next.version) {
    const priorSemver = parseSemver(prior.version);
    const nextSemver = parseSemver(next.version);
    if (priorSemver && nextSemver) {
      const priorTuple = priorSemver.major * 10000 + priorSemver.minor * 100 + priorSemver.patch;
      const nextTuple = nextSemver.major * 10000 + nextSemver.minor * 100 + nextSemver.patch;
      if (nextTuple < priorTuple) {
        all.push(
          harden({
            path: "version",
            kind: "identity-version-downgrade",
            before: prior.version,
            after: next.version,
            detail: { version: next.version },
          }),
        );
      } else if (nextSemver.major > priorSemver.major) {
        all.push(
          harden({
            path: "version",
            kind: "identity-version-major-bump",
            before: prior.version,
            after: next.version,
            detail: { version: next.version },
          }),
        );
      }
    }
  }
  if (prior.runtimeType !== next.runtimeType) {
    all.push(
      harden({
        path: "runtimeType",
        kind: "runtime-type-changed",
        before: prior.runtimeType,
        after: next.runtimeType,
      }),
    );
  }

  all.push(
    ...diffCapabilityGrants(prior.requestedCapabilities, next.requestedCapabilities),
    ...diffRuntimeIsolation(prior.runtimeIsolation, next.runtimeIsolation),
    ...diffStringField(prior.name, next.name, "name"),
    ...diffStringField(prior.author, next.author, "author"),
    ...diffStringField(prior.description, next.description, "description"),
    ...diffStringField(prior.category, next.category, "category"),
  );

  const hardChanges: AddOnPermissionDeltaEntry[] = [];
  const softChanges: AddOnPermissionDeltaEntry[] = [];
  for (const entry of all) {
    if (entry.severity === "hard") {
      hardChanges.push(entry);
    } else {
      softChanges.push(entry);
    }
  }
  return {
    hardChanges,
    softChanges,
    identityChanged:
      prior.id !== next.id || prior.publisher !== next.publisher,
  };
}
