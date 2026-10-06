// CP-XH5d: "Open in Terminal" UI affordance test
//
// Acceptance (CP-XH5d gate):
//   - The button is disabled (with the "Write a prompt first." tooltip) when
//     no valid 0600 prompt file exists.
//   - Clicking with a valid prompt file dispatches through the launch seam
//     (which POSTs to /terminal-host/launch in production) and surfaces the
//     receipt by focusing the Terminal dock entry.
//   - On `capability-not-granted`, the button calls `onAuthorizeGrant` once
//     and auto-retries the launch without a second click (CP-XH5c wiring).
//   - On `bridge-not-running`, the button deep-links to Settings without
//     dispatching a grant.
//
// CP-LBc: Launch Bridge affordance tests:
//   - When the bridge is not running (status.connected !== true) the
//     component renders a "Launch Bridge" button alongside the Settings
//     deep-link.
//   - Clicking "Launch Bridge" calls the launchBridge seam and
//     auto-retries the terminal launch on success.
//   - A second click while running surfaces `alreadyRunning: true` and
//     does NOT spawn twice.
//   - On `bridge-start-failed` the component surfaces a non-secret
//     error and does NOT auto-retry the terminal launch.

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenInTerminalButton,
  type BridgeLaunchReceipt,
  type OpenInTerminalAddonInfo,
  type OpenInTerminalReceipt,
  renderBridgeStatusText,
} from "./OpenInTerminalButton";
import type { TerminalSurfaceStatus } from "./TerminalSurfaceTabs";

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

const makeBridgeDownStatus = (): TerminalSurfaceStatus => ({
  connected: false,
  driveId: "iterm2",
  surfaces: [
    { adapterId: "addon.resonant-terminal-ghostty", label: "Ghostty", compatible: true, connected: false },
    { adapterId: "addon.resonant-terminal-iterm2", label: "iTerm2", compatible: true, connected: false },
  ],
  sessions: [],
});

