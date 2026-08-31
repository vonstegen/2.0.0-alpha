// Intent citation: docs/architecture/resonantos-browser-architecture/14-master-phased-implementation-checklist.md
import assert from "node:assert/strict";
import test from "node:test";

import { createAddonDelegationHostService } from "../host/addon-delegation-host-service.mjs";
import {
  classifyRouteEnforcement,
  collectRouteEnforcementTelemetry,
} from "../host/route-enforcement-telemetry.mjs";

test("classifies governed, legacy, and ungated routes", () => {
  assert.equal(classifyRouteEnforcement({ method: "POST", path: "/x", enforcement: "governed" }), "governed");
  assert.equal(classifyRouteEnforcement({ method: "POST", path: "/x", requiredCapability: "archive-read" }), "legacy");
  assert.equal(classifyRouteEnforcement({ method: "GET", path: "/x" }), "ungated");
  assert.equal(classifyRouteEnforcement(null), "ungated");
});

test("collects the migration baseline with per-route lists and a complete flag", () => {
  const telemetry = collectRouteEnforcementTelemetry([
    { method: "POST", path: "/governed", enforcement: "governed" },
    { method: "POST", path: "/legacy", requiredCapability: "archive-read" },
    { method: "GET", path: "/status" },
  ]);
  assert.equal(telemetry.total, 3);
  assert.equal(telemetry.governed, 1);
  assert.equal(telemetry.legacy, 1);
  assert.equal(telemetry.ungated, 1);
  assert.equal(telemetry.migrationComplete, false);
  assert.deepEqual(telemetry.governedRoutes, ["POST /governed"]);
  assert.deepEqual(telemetry.legacyRoutes, ["POST /legacy"]);
});

test("migration is complete only when no legacy route remains", () => {
  const complete = collectRouteEnforcementTelemetry([
    { method: "POST", path: "/governed", enforcement: "governed" },
    { method: "GET", path: "/status" },
  ]);
  assert.equal(complete.migrationComplete, true);
  assert.equal(complete.legacy, 0);
});

test("the addon-delegation host service marks exactly the two governed pilot routes", () => {
  const names = [
    "executeAddonsStatus",
    "executeAddonSurfaceRoutes",
    "executeAddonExecutionSettingsGet",
    "executeAddonExecutionSettingsUpdate",
    "executeAddonUninstall",
    "executeOpenCodeStatus",
    "executeHermesDashboardStatus",
    "executeHermesDashboardStart",
    "executeHermesDashboardStop",
    "executeHermesStatus",
    "executeHermesDelegationStart",
    "executeHermesDelegationStatus",
    "executeHermesDelegationArtifact",
    "executeHermesDelegationCancel",
    "executeOpenCodeDelegationStart",
    "executeOpenCodeDelegationStatus",
    "executeOpenCodeDelegationArtifact",
    "executeOpenCodeDelegationCancel",
    "executeOpenCodeWebUrl",
    "executeAddonDraftRecord",
    "executeAddonDraftList",
    "executeAddonDraftRead",
    "executeAddonDraftTransition",
    "executeAddonDraftProviderHandoff",
    "executeDelegationRecord",
    "executeDelegationList",
    "executeGoalRecord",
  ];
  const handlers = Object.fromEntries(names.map((name) => [name, async () => ({ name })]));
  const { addonDelegationRoutes } = createAddonDelegationHostService(handlers);

  const telemetry = collectRouteEnforcementTelemetry(addonDelegationRoutes);
  assert.deepEqual(
    telemetry.governedRoutes.sort(),
    ["POST /augmentor/extension/invoke", "POST /external-agent-runtime/governed-delegate"].sort(),
  );
  assert.ok(telemetry.legacy > 0, "legacy capability-token routes should still be present");
  assert.equal(telemetry.migrationComplete, false);
});
