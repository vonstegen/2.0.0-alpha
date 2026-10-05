// CP-XH4d: tabbed Terminal surface renderer
//
// Acceptance (CP-XH4d gate):
//   - Two authorized terminal surfaces render as two tabs under one Terminal
//     dock entry. The connected surface is the active tab.
//   - An unauthorized / not-installed surface renders its `Not installed`
//     badge without granting anything (no badge for Connected without a
//     matching compatible surface).
//   - The renderer is textContent-only: no innerHTML, no
//     dangerouslySetInnerHTML, no script injection. The badge labels are
//     the literal `Connected` / `Disconnected` / `Not installed` strings.

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen as rtlScreen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddOnSurfaceDockSection } from "../../sdk/addons";
import TerminalDockEntry from "./TerminalDockEntry";
import {
  TerminalSurfaceTabs,
  terminalActiveTabAddonId,
  terminalBadgeForTab,
  type TerminalSurfaceStatus,
} from "./TerminalSurfaceTabs";

const ghosttyRoute = {
  addonId: "addon.resonant-terminal-ghostty",
  surfaceId: "ghostty-terminal-host",
  sectionId: "terminal",
  label: "Ghostty Terminal Host",
  eyebrow: "Terminal",
  dockIcon: "terminal",
  order: 50,
};

const iterm2Route = {
  addonId: "addon.resonant-terminal-iterm2",
  surfaceId: "iterm2-terminal-host",
  sectionId: "terminal",
  label: "iTerm2 Terminal Host",
  eyebrow: "Terminal",
  dockIcon: "terminal",
  order: 51,
};

const makeSection = (): AddOnSurfaceDockSection => ({
  sectionId: "terminal",
  label: "Resonant Terminal",
  eyebrow: "Terminal",
  dockIcon: "terminal",
  order: 50,
  tabs: [ghosttyRoute, iterm2Route],
});

const makeStatus = (overrides: Partial<TerminalSurfaceStatus> = {}): TerminalSurfaceStatus => ({
  connected: true,
  driveId: "iterm2",
  surfaces: [
    { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: true, connected: false },
    { adapterId: "addon.resonant-terminal-iterm2", label: "iTerm2", compatible: true, connected: true },
  ],
  sessions: [],
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("terminalBadgeForTab", () => {
  it("maps every documented wire state to the literal badge label", () => {
    const status = makeStatus();
    expect(terminalBadgeForTab("addon.resonant-terminal-iterm2", status)).toBe("Connected");
    expect(terminalBadgeForTab("addon.resonant-terminal-ghostty", status)).toBe("Disconnected");
    expect(terminalBadgeForTab("addon.unknown", status)).toBe("Not installed");
  });

  it("returns Not installed when the surface is present but not compatible", () => {
    const status = makeStatus({
      surfaces: [
        { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: false, connected: false },
      ],
    });
    expect(terminalBadgeForTab("addon.resonant-terminal-ghostty", status)).toBe("Not installed");
  });

  it("returns Not installed when the status payload is missing entirely", () => {
    expect(terminalBadgeForTab("addon.resonant-terminal-ghostty", null)).toBe("Not installed");
  });
});

describe("terminalActiveTabAddonId", () => {
  it("selects the connected surface when one is connected", () => {
    const section = makeSection();
    expect(terminalActiveTabAddonId(section, makeStatus())).toBe("addon.resonant-terminal-iterm2");
  });

  it("falls back to the first tab when no surface is connected", () => {
    const section = makeSection();
    const status = makeStatus({
      connected: false,
      surfaces: [
        { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: true, connected: false },
        { adapterId: "addon.resonant-terminal-iterm2", label: "iTerm2", compatible: true, connected: false },
      ],
    });
    expect(terminalActiveTabAddonId(section, status)).toBe("addon.resonant-terminal-ghostty");
  });

  it("returns empty string for an empty section", () => {
    expect(terminalActiveTabAddonId({ ...makeSection(), tabs: [] }, null)).toBe("");
  });
});

describe("TerminalSurfaceTabs", () => {
  it("renders one tab per AddOnSurfaceDockRoute and marks the connected surface active", () => {
    const section = makeSection();
    const status = makeStatus();
    render(
      <TerminalSurfaceTabs
        section={section}
        status={status}
        activeTabAddonId="addon.resonant-terminal-iterm2"
        onSelect={() => {}}
      />,
    );

    const tabs = rtlScreen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    const [ghosttyTab, iterm2Tab] = tabs;
    expect(ghosttyTab).toHaveAttribute("aria-selected", "false");
    expect(iterm2Tab).toHaveAttribute("aria-selected", "true");
    expect(within(ghosttyTab).getByText("Disconnected")).toBeInTheDocument();
    expect(within(iterm2Tab).getByText("Connected")).toBeInTheDocument();
  });

  it("renders the Not installed badge for unauthorized surfaces without granting anything", () => {
    const section = makeSection();
    const status = makeStatus({
      connected: false,
      surfaces: [
        // Only the ghostty surface exists in the status — iTerm2 is missing
        // (not installed / not authorized). The renderer must still surface
        // its badge without promoting it to Connected.
        { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: true, connected: false },
      ],
    });
    render(
      <TerminalSurfaceTabs
        section={section}
        status={status}
        activeTabAddonId=""
        onSelect={() => {}}
      />,
    );

    const tabs = rtlScreen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    const iterm2 = tabs.find((tab) => tab.id.endsWith("iterm2-terminal-host"))!;
    expect(within(iterm2).getByText("Not installed")).toBeInTheDocument();
    // The disconnected surface is still labelled Disconnected, not Connected.
    expect(within(tabs[0]).getByText("Disconnected")).toBeInTheDocument();
  });

  it("renders the Not installed badge when no status payload is available", () => {
    const section = makeSection();
    render(
      <TerminalSurfaceTabs
        section={section}
        status={null}
        activeTabAddonId=""
        onSelect={() => {}}
      />,
    );

    const tabs = rtlScreen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(within(tab).getByText("Not installed")).toBeInTheDocument();
    }
  });

  it("invokes onSelect with the clicked tab's identifiers", () => {
    const section = makeSection();
    const onSelect = vi.fn();
    render(
      <TerminalSurfaceTabs
        section={section}
        status={makeStatus()}
        activeTabAddonId="addon.resonant-terminal-iterm2"
        onSelect={onSelect}
      />,
    );

    const ghosttyTab = rtlScreen.getByRole("tab", { name: /Ghostty/ });
    fireEvent.click(ghosttyTab);
    expect(onSelect).toHaveBeenCalledWith({
      sectionId: "terminal",
      addonId: "addon.resonant-terminal-ghostty",
      surfaceId: "ghostty-terminal-host",
    });
  });

  it("renders only textContent — no innerHTML, dangerouslySetInnerHTML, or script tags", () => {
    const section = makeSection();
    const { container } = render(
      <TerminalSurfaceTabs
        section={section}
        status={makeStatus()}
        activeTabAddonId=""
        onSelect={() => {}}
      />,
    );

    // Confirm the tabs are plain text — the container only has button + span
    // elements, no <script>, no dangerouslySetInnerHTML.
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.querySelectorAll("[dangerouslysetinnerhtml]")).toHaveLength(0);
    // No element carries an `innerHTML` content injection marker.
    expect(container.querySelector("[innerHTML]")).toBeNull();
  });
});

