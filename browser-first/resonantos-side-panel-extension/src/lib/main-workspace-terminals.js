// ResonantOS Terminals workspace renderer (CP-BR11).
//
// Renders the reviewed terminal-host add-ons (Ghostty + iTerm2) on the
// main-workspace left rail. This is a renderer of the host's
// terminal-host surface projection. The host owns process state; the
// renderer only:
//
//   - reads the public /terminal-host/status payload + the harness
//     registry projection (NOT /addons/status — that registry does
//     not include the harness-side terminal add-ons);
//   - renders text nodes only (`textContent`, `createElement`,
//     `append`). No innerHTML, no script injection, no raw fields;
//   - drives every action through an injected host transaction
//     (`enableTransaction` + `grantTransaction` + `launchTerminal` +
//     `fetchConnectionScript`);
//   - copies the connection script as text only (`navigator.clipboard
//     .writeText`, plus a manual-select fallback when the clipboard
//     API is unavailable);
//   - re-fetches the status on mount and after every completed
//     transaction.
//
// Intent citation:
//   docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §1
//   (Add-on Surfaces → Terminal) and §13 (CP-BR7), §14 (CP-BR8),
//   TERMINAL-ACTIVATION.md, ADR-047.

import {
  element,
  actionButton,
  statusBadgeForSurface,
  notInstalledBadge,
  buildTerminalsViewModel,
  TERMINAL_CARD_FIELD,
  DEFAULT_AGENT_ID,
} from "./terminal-cards.js";

const POLL_INTERVAL_MS = 4000;
const TEST_POLL_INTERVAL_MS = 0;

const TERMINALS_HEADER_TITLE = "Terminals";
const TERMINALS_HEADER_BODY =
  "Enable, grant, launch, and copy a connection script for the reviewed terminal-host add-ons (iTerm2, Ghostty). The host owns the bridge and the credentials; the renderer never reads secrets.";

// ---------------------------------------------------------------------------
// Per-id card actions row
// ---------------------------------------------------------------------------

function renderCardActions(view, tab, options) {
  const { onEnable, onGrant, onLaunch, onCopyScript, busyAddonId, lastError } = options;
  const actions = element("div", {
    className: "terminals-action-row",
    dataset: { addonId: tab.addonId, field: TERMINAL_CARD_FIELD },
  });

  const isBusy = busyAddonId === tab.addonId;

  // Enable / Disable — visible whenever the add-on is installed; the
  // host owns the install state, not the renderer. The transaction
  // is optimistic-concurrency; the seam is responsible for reading
  // the registry revision immediately before the POST.
  if (typeof onEnable === "function") {
    const enableLabel = isBusy ? "Working..." : tab.enabled ? "Disable" : "Enable";
    actions.append(
      actionButton({
        label: enableLabel,
        onClick: () => onEnable(tab),
        disabled: isBusy || !tab.installed,
        ariaLabel: tab.enabled ? `Disable ${tab.label}` : `Enable ${tab.label}`,
        testid: `terminals-enable-${tab.addonId}`,
      }),
    );
  }

  // Grant terminal-host — visible only when the capability is
  // missing. Operator-consented (window.confirm); never auto-grants.
  if (typeof onGrant === "function" && !tab.capabilityGranted && tab.installed) {
    actions.append(
      actionButton({
        label: isBusy ? "Working..." : "Launch & connect",
        onClick: () => onGrant(tab),
        disabled: isBusy,
        ariaLabel: `Launch ${tab.label} and connect it to the bridge`,
        testid: `terminals-grant-${tab.addonId}`,
      }),
    );
  }

  // Open in Terminal — gated on connected: true + a valid 0600
  // prompt file. The launch is host-side, the renderer only invokes
  // the injected transaction.
  const launchDisabled =
    isBusy ||
    !tab.installed ||
    !tab.compatible ||
    !tab.connected ||
    !view.promptValid ||
    !view.promptPath;
  actions.append(
    actionButton({
      label: isBusy ? "Working..." : "Open in Terminal",
      onClick: () => onLaunch?.(tab),
      disabled: launchDisabled,
      ariaLabel: `Launch ${tab.label} and attach the harness`,
      testid: `terminals-launch-${tab.addonId}`,
    }),
  );

  // Copy connection script — non-secret; 0600 token-file only.
  const copyDisabled = isBusy || !tab.installed || !tab.compatible;
  actions.append(
    actionButton({
      label: isBusy ? "Working..." : "Copy connection script",
      onClick: () => onCopyScript?.(tab),
      disabled: copyDisabled,
      ariaLabel: `Copy the connection script for ${tab.label}`,
      testid: `terminals-copy-${tab.addonId}`,
    }),
  );

  if (lastError && lastError.addonId === tab.addonId && lastError.message) {
    const errNode = element("p", {
      className: "terminals-card-error",
      dataset: { tone: lastError.tone ?? "warn" },
      ariaLive: "polite",
    });
    errNode.textContent = lastError.message;
    actions.append(errNode);
  }

  return actions;
}

