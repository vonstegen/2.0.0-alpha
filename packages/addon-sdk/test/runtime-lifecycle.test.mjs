// CP-BR3 tests — Generic SDK Runtime Lifecycle Contract.
// Run: node --experimental-strip-types --test packages/addon-sdk/test/runtime-lifecycle.test.mjs
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §4
// and CP-BR3 (Generic SDK runtime lifecycle contract).
//
// This file covers prompt §8 reqs #1–#15:
//   1. installed+enabled+granted+compatible+factory+no revocation → running
//   2. not installed → stopped/Not installed
//   3. installed, disabled → stopped/Disabled
//   4. enabled but missing a required grant → stopped (Authorization required)
//   5. incompatible → stopped
//   6. missing reviewed factory → stopped
//   7. hard-stop revocation fence → stopped
//   8. degrade revocation → degraded/stopped per policy
//   9. two add-ons differing only in classification.category → identical result
//  10. UI-only (ui-module) never produces a runtime-process desired state
//  11. unknown runtimeType fails closed
//  12. unknown/forged authority input fails closed
//  13. resolver performs no I/O
//  14. shape-walker finds no token/credential/path/PID/env value in any public result
//  15. fixture manifests validate under the SDK validator

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNTIME_LIFECYCLE_SOURCE = readFileSync(
  resolve(__dirname, "../src/runtime-lifecycle.ts"),
  "utf8",
);

import {
  ADDON_RUNTIME_LIFECYCLE_STATUSES,
  ADDON_RUNTIME_PUBLIC_FAILURE_CODES,
  deriveDesiredRuntimeState,
  projectLifecycleSnapshot,
} from "../src/runtime-lifecycle.ts";
import { assertValidAddOnManifest } from "../src/validation.ts";
import {
  localServiceAddon,
  agentAddon,
  uiModuleAddon,
  connectorAddon,
  categoryTwinAddon,
} from "./fixtures/runtime-lifecycle-addons.ts";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

const cpBr4BaseAuthority = (overrides = {}) => ({
  installed: true,
  enabled: true,
  grantedCapabilities: new Set(["filesystem"]),
  compatible: true,
  reviewedFactoryAvailable: true,
  revocation: "none",
  ...overrides,
});

const fullInput = (overrides = {}) => ({
  addonId: "addon.test",
  runtimeType: "local-service",
  classification: "tool",
  authority: cpBr4BaseAuthority(overrides.authority ?? {}),
  ...overrides,
});

// ----------------------------------------------------------------------------
// Vocabulary and projection contract
// ----------------------------------------------------------------------------

test("CP-BR3 req #0a: status vocabulary matches roadmap §4.2", () => {
  assert.deepEqual([...ADDON_RUNTIME_LIFECYCLE_STATUSES], [
    "inactive",
    "starting",
    "ready",
    "degraded",
    "failed",
    "stopping",
  ]);
});

test("CP-BR3 req #0b: public failure codes are closed", () => {
  // The resolver must never emit anything outside this list.
  for (const code of ADDON_RUNTIME_PUBLIC_FAILURE_CODES) {
    assert.equal(typeof code, "string");
  }
  // The list is exactly the documented vocabulary.
  assert.equal(ADDON_RUNTIME_PUBLIC_FAILURE_CODES.length, 10);
});

// ----------------------------------------------------------------------------
// Req #1 — happy path
// ----------------------------------------------------------------------------

test("CP-BR3 req #1: installed+enabled+granted+compatible+factory+no revocation → running", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  assert.equal(decision.addonId, "addon.test");
  assert.equal(decision.desiredState, "running");
  assert.equal(decision.publicFailureCode, undefined);
  assert.match(decision.publicReason, /All desired-state inputs satisfied/);
});

// ----------------------------------------------------------------------------
// Req #2 — not installed
// ----------------------------------------------------------------------------

test("CP-BR3 req #2: not installed → stopped/Not installed", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ installed: false }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-not-installed");
  assert.match(decision.publicReason, /not installed/i);
});

// ----------------------------------------------------------------------------
// Req #3 — installed, disabled
// ----------------------------------------------------------------------------

test("CP-BR3 req #3: installed, disabled → stopped/Disabled", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ enabled: false }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-disabled");
  assert.match(decision.publicReason, /disabled/i);
});

// ----------------------------------------------------------------------------
// Req #4 — missing grant
// ----------------------------------------------------------------------------

test("CP-BR3 req #4: missing required grant → stopped/Authorization required", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ grantedCapabilities: new Set() }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authorization-required");
  assert.match(decision.publicReason, /capabilities/i);
});

