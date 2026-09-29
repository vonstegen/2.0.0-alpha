// Intent citation: docs/architecture/ADR-042-generic-harness-resource-request.md
//
// Generic Harness Resource Request (Phase 2A). Pure, host-side-agnostic helpers
// for the declarative resource contract:
//
//   RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
//
// - request    = manifest declaration of possible resource consumption
//                (AddOnHarnessResourceRequestContract); never authority.
// - grant      = host/user authority, expressed through the EXISTING
//                CapabilityGrant records (registry grantedCapabilities).
// - projection = session-specific material/access; Phase 2B+ (not 2A).
//
// Nothing here touches the filesystem, memory, skills, tools, or any provider
// or credential; these are pure normalization/validation/authority-mapping
// helpers only. Unknown or ungranted resources fail closed.

import type {
  AddOnHarnessResourceRequestContract,
  Capability,
  CapabilityGrant,
  HarnessResourceFamily,
  HarnessResourceGrant,
  HarnessResourceOperation,
  HarnessResourceProjection,
} from "../../../src/core/contracts";
import { HARNESS_RESOURCE_FAMILIES, HARNESS_RESOURCE_OPERATIONS } from "./contracts.ts";

export interface HarnessResourceNormalizationIssue {
  code: string;
  path: string;
  message: string;
}

