// CP-XH3a — harness↔terminal compatibility resolver unit tests.
//
// The resolver is pure: no I/O, no process side effects, no
// secrets. The tests assert structured-result shape, preferred-
// order determinism, completeness of missingCapabilities, and
// the non-secret property of every public value.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTerminalSurfaceDescriptor,
  defineTerminalSurface,
  deriveProvenanceFidelity,
  missingCapabilitiesFor,
  orderDescriptorsForResolution,
} from "../../src/core/terminal-surface-contract.ts";
import { resolveHarnessTerminalCompatibility } from "../host/harness-terminal-compatibility.mjs";
import {
  getTerminalSurfaceDescriptor,
  listTerminalSurfaceDescriptors,
} from "../host/terminal-surface-registry.mjs";

// Hand-curated fixture surfaces so the tests stay deterministic
// and self-documenting. No real driver is involved.
const FX_GHOSTTY = defineTerminalSurface({
  contractVersion: 1,
  adapterId: "fx-ghostty",
  platform: "macos",
  supportedOperations: ["createSession", "launchBootstrap", "sendInput", "terminateSession"],
  capabilities: ["command", "environment", "cwd", "lifecycle-events"],
  feedbackChannel: "polling",
});
const FX_ITERM2 = defineTerminalSurface({
  contractVersion: 1,
  adapterId: "fx-iterm2",
  platform: "macos",
  supportedOperations: ["createSession", "launchBootstrap", "sendInput", "terminateSession"],
  capabilities: ["command", "environment", "cwd", "lifecycle-events", "command-events", "multiplexer", "adopt-existing"],
  feedbackChannel: "event-stream",
});
const FX_OBSERVATION = defineTerminalSurface({
  contractVersion: 1,
  adapterId: "fx-observation",
  platform: "macos",
  supportedOperations: ["createSession", "launchBootstrap", "sendInput", "terminateSession"],
  capabilities: ["command", "environment"],
  feedbackChannel: "observation",
});
const FX_NONE = defineTerminalSurface({
  contractVersion: 1,
  adapterId: "fx-none",
  platform: "macos",
  supportedOperations: ["createSession", "launchBootstrap", "sendInput", "terminateSession"],
  capabilities: ["command"],
  feedbackChannel: "none",
});

describe("XH3a — deriveProvenanceFidelity", () => {
  it("event-stream -> telemetry", () => {
    assert.equal(deriveProvenanceFidelity("event-stream"), "telemetry");
  });
  it("polling -> telemetry", () => {
    assert.equal(deriveProvenanceFidelity("polling"), "telemetry");
  });
  it("observation -> observation", () => {
    assert.equal(deriveProvenanceFidelity("observation"), "observation");
  });
  it("none -> unsupported", () => {
    assert.equal(deriveProvenanceFidelity("none"), "unsupported");
  });
});

describe("XH3a — orderDescriptorsForResolution", () => {
  it("honors the preferred list first, then the rest in declaration order", () => {
    const out = orderDescriptorsForResolution([FX_GHOSTTY, FX_ITERM2, FX_OBSERVATION], ["fx-observation", "fx-ghostty"]);
    assert.deepEqual(out.map((d) => d.adapterId), ["fx-observation", "fx-ghostty", "fx-iterm2"]);
  });
  it("drops unknown preferred ids and continues", () => {
    const out = orderDescriptorsForResolution([FX_GHOSTTY, FX_ITERM2], ["fx-doesnt-exist", "fx-iterm2"]);
    assert.deepEqual(out.map((d) => d.adapterId), ["fx-iterm2", "fx-ghostty"]);
  });
  it("stable for an empty preferred list", () => {
    const out = orderDescriptorsForResolution([FX_GHOSTTY, FX_ITERM2]);
    assert.deepEqual(out.map((d) => d.adapterId), ["fx-ghostty", "fx-iterm2"]);
  });
});

describe("XH3a — missingCapabilitiesFor", () => {
  it("returns the requirements that are NOT in the descriptor", () => {
    const missing = missingCapabilitiesFor(FX_GHOSTTY, ["command", "screen-stream", "lifecycle-events"]);
    assert.deepEqual([...missing], ["screen-stream"]);
  });
  it("empty when every requirement is satisfied", () => {
    const missing = missingCapabilitiesFor(FX_ITERM2, ["command", "command-events"]);
    assert.equal(missing.length, 0);
  });
});

describe("XH3a — resolveHarnessTerminalCompatibility: compatible", () => {
  it("returns the first preferred descriptor that satisfies every requirement", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
      descriptors: [FX_GHOSTTY, FX_ITERM2, FX_OBSERVATION],
      preferred: ["fx-iterm2", "fx-ghostty"],
    });
    assert.equal(r.compatible, true);
    assert.equal(r.surface.adapterId, "fx-iterm2");
    assert.equal(r.provenanceFidelity, "telemetry");
    assert.deepEqual([...r.missingCapabilities], []);
  });

  it("telemetry fidelity for polling (ghostty-style)", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty"],
    });
    assert.equal(r.compatible, true);
    assert.equal(r.surface.adapterId, "fx-ghostty");
    assert.equal(r.provenanceFidelity, "telemetry");
  });

  it("observation fidelity for observation surfaces", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment"],
      descriptors: [FX_OBSERVATION, FX_GHOSTTY],
      preferred: ["fx-observation"],
    });
    assert.equal(r.compatible, true);
    assert.equal(r.provenanceFidelity, "observation");
  });

  it("uses the host's registered descriptors by default", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
    });
    // The real registry has ghostty / iterm2 / in-memory — all three
    // are compatible with the pi-v1 requirement set, so the result
    // is compatible against at least one of them.
    assert.equal(r.compatible, true);
    assert.ok(["ghostty", "iterm2", "in-memory"].includes(r.surface.adapterId));
  });

  it("deterministic: identical inputs produce identical outputs across calls", () => {
    const a = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty", "fx-iterm2"],
    });
    const b = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty", "fx-iterm2"],
    });
    assert.equal(a.compatible, b.compatible);
    assert.equal(a.surface.adapterId, b.surface.adapterId);
    assert.equal(a.provenanceFidelity, b.provenanceFidelity);
  });
});

