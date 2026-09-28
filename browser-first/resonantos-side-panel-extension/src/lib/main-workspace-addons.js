// Intent citation: docs/architecture/ADR-015-delegation-fabric-addon-catalog-native-tools.md
// Intent citation: docs/reference/CAPABILITY_MATRIX.md

import { capabilityReviewElement } from "./addon-capability-review.js";
import { addonWorkspaceMessage, redactSensitiveErrorMessage } from "./runtime-error-messages.js";

function addonTone(addon) {
  if (addon.available) return "success";
  return "warning";
}

function addonBoundary(addon) {
  if (addon.boundary) return addon.boundary;
  if (/draft-only/i.test(addon.mode ?? "")) {
    return "Draft-only add-ons can prepare communication or scheduling packets. Sending and scheduling remain human-approval gated.";
  }
  if (addon.mode === "memory-system") {
    return "Memory add-ons are accessed through scoped host APIs. Direct trusted wiki writes remain blocked.";
  }
  if (/coding/i.test(addon.mode ?? "")) {
    return "Coding add-ons receive bounded delegation packets and must return artifacts through ResonantOS.";
  }
  return "Agent add-ons are not trusted core agents. Augmentor mediates delegation and artifact return.";
}

function workspaceForAddon(addon) {
  if (addon.id === "addon.hermes") return "hermes";
  if (addon.id === "addon.opencode") return "opencode";
  if (addon.id === "addon.living-archive") return "memory";
  if (addon?.runtimeType === "local-service" && addon.entrypoint) {
    return `workspace-iframe:${addon.id}`;
  }
  return "";
}

function addonExecutionKey(addon) {
  if (addon.id === "addon.hermes") return "hermes";
  if (addon.id === "addon.opencode") return "opencode";
  return "";
}

function workspaceAddonStatusLabel(addon) {
  if (!addon.available) return "Not running";
  if (!addon.installed) return "Discovered";
  if ((addon.grantedCapabilities ?? []).length) return "Granted";
  return "Denied";
}

function workspaceAddonGrantableCapabilities(addon) {
  const granted = new Set(addon.grantedCapabilities ?? []);
  return (addon.requestedCapabilities ?? []).filter((capability) => !granted.has(capability));
}

function workspaceAddonRevocableCapabilities(addon) {
  return [...new Set(addon.grantedCapabilities ?? [])];
}

// Builds the /addons/workspace/grant payload from the requested grant shape.
// Only currently-ungranted capabilities are sent with granted: true; the
// registry's setGrants merges (it leaves already-granted entries untouched),
// and scope + revocationBehavior are preserved so the registry's sameRequest
// match accepts each entry. This is NOT derived from grantPresets.
function workspaceGrantPayload(addon) {
  const granted = new Set(addon.grantedCapabilities ?? []);
  return (addon.requestedGrantShape ?? []).filter((request) => !granted.has(request.capability)).map((request) => ({
    capability: request.capability,
    scope: request.scope ?? "none",
    revocationBehavior: request.revocationBehavior ?? "hard-stop",
    granted: true,
  }));
}

// Distinguishes policy denial (4xx) from runtime/upstream failure (5xx) and
// bridge-unreachable (network). A failed mutation is never rendered as success.
function workspaceMutationFailure(error, action) {
  const statusCode = Number(error?.bridgeStatus);
  if (statusCode >= 400 && statusCode < 500) {
    return {
      status: "error",
      tone: "policy",
      message: `${action} denied by policy (HTTP ${statusCode}): ${redactSensitiveErrorMessage(error)}`,
    };
  }
  if (statusCode >= 500 && statusCode < 600) {
    return {
      status: "error",
      tone: "runtime",
      message: `${action} failed (HTTP ${statusCode}): ${redactSensitiveErrorMessage(error)}`,
    };
  }
  return { status: "error", tone: "network", message: addonWorkspaceMessage(error, `${action} failed`) };
}

