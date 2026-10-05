// Host-owned registry of ExternalCliHarnessPolicy modules (XH1+XH2).
//
// Each policy is reviewed host code. A manifest references a
// `policyId`; the host looks the policy up here, calls
// `resolveExecutable()` + `composeInvocation()` at `invoke()` time.
// The registry is read-only after construction — no manifest, no
// caller, and no terminal adapter can register or unregister a
// policy. Adding a new harness means ADDING a new policy module to
// this file (or the equivalent test seam).

import { createPiHarnessPolicy } from "./harness-policies/pi.mjs";

/** @typedef {import("../../src/core/external-cli-harness-contract.ts").ExternalCliHarnessPolicy} ExternalCliHarnessPolicy */

export const REVIEWED_POLICIES = /** @type {ReadonlyMap<string, ExternalCliHarnessPolicy>} */ (new Map());

// Register the reviewed Pi policy. The pi-v1 policy is built fresh
// on every call so its host-side allowlist probe runs; it is the
// ONLY reviewed policy in this phase.
const piPolicy = createPiHarnessPolicy();
if (!piPolicy || typeof piPolicy.policyId !== "string" || piPolicy.policyId.length === 0) {
  throw new TypeError("harness-policy-registry: pi policy module returned an invalid policy");
}
REVIEWED_POLICIES.set(piPolicy.policyId, piPolicy);

/**
 * Look up a reviewed policy by id. Returns null for unknown ids.
 */
export function getHarnessPolicy(policyId) {
  if (typeof policyId !== "string") return null;
  return REVIEWED_POLICIES.get(policyId) ?? null;
}

/**
 * The set of reviewed policy ids. Manifests may only reference one
 * of these.
 */
export function listReviewedPolicyIds() {
  return [...REVIEWED_POLICIES.keys()];
}

/**
 * The set of policy ids that match a given manifest's
 * `terminalRequirements`. Used by the harness host to pick a
 * compatible surface for a given manifest.
 */
