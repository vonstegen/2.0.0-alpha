// ResonantOS Add-on Tools settings section (CP-BR10).
//
// The Settings → Add-on Tools section is a renderer of the host's
// terminal-host surface projection. The host owns process state; the
// renderer only:
//
//   - reads the public /terminal-host/status payload (adapterId,
//     label, compatible, connected) and the projection
//     runtimeList row for the same add-on,
//   - renders text nodes only (`textContent`, `createElement`,
//     `append`). No innerHTML, no script injection, no raw fields,
//   - drives every action through an injected host transaction
//     (`launchTerminal` + `fetchConnectionScript`),
//   - copies the connection script as text only (`navigator.clipboard
//     .writeText`, plus a manual-select fallback when the clipboard
//     API is unavailable),
//   - re-fetches the status on mount and after every completed
//     transaction.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §14 (CP-BR10), TERMINAL-ACTIVATION.md, ADR-047.

import {
  metricCard,
  noteCard,
  safeErrorMessage,
  setStatus,
  settingsHeader,
} from "./settings-common.js";
import {
  element,
  actionButton,
  statusBadgeForSurface,
  notInstalledBadge,
  buildTerminalsViewModel,
  TERMINAL_CARD_FIELD,
  TERMINAL_ADDON_IDS as SHARED_TERMINAL_ADDON_IDS,
  DEFAULT_AGENT_ID as SHARED_DEFAULT_AGENT_ID,
} from "../terminal-cards.js";

const POLL_INTERVAL_MS = 4000;
const TEST_POLL_INTERVAL_MS = 0;

const ADDON_TOOLS_FIELD = "addon-tools";
const TERMINAL_TAB_FIELD = "terminal-tab";

// CP-BR11: re-use the shared constants from `terminal-cards.js` so
// the rail workspace and the Settings section cannot drift.
const TERMINAL_ADDON_IDS = SHARED_TERMINAL_ADDON_IDS;
const DEFAULT_AGENT_ID = SHARED_DEFAULT_AGENT_ID;

// ---------------------------------------------------------------------------
// DOM helpers (text-only) — re-imported from `../terminal-cards.js`
// (CP-BR11). The Settings section and the new Terminals rail
// workspace share these helpers so the two surfaces cannot drift.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status payload -> section view model (CP-BR11: delegates to the
// shared `buildTerminalsViewModel` so the Settings section and the
// new rail workspace cannot drift).
// ---------------------------------------------------------------------------