function createWorkspaceAddonCard(addon, actions = {}) {
  const card = document.createElement("article");
  card.className = "addon-card addon-card--workspace";
  card.dataset.tone = addon.available ? "success" : "warning";

  const header = document.createElement("div");
  header.className = "addon-card-header";
  const title = document.createElement("strong");
  title.textContent = addon.name || addon.id || "Unnamed workspace add-on";
  const status = document.createElement("span");
  status.textContent = workspaceAddonStatusLabel(addon);
  status.dataset.tone = addon.available ? "success" : "warning";
  header.append(title, status);

  const meta = document.createElement("p");
  meta.textContent = `workspace-addon · ${addon.origin ?? "loopback"}`;

  const boundary = document.createElement("small");
  boundary.textContent = addon.boundary ?? "Workspace add-on with cross-origin sandboxed iframe and postMessage bootstrap.";

  const mutation = addon.mutation ?? null;
  const pending = mutation?.status === "pending";

  const cardActions = document.createElement("div");
  cardActions.className = "addon-card-actions";

  // Open stays the primary (first) action: the extension live tests select the
  // first non-disabled button in each card as the workspace launcher.
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = `Open ${addon.name}`;
  open.disabled = !addon.available || pending;
  open.title = addon.available
    ? `Open the ${addon.name} workspace in a sandboxed cross-origin iframe.`
    : `${addon.name} upstream is not reachable at ${addon.origin}. Start the operator-side service and retry.`;
  open.addEventListener("click", () => actions.onOpenWorkspace?.(`workspace-iframe:${addon.id}`, addon));
  cardActions.append(open);

  // Explicit install/grant/revoke are the only authority mutations the UI
  // offers. Each maps to one host-owned route; none constructs
  // upstreamAdminUrl or sends adminToken, and none touches the upstream
  // /admin/* surface directly.
  if (!addon.installed) {
    const install = document.createElement("button");
    install.type = "button";
    install.textContent = `Install ${addon.name}`;
    install.disabled = pending;
    install.title = pending
      ? "An install is already in progress."
      : "Register this discovered add-on with the host registry. Installation grants nothing; capabilities stay denied until you explicitly grant them.";
    install.addEventListener("click", () => actions.onInstall?.(addon));
    cardActions.append(install);
  } else {
    const grantable = workspaceAddonGrantableCapabilities(addon);
    if (grantable.length) {
      const grant = document.createElement("button");
      grant.type = "button";
      grant.textContent = "Grant requested capabilities";
      grant.disabled = pending;
      grant.title = pending
        ? "A grant mutation is already in progress."
        : `Explicitly grant ${grantable.join(", ")} through the host-owned grant route.`;
      grant.addEventListener("click", () => actions.onGrant?.(addon));
      cardActions.append(grant);
    }
    const revocable = workspaceAddonRevocableCapabilities(addon);
    if (revocable.length) {
      const revoke = document.createElement("button");
      revoke.type = "button";
      revoke.textContent = "Revoke granted capabilities";
      revoke.disabled = pending;
      revoke.title = pending
        ? "A revoke mutation is already in progress."
        : `Explicitly revoke ${revocable.join(", ")} through the converged host revoke route (registry + upstream).`;
      revoke.addEventListener("click", () => actions.onRevoke?.(addon));
      cardActions.append(revoke);
    }
  }

  card.append(header, meta, boundary, capabilityReviewElement(addon));
  if (mutation) {
    const line = document.createElement("small");
    line.className = "addon-mutation-status";
    line.dataset.tone = mutation.tone;
    line.textContent = mutation.message;
    card.append(line);
  }
  card.append(cardActions);
  return card;
}