describe("XH3a — resolveHarnessTerminalCompatibility: incompatible", () => {
  it("returns compatible:false with EVERY missing capability for the first preferred candidate", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "screen-stream", "multiplexer"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty", "fx-iterm2"],
    });
    assert.equal(r.compatible, false);
    // ghostty is the first preferred; it has none of the missing
    // capabilities, so ALL of them are reported.
    assert.deepEqual([...r.missingCapabilities].sort(), ["multiplexer", "screen-stream"]);
    assert.equal(r.provenanceFidelity, "unsupported");
    assert.equal(r.surface, undefined);
  });

  it("prefers ghostty as the first candidate but the resolver still reports the true missing set", () => {
    // ghostty is first preferred; it has [command, environment, cwd, lifecycle-events].
    // Required: command (ok), environment (ok), screen-stream (MISS).
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "screen-stream"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty"],
    });
    assert.equal(r.compatible, false);
    assert.deepEqual([...r.missingCapabilities], ["screen-stream"]);
  });

  it("returns unsupported + missing=requirements when the descriptor set is empty", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment"],
      descriptors: [],
    });
    assert.equal(r.compatible, false);
    assert.equal(r.provenanceFidelity, "unsupported");
    assert.deepEqual([...r.missingCapabilities].sort(), ["command", "environment"]);
  });

  it("returns unsupported when a non-array requirements arg is supplied", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: "command,environment",
      descriptors: [FX_GHOSTTY],
    });
    assert.equal(r.compatible, false);
    assert.equal(r.provenanceFidelity, "unsupported");
  });

  it("ignores unknown preferred ids without picking an ineligible descriptor", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["screen-stream"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-doesnt-exist", "fx-also-doesnt-exist"],
    });
    assert.equal(r.compatible, false);
    assert.equal(r.provenanceFidelity, "unsupported");
  });
});

describe("XH3a — non-secret shape (no path / token / credential / env value)", () => {
  it("compatible result exposes only capability strings, surface id, and a fidelity enum", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "lifecycle-events"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty"],
    });
    // Walk the entire result and prove the only string-shaped
    // values are capability names, adapterIds, platforms, feedback
    // channels, fidelity enums, or supported-operation identifiers
    // — never a path / token / credential / env value.
    const ALLOWED = /^[a-zA-Z][a-zA-Z0-9-]*$/;
    function shape(value, path) {
      if (value === null || value === undefined) return;
      if (typeof value === "string") {
        assert.ok(
          ALLOWED.test(value),
          `unexpected non-identifier string at ${path}: ${JSON.stringify(value)}`,
        );
        return;
      }
      if (Array.isArray(value)) { value.forEach((v, i) => shape(v, `${path}[${i}]`)); return; }
      if (typeof value === "object") {
        for (const [k, v] of Object.entries(value)) shape(v, `${path}.${k}`);
        return;
      }
      // numbers / booleans are fine.
    }
    shape(r, "harnessTerminalCompatibility");
  });

  it("incompatible result carries only capability strings in missingCapabilities", () => {
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "screen-stream", "multiplexer"],
      descriptors: [FX_GHOSTTY, FX_ITERM2],
      preferred: ["fx-ghostty"],
    });
    for (const m of r.missingCapabilities) {
      assert.ok(/^[a-z][a-z0-9-]*$/.test(m), `non-identifier in missingCapabilities: ${JSON.stringify(m)}`);
    }
  });
});

describe("XH3a — pi-v1 requirements are satisfiable by every real driver", () => {
  it("ghostty, iterm2, in-memory all satisfy the pi-v1 requirement set individually", () => {
    const REQS = ["command", "environment", "lifecycle-events"];
    for (const id of ["ghostty", "iterm2", "in-memory"]) {
      const desc = getTerminalSurfaceDescriptor(id);
      assert.ok(desc, `descriptor ${id} is registered`);
      const r = resolveHarnessTerminalCompatibility({ requirements: REQS, descriptors: [desc] });
      assert.equal(r.compatible, true, `pi-v1 must be compatible with ${id}`);
    }
  });
});

describe("XH3a — descriptor registry sanity", () => {
  it("every registered descriptor validates against the contract", () => {
    for (const desc of listTerminalSurfaceDescriptors()) {
      assert.ok(isTerminalSurfaceDescriptor(desc));
    }
  });
  it("the set is exactly ghostty, iterm2, in-memory (no orphan entries)", () => {
    const ids = listTerminalSurfaceDescriptors().map((d) => d.adapterId).sort();
    assert.deepEqual(ids, ["ghostty", "in-memory", "iterm2"]);
  });
});
