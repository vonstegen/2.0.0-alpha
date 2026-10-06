// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §4
// (Public lifecycle model) and CP-BR3 (Generic SDK runtime lifecycle contract).
// Pure contract + resolver only: no I/O, no process, no timers, no
// manifest `service.entrypoint` consulted, no classification branching.

import type { AddOnRuntimeType } from "../../../src/core/contracts";

/**
 * Public add-on runtime lifecycle status vocabulary (roadmap §4.2).
 * This is the only vocabulary the SDK contract emits; CP-BR3 deliberately
 * does not invent new states.
 */
export type AddOnRuntimeLifecycleStatus =
  | "inactive"
  | "starting"
  | "ready"
  | "degraded"
  | "failed"
  | "stopping";

export const ADDON_RUNTIME_LIFECYCLE_STATUSES: readonly AddOnRuntimeLifecycleStatus[] = [
  "inactive",
  "starting",
  "ready",
  "degraded",
  "failed",
  "stopping",
];

/**
 * Public add-on runtime lifecycle snapshot (roadmap §4.2).
 *
 * Carries public identifiers and bounded state only. The shape-walker
 * (`packages/addon-sdk/test/runtime-lifecycle.test.ts`) walks this snapshot
 * recursively and asserts no token-, credential-, path-, PID-, or env-shaped
 * value is reachable. Timestamps appear only as projected metadata; the
 * resolver itself never consults the wall clock as a decision input.
 */
export interface AddOnRuntimeLifecycleSnapshot {
  addonId: string;
  runtimeId: string;
  status: AddOnRuntimeLifecycleStatus;
  generation: number;
  activeSessionCount: number;
  startedAt?: string;
  lastTransitionAt?: string;
  publicFailureCode?: string;
}

/**
 * Public failure codes the resolver may surface. The list is closed: the
 * resolver emits one of these, or `addon-manifest-invalid` for unknown
 * authority inputs (the only catch-all code).
 */
export type AddOnRuntimePublicFailureCode =
  | "addon-not-installed"
  | "addon-disabled"
  | "addon-authorization-required"
  | "addon-incompatible"
  | "addon-factory-missing"
  | "addon-revoked"
  | "addon-degraded-by-policy"
  | "addon-runtime-type-unknown"
  | "addon-authority-input-invalid"
  | "addon-manifest-invalid";

export const ADDON_RUNTIME_PUBLIC_FAILURE_CODES: readonly AddOnRuntimePublicFailureCode[] = [
  "addon-not-installed",
  "addon-disabled",
  "addon-authorization-required",
  "addon-incompatible",
  "addon-factory-missing",
  "addon-revoked",
  "addon-degraded-by-policy",
  "addon-runtime-type-unknown",
  "addon-authority-input-invalid",
  "addon-manifest-invalid",
];

/**
 * Desired runtime state. The resolver returns one of these plus a bounded
 * reason; it never returns process actions (CP-B4 will translate the decision
 * into start/stop behavior).
 */
export type AddOnRuntimeDesiredState = "running" | "stopped" | "degraded";

/**
 * The host-owned authority projection that the resolver consumes. CP-BR3
 * defines the projection shape; CP-BR4 populates it from the live host
 * registry. The resolver never reads host state directly.
 *
 * `requiredCapabilities` is the closed list of capabilities the add-on
 * declared in its manifest's `requestedCapabilities` field. The resolver
 * requires `required.every(cap => granted.has(cap))`; partial grants
 * resolve `stopped` / `addon-authorization-required` (CP-BR4 grant-
 * completeness fix).
 */
