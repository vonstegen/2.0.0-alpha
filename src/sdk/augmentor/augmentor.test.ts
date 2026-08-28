// Intent citation: docs/architecture/resonantos-browser-architecture/04-augmentor-extension-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import type { AddOnAugmentorSkill } from "../../core/contracts";
import type { ScopedCapability } from "../authority";
import {
  AUGMENTOR_NON_AUTHORITY_RULE,
  effectiveCapabilities,
  toAugmentorExtension,
} from "./index";

function grantFor(action: ScopedCapability["action"]): ScopedCapability {
  return {
    action,
    resourceSelectors: ["/workspace/project-a"],
    operations: ["read"],
    taskId: "task-1",
    delegationId: "del-1",
    issuerPrincipalId: "user-1",
    subjectPrincipalId: "augmentor-1",
    notBefore: "2026-08-27T00:00:00Z",
    expiresAt: "2026-08-27T12:00:00Z",
    revocationBehavior: "cancel",
  };
}

const skill = (): AddOnAugmentorSkill => ({
  documentPath: "docs/architecture/addon-skills/paperclip/AUGMENTOR_SKILL.md",
  objective: "Design and approve a Paperclip organization.",
  requiredCapabilities: ["archive-read", "archive-intake-write"],
  requiredTools: ["paperclip.plan", "paperclip.apply"],
  workflowPhases: ["survey", "propose", "apply"],
  approvalGates: ["human-approval"],
  expectedInputs: ["workspace-tree"],
  expectedOutputs: ["org-plan"],
  producesDelegationPackets: true,
  auditLogRequired: true,
});

describe("Augmentor extension contracts", () => {
  it("computes the effective capability set as the grant/request intersection", () => {
    const grant = [grantFor("archive-read")];
    const result = effectiveCapabilities(grant, ["archive-read", "archive-intake-write"]);
    expect(result).toEqual(["archive-read"]);
  });

  it("never widens: a declared capability outside the grant is dropped", () => {
    const result = effectiveCapabilities([], ["archive-read", "network"]);
    expect(result).toEqual([]);
  });

  it("preserves the non-authority rule", () => {
    expect(AUGMENTOR_NON_AUTHORITY_RULE).toContain("Core governs");
    expect(AUGMENTOR_NON_AUTHORITY_RULE).toContain("requests, never grants");
  });

  it("projects an existing augmentorSkill to a kind:skill extension without adding permissions", () => {
    const extension = toAugmentorExtension(skill(), { id: "addon.paperclip", version: "0.1.0" });

    expect(extension.extensionClass).toBe("augmentor-extension");
    expect(extension.kind).toBe("skill");
    expect(extension.id).toBe("addon.paperclip:docs-architecture-addon-skills-paperclip-augmentor-skill-md");
    expect(extension.version).toBe("0.1.0");
    // No new authority: the declared set is carried verbatim.
    expect(extension.requiredCapabilities).toEqual(["archive-read", "archive-intake-write"]);
    expect(extension.requiredTools).toEqual(["paperclip.plan", "paperclip.apply"]);
    expect(extension.workflowPhases).toEqual(["survey", "propose", "apply"]);
    expect(extension.approvalGates).toEqual(["human-approval"]);
    expect(extension.contextPolicy.read).toEqual([skill().documentPath]);
    expect(extension.contextPolicy.write).toEqual([]);
    expect(extension.producesDelegationPackets).toBe(true);
    expect(extension.auditLogRequired).toBe(true);
  });

  it("derives a deterministic id for any documentPath", () => {
    const a = toAugmentorExtension(skill(), { id: "addon.x", version: "0.1.0" });
    const b = toAugmentorExtension(skill(), { id: "addon.x", version: "0.1.0" });
    expect(a.id).toBe(b.id);
  });
});