function createAddonCard(addon, actions = {}) {
  const card = document.createElement("article");
  card.className = "addon-card";
  card.dataset.tone = addonTone(addon);

  const header = document.createElement("div");
  header.className = "addon-card-header";
  const title = document.createElement("strong");
  title.textContent = addon.name || addon.id || "Unnamed add-on";
  const status = document.createElement("span");
  status.textContent = addon.available ? "Available" : "Missing";
  status.dataset.tone = addonTone(addon);
  header.append(title, status);

  const meta = document.createElement("p");
  meta.textContent = `${addon.mode || "unknown mode"} · ${addon.trust || "explicit grants required"}`;

  const boundary = document.createElement("small");
  boundary.textContent = addonBoundary(addon);

  const execution = document.createElement("div");
  execution.className = "addon-execution-panel";
  const executionKey = addonExecutionKey(addon);
  if (executionKey) {
    const enabled = Boolean(addon.execution?.localCliExecution);
    const copy = document.createElement("small");
    copy.textContent = enabled
      ? "Local CLI execution enabled. The add-on still receives governed task packets and returns artifacts."
      : "Local CLI execution disabled. Delegations stay packet-only or deterministic until explicitly enabled.";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = enabled ? "Disable local execution" : "Enable local execution";
    toggle.addEventListener("click", () => actions.onToggleExecution?.(addon, !enabled));
    execution.append(copy, toggle);
  }

  const cardActions = document.createElement("div");
  cardActions.className = "addon-card-actions";
  const workspace = workspaceForAddon(addon);
  if (workspace) {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = `Open ${addon.name}`;
    open.disabled = !addon.available;
    open.addEventListener("click", () => actions.onOpenWorkspace?.(workspace, addon));
    cardActions.append(open);
  }

  card.append(header, meta, boundary, capabilityReviewElement(addon));
  if (execution.childNodes.length) card.append(execution);
  card.append(cardActions);
  return card;
}

function providerForDraft(draft) {
  if (draft.target === "email") return "gmail";
  if (draft.target === "calendar") return "google-calendar";
  return "";
}

function providerActionLabel(draft) {
  if (draft.target === "email") return "Open Gmail Draft";
  if (draft.target === "calendar") return "Open Google Calendar Draft";
  return "Open Provider Draft";
}

function createDraftReviewCard(draft, onTransition, onProviderHandoff) {
  const card = document.createElement("article");
  card.className = "addon-draft-card";
  card.dataset.status = draft.status || "draft-only";

  const header = document.createElement("div");
  header.className = "addon-card-header";
  const title = document.createElement("strong");
  title.textContent = draft.intent || draft.id || "Untitled draft";
  const status = document.createElement("span");
  status.textContent = draft.status || "draft-only";
  header.append(title, status);

  const meta = document.createElement("p");
  meta.textContent = `${draft.target || "draft"} · ${draft.path || "no path"}`;

  const boundary = document.createElement("small");
  boundary.textContent = "Review only. Approving marks this draft ready for manual send/schedule; ResonantOS does not execute the external action here.";

  const actions = document.createElement("div");
  actions.className = "addon-card-actions";
  const approve = document.createElement("button");
  approve.type = "button";
  approve.textContent = "Approve for Manual Action";
  approve.disabled = draft.status === "approved-for-manual-send";
  approve.addEventListener("click", () => onTransition?.(draft, "approved-for-manual-send"));
  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = "Reject";
  reject.disabled = draft.status === "rejected";
  reject.addEventListener("click", () => onTransition?.(draft, "rejected"));
  const handoff = document.createElement("button");
  handoff.type = "button";
  handoff.textContent = providerActionLabel(draft);
  handoff.disabled = draft.status !== "approved-for-manual-send";
  handoff.title = handoff.disabled
    ? "Approve this draft before opening a provider draft surface."
    : "Open the provider draft surface for human review. ResonantOS will not send or schedule.";
  handoff.addEventListener("click", () => onProviderHandoff?.(draft, providerForDraft(draft)));
  actions.append(approve, handoff, reject);

  card.append(header, meta, boundary, actions);
  return card;
}

function targetLabel(target) {
  if (target === "opencode") return "OpenCode";
  if (target === "hermes") return "Hermes";
  if (target === "engineer") return "Resonant Engineer";
  return target || "Unknown target";
}