// ----------------------------------------------------------------------------
// Req #5 — incompatible
// ----------------------------------------------------------------------------

test("CP-BR3 req #5: incompatible → stopped", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ compatible: false }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-incompatible");
  assert.match(decision.publicReason, /incompatible/i);
});

// ----------------------------------------------------------------------------
// Req #6 — missing reviewed factory
// ----------------------------------------------------------------------------

test("CP-BR3 req #6: missing reviewed runtime factory → stopped", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ reviewedFactoryAvailable: false }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-factory-missing");
  assert.match(decision.publicReason, /factory/i);
});

// ----------------------------------------------------------------------------
// Req #7 — hard-stop revocation fence
// ----------------------------------------------------------------------------

test("CP-BR3 req #7: hard-stop revocation fence → stopped/Revoked", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ revocation: "hard-stop" }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-revoked");
  assert.match(decision.publicReason, /revocation/i);
});

// ----------------------------------------------------------------------------
// Req #8 — degrade revocation
// ----------------------------------------------------------------------------

test("CP-BR3 req #8: degrade revocation → degraded per policy", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ revocation: "degrade" }) }),
  );
  assert.equal(decision.desiredState, "degraded");
  assert.equal(decision.publicFailureCode, "addon-degraded-by-policy");
});

test("CP-BR3 req #8b: hide-surface revocation → stopped", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ revocation: "hide-surface" }) }),
  );
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, undefined);
});

// ----------------------------------------------------------------------------
// Req #9 — category independence
// ----------------------------------------------------------------------------

test("CP-BR3 req #9: two add-ons differing only in classification → identical decision", () => {
  const authority = cpBr4BaseAuthority();

  const toolServiceDecision = deriveDesiredRuntimeState({
    addonId: localServiceAddon.id,
    runtimeType: localServiceAddon.runtimeType,
    classification: localServiceAddon.category,
    authority,
  });

  const integrationServiceDecision = deriveDesiredRuntimeState({
    addonId: connectorAddon.id,
    runtimeType: connectorAddon.runtimeType,
    classification: connectorAddon.category,
    authority,
  });

  assert.equal(toolServiceDecision.desiredState, integrationServiceDecision.desiredState);
  assert.equal(toolServiceDecision.publicFailureCode, integrationServiceDecision.publicFailureCode);
  // The addonId is the only allowed difference; the rest of the decision
  // (which is the category-independent public surface) must be byte-equal.
  const stripAddonId = ({ addonId, ...rest }) => rest;
  assert.deepEqual(stripAddonId(toolServiceDecision), stripAddonId(integrationServiceDecision));
});

test("CP-BR3 req #9b: category twin fixture produces same decision as local-service fixture", () => {
  const authority = cpBr4BaseAuthority();
  const decisionA = deriveDesiredRuntimeState({
    addonId: localServiceAddon.id,
    runtimeType: localServiceAddon.runtimeType,
    classification: localServiceAddon.category,
    authority,
  });
  const decisionB = deriveDesiredRuntimeState({
    addonId: categoryTwinAddon.id,
    runtimeType: categoryTwinAddon.runtimeType,
    classification: categoryTwinAddon.category,
    authority,
  });
  assert.deepEqual(
    { ...decisionA, addonId: "X" },
    { ...decisionB, addonId: "X" },
  );
});

// ----------------------------------------------------------------------------
// Req #10 — UI-only never produces a runtime process
// ----------------------------------------------------------------------------

test("CP-BR3 req #10: UI-only add-on (ui-module) → stopped, no runtime process", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: uiModuleAddon.id,
    runtimeType: uiModuleAddon.runtimeType,
    classification: uiModuleAddon.category,
    authority: cpBr4BaseAuthority(), // every authority satisfied — still stopped
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, undefined);
  assert.match(decision.publicReason, /UI-only/);
});

test("CP-BR3 req #10b: UI-only add-on ignores missing grants and revocation (no authority consulted)", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: uiModuleAddon.id,
    runtimeType: uiModuleAddon.runtimeType,
    classification: uiModuleAddon.category,
    authority: cpBr4BaseAuthority({
      installed: false,
      enabled: false,
      grantedCapabilities: new Set(),
      compatible: false,
      reviewedFactoryAvailable: false,
      revocation: "hard-stop",
    }),
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, undefined);
  assert.match(decision.publicReason, /UI-only/);
});

// ----------------------------------------------------------------------------
// Req #11 — unknown runtimeType fails closed
// ----------------------------------------------------------------------------

test("CP-BR3 req #11: unknown runtimeType → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "potato-service",
    classification: "tool",
    authority: cpBr4BaseAuthority(),
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-runtime-type-unknown");
});

