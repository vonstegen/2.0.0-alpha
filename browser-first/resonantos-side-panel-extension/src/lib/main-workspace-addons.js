// Intent citation: docs/architecture/ADR-015-delegation-fabric-addon-catalog-native-tools.md
// Intent citation: docs/reference/CAPABILITY_MATRIX.md

import { capabilityReviewElement } from "./addon-capability-review.js";
import { addonWorkspaceMessage } from "./runtime-error-messages.js";

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
  if (addon.id === "addon.deepseek-harness") return "deepseek-harness";
  if (addon.id === "addon.recursive-mas") return "recursive-mas";
  if (addon.id === "addon.living-archive") return "memory";
  if (addon.id === "addon.reference-memory") return "memory";
  return "";
}

function addonExecutionKey(addon) {
  if (addon.id === "addon.hermes") return "hermes";
  if (addon.id === "addon.opencode") return "opencode";
  return "";
}

function createAddonCard(addon, actions = {}) {
  const card = document.createElement("article");
  card.className = "addon-card";
  card.dataset.tone = addonTone(addon);
  card.dataset.state = addonState(addon);

  const header = document.createElement("div");
  header.className = "addon-card-header";
  const title = document.createElement("div");
  title.className = "addon-card-title";
  const name = document.createElement("strong");
  name.textContent = addon.name || addon.id || "Unnamed add-on";
  const version = document.createElement("small");
  version.textContent = addon.version ?? "";
  title.append(name, version);
  const stateBadge = document.createElement("span");
  stateBadge.className = "addon-state-badge";
  stateBadge.dataset.tone = addonState(addon) === "installed" ? "success" : "warning";
  stateBadge.textContent = addonState(addon) === "installed" ? "Installed" : "Discoverable";
  header.append(title, stateBadge);

  const meta = document.createElement("p");
  meta.className = "addon-card-meta";
  const metaParts = [
    addon.id,
    addon.runtime ?? addon.runtimeType ?? "unknown runtime",
    addon.category ?? "",
    addon.source ? `from ${addon.source}` : ""
  ].filter(Boolean);
  meta.textContent = metaParts.join(" · ");

  // Capability chips — small pill-row showing what the manifest
  // requested. The granted/denied split lives in capabilityReviewElement
  // (added below); these chips are the high-signal "what is this
  // addon asking for" view.
  const capsRow = document.createElement("div");
  capsRow.className = "addon-cap-chips";
  const requested = Array.isArray(addon.requestedCapabilities) ? addon.requestedCapabilities : [];
  for (const cap of requested) {
    const chip = document.createElement("span");
    chip.className = "addon-cap-chip";
    chip.dataset.tone = "neutral";
    chip.textContent = cap;
    capsRow.append(chip);
  }

  // Tool list — every tool the addon declares. Tool rows are
  // copyable so a developer can paste the exact name into the
  // side-panel /tool slash command.
  const toolList = document.createElement("ul");
  toolList.className = "addon-tool-list";
  const tools = Array.isArray(addon.tools) ? addon.tools : [];
  if (tools.length === 0) {
    const empty = document.createElement("li");
    empty.className = "addon-tool-empty";
    empty.textContent = addon.runtime === "ui-module"
      ? "UI surface add-on — no bridge-dispatched tools."
      : "No tools declared in the manifest.";
    toolList.append(empty);
  } else {
    for (const toolName of tools) {
      const li = document.createElement("li");
      li.className = "addon-tool-row";
      const code = document.createElement("code");
      code.textContent = toolName;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "addon-tool-copy";
      copy.textContent = "Copy";
      copy.title = "Copy tool name for /tool slash command";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard?.writeText(toolName);
          copy.textContent = "Copied";
          setTimeout(() => { copy.textContent = "Copy"; }, 1200);
        } catch {
          copy.textContent = "Copy failed";
        }
      });
      li.append(code, copy);
      toolList.append(li);
    }
  }

  const boundary = document.createElement("small");
  boundary.className = "addon-boundary";
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

  card.append(header, meta);
  if (addon.untrusted) {
    const trustNotice = document.createElement("p");
    trustNotice.className = "addon-trust-notice";
    trustNotice.dataset.tone = "warning";
    trustNotice.textContent = addon.trustNotice || "Not tested or approved.";
    card.append(trustNotice);
  }
  if (capsRow.childNodes.length) card.append(capsRow);
  card.append(toolList);
  card.append(boundary, capabilityReviewElement(addon));
  if (execution.childNodes.length) card.append(execution);
  card.append(cardActions);
  return card;
}