export interface AddOnRuntimeAuthorityProjection {
  installed: boolean;
  enabled: boolean;
  /**
   * Every capability the add-on declared in `requestedCapabilities` MUST be
   * present in this set. The resolver clones the set so the caller's
   * authority projection is never mutated.
   */
  grantedCapabilities: ReadonlySet<string>;
  /**
   * The closed list of capabilities the add-on requires to start a runtime.
   * When the projection omits this field (older CP-BR3 callers), the
   * resolver falls back to a non-empty `grantedCapabilities` check, which
   * preserves CP-BR3 behavior. New CP-BR4 callers MUST supply it so the
   * grant-completeness check is exhaustive.
   */
  requiredCapabilities?: ReadonlySet<string>;
  /**
   * Add-on manifest compatibility against the running shell. Hosts MUST
   * supply this. The resolver does not call a compatibility checker.
   */
  compatible: boolean;
  /**
   * True iff a reviewed runtime factory for this add-on's `runtimeType` is
   * registered (CP-BR4 responsibility). CP-BR3 treats this as an opaque
   * input flag.
   */
  reviewedFactoryAvailable: boolean;
  /**
   * Active revocation policy for the add-on. `hard-stop` always fails
   * closed; `degrade` returns the `degraded` desired state; `hide-surface`
   * is a UI-layer concern and maps to `stopped` here (no surface, no
   * runtime).
   */
  revocation: "none" | "hard-stop" | "degrade" | "hide-surface";
}

/**
 * Resolver input. The manifest is treated as already-validated by the SDK
 * validator; the resolver checks authority only. Callers MUST pass a
 * `AddOnManifest` (post-validation) or a plain runtimeType, but the resolver
 * itself never calls the SDK validator.
 */
export interface AddOnRuntimeLifecycleInput {
  addonId: string;
  runtimeType: AddOnRuntimeType;
  classification: string; // open string; never branches the resolver
  authority: AddOnRuntimeAuthorityProjection;
}

/**
 * The resolver's public decision. Closed shape, no secrets, no paths, no PID,
 * no env. `publicFailureCode` is only set on `stopped` or `degraded` outcomes.
 */
export interface AddOnRuntimeDesiredStateDecision {
  addonId: string;
  desiredState: AddOnRuntimeDesiredState;
  publicReason: string;
  publicFailureCode?: AddOnRuntimePublicFailureCode;
}

const KNOWN_RUNTIME_TYPES: ReadonlySet<AddOnRuntimeType> = new Set<AddOnRuntimeType>([
  "ui-module",
  "embedded-module",
  "local-service",
  "agent-addon",
  "channel-addon",
]);

const isKnownRuntimeType = (value: unknown): value is AddOnRuntimeType =>
  typeof value === "string" && KNOWN_RUNTIME_TYPES.has(value as AddOnRuntimeType);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isGrantedCapabilities = (
  value: unknown,
): value is ReadonlySet<string> => {
  if (!(value instanceof Set)) return false;
  for (const entry of value) {
    if (typeof entry !== "string") return false;
  }
  return true;
};

/**
 * Validate the authority projection shape. Anything malformed or out-of-range
 * is treated as a closed failure (`addon-authority-input-invalid`) — the
 * resolver fails closed against forged or partial inputs.
 */
const validateAuthority = (
  authority: unknown,
): { ok: true; value: AddOnRuntimeAuthorityProjection } | { ok: false; reason: string } => {
  if (typeof authority !== "object" || authority === null || Array.isArray(authority)) {
    return { ok: false, reason: "authority must be an object" };
  }

  const record = authority as Record<string, unknown>;
  const installed = record.installed;
  const enabled = record.enabled;
  const grantedCapabilities = record.grantedCapabilities;
  const requiredCapabilities = record.requiredCapabilities;
  const compatible = record.compatible;
  const reviewedFactoryAvailable = record.reviewedFactoryAvailable;
  const revocation = record.revocation;

  if (typeof installed !== "boolean") return { ok: false, reason: "authority.installed must be a boolean" };
  if (typeof enabled !== "boolean") return { ok: false, reason: "authority.enabled must be a boolean" };
  if (!isGrantedCapabilities(grantedCapabilities)) {
    return { ok: false, reason: "authority.grantedCapabilities must be a Set<string>" };
  }
  if (requiredCapabilities !== undefined) {
    if (!(requiredCapabilities instanceof Set)) {
      return { ok: false, reason: "authority.requiredCapabilities must be a Set<string> when present" };
    }
    for (const entry of requiredCapabilities) {
      if (typeof entry !== "string") {
        return { ok: false, reason: "authority.requiredCapabilities entries must be strings" };
      }
    }
  }
  if (typeof compatible !== "boolean") {
    return { ok: false, reason: "authority.compatible must be a boolean" };
  }
  if (typeof reviewedFactoryAvailable !== "boolean") {
    return { ok: false, reason: "authority.reviewedFactoryAvailable must be a boolean" };
  }
  if (
    revocation !== "none" &&
    revocation !== "hard-stop" &&
    revocation !== "degrade" &&
    revocation !== "hide-surface"
  ) {
    return { ok: false, reason: "authority.revocation must be one of none|hard-stop|degrade|hide-surface" };
  }

  return {
    ok: true,
    value: {
      installed,
      enabled,
      // Clone the set so the resolver can never mutate the caller's state.
      grantedCapabilities: new Set(grantedCapabilities),
      // Pass the required set through (or undefined) so the resolver can
      // do the grant-completeness check. We do not clone again because the
      // resolver reads it once and does not mutate.
      requiredCapabilities: requiredCapabilities === undefined
        ? undefined
        : new Set(requiredCapabilities as ReadonlySet<string>),
      compatible,
      reviewedFactoryAvailable,
      revocation,
    },
  };
};

