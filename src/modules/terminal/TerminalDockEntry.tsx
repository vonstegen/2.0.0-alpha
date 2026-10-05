// CP-XH4d: "Terminal" dock entry — a single nav-item that expands into a
// tab strip when selected. The dock sidebar renders this component instead
// of the flat nav-button used for other entries so the terminal surfaces
// appear as tabs (one per surface) with connection badges.
//
// Single source of truth:
//   - Section list comes from `groupSurfaceDockRoutesBySection` (already
//     applied upstream in App.tsx). We accept one `AddOnSurfaceDockSection`
//     and trust that the install + enable + capability-grant + not-hidden
//     gate has already filtered it (CP-XH4b).
//   - Connection state comes from `useTerminalHostStatus` (CP-XH4d), which
//     polls `GET /terminal-host/status`. The hook is opt-in via a fetcher
//     seam so tests can drive deterministic state without a live bridge.
//
// Rendering rules (mirror the prompt's hard bans):
//   - textContent only — no innerHTML, no dangerouslySetInnerHTML.
//   - Labels come from `AddOnSurfaceDockRoute.label`. Badges are literal
//     `Connected` / `Disconnected` / `Not installed` strings.
//   - No secret-shaped value is ever rendered. The shape-walker test in
//     `browser-first/test/terminal-host-status.test.mjs` enforces the wire
//     invariant; this component only ever reads the documented fields.

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";
import type { AddOnSurfaceDockRoute, AddOnSurfaceDockSection } from "../../sdk/addons";
import {
  TerminalSurfaceTabs,
  terminalActiveTabAddonId,
  type TerminalSurfaceStatus,
} from "./TerminalSurfaceTabs";

export interface TerminalDockEntryProps {
  /** Grouped terminal section (always non-empty when rendered). */
  section: AddOnSurfaceDockSection;
  /** Live status payload from `GET /terminal-host/status`. */
  status: TerminalSurfaceStatus | null;
  /** Currently active section id in the host (drives the nav-item active state). */
  activeSectionId: string;
  /** Icon id from the section's first tab (open union). */
  dockIcon: string;
  /** Host navigation callback: switch to the section + surface. */
  onSelectSection: (sectionId: string) => void;
}

const TerminalDockEntry = (props: TerminalDockEntryProps): JSX.Element => {
  const isActive = props.activeSectionId === props.section.sectionId;
  const initialActiveTabAddonId = useMemo(
    () => terminalActiveTabAddonId(props.section, props.status),
    // intentionally empty deps — the initial active tab is the first tab of
    // a stable input; runtime changes are reflected via the badge, not the
    // active tab selection (which is owned by the user's click).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.section.sectionId],
  );
  const [activeTabAddonId, setActiveTabAddonId] = useState<string>(initialActiveTabAddonId);

  const handleTabSelect = useCallback(
    (tab: { sectionId: string; addonId: string; surfaceId: string }) => {
      setActiveTabAddonId(tab.addonId);
      props.onSelectSection(tab.sectionId);
    },
    [props],
  );

  const handleSectionClick = useCallback((): void => {
    props.onSelectSection(props.section.sectionId);
  }, [props]);

  return (
    <div
      className={`terminal-dock-entry ${isActive ? "active" : ""}`}
      data-section-id={props.section.sectionId}
      data-tab-count={props.section.tabs.length}
    >
      <button
        type="button"
        className="nav-item pinned terminal-dock-entry-trigger"
        onClick={handleSectionClick}
        aria-label={props.section.label}
        aria-expanded={isActive}
        aria-controls="terminal-dock-entry-tabs"
        title={`${props.section.label} · ${props.section.eyebrow}`}
      >
        <span className="nav-icon" aria-hidden="true">
          <span className="terminal-dock-entry-icon">{props.dockIcon}</span>
        </span>
        <span className="nav-label">{props.section.label}</span>
        <small>{props.section.eyebrow}</small>
      </button>
      {isActive ? (
        <div id="terminal-dock-entry-tabs" className="terminal-dock-entry-tabs">
          <TerminalSurfaceTabs
            section={props.section}
            status={props.status}
            activeTabAddonId={activeTabAddonId}
            onSelect={handleTabSelect}
            idPrefix="terminal-dock-entry"
          />
        </div>
      ) : null}
    </div>
  );
};

export const tabRouteFromAddonId = (
  section: AddOnSurfaceDockSection,
  addonId: string,
): AddOnSurfaceDockRoute | undefined => section.tabs.find((tab) => tab.addonId === addonId);

export default TerminalDockEntry;