export function listPoliciesSatisfying(requirements) {
  if (!Array.isArray(requirements)) return [];
  const out = [];
  for (const policy of REVIEWED_POLICIES.values()) {
    const req = policy.terminalRequirements ?? [];
    if (req.every((r) => requirements.includes(r))) out.push(policy.policyId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// XH1 manifest policy-request validator.
//
// Manifests may REQUEST a reviewed policy; they may NOT supply one.
// The validator rejects:
//
//   * unknown `policyId`
//   * executable paths anywhere in the manifest (no `executable`,
//     `command`, `path`, `argv`, `executablePath`)
//   * shell command strings (no `shellCommand`, `cmd`, `command`)
//   * credential names / secrets (no `apiKey`, `token`, `secret`,
//     `password`, `credentialName`, `authToken`)
//   * unrestricted env maps (no `env`, `environment` blocks, no
//     `vars` block with non-reviewed names)
//
// Returns { valid, issues }. The host refuses to load a manifest
// whose `harnessRuntime` is non-empty and fails validation.
// ---------------------------------------------------------------------------

const FORBIDDEN_EXECUTABLE_KEYS = new Set([
  "executable",
  "executablepath",
  "executablename",
  "command",
  "cmd",
  "path",
  "argv",
  "binary",
  "binarypath",
  "shellcommand",
]);
const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "apikey",
  "api_key",
  "token",
  "secrettoken",
  "secret",
  "password",
  "credentialname",
  "credential_name",
  "authtoken",
  "auth_token",
  "key",
]);
const FORBIDDEN_ENV_KEYS = new Set(["env", "environment", "envvars", "env_vars", "vars"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walkRejecting(value, path, issues) {
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_EXECUTABLE_KEYS.has(lower)) {
      issues.push({
        severity: "error",
        code: "manifest-policy-executable",
        path: childPath,
        message: `manifest may not supply executable path / command at ${childPath}`,
      });
    }
    if (FORBIDDEN_CREDENTIAL_KEYS.has(lower)) {
      issues.push({
        severity: "error",
        code: "manifest-policy-credential",
        path: childPath,
        message: `manifest may not supply credential material at ${childPath}`,
      });
    }
    if (FORBIDDEN_ENV_KEYS.has(lower)) {
      issues.push({
        severity: "error",
        code: "manifest-policy-env",
        path: childPath,
        message: `manifest may not supply unrestricted env at ${childPath}`,
      });
    }
    walkRejecting(child, childPath, issues);
  }
}

const KNOWN_RUNTIME_GATING = new Set([
  "explicit-enable",
  "default-on",
  "default-off",
]);
const KNOWN_PROMPT_DELIVERY = new Set(["file", "stdin", "argv"]);
const KNOWN_CREDENTIAL_SOURCES = new Set([
  "provider-profile",
  "self-auth",
  "none",
]);

/**
 * Validate the `harnessRuntime` block of a manifest for XH1
 * compliance. Accepts a reviewed `policyId` and rejects everything
 * else the policy layer owns.
 *
 * @param {unknown} harnessRuntime
 * @returns {{ valid: boolean, issues: Array<{ severity: string, code: string, path: string, message: string }> }}
 */
export function validateHarnessRuntimePolicyRequest(harnessRuntime) {
  const issues = [];
  if (!isPlainObject(harnessRuntime)) {
    return { valid: false, issues: [{ severity: "error", code: "manifest-policy-request-shape", path: "harnessRuntime",
      message: "harnessRuntime must be an object" }] };
  }
  // 1. variant must be "external-cli" (the only variant this layer
  //    owns in XH2). Other variants are out of scope.
  if (harnessRuntime.variant !== "external-cli") {
    issues.push({ severity: "error", code: "manifest-policy-variant", path: "harnessRuntime.variant",
      message: `harnessRuntime.variant must be "external-cli" (got ${JSON.stringify(harnessRuntime.variant)})` });
  }
  // 2. policyId must be a reviewed id.
  if (typeof harnessRuntime.policyId !== "string" || harnessRuntime.policyId.length === 0) {
    issues.push({ severity: "error", code: "manifest-policy-id-missing", path: "harnessRuntime.policyId",
      message: "harnessRuntime.policyId is required" });
  } else if (!REVIEWED_POLICIES.has(harnessRuntime.policyId)) {
    issues.push({ severity: "error", code: "manifest-policy-id-unknown", path: "harnessRuntime.policyId",
      message: `harnessRuntime.policyId ${JSON.stringify(harnessRuntime.policyId)} is not in the reviewed policy set` });
  }
  // 3. terminalRequirements, when supplied, must be an array of
  //    strings. The host does not strictly require it (the policy's
  //    declared requirements are authoritative), but if a manifest
  //    supplies it, it must be well-formed.
  if (harnessRuntime.terminalRequirements !== undefined) {
    if (!Array.isArray(harnessRuntime.terminalRequirements) ||
        !harnessRuntime.terminalRequirements.every((c) => typeof c === "string")) {
      issues.push({ severity: "error", code: "manifest-policy-requirements-shape", path: "harnessRuntime.terminalRequirements",
        message: "terminalRequirements must be an array of strings" });
    }
  }
  // 4. credentialSource must be one of the known sources.
  if (harnessRuntime.credentialSource !== undefined &&
      !KNOWN_CREDENTIAL_SOURCES.has(harnessRuntime.credentialSource)) {
    issues.push({ severity: "error", code: "manifest-policy-credential-source", path: "harnessRuntime.credentialSource",
      message: `credentialSource must be one of ${[...KNOWN_CREDENTIAL_SOURCES].join(", ")}` });
  }
  // 5. promptDelivery, when supplied, must be a known value.
  if (harnessRuntime.promptDelivery !== undefined &&
      !KNOWN_PROMPT_DELIVERY.has(harnessRuntime.promptDelivery)) {
    issues.push({ severity: "error", code: "manifest-policy-prompt-delivery", path: "harnessRuntime.promptDelivery",
      message: `promptDelivery must be one of ${[...KNOWN_PROMPT_DELIVERY].join(", ")}` });
  }
  // 6. executionGating, when supplied, must be a known value.
  if (harnessRuntime.executionGating !== undefined &&
      !KNOWN_RUNTIME_GATING.has(harnessRuntime.executionGating)) {
    issues.push({ severity: "error", code: "manifest-policy-execution-gating", path: "harnessRuntime.executionGating",
      message: `executionGating must be one of ${[...KNOWN_RUNTIME_GATING].join(", ")}` });
  }
  // 7. Reject executable / command / credential / env material
  //    anywhere inside harnessRuntime. Walk the entire subtree.
  walkRejecting(harnessRuntime, "harnessRuntime", issues);
  return { valid: issues.length === 0, issues };
}
