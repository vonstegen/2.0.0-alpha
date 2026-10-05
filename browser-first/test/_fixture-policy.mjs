// Test-only fixture policy used to prove the generic launcher is
// harness-agnostic. The fixture is a reviewed policy module that the
// harness-policy-registry exposes only for the duration of the test
// (`registerFixturePolicy` / `unregisterFixturePolicy`). The production
// registry never sees this policy.

import { REVIEWED_POLICIES } from "../host/harness-policy-registry.mjs";
import { isExternalCliHarnessPolicy } from "../../src/core/external-cli-harness-contract.ts";

export const FIXTURE_POLICY_ID = "fixture-cli-v1-test-only";

function fixtureResolveExecutable(input) {
  if (!input || typeof input.sessionId !== "string") return null;
  return {
    command: "/usr/local/bin/fixture-cli",
    source: "fixed-install-root",
    note: "fixture policy (test-only)",
  };
}

function fixtureComposeInvocation(input) {
  if (!input || typeof input.executable?.command !== "string") {
    throw new TypeError("fixture policy: reviewed executable required");
  }
  if (typeof input.prompt !== "string") {
    throw new TypeError("fixture policy: string prompt required");
  }
  return {
    commandSuffix: `'${input.executable.command}' '${input.prompt}'`,
    auditSummary: "fixture-cli (test-only)",
  };
}

const fixturePolicy = {
  contractVersion: 1,
  policyId: FIXTURE_POLICY_ID,
  harnessId: "fixture-cli",
  executablePolicyId: "fixture-cli-fixed-root",
  terminalRequirements: ["command", "environment", "lifecycle-events"],
  credentialPolicy: {
    source: "provider-profile",
    supportedProviderFamilies: ["openai"],
    delivery: "session-environment",
  },
  promptDelivery: "argv",
  supportsModelSelection: false,
  resolveExecutable: fixtureResolveExecutable,
  composeInvocation: fixtureComposeInvocation,
};

// Sanity: this is a real reviewed policy shape (the launcher will
// call into it the same way it does for pi-v1).
if (!isExternalCliHarnessPolicy(fixturePolicy)) {
  throw new TypeError("fixture policy failed isExternalCliHarnessPolicy validation");
}

export function registerFixturePolicy() {
  REVIEWED_POLICIES.set(FIXTURE_POLICY_ID, fixturePolicy);
}

export function unregisterFixturePolicy() {
  REVIEWED_POLICIES.delete(FIXTURE_POLICY_ID);
}

// ---------------------------------------------------------------------------
// XH3b fixture: a SECOND fixture whose terminalRequirements are
// intentionally unsatisfiable by every real driver. The XH3b gate
// test registers this fixture and proves the launcher yields a
// fail-closed error without minting a grant, writing a token/auth
// file, or issuing a launchBootstrap RPC.
// ---------------------------------------------------------------------------

export const UNSATISFIABLE_POLICY_ID = "fixture-cli-unsatisfiable-test-only";

function unsatisfiableResolveExecutable(input) {
  if (!input || typeof input.sessionId !== "string") return null;
  return {
    command: "/usr/local/bin/unsatisfiable-cli",
    source: "fixed-install-root",
    note: "unsatisfiable fixture policy (test-only)",
  };
}

function unsatisfiableComposeInvocation(input) {
  if (!input || typeof input.executable?.command !== "string") {
    throw new TypeError("unsatisfiable policy: reviewed executable required");
  }
  if (typeof input.prompt !== "string") {
    throw new TypeError("unsatisfiable policy: string prompt required");
  }
  return {
    commandSuffix: `'${input.executable.command}' '${input.prompt}'`,
    auditSummary: "unsatisfiable-cli (test-only)",
  };
}

const unsatisfiablePolicy = {
  contractVersion: 1,
  policyId: UNSATISFIABLE_POLICY_ID,
  harnessId: "unsatisfiable-cli",
  executablePolicyId: "unsatisfiable-cli-fixed-root",
  // screen-stream is intentionally not exposed by ANY real driver
  // (ghostty / iterm2 / in-memory). The XH3b test must drive this
  // policy through the launcher and prove the fail-closed ordering.
  terminalRequirements: ["command", "environment", "screen-stream"],
  credentialPolicy: {
    source: "provider-profile",
    supportedProviderFamilies: ["openai"],
    delivery: "session-environment",
  },
  promptDelivery: "argv",
  supportsModelSelection: false,
  resolveExecutable: unsatisfiableResolveExecutable,
  composeInvocation: unsatisfiableComposeInvocation,
};

if (!isExternalCliHarnessPolicy(unsatisfiablePolicy)) {
  throw new TypeError("unsatisfiable fixture policy failed isExternalCliHarnessPolicy validation");
}

export function registerUnsatisfiablePolicy() {
  REVIEWED_POLICIES.set(UNSATISFIABLE_POLICY_ID, unsatisfiablePolicy);
}

export function unregisterUnsatisfiablePolicy() {
  REVIEWED_POLICIES.delete(UNSATISFIABLE_POLICY_ID);
}