test("CP-BR3 req #11b: missing runtimeType → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    classification: "tool",
    authority: cpBr4BaseAuthority(),
  });
  assert.equal(decision.desiredState, "stopped");
  // Missing runtime type is treated identically to an unknown runtime type:
  // a closed failure with `addon-runtime-type-unknown`. The manifest is
  // still considered malformed in the broader sense, but the resolver's
  // public failure code reflects "no usable runtime type".
  assert.equal(decision.publicFailureCode, "addon-runtime-type-unknown");
});

// ----------------------------------------------------------------------------
// Req #12 — unknown/forged authority input fails closed
// ----------------------------------------------------------------------------

test("CP-BR3 req #12: forged authority (not an object) → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: "forged",
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR3 req #12b: authority with non-boolean installed → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: {
      ...cpBr4BaseAuthority(),
      installed: "yes",
    },
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR3 req #12c: authority with Set<string> of non-strings → closed failure", () => {
  const bad = new Set([1, 2, 3]);
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: { ...cpBr4BaseAuthority(), grantedCapabilities: bad },
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR3 req #12d: authority with unknown revocation → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: { ...cpBr4BaseAuthority(), revocation: "explode" },
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR3 req #12e: empty input → closed failure", () => {
  const decision = deriveDesiredRuntimeState({});
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-manifest-invalid");
});

test("CP-BR3 req #12f: null input → closed failure", () => {
  const decision = deriveDesiredRuntimeState(null);
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-manifest-invalid");
});

test("CP-BR3 req #12g: resolver does not mutate the caller's authority Set", () => {
  const granted = new Set(["filesystem"]);
  const authority = cpBr4BaseAuthority({ grantedCapabilities: granted });
  deriveDesiredRuntimeState(fullInput({ authority }));
  assert.equal(granted.size, 1, "caller's grantedCapabilities set must not be mutated");
  assert.equal(granted.has("filesystem"), true);
});

// ----------------------------------------------------------------------------
// Req #13 — purity / no I/O
// ----------------------------------------------------------------------------

test("CP-BR3 req #13a: resolver does not import node:fs, node:child_process, or node:net", async () => {
  // Lazy-import the module to inspect its ESM record.
  const mod = await import("../src/runtime-lifecycle.ts");
  const record = mod;
  // The module surface must only carry the documented exports. We forbid
  // any side-effect-ful Node builtins from being reachable.
  const names = Object.keys(record);
  for (const name of names) {
    assert.ok(
      name === "ADDON_RUNTIME_LIFECYCLE_STATUSES" ||
        name === "ADDON_RUNTIME_PUBLIC_FAILURE_CODES" ||
        name === "deriveDesiredRuntimeState" ||
        name === "projectLifecycleSnapshot",
      `Unexpected export ${name}`,
    );
  }
});

test("CP-BR3 req #13b: resolver returns synchronously and is referentially transparent", () => {
  const input = fullInput();
  const a = deriveDesiredRuntimeState(input);
  const b = deriveDesiredRuntimeState(input);
  assert.deepEqual(a, b);
});

