// Intent citation: docs/architecture/ADR-056-provider-fabric-boundary-external-agent-runtimes.md#7-failure-modes
// Intent citation: docs/architecture/ADR-056-provider-fabric-boundary-external-agent-runtimes.md#8-existing-addons
//
// Cross-addon validation: every concrete addon manifest shipped under
// `examples/addons/` that declares the §3 conjunction (providers +
// agent-delegation) MUST pass the §7 failure-mode harness. This file
// loads each such manifest from disk and runs the F1–F10 suite against
// it.
//
// Per ADR-056 §8, `recursive-mas.json` pre-dates and satisfies this
// ADR. This test guards that claim. Per ADR-055/056, the
// `deepseek-harness-resonant.json` exemplar is the canonical new
// external runtime manifest; this test guards that claim too.
//
// What this test does NOT do:
//   - It does not start any real DeepSeek / RecursiveMAS process.
//   - It does not exercise the real ResonantOS host.
//
// What this test DOES:
//   - Validates the manifest against `validateAddOnManifest`.
//   - Confirms the manifest declares the §3 conjunction.
//   - For every failure mode F1–F10, drives the manifest through
//     `runAddOnFailureMode` and asserts the report's `pass` is
//     strictly `true` (i.e., the host emitted the §7 expected deny
//     code + audit reason AND the harness agrees). The earlier
//     version only asserted `typeof report.pass === "boolean"`, which
//     accepted a failing report as a pass — fixed here per the
//     maintainer's 2026-09-10 closeout review of #329.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { validateAddOnManifest } from "../../../src/sdk/addons/validation.ts";
import {
  runAddOnFailureMode,
  FAILURE_MODE_IDS,
} from "../src/failure-modes/index.ts";
import type { ExternalAgentRuntimeManifest } from "../src/manifest-fixtures.ts";
import type { AddOnManifest } from "../../../src/core/contracts.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// packages/addon-sdk-testing/test/ -> ../../.. -> worktree root
const repoRoot = resolve(__dirname, "..", "..", "..");

interface CrossAddonCase {
  path: string;
  id: string;
}

const cases: readonly CrossAddonCase[] = [
  {
    path: "examples/addons/deepseek-harness-resonant.json",
    id: "addon.deepseek-harness",
  },
  {
    path: "examples/addons/recursive-mas.json",
    id: "addon.recursive-mas",
  },
] as const;

const loadManifest = (relPath: string): AddOnManifest => {
  const absPath = resolve(repoRoot, relPath);
  return JSON.parse(readFileSync(absPath, "utf8")) as AddOnManifest;
};

const declaredCapabilities = (manifest: AddOnManifest): Record<string, true> => {
  const out: Record<string, true> = {};
  for (const g of manifest.requestedCapabilities ?? []) {
    if (g?.capability) out[g.capability] = true;
  }
  return out;
};

// The F-runner takes `ExternalAgentRuntimeManifest`, which is
// `AddOnManifest & { callerId: string }`. Each cross-addon manifest is a
// pure `AddOnManifest`; attach a per-manifest caller id derived from the
// addon id so the audit record's `callerId` field is distinguishable.
const withCallerId = (
  manifest: AddOnManifest,
): ExternalAgentRuntimeManifest => {
  const callerId = `caller.${manifest.id}`;
  return { ...manifest, callerId };
};

describe("cross-addon: every shipped external-agent-runtime manifest passes F1–F10", () => {
  for (const { path: relPath, id } of cases) {
    describe(id, () => {
      const manifest = loadManifest(relPath);
      const declared = declaredCapabilities(manifest);
      const annotated = withCallerId(manifest);

      it("loads from disk", () => {
        expect(manifest.id).toBe(id);
      });

      it("validates against validateAddOnManifest (no errors)", () => {
        const result = validateAddOnManifest(manifest);
        const errors = result.issues.filter((i) => i.severity === "error");
        expect(errors, JSON.stringify(errors, null, 2)).toEqual([]);
      });

      it("declares the §3 trigger conjunction (providers + agent-delegation)", () => {
        expect(declared.providers).toBe(true);
        expect(declared["agent-delegation"]).toBe(true);
      });

      it("declares at least one tool", () => {
        expect((manifest.tools ?? []).length).toBeGreaterThanOrEqual(1);
      });

      for (const modeId of FAILURE_MODE_IDS) {
        it(`passes ${modeId} (host emits the §7 expected code + audit reason)`, () => {
          const report = runAddOnFailureMode(modeId, annotated);
          // The full FailureModeReport, not just `pass` — a failing
          // report must surface a clear message so the failure mode
          // can be diagnosed.
          expect(report, JSON.stringify(report, null, 2)).toMatchObject({
            modeId,
            pass: true,
          });
          expect(typeof report.expected.code).toBe("string");
          expect(report.actual.code).toBe(report.expected.code);
          const expectedReason = report.expected.auditReason ?? report.expected.code;
          const actualReason = report.actual.auditReason ?? report.actual.code;
          expect(actualReason).toBe(expectedReason);
        });
      }
    });
  }
});
