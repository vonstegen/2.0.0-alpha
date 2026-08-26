// Dynamic Tools rail. Consumes `GET /addons/surface-routes` (the host-side
// mirror of the SDK's createAddOnSurfaceDockRoutes) and renders dock items
// into the rail's Tools section. Add-on-declared `shellNavigation` is the
// single source of truth; built-ins and third-party add-ons flow through
// the same path.

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
  return Array.isArray(result?.routes) ? result.routes : [];
}

function toolButton(route, onOpenSection) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rail-project";
  button.dataset.workspace = route.sectionId;
  button.innerHTML = `${dockIconSvg(route.dockIcon)}<span class="rail-text"></span>`;
  button.querySelector(".rail-text").textContent = route.label;
  button.title = route.eyebrow ? `${route.label} — ${route.eyebrow}` : route.label;
  button.addEventListener("click", () => onOpenSection(route.sectionId));
  return button;
}

export function renderToolsRailButtons(container, routes, onOpenSection) {
  container.replaceChildren();
  for (const route of routes) {
    container.append(toolButton(route, onOpenSection));
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

// Generic fallback for add-on surfaces that declare a dock route but do not
// yet ship a dedicated workspace renderer. Shows the surface identity so the
// dock item is actionable without fabricating an unimplemented UI.
export function renderAddonSurfaceWorkspace(container, route) {
  container.replaceChildren();
  const section = document.createElement("section");
  section.className = "module-workspace addon-surface-workspace";

  const copy = document.createElement("div");
  copy.className = "module-copy";

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = route.eyebrow || "Add-on surface";

  const title = document.createElement("h1");
  title.textContent = route.label;

  const body = document.createElement("p");
  body.textContent = `This workspace is declared by ${route.addonId} (surface ${route.surfaceId}). Its dedicated UI is not implemented yet; the dock route and icon come from the add-on manifest's shellNavigation.`;

  copy.append(eyebrow, title, body);
  section.append(copy);
  container.append(section);
}
