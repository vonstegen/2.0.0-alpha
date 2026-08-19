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
  onNewSession      // () => void
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

  function renderList() {
    list.replaceChildren();
    const visible = filterSessions(sessions, search.value);
    const { today, older } = groupSessions(visible);
    for (const [label, group] of [["Today", today], ["Older", older]]) {
      if (!group.length) continue;
      const heading = doc.createElement("div");
      heading.className = "ocb-group";
      heading.textContent = label;
      list.append(heading);
      for (const s of group) {
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
        list.append(row);
      }
    }
    if (!visible.length) {
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
      sessions = Array.isArray(result?.sessions) ? result.sessions : [];
    } catch {
      sessions = [];
    }
    renderList();
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
      }
    }
  }
  return events;
}
