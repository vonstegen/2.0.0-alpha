// CP-XH4d: tabbed "Terminal" dock entry.
//
// Renders the grouped `sectionId === "terminal"` AddOnSurfaceDockSection as a
// dock entry with one tab per surface (Ghostty, iTerm2, ...) and a
// non-secret connection badge per tab. The badge string is one of the three
// literals — `Connected`, `Disconnected`, `Not installed` — derived from
// the live `/terminal-host/status` projection (CP-XH4c).
//
// Hard rules:
//   - textContent rendering only (no innerHTML, dangerouslySetInnerHTML, script
//     injection). Labels come from `AddOnSurfaceDockRoute.label` and the
//     badge strings are fixed literals.
//   - The host never hard-codes ghostty/iterm2 ids; the section + tab list
//     flows in via props from `groupSurfaceDockRoutesBySection`.
//   - No secret-shaped string is read from the status payload. The shape-
//     walker test (browser-first/test/terminal-host-status.test.mjs +
//     `assertNoSecretShapedValue`) guards every string the renderer touches.

import type { JSX } from "react";
import type { AddOnSurfaceDockSection } from "../../sdk/addons";

export type TerminalSurfaceStatus = {
  connected: boolean;
  driveId: string | null;
  surfaces: ReadonlyArray<{
    adapterId: string;
    label: string;
    compatible: boolean;
    connected: boolean;
  }>;
  sessions: ReadonlyArray<unknown>;
};

export type TerminalBadgeLabel = "Connected" | "Disconnected" | "Not installed";

export const TERMINAL_BADGE_LABEL: Record<TerminalBadgeLabel, TerminalBadgeLabel> = {
  Connected: "Connected",
  Disconnected: "Disconnected",
  "Not installed": "Not installed",
};

/**
 * Pure badge mapper: derive the badge label for a single tab given the
 * live `/terminal-host/status` payload. Authorization, install, enable, and
 * not-hidden are enforced upstream by `createAddOnSurfaceDockRoutes`; the
 * renderer only needs to translate the wire-state into the visible label.
 */
export const terminalBadgeForTab = (
  tabAddonId: string,
  status: TerminalSurfaceStatus | null,
): TerminalBadgeLabel => {
  if (!status) return "Not installed";
  const surface = status.surfaces.find((entry) => entry.adapterId === tabAddonId);
  if (!surface) return "Not installed";
  if (!surface.compatible) return "Not installed";
  return surface.connected ? "Connected" : "Disconnected";
};

/**
 * Pure active-tab resolver: the active tab is the surface reporting
 * `connected === true`. Falls back to the first tab when nothing is
 * connected. Returns the active tab's addonId so callers can pass it back
 * to `setSection({ sectionId, surfaceId })`.
 */
export const terminalActiveTabAddonId = (
  section: AddOnSurfaceDockSection,
  status: TerminalSurfaceStatus | null,
): string => {
  if (status) {
    const connectedSurface = status.surfaces.find(
      (entry) => entry.compatible && entry.connected,
    );
    if (connectedSurface) {
      const match = section.tabs.find((tab) => tab.addonId === connectedSurface.adapterId);
      if (match) return match.addonId;
    }
  }
  return section.tabs[0]?.addonId ?? "";
};

export type TerminalSurfaceTabsProps = {
  /** Grouped terminal section (always contains at least one tab when rendered). */
  section: AddOnSurfaceDockSection;
  /** Live status payload from `GET /terminal-host/status` (CP-XH4c). */
  status: TerminalSurfaceStatus | null;
  /** Currently selected addonId within the section; rendered as active. */
  activeTabAddonId: string;
  /**
   * Selection callback. Receives the section + tab identifiers so the host
   * can route to the matching workspace. The host passes them through to
   * its `setSection(sectionId)` and remembers the active tab.
   */
  onSelect: (tab: { sectionId: string; addonId: string; surfaceId: string }) => void;
  /**
   * Optional stable id prefix used for `key` / `aria-controls` to avoid
   * collisions with other dock entries. Defaults to "terminal-section".
   */
  idPrefix?: string;
};

export const TerminalSurfaceTabs = (props: TerminalSurfaceTabsProps): JSX.Element => {
  const idPrefix = props.idPrefix ?? "terminal-section";
  const activeId = props.activeTabAddonId || terminalActiveTabAddonId(props.section, props.status);
  return (
    <div className="terminal-tab-strip" aria-label="Terminal surfaces">
      {props.section.tabs.map((tab) => {
        const badge = terminalBadgeForTab(tab.addonId, props.status);
        const isActive = tab.addonId === activeId;
        const buttonId = `${idPrefix}-tab-${tab.surfaceId}`;
        return (
          <button
            key={tab.surfaceId}
            id={buttonId}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${idPrefix}-panel-${tab.surfaceId}`}
            className={`terminal-tab ${isActive ? "active" : ""}`}
            onClick={() =>
              props.onSelect({
                sectionId: tab.sectionId,
                addonId: tab.addonId,
                surfaceId: tab.surfaceId,
              })
            }
          >
            <span className="terminal-tab-label">{tab.label}</span>
            <span className={`terminal-tab-badge terminal-tab-badge-${badge.replace(/\s+/g, "-").toLowerCase()}`}>
              {badge}
            </span>
          </button>
        );
      })}
    </div>
  );
};