function renderTerminalCard(view, tab, options) {
  const badge = tab.installed ? statusBadgeForSurface(tab) : notInstalledBadge();
  const card = element("article", {
    className: "terminals-card",
    dataset: {
      addonId: tab.addonId,
      tone: badge.tone,
      field: TERMINAL_CARD_FIELD,
    },
  });
  const header = element("header", { className: "terminals-card-header" });
  const title = element("strong");
  title.textContent = tab.label;
  const badgeNode = element("span", {
    className: "terminals-card-badge",
    dataset: { tone: badge.tone },
    ariaLabel: `${tab.label} status: ${badge.label}`,
  });
  badgeNode.textContent = badge.label;
  header.append(title, badgeNode);
  card.append(header);

  const detail = element("p", { className: "terminals-card-detail" });
  detail.textContent = tab.installed
    ? tab.connected
      ? `${tab.label} is auto-connecting to the bridge; Open in Terminal launches a new session.`
      : tab.compatible
        ? tab.capabilityGranted
          ? `Grant approved. Waiting for ${tab.label} to attach.`
          : `Grant the terminal-host capability to auto-connect. The copy script below attaches an already-running terminal.`
        : `${tab.label} is installed but not yet authorized.`
    : `${tab.label} is not installed on this bridge. Enable it from the Add-on catalog.`;
  card.append(detail);

  card.append(renderCardActions(view, tab, options));
  return card;
}

// ---------------------------------------------------------------------------
// Provider credential selector
// ---------------------------------------------------------------------------

function renderProviderSelectorShell() {
  const section = element("section", {
    className: "terminals-provider",
    dataset: { field: "terminals-provider" },
  });
  const label = element("label", {
    className: "terminals-provider-label",
    text: "Provider credential",
  });
  const select = element("select", { className: "terminals-provider-select" });
  select.dataset.testid = "terminals-provider-select";
  const hint = element("p", { className: "terminals-provider-hint" });
  section.append(label, select, hint);
  return { section, select, hint };
}

