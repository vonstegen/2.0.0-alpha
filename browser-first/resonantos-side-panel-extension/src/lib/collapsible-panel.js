// A reusable show/hide control for the context-dock status panels (Site, Agent
// Control, …). It flips a `data-collapsed` attribute on the panel section and
// persists the choice; CSS decides which body elements hide when collapsed. This
// stays orthogonal to each panel's own render logic (which owns element.hidden),
// so collapsing never fights a re-render.

export function createCollapsiblePanel({
  section = null,
  toggle = null,
  storage = null,
  storageKey = "",
  collapsedByDefault = false,
  labels = { expanded: "Hide", collapsed: "Show" }
} = {}) {
  let collapsed = Boolean(collapsedByDefault);

  function render() {
    if (section) section.dataset.collapsed = collapsed ? "true" : "false";
    if (toggle) {
      toggle.textContent = collapsed ? labels.collapsed : labels.expanded;
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  async function persist() {
    if (storage?.set && storageKey) {
      await storage.set({ [storageKey]: collapsed }).catch(() => undefined);
    }
  }

  async function setCollapsed(next) {
    collapsed = Boolean(next);
    render();
    await persist();
    return collapsed;
  }

  async function toggleCollapsed() {
    return setCollapsed(!collapsed);
  }

  async function hydrate() {
    if (storage?.get && storageKey) {
      const stored = await storage.get(storageKey).catch(() => ({}));
      if (typeof stored?.[storageKey] === "boolean") {
        collapsed = stored[storageKey];
      }
    }
    render();
    return collapsed;
  }

  function bind() {
    toggle?.addEventListener?.("click", () => void toggleCollapsed());
    render();
  }

  return { bind, hydrate, render, setCollapsed, toggleCollapsed, isCollapsed: () => collapsed };
}
