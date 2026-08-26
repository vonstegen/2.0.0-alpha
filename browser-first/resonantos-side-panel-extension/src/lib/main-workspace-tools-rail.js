// Dynamic rail. Consumes `GET /addons/surface-routes` (the host-side mirror
// of the SDK's createAddOnRailMenus) and renders top-level rail menus:
// harness add-ons (category `agent`) each get their own menu, memory
// providers collapse into a "Memory" menu, and every other category collapses
// into a "Tools" menu. A harness menu opens into a workspace whose sub-rail
// lists the harness's own tools (from the manifest `tools` array).

const DOCK_ICON_PATHS = {
  // Memory provider / knowledge store (database)
  memory: `<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>`,
  // Communication / delegation agent (paper plane)
  messaging: `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
  // Coding workspace (window with header + sidebar)
  workspace: `<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M9 9v11"/>`,
  // Runtime harness (electrical plug)
  harness: `<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>`,
  // Recursive reasoning (circular loop)
  recursion: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M3 21v-5h5"/>`,
  // Fallback for unknown dock icons
  tool: `<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/>`,
};

export function dockIconSvg(name) {
  const paths = DOCK_ICON_PATHS[name] ?? DOCK_ICON_PATHS.tool;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

export async function fetchSurfaceRoutes(getBridgeRequest) {
  const result = await getBridgeRequest()("/addons/surface-routes", { method: "GET" });
  return Array.isArray(result?.menus) ? result.menus : [];
}

function menuButton(menu, onOpenMenu) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rail-project";
  button.dataset.workspace = menu.menuId;
  button.innerHTML = `${dockIconSvg(menu.dockIcon)}<span class="rail-text"></span>`;
  button.querySelector(".rail-text").textContent = menu.label;
  button.title = menu.kind === "harness" ? `${menu.label} — harness` : menu.label;
  button.addEventListener("click", () => onOpenMenu(menu.menuId));
  return button;
}

export function renderToolsRailButtons(container, menus, onOpenMenu) {
  container.replaceChildren();
  for (const menu of menus) {
    container.append(menuButton(menu, onOpenMenu));
  }
}

export function syncToolsRailActive(container, activeWorkspace) {
  for (const button of container.querySelectorAll(".rail-project")) {
    const active = button.dataset.workspace === activeWorkspace;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
}

function menuEyebrow(kind) {
  if (kind === "harness") return "Harness";
  if (kind === "memory") return "Memory";
  return "Tools";
}

function harnessToolRow(tool) {
  const li = document.createElement("li");
  li.className = "harness-tool-row";

  const head = document.createElement("div");
  head.className = "harness-tool-head";

  const name = document.createElement("code");
  name.textContent = tool.name;

  const gate = document.createElement("span");
  gate.className = "harness-tool-gate";
  gate.dataset.tone = tool.requiresHumanApproval ? "gated" : "auto";
  gate.textContent = tool.requiresHumanApproval ? "approval required" : "auto";

  head.append(name, gate);
  li.append(head);

  if (tool.description) {
    const desc = document.createElement("p");
    desc.className = "harness-tool-desc";
    desc.textContent = tool.description;
    li.append(desc);
  }

  const caps = Array.isArray(tool.requiredCapabilities) ? tool.requiredCapabilities : [];
  if (caps.length) {
    const chips = document.createElement("div");
    chips.className = "harness-tool-caps";
    for (const cap of caps) {
      const chip = document.createElement("span");
      chip.className = "harness-tool-cap";
      chip.textContent = cap;
      chips.append(chip);
    }
    li.append(chips);
  }

  return li;
}

function renderHarnessToolSubRail(menu) {
  const list = document.createElement("ul");
  list.className = "harness-tool-list";
  const tools = Array.isArray(menu.tools) ? menu.tools : [];
  if (tools.length === 0) {
    const empty = document.createElement("li");
    empty.className = "harness-tool-empty";
    empty.textContent = "No tools declared in the manifest.";
    list.append(empty);
  } else {
    for (const tool of tools) {
      list.append(harnessToolRow(tool));
    }
  }
  return list;
}

function renderMenuRoutes(menu) {
  const list = document.createElement("ul");
  list.className = "menu-route-list";
  for (const route of menu.routes) {
    const li = document.createElement("li");
    li.className = "menu-route-row";
    li.innerHTML = `${dockIconSvg(route.dockIcon)}<span class="menu-route-copy"></span>`;
    const copy = li.querySelector(".menu-route-copy");
    const label = document.createElement("strong");
    label.textContent = route.label;
    const meta = document.createElement("small");
    meta.textContent = [route.eyebrow, route.addonId].filter(Boolean).join(" · ");
    copy.append(label, meta);
    list.append(li);
  }
  return list;
}

// Top-level rail menu workspace. Harnesses render a sub-rail of their own
// tools (the destination you're directed into); memory/tools menus list the
// add-ons grouped under them.
export function renderRailMenuWorkspace(container, menu) {
  container.replaceChildren();
  const section = document.createElement("section");
  section.className = "module-workspace addon-surface-workspace rail-menu-workspace";

  const copy = document.createElement("div");
  copy.className = "module-copy";

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = menuEyebrow(menu.kind);

  const title = document.createElement("h1");
  title.textContent = menu.label;

  const body = document.createElement("p");
  body.textContent = menu.kind === "harness"
    ? "Tools provided by this harness. Each is capability-gated and audited by the bridge."
    : menu.kind === "memory"
      ? "Memory providers available in this workspace."
      : "Single-purpose tools available in this workspace.";

  copy.append(eyebrow, title, body);
  section.append(copy);
  section.append(menu.kind === "harness" ? renderHarnessToolSubRail(menu) : renderMenuRoutes(menu));
  container.append(section);
}
