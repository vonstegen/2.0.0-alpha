import { delegationGuidanceText } from "./delegation-guidance.js";

function runtimeLine(hermesStatus = {}) {
  const cli = hermesStatus.available ? "CLI detected" : "CLI not detected";
  const execution = hermesStatus.executionEnabled ? "execution enabled" : "execution disabled";
  const mode = hermesStatus.mode ? ` · ${hermesStatus.mode}` : "";
  return `${cli} · ${execution}${mode}`;
}

function taskCountsLine(taskCounts = {}) {
  const entries = Object.entries(taskCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length
    ? entries.map(([status, count]) => `${status}: ${count}`).join(", ")
    : "no recorded tasks";
}

function dashboardLine(dashboard = {}) {
  return dashboard.running
    ? `Dashboard running · ${dashboard.url}`
    : `${dashboard.rawStatus || "Hermes dashboard stopped"} · ${dashboard.detail || "Start it to embed the workspace."}`;
}

function renderStatusText({ addon, dashboard, hermesStatus }) {
  const lines = [
    dashboardLine(dashboard),
    runtimeLine(hermesStatus),
    `Tasks: ${taskCountsLine(hermesStatus?.taskCounts)}`,
  ];
  if (addon?.available && !addon?.execution?.runtimeAvailable) {
    lines.push("Hermes add-on contract is installed, but the local Hermes CLI runtime was not detected.");
  } else if (!addon?.available) {
    lines.push("Hermes add-on contract is not registered in this build.");
  }
  if (hermesStatus?.boundary) {
    lines.push(`Boundary: ${hermesStatus.boundary}`);
  }
  if (!hermesStatus?.available || !hermesStatus?.executionEnabled || !addon?.execution?.runtimeAvailable) {
    lines.push(delegationGuidanceText({
      blockedReason: hermesStatus?.blockedReason || "",
      executionEnabled: Boolean(hermesStatus?.executionEnabled),
      runtimeAvailable: Boolean(addon?.execution?.runtimeAvailable && hermesStatus?.available),
      target: "hermes"
    }));
  }
  return lines.filter(Boolean).join("\n");
}

export function renderHermesDashboardWorkspace({ container, bridgeRequest, statusForAddon }) {
  const section = document.createElement("section");
  section.className = "hermes-dashboard-workspace";
  section.setAttribute("aria-label", "Hermes dashboard workspace");
  const status = document.createElement("div");
  status.className = "dashboard-status";
  status.textContent = "Checking Hermes status...";
  const frameCard = document.createElement("section");
  frameCard.className = "dashboard-frame-card";
  const iframe = document.createElement("iframe");
  iframe.title = "Hermes dashboard";
  iframe.hidden = true;
  const placeholder = document.createElement("div");
  placeholder.className = "dashboard-placeholder";
  const placeholderTitle = document.createElement("strong");
  placeholderTitle.textContent = "Hermes dashboard is not running";
  const placeholderBody = document.createElement("p");
  placeholderBody.textContent = "Start the local Hermes dashboard to load it here. Delegation remains available from Augmentor chat with /hermes.";
  const actions = document.createElement("div");
  actions.className = "module-action-row";
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Start Dashboard";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.textContent = "Stop";
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.textContent = "Refresh";
  actions.append(start, stop, refresh);
  placeholder.append(placeholderTitle, placeholderBody, actions);
  frameCard.append(iframe, placeholder);
  section.append(status, frameCard);
  container.append(section);

  const setDashboardState = ({ addon, dashboard, hermesStatus }) => {
    const running = Boolean(dashboard?.running);
    iframe.hidden = !running;
    placeholder.hidden = running;
    if (running) {
      iframe.src = dashboard.url;
    }
    status.textContent = renderStatusText({ addon, dashboard, hermesStatus });
  };
  const loadStatus = async () => {
    const [addon, dashboard, hermesStatus] = await Promise.all([
      statusForAddon("addon.hermes"),
      bridgeRequest("/hermes/dashboard/status", { method: "POST", body: { port: 9119 } }),
      bridgeRequest("/hermes/status", { method: "POST", body: {} }),
    ]);
    setDashboardState({ addon, dashboard, hermesStatus });
  };
  const startDashboard = async () => {
    start.disabled = true;
    status.textContent = "Starting Hermes dashboard...";
    try {
      const dashboard = await bridgeRequest("/hermes/dashboard/start", {
        method: "POST",
        body: { host: "127.0.0.1", port: 9119, includeTui: true }
      });
      const [addon, hermesStatus] = await Promise.all([
        statusForAddon("addon.hermes"),
        bridgeRequest("/hermes/status", { method: "POST", body: {} }),
      ]);
      setDashboardState({ addon, dashboard, hermesStatus });
    } catch (error) {
      status.textContent = `Hermes dashboard failed to start: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      start.disabled = false;
    }
  };
  start.addEventListener("click", async () => {
    await startDashboard();
  });
  stop.addEventListener("click", async () => {
    stop.disabled = true;
    status.textContent = "Stopping Hermes dashboard...";
    try {
      const dashboard = await bridgeRequest("/hermes/dashboard/stop", { method: "POST", body: { port: 9119 } });
      const [addon, hermesStatus] = await Promise.all([
        statusForAddon("addon.hermes"),
        bridgeRequest("/hermes/status", { method: "POST", body: {} }),
      ]);
      setDashboardState({ addon, dashboard, hermesStatus });
    } catch (error) {
      status.textContent = `Hermes dashboard failed to stop: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      stop.disabled = false;
    }
  });
  refresh.addEventListener("click", () => void loadStatus().catch((error) => {
    status.textContent = `Hermes status unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }));
  void loadStatus().catch((error) => {
    status.textContent = `Hermes status unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }).then(() => {
    if (iframe.hidden) {
      void startDashboard();
    }
  });
}
