// ResonantOS Bridge & Runtimes settings section (CP-BR6).
//
// This renderer turns the closed view model produced by
// `bridge-runtimes-view.js` into the Settings → Bridge & Runtimes
// surface. The renderer:
//
//   - reads ONLY the public fields exposed by the view model (no
//     inspection of raw projection, bootstrap snapshot, or host
//     private state);
//   - renders text nodes only (`textContent`, `createElement`,
//     `append`). No `innerHTML`, no `dangerouslySetInnerHTML`, no
//     script injection;
//   - drives every action through an injected host transaction;
//   - re-fetches the projection on mount and after every completed
//     transaction, then drops stale responses by `projectionGeneration`;
//   - exposes accessible status badges and `aria-live` regions for
//     state transitions, plus loading/empty/degraded/failed states
//     for every view.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §12 (CP-BR6), BRIDGE-RUNTIME-PROJECTION.md, ADR-047.

import {
  metricCard,
  noteCard,
  safeErrorMessage,
  setStatus,
  settingsHeader,
} from "./settings-common.js";
import {
  buildBridgeRuntimesView,
  shouldAcceptProjection,
  BRIDGE_STATUS_LABELS,
  RUNTIME_STATUS_LABELS,
  CONNECTOR_STATE_LABELS,
  AUTHORIZATION_STATE_LABELS,
  VIEW_TONE,
} from "./bridge-runtimes-view.js";

const POLL_INTERVAL_MS = 2000;
const TEST_POLL_INTERVAL_MS = 0; // tests inject their own loop or set this to 0 to disable
const UNKNOWN_RUNTIME_RUNTIME_TYPE = "unknown";

const CORE_BRIDGE_FIELD = "core-bridge";
const RUNTIMES_FIELD = "runtimes";
const CONNECTORS_FIELD = "connectors";
const SESSIONS_FIELD = "sessions";
const DIAGNOSTICS_FIELD = "diagnostics";

// ---------------------------------------------------------------------------
// DOM helpers (text-only)
// ---------------------------------------------------------------------------

