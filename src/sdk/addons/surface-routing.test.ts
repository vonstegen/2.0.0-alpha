// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import { describe, expect, it } from "vitest";
import type { AddOnInstallation, AddOnManifest, CapabilityGrant } from "../../core/contracts";
import { createHarnessClient, type HarnessProjection } from "../../core/harness-client";
import { createDefaultInstallation } from "../../core/defaults";
import { createAddOnSurfaceDockRoutes, groupSurfaceDockRoutesBySection } from "./surface-routing";

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
  archiveIntegration: {
    readScopes: [],
    intakeWriteScopes: [],
    canRequestIngest: false,
    canWriteKnowledgePages: false,
  },
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

const projected = (addon: AddOnManifest, hiddenSurfaceIds: string[] = []): HarnessProjection => {
  const client = createHarnessClient();
  client.applySnapshot({
    bootEpoch: "surfaces",
    revision: 1,
    governanceActivated: true,
    candidates: [addon],
    installations: {
      [addon.id]: {
        addonId: addon.id,
        installed: true,
        enabled: true,
        grantedCapabilities: addon.requestedCapabilities.map((grant) => ({
          ...grant,
          granted: true,
        })),
        disabledOperations: [],
        hiddenSurfaceIds,
      },
    },
    slots: {},
  });
  return client.getSnapshot()!;
};

