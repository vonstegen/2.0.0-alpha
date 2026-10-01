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
export function renderAddOnToolWorkspace(container, { installation, slots = {}, onAssignPrimary = () => {}, bridgeRequest, document: doc = document } = {}) {
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

  if (runtime?.adapterId === "pi-native-v1" && typeof bridgeRequest === "function") {
    section.append(renderPiTuiSession(doc, { installation, bridgeRequest }));
  }

  container.append(section);
}

// Interactive Pi TUI session (2D). Spawns the REAL Pi terminal UI inside a
// host-owned pseudo-TTY and renders its raw output in a vendored xterm.js
// terminal. Keystrokes stream back to the PTY over the input route; the
// credential never appears here (env-only on the host side).
function renderPiTuiSession(doc, { installation, bridgeRequest }) {
  const box = doc.createElement("div");
  box.className = "pi-tui";

  const row = doc.createElement("div");
  row.className = "pi-tui-controls";
  const label = doc.createElement("span");
  label.className = "pi-tui-title";
  label.textContent = "Pi session";
  const status = doc.createElement("span");
  status.className = "pi-tui-status";
  status.dataset.tone = "neutral";
  status.textContent = "idle";
  row.append(label, status);
  box.append(row);

  const profiles = Array.isArray(installation?.compatibleProviderProfiles) ? installation.compatibleProviderProfiles : [];
  const models = Array.isArray(installation?.compatibleModels) ? installation.compatibleModels : [];
  const pick = doc.createElement("div");
  pick.className = "pi-tui-pickers";
  const profileSelect = doc.createElement("select");
  profileSelect.className = "pi-tui-select";
  for (const profile of profiles) {
    const option = doc.createElement("option");
    option.value = profile.id ?? "";
    option.textContent = profile.label ?? profile.id;
    profileSelect.append(option);
  }
  const modelSelect = doc.createElement("select");
  modelSelect.className = "pi-tui-select";
  const refreshModels = () => {
    modelSelect.replaceChildren();
    for (const entry of models.filter((candidate) => candidate?.providerId === profileSelect.value)) {
      const option = doc.createElement("option");
      option.value = entry.model ?? "";
      option.textContent = entry.model ?? entry.label ?? "";
      modelSelect.append(option);
    }
  };
  profileSelect.addEventListener("change", refreshModels);
  const startButton = doc.createElement("button");
  startButton.type = "button";
  startButton.className = "pi-tui-start";
  startButton.textContent = "Start session";
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "pi-tui-cancel";
  cancelButton.textContent = "Cancel";
  cancelButton.disabled = true;
  pick.append(profileSelect, modelSelect, startButton, cancelButton);
  box.append(pick);

  const terminalHost = doc.createElement("div");
  terminalHost.className = "pi-tui-terminal";
  terminalHost.hidden = true;
  box.append(terminalHost);

  const setStatus = (text, tone = "neutral") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  let term = null;
  let fit = null;
  let sessionId = null;
  let streamDone = false;
  let running = false;
  let resizeObserver = null;

  const stopStream = () => { streamDone = true; };
  const endSession = (tone = "neutral") => {
    running = false;
    streamDone = true;
    startButton.disabled = false;
    cancelButton.disabled = true;
    setStatus(status.textContent || "ended", tone);
    term?.write?.("\r\n[session ended]\r\n");
  };

  const consumeStream = async (response) => {
    const reader = response.body?.getReader?.();
    if (!reader) { endSession("error"); return; }
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          for (const line of raw.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            try {
              const frame = JSON.parse(line.slice(6));
              if (frame?.sessionId && frame.sessionId !== sessionId) continue;
              if (frame?.type === "pi.tui.data") {
                term?.write?.(frame.data ?? "");
              } else if (frame?.type === "pi.tui.exit") {
                const evidence = frame.evidence ?? {};
                setStatus(`exited (${evidence.exitCode ?? "?"})`, "neutral");
                endSession("neutral");
                return;
              } else if (typeof frame?.error === "string" && typeof frame?.code === "string") {
                // Terminal harness.close frame (transport bookkeeping): only
                // surfaced when the session ended without a pi.tui.exit frame.
                setStatus(frame.error, "error");
                endSession("error");
                return;
              }
            } catch {
              /* malformed frame: skip */
            }
          }
        }
      }
      if (!streamDone) { setStatus("stream ended", "warning"); endSession("warning"); }
    } catch {
      if (!streamDone) { setStatus("stream lost", "error"); endSession("error"); }
    }
  };

  startButton.addEventListener("click", async () => {
    if (running) return;
    if (profileSelect.value && !modelSelect.value) refreshModels();
    if (!profileSelect.value || !modelSelect.value) {
      setStatus("select a profile and model", "warning");
      return;
    }
    const TerminalCtor = globalThis.Terminal?.Terminal ?? globalThis.Terminal;
    const FitAddonCtor = globalThis.FitAddon?.FitAddon;
    if (typeof TerminalCtor !== "function" || typeof FitAddonCtor !== "function") {
      setStatus("terminal runtime unavailable", "error");
      return;
    }
    setStatus("starting…", "neutral");
    startButton.disabled = true;
    try {
      const created = await bridgeRequest("/pi-native/tui-session", {
        method: "POST",
        body: {
          providerProfileId: profileSelect.value,
          selectedModel: modelSelect.value,
          cols: 100,
          rows: 30,
        },
      });
      sessionId = created?.sessionId;
      if (!sessionId) throw new Error("No session id returned.");
    } catch (error) {
      setStatus(`start failed: ${String(error?.message ?? error)}`, "error");
      startButton.disabled = false;
      return;
    }
    running = true;
    streamDone = false;
    cancelButton.disabled = false;
    setStatus("running", "success");

    term = new TerminalCtor({
      convertEol: false,
      cursorBlink: true,
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 12,
      scrollback: 4000,
    });
    fit = new FitAddonCtor();
    term.loadAddon(fit);
    term.open(terminalHost);
    terminalHost.hidden = false;
    try { fit.fit(); } catch { /* sized later */ }

    resizeObserver = new ResizeObserver(() => {
      try {
        fit?.fit?.();
        const cols = term?.cols;
        const rows = term?.rows;
        if (Number.isInteger(cols) && Number.isInteger(rows)) {
          void bridgeRequest("/pi-native/tui-session/resize", { method: "POST", body: { sessionId, cols, rows } }).catch(() => {});
        }
      } catch { /* not fatal */ }
    });
    resizeObserver.observe(terminalHost);

    term.onData((input) => {
      void bridgeRequest("/pi-native/tui-session/input", { method: "POST", body: { sessionId, input } }).catch(() => {});
    });

    const response = await bridgeRequest(`/pi-native/tui-session/events?sessionId=${encodeURIComponent(sessionId)}`, {
      responseType: "sse",
    }).catch(() => null);
    if (response && !streamDone) {
      void consumeStream(response);
    } else if (!streamDone) {
      setStatus("stream unavailable", "error");
      endSession("error");
    }
  });

  cancelButton.addEventListener("click", () => {
    if (!sessionId) return;
    setStatus("cancelling…", "warning");
    void bridgeRequest("/pi-native/tui-session/cancel", { method: "POST", body: { sessionId } }).catch(() => {});
  });

  // Surface teardown: never leaves a host PTY behind.
  const originalDispose = () => {
    if (sessionId && running) {
      void bridgeRequest("/pi-native/tui-session/dispose", { method: "POST", body: { sessionId } }).catch(() => {});
    }
    try { resizeObserver?.disconnect(); } catch { /* noop */ }
    try { term?.dispose?.(); } catch { /* noop */ }
  };
  box.dataset.piTuiDispose = "true";
  if (typeof window !== "undefined" && !box._disposeHooked) {
    box._disposeHooked = true;
    window.addEventListener("beforeunload", originalDispose, { once: true });
  }
  return box;
}
