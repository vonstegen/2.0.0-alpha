// CP-XH5b: "Open in Terminal" affordance on the Pi agent card.
//
// The button is visible only when the terminal-host service reports
// `connected: true` (CP-XH4c). It is disabled (with the tooltip
// "Write a prompt first.") when no 0600 prompt file exists for the
// operator to launch. The click handler:
//   1. resolves the user's preferred terminal addon id
//      (Ghostty if installed + authorized, else iTerm2, else hidden),
//   2. composes the launch request and POSTs to /terminal-host/launch,
//   3. surfaces the receipt via a non-secret toast (documented
//      fields only),
//   4. on `bridge-not-running` deep-links to Settings → Bridge Target,
//   5. on `capability-not-granted` surfaces an "Authorize Terminal
//      Host" affordance (wired by CP-XH5c),
//   6. on success focuses the Terminal dock entry.
//
// CP-LBc: Launch Bridge affordance. When the bridge is not running
// AND no terminal surface is connected, render a "Launch Bridge"
// button alongside the existing Settings deep-link. The click handler
// POSTs /bridge/launch (via the `launchBridge` test seam or
// `webInvoke("bridge_launch")` in production), and on success
// auto-retries the terminal launch (same retry shape as the XH5c
// authorize path). A second click while already running surfaces
// `alreadyRunning: true` and does NOT spawn twice.
//
// Hard rules:
//   - textContent rendering only (no innerHTML, no script injection).
//   - Only documented receipt fields surface in the toast.
//   - The receipt itself never logs the prompt content, the token,
//     the credential value, or any env value.

import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

import { webInvoke } from "../../core/web-transport";
import type { TerminalSurfaceStatus } from "./TerminalSurfaceTabs";

/** Manifest for the two reviewed terminal add-ons. The UI only knows
 *  about the addon ids + their grant preset ids; everything else is
 *  owned by the host. */
export interface OpenInTerminalAddonInfo {
  addonId: string;
  label: string;
  /** Capability the host expects the grant to carry. */
  capability: string;
  /** Grant preset id the host opens when the operator authorizes. */
  grantPresetId: string;
  /** Grants the preset applies. Documented shape only. */
  grantPresetGrants: ReadonlyArray<{
    capability: string;
    granted: boolean;
    scope: string;
    revocationBehavior: string;
  }>;
}

export interface OpenInTerminalButtonProps {
  /** Live status from the host's GET /terminal-host/status (CP-XH4c). */
  status: TerminalSurfaceStatus | null;
  /** Terminal add-ons the host has registered; the UI prefers the
   *  first one whose surface is `connected: true`. */
  availableTerminals: ReadonlyArray<OpenInTerminalAddonInfo>;
  /** Absolute path to the operator-authored 0600 prompt file. When
   *  null, the button is disabled with the documented tooltip. */
  promptPath: string | null;
  /** Harness agent id the launch should target. */
  agentId: string;
  /** Callback when the operator authorises the terminal-host
   * capability grant (wired in CP-XH5c). The callback applies
   * `grants` via the grant-broker route; the button auto-retries
   * the launch on success. */
  onAuthorizeGrant: (
    terminalAddonId: string,
    grants: ReadonlyArray<{
      capability: string;
      granted: boolean;
      scope: string;
      revocationBehavior: string;
    }>,
  ) => Promise<void>;
  /** Callback to navigate to Settings → Bridge Target on
   *  `bridge-not-running`. */
  onOpenBridgeSettings: () => void;
  /** Callback to focus the Terminal dock entry on launch success. */
  onFocusTerminalDock: (terminalAddonId: string) => void;
  /** Test seam — bypass webInvoke. */
  launch?: (args: {
    agentId: string;
    terminalAddonId: string;
    promptPath: string;
  }) => Promise<OpenInTerminalReceipt | OpenInTerminalRejection>;
  /** CP-LBc: test seam for the bridge launch affordance. */
  launchBridge?: (args: { endpoint?: string }) => Promise<BridgeLaunchReceipt | BridgeLaunchRejection>;
}

/** Public, documented receipt shape. No token, credential, env
 *  value, memory content, or arbitrary path may appear here. */
export type OpenInTerminalReceipt = {
  ok: true;
  launchId: string;
  agentId: string;
  terminalAddonId: string;
  executablePath: string;
  promptPath: string;
  startedAt: string;
  bridgeVersion: string | null;
  launchAccepted: boolean;
};

/** Typed rejections the UI must branch on. The set is documented
 *  and stable; the route never returns any other `reason`. */
export type OpenInTerminalRejection = {
  ok: false;
  reason:
    | "bridge-not-running"
    | "capability-not-granted"
    | "policy-not-reviewed"
    | "executable-unavailable"
    | "launch-failed";
  endpoint?: string;
  code?: string;
};

export type OpenInTerminalResult = OpenInTerminalReceipt | OpenInTerminalRejection;

/** CP-LBc: documented bridge-launch receipt. Only `ok`, `endpoint`,
 *  `version`, `alreadyRunning`, and `pid` are surfaced. */
