// OpenCode session browser — the desktop-app-style left rail for the live
// workspace: project header, session search, sessions grouped Today / Older
// (resume on click), and a New session action. Pure DOM + injected callbacks so
// it unit-tests in jsdom without a bridge.

export function groupSessions(sessions = [], now = Date.now()) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const today = [], older = [];
  for (const s of [...sessions].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))) {
    ((s.updated ?? s.created ?? 0) >= dayStart.getTime() ? today : older).push(s);
  }
  return { today, older };
}

export function filterSessions(sessions = [], query = "") {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => (s.title || s.id || "").toLowerCase().includes(q));
}

export function sessionLabel(session) {
  const title = String(session?.title ?? "").trim();
  return title || `Session ${String(session?.id ?? "").slice(-6)}`;
}

export function createOpenCodeSessionBrowser({
  document: doc,
  container,
  projectName = "2.0.0-alpha",
  listSessions,     // async () => [{id,title,created,updated}]
  onOpenSession,    // (sessionId) => void
  onNewSession,     // () => void
  renameSession,
  deleteSession,
  archiveSession,
  confirmDelete,
  onActiveDeleted
} = {}) {
  const root = doc.createElement("aside");
  root.className = "ocb-rail";

  const project = doc.createElement("div");
  project.className = "ocb-project";
  const mark = doc.createElement("span");
  mark.className = "ocb-project-mark";
  mark.textContent = projectName.slice(0, 1).toUpperCase();
  const name = doc.createElement("strong");
  name.textContent = projectName;
  project.append(mark, name);

  const search = doc.createElement("input");
  search.type = "search";
  search.className = "ocb-search";
  search.placeholder = `Search sessions in ${projectName}`;

  const newButton = doc.createElement("button");
  newButton.type = "button";
  newButton.className = "ocb-new";
  newButton.textContent = "+ New session";
  newButton.addEventListener("click", () => onNewSession?.());

  const list = doc.createElement("div");
  list.className = "ocb-list";

  root.append(project, search, newButton, list);
  container.append(root);

  let sessions = [];
  let activeId = "";
  let errorMessage = "";
  let renamingId = "";

  function renderList() {
    list.replaceChildren();
    if (errorMessage) {
      const error = doc.createElement("p");
      error.className = "ocb-error";
      error.textContent = errorMessage;
      list.append(error);
    }
    const visible = filterSessions(sessions, search.value);
    const { today, older } = groupSessions(visible);
    for (const [label, group] of [["Today", today], ["Older", older]]) {
      if (!group.length) continue;
      const heading = doc.createElement("div");
      heading.className = "ocb-group";
      heading.textContent = label;
      list.append(heading);
      for (const s of group) {
        const wrap = doc.createElement("div");
        wrap.className = "ocb-session-row";
        wrap.dataset.sessionId = s.id;
        if (s.id === renamingId) {
          const form = doc.createElement("form");
          form.className = "ocb-rename";
          form.dataset.sessionId = s.id;
          const input = doc.createElement("input");
          input.className = "ocb-rename-input";
          input.value = sessionLabel(s);
          const save = doc.createElement("button");
          save.type = "submit";
          save.textContent = "Save";
          const cancel = doc.createElement("button");
          cancel.type = "button";
          cancel.textContent = "Cancel";
          cancel.addEventListener("click", () => {
            renamingId = "";
            renderList();
          });
          form.append(input, save, cancel);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            const title = input.value.trim();
            if (!title) return;
            const previous = s.title;
            s.title = title;
            renamingId = "";
            renderList();
            void Promise.resolve(renameSession?.(s.id, title))
              .then(() => {
                errorMessage = "";
                renderList();
              })
              .catch((error) => {
                s.title = previous;
                errorMessage = error instanceof Error && error.message ? error.message : "Could not rename session.";
                renderList();
              });
          });
          wrap.append(form);
          list.append(wrap);
          input.focus?.();
          continue;
        }
        const row = doc.createElement("button");
        row.type = "button";
        row.className = "ocb-session";
        row.dataset.sessionId = s.id;
        row.dataset.active = s.id === activeId ? "true" : "false";
        const dot = doc.createElement("span");
        dot.className = "ocb-session-mark";
        const text = doc.createElement("span");
        text.className = "ocb-session-title";
        text.textContent = sessionLabel(s);
        row.append(dot, text);
        row.addEventListener("click", () => {
          setActive(s.id);
          onOpenSession?.(s.id);
        });
        const actions = doc.createElement("div");
        actions.className = "ocb-actions";
        const action = (name, label, handler) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.dataset.action = name;
          button.dataset.sessionId = s.id;
          button.textContent = label;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            handler();
          });
          return button;
        };
        if (typeof renameSession === "function") {
          actions.append(action("rename", "Rename", () => {
            renamingId = s.id;
            renderList();
          }));
        }
        if (typeof deleteSession === "function") {
          actions.append(action("delete", "Delete", () => {
            void deleteOne(s);
          }));
        }
        if (typeof archiveSession === "function") {
          actions.append(action("archive", "Archive", () => {
            void archiveOne(s);
          }));
        }
        wrap.append(row, actions);
        list.append(wrap);
      }
    }
    if (!visible.length && !errorMessage) {
      const empty = doc.createElement("p");
      empty.className = "ocb-empty";
      empty.textContent = "No sessions yet — start one.";
      list.append(empty);
    }
  }

  function setActive(id) {
    activeId = id || "";
    for (const row of list.querySelectorAll(".ocb-session")) {
      row.dataset.active = row.dataset.sessionId === activeId ? "true" : "false";
    }
  }

  async function refresh() {
    try {
      const result = await listSessions();
      errorMessage = "";
      sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    } catch (error) {
      errorMessage = error instanceof Error && error.message ? error.message : "Could not load OpenCode sessions.";
    }
    renderList();
  }

  async function deleteOne(session) {
    const ok = typeof confirmDelete === "function"
      ? await confirmDelete(session)
      : (typeof window !== "undefined" && window.confirm ? window.confirm(`Delete ${sessionLabel(session)}?`) : true);
    if (!ok) return;
    const previousSessions = sessions;
    sessions = sessions.filter((candidate) => candidate.id !== session.id);
    const wasActive = activeId === session.id;
    renderList();
    try {
      await deleteSession?.(session.id);
      errorMessage = "";
      if (wasActive) {
        activeId = "";
        onActiveDeleted?.(session.id);
      }
      renderList();
    } catch (error) {
      sessions = previousSessions;
      errorMessage = error instanceof Error && error.message ? error.message : "Could not delete session.";
      renderList();
    }
  }

  async function archiveOne(session) {
    try {
      await archiveSession?.(session.id);
      errorMessage = "";
      sessions = sessions.filter((candidate) => candidate.id !== session.id);
      renderList();
    } catch (error) {
      errorMessage = error instanceof Error && error.message ? error.message : "Could not archive session.";
      renderList();
    }
  }

  search.addEventListener("input", renderList);

  return { root, refresh, setActive, getSessions: () => sessions };
}

