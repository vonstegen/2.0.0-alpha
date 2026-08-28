import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { renderAddOnsWorkspace } from "../resonantos-side-panel-extension/src/lib/main-workspace-addons.js";

test("add-ons workspace renders registry status and governed open actions", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  const container = dom.window.document.querySelector("#root");
  const opened = [];
  const providerHandoffs = [];
  const calls = [];
  let draftStatus = "draft-only";
  let hermesExecution = false;
  let hermesStatus = "queued";
  let hermesResultArtifactPath = "";
  let openCodeExecution = false;
  let openCodeStatus = "queued";
  let openCodeResultArtifactPath = "";
  const bridgeRequest = async (route, options = {}) => {
    calls.push([route, options.body ?? null]);
    if (route === "/addons/status") {
      return {
        addons: [
          {
            id: "addon.hermes",
            name: "Hermes",
            available: true,
            mode: "delegation-addon",
            trust: "add-on agent",
            requestedCapabilities: ["agent-delegation", "network", "notifications"],
            grantedCapabilities: ["agent-delegation"],
            deniedCapabilities: ["network"],
            execution: { localCliExecution: hermesExecution }
          },
          {
            id: "addon.opencode",
            name: "OpenCode",
            available: false,
            mode: "coding-addon",
            trust: "add-on agent",
            requestedCapabilities: ["agent-delegation", "filesystem-scoped", "shell", "providers"],
            grantedCapabilities: ["agent-delegation"],
            deniedCapabilities: openCodeExecution ? [] : ["shell"],
            execution: { localCliExecution: openCodeExecution }
          },
          {
            id: "addon.living-archive",
            name: "Living Archive",
            available: true,
            mode: "memory-system",
            trust: "host-mediated memory provider",
            requestedCapabilities: ["archive-read", "archive-intake-write", "archive-knowledge-write"],
            grantedCapabilities: ["archive-read", "archive-intake-write"],
            deniedCapabilities: ["archive-knowledge-write"]
          },
          {
            id: "addon.email",
            name: "Email",
            available: true,
            mode: "draft-only-communication-addon",
            trust: "host-mediated draft provider",
            requestedCapabilities: ["communication-draft", "provider-handoff", "external-send"],
            grantedCapabilities: ["communication-draft", "provider-handoff"],
            deniedCapabilities: ["external-send"]
          },
          {
            id: "addon.calendar",
            name: "Calendar",
            available: true,
            mode: "draft-only-scheduling-addon",
            trust: "host-mediated draft provider",
            requestedCapabilities: ["calendar-draft", "provider-handoff", "external-schedule"],
            grantedCapabilities: ["calendar-draft", "provider-handoff"],
            deniedCapabilities: ["external-schedule"]
          }
        ]
      };
    }
    if (route === "/addons/execution-settings") {
      assert.equal(options.capability, "addon-execution-settings-write");
      if (options.body.addon === "hermes") {
        hermesExecution = Boolean(options.body.localCliExecution);
      }
      if (options.body.addon === "opencode") {
        openCodeExecution = Boolean(options.body.localCliExecution);
      }
      return {
        addon: options.body.addon,
        status: options.body.localCliExecution ? "enabled" : "disabled"
      };
    }
    if (route === "/addons/draft/list") {
      return {
        drafts: [{
          id: "email-draft-a",
          intent: "Project update",
          path: "BrowserFirst/AddOnDrafts/email/email-draft-a.md",
          status: draftStatus,
          target: "email",
          updatedAt: "2026-05-29T10:00:00.000Z"
        }]
      };
    }
    if (route === "/addons/delegate/list") {
      return {
        delegations: [
          {
            id: "hermes-1",
            contextExcerpt: "Goal coordinate task across add-on agents.",
            hasContextPacket: true,
            mission: "Coordinate a bounded Hermes delegation.",
            path: "BrowserFirst/Delegations/hermes/hermes-1.md",
            resultArtifactPath: hermesResultArtifactPath,
            resultExcerpt: hermesResultArtifactPath ? "Hermes completed deterministic result." : "",
            sourceControlRunId: "",
            sourceKind: "resonantos-chat",
            status: hermesStatus,
            target: "hermes",
            updatedAt: "2026-05-29T10:01:00.000Z"
          },
          {
            id: "opencode-1",
            contextExcerpt: "Coding scope browser-first tests.",
            hasContextPacket: true,
            mission: "Inspect browser-first tests and return verification evidence.",
            path: "BrowserFirst/Delegations/opencode/opencode-1.md",
            resultArtifactPath: openCodeResultArtifactPath,
            resultExcerpt: openCodeResultArtifactPath ? "OpenCode completed deterministic result." : "",
            sourceControlRunId: "",
            sourceKind: "resonantos-chat",
            status: openCodeStatus,
            target: "opencode",
            updatedAt: "2026-05-29T10:00:30.000Z"
          },
          {
            id: "engineer-1",
            contextExcerpt: "Goal find a booking slot. Blocked step Submit. Public submit requires approval.",
            hasContextPacket: true,
            mission: "Investigate blocked browser-control task.",
            path: "BrowserFirst/Delegations/engineer/engineer-1.md",
            sourceControlRunId: "job-1",
            sourceKind: "browser-control-blocker",
            status: "queued",
            target: "engineer",
            updatedAt: "2026-05-29T10:00:00.000Z"
          }
        ]
      };
    }
    if (route === "/hermes/delegation/start") {
      assert.equal(options.body.path, "BrowserFirst/Delegations/hermes/hermes-1.md");
      hermesStatus = "completed";
      hermesResultArtifactPath = "BrowserFirst/DelegationArtifacts/hermes/hermes-1-result.md";
      return {
        id: "hermes-1",
        path: options.body.path,
        resultArtifactPath: hermesResultArtifactPath,
        status: hermesStatus
      };
    }
    if (route === "/hermes/delegation/artifact") {
      assert.equal(options.body.path, "BrowserFirst/Delegations/hermes/hermes-1.md");
      return {
        content: "# Hermes Result\n\n## Final Summary\nHermes completed deterministic result.",
        finalSummary: "Hermes completed deterministic result.",
        path: hermesResultArtifactPath
      };
    }
    if (route === "/hermes/delegation/cancel") {
      hermesStatus = "cancelled";
      return { id: "hermes-1", path: options.body.path, status: hermesStatus };
    }
    if (route === "/opencode/delegation/start") {
      assert.equal(options.body.path, "BrowserFirst/Delegations/opencode/opencode-1.md");
      openCodeStatus = "completed";
      openCodeResultArtifactPath = "BrowserFirst/DelegationArtifacts/opencode/opencode-1-result.md";
      return {
        id: "opencode-1",
        path: options.body.path,
        resultArtifactPath: openCodeResultArtifactPath,
        status: openCodeStatus
      };
    }
    if (route === "/opencode/delegation/artifact") {
      assert.equal(options.body.path, "BrowserFirst/Delegations/opencode/opencode-1.md");
      return {
        content: "# OpenCode Result\n\n## Final Summary\nOpenCode completed deterministic result.",
        finalSummary: "OpenCode completed deterministic result.",
        path: openCodeResultArtifactPath
      };
    }
    if (route === "/opencode/delegation/cancel") {
      openCodeStatus = "cancelled";
      return { id: "opencode-1", path: options.body.path, status: openCodeStatus };
    }
    if (route === "/addons/draft/transition") {
      draftStatus = options.body.status;
      return { id: "email-draft-a", status: draftStatus };
    }
    if (route === "/addons/draft/handoff") {
      return {
        handoff: {
          action: "manual-review-compose",
          boundary: "Opens a Gmail compose draft for human review. ResonantOS does not send the email.",
          provider: options.body.provider,
          target: "email",
          url: "https://mail.google.com/mail/?view=cm&fs=1&su=Project+update&body=Ready"
        },
        id: "email-draft-a",
        status: draftStatus
      };
    }
    throw new Error(`Unexpected route ${route}`);
  };

  renderAddOnsWorkspace({
    container,
    bridgeRequest,
    onOpenProviderHandoff: (handoff, draft) => providerHandoffs.push([handoff, draft.id]),
    onOpenWorkspace: (workspaceId) => opened.push(workspaceId)
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls.map((call) => call[0]), ["/addons/status", "/addons/delegate/list", "/addons/draft/list"]);
  assert.match(container.textContent, /Replaceable capabilities, explicit trust/);
  assert.match(container.textContent, /5 add-on[s]? in the registry/);
  assert.match(container.textContent, /Hermes/);
  assert.match(container.textContent, /OpenCode/);
  assert.match(container.textContent, /Living Archive/);
  assert.match(container.textContent, /Email/);
  assert.match(container.textContent, /Calendar/);
  assert.match(container.textContent, /not trusted core agents/i);
  assert.match(container.textContent, /Direct trusted wiki writes remain blocked/);
  assert.match(container.textContent, /Sending and scheduling remain human-approval gated/);
  assert.match(container.textContent, /Capability contract/);
  assert.match(container.textContent, /Capability enforcement happens at the bridge via per-route tokens; these chips describe the add-on contract\./);
  assert.match(container.textContent, /Declaredagent-delegation/);
  assert.match(container.textContent, /Needs reviewnotifications/);
  assert.match(container.textContent, /Denied by policynetwork/);
  assert.match(container.textContent, /Disabledshell/);
  assert.match(container.textContent, /archive-knowledge-write/);
  assert.match(container.textContent, /Local CLI execution disabled/);
  assert.match(container.textContent, /Draft approval/);
  assert.match(container.textContent, /Delegation packets/);
  assert.match(container.textContent, /Agent handoffs/);
  assert.match(container.textContent, /engineer-1/);
  assert.match(container.textContent, /browser-control-blocker · control run job-1/);
  assert.match(container.textContent, /Context packet: Goal find a booking slot/);
  assert.match(container.textContent, /3 delegation packets recorded/);
  assert.match(container.textContent, /Hermes · hermes-1/);
  assert.match(container.textContent, /Coordinate a bounded Hermes delegation/);
  assert.match(container.textContent, /OpenCode · opencode-1/);
  assert.match(container.textContent, /Inspect browser-first tests/);
  assert.match(container.textContent, /Project update/);
  assert.match(container.textContent, /provider draft surfaces for human review only/);
  const buttons = [...container.querySelectorAll(".addon-card > .addon-card-actions button")];
  assert.equal(buttons.length, 3);
  assert.equal(buttons.find((button) => /OpenCode/.test(button.textContent)).disabled, true);
  buttons.find((button) => /Hermes/.test(button.textContent)).click();
  buttons.find((button) => /Living Archive/.test(button.textContent)).click();
  assert.deepEqual(opened, ["hermes", "memory"]);

  const enableHermes = [...container.querySelectorAll(".addon-execution-panel button")]
    .find((button) => /Enable local execution/.test(button.textContent));
  assert.equal(enableHermes.disabled, false);
  enableHermes.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) =>
    call[0] === "/addons/execution-settings" &&
    call[1].addon === "hermes" &&
    call[1].localCliExecution === true
  ));
  assert.match(container.textContent, /Local CLI execution enabled/);
  assert.match(container.textContent, /Disable local execution/);

  const startHermes = [...container.querySelectorAll(".addon-delegation-card button")]
    .find((button) => /Start Hermes/.test(button.textContent));
  assert.equal(startHermes.disabled, false);
  startHermes.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/hermes/delegation/start"));
  assert.match(container.textContent, /Hermes completed deterministic result/);

  const readHermes = [...container.querySelectorAll(".addon-delegation-card button")]
    .find((button) => /Read Result/.test(button.textContent));
  assert.equal(readHermes.disabled, false);
  readHermes.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/hermes/delegation/artifact"));
  assert.match(container.textContent, /Hermes result · hermes-1/);

  const startOpenCode = [...container.querySelectorAll(".addon-delegation-card button")]
    .find((button) => /Start OpenCode/.test(button.textContent));
  assert.equal(startOpenCode.disabled, false);
  startOpenCode.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/opencode/delegation/start"));
  assert.match(container.textContent, /OpenCode completed deterministic result/);

  const readOpenCode = [...container.querySelectorAll(".addon-delegation-card button")]
    .filter((button) => /Read Result/.test(button.textContent))
    .at(-1);
  assert.equal(readOpenCode.disabled, false);
  readOpenCode.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/opencode/delegation/artifact"));
  assert.match(container.textContent, /OpenCode result · opencode-1/);

  container.querySelector(".addon-draft-card button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/addons/draft/transition" && call[1].status === "approved-for-manual-send"));
  assert.match(container.textContent, /approved-for-manual-send/);

  const handoffButton = [...container.querySelectorAll(".addon-draft-card button")].find((button) => /Gmail/.test(button.textContent));
  assert.equal(handoffButton.disabled, false);
  handoffButton.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some((call) => call[0] === "/addons/draft/handoff" && call[1].provider === "gmail"));
  assert.equal(providerHandoffs[0][0].provider, "gmail");
  assert.equal(providerHandoffs[0][1], "email-draft-a");
});