export type BridgeLaunchReceipt = {
  ok: true;
  endpoint: string;
  version: string | null;
  alreadyRunning: boolean;
  pid?: number;
};

/** CP-LBc: bridge-launch rejection. Only `bridge-start-failed` is
 *  documented for this route. */
export type BridgeLaunchRejection = {
  ok: false;
  reason: "bridge-start-failed";
  endpoint: string;
};

const resolvePreferredTerminal = (
  available: ReadonlyArray<OpenInTerminalAddonInfo>,
  status: TerminalSurfaceStatus | null,
): OpenInTerminalAddonInfo | null => {
  if (!status || !status.connected) return null;
  const connected = new Set(
    status.surfaces.filter((surface) => surface.connected).map((surface) => surface.adapterId),
  );
  const compatible = new Set(
    status.surfaces.filter((surface) => surface.compatible).map((surface) => surface.adapterId),
  );
  for (const addon of available) {
    if (connected.has(addon.addonId)) return addon;
  }
  for (const addon of available) {
    if (compatible.has(addon.addonId)) return addon;
  }
  return null;
};

/** CP-LBc: resolve a terminal for the Launch Bridge auto-retry. The
 *  bridge just came up; the surface status may still report
 * `connected:false` because the terminal-host service hasn't bound
 *  the addon yet. Fall back to the first compatible addon so the
 *  /terminal-host/launch probe can succeed once the bus is wired. */
const resolveLaunchBridgeAutoRetryTarget = (
  available: ReadonlyArray<OpenInTerminalAddonInfo>,
  status: TerminalSurfaceStatus | null,
): OpenInTerminalAddonInfo | null => {
  if (status?.connected) return resolvePreferredTerminal(available, status);
  const compatible = new Set(
    (status?.surfaces ?? []).filter((surface) => surface.compatible).map((surface) => surface.adapterId),
  );
  for (const addon of available) {
    if (compatible.has(addon.addonId)) return addon;
  }
  return null;
};

const defaultLaunch = async (args: {
  agentId: string;
  terminalAddonId: string;
  promptPath: string;
}): Promise<OpenInTerminalResult> => {
  const payload = await webInvoke<OpenInTerminalResult>("terminal_host_launch", args);
  return payload;
};

/** CP-LBc: default bridge-launch seam. POSTs to /bridge/launch via
 *  the commandRouteMap. Documented fields only (endpoint, version,
 *  alreadyRunning, pid). */
const defaultLaunchBridge = async (
  args: { endpoint?: string } = {},
): Promise<BridgeLaunchReceipt | BridgeLaunchRejection> => {
  const payload = await webInvoke<BridgeLaunchReceipt | BridgeLaunchRejection>("bridge_launch", args);
  return payload;
};