function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "dataset") {
      for (const [dk, dv] of Object.entries(value)) {
        node.dataset[dk] = String(dv);
      }
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "aria" && value && typeof value === "object") {
      for (const [ak, av] of Object.entries(value)) {
        node.setAttribute(`aria-${ak}`, String(av));
      }
    } else if (key === "className") {
      node.className = String(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function badge(label, tone, { live = false, labelText = "" } = {}) {
  const span = element("span", { className: "settings-badge", dataset: { tone } });
  if (live) span.setAttribute("aria-live", "polite");
  if (labelText) span.setAttribute("aria-label", labelText);
  span.textContent = label;
  return span;
}

function statusLabel(viewState) {
  if (viewState === "loading") return "Loading…";
  if (viewState === "empty") return "No entries.";
  if (viewState === "degraded") return "Degraded — projection unavailable";
  if (viewState === "failed") return "Failed";
  return "Ready";
}

function actionButton({ label, onClick, disabled = false, ariaLabel, testid }) {
  const button = element("button", { type: "button", className: "settings-action" });
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  if (testid) button.dataset.testid = testid;
  button.textContent = label;
  if (disabled) button.disabled = true;
  if (typeof onClick === "function") {
    button.addEventListener("click", onClick);
  }
  return button;
}

function liveRegion({ id, label, tone }) {
  const region = element("div", {
    className: "settings-live-region",
    dataset: { tone },
    aria: { live: "polite", atomic: "true", labelledby: id },
  });
  const labelNode = element("span", { className: "settings-live-region-label", id });
  labelNode.textContent = label;
  region.appendChild(labelNode);
  return region;
}

// ---------------------------------------------------------------------------
// View renderers
// ---------------------------------------------------------------------------

function renderOverview(view) {
  const section = element("section", {
    className: "settings-provider-card",
    dataset: { field: CORE_BRIDGE_FIELD, state: view.viewState.overview, tone: view.overview.tone },
  });
  const heading = element("strong", { className: "settings-provider-heading" });
  heading.textContent = "Core bridge";
  const summary = element("p", { className: "settings-provider-help" });
  summary.textContent =
    "Core-bridge health is sourced from the bootstrap host when the projection is unavailable, and from the projection when the bridge is connected.";
  section.append(heading, summary);

  const grid = element("div", { className: "settings-health-grid" });
  grid.append(
    metricCard({
      label: "State",
      value: view.overview.label,
      detail: view.overview.failureCode
        ? `Failure code: ${view.overview.failureCode}`
        : "No failure code reported.",
      tone: view.overview.tone,
    }),
    metricCard({
      label: "Endpoint",
      value: view.overview.endpoint ?? "—",
      detail: [
        view.overview.publicEndpoint && view.overview.publicEndpoint !== view.overview.endpoint
          ? `Public ${view.overview.publicEndpoint}`
          : null,
        view.overview.version ? `Version ${view.overview.version}` : "Version unknown.",
      ]
        .filter(Boolean)
        .join(" · "),
      tone: view.overview.tone === VIEW_TONE.error ? VIEW_TONE.error : VIEW_TONE.info,
    }),
    metricCard({
      label: "Uptime",
      value: view.overview.uptimeSeconds == null ? "—" : `${view.overview.uptimeSeconds}s`,
      detail: view.overview.startedAt
        ? `Started ${view.overview.startedAt}`
        : "Start time unknown.",
      tone: VIEW_TONE.info,
    }),
    metricCard({
      label: "Instance",
      value: view.overview.instanceId ?? "—",
      detail:
        view.overview.generation == null
          ? "Generation unknown."
          : `Generation ${view.overview.generation}.`,
      tone: VIEW_TONE.info,
    }),
  );
  section.append(grid);

  section.append(
    badge(
      view.viewState.overview === "ready" ? "Live" : statusLabel(view.viewState.overview),
      view.overview.tone,
      { live: true, labelText: "Core bridge status" },
    ),
  );
  return section;
}

function renderRuntimeRow(runtime, options) {
  const row = element("article", {
    className: "settings-runtime-row",
    dataset: {
      addonId: runtime.addonId,
      tone: runtime.tone,
    },
  });
  const header = element("header", { className: "settings-runtime-row-header" });
  const title = element("strong");
  title.textContent = runtime.label;
  const subtitle = element("span", { className: "settings-runtime-row-type" });
  subtitle.textContent =
    runtime.runtimeType === UNKNOWN_RUNTIME_RUNTIME_TYPE
      ? "Runtime type: unknown"
      : `Runtime type: ${runtime.runtimeType}`;
  header.append(title, subtitle);
  row.append(header);

  const detail = element("p", { className: "settings-runtime-row-detail" });
  const statusBadge = badge(runtime.statusLabel, runtime.tone, {
    live: true,
    labelText: `Runtime ${runtime.label} status`,
  });
  detail.append(
    statusBadge,
    document.createTextNode(" "),
    document.createTextNode(
      runtime.activeSessionCount === 1
        ? "1 active session"
        : `${runtime.activeSessionCount} active sessions`,
    ),
  );
  if (runtime.publicFailureCode) {
    detail.append(
      document.createTextNode(" — "),
      document.createTextNode(`Failure code: ${runtime.publicFailureCode}`),
    );
  }
  row.append(detail);

  const actions = element("div", { className: "settings-action-row" });
  const onToggle = async (nextEnabled) => {
    if (typeof options.onToggleEnabled !== "function") return;
    await options.onToggleEnabled(runtime, nextEnabled);
  };
  if (options.actions.enableDisable) {
    actions.append(
      actionButton({
        label: runtime.status === "inactive" ? "Enable" : "Disable",
        onClick: () => onToggle(runtime.status === "inactive"),
        ariaLabel: `${runtime.status === "inactive" ? "Enable" : "Disable"} ${runtime.label}`,
        testid: `runtime-toggle-${runtime.addonId}`,
      }),
    );
  }
  if (options.actions.restart) {
    actions.append(
      actionButton({
        label: "Restart",
        onClick: () => options.onRestart?.(runtime),
        ariaLabel: `Restart ${runtime.label}`,
        testid: `runtime-restart-${runtime.addonId}`,
      }),
    );
  }
  if (actions.childElementCount > 0) row.append(actions);
  return row;
}

function renderRuntimes(view, options) {
  const section = element("section", {
    className: "settings-provider-card",
    dataset: { field: RUNTIMES_FIELD, state: view.viewState.runtimes },
  });
  const heading = element("strong", { className: "settings-provider-heading" });
  heading.textContent = "Add-on runtimes";
  const summary = element("p", { className: "settings-provider-help" });
  summary.textContent =
    "Per-runtime lifecycle state. Enable/disable routes through a host transaction; restart is hidden unless the host exposes a real restart transaction.";
  section.append(heading, summary);

  if (view.viewState.runtimes === "loading") {
    section.append(element("p", { className: "settings-status", text: "Loading runtimes…" }));
    return section;
  }
  if (view.viewState.runtimes === "empty") {
    section.append(
      element("p", { className: "settings-status", text: "No add-on runtimes are installed." }),
    );
    return section;
  }
  if (view.viewState.runtimes === "degraded") {
    section.append(
      element("p", {
        className: "settings-status",
        text: "Bridge is offline or failed. Online runtime detail is unavailable.",
      }),
    );
    return section;
  }

  const list = element("div", { className: "settings-runtime-list" });
  for (const runtime of view.runtimes) {
    list.append(
      renderRuntimeRow(runtime, {
        actions: view.actions,
        onToggleEnabled: options.onToggleEnabled,
        onRestart: options.onRestart,
      }),
    );
  }
  section.append(list);
  return section;
}

function renderConnectors(view) {
  const section = element("section", {
    className: "settings-provider-card",
    dataset: { field: CONNECTORS_FIELD, state: view.viewState.connectors },
  });
  const heading = element("strong", { className: "settings-provider-heading" });
  heading.textContent = "Connectors";
  const summary = element("p", { className: "settings-provider-help" });
  summary.textContent =
    "Public connection and authorization state per connector. Last-successful-health is shown as — when the host has not recorded a public timestamp.";
  section.append(heading, summary);

  if (view.viewState.connectors === "loading") {
    section.append(element("p", { className: "settings-status", text: "Loading connectors…" }));
    return section;
  }
  if (view.viewState.connectors === "empty") {
    section.append(
      element("p", { className: "settings-status", text: "No connectors are installed." }),
    );
    return section;
  }
  if (view.viewState.connectors === "degraded") {
    section.append(
      element("p", {
        className: "settings-status",
        text: "Bridge is offline or failed. Online connector detail is unavailable.",
      }),
    );
    return section;
  }

  const list = element("div", { className: "settings-connector-list" });
  for (const connector of view.connectors) {
    const row = element("article", {
      className: "settings-connector-row",
      dataset: { addonId: connector.addonId, tone: "info" },
    });
    const header = element("header", { className: "settings-runtime-row-header" });
    const title = element("strong");
    title.textContent = connector.label;
    header.append(title);
    const stateBadge = badge(
      connector.connectionLabel,
      connector.connectionState === "enabled" ? VIEW_TONE.ok : VIEW_TONE.info,
      { live: true, labelText: `Connector ${connector.label} connection state` },
    );
    const authBadge = badge(
      connector.authorizationLabel,
      connector.authorizationState === "granted"
        ? VIEW_TONE.ok
        : connector.authorizationState === "revoked" || connector.authorizationState === "missing"
          ? VIEW_TONE.error
          : VIEW_TONE.warn,
      { live: true, labelText: `Connector ${connector.label} authorization state` },
    );
    row.append(header, stateBadge, document.createTextNode(" "), authBadge);
    if (connector.lastSuccessfulHealthAt) {
      const detail = element("p", { className: "settings-runtime-row-detail" });
      detail.textContent = `Last successful health: ${connector.lastSuccessfulHealthAt}`;
      row.append(detail);
    } else {
      const detail = element("p", { className: "settings-runtime-row-detail" });
      detail.textContent = "Last successful health: —";
      row.append(detail);
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

function renderSessions(view) {
  const section = element("section", {
    className: "settings-provider-card",
    dataset: { field: SESSIONS_FIELD, state: view.viewState.sessions },
  });
  const heading = element("strong", { className: "settings-provider-heading" });
  heading.textContent = "Active sessions";
  const summary = element("p", { className: "settings-provider-help" });
  summary.textContent =
    "Public session identifiers and counts. The host never exposes private session data.";
  section.append(heading, summary);

  if (view.viewState.sessions === "loading") {
    section.append(element("p", { className: "settings-status", text: "Loading sessions…" }));
    return section;
  }
  if (view.viewState.sessions === "empty") {
    section.append(element("p", { className: "settings-status", text: "No active sessions." }));
    return section;
  }
  if (view.viewState.sessions === "degraded") {
    section.append(
      element("p", {
        className: "settings-status",
        text: "Bridge is offline or failed. Online session detail is unavailable.",
      }),
    );
    return section;
  }

  const list = element("ul", { className: "settings-session-list" });
  for (const session of view.sessions) {
    const item = element("li", { dataset: { addonId: session.addonId } });
    item.textContent = `${session.addonId} · ${session.activeSessionCount} active session${
      session.activeSessionCount === 1 ? "" : "s"
    }`;
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderDiagnostics(view) {
  const section = element("section", {
    className: "settings-provider-card",
    dataset: { field: DIAGNOSTICS_FIELD, state: view.viewState.diagnostics },
  });
  const heading = element("strong", { className: "settings-provider-heading" });
  heading.textContent = "Diagnostics";
  const summary = element("p", { className: "settings-provider-help" });
  summary.textContent =
    "Public failure code, update mechanism, and projection generation. Raw errors and paths are never rendered.";
  section.append(heading, summary);

  if (view.viewState.diagnostics === "loading") {
    section.append(element("p", { className: "settings-status", text: "Loading diagnostics…" }));
    return section;
  }
  if (view.viewState.diagnostics === "degraded") {
    section.append(
      element("p", {
        className: "settings-status",
        text: "Bridge is offline or failed. Bootstrap status is the only available source.",
      }),
    );
  }

  const items = [];
  items.push(
    element("p", {
      className: "settings-runtime-row-detail",
      text: `Public failure code: ${view.overview.failureCode ?? "none"}`,
    }),
  );
  items.push(
    element("p", {
      className: "settings-runtime-row-detail",
      text: `Update mechanism: ${view.updateMechanism ?? "polling"}`,
    }),
  );
  items.push(
    element("p", {
      className: "settings-runtime-row-detail",
      text:
        view.projectionGeneration == null
          ? "Projection generation: not yet fetched."
          : `Projection generation: ${view.projectionGeneration}`,
    }),
  );
  for (const item of items) section.append(item);
  return section;
}

// ---------------------------------------------------------------------------
// Section entry point
// ---------------------------------------------------------------------------

/**
 * Render the Bridge & Runtimes section.
 *
 * @param {HTMLElement} container
 * @param {{
 *   bridgeRequest: ((route: string, options?: object) => Promise<unknown>) | null,
 *   fetchProjection: () => Promise<unknown>,
 *   getBootstrapSnapshot: () => unknown,
 *   enableTransaction: (addonId: string, enabled: boolean) => Promise<void>,
 *   supportedActions?: {
 *     enableDisable?: boolean,
 *     retry?: boolean,
 *     restart?: boolean,
 *     terminateSession?: boolean,
 *   },
 *   pollIntervalMs?: number,
 *   document?: { hidden?: boolean },
 *   setIntervalFn?: (fn: () => void, ms: number) => unknown,
 *   clearIntervalFn?: (handle: unknown) => void,
 * }} [options]
 */
export function renderBridgeRuntimesSection(container, options = {}) {
  container.replaceChildren();

  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;

  const header = settingsHeader({
    eyebrow: "Bridge infrastructure",
    title: "Bridge & Runtimes",
    body: "Core bridge health, add-on runtimes, connectors, active sessions, and redacted diagnostics. All actions are host transactions — no local flags.",
  });
  const statusNode = document.createElement("p");
  statusNode.className = "settings-status";
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  setStatus(statusNode, "Loading projection…", "info");
  const live = liveRegion({
    id: "bridge-runtimes-live",
    label: "Bridge & Runtimes status",
    tone: VIEW_TONE.info,
  });

  const ownership = noteCard({
    title: "Authority boundary",
    body: "The bridge host owns process and lifecycle authority. This surface renders the public projection only; restart/retry buttons stay hidden until the host exposes a real transaction for them.",
  });

  container.append(header, statusNode, ownership, live);

  let currentView = null;
  let inflight = false;
  let timer = null;

  const renderView = (view) => {
    container.replaceChildren(header, statusNode, ownership, live);
    container.append(
      renderOverview(view),
      renderRuntimes(view, {
        onToggleEnabled: async (runtime, nextEnabled) => {
          if (!options.enableTransaction) return;
          setStatus(statusNode, `${nextEnabled ? "Enabling" : "Disabling"} ${runtime.label}…`);
          try {
            await options.enableTransaction(runtime.addonId, nextEnabled);
            setStatus(statusNode, `${runtime.label} ${nextEnabled ? "enabled" : "disabled"}.`);
            await refresh();
          } catch (error) {
            setStatus(statusNode, `Action failed: ${safeErrorMessage(error)}`, "error");
          }
        },
        onRestart: async (runtime) => {
          setStatus(statusNode, `Restart is not exposed by the host. (${runtime.label})`, "warn");
        },
      }),
      renderConnectors(view),
      renderSessions(view),
      renderDiagnostics(view),
    );
    setStatus(
      statusNode,
      view.viewState.overview === "ready"
        ? "Projection live."
        : `Projection: ${view.viewState.overview}.`,
      view.overview.tone,
    );
  };

  const renderError = (error) => {
    container.replaceChildren(header, statusNode, ownership, live);
    setStatus(statusNode, `Projection fetch failed: ${safeErrorMessage(error)}`, "error");
    container.append(
      renderDiagnostics(
        currentView ?? {
          viewState: { diagnostics: "loading" },
          overview: { failureCode: null, status: "offline" },
          updateMechanism: null,
          projectionGeneration: null,
        },
      ),
    );
  };

  const applyProjection = async (projection) => {
    if (projection && !shouldAcceptProjection(currentView, projection)) {
      return; // stale; drop
    }
    const view = buildBridgeRuntimesView({
      projection,
      bootstrapSnapshot: await readBootstrap(),
      enableTransaction: options.enableTransaction,
      supportedActions: options.supportedActions ?? {},
    });
    currentView = view;
    renderView(view);
  };

  const readBootstrap = async () => {
    if (typeof options.getBootstrapSnapshot === "function") {
      return await options.getBootstrapSnapshot();
    }
    return null;
  };

  const refresh = async () => {
    if (inflight) return;
    const bootstrap = await readBootstrap();
    const bridgeConnected = bootstrap?.status === "connected";
    if (!bridgeConnected) {
      // Bootstrap is the OFFLINE source. Only call the projection
      // route when the bridge reports connected; otherwise render a
      // bootstrap-only view.
      const view = buildBridgeRuntimesView({
        projection: null,
        bootstrapSnapshot: bootstrap,
        enableTransaction: options.enableTransaction,
        supportedActions: options.supportedActions ?? {},
      });
      currentView = view;
      renderView(view);
      return;
    }
    if (typeof options.fetchProjection !== "function") {
      setStatus(statusNode, "Projection fetcher is not configured for this surface.", "warn");
      return;
    }
    inflight = true;
    try {
      const projection = await options.fetchProjection();
      await applyProjection(projection);
    } catch (error) {
      renderError(error);
    } finally {
      inflight = false;
    }
  };

  if (typeof options.fetchProjection === "function") {
    void refresh();
    if (pollIntervalMs > 0) {
      timer = setIntervalFn(() => {
        if (typeof document !== "undefined" && document.hidden) return;
        void refresh();
      }, pollIntervalMs);
    }
  } else {
    setStatus(statusNode, "Projection fetcher is not configured for this surface.", "warn");
    void (async () => {
      renderView(
        buildBridgeRuntimesView({
          projection: null,
          bootstrapSnapshot: await readBootstrap(),
          enableTransaction: options.enableTransaction,
          supportedActions: options.supportedActions ?? {},
        }),
      );
    })();
  }

  return {
    async refresh() {
      await refresh();
    },
    stop() {
      if (timer != null) clearIntervalFn(timer);
      timer = null;
    },
    getCurrentView() {
      return currentView;
    },
    // Test seams
    _renderView: renderView,
    _applyProjection: applyProjection,
  };
}

export {
  BRIDGE_STATUS_LABELS,
  RUNTIME_STATUS_LABELS,
  CONNECTOR_STATE_LABELS,
  AUTHORIZATION_STATE_LABELS,
  VIEW_TONE,
};
