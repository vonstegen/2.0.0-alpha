// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import type {
  AddOnCategory,
  AddOnDockIconName,
  AddOnInstallation,
  AddOnManifest,
  AddOnToolDefinition,
  Capability,
  ShellSectionId,
} from "../../core/contracts";

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

// A rail menu is the top-level entry in the shell's left rail. Harness
// add-ons (category `agent`) each get their own menu named after the add-on;
// memory providers collapse into a single "Memory" menu; every other
// category collapses into a single "Tools" menu. This is the shell's
// category → destination mapping: plugging in a harness lands it as a
// first-class rail destination you open into, rather than a row inside
// "Tools".
export type AddOnRailMenuKind = "harness" | "memory" | "tools";

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
}

const SHELL_MENUS: Record<Exclude<AddOnRailMenuKind, "harness">, { label: string; dockIcon: AddOnDockIconName }> = {
  memory: { label: "Memory", dockIcon: "memory" },
  tools: { label: "Tools", dockIcon: "tool" },
};

const menuKindForCategory = (category: AddOnCategory): AddOnRailMenuKind =>
  category === "agent" ? "harness" : category === "memory" ? "memory" : "tools";

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
    const kind = menuKindForCategory(manifest?.category ?? "tool");
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