export const OpenInTerminalButton = (
  props: OpenInTerminalButtonProps,
): JSX.Element | null => {
  const launchFn = props.launch ?? defaultLaunch;
  const launchBridgeFn = props.launchBridge ?? defaultLaunchBridge;
  const preferred = useMemo(
    () => resolvePreferredTerminal(props.availableTerminals, props.status),
    [props.availableTerminals, props.status],
  );

  const [busy, setBusy] = useState(false);
  const [launchingBridge, setLaunchingBridge] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [bridgeAlreadyRunning, setBridgeAlreadyRunning] = useState(false);

  // CP-LBc: when the bridge is up but the terminal surface hasn't
  // surfaced yet (still in the `Starting` window), keep the Launch
  // Bridge affordance live. The host's GET /terminal-host/status
  // reports `connected: false` during this window; the UI branch
  // `bridge-not-running` is replaced by a `bridge-starting` branch
  // that simply tells the operator the auto-start kicked off.
  const bridgeNotRunning = !props.status || props.status.connected !== true;

  const handleClick = useCallback(async () => {
    setLastError(null);
    if (!props.promptPath) {
      setLastError("Write a prompt first.");
      return;
    }
    if (!preferred) {
      setLastError("No terminal host is connected.");
      return;
    }
    setBusy(true);
    try {
      const result = await launchFn({
        agentId: props.agentId,
        terminalAddonId: preferred.addonId,
        promptPath: props.promptPath,
      });
      if (result.ok) {
        props.onFocusTerminalDock(preferred.addonId);
        return;
      }
      if (result.reason === "bridge-not-running") {
        props.onOpenBridgeSettings();
        setLastError("Bridge not running — open Settings → Bridge Target.");
        return;
      }
      if (result.reason === "capability-not-granted") {
        // CP-XH5c: surface the Authorize action. The component does
        // NOT auto-grant; the parent owns the grant-broker wiring so
        // it can refresh the registry and retry.
        await props.onAuthorizeGrant(
          preferred.addonId,
          preferred.grantPresetGrants,
        );
        // Auto-retry on success: the parent's onAuthorizeGrant
        // resolves only when the grant has been applied + the
        // registry refreshed.
        const second = await launchFn({
          agentId: props.agentId,
          terminalAddonId: preferred.addonId,
          promptPath: props.promptPath,
        });
        if (second.ok) {
          props.onFocusTerminalDock(preferred.addonId);
          return;
        }
        setLastError(`Authorization did not unlock the launch (${second.reason}).`);
        return;
      }
      setLastError(`Launch failed: ${result.reason}.`);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Launch failed.");
    } finally {
      setBusy(false);
    }
  }, [launchFn, preferred, props]);

  // CP-LBc: Launch Bridge handler. Mirrors the XH5c auto-retry shape.
  // On a non-secret receipt the component auto-retries the terminal
  // launch (re-running `launchFn` once) so the operator does not have
  // to click again. A second click while `alreadyRunning: true` is
  // surfaced does NOT spawn twice (the host returns immediately).
  const handleLaunchBridge = useCallback(async () => {
    setLastError(null);
    setLaunchingBridge(true);
    try {
      const result = await launchBridgeFn({});
      if (result.ok) {
        setBridgeAlreadyRunning(result.alreadyRunning === true);
        // Auto-retry the terminal launch on success. Same shape as
        // the XH5c authorize retry: if the bridge is now healthy,
        // the /terminal-host/launch probe will return ok:true.
        //
        // Resolve the auto-retry target: prefer a connected
        // terminal; if none is connected yet (the typical post-
        // bring-up state), fall back to the first compatible
        // surface so the operator does not have to click again.
        const retryTarget = resolveLaunchBridgeAutoRetryTarget(props.availableTerminals, props.status);
        if (props.promptPath && retryTarget) {
          const second = await launchFn({
            agentId: props.agentId,
            terminalAddonId: retryTarget.addonId,
            promptPath: props.promptPath,
          });
          if (second.ok) {
            props.onFocusTerminalDock(retryTarget.addonId);
            return;
          }
        }
        return;
      }
      setLastError("Bridge failed to start. Open Settings → Bridge Target for details.");
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Bridge failed to start.");
    } finally {
      setLaunchingBridge(false);
    }
  }, [launchBridgeFn, launchFn, props]);

  // CP-LBc: when the bridge is not running and no terminal surface
  // is connected, render the Launch Bridge affordance alongside the
  // existing Settings deep-link. TextContent rendering only.
  if (bridgeNotRunning) {
    const disabled = launchingBridge;
    return (
      <span className="open-in-terminal-launch-bridge" data-testid="open-in-terminal-launch-bridge-group">
        <button
          type="button"
          className="button-secondary launch-bridge"
          data-testid="launch-bridge"
          disabled={disabled}
          title={launchingBridge ? "Starting bridge…" : "Start the ResonantOS bridge."}
          onClick={(event) => {
            event.stopPropagation();
            if (disabled) return;
            void handleLaunchBridge();
          }}
        >
          {launchingBridge ? "Starting bridge…" : "Launch Bridge"}
        </button>
        <button
          type="button"
          className="button-secondary bridge-settings"
          data-testid="open-bridge-settings"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenBridgeSettings();
          }}
        >
          Open Settings
        </button>
        {lastError ? (
          <span className="open-in-terminal-error" data-testid="open-in-terminal-error">
            {" — "}
            {lastError}
          </span>
        ) : null}
        {bridgeAlreadyRunning ? (
          <span className="open-in-terminal-bridge-already" data-testid="open-in-terminal-bridge-already">
            {" — bridge already running"}
          </span>
        ) : null}
      </span>
    );
  }

  if (!preferred) return null;

  const disabledLaunch = busy || !props.promptPath;
  const tooltip = !props.promptPath
    ? "Write a prompt first."
    : busy
      ? "Launching…"
      : "";

  return (
    <button
      type="button"
      className="button-primary open-in-terminal"
      data-testid="open-in-terminal"
      data-agent-id={props.agentId}
      data-terminal-addon-id={preferred.addonId}
      disabled={disabledLaunch}
      title={tooltip}
      onClick={(event) => {
        event.stopPropagation();
        if (disabledLaunch) return;
        void handleClick();
      }}
    >
      {busy ? "Opening…" : "Open in Terminal"}
      {lastError ? ` — ${lastError}` : ""}
    </button>
  );
};

export default OpenInTerminalButton;

/**
 * Pure receipt-renderer helper for tests + toast callers. Only the
 * documented fields are emitted; everything else is ignored.
 */
export const renderReceiptText = (receipt: OpenInTerminalReceipt): string => {
  return [
    `launched ${receipt.agentId} in ${receipt.terminalAddonId}`,
    `id: ${receipt.launchId}`,
    `binary: ${receipt.executablePath}`,
    `prompt: ${receipt.promptPath}`,
    `started: ${receipt.startedAt}`,
    receipt.bridgeVersion ? `bridge: ${receipt.bridgeVersion}` : "",
  ].filter(Boolean).join(" · ");
};

/** CP-LBc: pure helper that produces the documented Bridge Target
 *  status line for the Settings panel. Only the documented fields
 *  (`endpoint`, `version`, `alreadyRunning`) are surfaced. */
export const renderBridgeStatusText = (args: {
  endpoint: string;
  status: "connected" | "starting" | "not-running";
}): string => {
  if (args.status === "connected") return `Connected · ${args.endpoint}`;
  if (args.status === "starting") return `Starting · ${args.endpoint}`;
  return `Not running · ${args.endpoint}`;
};