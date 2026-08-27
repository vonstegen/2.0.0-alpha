import { renderHarnessToolSubRail } from "../main-workspace-tools-rail.js";
import { noteCard, safeErrorMessage, setStatus, settingsHeader } from "./settings-common.js";

// ROS Harness = the shell's fused G0 agent. It is not a pluggable add-on, so
// it is surfaced here (Settings) as a system view rather than a main-nav tab.
export function renderRosHarnessSection(container, { bridgeRequest, getBridgeRequest }) {
  const bridge = () => (typeof getBridgeRequest === "function" ? getBridgeRequest() : bridgeRequest);
  const statusNode = document.createElement("p");
  statusNode.className = "settings-status";
  statusNode.textContent = "Loading the fused G0 tool loop...";
  const tools = document.createElement("div");
  tools.className = "settings-ros-harness-tools";

  container.replaceChildren(
    settingsHeader({
      eyebrow: "System · fused core",
      title: "ROS Harness",
      body: "The G0 tool loop the shell ships with. It is fused to the shell, not a pluggable add-on. Grayed tools are superseded by an installed add-on's equivalent."
    }),
    statusNode,
    noteCard({
      title: "Ground-0 invariant",
      body: "The fused core is self-sufficient; add-ons plug in at the one separable boundary and never replace the core."
    }),
    tools
  );

  const load = async () => {
    const result = await bridge()("/addons/surface-routes", { method: "GET" });
    const menus = Array.isArray(result?.menus) ? result.menus : [];
    const menu = menus.find((item) => item.menuId === "ros-harness");
    if (!menu) {
      setStatus(statusNode, "ROS Harness menu not found in the surface route.", "warning");
      return;
    }
    setStatus(statusNode, "Fused core tool loop.", "success");
    tools.replaceChildren(renderHarnessToolSubRail(menu));
  };

  void load().catch((error) => {
    setStatus(statusNode, `Could not load the G0 tool loop: ${safeErrorMessage(error)}`, "error");
  });
}