// Seed a live-session reducer with an existing session's message history by
// replaying it as synthetic v1.18-schema events (message-info + text-set per
// part) — the same path live events take, so resume and live rendering agree.
export function seedEventsFromMessages(messages = []) {
  const events = [];
  for (const m of messages) {
    const info = m?.info ?? m ?? {};
    if (info.id && info.role) {
      events.push({ type: "message.updated", properties: { info: { id: info.id, role: info.role } } });
    }
    for (const part of m?.parts ?? []) {
      if ((part?.type === "text" || part?.type === "reasoning") && String(part.text ?? "").trim()) {
        events.push({ type: "message.part.updated", properties: { part: { ...part, messageID: part.messageID ?? info.id } } });
        continue;
      }
      if (part?.type === "tool") {
        const id = part.callID ?? part.callId ?? part.id ?? "";
        const state = part.state ?? {};
        const input = state.input ?? state.raw ?? part.input ?? part.args ?? state.title ?? "";
        events.push({ type: "tool.called", properties: { callID: id, tool: part.tool ?? part.name ?? "tool", input } });
        if (state.status === "completed" || state.status === "success") {
          events.push({ type: "tool.success", properties: { callID: id, output: state.output ?? part.output ?? state.title ?? "" } });
        } else if (state.status === "error" || state.status === "failed") {
          events.push({ type: "tool.failed", properties: { callID: id, error: state.error ?? part.error ?? "failed" } });
        }
        continue;
      }
      const type = String(part?.type ?? "").toLowerCase();
      const path = part?.path ?? part?.file ?? part?.filename ?? part?.name ?? "";
      if (path && (type === "file" || type === "file-edit" || type === "file_edited" || type === "patch" || part?.added !== undefined || part?.removed !== undefined || part?.additions !== undefined || part?.deletions !== undefined)) {
        events.push({
          type: "file.edited",
          properties: {
            path,
            added: Number(part.added ?? part.additions ?? 0),
            removed: Number(part.removed ?? part.deletions ?? 0)
          }
        });
      }
    }
  }
  return events;
}
