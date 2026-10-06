// CP-XH5d: "Open in Terminal" UI affordance tests.
// CP-BR0: disconnected terminal status links to Settings only; the UI does
// not call the superseded bridge-hosted self-start route.

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenInTerminalButton,
  type OpenInTerminalAddonInfo,
  type OpenInTerminalReceipt,
} from "./OpenInTerminalButton";
import type { TerminalSurfaceStatus } from "./TerminalSurfaceTabs";

const makeStatus = (overrides: Partial<TerminalSurfaceStatus> = {}): TerminalSurfaceStatus => ({
  connected: true,
  driveId: "iterm2",
  surfaces: [
    {
      adapterId: "addon.resonant-terminal-ghostty",
      label: "Ghostty",
      compatible: true,
      connected: false,
    },
    {
      adapterId: "addon.resonant-terminal-iterm2",
      label: "iTerm2",
      compatible: true,
      connected: true,
    },
  ],
  sessions: [],
  ...overrides,
});

const makeBridgeDownStatus = (): TerminalSurfaceStatus => ({
  connected: false,
  driveId: "iterm2",
  surfaces: [
    {
      adapterId: "addon.resonant-terminal-ghostty",
      label: "Ghostty",
      compatible: true,
      connected: false,
    },
    {
      adapterId: "addon.resonant-terminal-iterm2",
      label: "iTerm2",
      compatible: true,
      connected: false,
    },
  ],
  sessions: [],
});

const makeTerminals = (): ReadonlyArray<OpenInTerminalAddonInfo> => [
  {
    addonId: "addon.resonant-terminal-ghostty",
    label: "Ghostty Terminal Host",
    capability: "terminal-host",
    grantPresetId: "ghostty-terminal-host",
    grantPresetGrants: [
      {
        capability: "terminal-host",
        granted: true,
        scope: "system",
        revocationBehavior: "degrade",
      },
    ],
  },
  {
    addonId: "addon.resonant-terminal-iterm2",
    label: "iTerm2 Terminal Host",
    capability: "terminal-host",
    grantPresetId: "iterm2-terminal-host",
    grantPresetGrants: [
      {
        capability: "terminal-host",
        granted: true,
        scope: "system",
        revocationBehavior: "degrade",
      },
    ],
  },
];

const makeReceipt = (overrides: Partial<OpenInTerminalReceipt> = {}): OpenInTerminalReceipt => ({
  ok: true,
  launchId: "launch-1",
  agentId: "pi",
  terminalAddonId: "addon.resonant-terminal-iterm2",
  executablePath: "/usr/local/bin/pi",
  promptPath: "/tmp/prompt-0600.txt",
  startedAt: "2026-10-05T00:00:00.000Z",
  bridgeVersion: null,
  launchAccepted: true,
  ...overrides,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpenInTerminalButton", () => {
  it("is disabled with the documented tooltip when no prompt file exists", () => {
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeStatus()}
        availableTerminals={makeTerminals()}
        promptPath={null}
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={vi.fn()}
        launch={vi.fn()}
      />,
    );
    const button = getByTestId("open-in-terminal");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Write a prompt first.");
  });

  it("dispatches the launch and focuses the terminal dock on success", async () => {
    const launch = vi.fn().mockResolvedValue(makeReceipt());
    const onFocusTerminalDock = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={onFocusTerminalDock}
        launch={launch}
      />,
    );
    fireEvent.click(getByTestId("open-in-terminal"));
    await waitFor(() =>
      expect(launch).toHaveBeenCalledWith({
        agentId: "pi",
        terminalAddonId: "addon.resonant-terminal-iterm2",
        promptPath: "/tmp/prompt-0600.txt",
      }),
    );
    await waitFor(() =>
      expect(onFocusTerminalDock).toHaveBeenCalledWith("addon.resonant-terminal-iterm2"),
    );
  });

  it("authorizes once and auto-retries the launch on capability-not-granted", async () => {
    const launch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, reason: "capability-not-granted" as const })
      .mockResolvedValueOnce(makeReceipt());
    const onAuthorizeGrant = vi.fn().mockResolvedValue(undefined);
    const onFocusTerminalDock = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={onAuthorizeGrant}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={onFocusTerminalDock}
        launch={launch}
      />,
    );
    fireEvent.click(getByTestId("open-in-terminal"));
    await waitFor(() =>
      expect(onAuthorizeGrant).toHaveBeenCalledWith("addon.resonant-terminal-iterm2", [
        {
          capability: "terminal-host",
          granted: true,
          scope: "system",
          revocationBehavior: "degrade",
        },
      ]),
    );
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onFocusTerminalDock).toHaveBeenCalledWith("addon.resonant-terminal-iterm2"),
    );
  });

  it("deep-links to Settings on bridge-not-running without dispatching a grant", async () => {
    const launch = vi
      .fn()
      .mockResolvedValue({ ok: false as const, reason: "bridge-not-running" as const });
    const onAuthorizeGrant = vi.fn();
    const onOpenBridgeSettings = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={onAuthorizeGrant}
        onOpenBridgeSettings={onOpenBridgeSettings}
        onFocusTerminalDock={vi.fn()}
        launch={launch}
      />,
    );
    fireEvent.click(getByTestId("open-in-terminal"));
    await waitFor(() => expect(onOpenBridgeSettings).toHaveBeenCalledTimes(1));
    expect(onAuthorizeGrant).not.toHaveBeenCalled();
  });

  it("links to Settings without exposing the superseded Launch Bridge action", () => {
    const onOpenBridgeSettings = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <OpenInTerminalButton
        status={makeBridgeDownStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={onOpenBridgeSettings}
        onFocusTerminalDock={vi.fn()}
        launch={vi.fn()}
      />,
    );
    expect(queryByTestId("launch-bridge")).toBeNull();
    fireEvent.click(getByTestId("open-bridge-settings"));
    expect(onOpenBridgeSettings).toHaveBeenCalledTimes(1);
  });
});