/**
 * Pure, fail-closed resolver implementing the desired-state rule from
 * roadmap §4.3:
 *
 *   desiredRunning =
 *     installed
 *     AND enabled
 *     AND required capabilities granted
 *     AND compatible
 *     AND reviewed runtime factory exists
 *     AND no hard-stop revocation fence is active
 *
 * UI-only add-ons (`ui-module`) NEVER produce a runtime-process desired
 * state: the resolver returns `stopped` with no failure code. CP-BR4 will
 * look up the desired state and act on it; UI-only add-ons naturally never
 * get a factory.
 *
 * Classification NEVER changes the outcome. The `classification` field is
 * present on the input only so the host can carry it through; the resolver
 * reads it to surface it in `publicReason` but does not branch on it.
 */
export const deriveDesiredRuntimeState = (
  input: unknown,
): AddOnRuntimeDesiredStateDecision => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return malformedDecision("addon-manifest-invalid", "input must be an object");
  }
  const record = input as Record<string, unknown>;
  const addonId = record.addonId;
  const runtimeType = record.runtimeType;
  const classification = record.classification;
  const authority = record.authority;

  if (!isNonEmptyString(addonId)) {
    return malformedDecision("addon-manifest-invalid", "input.addonId must be a non-empty string");
  }
  if (!isKnownRuntimeType(runtimeType)) {
    // Unknown runtime type is a closed failure.
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Runtime type does not request a runtime process.",
      publicFailureCode: "addon-runtime-type-unknown",
    };
  }
  if (!isNonEmptyString(classification)) {
    return malformedDecision("addon-manifest-invalid", "input.classification must be a non-empty string");
  }

  const validated = validateAuthority(authority);
  if (!validated.ok) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Authority projection was malformed; resolver fails closed.",
      publicFailureCode: "addon-authority-input-invalid",
    };
  }
  const auth = validated.value;

  // UI-only add-ons never produce a runtime process. This is the only place
  // the resolver uses runtimeType to shape its answer; the answer is
  // guaranteed to be "no runtime" by the AddOnRuntimeType contract.
  if (runtimeType === "ui-module") {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "UI-only add-on; no runtime process is required.",
    };
  }

  // Revocation mapping (closed; CP-BR3 does not invent a process action).
  if (auth.revocation === "hard-stop") {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Hard-stop revocation fence is active.",
      publicFailureCode: "addon-revoked",
    };
  }
  if (auth.revocation === "degrade") {
    return {
      addonId,
      desiredState: "degraded",
      publicReason: "Revocation policy forces degraded operation.",
      publicFailureCode: "addon-degraded-by-policy",
    };
  }
  if (auth.revocation === "hide-surface") {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Surface is hidden; no runtime to start.",
    };
  }

  // Desired-state rule (roadmap §4.3) — fail closed on every missing input.
  if (!auth.installed) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Add-on is not installed.",
      publicFailureCode: "addon-not-installed",
    };
  }
  if (!auth.enabled) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Add-on is installed but disabled.",
      publicFailureCode: "addon-disabled",
    };
  }
  if (!auth.compatible) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "Add-on is incompatible with the current shell.",
      publicFailureCode: "addon-incompatible",
    };
  }
  if (!auth.reviewedFactoryAvailable) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "No reviewed runtime factory is available for this add-on.",
      publicFailureCode: "addon-factory-missing",
    };
  }
  // Grant completeness (CP-BR4 fix). When `requiredCapabilities` is
  // supplied, EVERY required capability must be granted; partial coverage
  // fails closed with `addon-authorization-required`. When the projection
  // omits `requiredCapabilities` (CP-BR3 callers), fall back to the legacy
  // "non-empty granted set" check, which preserves CP-BR3 behavior.
  const required = auth.requiredCapabilities;
  if (required !== undefined) {
    let missing: string | null = null;
    for (const cap of required) {
      if (!auth.grantedCapabilities.has(cap)) {
        missing = cap;
        break;
      }
    }
    if (missing !== null) {
      return {
        addonId,
        desiredState: "stopped",
        publicReason: `Required capability not granted: ${missing}.`,
        publicFailureCode: "addon-authorization-required",
      };
    }
  } else if (auth.grantedCapabilities.size === 0) {
    return {
      addonId,
      desiredState: "stopped",
      publicReason: "No capabilities have been granted.",
      publicFailureCode: "addon-authorization-required",
    };
  }

  return {
    addonId,
    desiredState: "running",
    publicReason: "All desired-state inputs satisfied.",
  };
};