// Categorize an addon into one of three states, mirroring VSCode's
// Extensions view: installed = the runtime is detectable; discoverable
// = the manifest exists but no tools OR runtime is detected;
// unavailable would be reserved for addons that failed validation
// (none today — the SDK validator rejects malformed manifests at
// install time).
function addonState(addon) {
  // Add-ons with a host execution record (Hermes, OpenCode) are installed
  // even though the status payload carries no runtime/tools fields.
  if (addon.execution) return "installed";
  const runtime = addon.runtime ?? addon.runtimeType ?? null;
  const hasTools = Array.isArray(addon.tools) && addon.tools.length > 0;
  if (["agent-addon", "local-service", "embedded-module"].includes(runtime) && hasTools) {
    return "installed";
  }
  if (["agent-addon", "local-service", "embedded-module", "channel-addon"].includes(runtime)) {
    return "discoverable";
  }
  if (runtime === "ui-module") return "discoverable";
  return "discoverable";
}

// Health state for the Installed view's compact rows: the colored icon is the
// only status surface. Green = running clean; yellow = warning (something is
// not running cleanly); red = an issue with the installed add-on.
function installedHealth(addon) {
  if (!addon.available) return "error";
  if (addon.disabled) return "warning";
  if (addon.untrusted) return "error";
  const exec = addon.execution ?? null;
  if (exec) {
    if (exec.localCliExecution && exec.mode !== "local-cli-detected") return "error";
    if (!exec.localCliExecution) return "warning";
  }
  if (Array.isArray(addon.deniedCapabilities) && addon.deniedCapabilities.length > 0) return "warning";
  return "ok";
}

const INSTALLED_HEALTH_LABEL = {
  ok: "Running clean",
  warning: "Warning — not running cleanly",
  error: "Issue detected"
};

