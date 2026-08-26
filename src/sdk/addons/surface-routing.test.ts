// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import { describe, expect, it } from "vitest";
import type { AddOnInstallation, AddOnManifest, CapabilityGrant } from "../../core/contracts";
import { createDefaultInstallation } from "../../core/defaults";
import { createAddOnRailMenus, createAddOnSurfaceDockRoutes } from "./surface-routing";

const grant = (capability: CapabilityGrant["capability"], granted = false): CapabilityGrant => ({
  capability,
  granted,
  scope: "shared",
  revocationBehavior: "hard-stop",
});

const manifest = (): AddOnManifest => ({
  id: "addon.custom-tool",
  name: "Custom Tool",
  version: "0.1.0",
  author: "test",
  category: "tool",
  description: "test add-on",
  runtimeType: "local-service",
  surfaces: [
    {
      id: "custom-tool-page",
      type: "page",
      label: "Custom Tool",
      description: "Custom tool workspace.",
      shellNavigation: {
        sectionId: "custom-tool",
        dockIcon: "custom-tool",
        eyebrow: "Tool",
        order: 70,
        requiredCapabilities: ["filesystem", "archive-read"],
      },
    },
  ],
  requestedCapabilities: [grant("filesystem"), grant("archive-read")],
  providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
  archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
  health: { strategy: "none" },
  installHooks: {},
  compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
});

const installed = (addon: AddOnManifest, grants: CapabilityGrant[]): AddOnInstallation => ({
  ...createDefaultInstallation(addon, "bundled"),
  installed: true,
  enabled: true,
  status: "enabled",
  grantedCapabilities: grants,
});

describe("add-on surface dock routing", () => {
  it("creates a dock route from an enabled manifest-declared shell surface", () => {
    const addon = manifest();

    const routes = createAddOnSurfaceDockRoutes([addon], {
      [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", true)]),
    });

    expect(routes).toEqual([
      {
        addonId: "addon.custom-tool",
        surfaceId: "custom-tool-page",
        sectionId: "custom-tool",
        label: "Custom Tool",
        eyebrow: "Tool",
        dockIcon: "custom-tool",
        order: 70,
      },
    ]);
  });

  it("hides manifest-declared dock routes until required grants are present", () => {
    const addon = manifest();

    const routes = createAddOnSurfaceDockRoutes([addon], {
      [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", false)]),
    });

    expect(routes).toEqual([]);
  });
});

describe("add-on rail menus", () => {
  const harnessManifest = (): AddOnManifest => ({
    ...manifest(),
    id: "addon.agent-harness",
    name: "Agent Harness",
    category: "agent",
    tools: [
      {
        name: "agent_harness.run",
        description: "Run a task.",
        requiredCapabilities: ["filesystem"],
        inputSchema: {},
        outputSchema: {},
        audit: { logRequest: true, logResult: true, artifactTypes: [] },
        requiresHumanApproval: true,
      },
    ],
    surfaces: [
      {
        id: "agent-harness-workspace",
        type: "embedded-pane",
        label: "Agent Harness Workspace",
        description: "Harness workspace.",
        shellNavigation: {
          sectionId: "agent-harness",
          dockIcon: "harness",
          eyebrow: "Harness",
          order: 10,
          requiredCapabilities: ["filesystem"],
        },
      },
    ],
  });

  const memoryManifest = (): AddOnManifest => ({
    ...manifest(),
    id: "addon.memory-store",
    name: "Memory Store",
    category: "memory",
    surfaces: [
      {
        id: "memory-store-page",
        type: "page",
        label: "Memory Store",
        description: "Memory.",
        shellNavigation: { sectionId: "memory", dockIcon: "memory", eyebrow: "Memory", order: 20 },
      },
    ],
  });

  it("groups agents into harness menus, memory into Memory, tools into Tools", () => {
    const harness = harnessManifest();
    const memory = memoryManifest();
    const tool = manifest();

    const menus = createAddOnRailMenus([harness, memory, tool], {
      [harness.id]: installed(harness, [grant("filesystem", true), grant("archive-read", true)]),
      [memory.id]: installed(memory, [grant("filesystem", true), grant("archive-read", true)]),
      [tool.id]: installed(tool, [grant("filesystem", true), grant("archive-read", true)]),
    });

    expect(menus.map(({ menuId, kind, label, tools }) => ({
      menuId, kind, label, toolCount: tools?.length,
    }))).toEqual([
      { menuId: "agent-harness", kind: "harness", label: "Agent Harness", toolCount: 1 },
      { menuId: "memory", kind: "memory", label: "Memory", toolCount: undefined },
      { menuId: "tools", kind: "tools", label: "Tools", toolCount: undefined },
    ]);
  });

  it("omits a harness menu entirely when its surface capability is not granted", () => {
    const harness = harnessManifest();

    const menus = createAddOnRailMenus([harness], {
      [harness.id]: installed(harness, [grant("filesystem", false), grant("archive-read", true)]),
    });

    expect(menus).toEqual([]);
  });
});
