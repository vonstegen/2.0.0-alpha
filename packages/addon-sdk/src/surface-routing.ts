// Intent citation: docs/architecture/ADR-018-addon-sdk-v0.md

import type {
  AddOnDockIconName,
  AddOnInstallation,
  AddOnManifest,
  Capability,
  HarnessRegistryProjection,
  ShellSectionId,
} from "../../../src/core/contracts";

export interface AddOnSurfaceDockRoute {
  addonId: string;
  surfaceId: string;
  sectionId: ShellSectionId;
  label: string;
  eyebrow: string;
  dockIcon: AddOnDockIconName;
  order: number;
}

const hasGrantedCapability = (installation: HarnessRegistryProjection["installations"][string], capability: Capability): boolean =>
  installation.grantedCapabilities.some((grant) => grant.capability === capability && grant.granted);

/**
 * The installations argument is retained for signature compatibility and is not consulted.
 * The host projection is the sole authority; a missing projection yields no dock routes.
 */
export const createAddOnSurfaceDockRoutes = (
  manifests: AddOnManifest[],
  _installations: Record<string, AddOnInstallation>,
  projection?: HarnessRegistryProjection | null,
): AddOnSurfaceDockRoute[] =>
  [...new Map([...manifests, ...(projection?.candidates ?? [])].map(manifest => [manifest.id, manifest])).values()]
    .flatMap((manifest) => {
      const installation = projection?.installations[manifest.id];
      if (!installation?.installed || !installation.enabled) {
        return [];
      }

      if (manifest.systemSlots?.length && !manifest.systemSlots.some(({ id }) =>
        projection?.slots[id]?.available && projection.slots[id]?.addonId === manifest.id)) {
        return [];
      }

      return manifest.surfaces.flatMap((surface): AddOnSurfaceDockRoute[] => {
        const navigation = surface.shellNavigation;
        if (!navigation || installation.hiddenSurfaceIds.includes(surface.id)) {
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

export interface AddOnToolPanelRoute {
  addonId: string;
  surfaceId: string;
  label: string;
  icon: string;
  order: number;
  requiredCapabilities: Capability[];
}

const granted = (installation: HarnessRegistryProjection["installations"][string] | undefined, capability: Capability): boolean =>
  Boolean(installation?.grantedCapabilities.some((grant) => grant.capability === capability && grant.granted));

/**
 * Dynamic right-rail discovery: a tool-panel surface becomes a rail entry only
 * when its add-on is installed + enabled and the host has granted every
 * capability the surface declares. Classification alone never creates an entry;
 * the manifest must still explicitly request the surface, and the host must
 * still validate/grant/authorize it. No add-on id is hard-coded.
 */
export const createAddOnToolPanelRoutes = (
  manifests: AddOnManifest[],
  projection?: HarnessRegistryProjection | null,
): AddOnToolPanelRoute[] => {
  const byId = new Map([...manifests, ...(projection?.candidates ?? [])].map((manifest) => [manifest.id, manifest]));
  const routes: AddOnToolPanelRoute[] = [];
  for (const manifest of byId.values()) {
    const installation = projection?.installations[manifest.id];
    if (!installation?.installed || !installation.enabled) continue;
    for (const surface of manifest.surfaces) {
      if (surface.type !== "tool-panel") continue;
      if (installation.hiddenSurfaceIds.includes(surface.id)) continue;
      const required = surface.requiredCapabilities ?? [];
      if (required.some((capability) => !granted(installation, capability))) continue;
      routes.push({
        addonId: manifest.id,
        surfaceId: surface.id,
        label: surface.label || manifest.name,
        icon: surface.icon ?? "",
        order: typeof surface.shellNavigation?.order === "number" ? surface.shellNavigation.order : 1000,
        requiredCapabilities: [...required],
      });
    }
  }
  return routes.sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
};
