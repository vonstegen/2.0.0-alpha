// Intent citation: docs/architecture/ADR-041-addon-isolation-boundary.md
//
// Pure helpers for the add-on isolation boundary. The validator
// calls `validateRuntimeIsolationForManifest`; the bridge
// dispatcher calls `buildWorkerKey` and `shouldRebindWorker`.
// Both are host-free: same inputs -> same outputs.
//
// The function `validateRuntimeIsolationForManifest` accepts
// `unknown` so the in-place validator can pass the raw candidate
// without a runtime cast. The bridge dispatcher passes a fully
// validated `AddOnManifest`.

import type {
  AddOnManifest,
  AddOnRuntimeType,
  RuntimeIsolationBoundary,
} from "../../../src/core/contracts.ts";

export type WorkerKey = `${string}@${string}:${string}|${string}`;

export interface IsolationCheckError {
  code: string;
  path: string;
  message: string;
}

export type IsolationCheckResult =
  | { valid: true; workerKey: WorkerKey }
  | { valid: false; errors: IsolationCheckError[] };

const HOST_MEDIATED_BOUNDARIES: Record<RuntimeIsolationBoundary, boolean> = {
  "host-mediated-service": true,
  "host-mediated-agent": true,
  "host-mediated-channel": true,
  "shell-ui": false,
  "embedded-surface": false,
};

const NODE_ONLY_RUNTIME_TYPES: Record<AddOnRuntimeType, boolean> = {
  "agent-addon": true,
  "channel-addon": true,
  "local-service": true,
  "ui-module": false,
  "embedded-module": false,
};

const UI_RUNTIME_TYPES: Record<AddOnRuntimeType, boolean> = {
  "ui-module": true,
  "embedded-module": true,
  "agent-addon": false,
  "channel-addon": false,
  "local-service": false,
};

/**
 * Build the canonical worker key for a manifest. Two manifests
 * share a worker iff their keys are byte-identical — i.e. the same
 * id, publisher, version, and isolation boundary.
 */
export function buildWorkerKey(manifest: AddOnManifest): WorkerKey {
  const boundary = manifest.runtimeIsolation?.boundary ?? "(none)";
  return `${manifest.id}@${manifest.publisher}:${manifest.version}|${boundary}` as WorkerKey;
}

/**
 * Returns the errors a manifest-shaped object carries when its
 * isolation boundary doesn't fit its runtime type, or its
 * `requiresReviewedGrant` / `supportsDegradedMode` flags
 * contradict the requested capabilities. On success, also returns
 * the canonical worker key so callers can adopt it without
 * re-running `buildWorkerKey`.
 *
 * Accepts `unknown` so the validator can pass the raw candidate
 * without an inline cast. The function reads only the fields it
 * needs and tolerates missing fields.
 *
 * Rules enforced:
 *   R1: a host-mediated-* boundary paired with a UI-only
 *       runtimeType (ui-module / embedded-module) is rejected.
 *   R2: requiresReviewedGrant: true with no non-trivial
 *       capability is rejected.
 *   R3: supportsDegradedMode: false with a `degrade`-revoking
 *       capability is rejected.
 *   R4: missing identity fields (id / publisher / version) is
 *       rejected (the worker key needs them).
 *
 * Notably absent: the inverse rule "shell-ui + node runtimeType is
 * rejected" — too noisy in practice; Alpha allows hybrid addons
 * whose UI lives in the shell but whose data plane is a Node
 * worker. A future ADR may tighten this if a real abuse surfaces.
 */
export function validateRuntimeIsolationForManifest(
  manifest: unknown,
): IsolationCheckResult {
  if (manifest === null || typeof manifest !== "object") {
    return {
      valid: false,
      errors: [
        {
          code: "isolation-candidate-not-object",
          path: "$",
          message: "Manifest candidate must be an object.",
        },
      ],
    };
  }
  const candidate = manifest as Partial<AddOnManifest>;
  const boundary = candidate.runtimeIsolation?.boundary;
  const runtimeType = candidate.runtimeType;

  if (boundary && HOST_MEDIATED_BOUNDARIES[boundary]) {
    if (runtimeType && UI_RUNTIME_TYPES[runtimeType]) {
      return {
        valid: false,
        errors: [
          {
            code: "isolation-runtime-type-mismatch",
            path: "runtimeType",
            message: `runtimeType "${runtimeType}" cannot host a worker-mediated boundary.`,
          },
        ],
      };
    }
    if (runtimeType && !NODE_ONLY_RUNTIME_TYPES[runtimeType]) {
      return {
        valid: false,
        errors: [
          {
            code: "isolation-runtime-type-unknown",
            path: "runtimeType",
            message: `runtimeType "${runtimeType}" is not a host-mediated runtime.`,
          },
        ],
      };
    }
  }

  if (candidate.runtimeIsolation?.requiresReviewedGrant === true) {
    const nonTrivial = (candidate.requestedCapabilities ?? []).some(
      (g) => g.scope === "system" || g.revocationBehavior === "hard-stop",
    );
    if (!nonTrivial) {
      return {
        valid: false,
        errors: [
          {
            code: "isolation-missing-non-trivial-grant",
            path: "runtimeIsolation.requiresReviewedGrant",
            message:
              "requiresReviewedGrant must be backed by at least one capability with system scope or hard-stop revocation.",
          },
        ],
      };
    }
  }

  if (candidate.runtimeIsolation?.supportsDegradedMode === false) {
    const conflicting = (candidate.requestedCapabilities ?? []).find(
      (g) => g.revocationBehavior === "degrade",
    );
    if (conflicting) {
      return {
        valid: false,
        errors: [
          {
            code: "isolation-degraded-mode-conflict",
            path: "runtimeIsolation.supportsDegradedMode",
            message: `Capability ${conflicting.capability} revokes to "degrade" but the manifest declares no degraded mode.`,
          },
        ],
      };
    }
  }

  if (
    typeof candidate.id !== "string" ||
    typeof candidate.publisher !== "string" ||
    typeof candidate.version !== "string"
  ) {
    return {
      valid: false,
      errors: [
        {
          code: "isolation-identity-incomplete",
          path: "$",
          message:
            "Worker key requires id, publisher, and version to be present strings.",
        },
      ],
    };
  }

  return {
    valid: true,
    workerKey: buildWorkerKey(candidate as AddOnManifest),
  };
}

/**
 * True iff a manifest change should force the bridge dispatcher
 * to rebind the addon worker. A rebind is required when any of
 * the four worker-key components change: id, publisher, version,
 * or isolation boundary. Cosmetic changes are not rebinds.
 */
export function shouldRebindWorker(
  prior: AddOnManifest,
  next: AddOnManifest,
): boolean {
  if (prior.id !== next.id) return true;
  if (prior.publisher !== next.publisher) return true;
  if (prior.version !== next.version) return true;
  const priorBoundary = prior.runtimeIsolation?.boundary;
  const nextBoundary = next.runtimeIsolation?.boundary;
  if (priorBoundary !== nextBoundary) return true;
  return false;
}