/**
 * Build the public lifecycle snapshot for a given decision + addon. The
 * caller (CP-BR4+) supplies the timestamp and generation fields; this helper
 * performs the pure projection from a decision into the snapshot shape with
 * no I/O. `activeSessionCount` defaults to 0 and `generation` to 0; callers
 * pass these in. Timestamps are opaque strings — the resolver does not
 * generate or interpret them.
 */
export const projectLifecycleSnapshot = (
  decision: AddOnRuntimeDesiredStateDecision,
  options: {
    runtimeId: string;
    generation: number;
    activeSessionCount: number;
    startedAt?: string;
    lastTransitionAt?: string;
    publicFailureCode?: AddOnRuntimePublicFailureCode;
  },
): AddOnRuntimeLifecycleSnapshot => {
  if (!isNonEmptyString(options.runtimeId)) {
    throw new TypeError("runtimeId must be a non-empty string");
  }
  if (!isNonNegativeSafeInteger(options.generation)) {
    throw new TypeError("generation must be a non-negative safe integer");
  }
  if (!isNonNegativeSafeInteger(options.activeSessionCount)) {
    throw new TypeError("activeSessionCount must be a non-negative safe integer");
  }

  const status = decisionToStatus(decision);
  const failureCode = decision.publicFailureCode ?? options.publicFailureCode;

  const snapshot: AddOnRuntimeLifecycleSnapshot = {
    addonId: decision.addonId,
    runtimeId: options.runtimeId,
    status,
    generation: options.generation,
    activeSessionCount: options.activeSessionCount,
  };
  if (options.startedAt !== undefined) snapshot.startedAt = options.startedAt;
  if (options.lastTransitionAt !== undefined) snapshot.lastTransitionAt = options.lastTransitionAt;
  if ((status === "failed" || status === "degraded") && failureCode) {
    snapshot.publicFailureCode = failureCode;
  }
  return Object.freeze(snapshot);
};

const decisionToStatus = (
  decision: AddOnRuntimeDesiredStateDecision,
): AddOnRuntimeLifecycleStatus => {
  if (decision.desiredState === "running") return "starting";
  if (decision.desiredState === "degraded") return "degraded";
  // desiredState === "stopped" maps to inactive or failed based on the reason.
  const code = decision.publicFailureCode;
  if (code === undefined) return "inactive";
  if (code === "addon-not-installed" || code === "addon-disabled" || code === "addon-authorization-required") {
    return "inactive";
  }
  return "failed";
};

const malformedDecision = (
  code: AddOnRuntimePublicFailureCode,
  reason: string,
): AddOnRuntimeDesiredStateDecision => ({
  addonId: "",
  desiredState: "stopped",
  publicReason: reason,
  publicFailureCode: code,
});