function syncProviderSelect(select, hint, providerOptions, selectedId) {
  const configured = providerOptions.filter((option) => option.configured);
  const hasSelected = providerOptions.some((option) => option.id === selectedId);
  const options = [
    { id: "", label: "No credential (use the harness's own config)", configured: true },
    ...providerOptions,
  ];
  select.replaceChildren(
    ...options.map((option) => {
      const label =
        option.id === ""
          ? option.label
          : option.configured
            ? option.label
            : `${option.label} (no credential)`;
      const node = element("option", { value: option.id, text: label });
      if (option.id !== "" && !option.configured) node.disabled = true;
      return node;
    }),
  );
  select.value = hasSelected ? selectedId : "";
  if (providerOptions.length === 0) {
    hint.textContent =
      "No pi-compatible provider profiles found. Add one in Settings → Providers to inject a credential.";
  } else if (configured.length === 0) {
    hint.textContent =
      "No configured provider credential. Add a credential in Settings → Providers to inject it into the session.";
  } else if (hasSelected) {
    hint.textContent =
      "The selected credential is injected under its host-owned env var when you run a session.";
  } else {
    hint.textContent =
      "Choose a provider credential, or leave unset to use the harness's own config.";
  }
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader() {
  return element(
    "section",
    {
      className: "terminals-header",
      dataset: { field: "terminals-header" },
    },
    [
      element("h2", { text: TERMINALS_HEADER_TITLE, className: "terminals-header-title" }),
      element("p", { className: "terminals-header-body", text: TERMINALS_HEADER_BODY }),
    ],
  );
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Render the Terminals workspace into a container.
 *
 * @param {HTMLElement} container
 * @param {{
 *   fetchStatus?: () => Promise<unknown>,
 *   fetchPromptPath?: () => Promise<unknown>,
 *   fetchProjection?: () => Promise<unknown>,
 *   fetchRegistry?: () => Promise<unknown>,
 *   launchTerminal?: (args: { terminalAddonId: string, promptPath: string, agentId: string, providerProfileId?: string }) => Promise<unknown>,
 *   fetchConnectionScript?: (args: { terminalAddonId: string, promptPath: string | null, providerProfileId?: string }) => Promise<unknown>,
 *   writePrompt?: (args: { text: string }) => Promise<unknown>,
 *   fetchProviderProfiles?: () => Promise<unknown>,
 *   enableTransaction?: (addonId: string, enabled: boolean) => Promise<unknown>,
 *   grantTransaction?: (addonId: string, capability: string) => Promise<unknown>,
 *   onOpenBridgeSettings?: () => void,
 *   pollIntervalMs?: number,
 *   windowRef?: { confirm?: (message?: string) => boolean },
 *   navigatorRef?: { clipboard?: { writeText?: (text: string) => Promise<void> } },
 * }} options
 */
export function renderTerminalsWorkspace(container, options = {}) {
  container.replaceChildren();
  container.append(renderHeader());

  const statusNode = element("p", {
    className: "terminals-status",
    ariaLive: "polite",
  });
  statusNode.textContent = "Reading terminal surfaces...";
  container.append(statusNode);

  const providerShell = renderProviderSelectorShell();
  container.append(providerShell.section);
  const providerSelect = providerShell.select;
  const providerHint = providerShell.hint;

  const cardsHost = element("section", {
    className: "terminals-cards",
    dataset: { field: "terminals-cards" },
  });
  container.append(cardsHost);

  const promptCard = renderPromptFileCard({ promptPath: null, promptValid: false });
  const promptHost = element("section", { className: "terminals-prompt-host" });
  promptHost.append(promptCard);
  container.append(promptHost);

  // Prompt editor — rendered once so the operator's draft survives the
  // refresh loop. The save button writes the text to the host's 0600
  // prompt path (the host owns the path; the renderer never invents it
  // and never reads the file content back).
  const promptEditorHost = element("section", { className: "terminals-prompt-editor" });
  const promptTextarea = element("textarea", {
    className: "terminals-prompt-textarea",
    ariaLabel: "Prompt text",
    placeholder: "Write the task prompt for the harness to run...",
    rows: "4",
  });
  const savePromptButton = actionButton({
    label: "Save prompt",
    onClick: onSavePrompt,
    ariaLabel: "Write the prompt to the host's 0600 prompt file",
    testid: "terminals-prompt-save",
  });
  promptEditorHost.append(promptTextarea, savePromptButton);
  container.append(promptEditorHost);

  const state = {
    busyAddonId: null,
    lastError: null,
    timer: null,
    selectedProviderProfileId: "",
    providerInitialized: false,
  };
  providerSelect.addEventListener("change", () => {
    state.selectedProviderProfileId = providerSelect.value;
  });

  // ---------------------------------------------------------------------
  // Host seams
  // ---------------------------------------------------------------------

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
  async function readProviderProfiles() {
    if (typeof options.fetchProviderProfiles === "function") return options.fetchProviderProfiles();
    return null;
  }
  async function readPrompt() {
    if (typeof options.fetchPromptPath === "function") return options.fetchPromptPath();
    return null;
  }

  // Fire-and-forget refresh. Always swallow rejections so an
  // unhandled-rejection doesn't fire when the test framework tears
  // down the DOM between a click and the refresh microtask.
  function scheduleRefresh() {
    void refresh().catch(() => undefined);
  }

  function setBusy(addonId) {
    state.busyAddonId = addonId;
    scheduleRefresh();
  }
  function setLastError(addonId, message, tone = "warn") {
    state.lastError = { addonId, message, tone };
    state.busyAddonId = null;
    scheduleRefresh();
  }
  function clearError() {
    state.lastError = null;
  }

  let currentView = {
    promptPath: null,
    promptValid: false,
    tabs: [],
    providerOptions: [],
    bridgeConnected: false,
  };

  async function refresh() {
    const [status, projection, registry, prompt, providerProfiles] = await Promise.all([
      readStatus().catch(() => null),
      readProjection().catch(() => null),
      readRegistry().catch(() => null),
      readPrompt().catch(() => null),
      readProviderProfiles().catch(() => null),
    ]);
    const projectionRuntime = Array.isArray(projection?.runtimeList) ? projection.runtimeList : [];
    const view = buildTerminalsViewModel({
      status: status ?? null,
      projectionRuntime,
      registry: registry ?? null,
      prompt: prompt ?? null,
      providerProfiles: providerProfiles ?? [],
    });
    currentView = view;
    if (!state.providerInitialized) {
      const configured = view.providerOptions.filter((option) => option.configured);
      if (configured.length === 1) state.selectedProviderProfileId = configured[0].id;
      state.providerInitialized = true;
    }
    syncProviderSelect(
      providerSelect,
      providerHint,
      view.providerOptions,
      state.selectedProviderProfileId,
    );
    promptHost.replaceChildren(renderPromptFileCard(view));
    cardsHost.replaceChildren();
    for (const tab of view.tabs) {
      cardsHost.append(
        renderTerminalCard(view, tab, {
          onEnable: onEnable,
          onGrant: onGrant,
          onLaunch: onLaunch,
          onCopyScript: onCopyScript,
          busyAddonId: state.busyAddonId,
          lastError: state.lastError,
        }),
      );
    }
    if (!view.bridgeConnected) {
      statusNode.textContent = "Bridge not connected — open Settings → Bridge Target to start it.";
    } else if (view.tabs.some((tab) => tab.connected)) {
      statusNode.textContent = `${view.tabs.find((tab) => tab.connected)?.label} is connected to the bridge.`;
    } else if (view.tabs.some((tab) => tab.installed && tab.capabilityGranted)) {
      statusNode.textContent = "Bridge connected. Waiting for terminal adapters to attach.";
    } else {
      statusNode.textContent =
        "Bridge connected. Enable a reviewed add-on, then grant the terminal-host capability.";
    }
  }

  // ---------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------

  async function onEnable(tab) {
    if (typeof options.enableTransaction !== "function") {
      setLastError(tab.addonId, "Enable is not available in this environment.", "warn");
      return;
    }
    const nextEnabled = !tab.enabled;
    clearError();
    setBusy(tab.addonId);
    try {
      await options.enableTransaction(tab.addonId, nextEnabled);
    } catch (error) {
      const message = error && typeof error.message === "string" ? error.message : "Enable failed.";
      setLastError(tab.addonId, message, "warn");
      return;
    }
    state.busyAddonId = null;
    scheduleRefresh();
  }

  // ---------------------------------------------------------------------
  // Grant terminal-host (operator-consented; never auto-grants)
  // ---------------------------------------------------------------------

  function getConfirm() {
    if (options.windowRef && typeof options.windowRef.confirm === "function") {
      return options.windowRef.confirm;
    }
    if (typeof globalThis.confirm === "function") return globalThis.confirm;
    return null;
  }

  async function onGrant(tab) {
    if (typeof options.grantTransaction !== "function") {
      setLastError(tab.addonId, "Grant is not available in this environment.", "warn");
      return;
    }
    const confirm = getConfirm();
    if (confirm) {
      const ok = confirm(
        `Authorize ${tab.label} to use the terminal-host capability? ` +
          "This grants the system-scope, degradable terminal-host privilege.",
      );
      if (!ok) {
        setLastError(tab.addonId, "Grant cancelled — terminal-host not authorized.", "info");
        return;
      }
    }
    clearError();
    setBusy(tab.addonId);
    try {
      await options.grantTransaction(tab.addonId, "terminal-host");
    } catch (error) {
      const message = error && typeof error.message === "string" ? error.message : "Grant failed.";
      setLastError(tab.addonId, message, "warn");
      return;
    }
    state.busyAddonId = null;
    scheduleRefresh();
  }

  // ---------------------------------------------------------------------
  // Launch (Open in Terminal)
  // ---------------------------------------------------------------------

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
        providerProfileId: state.selectedProviderProfileId,
      });
    } catch (error) {
      setLastError(tab.addonId, safeError(error), "warn");
      return;
    }
    state.busyAddonId = null;
    if (result && result.reason === "bridge-not-running") {
      setLastError(tab.addonId, "Bridge not running — open Settings → Bridge Target.", "warn");
      if (typeof options.onOpenBridgeSettings === "function") options.onOpenBridgeSettings();
      return;
    }
    if (result && result.reason === "capability-not-granted") {
      setLastError(
        tab.addonId,
        "Authorize the terminal-host capability to use Open in Terminal.",
        "warn",
      );
      return;
    }
    if (result && result.reason === "missing-credential") {
      setLastError(
        tab.addonId,
        "No provider credential is configured for the selected profile — add one in Settings → Providers.",
        "warn",
      );
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
      setLastError(
        tab.addonId,
        "The terminal adapter rejected the launch. Try the copy-connection-script fallback.",
        "warn",
      );
      return;
    }
    if (result && result.ok) {
      clearError();
      statusNode.textContent = `Launched ${tab.label}.`;
    } else if (result && result.reason) {
      setLastError(tab.addonId, `Launch failed: ${result.reason}.`, "warn");
    } else {
      setLastError(tab.addonId, "Launch returned no result.", "warn");
    }
    scheduleRefresh();
  }

  // ---------------------------------------------------------------------
  // Copy connection script
  // ---------------------------------------------------------------------

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
      setLastError(tab.addonId, safeError(error), "warn");
      return;
    }
    state.busyAddonId = null;
    if (result && result.reason === "bridge-not-running") {
      setLastError(tab.addonId, "Bridge not running — open Settings → Bridge Target.", "warn");
      if (typeof options.onOpenBridgeSettings === "function") options.onOpenBridgeSettings();
      return;
    }
    if (result && result.reason === "capability-not-granted") {
      setLastError(
        tab.addonId,
        "Authorize the terminal-host capability to copy a connection script.",
        "warn",
      );
      return;
    }
    if (!result || !result.ok || typeof result.command !== "string") {
      setLastError(
        tab.addonId,
        "Copy failed: the host did not return a connection script.",
        "warn",
      );
      return;
    }
    const ok = await copyToClipboard(result.command);
    if (ok) {
      statusNode.textContent = "Connection script copied to the clipboard.";
    } else {
      statusNode.textContent = "Clipboard API unavailable — select the script and copy manually.";
    }
    scheduleRefresh();
  }

  function getClipboard() {
    if (options.navigatorRef && options.navigatorRef.clipboard)
      return options.navigatorRef.clipboard;
    if (typeof navigator !== "undefined" && navigator && navigator.clipboard)
      return navigator.clipboard;
    return null;
  }
  async function copyToClipboard(text) {
    const cb = getClipboard();
    if (!cb || typeof cb.writeText !== "function") return false;
    try {
      await cb.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  async function onSavePrompt() {
    if (typeof options.writePrompt !== "function") {
      statusNode.textContent = "Prompt writing is not available in this environment.";
      return;
    }
    const text = promptTextarea.value ?? "";
    if (text.trim().length === 0) {
      statusNode.textContent = "Write a prompt first.";
      return;
    }
    if (text.length > 65536) {
      statusNode.textContent = "Prompt is too long (max 65536 characters).";
      return;
    }
    try {
      await options.writePrompt({ text });
      statusNode.textContent =
        "Prompt saved. Open in Terminal is now enabled for connected terminals.";
    } catch (error) {
      statusNode.textContent = `Prompt save failed: ${safeError(error)}`;
      return;
    }
    scheduleRefresh();
  }

  // ---------------------------------------------------------------------
  // Prompt file card
  // ---------------------------------------------------------------------

  function renderPromptFileCard(view) {
    const card = element("section", {
      className: "terminals-prompt-card",
      dataset: { tone: view.promptValid ? "info" : "warn" },
    });
    const label = element("strong", { text: "Prompt file" });
    const value = element("div", { className: "terminals-prompt-card-value" });
    value.textContent = view.promptPath ?? "—";
    const detail = element("p", { className: "terminals-prompt-card-detail" });
    detail.textContent = view.promptValid
      ? "A 0600 prompt file is in place. Open in Terminal is enabled for connected terminals."
      : "No 0600 prompt file yet. Write a prompt below and save it — the launch button stays disabled until a valid 0600 file exists.";
    card.append(label, value, detail);
    return card;
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  // Suppress unhandled-rejection warnings when the test framework
  // tears down the DOM between the user clicking a card and the
  // renderer's `refresh` microtask resolving. The renderer is the
  // only place this can be caught — the test cannot reach into the
  // closure to cancel the refresh.
  void refresh().catch(() => undefined);
  const pollMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  if (pollMs > 0) {
    state.timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, pollMs);
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

function safeError(error) {
  if (!error) return "Unknown error.";
  if (typeof error === "string") return error;
  if (typeof error.message === "string") return error.message;
  return "Unknown error.";
}

export { DEFAULT_AGENT_ID };