describe("add-on surface dock routing", () => {
  it("creates a dock route from an enabled manifest-declared shell surface", () => {
    const addon = manifest();

    const routes = createAddOnSurfaceDockRoutes(
      [addon],
      {
        [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", true)]),
      },
      projected(addon),
    );

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

  it("surfaces and labels agree with projected governance despite forged local state", () => {
    const addon = {
      ...manifest(),
      systemSlots: [
        { id: "memory-system" as const, role: "default-provider" as const, replaceable: true },
      ],
    };
    const local = {
      [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", true)]),
    };
    const projection = projected(addon);
    const owned = {
      ...projection,
      slots: { "memory-system": { addonId: addon.id, generation: 1, available: true } },
    };
    expect(createAddOnSurfaceDockRoutes([addon], local, owned)).toHaveLength(1);
    expect(
      createAddOnSurfaceDockRoutes([addon], local, {
        ...owned,
        installations: {
          [addon.id]: {
            ...owned.installations[addon.id],
            hiddenSurfaceIds: [addon.surfaces[0].id],
          },
        },
      }),
    ).toEqual([]);
    expect(createAddOnSurfaceDockRoutes([addon], local, projection)).toEqual([]);
    expect(createAddOnSurfaceDockRoutes([addon], local, null)).toEqual([]);
  });

  it("hides manifest-declared dock routes until required grants are present", () => {
    const addon = manifest();

    const routes = createAddOnSurfaceDockRoutes(
      [addon],
      {
        [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", false)]),
      },
      {
        ...projected(addon),
        installations: {
          [addon.id]: {
            ...projected(addon).installations[addon.id],
            grantedCapabilities: [grant("filesystem", true), grant("archive-read", false)],
          },
        },
      },
    );

    expect(routes).toEqual([]);
  });

  it("routes host-only candidates with projected labels and ignores stale local installation fields", () => {
    const addon = manifest();
    const projection = projected(addon);
    expect(createAddOnSurfaceDockRoutes([], {}, projection)).toHaveLength(1);
    const stale = {
      ...addon,
      name: "Stale name",
      surfaces: [{ ...addon.surfaces[0], label: "Stale label" }],
    };
    expect(createAddOnSurfaceDockRoutes([stale], {}, projection)[0].label).toBe("Custom Tool");
    for (const denied of [
      { installed: false },
      { enabled: false },
      { hiddenSurfaceIds: [addon.surfaces[0].id] },
    ]) {
      expect(
        createAddOnSurfaceDockRoutes(
          [addon],
          {
            [addon.id]: installed(addon, [grant("filesystem", true), grant("archive-read", true)]),
          },
          {
            ...projection,
            installations: { [addon.id]: { ...projection.installations[addon.id], ...denied } },
          },
        ),
      ).toEqual([]);
    }
  });
});

describe("add-on surface dock section grouping", () => {
  const terminalRoute = (addonId: string, surfaceId: string, label: string, order: number) => ({
    addonId,
    surfaceId,
    sectionId: "terminal",
    label,
    eyebrow: "Terminal",
    dockIcon: "terminal",
    order,
  });

  it("groups multiple routes sharing a sectionId into one section with tabs", () => {
    const sections = groupSurfaceDockRoutesBySection([
      terminalRoute(
        "addon.resonant-terminal-ghostty",
        "ghostty-terminal-host",
        "Ghostty Terminal Host",
        50,
      ),
      terminalRoute(
        "addon.resonant-terminal-iterm2",
        "iterm2-terminal-host",
        "iTerm2 Terminal Host",
        51,
      ),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].sectionId).toBe("terminal");
    expect(sections[0].label).toBe("Ghostty Terminal Host");
    expect(sections[0].eyebrow).toBe("Terminal");
    expect(sections[0].tabs.map((tab) => tab.label)).toEqual([
      "Ghostty Terminal Host",
      "iTerm2 Terminal Host",
    ]);
  });

  it("yields a single-tab section for a lone surface", () => {
    const sections = groupSurfaceDockRoutesBySection([
      terminalRoute(
        "addon.resonant-terminal-ghostty",
        "ghostty-terminal-host",
        "Ghostty Terminal Host",
        50,
      ),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].tabs).toHaveLength(1);
  });

  it("returns an empty list for no routes", () => {
    expect(groupSurfaceDockRoutesBySection([])).toEqual([]);
  });

  it("preserves the caller's order within a section and across sections (deterministic, pure)", () => {
    // The helper does NOT sort on its own — `createAddOnSurfaceDockRoutes`
    // is the single source of order/label tiebreak via Array.prototype.sort.
    // The helper preserves the input order, so callers that sort upstream
    // get a stable, deterministic section + tab list.
    const sorted = [
      terminalRoute("addon.a", "a-surface", "Alpha Surface", 100),
      terminalRoute("addon.z", "z-surface", "Zulu Surface", 100),
      terminalRoute("addon.b", "b-surface", "Bravo Surface", 200),
    ];
    const sections = groupSurfaceDockRoutesBySection(sorted);

    expect(sections.map((section) => section.sectionId)).toEqual(["terminal"]);
    expect(sections[0].tabs.map((tab) => tab.label)).toEqual([
      "Alpha Surface",
      "Zulu Surface",
      "Bravo Surface",
    ]);
    // Two distinct sections: each preserves input order; the first route
    // wins the section-level label/eyebrow/order.
    const sectionsWithTwoGroups = groupSurfaceDockRoutesBySection([
      {
        addonId: "addon.b",
        surfaceId: "b",
        sectionId: "settings",
        label: "Settings Tool",
        eyebrow: "Settings",
        dockIcon: "settings",
        order: 50,
      },
      terminalRoute("addon.a", "a", "Alpha", 100),
    ]);
    expect(sectionsWithTwoGroups.map((section) => section.sectionId)).toEqual([
      "settings",
      "terminal",
    ]);
    expect(sectionsWithTwoGroups[0].label).toBe("Settings Tool");
    expect(sectionsWithTwoGroups[0].eyebrow).toBe("Settings");
    expect(sectionsWithTwoGroups[1].label).toBe("Alpha");
  });
});

describe("terminal-host catalog registration gate", () => {
  // CP-XH4b: the host catalog exposes the bundled manifests to
  // createAddOnSurfaceDockRoutes. The gate semantics (install + enable +
  // requiredCapabilities granted + not hidden) must drop terminal surfaces
  // until every condition is met.
  const terminalManifest = (addonId: string, surfaceId: string): AddOnManifest => ({
    id: addonId,
    name: `Resonant ${addonId}`,
    version: "0.1.0",
    author: "ResonantOS",
    category: "integration",
    description: "Terminal host reference add-on.",
    runtimeType: "local-service",
    surfaces: [
      {
        id: surfaceId,
        type: "panel",
        label: `${addonId} terminal host`,
        description: "Manage terminal sessions from ResonantOS.",
        shellNavigation: {
          sectionId: "terminal",
          dockIcon: "terminal",
          eyebrow: "Terminal",
          requiredCapabilities: ["terminal-host"],
        },
      },
    ],
    requestedCapabilities: [grant("terminal-host")],
    providerRequirements: { sharedProfiles: [], supportsPrivateCredentials: false },
    archiveIntegration: { readScopes: [], intakeWriteScopes: [], canRequestIngest: false, canWriteKnowledgePages: false },
    health: { strategy: "none" },
    installHooks: {},
    compatibility: { shellVersion: "^0.1.0", platforms: ["macOS"] },
  });

  const ghosttyManifest = terminalManifest("addon.resonant-terminal-ghostty", "ghostty-terminal-host");
  const iterm2Manifest = terminalManifest("addon.resonant-terminal-iterm2", "iterm2-terminal-host");

  const projectedState = (
    manifests: AddOnManifest[],
    installedAddonIds: Set<string>,
    enabledAddonIds: Set<string>,
    grantedCapabilities: Record<string, CapabilityGrant[]>,
    hiddenSurfaceIds: Record<string, string[]> = {},
  ): HarnessProjection => {
    const client = createHarnessClient();
    client.applySnapshot({
      bootEpoch: "terminal-host-xh4",
      revision: 1,
      governanceActivated: true,
      candidates: manifests,
      installations: Object.fromEntries(
        manifests.map((m) => [
          m.id,
          {
            addonId: m.id,
            installed: installedAddonIds.has(m.id),
            enabled: enabledAddonIds.has(m.id),
            grantedCapabilities: grantedCapabilities[m.id] ?? [],
            disabledOperations: [],
            hiddenSurfaceIds: hiddenSurfaceIds[m.id] ?? [],
          },
        ]),
      ),
      slots: {},
    });
    return client.getSnapshot()!;
  };

  it("emits no terminal routes before install + enable + grant", () => {
    const projection = projectedState(
      [ghosttyManifest, iterm2Manifest],
      new Set(),
      new Set(),
      { "addon.resonant-terminal-ghostty": [grant("terminal-host", false)], "addon.resonant-terminal-iterm2": [grant("terminal-host", false)] },
    );
    const routes = createAddOnSurfaceDockRoutes([ghosttyManifest, iterm2Manifest], {}, projection);
    expect(routes).toEqual([]);
  });

  it("emits grouped terminal routes after install + enable + grant", () => {
    const projection = projectedState(
      [ghosttyManifest, iterm2Manifest],
      new Set(["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]),
      new Set(["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]),
      {
        "addon.resonant-terminal-ghostty": [grant("terminal-host", true)],
        "addon.resonant-terminal-iterm2": [grant("terminal-host", true)],
      },
    );
    const routes = createAddOnSurfaceDockRoutes([ghosttyManifest, iterm2Manifest], {}, projection);
    const sections = groupSurfaceDockRoutesBySection(routes);
    expect(sections.map((s) => s.sectionId)).toEqual(["terminal"]);
    expect(sections[0].tabs.map((t) => t.surfaceId).sort()).toEqual([
      "ghostty-terminal-host",
      "iterm2-terminal-host",
    ]);
  });

  it("hides routes on hiddenSurfaceIds or ungranted terminal-host capability", () => {
    for (const denied of [
      { hiddenSurfaceIds: { "addon.resonant-terminal-ghostty": ["ghostty-terminal-host"] } },
      { ungranted: { "addon.resonant-terminal-ghostty": [grant("terminal-host", false)] } },
    ]) {
      const projection = projectedState(
        [ghosttyManifest, iterm2Manifest],
        new Set(["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]),
        new Set(["addon.resonant-terminal-ghostty", "addon.resonant-terminal-iterm2"]),
        denied.ungranted ?? {
          "addon.resonant-terminal-ghostty": [grant("terminal-host", true)],
          "addon.resonant-terminal-iterm2": [grant("terminal-host", true)],
        },
        denied.hiddenSurfaceIds ?? {},
      );
      const routes = createAddOnSurfaceDockRoutes([ghosttyManifest, iterm2Manifest], {}, projection);
      const ghosttyRoutes = routes.filter((r) => r.surfaceId === "ghostty-terminal-host");
      expect(ghosttyRoutes).toEqual([]);
    }
  });
});