test("add-ons workspace reports bridge failures without exposing secrets", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  const container = dom.window.document.querySelector("#root");

  renderAddOnsWorkspace({
    container,
    bridgeRequest: async () => {
      throw new Error("host unavailable token=abc123 sk-settings-secret");
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(container.textContent, /Add-on registry unavailable: host unavailable/);
  assert.match(container.textContent, /Delegation review unavailable: host unavailable/);
  assert.match(container.textContent, /Draft review unavailable: host unavailable/);
  assert.equal(container.querySelector(".addons-status").dataset.tone, "error");
  assert.doesNotMatch(container.textContent, /abc123|sk-settings-secret/i);
});

test("add-ons workspace replaces raw bridge fetch failures with setup guidance", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  const container = dom.window.document.querySelector("#root");

  renderAddOnsWorkspace({
    container,
    bridgeRequest: async () => {
      throw new TypeError("Failed to fetch");
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(container.textContent, /Add-on registry unavailable: ResonantOS bridge is unreachable/);
  assert.match(container.textContent, /Delegation review unavailable: ResonantOS bridge is unreachable/);
  assert.match(container.textContent, /Draft review unavailable: ResonantOS bridge is unreachable/);
  assert.match(container.textContent, /Settings > Bridge Target/);
  assert.doesNotMatch(container.textContent, /Failed to fetch/);
});

test("installed view renders compact health rows with green/yellow/red tones", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  const container = dom.window.document.querySelector("#root");
  const bridgeRequest = async (route) => {
    if (route === "/addons/status") {
      return {
        addons: [
          {
            id: "addon.clean",
            name: "Clean Agent",
            available: true,
            runtime: "agent-addon",
            tools: ["tool.x"],
            description: "Runs clean."
          },
          {
            id: "addon.warny",
            name: "Warny Agent",
            available: true,
            runtime: "agent-addon",
            tools: ["tool.y"],
            description: "Warning state.",
            execution: { localCliExecution: false, mode: "packet-only" }
          },
          {
            id: "addon.broken",
            name: "Broken Agent",
            available: false,
            runtime: "agent-addon",
            tools: ["tool.z"],
            description: "Issue state."
          }
        ]
      };
    }
    if (route === "/addons/draft/list") return { drafts: [] };
    if (route === "/addons/delegate/list") return { delegations: [] };
    return {};
  };
  renderAddOnsWorkspace({ container, bridgeRequest, initialView: "installed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rows = [...container.querySelectorAll(".addons-installed-row")];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].dataset.tone, "ok");
  assert.equal(rows[1].dataset.tone, "warning");
  assert.equal(rows[2].dataset.tone, "error");
  assert.match(container.textContent, /Clean Agent/);
  assert.match(container.textContent, /Runs clean\./);
  // The installed view carries no full registry cards.
  assert.equal(container.querySelectorAll(".addon-card").length, 0);
});

test("My Add-ons rows toggle, uninstall, and discard add-ons", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  dom.window.confirm = () => true;
  const container = dom.window.document.querySelector("#root");
  const calls = [];
  const stored = {};
  const storage = {
    get: async (key) => ({ [key]: stored[key] }),
    set: async (entry) => { Object.assign(stored, entry); }
  };
  const addons = [
    { id: "addon.clean", name: "Clean Agent", available: true, runtime: "agent-addon", tools: ["tool.x"], description: "Runs clean." },
    { id: "addon.sideloaded", name: "Sideloaded Agent", available: true, untrusted: true, runtime: "agent-addon", tools: ["tool.y"], description: "Personal tier." },
    { id: "addon.warny", name: "Warny Agent", available: true, disabled: true, runtime: "agent-addon", tools: ["tool.z"], description: "Switched off." }
  ];
  const bridgeRequest = async (route, options = {}) => {
    calls.push([route, options.body ?? null, options.capability ?? null]);
    if (route === "/addons/status") return { addons };
    if (route === "/addons/draft/list") return { drafts: [] };
    if (route === "/addons/delegate/list") return { delegations: [] };
    return {};
  };
  renderAddOnsWorkspace({
    container,
    bridgeRequest,
    initialView: "installed",
    storage,
    storageKeys: { discardedAddons: "testDiscarded" }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const rows = () => [...container.querySelectorAll(".addons-installed-row")];
  const rowFor = (name) => rows().find((row) => row.querySelector("strong")?.textContent === name);
  assert.equal(rows().length, 3);

  // Switch off: On -> Off through the gated execution-settings route.
  rowFor("Clean Agent").querySelector(".addons-switch").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some(([route, body, capability]) =>
    route === "/addons/execution-settings" &&
    capability === "addon-execution-settings-write" &&
    body.addon === "addon.clean" &&
    body.disabled === true
  ));

  // Uninstall the personal-tier add-on (confirm stubbed to accept).
  rowFor("Sideloaded Agent").querySelector("button[data-danger]").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.some(([route, body]) => route === "/addons/uninstall" && body.addonId === "addon.sideloaded"));

  // Discard hides the row and persists the id.
  rowFor("Warny Agent").querySelector("button:not(.addons-switch)").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(stored.testDiscarded, ["addon.warny"]);
  assert.equal(rows().length, 2);
  assert.match(container.querySelector(".addons-discarded").textContent, /1 add-on discarded/);

  // Restore all brings the row back.
  container.querySelector(".addons-discarded button").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stored.testDiscarded.length, 0);
  assert.equal(rows().length, 3);
});

test("hello-resonant add-on is added to the registry and Discover views as untrusted", async () => {
  const dom = new JSDOM(`<main id="root"></main>`, { url: "https://example.test/" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  const container = dom.window.document.querySelector("#root");

  // Shape matches what the bridge's /addons/status returns for the
  // examples/addons/addon.hello-resonant.json manifest.
  const helloResonant = {
    id: "addon.hello-resonant",
    name: "Hello Resonant",
    available: true,
    mode: "unknown",
    trust: "host-mediated service",
    trustTier: "personal",
    untrusted: true,
    trustNotice: "Not tested or approved — no verified or approved signature (personal trust tier).",
    requestedCapabilities: [],
    grantedCapabilities: [],
    runtime: "ui-module",
    category: "tool",
    source: "examples/addons",
    tools: []
  };
  const bridgeRequest = async (route) => {
    if (route === "/addons/status") return { addons: [helloResonant] };
    if (route === "/addons/draft/list") return { drafts: [] };
    if (route === "/addons/delegate/list") return { delegations: [] };
    throw new Error(`Unexpected route ${route}`);
  };

  // Registry (default) view: the add-on card renders with a Discoverable
  // badge and the untrusted warning.
  renderAddOnsWorkspace({ container, bridgeRequest });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(container.textContent, /Hello Resonant/);
  assert.match(container.textContent, /addon\.hello-resonant/);
  assert.match(container.textContent, /Discoverable/);
  assert.match(container.textContent, /1 add-on in the registry — 0 installed, 1 discoverable/);
  const notice = container.querySelector(".addon-trust-notice");
  assert.ok(notice, "expected the untrusted notice element to render");
  assert.equal(notice.dataset.tone, "warning");
  assert.match(notice.textContent, /Not tested or approved/);

  // Discover view: a ui-module with no tools stays discoverable.
  const discoverContainer = dom.window.document.createElement("main");
  renderAddOnsWorkspace({ container: discoverContainer, bridgeRequest, initialView: "discover" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(discoverContainer.textContent, /Hello Resonant/);
  assert.match(discoverContainer.textContent, /1 discoverable add-on/);

  // Installed view: it is not runtime-detectable, so it does not appear.
  const installedContainer = dom.window.document.createElement("main");
  renderAddOnsWorkspace({ container: installedContainer, bridgeRequest, initialView: "installed" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(installedContainer.textContent, /No add-ons in your list/);
  assert.doesNotMatch(installedContainer.textContent, /Hello Resonant/);
});
