// ResonantOS bridge bootstrap settings section (CP-BR2).
//
// Renders the explicit "Stop bridge" / "Retry" actions the prompt requires
// (MV3 service workers do not provide a reliable unload hook). The renderer
// asks the background service worker to perform the stop / retry; the SW
// owns the orchestrator and the native-messaging host. The renderer never
// calls chrome.runtime.connectNative directly.

import { metricCard, noteCard, safeErrorMessage, setStatus, settingsHeader } from "./settings-common.js";
import { createBootstrapRenderer } from "../bootstrap-renderer.js";

function actionRow({ buttons }) {
  const row = document.createElement("div");
  row.className = "settings-action-row";
  for (const button of buttons) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = `settings-action-button${button.tone ? ` settings-action-button-${button.tone}` : ""}`;
    element.textContent = button.label;
    element.disabled = Boolean(button.disabled);
    if (button.onClick) element.addEventListener("click", () => button.onClick());
    row.append(element);
  }
  return row;
}

function healthCard({ label, value, detail, tone }) {
  return metricCard({ label, value, detail, tone });
}

export function renderBridgeBootstrapSection(container) {
  container.innerHTML = "";
  container.append(
    settingsHeader({
      eyebrow: "Bridge bootstrap",
      title: "Bridge bootstrap",
      body: "ResonantOS owns one authenticated loopback core bridge. The native-messaging bootstrap host decides when the bridge runs and what it is allowed to do. Use the actions below only when the automatic lifecycle is stuck.",
    })
  );

  const statusNode = document.createElement("p");
  statusNode.className = "settings-status";
  setStatus(statusNode, "Reading bootstrap state...", "");
  container.append(statusNode);

  const healthGrid = document.createElement("div");
  healthGrid.className = "settings-health-grid";
  const [statusCard, endpointCard, versionCard, failureCard] = [
    healthCard({ label: "Bridge state", value: "—", detail: "offline" }),
    healthCard({ label: "Endpoint", value: "—", detail: "loopback" }),
    healthCard({ label: "Bridge version", value: "—", detail: "host-reported" }),
    healthCard({ label: "Last failure", value: "—", detail: "closed public code" }),
  ];
  healthGrid.append(statusCard, endpointCard, versionCard, failureCard);
  container.append(healthGrid);

  const ownershipNote = noteCard({
    tone: "info",
    body: "A bridge that was already running before ROS started is NOT owned by the bootstrap host. Stop leaves an externally-started bridge untouched.",
  });
  container.append(ownershipNote);

  const renderer = createBootstrapRenderer({
    onSnapshot: (snapshot) => {
      const tone = snapshot.status === "connected" ? "success"
        : snapshot.status === "failed" ? "error"
        : snapshot.status === "starting" || snapshot.status === "restarting" ? "pending"
        : "neutral";
      statusCard.querySelector("strong").textContent = snapshot.status;
      statusCard.querySelector("p").textContent = tone === "success" ? "Bridge is healthy and reachable" : `Bridge is ${snapshot.status}`;
      endpointCard.querySelector("strong").textContent = snapshot.endpoint ?? "—";
      endpointCard.querySelector("p").textContent = snapshot.endpoint ? "loopback http" : "no active endpoint";
      versionCard.querySelector("strong").textContent = snapshot.version ?? "—";
      versionCard.querySelector("p").textContent = snapshot.version ? "from /healthz" : "no version reported";
      failureCard.querySelector("strong").textContent = snapshot.failureCode ?? "—";
      failureCard.querySelector("p").textContent = snapshot.failureCode ? "see docs/architecture/BRIDGE-BOOTSTRAP-PROTOCOL.md" : "no failure";
    },
  });
  renderer.start();
  void renderer.refresh();

  const actionsCard = document.createElement("section");
  actionsCard.className = "settings-provider-card";
  const actionsHeading = document.createElement("strong");
  actionsHeading.className = "settings-provider-heading";
  actionsHeading.textContent = "Actions";
  const actionsHint = document.createElement("p");
  actionsHint.className = "settings-provider-help";
  actionsHint.textContent = "Stop shuts down a bridge the bootstrap host owns. Retry is the single bounded restart action after unexpected exit. The host is the sole owner of process policy.";
  actionsCard.append(actionsHeading, actionsHint);
  actionsCard.append(actionRow({
    buttons: [
      {
        label: "Stop bridge",
        tone: "primary",
        onClick: async () => {
          setStatus(statusNode, "Stopping bridge...", "");
          try {
            const result = await renderer.stopForShutdown();
            if (result?.ok) {
              setStatus(statusNode, "Stop request sent. The host decided ownership; externally-started bridges are not affected.", "success");
            } else {
              setStatus(statusNode, safeErrorMessage(new Error(result?.error ?? "stop-failed")), "error");
            }
          } catch (error) {
            setStatus(statusNode, safeErrorMessage(error), "error");
          }
        },
      },
      {
        label: "Restart",
        onClick: async () => {
          setStatus(statusNode, "Restarting bridge...", "");
          try {
            const result = await renderer.restart();
            if (result?.ok) {
              setStatus(statusNode, "Restart issued. Polling for the new healthy state.", "success");
            } else {
              setStatus(statusNode, safeErrorMessage(new Error(result?.error ?? "restart-failed")), "error");
            }
          } catch (error) {
            setStatus(statusNode, safeErrorMessage(error), "error");
          }
        },
      },
      {
        label: "Retry once",
        onClick: async () => {
          setStatus(statusNode, "Retrying once...", "");
          try {
            const result = await renderer.retryOnce();
            if (result?.ok) {
              setStatus(statusNode, "Retry issued. The host is bounded; a single retry does not loop.", "success");
            } else {
              setStatus(statusNode, safeErrorMessage(new Error(result?.error ?? "retry-failed")), "error");
            }
          } catch (error) {
            setStatus(statusNode, safeErrorMessage(error), "error");
          }
        },
      },
    ],
  }));
  container.append(actionsCard);
  container.append(statusNode);
}
