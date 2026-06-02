export function createMainWorkspaceRailController(dependencies) {
  const {
    allowedWorkspaces,
    chatSessionStore,
    document,
    getActiveWorkspace,
    getRailSearchQuery,
    isRailVisibleChatSession = (session) => Boolean(session) && !session.archivedAt,
    persistActiveWorkspace,
    railChatList,
    railClearSearch,
    railProjectList,
    railSearchMatchesProject,
    railSearchMatchesSession,
    renderAll,
    setActiveWorkspaceId,
    updateConnectionLine,
    window,
    workspaceButtons,
  } = dependencies;

  function relativeTime(value) {
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 60) return "now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d`;
    return `${Math.round(days / 30)}mo`;
  }

  function iconSvg(kind) {
    const paths = {
      archive: `<path d="M4 7h16v13H4z"/><path d="M4 7l2-4h12l2 4"/><path d="M9 12h6"/>`,
      chevronDown: `<path d="m7 10 5 5 5-5"/>`,
      chevronRight: `<path d="m10 7 5 5-5 5"/>`,
      delete: `<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>`,
      dot: `<circle cx="12" cy="12" r="4"/>`,
      fork: `<path d="M7 6v5a3 3 0 0 0 3 3h7"/><path d="M14 10l4 4-4 4"/><path d="M7 6h4"/>`,
      folder: `<path d="M4 6h6l2 2h8v10H4z"/>`,
      pin: `<path d="m14 4 6 6"/><path d="m5 19 6-6"/><path d="m9 15-2-2 8-8 4 4-8 8-2-2Z"/>`,
      rename: `<path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m13 7 4 4"/>`,
      unpin: `<path d="m3 3 18 18"/><path d="m14 4 6 6"/><path d="m5 19 6-6"/><path d="m9 15-2-2 8-8 4 4"/>`
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[kind] ?? ""}</svg>`;
  }

  function orderedRailItems(items) {
    return [...items].sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }

  async function switchToSession(sessionId) {
    const next = await chatSessionStore.switchSession(sessionId);
    setActiveWorkspaceId(allowedWorkspaces.has(next?.workspaceId) ? next.workspaceId : "answer");
    await persistActiveWorkspace();
    renderAll();
  }

  async function toggleSessionPinned(sessionId) {
    const session = chatSessionStore.getSessions().find((item) => item.id === sessionId);
    if (!session) return;
    await chatSessionStore.setSessionPinned(sessionId, !session.pinned);
    renderAll();
  }

  async function forkSessionFromRail(sessionId) {
    const fork = await chatSessionStore.forkSession(sessionId);
    if (!fork) return;
    setActiveWorkspaceId("answer");
    await persistActiveWorkspace();
    renderAll();
  }

  async function deleteSessionFromRail(sessionId) {
    const session = chatSessionStore.getSessions().find((item) => item.id === sessionId);
    if (!session) return;
    if (!window.confirm(`Delete chat "${session.title}"? This cannot be undone.`)) return;
    await chatSessionStore.deleteSession(sessionId);
    setActiveWorkspaceId("answer");
    await persistActiveWorkspace();
    renderAll();
  }

  async function archiveSessionFromRail(sessionId) {
    const session = chatSessionStore.getSessions().find((item) => item.id === sessionId);
    if (!session) return;
    await chatSessionStore.setSessionArchived(sessionId, true);
    updateConnectionLine(`Archived chat: ${session.title}`);
    setActiveWorkspaceId("answer");
    await persistActiveWorkspace();
    renderAll();
  }

  async function renameSessionFromRail(sessionId) {
    const session = chatSessionStore.getSessions().find((item) => item.id === sessionId);
    if (!session) return;
    const title = window.prompt("Rename chat", session.title);
    if (!title?.trim()) return;
    await chatSessionStore.renameSession(sessionId, title);
    renderAll();
  }

  async function createProjectFromRail() {
    const name = window.prompt("Project name");
    if (!name?.trim()) return;
    const project = await chatSessionStore.createProject(name);
    updateConnectionLine(`Created project: ${project.name}`);
    renderAll();
  }

  async function assignSessionProject(sessionId, projectId = "") {
    const session = await chatSessionStore.setSessionProject(sessionId, projectId);
    if (!session) return;
    const project = chatSessionStore.getProjects().find((item) => item.id === projectId);
    updateConnectionLine(projectId ? `Moved to ${project?.name ?? "project"}` : "Moved out of project");
    renderAll();
  }

  async function toggleProjectExpanded(projectId) {
    const project = chatSessionStore.getProjects().find((item) => item.id === projectId);
    if (!project) return;
    await chatSessionStore.setProjectExpanded(projectId, !project.expanded);
    renderAll();
  }

  async function toggleProjectPinned(projectId) {
    const project = chatSessionStore.getProjects().find((item) => item.id === projectId);
    if (!project) return;
    await chatSessionStore.setProjectPinned(projectId, !project.pinned);
    renderAll();
  }

  async function renameProjectFromRail(projectId) {
    const project = chatSessionStore.getProjects().find((item) => item.id === projectId);
    if (!project) return;
    const name = window.prompt("Rename project", project.name);
    if (!name?.trim()) return;
    await chatSessionStore.renameProject(projectId, name);
    renderAll();
  }

  async function archiveProjectFromRail(projectId) {
    const project = chatSessionStore.getProjects().find((item) => item.id === projectId);
    if (!project) return;
    await chatSessionStore.setProjectArchived(projectId, true);
    updateConnectionLine(`Archived project: ${project.name}`);
    renderAll();
  }

  function railActionButton({ action, icon, label, onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rail-chat-action";
    button.dataset.action = action;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = iconSvg(icon);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void onClick();
    });
    return button;
  }

  function railSessionActions(session) {
    const actions = document.createElement("span");
    actions.className = "rail-chat-actions";
    actions.append(
      railActionButton({
        action: session.pinned ? "unpin" : "pin",
        icon: session.pinned ? "unpin" : "pin",
        label: session.pinned ? "Unpin chat" : "Pin chat",
        onClick: () => toggleSessionPinned(session.id)
      }),
      railActionButton({
        action: "rename",
        icon: "rename",
        label: "Rename chat",
        onClick: () => renameSessionFromRail(session.id)
      }),
      railActionButton({
        action: "fork",
        icon: "fork",
        label: "Fork chat",
        onClick: () => forkSessionFromRail(session.id)
      }),
      railActionButton({
        action: "archive",
        icon: "archive",
        label: "Archive chat",
        onClick: () => archiveSessionFromRail(session.id)
      }),
      railActionButton({
        action: "delete",
        icon: "delete",
        label: "Delete chat",
        onClick: () => deleteSessionFromRail(session.id)
      })
    );
    return actions;
  }

  function railProjectActions(project) {
    const actions = document.createElement("span");
    actions.className = "rail-chat-actions rail-project-actions";
    actions.append(
      railActionButton({
        action: project.pinned ? "unpin-project" : "pin-project",
        icon: project.pinned ? "unpin" : "pin",
        label: project.pinned ? "Unpin project" : "Pin project",
        onClick: () => toggleProjectPinned(project.id)
      }),
      railActionButton({
        action: "rename-project",
        icon: "rename",
        label: "Rename project",
        onClick: () => renameProjectFromRail(project.id)
      }),
      railActionButton({
        action: "archive-project",
        icon: "archive",
        label: "Archive project",
        onClick: () => archiveProjectFromRail(project.id)
      }),
      railActionButton({
        action: "delete-project",
        icon: "delete",
        label: "Delete project",
        onClick: async () => {
          if (!window.confirm(`Delete project "${project.name}"? Chats will move back to the main chat list.`)) return;
          await chatSessionStore.deleteProject(project.id);
          renderAll();
        }
      })
    );
    return actions;
  }

  function railChatButton(session, projectLabelById) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rail-chat-button";
    button.draggable = true;
    button.dataset.sessionId = session.id;
    button.classList.toggle("active", session.id === chatSessionStore.getActiveSessionId());
    button.classList.toggle("pinned", Boolean(session.pinned));
    button.classList.toggle("unread", Boolean(session.unread));
    button.title = `${session.title}${session.projectId ? ` · ${projectLabelById[session.projectId] ?? "Project"}` : ""}`;
    button.setAttribute("aria-label", `Open chat: ${button.title}`);
    if (session.id === chatSessionStore.getActiveSessionId()) {
      button.setAttribute("aria-current", "true");
    }
    const unread = document.createElement("span");
    unread.className = "rail-unread-dot";
    unread.innerHTML = session.unread ? iconSvg("dot") : "";
    const title = document.createElement("span");
    title.className = "rail-chat-title";
    title.textContent = session.title || "New chat";
    const meta = document.createElement("span");
    meta.className = "rail-chat-meta";
    meta.innerHTML = `${session.pinned ? iconSvg("pin") : ""}<span>${relativeTime(session.updatedAt)}</span>`;
    const body = document.createElement("span");
    body.className = "rail-chat-body";
    const top = document.createElement("span");
    top.className = "rail-chat-top";
    top.append(unread, title, meta);
    const actionLine = document.createElement("span");
    actionLine.className = "rail-action-line";
    actionLine.append(railSessionActions(session));
    body.append(top, actionLine);
    button.append(body);
    button.addEventListener("click", async () => {
      await switchToSession(session.id);
    });
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", session.id);
      event.dataTransfer.effectAllowed = "move";
    });
    return button;
  }

  function renderRailNavigation() {
    workspaceButtons.forEach((button) => {
      const active = button.dataset.workspace === activeWorkspace;
      button.classList.toggle("active", active);
      if (active) {
        button.setAttribute("aria-current", "page");
      } else {
        button.removeAttribute("aria-current");
      }
    });
    railClearSearch.hidden = !getRailSearchQuery();
    const allSessions = chatSessionStore.getSessions().filter(isRailVisibleChatSession);
    const projectEntries = orderedRailItems(chatSessionStore.getProjects().filter((project) => !project.archivedAt))
      .map((project) => ({
        project,
        projectSessions: orderedRailItems(allSessions.filter((session) => session.projectId === project.id))
      }))
      .filter(({ project, projectSessions }) => railSearchMatchesProject(project, projectSessions, getRailSearchQuery()));
    const projects = projectEntries.map(({ project }) => project);
    const projectLabelById = Object.fromEntries(chatSessionStore.getProjects().filter((project) => !project.archivedAt).map((project) => [project.id, project.name]));
    railProjectList.replaceChildren();
    if (!projectEntries.length) {
      const empty = document.createElement("li");
      empty.className = "rail-empty";
      empty.textContent = getRailSearchQuery() ? "No projects found." : "Create a project to group chats, files, and artifacts.";
      railProjectList.append(empty);
    }
    for (const { project, projectSessions } of projectEntries) {
      const row = document.createElement("li");
      row.className = "rail-project-item";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rail-project";
      button.dataset.projectId = project.id;
      button.classList.toggle("pinned", Boolean(project.pinned));
      button.setAttribute("aria-expanded", String(Boolean(project.expanded)));
      button.setAttribute("aria-label", `${project.expanded ? "Collapse" : "Expand"} project: ${project.name}. ${projectSessions.length} chat${projectSessions.length === 1 ? "" : "s"}.`);
      const top = document.createElement("span");
      top.className = "rail-project-top";
      top.innerHTML = `
        <span class="rail-project-expand">${iconSvg(project.expanded ? "chevronDown" : "chevronRight")}</span>
        ${iconSvg("folder")}
        <span class="rail-text">${project.name}</span>
        <kbd>${projectSessions.length}</kbd>
      `;
      const actionLine = document.createElement("span");
      actionLine.className = "rail-action-line";
      actionLine.append(railProjectActions(project));
      button.append(top, actionLine);
      button.addEventListener("click", () => void toggleProjectExpanded(project.id));
      button.addEventListener("dragover", (event) => {
        event.preventDefault();
        button.classList.add("drag-over");
        event.dataTransfer.dropEffect = "move";
      });
      button.addEventListener("dragleave", () => {
        button.classList.remove("drag-over");
      });
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        button.classList.remove("drag-over");
        const sessionId = event.dataTransfer.getData("text/plain");
        void assignSessionProject(sessionId, project.id);
      });
      row.append(button);
      if (project.expanded) {
        const list = document.createElement("ol");
        list.className = "rail-project-chat-list";
        for (const session of projectSessions) {
          const sessionRow = document.createElement("li");
          sessionRow.append(railChatButton(session, projectLabelById));
          list.append(sessionRow);
        }
        if (!projectSessions.length) {
          const emptyProject = document.createElement("li");
          emptyProject.className = "rail-empty rail-project-empty";
          emptyProject.textContent = "Drop chats here.";
          list.append(emptyProject);
        }
        row.append(list);
      }
      railProjectList.append(row);
    }
    const sessions = orderedRailItems(allSessions)
      .filter((session) => !session.projectId && railSearchMatchesSession(session, getRailSearchQuery()))
      .slice(0, 28);
    railChatList.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement("li");
      empty.className = "rail-empty";
      empty.textContent = getRailSearchQuery() ? "No chats found." : "Start a new chat or drag chats out of projects.";
      railChatList.append(empty);
      return;
    }
    for (const session of sessions) {
      const row = document.createElement("li");
      row.append(railChatButton(session, projectLabelById));
      railChatList.append(row);
    }
  }

  return {
    assignSessionProject,
    createProjectFromRail,
    renderRailNavigation,
    switchToSession,
  };
}