function createDelegationCard(delegation, actions = {}) {
  const card = document.createElement("article");
  card.className = "addon-delegation-card";
  card.dataset.status = delegation.status || "queued";

  const header = document.createElement("div");
  header.className = "addon-card-header";
  const title = document.createElement("strong");
  title.textContent = `${targetLabel(delegation.target)} · ${delegation.id || "delegation"}`;
  const status = document.createElement("span");
  status.textContent = delegation.status || "queued";
  header.append(title, status);

  const mission = document.createElement("p");
  mission.textContent = delegation.mission || "No mission preview available.";

  const meta = document.createElement("small");
  meta.textContent = [
    delegation.sourceKind || "resonantos-chat",
    delegation.sourceControlRunId ? `control run ${delegation.sourceControlRunId}` : "",
    delegation.path || ""
  ].filter(Boolean).join(" · ");

  const context = document.createElement("small");
  context.className = delegation.hasContextPacket ? "addon-delegation-context" : "";
  context.textContent = delegation.hasContextPacket
    ? `Context packet: ${delegation.contextExcerpt || "bounded task evidence attached."}`
    : "No context packet was attached. This delegation only contains the mission text.";

  const result = document.createElement("small");
  result.className = "addon-delegation-context";
  result.hidden = !delegation.resultExcerpt;
  result.textContent = delegation.resultExcerpt ? `Result: ${delegation.resultExcerpt}` : "";

  const controls = document.createElement("div");
  controls.className = "addon-card-actions";
  if (delegation.target === "hermes" || delegation.target === "opencode") {
    const label = delegation.target === "hermes" ? "Hermes" : "OpenCode";
    const actionPrefix = delegation.target === "hermes" ? "Hermes" : "OpenCode";
    const start = document.createElement("button");
    start.type = "button";
    start.textContent = delegation.status === "blocked" ? `Retry ${label}` : `Start ${label}`;
    start.disabled = !["queued", "blocked", "failed"].includes(delegation.status || "queued");
    start.addEventListener("click", () => actions[`onStart${actionPrefix}`]?.(delegation));
    const read = document.createElement("button");
    read.type = "button";
    read.textContent = "Read Result";
    read.disabled = !delegation.resultArtifactPath;
    read.addEventListener("click", () => actions[`onRead${actionPrefix}`]?.(delegation));
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.disabled = ["completed", "cancelled"].includes(delegation.status || "queued");
    cancel.addEventListener("click", () => actions[`onCancel${actionPrefix}`]?.(delegation));
    controls.append(start, read, cancel);
  }

  card.append(header, mission, meta, context, result, controls);
  return card;
}