export type HarnessResourceNormalizationResult =
  | { ok: true; value: AddOnHarnessResourceRequestContract }
  | { ok: false; issues: HarnessResourceNormalizationIssue[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/**
 * Pure, fail-closed normalization of a raw `harnessResources` block. Accepts
 * only the `requests` key and the five Phase 2 resource families; each family
 * value must be a non-empty, unique array of its family's allowlisted
 * operations. Paths, credentials, env-vars, commands, tool executables,
 * provider/model declarations, and unknown families/operations are rejected.
 */
export function normalizeHarnessResourceRequest(value: unknown): HarnessResourceNormalizationResult {
  const issues: HarnessResourceNormalizationIssue[] = [];
  const push = (code: string, path: string, message: string) => issues.push({ code, path, message });

  if (!isRecord(value)) {
    push("harness-resources-object", "harnessResources", "harnessResources must be an object.");
    return { ok: false, issues };
  }

  // Bound fields: only `requests` is declared. Any other key (credential, env,
  // path, command, provider, model, ...) is rejected so no secret/executable
  // channel can ride through the declaration.
  for (const key of Object.keys(value)) {
    if (key !== "requests") {
      push(
        "harness-resources-field",
        `harnessResources.${key}`,
        "harnessResources may only declare the `requests` block; credentials, paths, commands, provider/model and executable fields are forbidden.",
      );
    }
  }

  if (!isRecord(value.requests)) {
    push("harness-resources-requests-object", "harnessResources.requests", "harnessResources.requests must be an object.");
    return { ok: false, issues };
  }
  if (Object.keys(value.requests).length === 0) {
    push("harness-resources-empty-request", "harnessResources.requests", "harnessResources.requests must declare at least one resource family.");
    return { ok: false, issues };
  }

  const normalized: AddOnHarnessResourceRequestContract = { requests: {} };
  const seenFamilies = new Set<string>();

  for (const [familyKey, familyValue] of Object.entries(value.requests)) {
    const path = `harnessResources.requests.${familyKey}`;
    if (!(HARNESS_RESOURCE_FAMILIES as readonly string[]).includes(familyKey)) {
      push(
        "harness-resources-unknown-family",
        path,
        `Unknown resource family "${familyKey}". Registered families: ${HARNESS_RESOURCE_FAMILIES.join(", ")}.`,
      );
      continue;
    }
    if (seenFamilies.has(familyKey)) {
      push("harness-resources-duplicate-family", path, `Resource family "${familyKey}" is declared more than once.`);
      continue;
    }
    seenFamilies.add(familyKey);

    const family = familyKey as HarnessResourceFamily;
    const allowedOperations = HARNESS_RESOURCE_OPERATIONS[family] as readonly HarnessResourceOperation[];
    if (!Array.isArray(familyValue)) {
      push("harness-resources-operations-array", path, `${familyKey} must be an array of allowed operations.`);
      continue;
    }
    if (familyValue.length === 0) {
      push("harness-resources-empty-family", path, `${familyKey} must declare at least one operation; omit the family instead of declaring an empty list.`);
      continue;
    }

    const operations: HarnessResourceOperation[] = [];
    const seenOperations = new Set<string>();
    familyValue.forEach((operation, index) => {
      const operationPath = `${path}[${index}]`;
      if (!isString(operation) || !(allowedOperations as readonly string[]).includes(operation)) {
        push(
          "harness-resources-unknown-operation",
          operationPath,
          `${familyKey} supports only: ${allowedOperations.join(", ")}. Paths, credentials, commands, executables, and provider/model values are forbidden.`,
        );
        return;
      }
      if (seenOperations.has(operation)) {
        push("harness-resources-duplicate-operation", operationPath, `Operation "${operation}" is declared more than once for ${familyKey}.`);
        return;
      }
      seenOperations.add(operation);
      operations.push(operation as HarnessResourceOperation);
    });

    if (operations.length > 0) {
      (normalized.requests as Record<string, HarnessResourceOperation[]>)[familyKey] = operations;
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: normalized };
}

/**
 * Backing capability for each resource family, reusing the existing
 * `Capability` vocabulary rather than a competing grant system. `null` marks a
 * family whose authority flows through the manifest's own skill/tool
 * `requiredCapabilities` (resolved in Phase 2B+) rather than a single
 * capability.
 */
export const HARNESS_RESOURCE_CAPABILITY: Readonly<Record<HarnessResourceFamily, Capability | null>> = Object.freeze({
  project: "filesystem",
  files: "filesystem",
  skills: null,
  memory: "archive-read",
  tools: null,
});

/**
 * Pure authority mapping: resolves a normalized request against the host's
 * existing CapabilityGrant records. A resource operation is granted only when
 * its backing capability is granted; families without a backing capability, and
 * any operation whose capability is absent or denied, fail closed (`granted:
 * false`). Never performs resource access.
 */
export function resolveHarnessResourceGrants(
  request: AddOnHarnessResourceRequestContract,
  grantedCapabilities: readonly CapabilityGrant[],
): HarnessResourceGrant[] {
  const grants: HarnessResourceGrant[] = [];
  for (const family of HARNESS_RESOURCE_FAMILIES) {
    const operations = request.requests[family];
    if (!operations) continue;
    const capability = HARNESS_RESOURCE_CAPABILITY[family];
    for (const operation of operations) {
      const backingGrant = capability === null ? null : (grantedCapabilities.find((grant) => grant.capability === capability) ?? null);
      grants.push({
        family,
        operation,
        granted: capability !== null && backingGrant?.granted === true,
        grant: backingGrant,
      });
    }
  }
  return grants;
}

/**
 * Pure fail-closed projection (Phase 2B+ seam). Projects only granted
 * operations for each requested family; `granted` is true only when every
 * requested operation in the family was granted. Never carries material,
 * secrets, or paths.
 */
export function createHarnessResourceProjection(
  request: AddOnHarnessResourceRequestContract,
  grants: readonly HarnessResourceGrant[],
): HarnessResourceProjection[] {
  const projections: HarnessResourceProjection[] = [];
  for (const family of HARNESS_RESOURCE_FAMILIES) {
    const operations = request.requests[family];
    if (!operations) continue;
    const familyGrants = grants.filter((grant) => grant.family === family);
    const projected = operations.filter((operation) => familyGrants.some((grant) => grant.operation === operation && grant.granted));
    projections.push({
      family,
      operations: projected,
      granted: projected.length === operations.length,
    });
  }
  return projections;
}