function buildAddonToolsViewModel({ status, projectionRuntime, registry, prompt }) {
  return buildTerminalsViewModel({ status, projectionRuntime, registry, prompt });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderTerminalTab(view, tab, options) {
  const { onLaunch, onCopyScript, busyAddonId, lastError } = options;
  const badge = tab.installed
    ? statusBadgeForSurface(tab)
    : notInstalledBadge();
  const card = element("article", {
    className: "settings-runtime-row",
    dataset: { addonId: tab.addonId, tone: badge.tone, field: TERMINAL_TAB_FIELD },
  });
  const header = element("header", { className: "settings-runtime-row-header" });
  const title = element("strong");
  title.textContent = tab.label;
  const badgeNode = element("span", {
    className: "settings-runtime-row-status",
    dataset: { tone: badge.tone },
    ariaLabel: `${tab.label} status: ${badge.label}`,
  });
  badgeNode.textContent = badge.label;
  header.append(title, badgeNode);
  card.append(header);

  const detail = element("p", { className: "settings-runtime-row-detail" });
  detail.textContent = tab.installed
    ? tab.connected
      ? `${tab.label} is connected to the bridge. Run session starts a harness inside it.`
      : tab.compatible
        ? `Launch & connect opens ${tab.label} and links it to the bridge. Connect existing terminal attaches a terminal you already have open.`
        : `${tab.label} is installed but not yet authorized.`
    : `${tab.label} is not installed on this bridge.`;
  card.append(detail);

  if (lastError && lastError.addonId === tab.addonId && lastError.message) {
    const errNode = element("p", {
      className: "settings-runtime-row-error",
      dataset: { tone: lastError.tone ?? "warn" },
      ariaLive: "polite",
    });
    errNode.textContent = lastError.message;
    card.append(errNode);
  }

  const actions = element("div", { className: "settings-action-row" });
  const isBusy = busyAddonId === tab.addonId;
  const launchDisabled = isBusy
    || !tab.installed
    || !tab.compatible
    || !tab.connected
    || !view.promptValid
    || !view.promptPath;
  const copyDisabled = isBusy
    || !tab.installed
    || !tab.compatible;
  actions.append(
    actionButton({
      label: isBusy ? "Working..." : "Run session",
      onClick: () => onLaunch(tab),
      disabled: launchDisabled,
      ariaLabel: `Run a harness session in ${tab.label}`,
      testid: `addon-tools-launch-${tab.addonId}`,
    }),
    actionButton({
      label: isBusy ? "Working..." : "Connect existing terminal",
      onClick: () => onCopyScript(tab),
      disabled: copyDisabled,
      ariaLabel: `Copy a script to connect an already-open ${tab.label}`,
      testid: `addon-tools-copy-${tab.addonId}`,
    }),
  );
  card.append(actions);
  return card;
}

function renderEmptyState(view) {
  const note = noteCard({
    title: "No terminal tools installed",
    body: view.bridgeConnected
      ? "The bridge is connected, but no reviewed terminal-host add-on is installed. Install one from the add-on catalog to enable Add-on Tools."
      : "The bridge is not currently connected. Open Settings → Bridge Target to start it.",
    tone: "info",
  });
  return note;
}

function renderPromptCard(view) {
  const status = view.promptValid
    ? "A 0600 prompt file is in place. Open in Terminal is enabled for connected terminals."
    : "No 0600 prompt file yet. Write your prompt, then return here — the launch button stays disabled until a valid 0600 file exists.";
  return metricCard({
    label: "Prompt file",
    value: view.promptPath ?? "—",
    detail: status,
    tone: view.promptValid ? "info" : "warn",
  });
}

function renderScriptViewer(script, onClose) {
  if (!script) return null;
  const wrapper = element("section", {
    className: "settings-script-viewer",
    dataset: { tone: "info" },
  });
  const heading = element("strong");
  heading.textContent = `Connection script — ${script.terminalAddonId}`;
  const hint = element("p", { className: "settings-script-viewer-hint" });
  hint.textContent = "Paste this into the already-running terminal. The grant token rides a 0600 file only; the script never contains a raw token, credential, or env value.";
  const code = element("pre", { className: "settings-script-viewer-code" });
  code.textContent = script.command;
  const meta = element("dl", { className: "settings-script-viewer-meta" });
  for (const [key, value] of [
    ["Session id", script.sessionId],
    ["Token file (0600)", script.tokenFilePath],
    ["ros-session CLI", script.rosSessionPath],
    ["Provider profile", script.providerProfileId ?? "(unset — add --provider-profile-id at paste time)"],
    ["Expires", script.expiresAt],
  ]) {
    if (value === undefined || value === null) continue;
    const dt = element("dt");
    dt.textContent = key;
    const dd = element("dd");
    dd.textContent = String(value);
    meta.append(dt, dd);
  }
  const actions = element("div", { className: "settings-action-row" });
  actions.append(
    actionButton({
      label: "Close",
      onClick: () => onClose?.(),
      ariaLabel: "Dismiss the connection script viewer",
    }),
  );
  wrapper.append(heading, hint, code, meta, actions);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Section entry point
// ---------------------------------------------------------------------------

/**
 * Render the Add-on Tools settings section.
 *
 * @param {HTMLElement} container
 * @param {{
 *   fetchStatus?: () => Promise<unknown>,
 *   fetchPromptPath?: () => Promise<unknown>,
 *   fetchProjection?: () => Promise<unknown>,
 *   launchTerminal?: (args: { terminalAddonId: string, promptPath: string, agentId: string }) => Promise<unknown>,
 *   fetchConnectionScript?: (args: { terminalAddonId: string, promptPath: string | null, providerProfileId?: string }) => Promise<unknown>,
 *   onOpenBridgeSettings?: () => void,
 *   pollIntervalMs?: number,
 * }} options
 */
export function renderAddonToolsSection(container, options = {}) {
  container.innerHTML = "";
  container.append(
    settingsHeader({
      eyebrow: "Work",
      title: "Add-on Tools",
      body: "Launch the reviewed terminal-host add-ons (iTerm2, Ghostty) or copy a connection script for an already-running terminal. The host owns the bridge and the credentials; the renderer never reads secrets.",
    }),
  );

  const statusNode = element("p", {
    className: "settings-status",
    ariaLive: "polite",
  });
  setStatus(statusNode, "Reading terminal surfaces...", "");
  container.append(statusNode);

  const scriptViewer = element("section", { className: "settings-script-viewer-host" });
  container.append(scriptViewer);

  const tabsHost = element("section", {
    className: "settings-provider-card",
    dataset: { field: ADDON_TOOLS_FIELD },
  });
  const tabsHeading = element("strong", { className: "settings-provider-heading" });
  tabsHeading.textContent = "Terminal tools";
  tabsHost.append(tabsHeading);
  container.append(tabsHost);

  const promptCard = renderPromptCard({ promptPath: null, promptValid: false });
  const promptHost = element("section", { className: "settings-prompt-card-host" });
  promptHost.append(promptCard);
  container.append(promptHost);

  const ownershipNote = noteCard({
    title: "Resource model",
    body: "The terminal adapter needs only a host-pinned connection env (PATH, HOME, RESONANT_TERMINAL_DRIVER + the loopback bridge endpoint). The TUI harness inside the terminal — Pi, Grok-Build, etc. — is the consumer of the projected project / skills / memory / credential resources; the renderer never displays those.",
  });
  container.append(ownershipNote);

  const state = {
    busyAddonId: null,
    lastError: null,
    actionStatus: null,
    script: null,
    timer: null,
  };

  async function readStatus() {
    if (typeof options.fetchStatus === "function") return options.fetchStatus();
    return null;
  }
  async function readProjection() {
    if (typeof options.fetchProjection === "function") return options.fetchProjection();
    return null;
  }
  async function readRegistry() {
    if (typeof options.fetchRegistry === "function") return options.fetchRegistry();
    return null;
  }
  async function readPrompt() {
    if (typeof options.fetchPromptPath === "function") return options.fetchPromptPath();
    return null;
  }

  function setBusy(addonId) {
    state.busyAddonId = addonId;
    void refresh();
  }
  function setLastError(addonId, message, tone = "warn") {
    state.lastError = { addonId, message, tone };
    state.actionStatus = null;
    state.busyAddonId = null;
    void refresh();
  }
  function clearError() {
    state.lastError = null;
    state.actionStatus = null;
  }
  // Action feedback (launch / copy) must survive the refresh loop: the
  // refresh's generic status summary would otherwise overwrite the
  // confirmation within microseconds of the click.
  function setActionStatus(text, tone = "ok") {
    state.actionStatus = { text, tone };
    setStatus(statusNode, text, tone);
  }

  // The current view is held on the closure so handlers can read
  // the most recently rendered prompt / connected state.
  let currentView = { promptPath: null, promptValid: false, tabs: [], bridgeConnected: false };

  async function refresh() {
    const [status, projection, registry, prompt] = await Promise.all([
      readStatus().catch(() => null),
      readProjection().catch(() => null),
      readRegistry().catch(() => null),
      readPrompt().catch(() => null),
    ]);
    const projectionRuntime = Array.isArray(projection?.runtimeList) ? projection.runtimeList : [];
    const view = buildAddonToolsViewModel({
      status: status ?? null,
      projectionRuntime,
      registry: registry ?? null,
      prompt: prompt ?? null,
    });
    currentView = view;
    promptHost.replaceChildren(renderPromptCard(view));
    tabsHost.replaceChildren(tabsHeading);
    if (view.tabs.every((tab) => !tab.installed)) {
      // No reviewed add-on is installed yet; still render the per-id
      // tabs so the operator can see "Not installed" for each known
      // id. The empty-state note is dropped — it would duplicate the
      // same information.
      for (const tab of view.tabs) {
        tabsHost.append(
          renderTerminalTab(view, tab, {
            onLaunch,
            onCopyScript,
            busyAddonId: state.busyAddonId,
            lastError: state.lastError,
          }),
        );
      }
    } else {
      for (const tab of view.tabs) {
        if (!tab.installed) continue;
        tabsHost.append(
          renderTerminalTab(view, tab, {
            onLaunch,
            onCopyScript,
            busyAddonId: state.busyAddonId,
            lastError: state.lastError,
          }),
        );
      }
    }
    if (state.actionStatus) {
      setStatus(statusNode, state.actionStatus.text, state.actionStatus.tone);
    } else if (!view.bridgeConnected) {
      setStatus(statusNode, "Bridge not connected — open Settings → Bridge Target to start it.", "warn");
    } else if (view.tabs.some((tab) => tab.connected)) {
      setStatus(statusNode, `${view.tabs.find((tab) => tab.connected)?.label} is connected to the bridge.`, "ok");
    } else {
      setStatus(statusNode, "Bridge connected. Grant the terminal-host capability on a reviewed add-on to enable auto-connect.", "info");
    }
  }

  async function onLaunch(tab) {
    if (typeof options.launchTerminal !== "function") {
      setLastError(tab.addonId, "Launch is not available in this environment.", "warn");
      return;
    }
    if (!currentView.promptPath || !currentView.promptValid) {
      setLastError(tab.addonId, "Write a prompt first.", "warn");
      return;
    }
    clearError();
    setBusy(tab.addonId);
    let result;
    try {
      result = await options.launchTerminal({
        terminalAddonId: tab.addonId,
        promptPath: currentView.promptPath,
        agentId: DEFAULT_AGENT_ID,
      });
    } catch (error) {
      setLastError(tab.addonId, safeErrorMessage(error), "warn");
      return;
    }
    state.busyAddonId = null;
    if (result && result.reason === "bridge-not-running") {
      setLastError(tab.addonId, "Bridge not running — open Settings → Bridge Target.", "warn");
      if (typeof options.onOpenBridgeSettings === "function") options.onOpenBridgeSettings();
      return;
    }
    if (result && result.reason === "capability-not-granted") {
      setLastError(tab.addonId, "Authorize the terminal-host capability to use Open in Terminal.", "warn");
      return;
    }
    if (result && result.reason === "executable-unavailable") {
      setLastError(tab.addonId, "The reviewed harness binary is not available on PATH.", "warn");
      return;
    }
    if (result && result.reason === "policy-not-reviewed") {
      setLastError(tab.addonId, "The harness policy is not yet reviewed.", "warn");
      return;
    }
    if (result && result.reason === "launch-failed") {
      setLastError(tab.addonId, "The terminal adapter rejected the launch. Try the copy-connection-script fallback.", "warn");
      return;
    }
    if (result && typeof result.launchId === "string") {
      clearError();
      setActionStatus(`Launched ${tab.label}.`, "ok");
    } else if (result && result.reason) {
      setLastError(tab.addonId, `Launch failed: ${result.reason}.`, "warn");
    } else {
      setLastError(tab.addonId, "Launch returned no result.", "warn");
    }
    void refresh();
  }

  async function onCopyScript(tab) {
    if (typeof options.fetchConnectionScript !== "function") {
      setLastError(tab.addonId, "Copy is not available in this environment.", "warn");
      return;
    }
    clearError();
    setBusy(tab.addonId);
    let result;
    try {
      result = await options.fetchConnectionScript({
        terminalAddonId: tab.addonId,
        promptPath: currentView.promptPath,
      });
    } catch (error) {
      setLastError(tab.addonId, safeErrorMessage(error), "warn");
      return;
    }
    state.busyAddonId = null;
    if (result && result.reason === "bridge-not-running") {
      setLastError(tab.addonId, "Bridge not running — open Settings → Bridge Target.", "warn");
      if (typeof options.onOpenBridgeSettings === "function") options.onOpenBridgeSettings();
      return;
    }
    if (result && result.reason === "capability-not-granted") {
      setLastError(tab.addonId, "Authorize the terminal-host capability to copy a connection script.", "warn");
      return;
    }
    if (!result || typeof result.command !== "string") {
      setLastError(tab.addonId, "Copy failed: the host did not return a connection script.", "warn");
      return;
    }
    state.script = result;
    renderScriptViewerInto(result);
    void refresh();
  }

  async function copyScriptToClipboard() {
    if (!state.script || typeof navigator === "undefined" || !navigator.clipboard) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(state.script.command);
      return true;
    } catch {
      return false;
    }
  }

  function renderScriptViewerInto(script) {
    scriptViewer.replaceChildren();
    const viewer = renderScriptViewer(script, () => {
      state.script = null;
      scriptViewer.replaceChildren();
    });
    if (!viewer) return;
    const copyActions = element("div", { className: "settings-action-row" });
    copyActions.append(
      actionButton({
        label: "Copy",
        onClick: async () => {
          const ok = await copyScriptToClipboard();
          if (ok) {
            setActionStatus("Connection script copied to the clipboard.", "ok");
          } else {
            setActionStatus("Clipboard API unavailable — select the script and copy manually.", "warn");
          }
        },
        ariaLabel: "Copy the connection script to the clipboard",
        testid: "addon-tools-copy-clipboard",
      }),
    );
    viewer.append(copyActions);
    scriptViewer.append(viewer);
  }

  // Kick off the initial render and a bounded poll.
  void refresh();
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  if (pollMs > 0) {
    state.timer = setInterval(() => { void refresh(); }, pollMs);
  }

  return {
    refresh,
    stop() {
      if (state.timer) clearInterval(state.timer);
      state.timer = null;
    },
    getCurrentView() {
      return currentView;
    },
  };
}

export { TERMINAL_ADDON_IDS, DEFAULT_AGENT_ID };