export function renderAddOnsWorkspace({ container, bridgeRequest, getBridgeRequest, onOpenProviderHandoff, onOpenWorkspace }) {
  // Resolve at call time. The module-level `bridgeRequest` may be
  // null at construction (rebind still in flight); the getter lets
  // us re-read the current value on every call.
  const bridge = () => (typeof getBridgeRequest === "function" ? getBridgeRequest() : bridgeRequest);
  const section = document.createElement("section");
  section.className = "addons-workspace";
  section.setAttribute("aria-label", "Add-ons workspace");

  const header = document.createElement("header");
  header.className = "addons-hero";
  header.innerHTML = `
    <span class="hero-kicker">Add-on registry</span>
    <h1>Replaceable capabilities, explicit trust.</h1>
    <p>Review the add-ons currently visible to the browser-first host. Add-ons are useful tools, not trusted core agents, and every privileged operation stays mediated by ResonantOS.</p>
  `;

  const status = document.createElement("p");
  status.className = "addons-status";
  status.textContent = "Loading add-on registry...";

  const grid = document.createElement("div");
  grid.className = "addons-grid";

  const workspaceSection = document.createElement("section");
  workspaceSection.className = "addons-workspace-addons";
  workspaceSection.hidden = true;
  const workspaceHeader = document.createElement("div");
  workspaceHeader.className = "addon-draft-review-header";
  workspaceHeader.innerHTML = `
    <div>
      <span class="hero-kicker">Workspace add-ons</span>
      <h2>Operator-started loopback add-ons</h2>
      <p>Each workspace add-on is a local-service that the operator starts; the host only connects to its declared loopback endpoint. Capability tokens are delivered via the cross-origin postMessage bootstrap; the bridge token is never shared with the add-on.</p>
    </div>
  `;
  const workspaceGrid = document.createElement("div");
  workspaceGrid.className = "addons-grid";
  workspaceSection.append(workspaceHeader, workspaceGrid);

  const draftReview = document.createElement("section");
  draftReview.className = "addon-draft-review";
  const draftHeader = document.createElement("div");
  draftHeader.className = "addon-draft-review-header";
  draftHeader.innerHTML = `
    <div>
      <span class="hero-kicker">Draft approval</span>
      <h2>Email and calendar packets</h2>
      <p>Draft-only add-ons can prepare communication or scheduling packets. Human review can approve them for manual action, but provider sending/scheduling is still not automated here.</p>
    </div>
  `;
  const draftStatus = document.createElement("p");
  draftStatus.className = "addons-status";
  draftStatus.textContent = "Loading draft packets...";
  const draftList = document.createElement("div");
  draftList.className = "addon-draft-list";
  draftReview.append(draftHeader, draftStatus, draftList);

  const delegationReview = document.createElement("section");
  delegationReview.className = "addon-draft-review addon-delegation-review";
  const delegationHeader = document.createElement("div");
  delegationHeader.className = "addon-draft-review-header";
  delegationHeader.innerHTML = `
    <div>
      <span class="hero-kicker">Delegation packets</span>
      <h2>Agent handoffs</h2>
      <p>Review the governed task packets Augmentor has created for Hermes, OpenCode, and the Resonant Engineer. Context packets are evidence only; add-ons still do not receive raw credentials, wallet authority, or trusted memory-write authority.</p>
    </div>
  `;
  const delegationStatus = document.createElement("p");
  delegationStatus.className = "addons-status";
  delegationStatus.textContent = "Loading delegation packets...";
  const delegationList = document.createElement("div");
  delegationList.className = "addon-draft-list addon-delegation-list";
  delegationReview.append(delegationHeader, delegationStatus, delegationList);

  section.append(header, status, grid, workspaceSection, delegationReview, draftReview);
  container.replaceChildren(section);

  const loadDrafts = async () => {
    try {
      const result = await bridge()("/addons/draft/list", { method: "POST", body: { limit: 8 } });
      const drafts = Array.isArray(result.drafts) ? result.drafts : [];
      draftList.replaceChildren();
      drafts.forEach((draft) => draftList.append(createDraftReviewCard(draft, async (selected, nextStatus) => {
        draftStatus.textContent = `Updating ${selected.id}...`;
        draftStatus.dataset.tone = "";
        await bridge()("/addons/draft/transition", {
          method: "POST",
          body: {
            path: selected.path,
            status: nextStatus,
            reason: `Human reviewed ${selected.target} draft from Add-ons workspace.`
          }
        });
        await loadDrafts();
      }, async (selected, provider) => {
        draftStatus.textContent = `Opening ${providerActionLabel(selected)}...`;
        draftStatus.dataset.tone = "";
        const result = await bridge()("/addons/draft/handoff", {
          method: "POST",
          body: {
            path: selected.path,
            provider,
            reviewer: "human"
          }
        });
        await onOpenProviderHandoff?.(result.handoff, selected);
        await loadDrafts();
      })));
      draftStatus.textContent = drafts.length
        ? `${drafts.length} draft packet${drafts.length === 1 ? "" : "s"} waiting or reviewed. Approved drafts can open provider draft surfaces for human review only.`
        : "No email or calendar draft packets yet. Use /email or /calendar from chat to create one.";
      draftStatus.dataset.tone = drafts.length ? "success" : "warning";
    } catch (error) {
      draftStatus.textContent = addonWorkspaceMessage(error, "Draft review unavailable");
      draftStatus.dataset.tone = "error";
    }
  };

  const loadDelegations = async () => {
    try {
      const result = await bridge()("/addons/delegate/list", { method: "POST", body: { limit: 8 } });
      const delegations = Array.isArray(result.delegations) ? result.delegations : [];
      delegationList.replaceChildren();
      delegations.forEach((delegation) => delegationList.append(createDelegationCard(delegation, {
        onStartHermes: async (selected) => {
          delegationStatus.textContent = `Starting Hermes task ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          await bridge()("/hermes/delegation/start", {
            method: "POST",
            body: { path: selected.path }
          });
          await loadDelegations();
        },
        onReadHermes: async (selected) => {
          delegationStatus.textContent = `Reading Hermes result ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          const result = await bridge()("/hermes/delegation/artifact", {
            method: "POST",
            body: { path: selected.path }
          });
          const preview = document.createElement("article");
          preview.className = "addon-draft-card addon-delegation-result-card";
          const title = document.createElement("strong");
          title.textContent = `Hermes result · ${selected.id}`;
          const body = document.createElement("p");
          body.textContent = result.finalSummary || result.content?.slice(0, 420) || "No result summary available.";
          const meta = document.createElement("small");
          meta.textContent = result.path || selected.resultArtifactPath || "";
          preview.append(title, body, meta);
          delegationList.prepend(preview);
          delegationStatus.textContent = "Hermes result loaded.";
          delegationStatus.dataset.tone = "success";
        },
        onCancelHermes: async (selected) => {
          delegationStatus.textContent = `Cancelling Hermes task ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          await bridge()("/hermes/delegation/cancel", {
            method: "POST",
            body: { path: selected.path, reason: "Human cancelled from Add-ons workspace." }
          });
          await loadDelegations();
        },
        onStartOpenCode: async (selected) => {
          delegationStatus.textContent = `Starting OpenCode task ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          await bridge()("/opencode/delegation/start", {
            method: "POST",
            body: { path: selected.path }
          });
          await loadDelegations();
        },
        onReadOpenCode: async (selected) => {
          delegationStatus.textContent = `Reading OpenCode result ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          const result = await bridge()("/opencode/delegation/artifact", {
            method: "POST",
            body: { path: selected.path }
          });
          const preview = document.createElement("article");
          preview.className = "addon-draft-card addon-delegation-result-card";
          const title = document.createElement("strong");
          title.textContent = `OpenCode result · ${selected.id}`;
          const body = document.createElement("p");
          body.textContent = result.finalSummary || result.content?.slice(0, 420) || "No result summary available.";
          const meta = document.createElement("small");
          meta.textContent = result.path || selected.resultArtifactPath || "";
          preview.append(title, body, meta);
          delegationList.prepend(preview);
          delegationStatus.textContent = "OpenCode result loaded.";
          delegationStatus.dataset.tone = "success";
        },
        onCancelOpenCode: async (selected) => {
          delegationStatus.textContent = `Cancelling OpenCode task ${selected.id}...`;
          delegationStatus.dataset.tone = "";
          await bridge()("/opencode/delegation/cancel", {
            method: "POST",
            body: { path: selected.path, reason: "Human cancelled from Add-ons workspace." }
          });
          await loadDelegations();
        }
      })));
      delegationStatus.textContent = delegations.length
        ? `${delegations.length} delegation packet${delegations.length === 1 ? "" : "s"} recorded. Context packets can be audited before an add-on acts.`
        : "No delegation packets yet. Ask Augmentor to delegate to Hermes, OpenCode, or Resonant Engineer.";
      delegationStatus.dataset.tone = delegations.length ? "success" : "warning";
    } catch (error) {
      delegationStatus.textContent = addonWorkspaceMessage(error, "Delegation review unavailable");
      delegationStatus.dataset.tone = "error";
    }
  };

  // T5 operator grant/revoke UI: mutation state is transient, per-add-on.
  // "pending" disables that add-on's mutation buttons (no duplicate actions);
  // "error" surfaces a failure without ever claiming success. Authoritative
  // state always comes from a re-read of GET /addons/status after a mutation.
  const mutationState = new Map();
  let workspaceAddons = [];

  function renderWorkspaceCards() {
    workspaceGrid.replaceChildren();
    workspaceAddons.forEach((addon) => {
      const mutation = mutationState.get(addon.id) ?? null;
      workspaceGrid.append(createWorkspaceAddonCard(
        { ...addon, mutation },
        {
          onOpenWorkspace,
          onInstall: (selected) => runWorkspaceMutation(selected, "install", `Install ${selected.name}`),
          onGrant: (selected) => runWorkspaceMutation(selected, "grant", `Grant ${selected.name}`),
          onRevoke: (selected) => runWorkspaceMutation(selected, "revoke", `Revoke ${selected.name}`),
        },
      ));
    });
    workspaceSection.hidden = workspaceAddons.length === 0;
  }

  function workspaceMutationBody(kind, addon) {
    if (kind === "install") return { addonId: addon.id };
    if (kind === "grant") return { addonId: addon.id, grants: workspaceGrantPayload(addon) };
    if (kind === "revoke") return { addonId: addon.id, capabilities: workspaceAddonRevocableCapabilities(addon) };
    return {};
  }

  async function runWorkspaceMutation(addon, kind, actionLabel) {
    if (mutationState.get(addon.id)?.status === "pending") return;
    mutationState.set(addon.id, { status: "pending", tone: "pending", message: `${actionLabel}...` });
    renderWorkspaceCards();
    try {
      await bridge()(`/addons/workspace/${kind}`, { method: "POST", body: workspaceMutationBody(kind, addon) });
      mutationState.delete(addon.id);
      // Success: authoritative re-read, never an optimistic local flip.
      await loadAddons();
    } catch (error) {
      mutationState.set(addon.id, workspaceMutationFailure(error, actionLabel));
      // Re-read so the card reflects the host's current (unchanged) state and
      // shows the failure; a failed mutation is never displayed as success.
      await loadAddons();
    }
  }

  const loadAddons = async () => {
    try {
      const result = await bridge()("/addons/status", { method: "GET" });
      const addons = Array.isArray(result.addons) ? result.addons : [];
      const workspaceManifests = Array.isArray(result.workspaceAddonManifests) ? result.workspaceAddonManifests : [];
      workspaceAddons = workspaceManifests.map((manifest) => ({
        id: manifest.id,
        name: manifest.name,
        available: Boolean(manifest.available),
        installed: Boolean(manifest.installed),
        mode: manifest.mode ?? "workspace-addon",
        trust: manifest.trust ?? "host-mediated workspace add-on",
        category: manifest.category,
        requestedCapabilities: (manifest.requestedCapabilities ?? []).map((grant) => grant.capability),
        // The requested grant shape (scope + revocationBehavior) is what the
        // registry matches on when the operator explicitly grants. grantPresets
        // are deliberately NOT consulted for UI authority.
        requestedGrantShape: (manifest.requestedCapabilities ?? []).map((grant) => ({
          capability: grant.capability,
          scope: grant.scope,
          revocationBehavior: grant.revocationBehavior,
        })),
        // Phase 3 (P6): grantedCapabilities / deniedCapabilities come from
        // the host-owned registry snapshot the bridge carries in
        // `workspaceAddonManifests` (see `addon-delegation-service.mjs`
        // executeAddonsStatus). Until the host grants, this is empty —
        // the manifest's grantPresets no longer drive UI chip states.
        grantedCapabilities: Array.isArray(manifest.grantedCapabilities) ? manifest.grantedCapabilities : [],
        deniedCapabilities: Array.isArray(manifest.deniedCapabilities) ? manifest.deniedCapabilities : [],
        boundary: `Workspace add-on running on its own loopback origin (${manifest.origin}). The iframe is sandboxed cross-origin; capability tokens are delivered out-of-band via postMessage with targetOrigin pinned to the add-on origin. Grants are host-owned: see the host registry's installation.grantedCapabilities, not the manifest's grantPresets.`,
        runtimeType: manifest.runtimeType,
        entrypoint: manifest.entrypoint,
        origin: manifest.origin,
        surfaces: manifest.surfaces,
      }));
      grid.replaceChildren();
      addons.forEach((addon) => grid.append(createAddonCard(addon, {
        onOpenWorkspace,
        onToggleExecution: async (selected, enabled) => {
          const addonKey = addonExecutionKey(selected);
          if (!addonKey) return;
          status.textContent = `${enabled ? "Enabling" : "Disabling"} ${selected.name} local execution...`;
          status.dataset.tone = "";
          await bridge()("/addons/execution-settings", {
            method: "POST",
            capability: "addon-execution-settings-write",
            body: {
              addon: addonKey,
              localCliExecution: enabled
            }
          });
          await loadAddons();
        }
      })));
      const coreCount = addons.length;
      const workspaceCount = workspaceAddons.length;
      const statusParts = [];
      statusParts.push(`${coreCount} core add-on${coreCount === 1 ? "" : "s"} visible.`);
      if (workspaceCount > 0) {
        statusParts.push(`${workspaceCount} workspace add-on${workspaceCount === 1 ? "" : "s"} available.`);
      } else {
        statusParts.push("No workspace add-ons are registered with this host.");
      }
      status.textContent = statusParts.join(" ");
      status.dataset.tone = addons.some((addon) => addon.available) || workspaceAddons.some((addon) => addon.available) ? "success" : "warning";
      renderWorkspaceCards();
    } catch (error) {
      status.textContent = addonWorkspaceMessage(error, "Add-on registry unavailable");
      status.dataset.tone = "error";
    }
  };

  void loadAddons();
  void loadDelegations();
  void loadDrafts();

  return section;
}