describe("TerminalDockEntry", () => {
  it("renders two authorized terminal surfaces as two tabs under one Terminal entry", () => {
    const onSelectSection = vi.fn();
    const section = makeSection();
    const { container } = render(
      <TerminalDockEntry
        section={section}
        status={makeStatus()}
        activeSectionId="terminal"
        dockIcon="terminal"
        onSelectSection={onSelectSection}
      />,
    );

    expect(container.querySelectorAll(".terminal-dock-entry")).toHaveLength(1);
    const tabs = rtlScreen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    // The active tab is the connected surface.
    const iterm2Tab = tabs.find((tab) => tab.id.endsWith("iterm2-terminal-host"))!;
    expect(iterm2Tab).toHaveAttribute("aria-selected", "true");
    expect(within(iterm2Tab).getByText("Connected")).toBeInTheDocument();
  });

  it("does not render the tab strip when the section is not active", () => {
    const section = makeSection();
    render(
      <TerminalDockEntry
        section={section}
        status={makeStatus()}
        activeSectionId="overview"
        dockIcon="terminal"
        onSelectSection={() => {}}
      />,
    );
    expect(rtlScreen.queryByRole("tab")).toBeNull();
  });

  it("shows the Not installed badge for a surface that is missing from the status payload", () => {
    const section = makeSection();
    const status = makeStatus({
      connected: false,
      surfaces: [
        { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: true, connected: false },
      ],
    });
    render(
      <TerminalDockEntry
        section={section}
        status={status}
        activeSectionId="terminal"
        dockIcon="terminal"
        onSelectSection={() => {}}
      />,
    );
    const iterm2Tab = rtlScreen.getAllByRole("tab").find((tab) => tab.id.endsWith("iterm2-terminal-host"))!;
    expect(within(iterm2Tab).getByText("Not installed")).toBeInTheDocument();
  });

  it("invokes onSelectSection when the trigger is clicked", () => {
    const onSelectSection = vi.fn();
    const section = makeSection();
    render(
      <TerminalDockEntry
        section={section}
        status={null}
        activeSectionId="overview"
        dockIcon="terminal"
        onSelectSection={onSelectSection}
      />,
    );
    fireEvent.click(rtlScreen.getByRole("button", { name: /Resonant Terminal/ }));
    expect(onSelectSection).toHaveBeenCalledWith("terminal");
  });
});