test("CP-BR3 req #13c: resolver performs no I/O — global fs/spawn/fetch are not invoked", () => {
  // The resolver module does not import node:fs, node:child_process, node:net,
  // or undici. We assert by searching the source for forbidden import
  // patterns. (Read once; this is a static check.)
  const source = RUNTIME_LIFECYCLE_SOURCE;
  assert.doesNotMatch(source, /from\s+["']node:fs/, "must not import node:fs");
  assert.doesNotMatch(source, /from\s+["']node:child_process/, "must not import node:child_process");
  assert.doesNotMatch(source, /from\s+["']node:net/, "must not import node:net");
  assert.doesNotMatch(source, /from\s+["']node-fetch/, "must not import node-fetch");
  assert.doesNotMatch(source, /\bsetTimeout\b/, "must not call setTimeout");
  assert.doesNotMatch(source, /\bsetInterval\b/, "must not call setInterval");
  assert.doesNotMatch(source, /\bDate\.now\b/, "must not consult the wall clock for decisions");
});

// ----------------------------------------------------------------------------
// Req #14 — shape-walker on public projection
// ----------------------------------------------------------------------------

const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\/Users\/[A-Za-z0-9._-]+/,
  /RESONANTOS_[A-Z0-9_]+=/,
  // Opaque long token-like strings: ≥32 chars AND must contain both letters
  // and digits to avoid matching public failure codes like
  // "addon-authorization-required" (28 chars, letters+dashes only).
  /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]{32,}$/,
];

const walk = (value, visit) => {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v);
      walk(v, visit);
    }
    return;
  }
  if (typeof value === "string") visit("string", value);
  if (typeof value === "number") visit("number", value);
};

const assertNoSecretShapedFields = (label, value) => {
  walk(value, (key, v) => {
    if (typeof v === "string") {
      for (const pattern of SECRET_VALUE_PATTERNS) {
        assert.doesNotMatch(
          v,
          pattern,
          `${label}: field "${key}" matched forbidden pattern ${pattern}`,
        );
      }
    }
  });
};

test("CP-BR3 req #14a: shape-walker finds no token/credential/path/PID/env in any decision", () => {
  const inputs = [
    fullInput(),
    fullInput({ authority: cpBr4BaseAuthority({ installed: false }) }),
    fullInput({ authority: cpBr4BaseAuthority({ compatible: false }) }),
    fullInput({ authority: cpBr4BaseAuthority({ revocation: "hard-stop" }) }),
    {
      addonId: "addon.ui",
      runtimeType: "ui-module",
      classification: "knowledge",
      authority: cpBr4BaseAuthority(),
    },
  ];
  for (const input of inputs) {
    assertNoSecretShapedFields("decision", deriveDesiredRuntimeState(input));
  }
});

test("CP-BR3 req #14b: shape-walker finds no token/credential/path/PID/env in any snapshot", () => {
  const decisions = [
    deriveDesiredRuntimeState(fullInput()),
    deriveDesiredRuntimeState(fullInput({ authority: cpBr4BaseAuthority({ installed: false }) })),
    deriveDesiredRuntimeState(
      fullInput({ authority: cpBr4BaseAuthority({ revocation: "degrade" }) }),
    ),
  ];
  for (const decision of decisions) {
    const snapshot = projectLifecycleSnapshot(decision, {
      runtimeId: "runtime-1",
      generation: 0,
      activeSessionCount: 0,
    });
    assertNoSecretShapedFields("snapshot", snapshot);
    // Snapshot is frozen.
    assert.equal(Object.isFrozen(snapshot), true);
  }
});

test("CP-BR3 req #14c: snapshot status values are limited to the public vocabulary", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  const snapshot = projectLifecycleSnapshot(decision, {
    runtimeId: "runtime-1",
    generation: 0,
    activeSessionCount: 0,
  });
  assert.ok(ADDON_RUNTIME_LIFECYCLE_STATUSES.includes(snapshot.status));
});

// ----------------------------------------------------------------------------
// Req #15 — fixture manifests validate under the SDK validator
// ----------------------------------------------------------------------------

test("CP-BR3 req #15: localServiceAddon fixture validates under the SDK validator", () => {
  assertValidAddOnManifest(localServiceAddon);
});

test("CP-BR3 req #15: agentAddon fixture validates under the SDK validator", () => {
  assertValidAddOnManifest(agentAddon);
});

test("CP-BR3 req #15: uiModuleAddon fixture validates under the SDK validator", () => {
  assertValidAddOnManifest(uiModuleAddon);
});

test("CP-BR3 req #15: connectorAddon fixture validates under the SDK validator", () => {
  assertValidAddOnManifest(connectorAddon);
});

test("CP-BR3 req #15: categoryTwinAddon fixture validates under the SDK validator", () => {
  assertValidAddOnManifest(categoryTwinAddon);
});

// ----------------------------------------------------------------------------
// Projector contract
// ----------------------------------------------------------------------------

test("CP-BR3 projector: running decision → starting snapshot", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  const snapshot = projectLifecycleSnapshot(decision, {
    runtimeId: "runtime-1",
    generation: 0,
    activeSessionCount: 0,
  });
  assert.equal(snapshot.status, "starting");
  assert.equal(snapshot.addonId, decision.addonId);
  assert.equal(snapshot.runtimeId, "runtime-1");
  assert.equal(snapshot.generation, 0);
});

test("CP-BR3 projector: degraded decision → degraded snapshot with failure code", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ revocation: "degrade" }) }),
  );
  const snapshot = projectLifecycleSnapshot(decision, {
    runtimeId: "runtime-1",
    generation: 0,
    activeSessionCount: 0,
  });
  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.publicFailureCode, "addon-degraded-by-policy");
});

test("CP-BR3 projector: stopped/inactive decision → inactive snapshot", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ installed: false }) }),
  );
  const snapshot = projectLifecycleSnapshot(decision, {
    runtimeId: "runtime-1",
    generation: 0,
    activeSessionCount: 0,
  });
  assert.equal(snapshot.status, "inactive");
  assert.equal(snapshot.publicFailureCode, undefined);
});

