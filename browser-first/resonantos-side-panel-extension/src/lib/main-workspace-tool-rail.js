// Dynamic right-side tool rail. Discovers tool-panel surfaces from the host
// harness registry projection and renders one entry per installed + enabled +
// authorized surface. No add-on id (Pi, OpenCode, Claude, ...) is hard-coded:
// the host owns rendering and authorization, and the projection is declarative.
//
// All host-provided text is written with textContent (never innerHTML), so a
// malicious label/icon cannot inject markup or script.

const SAFE_ICON = /^[a-z][a-z0-9-]{0,63}$/;

export function computeToolRailEntries(projection) {
  const entries = [];
  const installations = projection?.installations ?? {};
  for (const [addonId, installation] of Object.entries(installations)) {
    if (!installation?.installed || !installation.enabled) continue;
    for (const surface of installation.surfaces ?? []) {
      if (surface?.type !== "tool-panel") continue;
      if ((installation.hiddenSurfaceIds ?? []).includes(surface.id)) continue;
      const required = surface.requiredCapabilities ?? [];
      const grantedCapabilities = installation.grantedCapabilities ?? [];
      const authorized = required.every((capability) =>
        grantedCapabilities.some((grant) => grant.capability === capability && grant.granted));
      if (!authorized) continue;
      entries.push({
        addonId,
        surfaceId: surface.id,
        label: surface.label || installation.name || addonId,
        icon: typeof surface.icon === "string" && SAFE_ICON.test(surface.icon) ? surface.icon : "",
        classification: installation.classification?.category ?? null,
        hasAgentRuntime: Boolean(installation.agentRuntime),
      });
    }
  }
  return entries.sort((left, right) => left.label.localeCompare(right.label));
}

export function renderToolRail(container, entries, { onSelect = () => {}, document: doc = document } = {}) {
  if (!container || !doc) return 0;
  container.replaceChildren();
  for (const entry of entries) {
    const item = doc.createElement("button");
    item.type = "button";
    item.className = "tool-rail-item";
    item.dataset.addonId = entry.addonId;
    item.dataset.toolPanelEntry = "true";
    item.setAttribute("aria-label", `Open ${entry.label}`);
    const icon = doc.createElement("span");
    icon.className = "tool-rail-icon";
    icon.textContent = entry.icon ? entry.icon.charAt(0).toUpperCase() : (entry.label || "?").charAt(0).toUpperCase();
    const label = doc.createElement("span");
    label.className = "tool-rail-text";
    label.textContent = entry.label;
    item.append(icon, label);
    item.addEventListener("click", () => onSelect(entry));
    container.append(item);
  }
  return entries.length;
}

function statusRow(doc, label, value, { tone = "neutral" } = {}) {
  const row = doc.createElement("div");
  row.className = "harness-status-row";
  const key = doc.createElement("span");
  key.className = "harness-status-key";
  key.textContent = label;
  const val = doc.createElement("span");
  val.className = "harness-status-value";
  val.dataset.tone = tone;
  val.textContent = value;
  row.append(key, val);
  return row;
}

function booleanLabel(value) {
  if (value === true) return "configured";
  if (value === false) return "not configured";
  return "n/a";
}

// Renders the harness/tool workspace + options panel for one add-on. Host text
// only; no secret material is ever projected or rendered.
export function renderAddOnToolWorkspace(container, { installation, slots = {}, onAssignPrimary = () => {}, document: doc = document } = {}) {
  if (!container || !doc) return;
  container.replaceChildren();
  const section = doc.createElement("section");
  section.className = "module-workspace tool-workspace";
  section.dataset.addonWorkspace = installation?.addonId ?? "";

  const header = doc.createElement("div");
  header.className = "workspace-header";
  const eyebrow = doc.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = installation?.classification?.subtype
    ? `${installation.classification.category ?? ""} / ${installation.classification.subtype}`
    : (installation?.classification?.category ?? "add-on");
  const title = doc.createElement("h2");
  title.textContent = installation?.name ?? installation?.addonId ?? "Add-on";
  header.append(eyebrow, title);
  section.append(header);

  const statusList = doc.createElement("div");
  statusList.className = "harness-status-list";
  statusList.append(statusRow(doc, "Status", installation?.enabled ? "enabled" : "disabled", { tone: installation?.enabled ? "success" : "warning" }));

  const runtime = installation?.agentRuntime ?? null;
  if (runtime) {
    const credentialSource = runtime.credentialSource ?? "legacy";
    statusList.append(statusRow(doc, "Credential source", credentialSource));
    if (runtime.credentialBinding) {
      statusList.append(statusRow(doc, "Binding", runtime.credentialBinding));
    }
    // Host-owned boolean: never a secret, never the credential itself.
    statusList.append(statusRow(doc, "Provider credential", booleanLabel(installation?.providerProfileConfigured)));
    if (runtime.modelSelection?.selectable) {
      statusList.append(statusRow(doc, "Model selection", `${runtime.modelSelection.source} (${runtime.modelSelection.currentModelField})`));
    } else if (runtime.supportsModelSelection) {
      statusList.append(statusRow(doc, "Model selection", "supported"));
    }
  } else {
    statusList.append(statusRow(doc, "Runtime", "tool (no agent runtime)"));
  }
  section.append(statusList);

  const primarySlot = slots?.["primary-agent"];
  const isPrimary = primarySlot?.addonId === installation?.addonId;
  const primaryRow = doc.createElement("div");
  primaryRow.className = "harness-primary-row";
  const primaryKey = doc.createElement("span");
  primaryKey.className = "harness-status-key";
  primaryKey.textContent = "Primary agent";
  const primaryVal = doc.createElement("span");
  primaryVal.className = "harness-status-value";
  primaryVal.dataset.tone = isPrimary ? "success" : "neutral";
  primaryVal.textContent = isPrimary ? "active" : (installation?.agentRuntime ? "available" : "not eligible");
  primaryRow.append(primaryKey, primaryVal);
  section.append(primaryRow);

  if (installation?.agentRuntime && !isPrimary) {
    const assign = doc.createElement("button");
    assign.type = "button";
    assign.className = "primary-agent-assign";
    assign.textContent = "Make primary agent";
    assign.addEventListener("click", () => onAssignPrimary(installation.addonId));
    section.append(assign);
  }

  container.append(section);
}