// My Add-ons row: colored status icon + name + short description + management
// actions (on/off switch, discard from list, uninstall for personal-tier
// add-ons only). The Registry view keeps the full cards.
function createInstalledRow(addon, actions = {}) {
  const tone = installedHealth(addon);
  const stateLabel = addon.disabled ? "Off — switched off in My Add-ons" : INSTALLED_HEALTH_LABEL[tone];
  const row = document.createElement("li");
  row.className = "addons-installed-row";
  row.dataset.tone = tone;
  row.title = stateLabel;
  const icon = document.createElement("span");
  icon.className = "addons-health-icon";
  icon.setAttribute("aria-label", stateLabel);
  icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="currentColor"/></svg>`;
  const copy = document.createElement("div");
  copy.className = "addons-installed-copy";
  const name = document.createElement("strong");
  name.textContent = addon.name || addon.id || "Unnamed add-on";
  const detail = document.createElement("small");
  detail.textContent = addon.description || "";
  copy.append(name, detail);
  const controls = document.createElement("div");
  controls.className = "addons-installed-actions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "addons-switch";
  toggle.dataset.on = addon.disabled ? "false" : "true";
  toggle.textContent = addon.disabled ? "Off" : "On";
  toggle.title = addon.disabled ? "Switch this add-on on" : "Switch this add-on off";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      await actions.onToggleDisabled?.(addon, !addon.disabled);
    } catch {
      toggle.disabled = false;
    }
  });
  controls.append(toggle);
  const discard = document.createElement("button");
  discard.type = "button";
  discard.textContent = "Discard";
  discard.title = "Remove from My Add-ons list (reversible)";
  discard.addEventListener("click", () => void actions.onDiscard?.(addon));
  controls.append(discard);
  if (addon.untrusted) {
    const uninstall = document.createElement("button");
    uninstall.type = "button";
    uninstall.dataset.danger = "true";
    uninstall.textContent = "Uninstall";
    uninstall.title = "Remove this sideloaded add-on from the registry";
    uninstall.addEventListener("click", () => void actions.onUninstall?.(addon));
    controls.append(uninstall);
  }
  row.append(icon, copy, controls);
  return row;
}

// Build the SDK tab content: external links to the manifest contract,
// authoring guide, wire-format ADR, capability matrix, and bench
// commands. Rendered once at workspace load; no async data needed.
function buildSdkPanel(container) {
  container.innerHTML = `
    <div class="addons-sdk-grid">
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/tree/main/examples/addons" target="_blank" rel="noreferrer noopener">
        <strong>Example add-on manifests</strong>
        <small>examples/addons/ on GitHub — read the source of truth for addon.hermes.json, addon.deepseek-harness.json, and friends.</small>
      </a>
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/blob/main/docs/addons/authoring.md" target="_blank" rel="noreferrer noopener">
        <strong>Authoring guide</strong>
        <small>docs/addons/authoring.md — worked example shipping a new addon, end to end.</small>
      </a>
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/blob/main/bench/docs/authoring-a-new-addon.md" target="_blank" rel="noreferrer noopener">
        <strong>Bench workflow</strong>
        <small>bench/docs/authoring-a-new-addon.md — drop a manifest, optionally a stub, run <code>npm run bench:up</code>.</small>
      </a>
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/blob/main/docs/architecture/ADR-018-addon-sdk-v0.md" target="_blank" rel="noreferrer noopener">
        <strong>SDK contract (ADR-018)</strong>
        <small>Formal V0 contract: capabilities, surfaces, runtimes, engineer-setup, augmentor-skills.</small>
      </a>
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/blob/main/docs/architecture/ADR-031-agent-addon-sdk-lessons-from-hermes.md" target="_blank" rel="noreferrer noopener">
        <strong>Agent add-on wire format (ADR-031)</strong>
        <small>Lessons from Hermes; the OpenAI-compatible <code>/api/v1/chat/completions</code> contract the dispatcher speaks.</small>
      </a>
      <a class="addons-sdk-card" href="https://github.com/ResonantOS/2.0.0-alpha/blob/main/docs/architecture/CAPABILITY_MATRIX.md" target="_blank" rel="noreferrer noopener">
        <strong>Capability matrix</strong>
        <small>What each capability means, who can grant it, where it's used.</small>
      </a>
    </div>
    <div class="addons-sdk-cli">
      <span class="hero-kicker">Bench commands</span>
      <pre><code>npm run bench:up          # build + start the bench
npm run bench:roundtrip   # dispatch every discovered tool through the live dispatcher
npm run bench:down        # stop + remove the container (volume retained)
npm run bench:reset       # wipe volume + rebuild from scratch
npm run bench:panel       # open http://127.0.0.1:47773/dev/external-agent-runtimes/</code></pre>
    </div>
  `;
  // Open external links safely — target=_blank alone exposes window.opener
  // unless we add noopener. GitHub links are safe but defensive is cheap.
  for (const link of container.querySelectorAll('a[target="_blank"]')) {
    link.relList.add("noopener");
  }
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

export function renderAddOnsWorkspace({ container, bridgeRequest, getBridgeRequest, onOpenProviderHandoff, onOpenWorkspace, initialView = "registry", storage = null, storageKeys = {} }) {
  // Resolve at call time. The module-level `bridgeRequest` may be
  // null at construction (rebind still in flight); the getter lets
  // us re-read the current value on every call.
  const bridge = () => (typeof getBridgeRequest === "function" ? getBridgeRequest() : bridgeRequest);

  const section = document.createElement("section");
  section.className = "addons-workspace";
  section.setAttribute("aria-label", "Add-ons workspace");

  const heroCopy = {
    registry: {
      kicker: "Add-on registry",
      title: "Replaceable capabilities, explicit trust.",
      body: "Review the add-ons currently visible to the browser-first host. Add-ons are useful tools, not trusted core agents, and every privileged operation stays mediated by ResonantOS."
    },
    installed: {
      kicker: "My Add-ons",
      title: "Your add-ons, your switches.",
      body: "Switch add-ons on or off, uninstall personal-tier add-ons, or discard them from this list. Bundled add-ons cannot be uninstalled."
    },
    discover: {
      kicker: "Discover",
      title: "Manifests known, surfaces not yet live.",
      body: "Add-ons the host has loaded but whose runtime or tools are not detected yet. They stay discoverable until a runtime makes them detectable."
    },
    sdk: {
      kicker: "Add-on SDK",
      title: "Build add-ons for ResonantOS.",
      body: "The manifest contract, the wire format, and the bench workflow for shipping your own add-on into the registry."
    }
  };
  const activeHero = heroCopy[Object.hasOwn(heroCopy, initialView) ? initialView : "registry"];
  const header = document.createElement("header");
  header.className = "addons-hero";
  header.innerHTML = `
    <span class="hero-kicker">${activeHero.kicker}</span>
    <h1>${activeHero.title}</h1>
    <p>${activeHero.body}</p>
  `;

  // The four Add-ons sub-views live under the rail's Add-ons tab; the rail
  // sub-item click sets the view and re-renders this workspace, so only the
  // requested view is mounted. All data is still fetched once per render.
  const status = document.createElement("p");
  status.className = "addons-status";
  status.textContent = "Loading add-on registry...";

  // Registry view: every add-on the host knows about. Installed holds the
  // runtime-detectable, tool-bearing subset; Discover shows manifests the
  // bridge has loaded but that don't have a runtime-detectable surface yet.
  const registryGrid = document.createElement("div");
  registryGrid.className = "addons-grid";
  const registryView = document.createElement("div");
  registryView.className = "addons-view";
  registryView.append(status, registryGrid);

  const installedStatus = document.createElement("p");
  installedStatus.className = "addons-status";
  installedStatus.textContent = "Loading your add-ons...";
  const installedList = document.createElement("ul");
  installedList.className = "addons-installed-list";
  const discardedLine = document.createElement("div");
  discardedLine.className = "addons-discarded";
  discardedLine.hidden = true;
  const installedView = document.createElement("div");
  installedView.className = "addons-view";
  installedView.append(installedStatus, installedList, discardedLine);

  // Discarded add-ons: per-user list state, persisted in extension storage.
  // Discarding only hides an add-on from My Add-ons; it does not disable or
  // uninstall anything.
  let discarded = new Set();
  const discardedKey = storageKeys?.discardedAddons ?? "";
  async function persistDiscarded() {
    if (storage && discardedKey) {
      await storage.set({ [discardedKey]: [...discarded] }).catch(() => undefined);
    }
  }
  function renderDiscarded() {
    const count = discarded.size;
    discardedLine.hidden = count === 0;
    if (!count) return;
    discardedLine.replaceChildren();
    const text = document.createElement("span");
    text.textContent = `${count} add-on${count === 1 ? "" : "s"} discarded from your list.`;
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Restore all";
    restore.addEventListener("click", async () => {
      discarded.clear();
      await persistDiscarded();
      renderDiscarded();
      await loadAddons();
    });
    discardedLine.append(text, restore);
  }
  async function hydrateDiscarded() {
    if (!storage || !discardedKey) return;
    const result = await storage.get(discardedKey).catch(() => ({}));
    const list = result?.[discardedKey];
    discarded = new Set(Array.isArray(list) ? list : []);
    renderDiscarded();
  }
  const rowActions = {
    onToggleDisabled: async (addon, disabled) => {
      await bridge()("/addons/execution-settings", {
        method: "POST",
        capability: "addon-execution-settings-write",
        body: { addon: addon.id, disabled }
      });
      await loadAddons();
    },
    onUninstall: async (addon) => {
      const confirmed = window.confirm(`Uninstall ${addon.name}? This removes the add-on from the registry.`);
      if (!confirmed) return;
      await bridge()("/addons/uninstall", {
        method: "POST",
        capability: "addon-execution-settings-write",
        body: { addonId: addon.id }
      });
      await loadAddons();
    },
    onDiscard: async (addon) => {
      discarded.add(addon.id);
      await persistDiscarded();
      renderDiscarded();
      await loadAddons();
    }
  };
  void hydrateDiscarded();

  const discoverStatus = document.createElement("p");
  discoverStatus.className = "addons-status";
  discoverStatus.textContent = "Loading discoverable add-ons...";
  const discoverGrid = document.createElement("div");
  discoverGrid.className = "addons-grid";
  const discoverView = document.createElement("div");
  discoverView.className = "addons-view";
  discoverView.append(discoverStatus, discoverGrid);

  const sdkView = document.createElement("div");
  sdkView.className = "addons-view";
  // Build the SDK view once at render time — the content is static
  // links, no async data needed.
  buildSdkPanel(sdkView);

  const views = { registry: registryView, installed: installedView, discover: discoverView, sdk: sdkView };
  const viewContainer = document.createElement("div");
  viewContainer.className = "addons-views";
  viewContainer.append(views[Object.hasOwn(views, initialView) ? initialView : "registry"]);

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
  section.append(header, viewContainer, delegationReview, draftReview);
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

  const loadAddons = async () => {
    try {
      const result = await bridge()("/addons/status", { method: "GET" });
      const addons = Array.isArray(result.addons) ? result.addons : [];
      const installed = addons.filter((a) => addonState(a) === "installed");
      const discoverable = addons.filter((a) => addonState(a) !== "installed");
      const renderCard = (addon) => createAddonCard(addon, {
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
      });
      registryGrid.replaceChildren(...addons.map(renderCard));
      const visibleInstalled = installed.filter((addon) => !discarded.has(addon.id));
      installedList.replaceChildren(...visibleInstalled.map((addon) => createInstalledRow(addon, rowActions)));
      discoverGrid.replaceChildren(...discoverable.map(renderCard));
      const onCount = visibleInstalled.filter((addon) => !addon.disabled).length;
      installedStatus.textContent = visibleInstalled.length
        ? `${visibleInstalled.length} add-on${visibleInstalled.length === 1 ? "" : "s"} in your list — ${onCount} on, ${visibleInstalled.length - onCount} off.`
        : "No add-ons in your list.";
      installedStatus.dataset.tone = visibleInstalled.length ? "success" : "warning";
      discoverStatus.textContent = discoverable.length
        ? `${discoverable.length} discoverable add-on${discoverable.length === 1 ? "" : "s"} — manifest present, no tools or runtime not detected yet.`
        : "No additional add-ons discovered.";
      discoverStatus.dataset.tone = discoverable.length ? "neutral" : "";
      // The headline status doubles as the Registry status line.
      status.textContent = `${addons.length} add-on${addons.length === 1 ? "" : "s"} in the registry — ${installed.length} installed, ${discoverable.length} discoverable.`;
      status.dataset.tone = installed.length ? "success" : "warning";
    } catch (error) {
      status.textContent = addonWorkspaceMessage(error, "Add-on registry unavailable");
      status.dataset.tone = "error";
      installedStatus.textContent = "Registry unavailable.";
      installedStatus.dataset.tone = "error";
    }
  };

  void loadAddons();
  void loadDelegations();
  void loadDrafts();

  return section;
}
