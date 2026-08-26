// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import type {
  AddOnDockIconName,
  AddOnInstallation,
  AddOnManifest,
  AddOnToolDefinition,
  Capability,
  ShellSectionId,
} from "../../core/contracts";
import { G0_HARNESS_TOOL_CATALOG, railMenuKindForCategory } from "./architecture";
import type { AddOnRailMenuKind } from "./architecture";

export interface AddOnSurfaceDockRoute {
  addonId: string;
  surfaceId: string;
  sectionId: ShellSectionId;
  label: string;
  eyebrow: string;
  dockIcon: AddOnDockIconName;
  order: number;
}

const hasGrantedCapability = (installation: AddOnInstallation, capability: Capability): boolean =>
  installation.grantedCapabilities.some((grant) => grant.capability === capability && grant.granted);

export const createAddOnSurfaceDockRoutes = (
  manifests: AddOnManifest[],
  installations: Record<string, AddOnInstallation>,
): AddOnSurfaceDockRoute[] =>
  manifests
    .flatMap((manifest) => {
      const installation = installations[manifest.id];
      if (!installation?.installed || !installation.enabled) {
        return [];
      }

      return manifest.surfaces.flatMap((surface): AddOnSurfaceDockRoute[] => {
        const navigation = surface.shellNavigation;
        if (!navigation) {
          return [];
        }
        const missingCapability = (navigation.requiredCapabilities ?? []).find(
          (capability) => !hasGrantedCapability(installation, capability),
        );
        if (missingCapability) {
          return [];
        }

        return [
          {
            addonId: manifest.id,
            surfaceId: surface.id,
            sectionId: navigation.sectionId,
            label: surface.label || manifest.name,
            eyebrow: navigation.eyebrow,
            dockIcon: navigation.dockIcon,
            order: navigation.order ?? 1000,
          },
        ];
      });
    })
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));

// The category → rail-destination mapping lives in architecture.ts
// (ADDON_CATEGORY_BLUEPRINT / railMenuKindForCategory).

export interface AddOnRailMenu {
  menuId: string;
  kind: AddOnRailMenuKind;
  label: string;
  dockIcon: AddOnDockIconName;
  order: number;
  routes: AddOnSurfaceDockRoute[];
  // Harness menus only: the add-on's bridge-dispatched tools, rendered as a
  // sub-rail inside the harness workspace.
  tools?: AddOnToolDefinition[];
  // ROS Harness menu only: the fused core's own tool loop, with superseded
  // markers when an installed add-on covers a native tool.
  nativeTools?: NativeToolRailEntry[];
}

const SHELL_MENUS: Record<Exclude<AddOnRailMenuKind, "harness">, { label: string; dockIcon: AddOnDockIconName }> = {
  memory: { label: "Memory", dockIcon: "memory" },
  tools: { label: "Tools", dockIcon: "tool" },
};

const byOrderThenLabel = <T extends { order: number; label: string }>(left: T, right: T): number =>
  left.order - right.order || left.label.localeCompare(right.label);

export const createAddOnRailMenus = (
  manifests: AddOnManifest[],
  installations: Record<string, AddOnInstallation>,
): AddOnRailMenu[] => {
  const manifestById = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const routes = createAddOnSurfaceDockRoutes(manifests, installations);

  const groups = new Map<string, {
    kind: AddOnRailMenuKind;
    label: string;
    dockIcon: AddOnDockIconName;
    order: number;
    routes: AddOnSurfaceDockRoute[];
    tools?: AddOnToolDefinition[];
  }>();

  for (const route of routes) {
    const manifest = manifestById.get(route.addonId);
    const kind = railMenuKindForCategory(manifest?.category ?? "tool");
    const key = kind === "harness" ? route.addonId : kind;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind,
        label: kind === "harness" ? (manifest?.name ?? route.label) : SHELL_MENUS[kind].label,
        dockIcon: kind === "harness" ? route.dockIcon : SHELL_MENUS[kind].dockIcon,
        order: route.order,
        routes: [],
        tools: kind === "harness" ? manifest?.tools : undefined,
      };
      groups.set(key, group);
    }
    group.order = Math.min(group.order, route.order);
    group.routes.push(route);
  }

  return [...groups.values()]
    .map((group) => ({
      menuId: group.kind === "harness" ? group.routes[0].sectionId : group.kind,
      kind: group.kind,
      label: group.label,
      dockIcon: group.dockIcon,
      order: group.order,
      routes: group.routes.sort(byOrderThenLabel),
      tools: group.tools,
    }))
    .sort(byOrderThenLabel);
};

// ---- ROS Harness (fused-core) rail menu -------------------------------------
// The G0 harness is the shell's own integrated harness (fused, non-removable),
// not an add-on. It ships a minimal tool loop (G0_HARNESS_TOOL_CATALOG). When an
// installed add-on declares a tool that `coversNativeTool` (an equivalent to a
// G0 tool), that G0 tool is flagged `supersededBy` so the rail can gray it out.

export const ROS_HARNESS_MENU_ID = "ros-harness";

export interface NativeToolSupersede {
  addonId: string;
  toolName: string;
}

export interface NativeToolRailEntry {
  name: string;
  description: string;
  domain: string;
  supersededBy?: NativeToolSupersede;
}

export const createRosHarnessMenu = (
  manifests: AddOnManifest[],
  installations: Record<string, AddOnInstallation>,
): AddOnRailMenu => {
  const supersedeByNativeTool = new Map<string, NativeToolSupersede>();
  for (const manifest of manifests) {
    const installation = installations[manifest.id];
    if (!installation?.installed || !installation.enabled) {
      continue;
    }
    for (const tool of manifest.tools ?? []) {
      if (tool.coversNativeTool && !supersedeByNativeTool.has(tool.coversNativeTool)) {
        supersedeByNativeTool.set(tool.coversNativeTool, {
          addonId: manifest.id,
          toolName: tool.name,
        });
      }
    }
  }

  return {
    menuId: ROS_HARNESS_MENU_ID,
    kind: "harness",
    label: "ROS Harness",
    dockIcon: "harness",
    order: 0,
    routes: [],
    nativeTools: G0_HARNESS_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      description: tool.description,
      domain: tool.domain,
      supersededBy: supersedeByNativeTool.get(tool.name),
    })),
  };
};

export const createShellRailMenus = (
  manifests: AddOnManifest[],
  installations: Record<string, AddOnInstallation>,
): AddOnRailMenu[] => [
  createRosHarnessMenu(manifests, installations),
  ...createAddOnRailMenus(manifests, installations),
];