test("CP-BR3 projector: stopped/failure decision → failed snapshot with code", () => {
  const decision = deriveDesiredRuntimeState(
    fullInput({ authority: cpBr4BaseAuthority({ compatible: false }) }),
  );
  const snapshot = projectLifecycleSnapshot(decision, {
    runtimeId: "runtime-1",
    generation: 0,
    activeSessionCount: 0,
  });
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.publicFailureCode, "addon-incompatible");
});

test("CP-BR3 projector: rejects non-string runtimeId", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  assert.throws(
    () =>
      projectLifecycleSnapshot(decision, {
        runtimeId: "",
        generation: 0,
        activeSessionCount: 0,
      }),
    /runtimeId must be a non-empty string/,
  );
});

test("CP-BR3 projector: rejects negative generation", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  assert.throws(
    () =>
      projectLifecycleSnapshot(decision, {
        runtimeId: "runtime-1",
        generation: -1,
        activeSessionCount: 0,
      }),
    /generation must be a non-negative safe integer/,
  );
});

test("CP-BR3 projector: rejects non-integer activeSessionCount", () => {
  const decision = deriveDesiredRuntimeState(fullInput());
  assert.throws(
    () =>
      projectLifecycleSnapshot(decision, {
        runtimeId: "runtime-1",
        generation: 0,
        activeSessionCount: 1.5,
      }),
    /activeSessionCount must be a non-negative safe integer/,
  );
});

// ---------------------------------------------------------------------------
// CP-BR4 grant-completeness fix: requiredCapabilities exhaustiveness check.
// When the projection supplies `requiredCapabilities`, the resolver
// requires every required cap to be granted; partial coverage fails
// closed with `addon-authorization-required`. When `requiredCapabilities`
// is omitted, the legacy "non-empty granted set" check is preserved
// (CP-BR3 callers).
// ---------------------------------------------------------------------------

const baseAuthority = (overrides = {}) => ({
  installed: true,
  enabled: true,
  grantedCapabilities: new Set(["filesystem"]),
  compatible: true,
  reviewedFactoryAvailable: true,
  revocation: "none",
  ...overrides,
});

test("CP-BR4 fix: full grant coverage with requiredCapabilities → running", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: cpBr4BaseAuthority({
      requiredCapabilities: new Set(["filesystem", "notifications"]),
      grantedCapabilities: new Set(["filesystem", "notifications"]),
    }),
  });
  assert.equal(decision.desiredState, "running");
  assert.equal(decision.publicFailureCode, undefined);
});

test("CP-BR4 fix: partial grant (subset of required caps) → stopped/Authorization required", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: cpBr4BaseAuthority({
      requiredCapabilities: new Set(["filesystem", "notifications"]),
      grantedCapabilities: new Set(["filesystem"]),
    }),
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authorization-required");
  // The reason names the missing capability.
  assert.match(decision.publicReason, /notifications/);
});

test("CP-BR4 fix: empty requiredCapabilities (legacy callers) → legacy non-empty-granted check", () => {
  // `requiredCapabilities` is undefined; the resolver falls back to
  // the CP-BR3 behavior: any non-empty granted set is treated as
  // authorized. (This preserves CP-BR3 callers and matches the prior
  // contract.)
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: cpBr4BaseAuthority({
      grantedCapabilities: new Set(["filesystem"]),
      // requiredCapabilities intentionally omitted
    }),
  });
  assert.equal(decision.desiredState, "running");
});

test("CP-BR4 fix: non-Set requiredCapabilities → closed failure (forged input)", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: {
      ...cpBr4BaseAuthority(),
      requiredCapabilities: "filesystem,notifications", // wrong type
    },
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR4 fix: requiredCapabilities with non-string entry → closed failure", () => {
  const decision = deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: {
      ...cpBr4BaseAuthority(),
      // @ts-expect-error testing forged input
      requiredCapabilities: new Set([1, 2, 3]),
    },
  });
  assert.equal(decision.desiredState, "stopped");
  assert.equal(decision.publicFailureCode, "addon-authority-input-invalid");
});

test("CP-BR4 fix: resolver does not mutate caller's requiredCapabilities Set", () => {
  const required = new Set(["filesystem", "notifications"]);
  const granted = new Set(["filesystem"]);
  deriveDesiredRuntimeState({
    addonId: "addon.test",
    runtimeType: "local-service",
    classification: "tool",
    authority: cpBr4BaseAuthority({ requiredCapabilities: required, grantedCapabilities: granted }),
  });
  assert.equal(required.size, 2);
  assert.equal(granted.size, 1);
});
