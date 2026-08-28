// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { AddOnAugmentorSkill, AugmentorExtensionDefinition } from "../../core/contracts";
import { toAugmentorExtension } from "../augmentor";
import { validateAddOnManifest } from "./validation";

const loadExample = (fileName: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), "examples", "addons", fileName), "utf8"));

const examples = [
  { file: "addon.augmentor-skill-example.json", kind: "skill" },
  { file: "addon.augmentor-tool-example.json", kind: "tool" },
  { file: "addon.augmentor-connector-example.json", kind: "connector" },
] as const;

describe("Augmentor extension conformance examples", () => {
  for (const example of examples) {
    it(`validates the ${example.kind} example manifest`, () => {
      const manifest = loadExample(example.file);
      const result = validateAddOnManifest(manifest);

      expect(result.issues).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`declares extensionClass/augmentorExtension consistently (${example.kind})`, () => {
      const manifest = loadExample(example.file);
      const extension = manifest.augmentorExtension as AugmentorExtensionDefinition;

      expect(manifest.extensionClass).toBe("augmentor-extension");
      expect(extension.kind).toBe(example.kind);
      // No undeclared authority: required capabilities are a subset of the
      // manifest's requestedCapabilities.
      const requested = (manifest.requestedCapabilities as Array<{ capability: string }>).map(
        (grant) => grant.capability,
      );
      for (const capability of extension.requiredCapabilities) {
        expect(requested).toContain(capability);
      }
      // Every required tool is declared (empty for the connector example).
      const tools = (manifest.tools as Array<{ name: string }> | undefined)?.map((tool) => tool.name) ?? [];
      for (const tool of extension.requiredTools) {
        expect(tools).toContain(tool);
      }
    });
  }

  it("projects a legacy augmentorSkill to the same skill shape", () => {
    const legacy: AddOnAugmentorSkill = {
      documentPath: "docs/architecture/addon-skills/paperclip/AUGMENTOR_SKILL.md",
      objective: "Design and create an approved Paperclip organizational structure.",
      requiredCapabilities: ["archive-read"],
      requiredTools: ["paperclip.plan"],
      workflowPhases: ["survey", "propose"],
      approvalGates: ["human-approval"],
      expectedInputs: ["workspace-tree"],
      expectedOutputs: ["org-plan"],
      producesDelegationPackets: false,
      auditLogRequired: true,
    };

    const extension = toAugmentorExtension(legacy, { id: "addon.paperclip", version: "0.1.0" });
    expect(extension.extensionClass).toBe("augmentor-extension");
    expect(extension.kind).toBe("skill");
    expect(extension.requiredCapabilities).toEqual(["archive-read"]);
    expect(extension.producesDelegationPackets).toBe(false);
    expect(extension.auditLogRequired).toBe(true);
  });
});
