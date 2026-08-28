// Intent citation: docs/architecture/ADR-051-ros-architecture-blueprint.md
//
// Pins the bridge mirror of the ROS architecture blueprint to the ADR so a
// drift between ros-architecture-snapshot.mjs and architecture.ts fails here.

import assert from "node:assert/strict";
import test from "node:test";

import {
  GROUND_ZERO_INVARIANT,
  railMenuKindForCategory,
  ROS_FUSED_CORE,
  rosArchitectureSnapshot,
} from "../host/ros-architecture-snapshot.mjs";

test("ROS architecture snapshot mirrors the ADR-051 blueprint", () => {
  const snap = rosArchitectureSnapshot();

  // Fused core: 7 non-removable shell sections + the fixed harness/memory/recovery roles.
  assert.deepEqual(
    [...ROS_FUSED_CORE.sections],
    ["overview", "strategist", "archive", "delegation", "compute", "addons", "settings"],
  );
  assert.equal(ROS_FUSED_CORE.integratedHarness, "the-shell-agent");
  assert.equal(ROS_FUSED_CORE.systemMemoryKind, "system-memory");
  assert.equal(ROS_FUSED_CORE.recoveryField, "recoverySession");

  // Vocabulary: 8 terms.
  assert.deepEqual(
    Object.keys(snap.vocabulary).sort(),
    ["agent", "harness", "memory", "orchestrator", "project", "shell", "tool", "workspace"].sort(),
  );

  // Scoping: 3 levels.
  assert.deepEqual(Object.keys(snap.scoping).sort(), ["project", "shell", "workspace"].sort());

  // Categories: 8, each mapped to a rail menu kind.
  assert.equal(Object.keys(snap.categories).length, 8);
  assert.equal(railMenuKindForCategory("agent"), "harness");
  assert.equal(railMenuKindForCategory("memory"), "memory");
  assert.equal(railMenuKindForCategory("tool"), "tools");
  assert.equal(railMenuKindForCategory("integration"), "tools");

  // Runtime types: 5.
  assert.equal(Object.keys(snap.runtimeTypes).length, 5);

  // Ground-0 invariant names the fallback guarantee.
  assert.match(GROUND_ZERO_INVARIANT, /self-sufficient/);
  assert.match(GROUND_ZERO_INVARIANT, /Ground-0 = base = fallback/);
});
