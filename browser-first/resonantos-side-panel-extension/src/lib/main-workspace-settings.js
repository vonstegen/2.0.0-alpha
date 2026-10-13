import { renderAddonsSection } from "./settings/addons-section.js";
import { renderAboutSection } from "./settings/about-section.js";
import { renderAddonToolsSection } from "./settings/addon-tools-section.js";
import { renderAppearanceSection } from "./settings/appearance-section.js";
import { renderBridgeBootstrapSection } from "./settings/bridge-bootstrap-section.js";
import { renderBridgeRuntimesSection } from "./settings/bridge-runtimes-section.js";
import { renderBridgeTargetSection } from "./settings/bridge-target-section.js";
import { renderBrowserControlSection } from "./settings/browser-control-section.js";
import { renderDiagnosticsSection } from "./settings/diagnostics-section.js";
import { renderMemorySection } from "./settings/memory-section.js";
import { renderOverviewSection } from "./settings/overview-section.js";
import { renderPersonalizationSection } from "./settings/personalization-section.js";
import { renderPrivacySection } from "./settings/privacy-section.js";
import { renderProvidersSection } from "./settings/providers-section.js";
import { renderRoutingSection } from "./settings/routing-section.js";
import { renderWorkSection } from "./settings/work-section.js";
import { createTerminalsHostSeams } from "./terminals-host-seams.js";

const sections = [
  {
    id: "profile",
    label: "Profile",
    hint: "User and Augmentor",
    group: "Start here",
    render: renderPersonalizationSection
  },
  {
    id: "overview",
    label: "Start Here",
    hint: "Setup checklist",
    group: "Start here",
    render: renderOverviewSection
  },
  {
    id: "providers",
    label: "Providers",
    hint: "Models and credentials",
    group: "Start here",
    render: renderProvidersSection
  },
  {
    id: "memory",
    label: "Memory",
    hint: "Sources and sync",
    group: "Start here",
    render: renderMemorySection
  },
  {
    id: "work",
    label: "Chats & Projects",
    hint: "Archive and restore",
    group: "Work",
    render: renderWorkSection
  },
  {
    id: "browser-control",
    label: "Browser Control",
    hint: "AI permissions",
    group: "Work",
    render: renderBrowserControlSection
  },
  {
    id: "addons",
    label: "Add-ons",
    hint: "Permissions",
    group: "Work",
    render: renderAddonsSection
  },
  {
    id: "addon-tools",
    label: "Add-on Tools",
    hint: "Launch or attach terminals",
    group: "Work",
    render: renderAddonToolsSection
  },
  {
    id: "routing",
    label: "Routing",
    hint: "Cost and fallback",
    group: "Advanced",
    render: renderRoutingSection
  },
  {
    id: "privacy",
    label: "Privacy",
    hint: "Trust boundaries",
    group: "Advanced",
    render: renderPrivacySection
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    hint: "Logs and reports",
    group: "Advanced",
    render: renderDiagnosticsSection
  },
  {
    id: "bridge-target",
    label: "Bridge Target",
    hint: "Cross-machine bridge URL",
    group: "Advanced",
    render: renderBridgeTargetSection
  },
  {
    id: "bridge-bootstrap",
    label: "Bridge Bootstrap",
    hint: "Native host lifecycle",
    group: "Advanced",
    render: renderBridgeBootstrapSection
  },
  {
    id: "bridge-runtimes",
    label: "Bridge & Runtimes",
    hint: "Core bridge + add-on runtimes",
    group: "Advanced",
    render: renderBridgeRuntimesSection
  },
  {
    id: "appearance",
    label: "Appearance",
    hint: "Density and motion",
    group: "Advanced",
    render: renderAppearanceSection
  },
  {
    id: "about",
    label: "About",
    hint: "Version and architecture",
    group: "Advanced",
    render: renderAboutSection
  }
];

function groupedSectionButtons(activeId, onSelect) {
  const nodes = [];
  let currentGroup = "";
  for (const section of sections) {
    if (section.group !== currentGroup) {
      currentGroup = section.group;
      const label = document.createElement("span");
      label.className = "settings-nav-group-label";
      label.textContent = currentGroup;
      nodes.push(label);
    }
    nodes.push(sectionButton(section, activeId, onSelect));
  }
  return nodes;
}

function sectionButton(section, activeId, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-nav-item";
  button.dataset.section = section.id;
  button.dataset.active = String(section.id === activeId);
  const label = document.createElement("strong");
  label.textContent = section.label;
  const hint = document.createElement("span");
  hint.textContent = section.hint;
  button.append(label, hint);
  button.addEventListener("click", () => onSelect(section.id));
  return button;
}