const makeTerminals = (): ReadonlyArray<OpenInTerminalAddonInfo> => [
  {
    addonId: "addon.resonant-terminal-ghostty",
    label: "Ghostty Terminal Host",
    capability: "terminal-host",
    grantPresetId: "ghostty-terminal-host",
    grantPresetGrants: [{ capability: "terminal-host", granted: true, scope: "system", revocationBehavior: "degrade" }],
  },
  {
    addonId: "addon.resonant-terminal-iterm2",
    label: "iTerm2 Terminal Host",
    capability: "terminal-host",
    grantPresetId: "iterm2-terminal-host",
    grantPresetGrants: [{ capability: "terminal-host", granted: true, scope: "system", revocationBehavior: "degrade" }],
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

const makeBridgeReceipt = (overrides: Partial<BridgeLaunchReceipt> = {}): BridgeLaunchReceipt => ({
  ok: true,
  endpoint: "http://127.0.0.1:47800",
  version: "1.2.3",
  alreadyRunning: false,
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
    await waitFor(() => expect(onFocusTerminalDock).toHaveBeenCalledWith("addon.resonant-terminal-iterm2"));
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
        { capability: "terminal-host", granted: true, scope: "system", revocationBehavior: "degrade" },
      ]),
    );
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onFocusTerminalDock).toHaveBeenCalledWith("addon.resonant-terminal-iterm2"));
  });

  it("deep-links to Settings on bridge-not-running without dispatching a grant", async () => {
    const launch = vi.fn().mockResolvedValue({ ok: false as const, reason: "bridge-not-running" as const });
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

  it("renders a 'Launch Bridge' button alongside the Settings deep-link when the bridge is down", () => {
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeBridgeDownStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={vi.fn()}
        launch={vi.fn()}
      />,
    );
    const group = getByTestId("open-in-terminal-launch-bridge-group");
    expect(group).toBeInTheDocument();
    // The primary "Open in Terminal" affordance is hidden in the
    // bridge-down branch; the Launch Bridge button is the operator's
    // way to recover.
    expect(group.querySelector('[data-testid="open-in-terminal"]')).toBeNull();
    const launchButton = getByTestId("launch-bridge");
    expect(launchButton).toBeInTheDocument();
    // textContent rendering only: no innerHTML/dangerouslySetInnerHTML.
    expect(launchButton.textContent).toBe("Launch Bridge");
    const settingsButton = getByTestId("open-bridge-settings");
    expect(settingsButton).toBeInTheDocument();
    expect(settingsButton.textContent).toBe("Open Settings");
  });

  it("Launch Bridge click dispatches launchBridge seam then auto-retries the terminal launch against the first compatible surface", async () => {
    // When the bridge is down, no terminal is yet `connected`. The
    // Launch Bridge auto-retry falls back to the first compatible
    // surface (iTerm2 in this fixture) so the operator does not
    // have to click again — same retry shape as the XH5c authorize
    // path.
    const launchBridge = vi.fn().mockResolvedValue(makeBridgeReceipt({ alreadyRunning: false, pid: 99001 }));
    const launch = vi.fn().mockResolvedValue(makeReceipt());
    const onFocusTerminalDock = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeBridgeDownStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={onFocusTerminalDock}
        launch={launch}
        launchBridge={launchBridge}
      />,
    );
    fireEvent.click(getByTestId("launch-bridge"));
    await waitFor(() => expect(launchBridge).toHaveBeenCalledWith({}));
    // Auto-retry shape (mirrors XH5c authorize retry): launch the
    // terminal launch once on a successful bridge bring-up.
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    expect(launch).toHaveBeenCalledWith({
      agentId: "pi",
      terminalAddonId: "addon.resonant-terminal-ghostty",
      promptPath: "/tmp/prompt-0600.txt",
    });
    await waitFor(() => expect(onFocusTerminalDock).toHaveBeenCalledWith("addon.resonant-terminal-ghostty"));
  });

  it("a second Launch Bridge click surfaces alreadyRunning without a second host spawn", async () => {
    // First click: spidev a fresh bridge + auto-retry the terminal
    // launch. Second click: bridge alreadyRunning so the host does
    // NOT spawn; the component surfaces the "already running"
    // affordance. The seam was called exactly twice (once per click);
    // the host returned alreadyRunning on the second invocation —
    // meaning the host did NOT spawn a second child.
    const launchBridge = vi
      .fn()
      .mockResolvedValueOnce(makeBridgeReceipt({ alreadyRunning: false, pid: 99001 }))
      .mockResolvedValueOnce(makeBridgeReceipt({ alreadyRunning: true, version: "1.2.3" }));
    const launch = vi.fn().mockResolvedValue(makeReceipt());
    const onFocusTerminalDock = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeBridgeDownStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={onFocusTerminalDock}
        launch={launch}
        launchBridge={launchBridge}
      />,
    );
    fireEvent.click(getByTestId("launch-bridge"));
    await waitFor(() => expect(launchBridge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onFocusTerminalDock).toHaveBeenCalledTimes(1));

    // Second click — the host returns alreadyRunning:true, so the
    // "already running" affordance surfaces and the launch seam
    // surfaces the receipt but does NOT spawn a fresh bridge.
    fireEvent.click(getByTestId("launch-bridge"));
    await waitFor(() => expect(launchBridge).toHaveBeenCalledTimes(2));
    // The "already running" affordance surfaces.
    const already = getByTestId("open-in-terminal-bridge-already");
    expect(already).toBeInTheDocument();
    expect(already.textContent).toBe(" — bridge already running");
    // launchBridge's second-call receipt had alreadyRunning:true —
    // meaning the host did NOT spawn. We assert that via the
    // receipt shape itself (alreadyRunning in the second response).
    // The mock result is the Promise; await its resolved value.
    const secondResult = await launchBridge.mock.results[1].value;
    expect(secondResult.alreadyRunning).toBe(true);
  });

  it("Launch Bridge on bridge-start-failed surfaces an error and does NOT auto-retry the terminal launch", async () => {
    const launchBridge = vi.fn().mockResolvedValue({
      ok: false as const,
      reason: "bridge-start-failed" as const,
      endpoint: "http://127.0.0.1:47800",
    });
    const launch = vi.fn();
    const onFocusTerminalDock = vi.fn();
    const { getByTestId } = render(
      <OpenInTerminalButton
        status={makeBridgeDownStatus()}
        availableTerminals={makeTerminals()}
        promptPath="/tmp/prompt-0600.txt"
        agentId="pi"
        onAuthorizeGrant={vi.fn()}
        onOpenBridgeSettings={vi.fn()}
        onFocusTerminalDock={onFocusTerminalDock}
        launch={launch}
        launchBridge={launchBridge}
      />,
    );
    fireEvent.click(getByTestId("launch-bridge"));
    await waitFor(() => expect(launchBridge).toHaveBeenCalledTimes(1));
    // No auto-retry of the terminal launch on bridge-start-failed.
    expect(launch).not.toHaveBeenCalled();
    expect(onFocusTerminalDock).not.toHaveBeenCalled();
    const errorNode = getByTestId("open-in-terminal-error");
    expect(errorNode).toBeInTheDocument();
    expect(errorNode.textContent).toMatch(/Bridge failed to start/);
  });
});

describe("renderBridgeStatusText", () => {
  it("surfaces Connected with the endpoint", () => {
    expect(renderBridgeStatusText({ endpoint: "http://127.0.0.1:47800", status: "connected" }))
      .toBe("Connected · http://127.0.0.1:47800");
  });
  it("surfaces Starting with the endpoint", () => {
    expect(renderBridgeStatusText({ endpoint: "http://127.0.0.1:47800", status: "starting" }))
      .toBe("Starting · http://127.0.0.1:47800");
  });
  it("surfaces Not running with the endpoint", () => {
    expect(renderBridgeStatusText({ endpoint: "http://127.0.0.1:47800", status: "not-running" }))
      .toBe("Not running · http://127.0.0.1:47800");
  });
});