export function renderSettingsWorkspace({
  container,
  bridgeRequest,
  getBridgeRequest,
  chatSessionStore = null,
  onOpenSession = null,
  onOpenWorkspace = null,
  onProfileUpdated = null,
  onRestore = null,
  chromeApi = null,
  sitePermissionStore = null,
  taskConsentStore = null,
  storage = null,
  storageKeys = {},
  prefsSync = null,
  initialSection = "overview"
}) {
  const bridge = () => (typeof getBridgeRequest === "function" ? getBridgeRequest() : bridgeRequest);
  let activeId = sections.some((section) => section.id === initialSection) ? initialSection : "overview";
  let activeHandle = null;
  const shell = document.createElement("section");
  shell.className = "settings-workspace";
  const nav = document.createElement("nav");
  nav.className = "settings-subnav";
  nav.setAttribute("aria-label", "Settings sections");
  const panel = document.createElement("div");
  panel.className = "settings-panel";

  const context = {
    bridgeRequest,
    getBridgeRequest: typeof getBridgeRequest === "function" ? getBridgeRequest : () => bridgeRequest,
    chromeApi,
    chatSessionStore,
    onSelectSection: (nextId) => {
      if (!sections.some((section) => section.id === nextId) || nextId === activeId) return;
      activeId = nextId;
      renderActive();
    },
    onOpenSession,
    onOpenWorkspace,
    onProfileUpdated,
    onRestore,
    sitePermissionStore,
    storage,
    storageKeys,
    taskConsentStore,
    prefsSync
  };

  const renderActive = () => {
    const activeSection = sections.find((section) => section.id === activeId) ?? sections[0];
    nav.replaceChildren(...groupedSectionButtons(activeId, (nextId) => {
      if (nextId === activeId) return;
      activeId = nextId;
      renderActive();
    }));
    const sectionContext = { ...context, sectionId: activeSection.id };
    // CP-BR10/CP-BR11: derive the terminal-host host seams from the
    // existing `bridgeRequest` callback so the Settings sections and
    // the new Terminals rail workspace cannot drift. The shared
    // module also returns `enableTransaction` (registry-revision-aware)
    // for the Bridge & Runtimes section.
    let terminalsSeams = null;
    if (typeof bridge === "function") {
      const request = bridge();
      if (typeof request === "function") {
        terminalsSeams = createTerminalsHostSeams({ bridgeRequest: request });
      }
    }
    if (activeSection.id === "bridge-runtimes") {
      // Inject host seams for the Bridge & Runtimes surface. Every
      // seam is derived from the existing `bridgeRequest` callback;
      // no new bridge client is required and no global state is read.
      sectionContext.fetchProjection = terminalsSeams ? terminalsSeams.fetchProjection : (async () => null);
      sectionContext.getBootstrapSnapshot = async () => {
        if (typeof chrome === "undefined" || !chrome?.runtime?.sendMessage) {
          return null;
        }
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "bootstrap:get-status", channel: "resonantos.browser_first" }, (reply) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(reply ?? null);
          });
        });
        if (response && response.ok === true && response.snapshot) return response.snapshot;
        return null;
      };
      // CP-BR9: POST /addons/enabled is an optimistic-concurrency host
      // transaction — the shared `enableTransaction` reads the
      // registry revision immediately before the POST; a stale read
      // fails closed with ownership-conflict and the UI surfaces the
      // error (no silent retry, no local flag).
      sectionContext.enableTransaction = terminalsSeams
        ? terminalsSeams.enableTransaction
        : (async () => { throw new Error("Bridge request is not configured."); });
      sectionContext.supportedActions = {
        enableDisable: true,
        retry: false,
        restart: false,
        terminateSession: false,
      };
    }
    if (activeSection.id === "addon-tools") {
      // CP-BR10: Add-on Tools host seams. Every seam is derived from
      // the existing `bridgeRequest` callback via the shared
      // `createTerminalsHostSeams` helper; no new bridge client is
      // required and no global state is read.
      sectionContext.fetchStatus = terminalsSeams ? terminalsSeams.fetchStatus : (async () => null);
      sectionContext.fetchPromptPath = terminalsSeams ? terminalsSeams.fetchPromptPath : (async () => null);
      sectionContext.fetchProjection = terminalsSeams ? terminalsSeams.fetchProjection : (async () => null);
      sectionContext.fetchRegistry = terminalsSeams ? terminalsSeams.fetchRegistry : (async () => null);
      sectionContext.launchTerminal = terminalsSeams
        ? terminalsSeams.launchTerminal
        : (async () => { throw new Error("Bridge request is not configured."); });
      // The host route is POST /terminal-host/connection-script with
      //   required: terminalAddonId
      //   optional: providerProfileId
      // (bridgeEndpoint is read from the host's default; the renderer
      // never injects it).
      sectionContext.fetchConnectionScript = terminalsSeams
        ? terminalsSeams.fetchConnectionScript
        : (async () => { throw new Error("Bridge request is not configured."); });
      // Surface-level navigation. The renderer does not know the
      // section id; the workspace routes to Bridge Target on
      // bridge-not-running rejection.
      sectionContext.onOpenBridgeSettings = () => {
        activeId = "bridge-target";
        renderActive();
      };
    }
    if (activeHandle && typeof activeHandle.stop === "function") activeHandle.stop();
    activeHandle = activeSection.render(panel, sectionContext) ?? null;
  };

  shell.append(nav, panel);
  container.replaceChildren(shell);
  renderActive();
  return {
    stop() {
      if (activeHandle && typeof activeHandle.stop === "function") activeHandle.stop();
      activeHandle = null;
    },
  };
}
