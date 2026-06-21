import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const browserFirstRoot = path.join(repoRoot, "browser-first");
const extensionRoot = path.join(browserFirstRoot, "resonantos-side-panel-extension");

const readJson = async (filePath) => JSON.parse(await readFile(filePath, "utf8"));
const readText = (filePath) => readFile(filePath, "utf8");
const toPortablePath = (value) => String(value ?? "").replace(/\\/g, "/");

const windowsSelfTestFlags = new Map([
  ["--bridge-auth-self-test=true", "--bridge-auth-inprocess-self-test=true"],
  ["--hermes-delegation-self-test=true", "--hermes-delegation-inprocess-self-test=true"],
  ["--hermes-cli-execution-self-test=true", "--hermes-cli-execution-inprocess-self-test=true"],
  ["--opencode-delegation-self-test=true", "--opencode-delegation-inprocess-self-test=true"],
  ["--opencode-cli-execution-self-test=true", "--opencode-cli-execution-inprocess-self-test=true"],
  ["--addon-execution-settings-self-test=true", "--addon-execution-settings-inprocess-self-test=true"],
]);

async function readCssWithImports(filePath) {
  const css = await readText(filePath);
  const imported = await Promise.all(
    [...css.matchAll(/@import url\("([^"]+)"\);/g)].map(async ([, importPath]) => {
      const importedPath = path.resolve(path.dirname(filePath), importPath);
      return readText(importedPath);
    }),
  );
  return [css, ...imported].join("\n");
}

function skipIfLocalhostBindDenied(t, result) {
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/listen EPERM: operation not permitted 127\.0\.0\.1/.test(output)) {
    t.skip("localhost bind is denied in this sandbox; bridge behavior must be verified outside sandboxed CI.");
    return true;
  }
  return false;
}

function runBridgeSelfTest(t, args, timeout = 15_000) {
  const effectiveArgs = process.platform === "win32"
    ? args
      .map((arg) => windowsSelfTestFlags.get(arg) ?? arg)
      .filter((arg) => !/^--(?:bridge-token|bridge-port|addon-execution-settings-token)=/.test(arg))
    : args;
  const result = spawnSync("node", [path.join(browserFirstRoot, "host", "run-browser-first.mjs"), ...effectiveArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
  });

  if (skipIfLocalhostBindDenied(t, result)) {
    return null;
  }

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("ADR-037 makes browser-first Chromium the product direction", async () => {
  const adr = await readText(path.join(repoRoot, "docs", "architecture", "ADR-037-browser-first-chromium-resonantos.md"));
  const adr035 = await readText(path.join(repoRoot, "docs", "architecture", "ADR-035-electron-host-rust-core-runtime.md"));
  const adr036 = await readText(path.join(repoRoot, "docs", "architecture", "ADR-036-wallet-capable-browser-host.md"));

  assert.match(adr, /browser-first application/i);
  assert.match(adr, /Chromium-family browser/i);
  assert.match(adr, /not a ResonantOS dashboard that opens or controls another browser/i);
  assert.match(adr, /Phantom Wallet must run in the same browser profile/i);
  assert.match(adr, /Do not present external Chrome\/Brave CDP control as the product Browser/i);
  assert.match(adr035, /Superseded by ADR-037/);
  assert.match(adr036, /Superseded by ADR-037/);
});

test("ResonantOS browser layer is packaged as a Chromium side-panel extension", async () => {
  const manifest = await readJson(path.join(extensionRoot, "manifest.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "ResonantOS Browser Layer");
  // Version is bumped to 0.1.14 to ship the v0.1.13 race-condition fix
  // (bridge()() lazy getter in 30+ controllers) and the v0.1.14 audioCapture
  // permission removal. See CHANGELOG for the full list.
  assert.equal(manifest.version, "0.1.14");
  assert.equal(manifest.key.length > 100, true);
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("activeTab"));
  // audioCapture was removed in v0.1.14: it is deprecated (ChromeOS packaged
  // apps only) and tripped Chrome's "Issues 1 found" warning. ResonantOS
  // uses navigator.mediaDevices.getUserMedia for mic capture, which does
  // not need a manifest permission.
  assert.ok(!manifest.permissions.includes("audioCapture"),
    "audioCapture permission must not be requested (deprecated; not needed for getUserMedia)");
  assert.ok(manifest.permissions.includes("clipboardRead"));
  assert.ok(manifest.permissions.includes("clipboardWrite"));
  assert.ok(manifest.permissions.includes("history"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "src/lib/control-overlay.js",
    "src/lib/content-field-safety.js",
    "src/lib/content-inline-actions.js",
    "src/lib/content-control-refs.js",
    "src/content.js",
  ]);
  assert.equal(manifest.side_panel.default_path, "src/side-panel.html");
  assert.equal(manifest.chrome_url_overrides.newtab, "src/main-workspace.html");
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.background.service_worker, "src/background.js");
  assert.equal(manifest.commands["open-augmentor-side-panel"].suggested_key.mac, "Alt+Shift+A");
});

test("browser-first main workspace owns new-tab AI chat and hands browser tasks to the sidebar", async () => {
  const manifest = await readJson(path.join(extensionRoot, "manifest.json"));
  const workspace = await readText(path.join(extensionRoot, "src", "main-workspace.html"));
  const workspaceScript = await readText(path.join(extensionRoot, "src", "main-workspace.js"));
  const workspaceStyles = await readCssWithImports(path.join(extensionRoot, "src", "main-workspace.css"));
  const promptRouter = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-prompt-router.js"));
  const workspaceActionController = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-action-controller.js"));
  const workspaceRailController = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-rail-controller.js"));
  const launcher = await readText(path.join(browserFirstRoot, "host", "run-browser-first.mjs"));
  const agentControlHostService = await readText(path.join(browserFirstRoot, "host", "agent-control-host-service.mjs"));
  const hostUtils = await readText(path.join(browserFirstRoot, "host", "browser-first-host-utils.mjs"));
  const profileService = await readText(path.join(browserFirstRoot, "host", "browser-profile-service.mjs"));
  const addonDelegationService = await readText(path.join(browserFirstRoot, "host", "addon-delegation-service.mjs"));
  const addonDelegationHostService = await readText(path.join(browserFirstRoot, "host", "addon-delegation-host-service.mjs"));
  const browserDiagnosticsHostService = await readText(path.join(browserFirstRoot, "host", "browser-diagnostics-host-service.mjs"));
  const browserDiagnosticsService = await readText(path.join(browserFirstRoot, "host", "browser-diagnostics-service.mjs"));
  const providerHostService = await readText(path.join(browserFirstRoot, "host", "provider-host-service.mjs"));
  const providerBridgeService = await readText(path.join(browserFirstRoot, "host", "provider-bridge-service.mjs"));
  const memoryHostService = await readText(path.join(browserFirstRoot, "host", "memory-host-service.mjs"));
  const memorySourceIntakeHostService = await readText(path.join(browserFirstRoot, "host", "memory-source-intake-host-service.mjs"));
  const memorySourceSettingsService = await readText(path.join(browserFirstRoot, "host", "memory-source-settings-service.mjs"));
  const selfTestService = await readText(path.join(browserFirstRoot, "host", "browser-first-self-test-service.mjs"));
  const archiveReviewHostService = await readText(path.join(browserFirstRoot, "host", "archive-review-host-service.mjs"));
  const archiveReviewService = await readText(path.join(browserFirstRoot, "host", "archive-review-service.mjs"));
  const archiveMerge = await readText(path.join(browserFirstRoot, "host", "archive-merge.mjs"));
  const background = await readText(path.join(extensionRoot, "src", "background.js"));
  const contentScript = await readText(path.join(extensionRoot, "src", "content.js"));
  const sidePanel = await readText(path.join(extensionRoot, "src", "side-panel.js"));
  const commandRouter = await readText(path.join(extensionRoot, "src", "lib", "side-panel-command-router.js"));
  const appCommandHandlers = await readText(path.join(extensionRoot, "src", "lib", "app-command-handlers.js"));
  const delegationLifecycle = await readText(path.join(extensionRoot, "src", "lib", "delegation-lifecycle.js"));
  const hermesWorkspace = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-hermes.js"));
  const memoryWorkspace = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-memory.js"));
  const workspaceSettings = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-settings.js"));
  const workspaceRail = await readText(path.join(extensionRoot, "src", "lib", "main-workspace-rail.js"));
  const diagnosticsSettings = await readText(path.join(extensionRoot, "src", "lib", "settings", "diagnostics-section.js"));
  const aboutSettings = await readText(path.join(extensionRoot, "src", "lib", "settings", "about-section.js"));
  const browserControlSettings = await readText(path.join(extensionRoot, "src", "lib", "settings", "browser-control-section.js"));
  const messageActionController = await readText(path.join(extensionRoot, "src", "lib", "message-action-controller.js"));

  assert.equal(manifest.chrome_url_overrides.newtab, "src/main-workspace.html");
  assert.match(workspace, /ResonantOS main workspace/);
  assert.match(workspace, /New chat/);
  assert.match(workspace, /Search chats/);
  assert.match(workspace, /Tools/);
  assert.doesNotMatch(workspace, /Pinned Add-ons/);
  assert.match(workspace, /Projects/);
  assert.match(workspace, /rail-new-project/);
  assert.match(workspace, /rail-project-list/);
  assert.match(workspace, /Chats/);
  assert.match(workspace, /rail-chat-list/);
  assert.doesNotMatch(workspace, /ResonantOS Architecture/);
  assert.match(workspace, /Artifacts/);
  assert.match(workspace, /Add-ons/);
  assert.match(workspace, /Living Archive/);
  assert.match(workspace, /Hermes/);
  assert.match(workspace, /OpenCode/);
  assert.match(workspace, /Settings/);
  assert.doesNotMatch(workspace, /System Settings/);
  assert.doesNotMatch(workspace, /Manolo Remiddi/);
  assert.match(workspace, /rail-user-name/);
  assert.match(workspace, /data-settings-section="profile"/);
  assert.match(workspaceSettings, /label: "Profile"/);
  assert.match(workspaceSettings, /renderPersonalizationSection/);
  assert.match(workspaceScript, /initialSettingsSection/);
  assert.match(workspaceScript, /parseWorkspaceDeepLink/);
  assert.match(workspaceScript, /#settings\/\$\{settingsSection \|\| initialSettingsSection \|\| "overview"\}/);
  assert.match(workspaceScript, /const requestedDeepLink = parseWorkspaceDeepLink\(\)/);
  assert.match(workspaceScript, /if \(!requestedDeepLink\) \{/);
  assert.match(workspaceScript, /window\.addEventListener\("hashchange"/);
  assert.match(workspace, /model-select/);
  assert.match(workspace, /thinking-depth/);
  assert.match(workspace, /composer-tools-menu/);
  assert.doesNotMatch(workspace, />Links<\/button>/);
  assert.doesNotMatch(workspace, />Images<\/button>/);
  assert.match(workspace, /read-page/);
  assert.match(workspace, /save-intake/);
  assert.match(workspace, /save-selection/);
  assert.match(workspace, /context-toggle/);
  assert.match(workspace, /context-meter/);
  assert.match(workspace, /main-browser-jobs/);
  assert.match(workspace, /dictate-button/);
  assert.match(workspace, /title="Read current browser page"/);
  assert.match(workspace, /title="Summarize current browser context"/);
  assert.doesNotMatch(workspace, /from sidebar/);
  assert.doesNotMatch(workspace, /Open browser context status in sidebar/);
  for (const id of ["save-intake", "save-selection", "context-toggle", "dictate-button", "connection-line"]) {
    const button = workspace.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] ?? "";
    assert.match(button, /<svg /);
    assert.doesNotMatch(button.replace(/aria-label="[^"]*"/g, "").replace(/title="[^"]*"/g, ""), />\s*(Save|Status|Mic|Ready)\s*</i);
  }
  assert.doesNotMatch(workspace, /mode-select/);
  assert.doesNotMatch(workspace, /Open Sidebar/);
  assert.match(workspace, /id="open-sidebar"/);
  assert.match(workspace, /Show Augmentor sidebar/);
  assert.match(workspace, /main-workspace\.js/);
  assert.match(workspaceStyles, /body:not\(\[data-workspace="answer"\]\):not\(\[data-workspace="hermes"\]\) \.answer-thread/);
  assert.match(workspaceStyles, /grid-template-columns: repeat\(auto-fit, minmax\(170px, 1fr\)\)/);
  assert.match(workspaceStyles, /@media \(max-width: 860px\)/);
  assert.match(workspaceStyles, /body \{\s+min-width: 0;/);
  assert.match(workspaceStyles, /word-break: normal/);
  assert.match(workspaceScript, /createChatSessionStore/);
  assert.match(workspaceActionController, /surface:\s*"main-workspace"/);
  assert.doesNotMatch(workspaceScript, /role:\s*"system"[\s\S]{0,220}full ResonantOS main workspace/);
  assert.match(workspaceScript, /createMainWorkspaceRailController/);
  assert.match(workspaceScript, /renderRailNavigation/);
  assert.match(workspaceScript, /starterPromptsHidden/);
  assert.match(workspaceScript, /augmentorStarterPromptsHidden/);
  assert.match(workspaceScript, /starterPrompts\.slice\(0, 6\)/);
  assert.match(workspaceScript, /Hide suggestions/);
  assert.match(workspaceScript, /Show suggestions/);
  assert.match(workspaceScript, /starter-prompt-grid/);
  assert.doesNotMatch(workspaceScript, /data-workspace-command/);
  assert.match(workspaceScript, /railSearchMatchesProject/);
  assert.match(workspaceScript, /railSearchMatchesSession/);
  assert.match(workspaceRail, /railSearchMatchesProject/);
  assert.match(workspaceRail, /railSearchMatchesSession/);
  assert.match(workspaceRailController, /chatSessionStore\.getSessions/);
  assert.match(workspaceRailController, /chatSessionStore\.getProjects/);
  assert.match(workspaceRailController, /chatSessionStore\.switchSession/);
  assert.match(workspaceRailController, /setSessionPinned/);
  assert.match(workspaceRailController, /setSessionArchived/);
  assert.match(workspaceRailController, /renameSession/);
  assert.match(workspaceRailController, /setSessionProject/);
  assert.match(workspaceRailController, /createProject/);
  assert.match(workspaceRailController, /renameProject/);
  assert.match(workspaceRailController, /setProjectArchived/);
  assert.match(workspaceRailController, /setProjectExpanded/);
  assert.match(workspaceRailController, /deleteSessionFromRail/);
  assert.match(workspaceRailController, /forkSession/);
  assert.match(workspaceRailController, /orderedRailItems/);
  assert.match(workspaceRailController, /!session\.projectId/);
  assert.match(workspaceRailController, /rail-project-chat-list/);
  assert.match(workspaceRailController, /rail-unread-dot/);
  assert.match(workspaceRailController, /railProjectActions/);
  assert.match(workspaceRailController, /aria-expanded/);
  assert.match(workspaceRailController, /Collapse.*project/);
  assert.match(workspaceRailController, /Open chat:/);
  assert.match(workspaceRailController, /aria-current", "true"/);
  assert.match(workspaceRailController, /dragstart/);
  assert.match(workspaceRailController, /drop/);
  assert.match(workspaceScript, /createComposerController\(\{\s*commandForm,\s*commandInput,\s*forceClipboardFallback: true,/);
  assert.match(workspaceScript, /hydrateProviderModelOptions/);
  assert.match(workspaceScript, /createDictationController/);
  assert.match(workspaceActionController, /activeChatAbortController/);
  assert.match(workspaceScript, /createBrowserPageActions/);
  assert.match(workspaceScript, /createMainWorkspaceBrowserJobController/);
  assert.match(workspaceScript, /renderMainBrowserJobStatus/);
  assert.match(workspaceScript, /renderMainBrowserJobStatusFromStorage/);
  assert.match(workspaceScript, /mainBrowserJobController\.openMonitor/);
  assert.match(workspaceScript, /mainBrowserJobController\.cancelJob/);
  assert.match(workspaceScript, /chrome\.storage\?\.onChanged/);
  assert.match(workspaceScript, /createMessageActionController/);
  assert.match(messageActionController, /fileLooksTextLike/);
  assert.match(workspaceScript, /removeAttachment/);
  assert.match(workspaceScript, /renderArtifactsWorkspace/);
  assert.match(workspaceScript, /renderAddOnsWorkspace/);
  assert.match(workspaceScript, /continueFromArtifact/);
  assert.doesNotMatch(workspaceScript, /renderChatHistory/);
  assert.doesNotMatch(workspaceScript, /historyActionButton/);
  assert.match(workspaceScript, /setActiveSessionWorkspace/);
  assert.match(workspaceActionController, /\/augmentor\/chat/);
  assert.match(workspaceActionController, /response\?\.reply/);
  assert.match(workspaceActionController, /planMainWorkspacePrompt/);
  assert.match(promptRouter, /parseAutonomousBrowserActionIntent/);
  assert.match(promptRouter, /parseNaturalBrowserIntent/);
  assert.match(promptRouter, /parseNaturalDelegationIntent/);
  assert.match(workspaceActionController, /augmentorPendingSidebarPrompt/);
  assert.match(workspaceActionController, /browser_control_handoff/);
  assert.match(workspaceActionController, /targetUrl/);
  assert.match(workspaceScript, /open_side_panel/);
  assert.match(workspaceScript, /type: "open_side_panel",\s*force: true/);
  assert.match(workspaceScript, /openSidebarButton\?\.addEventListener\("click", \(\) => void openSidebar\(\)\)/);
  assert.doesNotMatch(workspaceScript, /suppressSidebarChatForMainWorkspace/);
  assert.doesNotMatch(workspaceScript, /suppress_side_panel_on_main_workspace/);
  assert.match(workspaceActionController, /chromeApi\.tabs\.update/);
  assert.match(workspaceScript, /composerController\.bind\(\)/);
  assert.match(workspaceScript, /connectionLine\.innerHTML/);
  assert.match(workspaceScript, /readPageButton\?\.addEventListener\("click", \(\) => void browserPageActions\.readActivePage\(\)\)/);
  assert.match(workspaceScript, /runReviewableCapture/);
  assert.match(workspaceActionController, /async function runIntakeCommand\(command\)/);
  assert.match(workspaceActionController, /promptPlan\.action === "intake"/);
  assert.match(workspaceActionController, /browserPageActions\.summarizeCurrentPageToArchive\(\)/);
  assert.match(workspaceActionController, /browserPageActions\.saveResearchTrailToArchive\(command\.body\)/);
  assert.match(workspaceScript, /saveIntakeButton\?\.addEventListener\("click", \(\) => void runReviewableCapture\(\s*\(\) => browserPageActions\.saveCurrentPageToArchive\(\),/);
  assert.match(workspaceScript, /saveSelectionButton\?\.addEventListener\("click", \(\) => void runReviewableCapture\(\s*\(\) => browserPageActions\.saveSelectionToArchive\(\),/);
  assert.match(workspaceScript, /noticeContainer: composerNotice/);
  assert.match(workspaceScript, /onOpenReviewQueue: openMemoryReviewQueue/);
  assert.match(workspaceScript, /function openMemoryReviewQueue\(handoff = \{\}\)/);
  assert.match(workspaceScript, /reviewRequestPath: handoff\.reviewRequestPath \|\| handoff\.path \|\| ""/);
  assert.match(workspaceScript, /promotedPage: handoff\.promotedPage \|\| handoff\.pagePath \|\| ""/);
  assert.match(workspaceScript, /initialReviewPath/);
  assert.match(workspaceScript, /initialArtifactPath/);
  assert.match(workspaceScript, /initialPromotedPage/);
  assert.match(memoryWorkspace, /promotionMatchesHandoff/);
  assert.match(memoryWorkspace, /await previewPromotedPage\(focusedPromotion,\s*\{\s*handoff:\s*true\s*\}\)/);
  assert.match(workspaceScript, /contextToggleButton\?\.addEventListener\("click", \(\) => void browserPageActions\.summarizeSnapshot\(\)\)/);
  assert.match(workspace, /context-popover/);
  assert.match(workspaceScript, /contextMeter\?\.addEventListener\("click", toggleContextPopover\)/);
  assert.match(workspaceScript, /renderContextMemoryPopover/);
  assert.doesNotMatch(workspaceScript, /await addMessage\(\s*"system",\s*\[\s*"Context usage"/);
  assert.match(workspaceScript, /renderHermesWorkspace/);
  assert.match(workspaceScript, /renderOpenCodeWorkspace/);
  assert.match(workspaceScript, /renderSettingsWorkspace/);
  assert.match(workspaceSettings, /renderPrivacySection/);
  assert.match(workspaceSettings, /renderAboutSection/);
  assert.match(workspaceSettings, /label: "Privacy"/);
  assert.match(workspaceSettings, /label: "About"/);
  assert.match(aboutSettings, /ResonantOS Browser Layer/);
  assert.match(aboutSettings, /Customize Chromium/);
  assert.match(aboutSettings, /chrome:\/\/settings\/appearance/);
  assert.match(aboutSettings, /chrome:\/\/extensions\/\?id=/);
  assert.match(browserControlSettings, /Native browser tools/);
  assert.match(browserControlSettings, /Recent downloads/);
  assert.match(browserControlSettings, /\/browser\/downloads/);
  assert.match(browserControlSettings, /\/browser\/downloads\/action/);
  assert.match(browserControlSettings, /browser-download-action/);
  assert.match(browserControlSettings, /Clear Download History/);
  assert.match(browserControlSettings, /label: "Open"/);
  assert.match(browserControlSettings, /label: "Reveal"/);
  assert.match(browserControlSettings, /chrome:\/\/downloads/);
  assert.match(browserControlSettings, /chrome:\/\/history/);
  assert.match(browserControlSettings, /chrome:\/\/bookmarks/);
  assert.match(browserControlSettings, /chrome:\/\/password-manager\/passwords/);
  assert.match(browserControlSettings, /chrome:\/\/settings"/);
  assert.match(browserControlSettings, /chrome:\/\/settings\/content/);
  assert.match(diagnosticsSettings, /diagnostics-report-export/);
  assert.match(workspaceScript, /document\.body\.dataset\.workspace/);
  assert.match(workspaceScript, /\/addons\/status/);
  assert.match(hermesWorkspace, /\/hermes\/dashboard\/status/);
  assert.match(hermesWorkspace, /\/hermes\/dashboard\/start/);
  assert.match(hermesWorkspace, /\/hermes\/dashboard\/stop/);
  // The dashboard is now embedded in-frame (no more "open in new tab"
  // link). The workspace delegates to the generic addon-iframe component
  // which fetches the addon's HTML through the bridge proxy and inlines
  // it as a sandboxed <iframe srcdoc>. Works for ANY addon (Hermes,
  // OpenCode, OpenClaw, ...) without per-machine TLS or certs.
  assert.match(hermesWorkspace, /createAddonIframe/);
  assert.match(hermesWorkspace, /\/hermes-dashboard\//);
  assert.match(workspaceActionController, /startDelegationLifecycle/);
  assert.match(delegationLifecycle, /\/\$\{result\.target\}\/delegation\/start/);
  assert.match(workspaceActionController, /\/addons\/delegate/);
  assert.match(commandRouter, /name === "email"/);
  assert.match(commandRouter, /name === "calendar"/);
  assert.match(appCommandHandlers, /parseDraftAddonCommand/);
  assert.match(appCommandHandlers, /\/addons\/draft/);
  assert.match(appCommandHandlers, /Sending email/);
  assert.match(appCommandHandlers, /Scheduling calendar events/);
  assert.match(workspaceActionController, /target: "hermes"/);
  assert.match(promptRouter, /parseHermesSlashCommand/);
  assert.match(promptRouter, /parseMemorySlashCommand/);
  assert.match(promptRouter, /parseOpenCodeSlashCommand/);
  assert.match(workspaceActionController, /parseDraftAddonCommand/);
  assert.match(promptRouter, /parseDraftSlashCommand/);
  assert.match(promptRouter, /parseWalletSlashCommand/);
  assert.match(promptRouter, /parseDaoSlashCommand/);
  assert.match(workspaceActionController, /runMemoryCommand/);
  assert.match(workspaceActionController, /detectWalletState/);
  assert.match(workspaceActionController, /prepareDaoWorkflowGuidance/);
  assert.match(workspaceActionController, /runOpenCodeCommand/);
  assert.match(workspaceActionController, /runDraftAddonCommand/);
  assert.match(workspaceActionController, /\/addons\/draft/);
  assert.match(workspaceScript, /onOpenProviderHandoff/);
  assert.match(workspaceScript, /chrome\.tabs\.create/);
  assert.match(workspaceScript, /pendingWorkspaceAction/);
  assert.match(workspaceScript, /AI browser workspace/);
  assert.match(workspaceScript, /Read this page/);
  assert.match(workspaceScript, /Search AI memory/);
  assert.match(workspaceScript, /Send to Hermes/);
  assert.match(workspaceScript, /commandInput\.value = button\.dataset\.prompt/);
  assert.match(hermesWorkspace, /renderHermesDashboardWorkspace/);
  // As of v0.1.12 the Hermes dashboard is embedded in-frame via the generic
  // addon-iframe component (createAddonIframe) — no more "open in new tab"
  // link. The bridge proxies /hermes-dashboard/* through
  // RESONANTOS_BRIDGE_OPEN_PROXY_PREFIXES, and the iframe loads the SPA
  // in src mode (not srcdoc) so its own CSP applies and avoids the
  // extension's MV3 restrictions on inline-script and blob: URIs.
  assert.match(hermesWorkspace, /createAddonIframe/);
  assert.match(hermesWorkspace, /proxyPath:\s*"\/hermes-dashboard\/"/);
  assert.match(hermesWorkspace, /\/hermes\/status/);
  assert.match(hermesWorkspace, /CLI detected/);
  assert.match(workspaceScript, /augmentorMainWorkspace/);
  assert.match(workspaceScript, /hydrateActiveWorkspace/);
  assert.match(workspaceScript, /createSidePanelRenderers/);
  assert.match(workspaceScript, /chatRenderers\.renderMessages/);
  assert.match(workspaceScript, /chatRenderers\.renderAttachments/);
  assert.match(workspaceScript, /renderEmptyState/);
  assert.doesNotMatch(workspaceScript, /messageActionButton/);
  assert.match(workspaceScript, /copyMessage/);
  assert.match(workspaceScript, /forkFromMessage/);
  assert.match(workspaceScript, /deleteMessage/);
  assert.match(workspaceScript, /editMessage/);
  assert.match(workspaceScript, /saveMessageToArchive/);
  assert.match(workspaceScript, /regenerateFromMessage/);
  assert.match(workspaceActionController, /setActiveWorkspace\("hermes"/);
  assert.match(workspaceStyles, /message-actions/);
  assert.match(workspaceStyles, /message-action/);
  assert.match(workspaceStyles, /conic-gradient\(var\(--accent\) var\(--context-used/);
  assert.match(workspaceStyles, /workspace-shell/);
  assert.match(workspaceStyles, /starter-prompt-grid/);
  assert.match(workspaceStyles, /min-height: 72px/);
  assert.match(workspaceStyles, /starter-prompt-controls/);
  assert.match(workspaceStyles, /hero-kicker/);
  assert.match(workspaceStyles, /answer-workspace/);
  assert.match(workspaceStyles, /artifacts-workspace/);
  assert.match(workspaceStyles, /addons-workspace/);
  assert.match(workspaceStyles, /addon-card/);
  assert.match(workspaceStyles, /addon-draft-review/);
  assert.match(workspaceStyles, /addon-draft-card/);
  assert.match(workspaceStyles, /artifact-preview/);
  assert.match(workspaceStyles, /artifact-actions/);
  assert.match(workspaceStyles, /artifact-insights/);
  assert.match(workspaceStyles, /artifact-row-guidance/);
  assert.match(archiveReviewHostService, /artifactInsights/);
  assert.match(workspaceStyles, /module-workspace/);
  assert.match(workspaceStyles, /dashboard-frame-card/);
  assert.match(workspaceStyles, /settings-workspace/);
  assert.match(workspaceStyles, /settings-provider-card/);
  assert.match(workspaceStyles, /memory-review-queue/);
  assert.match(workspaceStyles, /memory-review-actions/);
  assert.match(workspaceStyles, /memory-review-draft/);
  assert.match(workspaceStyles, /memory-review-preview/);
  assert.match(workspaceStyles, /memory-promotion-history/);
  assert.match(workspaceStyles, /memory-promotion-card/);
  assert.match(launcher, /defaultMainWorkspaceUrl/);
  assert.match(launcher, /browser-profile-service\.mjs/);
  assert.match(launcher, /seedResonantStartupExperience/);
  assert.match(profileService, /restore_on_startup\s*=\s*4/);
  assert.match(profileService, /startup_urls\s*=\s*\[mainWorkspaceUrl\]/);
  assert.match(profileService, /exit_type\s*=\s*"Normal"/);
  assert.match(profileService, /chrome_url_overrides/);
  assert.match(launcher, /--resonantos-log-path=\$\{browserLaunchLogPath\(\)\}/);
  assert.match(launcher, /addon-delegation-host-service\.mjs/);
  assert.match(launcher, /addonDelegationRoutes/);
  assert.match(addonDelegationHostService, /\/hermes\/dashboard\/status/);
  assert.match(addonDelegationHostService, /\/hermes\/dashboard\/start/);
  assert.match(addonDelegationHostService, /\/hermes\/dashboard\/stop/);
  assert.match(addonDelegationHostService, /\/hermes\/status/);
  assert.match(addonDelegationHostService, /\/hermes\/delegation\/start/);
  assert.match(addonDelegationHostService, /\/hermes\/delegation\/status/);
  assert.match(addonDelegationHostService, /\/hermes\/delegation\/artifact/);
  assert.match(addonDelegationHostService, /\/hermes\/delegation\/cancel/);
  assert.match(launcher, /createAddonDelegationService/);
  assert.match(addonDelegationService, /expectedArtifacts/);
  assert.match(addonDelegationService, /forbiddenActions/);
  assert.match(addonDelegationService, /localCliExecution:\s*false/);
  assert.match(addonDelegationService, /addonLocalCliExecutionEnabled/);
  assert.match(addonDelegationService, /executeHermesDelegationStart/);
  assert.match(addonDelegationService, /executeOpenCodeDelegationStart/);
  assert.match(addonDelegationService, /executeAddonDraftList/);
  assert.match(addonDelegationService, /executeAddonDraftTransition/);
  assert.match(addonDelegationHostService, /\/addons\/draft\/list/);
  assert.match(addonDelegationHostService, /\/addons\/draft\/transition/);
  assert.match(addonDelegationHostService, /\/addons\/draft\/handoff/);
  assert.match(addonDelegationService, /executeAddonDraftProviderHandoff/);
  assert.match(addonDelegationService, /buildProviderDraftHandoff/);
  assert.match(addonDelegationHostService, /\/opencode\/status/);
  assert.match(addonDelegationHostService, /\/opencode\/delegation\/start/);
  assert.match(addonDelegationHostService, /\/opencode\/delegation\/status/);
  assert.match(addonDelegationHostService, /\/opencode\/delegation\/artifact/);
  assert.match(addonDelegationHostService, /\/opencode\/delegation\/cancel/);
  assert.match(addonDelegationHostService, /addon-execution-settings-write/);
  assert.match(providerHostService, /\/providers\/status/);
  assert.match(providerHostService, /\/providers\/credentials/);
  assert.match(providerHostService, /\/providers\/accounts/);
  assert.match(providerHostService, /\/providers\/routing-strategies/);
  assert.match(providerHostService, /provider-routing-write/);
  assert.match(providerHostService, /provider-credential-write/);
  assert.match(providerHostService, /createProviderBridgeService/);
  assert.match(providerBridgeService, /defaultRoutingStrategies/);
  assert.match(browserDiagnosticsHostService, /\/diagnostics\/report/);
  assert.match(browserDiagnosticsHostService, /diagnostics-report-export/);
  assert.match(browserDiagnosticsHostService, /createBrowserDiagnosticsService/);
  assert.match(browserDiagnosticsService, /executeDiagnosticsReport/);
  assert.match(browserDiagnosticsHostService, /\/workspace\/inspect/);
  assert.match(browserDiagnosticsService, /executeWorkspaceInspection/);
  assert.match(browserDiagnosticsService, /browser-launch-diagnostics\.mjs/);
  assert.match(browserDiagnosticsHostService, /\/browser\/launch-diagnostics/);
  assert.match(browserDiagnosticsService, /executeBrowserLaunchDiagnostics/);
  assert.match(browserDiagnosticsHostService, /browserLaunchLogPath/);
  assert.match(browserDiagnosticsHostService, /\/browser\/downloads/);
  assert.match(browserDiagnosticsHostService, /\/browser\/downloads\/action/);
  assert.match(browserDiagnosticsService, /executeBrowserDownloads/);
  assert.match(browserDiagnosticsService, /executeBrowserDownloadAction/);
  assert.match(browserDiagnosticsService, /browserDownloadsRoot/);
  assert.match(browserDiagnosticsHostService, /browser-download-action/);
  assert.match(browserDiagnosticsService, /clear-history/);
  assert.match(browserDiagnosticsService, /dryRun/);
  assert.match(browserDiagnosticsService, /openOrRevealDownload/);
  assert.match(memoryHostService, /\/archive\/intake\/list/);
  assert.match(memoryHostService, /\/memory\/settings/);
  assert.match(memoryHostService, /memory-settings-write/);
  assert.match(memoryHostService, /\/memory\/source\/browse/);
  assert.match(memoryHostService, /memory-source-browse/);
  assert.match(memoryHostService, /\/memory\/source\/scan/);
  assert.match(memoryHostService, /memory-source-scan/);
  assert.match(memoryHostService, /\/memory\/source\/action/);
  assert.match(memoryHostService, /memory-source-manage/);
  assert.match(memoryHostService, /\/memory\/source\/move-preflight/);
  assert.match(memoryHostService, /\/memory\/source\/move-execute/);
  assert.match(memoryHostService, /\/memory\/source\/move-rollback/);
  assert.match(memoryHostService, /memory-source-move/);
  assert.match(launcher, /createMemorySourceSettingsService/);
  assert.match(launcher, /browser-first-host-utils\.mjs/);
  assert.doesNotMatch(launcher, /function safeFileSlug/);
  assert.doesNotMatch(launcher, /function expandUserPath/);
  assert.match(hostUtils, /export function safeFileSlug/);
  assert.match(hostUtils, /export function expandUserPath/);
  assert.match(memorySourceSettingsService, /result\.status !== "moved"/);
  assert.match(memorySourceSettingsService, /automatic rollback restored/);
  assert.match(memorySourceSettingsService, /rollbackRestoredDirectoryCount/);
  assert.match(memorySourceSettingsService, /rollbackSourceRootRestored/);
  assert.match(memorySourceSettingsService, /rollbackSkippedRootCleanupCount/);
  assert.match(memorySourceSettingsService, /Memory\/CONFIG\/move-imports/);
  assert.match(selfTestService, /outsideLedgerStatus/);
  assert.match(memoryHostService, /\/memory\/source\/review/);
  assert.match(memoryHostService, /memory-source-review/);
  assert.match(memoryHostService, /\/memory\/source\/intake/);
  assert.match(memoryHostService, /memory-source-intake/);
  assert.match(memoryHostService, /\/memory\/source\/file-intake/);
  assert.match(memoryHostService, /\/memory\/wiki\/health/);
  assert.match(memoryHostService, /\/memory\/wiki\/page\/read/);
  assert.match(launcher, /executeMemoryWikiPageRead/);
  assert.match(launcher, /createMemorySourceIntakeHostService/);
  assert.doesNotMatch(launcher, /async function executeMemoryWikiHealth/);
  assert.match(memorySourceIntakeHostService, /computeWikiHealth/);
  assert.match(memoryHostService, /\/memory\/wiki\/lint/);
  assert.match(memorySourceIntakeHostService, /runWikiLint/);
  assert.match(memorySourceIntakeHostService, /sourceContentHash/);
  assert.match(memorySourceIntakeHostService, /sourceVersion/);
  assert.match(memoryHostService, /\/memory\/source\/versions/);
  assert.match(memoryHostService, /\/memory\/source\/diff/);
  assert.match(memoryHostService, /memory-source-file-intake/);
  assert.match(memorySourceSettingsService, /RESONANTOS_BROWSER_FIRST_PICK_FOLDER_RESULT/);
  assert.match(memoryHostService, /\/archive\/intake\/read/);
  assert.match(memoryHostService, /\/archive\/review\/request/);
  assert.match(memoryHostService, /\/archive\/review\/list/);
  assert.match(memoryHostService, /\/archive\/review\/transition/);
  assert.match(memoryHostService, /\/archive\/review\/draft/);
  assert.match(memoryHostService, /\/archive\/review\/artifact\/read/);
  assert.match(memoryHostService, /\/archive\/review\/artifact\/verify/);
  assert.match(memoryHostService, /\/archive\/review\/verification\/read/);
  assert.match(memoryHostService, /\/archive\/review\/artifact\/revise/);
  assert.match(archiveReviewService, /draftVerificationStatus/);
  assert.match(archiveReviewService, /promotionStatus/);
  assert.match(providerBridgeService, /providerRouteForArchiveVerifier/);
  assert.match(providerBridgeService, /runArchiveSemanticVerifier/);
  assert.match(archiveReviewService, /semanticStatus/);
  assert.match(memoryHostService, /\/archive\/review\/artifact\/promote/);
  assert.match(memoryHostService, /\/archive\/review\/promotions\/list/);
  assert.match(memoryHostService, /\/archive\/review\/promotions\/restore/);
  assert.match(archiveReviewService, /assertPromotionVerifierMatchesDraft/);
  assert.match(archiveReviewService, /frontmatterValue\(verifierContent, "artifactPath"\)/);
  assert.match(archiveReviewService, /assertArchiveReviewTransitionAllowed/);
  assert.match(archiveReviewService, /humanReviewRequired/);
  assert.match(archiveMerge, /mergePromotedMarkdownBody/);
  assert.match(archiveMerge, /Superseded Sections/);
  assert.match(providerHostService, /executeProviderCredentialSave/);
  assert.match(addonDelegationService, /executeOpenCodeStatus/);
  assert.match(addonDelegationService, /workspaceLaunch: "not-enabled-in-browser-first-v1"/);
  assert.match(hostUtils, /Hermes dashboard can only bind to localhost/);
  assert.match(launcher, /main-workspace\.html/);
  assert.match(background, /open_side_panel/);
  assert.match(background, /browser_control_handoff/);
  assert.match(background, /handoffToResonantSidePanel/);
  assert.doesNotMatch(background, /openContentDockForTab/);
  assert.doesNotMatch(background, /content_dock/);
  assert.doesNotMatch(background, /browser-content-dock/);
  assert.doesNotMatch(contentScript, /open_resonantos_dock/);
  assert.doesNotMatch(contentScript, /resonantos-content-dock/);
  assert.doesNotMatch(contentScript, /content_dock/);
  assert.doesNotMatch(contentScript, /bridge-config\.generated/);
  assert.match(JSON.stringify(manifest), /web_accessible_resources/);
  assert.match(JSON.stringify(manifest), /ort-wasm/);
  assert.doesNotMatch(JSON.stringify(manifest), /content-dock/);
  assert.doesNotMatch(background, /suppress_side_panel_on_main_workspace/);
  assert.match(background, /openResonantSidePanel\(windowId, \{ force: Boolean\(message\.force\) \}\)/);
  assert.match(background, /setSidePanelEnabledForTab\(tab\.id, true\)/);
  assert.match(sidePanel, /consumePendingSidebarPrompt/);
  assert.match(sidePanel, /createSidePanelLifecycleController/);
  assert.doesNotMatch(background, /onInstalled[\s\S]*setTimeout/);
});

test("browser layer has a human approval boundary for wallet and credential actions", async () => {
  const background = await readText(path.join(extensionRoot, "src", "background.js"));
  const panel = await readText(path.join(extensionRoot, "src", "side-panel.html"));
  const sidePanelBrowserActionController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-browser-action-controller.js"));

  assert.match(background, /wallet_connect/);
  assert.match(background, /wallet_sign/);
  assert.match(background, /credential_autofill/);
  assert.match(background, /deniedToAutomation/);
  assert.match(panel, /Message Augmentor/);
  assert.match(sidePanelBrowserActionController, /Wallet actions are human-approval gated/);
});

test("browser layer exposes Augmentor chat as the side-panel surface without stealing the browser tab", async () => {
  const panel = await readText(path.join(extensionRoot, "src", "side-panel.html"));
  const script = await readText(path.join(extensionRoot, "src", "side-panel.js"));
  const appCommandHandlers = await readText(path.join(extensionRoot, "src", "lib", "app-command-handlers.js"));
  const bridgeClient = await readText(path.join(extensionRoot, "src", "lib", "bridge-client.js"));
  const commandParser = await readText(path.join(extensionRoot, "src", "lib", "browser-command-parser.js"));
  const browserJobStore = await readText(path.join(extensionRoot, "src", "lib", "browser-job-store.js"));
  const chatTurnController = await readText(path.join(extensionRoot, "src", "lib", "chat-turn-controller.js"));
  const composerController = await readText(path.join(extensionRoot, "src", "lib", "composer-controller.js"));
  const controlPageObserver = await readText(path.join(extensionRoot, "src", "lib", "control-page-observer.js"));
  const controlPlanningService = await readText(path.join(extensionRoot, "src", "lib", "control-planning-service.js"));
  const controlPreflight = await readText(path.join(extensionRoot, "src", "lib", "control-preflight.js"));
  const controlReportingService = await readText(path.join(extensionRoot, "src", "lib", "control-reporting-service.js"));
  const controlRunState = await readText(path.join(extensionRoot, "src", "lib", "control-run-state.js"));
  const controlStepExecutor = await readText(path.join(extensionRoot, "src", "lib", "control-step-executor.js"));
  const approvalPolicy = await readText(path.join(extensionRoot, "src", "lib", "approval-policy.js"));
  const agentControlPlanner = await readText(path.join(extensionRoot, "src", "lib", "agent-control-planner.js"));
  const agentControlRunner = await readText(path.join(extensionRoot, "src", "lib", "agent-control-runner.js"));
  const pageActions = await readText(path.join(extensionRoot, "src", "lib", "browser-page-actions.js"));
  const chatSessionStore = await readText(path.join(extensionRoot, "src", "lib", "chat-session-store.js"));
  const messageActionController = await readText(path.join(extensionRoot, "src", "lib", "message-action-controller.js"));
  const sidePanelDom = await readText(path.join(extensionRoot, "src", "lib", "side-panel-dom.js"));
  const sidePanelRenderers = await readText(path.join(extensionRoot, "src", "lib", "side-panel-renderers.js"));
  const sidePanelUiController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-ui-controller.js"));
  const sidePanelBrowserActionController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-browser-action-controller.js"));
  const sidePanelBrowserJobController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-browser-job-controller.js"));
  const sidePanelControlCommandController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-control-command-controller.js"));
  const sidePanelControlPreflightController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-control-preflight-controller.js"));
  const sidePanelLifecycleController = await readText(path.join(extensionRoot, "src", "lib", "side-panel-lifecycle-controller.js"));
  const sidePanelScheduledBrowserJobRunner = await readText(path.join(extensionRoot, "src", "lib", "side-panel-scheduled-browser-job-runner.js"));
  const monitorRenderers = await readText(path.join(extensionRoot, "src", "lib", "monitor-renderers.js"));
  const monitorProgress = await readText(path.join(extensionRoot, "src", "lib", "monitor-progress.js"));
  const monitorSurface = `${monitorRenderers}\n${monitorProgress}`;
  const commandRouter = await readText(path.join(extensionRoot, "src", "lib", "side-panel-command-router.js"));
  const walletState = await readText(path.join(extensionRoot, "src", "lib", "wallet-state.js"));
  const sitePermissionStore = await readText(path.join(extensionRoot, "src", "lib", "site-permission-store.js"));
  const taskConsentStore = await readText(path.join(extensionRoot, "src", "lib", "task-consent-store.js"));
  const tabContextController = await readText(path.join(extensionRoot, "src", "lib", "tab-context-controller.js"));
  const background = await readText(path.join(extensionRoot, "src", "background.js"));

  assert.match(panel, /Message Augmentor/);
  assert.doesNotMatch(panel, /new-chat/);
  assert.doesNotMatch(panel, /chat-history/);
  assert.match(panel, /bridge-config\.generated\.js/);
  assert.match(panel, /control-monitor/);
  assert.match(panel, /control-current-action/);
  assert.match(panel, /control-stop/);
  assert.match(panel, /context-dock"[^>]+hidden/);
  assert.match(panel, /context-toggle/);
  assert.match(panel, /approval-card/);
  assert.match(panel, /approval-trust-site/);
  assert.match(panel, /site-permission-panel/);
  assert.match(panel, /task-consent-panel/);
  assert.match(panel, /permission-manager-panel/);
  assert.match(panel, /Permission and consent manager/);
  assert.match(panel, /Trust this task class/);
  assert.match(panel, /job-monitor/);
  assert.match(panel, /control-preflight-card/);
  assert.match(panel, /control-preflight-approve/);
  assert.match(panel, /control-preflight-trust/);
  assert.match(panel, /control-preflight-deny/);
  assert.match(panel, /trusted-for-safe-actions/);
  assert.doesNotMatch(panel, /I.m here in the browser side bar/);
  assert.doesNotMatch(panel, /Current page/);
  assert.match(panel, /Connected model/);
  assert.match(panel, /Thinking depth/);
  assert.match(panel, /Save current page to Living Archive intake/);
  assert.match(panel, /Save selected page text to Living Archive intake/);
  assert.match(panel, /context-meter-label/);
  for (const id of ["save-intake", "save-selection", "context-toggle", "dictate-button", "connection-line"]) {
    const button = panel.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] ?? "";
    assert.match(button, /<svg /);
    assert.doesNotMatch(button.replace(/aria-label="[^"]*"/g, "").replace(/title="[^"]*"/g, ""), />\s*(Save|Status|Mic|Ready)\s*</i);
  }
  assert.match(script, /createComposerController\(\{\s*commandForm,\s*commandInput,\s*forceClipboardFallback: true,/);
  assert.match(script, /hydrateProviderModelOptions/);
  assert.match(script, /createDictationController/);
  assert.match(script, /stopChatTurn/);
  assert.match(panel, /context-popover/);
  assert.match(script, /createSidePanelUiController/);
  assert.match(sidePanelLifecycleController, /contextMeter\?\.addEventListener\?\.\("click", toggleContextPopover\)/);
  assert.match(sidePanelUiController, /renderContextMemoryPopover/);
  assert.match(sidePanelUiController, /updateContextDockVisibility/);
  assert.match(sidePanelUiController, /renderControlPreflightCard/);
  assert.doesNotMatch(script, /await addMessage\(\s*"system",\s*\[\s*"Context usage"/);
  assert.match(composerController, /shortcutKey === "z"/);
  assert.match(composerController, /shortcutKey === "a"/);
  assert.match(composerController, /\["x", "c", "v"\]/);
  assert.match(background, /openPanelOnActionClick/);
  assert.match(background, /openResonantSidePanel/);
  assert.match(background, /handoffToResonantSidePanel/);
  assert.match(background, /open-augmentor-side-panel/);
  assert.doesNotMatch(background, /chrome\.tabs\.create/);
  assert.match(background, /syncSidePanelForTab/);
  assert.match(background, /chrome\.tabs\.onActivated/);
  assert.match(background, /chrome\.tabs\.onUpdated/);
  assert.doesNotMatch(background, /isMainWorkspaceUrl\(tab\.url\) && !force/);
  assert.match(background, /openResonantSidePanel\(tab\.windowId, \{ force: true \}\)/);
  assert.doesNotMatch(background, /setSidePanelEnabledForTab\(tab\.id, false\)/);
  assert.match(script, /isReadableBrowserTab/);
  assert.match(pageActions, /currentWindow: true/);
  assert.match(pageActions, /summarizeSnapshot/);
  assert.match(pageActions, /saveCurrentPageToArchive/);
  assert.match(pageActions, /saveSelectionToArchive/);
  assert.match(pageActions, /\/archive\/review\/request/);
  assert.match(script, /saveIntake/);
  assert.match(script, /createChatSessionStore/);
  assert.doesNotMatch(script, /renderChatHistory/);
  assert.doesNotMatch(script, /chatHistory/);
  assert.doesNotMatch(script, /newChatButton/);
  assert.match(script, /createChatTurnController/);
  assert.match(chatTurnController, /\/augmentor\/chat/);
  assert.match(chatTurnController, /pageContextForSnapshot/);
  assert.match(chatTurnController, /runtimeContextForAttachments/);
  assert.match(chatTurnController, /providerMessagesFromHistory/);
  assert.match(script, /createComposerController\(\{\s*commandForm,\s*commandInput,\s*forceClipboardFallback: true,/);
  assert.match(sidePanelUiController, /connectionLine\.innerHTML/);
  assert.match(sidePanelUiController, /connectionLine\.setAttribute\("aria-label", connectionLine\.title\)/);
  assert.doesNotMatch(panel, /<span>Ready<\/span>/);
  assert.match(composerController, /handleClipboardShortcut/);
  assert.match(composerController, /selectedRange/);
  assert.match(composerController, /replaceSelection/);
  assert.match(composerController, /clipboard\?\.readText/);
  assert.match(composerController, /clipboard\?\.writeText/);
  assert.match(composerController, /resetUndoStack/);
  assert.match(composerController, /requestSubmit/);
  assert.match(script, /createMessageActionController/);
  assert.match(messageActionController, /copyMessage/);
  assert.match(messageActionController, /forkFromMessage/);
  assert.match(messageActionController, /saveMessageToArchive/);
  assert.match(messageActionController, /regenerateFromMessage/);
  assert.match(messageActionController, /attachFiles/);
  assert.match(chatSessionStore, /forkFromMessage/);
  assert.match(chatSessionStore, /createSession/);
  assert.match(chatSessionStore, /switchSession/);
  assert.match(chatSessionStore, /getSessions/);
  assert.match(chatSessionStore, /trimToPreviousUserMessage/);
  assert.match(chatSessionStore, /addAttachments/);
  assert.match(chatSessionStore, /hydrate/);
  assert.match(script, /createSidePanelRenderers/);
  assert.match(script, /createAppCommandHandlers/);
  assert.match(appCommandHandlers, /parseHistorySearchCommand/);
  assert.match(appCommandHandlers, /formatHistorySearchMarkdown/);
  assert.match(appCommandHandlers, /browser-history-search/);
  assert.match(appCommandHandlers, /runGoalCommand/);
  assert.match(appCommandHandlers, /runSitePermissionCommand/);
  assert.match(appCommandHandlers, /runJobsCommand/);
  assert.match(appCommandHandlers, /pauseBrowserJob/);
  assert.match(appCommandHandlers, /runWalletStatusCommand/);
  assert.match(commandRouter, /name === "wallet"/);
  assert.match(commandRouter, /name === "dao"/);
  assert.match(pageActions, /detectWalletState/);
  assert.match(pageActions, /prepareDaoWorkflowGuidance/);
  assert.match(pageActions, /saveWalletDaoAuditToArchive/);
  assert.match(pageActions, /browser-wallet-dao-audit/);
  assert.match(commandRouter, /saveWalletDaoAuditToArchive/);
  assert.match(commandRouter, /\^audit\\b/);
  assert.match(pageActions, /world: "MAIN"/);
  assert.match(walletState, /detectionOnly/);
  assert.match(walletState, /read-only detection/);
  assert.match(script, /createSidePanelCommandRouter/);
  assert.match(commandRouter, /respondToCommand/);
  assert.match(commandRouter, /name === "hermes"/);
  assert.match(commandRouter, /parseControlIntent/);
  assert.match(commandRouter, /handleWalletBoundary/);
  assert.match(sidePanelRenderers, /renderMessages/);
  assert.match(sidePanelRenderers, /What should Augmentor work on/);
  assert.match(sidePanelRenderers, /renderAttachments/);
  assert.match(sidePanelRenderers, /flashCopied/);
  assert.match(script, /createSitePermissionStore/);
  assert.match(sitePermissionStore, /siteKeyForUrl/);
  assert.match(sitePermissionStore, /permissionForUrl/);
  assert.match(sitePermissionStore, /resetSitePermission/);
  assert.match(sitePermissionStore, /setSitePermission/);
  assert.match(sitePermissionStore, /sitePermissionAudit/);
  assert.match(sitePermissionStore, /ask-before-action/);
  assert.match(taskConsentStore, /taskClassForGoal/);
  assert.match(taskConsentStore, /taskConsentKey/);
  assert.match(taskConsentStore, /taskConsentAudit/);
  assert.match(script, /createTaskConsentStore/);
  assert.match(script, /SIDE_PANEL_STORAGE_KEYS/);
  assert.match(sidePanelDom, /augmentorSitePermissionAudit/);
  assert.match(sidePanelDom, /augmentorTaskConsents/);
  assert.match(sidePanelDom, /augmentorTaskConsentAudit/);
  assert.match(monitorRenderers, /renderTaskConsentPanel/);
  assert.match(monitorRenderers, /renderPermissionManager/);
  assert.match(monitorRenderers, /auditLabel/);
  assert.match(monitorRenderers, /onResetSitePermission/);
  assert.match(monitorRenderers, /onRevokeTaskConsent/);
  assert.match(script, /createMonitorRenderers/);
  assert.match(monitorSurface, /sitePermissionDescription/);
  assert.match(monitorSurface, /Can see\/do now/);
  assert.match(monitorRenderers, /renderSitePermissionPanel/);
  assert.match(monitorRenderers, /renderJobMonitor/);
  assert.match(monitorRenderers, /getBrowserJobSchedulerState/);
  assert.match(monitorRenderers, /job-scheduler-state/);
  assert.match(monitorRenderers, /renderControlMonitor/);
  assert.match(monitorSurface, /controlActionStateLabel/);
  assert.match(monitorSurface, /controlRunPhase/);
  assert.match(monitorSurface, /controlRunProgressSummary/);
  assert.match(monitorRenderers, /control-phase-meta/);
  assert.match(monitorRenderers, /control-progress-track/);
  assert.match(monitorRenderers, /jobNextHumanAction/);
  assert.match(monitorRenderers, /job-blocker-guidance/);
  assert.match(monitorRenderers, /job-progress/);
  assert.match(script, /controlStopButton\.addEventListener/);
  assert.match(script, /createTabContextController/);
  assert.match(tabContextController, /resolveTabMention/);
  assert.match(tabContextController, /bindMentionedTab/);
  assert.match(tabContextController, /consumeInlineDraft/);
  assert.match(tabContextController, /bindBrowserListeners/);
  assert.match(tabContextController, /hydrateInitialContext/);
  assert.match(script, /createBridgeClient/);
  assert.match(bridgeClient, /DEFAULT_BRIDGE_URL = "http:\/\/127\.0\.0\.1:47773"/);
  assert.match(bridgeClient, /bridgeUrl = config\.bridgeUrl \?\? DEFAULT_BRIDGE_URL/);
  assert.match(bridgeClient, /__RESONANTOS_BRIDGE_CONFIG__/);
  assert.match(bridgeClient, /X-ResonantOS-Bridge-Token/);
  assert.match(background, /bridge-config\.generated\.js/);
  assert.match(background, /createBridgeClient/);
  assert.match(background, /inline_assistant_request/);
  assert.match(background, /\/augmentor\/inline/);
  assert.match(script, /browserJobStore\.getMonitorCollapsed/);
  assert.match(script, /browserJobStore\.getSchedulerState/);
  assert.match(script, /activateBrowserJobPage/);
  assert.match(sidePanelBrowserJobController, /await activateJobTab\(focusedJob\)/);
  assert.match(script, /createBrowserJobScheduler/);
  assert.match(script, /tickBrowserJobScheduler/);
  assert.match(script, /Starting queued browser job/);
  assert.match(chatTurnController, /\/augmentor\/chat/);
  assert.match(controlReportingService, /\/archive\/intake/);
  assert.match(appCommandHandlers, /\/memory\/search/);
  assert.match(appCommandHandlers, /\/addons\/delegate/);
  assert.match(appCommandHandlers, /\/goals/);
  assert.match(commandParser, /parseNaturalBrowserIntent/);
  assert.match(script, /createBrowserJobStore/);
  assert.match(script, /prepareBrowserJobPageLock/);
  assert.match(sidePanelControlCommandController, /conflictingActiveJobForLock/);
  assert.match(sidePanelControlCommandController, /TERMINAL_CONTROL_RUN_STATUSES/);
  assert.match(sidePanelControlCommandController, /conflict && currentControlRun && conflict\.id === currentControlRun\.id/);
  assert.match(sidePanelControlCommandController, /conflict\?\.status === "approval"/);
  assert.match(sidePanelControlCommandController, /setPendingApproval\(null\)/);
  assert.match(browserJobStore, /normalizeBrowserJob/);
  assert.match(browserJobStore, /normalizePageLock/);
  assert.match(browserJobStore, /browserJobSchedulerState/);
  assert.match(browserJobStore, /createBrowserJobStore/);
  assert.match(browserJobStore, /LOCK_HOLDING_JOB_STATUSES/);
  assert.match(browserJobStore, /conflictingActiveJobForLock/);
  assert.match(browserJobStore, /Browser target is already controlled/);
  assert.match(browserJobStore, /toggleMonitorCollapsed/);
  assert.match(browserJobStore, /findJob/);
  assert.match(browserJobStore, /getSchedulerState/);
  assert.match(browserJobStore, /steps/);
  assert.match(commandParser, /parseNaturalSearchIntent/);
  assert.match(commandParser, /parseTypeIntent/);
  assert.match(commandParser, /parseClickIntent/);
  assert.match(commandParser, /parseReadPageIntent/);
  assert.match(commandParser, /parseStructuredPageEditIntent/);
  assert.match(commandParser, /parseScrollIntent/);
  assert.match(commandParser, /parseFormsIntent/);
  assert.match(commandParser, /parseControlIntent/);
  assert.match(commandParser, /parseAutonomousBrowserActionIntent/);
  assert.match(commandParser, /parseAmazonShoppingTask/);
  assert.match(appCommandHandlers, /runHistorySearchCommand/);
  assert.match(appCommandHandlers, /Incognito activity is excluded/);
  assert.match(appCommandHandlers, /chrome\.tabs\.query/);
  assert.match(appCommandHandlers, /runSitePermissionCommand/);
  assert.match(appCommandHandlers, /runCapabilitiesCommand/);
  assert.match(script, /approvalBoundaryForStep/);
  assert.match(script, /controlStepLabel/);
  assert.match(agentControlPlanner, /planControlSteps/);
  assert.match(agentControlPlanner, /deterministicNextAction/);
  assert.match(agentControlPlanner, /dedupeControlSteps/);
  assert.match(agentControlPlanner, /controlStepLabel/);
  assert.match(script, /trustCurrentTaskForSafeActions/);
  assert.match(appCommandHandlers, /runJobsCommand/);
  assert.match(appCommandHandlers, /pauseBrowserJob/);
  assert.match(appCommandHandlers, /resumeBrowserJob/);
  assert.match(appCommandHandlers, /continueBrowserJob/);
  assert.match(appCommandHandlers, /Scheduler:/);
  assert.match(appCommandHandlers, /reportBrowserJob/);
  assert.match(appCommandHandlers, /cancelBrowserJob/);
  assert.match(commandRouter, /reportBrowserJob/);
  assert.match(commandRouter, /continueBrowserJob/);
  assert.match(sidePanelDom, /augmentorBrowserJobs/);
  assert.match(sidePanelDom, /augmentorActiveBrowserJob/);
  assert.match(sidePanelBrowserJobController, /recoverInterruptedJobs/);
  assert.match(script, /renderSitePermissionPanel/);
  assert.match(sidePanelLifecycleController, /sitePermissionMode\?\.addEventListener/);
  assert.match(tabContextController, /resolveTabMention/);
  assert.match(tabContextController, /augmentorInlineDraft/);
  assert.match(pageActions, /searchBrowser/);
  assert.match(pageActions, /typeIntoActivePage/);
  assert.match(pageActions, /clickActivePageText/);
  assert.match(pageActions, /scrollActivePage/);
  assert.match(pageActions, /detectActivePageForms/);
  assert.match(script, /controlledTabId/);
  assert.match(controlStepExecutor, /switch_tab/);
  assert.match(agentControlPlanner, /List open tabs/);
  assert.match(agentControlPlanner, /planControlSteps/);
  assert.match(script, /createControlPlanningService/);
  assert.match(script, /createSidePanelControlPreflightController/);
  assert.match(sidePanelControlPreflightController, /createControlPreflight/);
  assert.match(sidePanelControlPreflightController, /formatControlPreflightMessage/);
  assert.match(sidePanelDom, /augmentorControlPreflight/);
  assert.match(script, /renderControlPreflightCard/);
  assert.match(script, /approveControlPreflight/);
  assert.match(script, /trustControlPreflightForSafeActions/);
  assert.match(script, /setNextControlPreflightDecision/);
  assert.match(script, /consumeNextControlPreflightDecision/);
  assert.match(sidePanelControlPreflightController, /preflightDecisionFromPreflight/);
  assert.match(sidePanelControlPreflightController, /source: "control-preflight"/);
  assert.match(script, /denyControlPreflight/);
  assert.match(commandRouter, /approve-control/);
  assert.match(commandRouter, /deny-control/);
  assert.match(controlPreflight, /taskClassForGoal/);
  assert.match(controlPreflight, /Still human-only: wallet, login, credential, payment/);
  assert.match(controlPreflight, /shouldRequireControlPreflight/);
  assert.match(controlPlanningService, /requestControlPlan/);
  assert.match(controlPlanningService, /requestNextControlAction/);
  assert.match(agentControlRunner, /continueControlLoop/);
  assert.match(agentControlRunner, /browserJobStepHistory/);
  assert.match(agentControlRunner, /resumedFromJob/);
  assert.match(agentControlRunner, /existingJob: resumedFromJob/);
  assert.match(sidePanelBrowserJobController, /activateJob\(existingJob\.id\)/);
  assert.match(agentControlRunner, /observe-act-verify-loop/);
  assert.match(script, /createControlPageObserver/);
  assert.match(controlPageObserver, /observeControlPage/);
  assert.match(controlPageObserver, /listReadableTabSnapshots/);
  assert.match(controlPageObserver, /Browser job is paused/);
  assert.match(controlPageObserver, /Browser job was cancelled/);
  assert.match(approvalPolicy, /sanitizePlannerStep/);
  assert.match(approvalPolicy, /sanitizeNextActionDecision/);
  assert.match(approvalPolicy, /sanitizePlannerPlan/);
  assert.match(approvalPolicy, /approvalBoundaryForStep/);
  assert.match(controlPlanningService, /planAgentControlSteps/);
  assert.match(controlPlanningService, /__resonantosControlPlannerOverride/);
  assert.match(controlPlanningService, /__resonantosNextActionOverride/);
  assert.match(script, /createControlStepExecutor/);
  assert.match(controlStepExecutor, /executeControlStep/);
  assert.match(controlStepExecutor, /listReadableTabs/);
  assert.match(controlStepExecutor, /Unknown control step/);
  assert.match(agentControlRunner, /runControlCommand/);
  assert.match(script, /createBrowserJobScheduler/);
  assert.match(script, /runScheduledBrowserJob/);
  assert.match(script, /withBrowserActionLock/);
  assert.match(sidePanelScheduledBrowserJobRunner, /localLastSnapshot/);
  assert.match(sidePanelScheduledBrowserJobRunner, /onSnapshot/);
  assert.match(sidePanelScheduledBrowserJobRunner, /setLastSnapshot\(null\)/);
  assert.match(sidePanelControlCommandController, /status: "queued"/);
  assert.match(sidePanelControlCommandController, /getBrowserJobScheduler\(\)\?\.tick/);
  assert.match(script, /renderControlMonitor/);
  assert.match(agentControlRunner, /approvePendingControlStep/);
  assert.match(agentControlRunner, /denyPendingControlStep/);
  assert.match(script, /createControlReportingService/);
  assert.match(controlReportingService, /buildControlReport/);
  assert.match(controlReportingService, /saveControlReportToArchive/);
  assert.match(controlReportingService, /saveBrowserJobReportToArchive/);
  assert.match(controlReportingService, /Preflight Decision/);
  assert.match(monitorRenderers, /job-preflight/);
  assert.match(monitorRenderers, /job-focused/);
  assert.match(monitorRenderers, /getActiveBrowserJobId/);
  assert.match(monitorRenderers, /onActivateBrowserJob/);
  assert.match(monitorRenderers, /onSaveBrowserJobReport/);
  assert.match(controlReportingService, /delegateControlIssue/);
  assert.match(controlReportingService, /Browser Agent Control Report/);
  assert.match(script, /createControlRunState/);
  assert.match(controlRunState, /startControlRun/);
  assert.match(controlRunState, /appendControlStep/);
  assert.match(controlRunState, /updateControlStep/);
  assert.match(controlRunState, /finishControlRun/);
  assert.match(controlRunState, /setPageControlOverlay/);
  assert.match(agentControlRunner, /Agent Control Mode started/);
  assert.match(script, /explainStructuredPageEditBoundary/);
  assert.match(pageActions, /bing\.com\/news\/search/);
  assert.match(pageActions, /\/web\/news/);
  assert.match(script, /turnBusy/);
  assert.match(script, /runBusyUiAction/);
  assert.match(sidePanelLifecycleController, /controlPreflightTrustButton\?\.addEventListener\?\.\("click", \(\) => void runBusyUiAction/);
  assert.match(script, /setActivity/);
  assert.match(pageActions, /openBrowserUrl/);
  assert.match(pageActions, /chrome\.tabs\.update/);
  assert.match(pageActions, /chrome\.tabs\.create/);
  assert.match(messageActionController, /copyMessage/);
  assert.match(sidePanelRenderers, /message-action/);
  assert.match(composerController, /commandInput\.addEventListener\("keydown"/);
  assert.match(composerController, /commandForm\.requestSubmit\(\)/);
  assert.match(composerController, /event\.metaKey/);
  assert.match(composerController, /undoInput/);
  assert.match(composerController, /shortcutKey === "z"/);
  assert.match(composerController, /shortcutKey === "a"/);
  assert.match(composerController, /"x", "c", "v"/);
  assert.match(messageActionController, /forkFromMessage/);
  assert.match(messageActionController, /editMessage/);
  assert.match(messageActionController, /saveMessageToArchive/);
  assert.match(messageActionController, /regenerateFromMessage/);
  assert.match(messageActionController, /deleteMessage/);
  assert.doesNotMatch(script, /Full LLM replies will come from/);
});

test("main workspace and side-panel chat composers expose the same core controls", async () => {
  const workspace = await readText(path.join(extensionRoot, "src", "main-workspace.html"));
  const panel = await readText(path.join(extensionRoot, "src", "side-panel.html"));
  const coreComposerControls = [
    "attach-file",
    "read-page",
    "save-intake",
    "save-selection",
    "context-toggle",
    "model-select",
    "thinking-depth",
    "dictate-button",
    "connection-line",
    "context-meter"
  ];

  for (const id of coreComposerControls) {
    assert.match(workspace, new RegExp(`id="${id}"`), `main workspace missing ${id}`);
    assert.match(panel, new RegExp(`id="${id}"`), `side panel missing ${id}`);
  }
  assert.match(workspace, /value="__auto__">Auto route/);
  assert.match(panel, /value="__auto__">Auto route/);

  for (const id of ["save-intake", "save-selection", "context-toggle", "dictate-button", "connection-line"]) {
    const workspaceControl = workspace.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] ?? "";
    const panelControl = panel.match(new RegExp(`<button id="${id}"[\\s\\S]*?<\\/button>`))?.[0] ?? "";
    assert.match(workspaceControl, /<svg /, `main workspace ${id} must be icon-only`);
    assert.match(panelControl, /<svg /, `side panel ${id} must be icon-only`);
    assert.doesNotMatch(workspaceControl.replace(/aria-label="[^"]*"/g, "").replace(/title="[^"]*"/g, ""), />\s*(Save|Status|Mic|Ready)\s*</i);
    assert.doesNotMatch(panelControl.replace(/aria-label="[^"]*"/g, "").replace(/title="[^"]*"/g, ""), />\s*(Save|Status|Mic|Ready)\s*</i);
  }
});

test("browser layer can read active tab context without raw privileged access", async () => {
  const content = await readText(path.join(extensionRoot, "src", "content.js"));
  const controlOverlay = await readText(path.join(extensionRoot, "src", "lib", "control-overlay.js"));
  const contentFieldSafety = await readText(path.join(extensionRoot, "src", "lib", "content-field-safety.js"));
  const contentInlineActions = await readText(path.join(extensionRoot, "src", "lib", "content-inline-actions.js"));
  const contentControlRefs = await readText(path.join(extensionRoot, "src", "lib", "content-control-refs.js"));
  const panel = await readText(path.join(extensionRoot, "src", "side-panel.js"));
  const pageActions = await readText(path.join(extensionRoot, "src", "lib", "browser-page-actions.js"));
  const walletDaoAuditMarkdown = await readText(path.join(extensionRoot, "src", "lib", "wallet-dao-audit-markdown.js"));
  const pageControlScripts = `${controlOverlay}\n${contentFieldSafety}\n${contentInlineActions}\n${contentControlRefs}\n${content}`;

  assert.match(pageControlScripts, /read_page/);
  assert.match(pageControlScripts, /click_text/);
  assert.match(pageControlScripts, /type_text/);
  assert.match(pageControlScripts, /resonantos-control-overlay/);
  assert.match(pageControlScripts, /control_overlay/);
  assert.match(pageControlScripts, /controlPhaseDetails/);
  assert.match(pageControlScripts, /ros-control-status-text/);
  assert.match(pageControlScripts, /ros-control-stop-button/);
  assert.match(pageControlScripts, /cancel_control_run/);
  assert.match(pageControlScripts, /Reading page\.\.\./);
  assert.match(pageControlScripts, /Typing\.\.\./);
  assert.match(pageControlScripts, /Taking screenshot\.\.\.|Clicking\.\.\.|Working\.\.\./);
  assert.match(pageControlScripts, /setControlSessionOverlay/);
  assert.match(pageControlScripts, /isTopWindow/);
  assert.match(pageControlScripts, /phase: message\.phase/);
  assert.match(pageControlScripts, /data-session="active"/);
  assert.match(pageControlScripts, /pulseControlOverlay/);
  assert.match(pageControlScripts, /resonantos-control-target/);
  assert.match(pageControlScripts, /resonantos-control-bubble/);
  assert.match(pageControlScripts, /showControlActionBubble/);
  assert.match(content, /userApproved/);
  assert.match(content, /isHardRestrictedElement/);
  assert.match(content, /scroll_page/);
  assert.match(content, /detect_forms/);
  assert.match(content, /clickVisibleText/);
  assert.match(content, /typeIntoPage/);
  assert.match(content, /scrollPage/);
  assert.match(content, /describeForms/);
  assert.match(content, /controls: candidateClickElements/);
  assert.match(contentControlRefs, /data-resonantos-control-ref/);
  assert.match(content, /resonantos-inline-assistant/);
  assert.match(content, /ros-inline-prompt/);
  assert.match(content, /inline_assistant_request/);
  assert.match(content, /lastInlineSelectionDetails/);
  assert.match(content, /currentSelectionDetails\(\) \?\? lastInlineSelectionDetails/);
  assert.match(content, /Summary:\\n/);
  assert.doesNotMatch(content, /127\.0\.0\.1:47773/);
  assert.match(contentInlineActions, /inlineActionList/);
  assert.match(contentInlineActions, /inlineActionByShortcut/);
  assert.match(content, /ResonantOSInlineActions/);
  assert.match(content, /editableSelectionDetails/);
  assert.match(content, /setRangeText/);
  assert.match(content, /insertReplacementText/);
  assert.match(content, /currentSitePermission/);
  assert.match(content, /augmentorInlineDraft/);
  assert.match(content, /ensureControlRef/);
  assert.match(content, /clickControlRef/);
  assert.match(contentControlRefs, /createControlRefStore/);
  assert.match(content, /classifyEditableField/);
  assert.match(contentFieldSafety, /search-query/);
  assert.match(contentFieldSafety, /document-edit/);
  assert.match(contentFieldSafety, /personal-contact/);
  assert.match(contentFieldSafety, /Credential fields are human-only/);
  assert.match(contentFieldSafety, /Payment and wallet fields are human-only/);
  assert.match(contentFieldSafety, /safeToSubmit/);
  assert.match(content, /querySelectorAllDeep/);
  assert.match(content, /openShadowHosts/);
  assert.match(content, /fields: querySelectorAllDeep/);
  assert.match(content, /viewport/);
  assert.match(content, /approvalRequired/);
  assert.match(content, /visiblePageText/);
  assert.match(content, /phantomSolana/);
  assert.match(pageActions, /phantomEthereum/);
  assert.match(pageActions, /phantomSolana/);
  assert.match(walletDaoAuditMarkdown, /Wallet \/ DAO Audit/);
  assert.match(walletDaoAuditMarkdown, /ResonantOS did not request wallet connection/);
  assert.doesNotMatch(pageActions, /\.connect\(/);
  assert.doesNotMatch(pageActions, /signMessage|signTransaction|signAndSendTransaction/);
  assert.match(pageActions, /chrome\.tabs\.sendMessage/);
  assert.match(pageActions, /phase/);
  assert.match(pageActions, /chrome\.scripting/);
  assert.match(pageActions, /executeScript/);
  assert.match(pageActions, /chrome\.webNavigation/);
  assert.match(pageActions, /mergeFrameSnapshots/);
  assert.doesNotMatch(content, /eval\(/);
  assert.doesNotMatch(panel, /eval\(/);
});

test("browser-first host is a runnable app path, not documentation-only scaffolding", async () => {
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  const launcher = await readText(path.join(browserFirstRoot, "host", "run-browser-first.mjs"));
  const agentControlHostService = await readText(path.join(browserFirstRoot, "host", "agent-control-host-service.mjs"));
  const addonDelegationService = await readText(path.join(browserFirstRoot, "host", "addon-delegation-service.mjs"));
  const addonDelegationHostService = await readText(path.join(browserFirstRoot, "host", "addon-delegation-host-service.mjs"));
  const profileService = await readText(path.join(browserFirstRoot, "host", "browser-profile-service.mjs"));
  const browserLaunchConfig = await readText(path.join(browserFirstRoot, "host", "browser-launch-config.mjs"));
  const providerHostService = await readText(path.join(browserFirstRoot, "host", "provider-host-service.mjs"));
  const providerBridgeService = await readText(path.join(browserFirstRoot, "host", "provider-bridge-service.mjs"));
  const memoryHostService = await readText(path.join(browserFirstRoot, "host", "memory-host-service.mjs"));
  const memorySourceIntakeHostService = await readText(path.join(browserFirstRoot, "host", "memory-source-intake-host-service.mjs"));
  const selfTestService = await readText(path.join(browserFirstRoot, "host", "browser-first-self-test-service.mjs"));
  const augmentorChatContract = await readText(path.join(browserFirstRoot, "host", "augmentor-chat-contract.mjs"));
  const bridgeServer = await readText(path.join(browserFirstRoot, "host", "bridge-server.mjs"));
  const installer = await readText(path.join(repoRoot, "scripts", "install-browser-first-app.mjs"));
  const nativeBuilder = await readText(path.join(repoRoot, "scripts", "build-native-browser.mjs"));
  const nativeHost = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "src", "resonant_browser_native_host.cc"),
  );
  const nativeHostMac = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "src", "resonant_browser_native_host_mac.mm"),
  );
  const nativeHostInfoPlist = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "mac", "Info.plist.in"),
  );
  const nativeHelperInfoPlist = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "mac", "helper-Info.plist.in"),
  );

  assert.match(packageJson.scripts["browser-first:dev"], /run-browser-first\.mjs/);
  assert.match(packageJson.scripts["browser-first:install"], /install-browser-first-app\.mjs/);
  assert.match(packageJson.scripts["browser-first:verify-desktop"], /verify-browser-first-desktop\.mjs/);
  assert.match(packageJson.scripts["browser-first:audit-desktop"], /audit-browser-first-desktop-report\.mjs/);
  assert.match(packageJson.scripts["browser-first:prove-desktop"], /prove-browser-first-desktop\.mjs/);
  assert.match(nativeBuilder, /adHocSignAppBundle/);
  assert.match(nativeBuilder, /PkgInfo/);
  assert.match(nativeBuilder, /codesign/);
  assert.match(nativeBuilder, /--deep/);
  assert.match(installer, /codesign/);
  assert.match(installer, /PkgInfo/);
  assert.match(installer, /os\.homedir\(\)/);
  assert.match(installer, /RESONANTOS_BROWSER_INSTALL_ROOT/);
  assert.match(installer, /MACOSX_DEPLOYMENT_TARGET/);
  assert.match(installer, /-mmacosx-version-min=/);
  assert.doesNotMatch(installer, /fork\(\)/);
  assert.doesNotMatch(installer, /setsid\(\)/);
  assert.match(installer, /execlp\("node", "node"/);
  assert.match(installer, /run-browser-first\.mjs/);
  assert.match(installer, /ResonantOS Browser\.app/);
  assert.match(installer, /com\.apple\.quarantine/);
  assert.match(installer, /com\.apple\.provenance/);
  assert.match(installer, /lsregister/);
  const installedVerifier = await readText(path.join(repoRoot, "scripts", "verify-browser-first-app.mjs"));
  const desktopVerifier = await readText(path.join(repoRoot, "scripts", "verify-browser-first-desktop.mjs"));
  assert.match(desktopVerifier, /browser-first:verify-installed/);
  assert.match(desktopVerifier, /browser-native:verify-live/);
  assert.match(desktopVerifier, /browser-first-desktop-verification\.json/);
  assert.match(desktopVerifier, /RESONANTOS_DESKTOP_VERIFICATION/);
  const desktopAudit = await readText(path.join(repoRoot, "scripts", "audit-browser-first-desktop-report.mjs"));
  assert.match(desktopAudit, /auditBrowserFirstDesktopReport/);
  assert.match(desktopAudit, /Phantom provider injection/);
  assert.match(desktopAudit, /same-session click\/type\/scroll/);
  const desktopProof = await readText(path.join(repoRoot, "scripts", "prove-browser-first-desktop.mjs"));
  assert.match(desktopProof, /browser-first:verify-desktop/);
  assert.match(desktopProof, /browser-first:audit-desktop/);
  assert.match(desktopProof, /RESONANTOS_DESKTOP_PROOF/);
  assert.match(installedVerifier, /inspectInstalledAppBundle/);
  assert.match(installedVerifier, /ResonantOSBrowserLauncher/);
  assert.match(installedVerifier, /bundleExecutableDeclared/);
  assert.match(installedVerifier, /launcherSourcePath/);
  assert.match(installedVerifier, /launcherRepoRootMatches/);
  assert.match(installedVerifier, /launcherScriptMatches/);
  assert.match(installedVerifier, /launcherLogPathMatches/);
  assert.match(installedVerifier, /launcherUsesExec/);
  assert.match(installedVerifier, /launcherForksAndExits/);
  assert.match(installedVerifier, /codesign/);
  assert.match(installedVerifier, /plutil/);
  assert.match(installedVerifier, /com\.apple\.quarantine/);
  assert.match(installedVerifier, /installedApp/);
  assert.match(installedVerifier, /requireNativeLive/);
  assert.match(installedVerifier, /runNativeLiveVerifier/);
  assert.match(installedVerifier, /verify-browser-native-live\.mjs/);
  assert.match(installedVerifier, /strict native Chromium live verification did not pass/);
  assert.match(installedVerifier, /launchServicesBlocked/);
  assert.match(installedVerifier, /normal macOS Terminal or Finder/);
  const nativeLiveVerifier = await readText(path.join(repoRoot, "scripts", "verify-browser-native-live.mjs"));
  assert.match(nativeLiveVerifier, /summarizeNativeLiveTap/);
  assert.match(nativeLiveVerifier, /#\\s\*SKIP\\b/);
  assert.match(nativeLiveVerifier, /native-live-verification-requires-unsandboxed-desktop/);
  assert.match(nativeLiveVerifier, /Native Chromium live verification is incomplete/);
  assert.match(nativeLiveVerifier, /native CEF page load/);
  assert.match(launcher, /--resonantos-browser-first/);
  assert.match(launcher, /hostAppBundle/);
  assert.match(launcher, /launchThroughMacAppBundle/);
  assert.match(launcher, /browser\.first\.launch_mode/);
  assert.match(launcher, /mac-app-bundle/);
  assert.match(launcher, /direct-native-host/);
  assert.match(launcher, /launchNativeHostThroughAppBundle/);
  assert.match(launcher, /RESONANTOS_NATIVE_DISABLE_APPKIT_MENU/);
  assert.match(launcher, /Launch Services failed/);
  assert.match(launcher, /falling back to direct native host launch/);
  assert.match(launcher, /spawn\("open", \["-W", "-n", hostAppBundle, "--args"/);
  assert.match(launcher, /args\.get\("launch-mode"\) !== "direct"/);
  assert.match(launcher, /resonantos-side-panel-extension/);
  assert.match(launcher, /bfnaelmomeimhlpmgjnjophhpkkoljpa/);
  assert.match(profileService, /pinned_extensions/);
  assert.match(launcher, /cdpdmmalhmokbfcfgogoepnjplaakgnl/);
  assert.match(launcher, /auto-open-side-panel/);
  assert.doesNotMatch(installer, /--auto-open-side-panel=true/);
  assert.match(launcher, /resolveRemoteDebugging/);
  assert.match(browserLaunchConfig, /remote-debugging-port/);
  assert.match(browserLaunchConfig, /resonantos-remote-debugging-port/);
  assert.match(launcher, /createBridgeToken/);
  assert.match(launcher, /writeBridgeConfig/);
  assert.match(launcher, /startBridgeServer/);
  assert.match(launcher, /startBridgeServerWithFallback/);
  assert.match(launcher, /runBrowserFirstSelfTest/);
  assert.doesNotMatch(launcher, /hermes-delegation-self-test/);
  assert.doesNotMatch(launcher, /memory-source-file-intake-inprocess-self-test/);
  assert.match(selfTestService, /hermes-delegation-self-test/);
  assert.match(selfTestService, /memory-source-file-intake-inprocess-self-test/);
  assert.match(selfTestService, /startBridgeServer/);
  assert.match(launcher, /browser\.first\.bridge_started/);
  assert.match(launcher, /browser\.first\.bridge_failed/);
  assert.match(bridgeServer, /bridge-config\.generated\.js/);
  assert.match(bridgeServer, /startBridgeServerWithFallback/);
  assert.match(bridgeServer, /X-ResonantOS-Bridge-Token/);
  assert.match(bridgeServer, /X-ResonantOS-Bridge-Capability-Token/);
  assert.match(bridgeServer, /requiredCapability/);
  assert.match(bridgeServer, /Unauthorized browser-first bridge request/);
  assert.doesNotMatch(bridgeServer, /Access-Control-Allow-Origin": "\*"/);
  assert.match(providerHostService, /provider-secrets\.json/);
  assert.match(providerBridgeService, /providerRouteForWorkload/);
  assert.match(providerBridgeService, /workload \|\| "augmentor-chat"/);
  assert.match(providerHostService, /requiredCapability: "provider-credential-write"/);
  assert.match(providerHostService, /requiredCapability: "provider-routing-write"/);
  assert.match(providerHostService, /\/augmentor\/chat/);
  assert.match(providerHostService, /\/augmentor\/inline/);
  assert.match(providerBridgeService, /executeInlineAssistant/);
  assert.match(providerBridgeService, /customInstruction/);
  assert.match(launcher, /agent-control-host-service\.mjs/);
  assert.match(launcher, /agentControlRoutes/);
  assert.match(agentControlHostService, /\/augmentor\/control-plan/);
  assert.match(agentControlHostService, /\/augmentor\/next-action/);
  assert.match(agentControlHostService, /executeNextAction/);
  assert.match(agentControlHostService, /sanitizeNextActionDecision/);
  assert.match(agentControlHostService, /switch_tab/);
  assert.match(agentControlHostService, /sanitizeControlStep/);
  assert.match(agentControlHostService, /sanitizeControlPlan/);
  assert.match(agentControlHostService, /executeControlPlan/);
  assert.match(agentControlHostService, /strict JSON only/);
  assert.match(agentControlHostService, /observed refs/);
  assert.match(providerBridgeService, /buildAugmentorChatRequestMessages/);
  assert.match(augmentorChatContract, /The web page remains in the main browser viewport/);
  assert.match(augmentorChatContract, /host-mediated browser tools/);
  assert.match(augmentorChatContract, /click visible page text/);
  assert.match(augmentorChatContract, /never claim delegation is outside Augmentor's ResonantOS capabilities/);
  assert.match(memoryHostService, /\/memory\/status/);
  assert.match(memoryHostService, /\/memory\/search/);
  assert.match(memoryHostService, /\/archive\/intake/);
  assert.match(launcher, /memory-source-intake-host-service\.mjs/);
  assert.match(launcher, /memorySourceIntakeService/);
  assert.doesNotMatch(launcher, /async function executeMemorySourceFileIntake/);
  assert.doesNotMatch(launcher, /async function executeMemorySourceSync/);
  assert.match(memorySourceIntakeHostService, /executeMemorySourceFileIntake/);
  assert.match(memorySourceIntakeHostService, /executeMemorySourceSync/);
  assert.match(memorySourceIntakeHostService, /sourceReviewSnapshot/);
  assert.match(memorySourceIntakeHostService, /Source review is read-only/);
  assert.match(addonDelegationHostService, /\/addons\/delegate/);
  assert.match(addonDelegationHostService, /\/addons\/delegate\/list/);
  assert.match(addonDelegationService, /contextMarkdown/);
  assert.match(addonDelegationService, /sourceControlRunId/);
  assert.match(addonDelegationService, /Context Packet/);
  assert.match(agentControlHostService, /\/web\/news/);
  assert.match(agentControlHostService, /news\.google\.com\/rss/);
  assert.match(launcher, /keystroke \\"a\\" using \{option down, shift down\}/);
  assert.match(nativeHost, /resonantos-browser-first/);
  assert.match(nativeHost, /AppendSwitchWithValue\("remote-debugging-port", "0"\)/);
  assert.match(nativeHost, /AppendSwitchWithValue\("remote-debugging-address", "127\.0\.0\.1"\)/);
  assert.doesNotMatch(nativeHost, /requested_debug_port/);
  assert.match(nativeHost, /CefKeyboardHandler/);
  assert.match(nativeHost, /EVENTFLAG_COMMAND_DOWN/);
  assert.match(nativeHost, /EVENTFLAG_CONTROL_DOWN/);
  assert.match(nativeHost, /HasPrimaryBrowserShortcutModifier/);
  assert.match(nativeHost, /BrowserCommandForPrimaryShortcut/);
  assert.match(nativeHost, /return "new_tab"/);
  assert.match(nativeHost, /return "close_tab"/);
  assert.match(nativeHost, /return "quit"/);
  assert.match(nativeHost, /return "new_incognito_window"/);
  assert.match(nativeHost, /return "close_window"/);
  assert.match(nativeHost, /return "reopen_closed_tab"/);
  assert.match(nativeHost, /return "previous_tab"/);
  assert.match(nativeHost, /return "next_tab"/);
  assert.match(nativeHost, /return "find_previous"/);
  assert.match(nativeHost, /return "focus_address_bar"/);
  assert.match(nativeHost, /return "reload"/);
  assert.match(nativeHost, /return "back"/);
  assert.match(nativeHost, /return "forward"/);
  assert.match(nativeHost, /return "find"/);
  assert.match(nativeHost, /return "zoom_reset"/);
  assert.match(nativeHost, /return "zoom_in"/);
  assert.match(nativeHost, /return "zoom_out"/);
  assert.match(nativeHost, /ExecuteNativeMenuCommand\(command\)/);
  assert.match(nativeHost, /OpenNewBrowserSurface/);
  assert.match(nativeHost, /CloseBrowser\(false\)/);
  assert.match(nativeHost, /CloseAllBrowserSurfaces/);
  assert.match(nativeHost, /kChromeNewTabFooterUrl/);
  assert.match(nativeHost, /chrome:\/\/newtab-footer/);
  assert.match(nativeHost, /loaded_url\.rfind\("chrome:\/\/newtab", 0\) == 0/);
  assert.match(nativeHost, /raw Chromium new-tab/);
  assert.match(nativeHost, /no-first-run/);
  assert.match(nativeHost, /no-default-browser-check/);
  assert.match(nativeHost, /hide-crash-restore-bubble/);
  assert.match(nativeHost, /Settings\/About/);
  assert.match(nativeHost, /browser\.first\.started/);
  assert.match(nativeHost, /resonantos-user-data-dir/);
  assert.match(nativeHost, /ExecuteNativeMenuCommand/);
  assert.match(nativeHost, /resonant_browser_native_execute_menu_command/);
  assert.match(nativeHost, /ExecuteChromeCommandByName/);
  assert.match(nativeHost, /cef_id_for_command_id_name/);
  assert.match(nativeHost, /CefContextMenuHandler/);
  assert.match(nativeHost, /GetContextMenuHandler/);
  assert.match(nativeHost, /OnBeforeContextMenu/);
  assert.match(nativeHost, /RunContextMenu/);
  assert.match(nativeHost, /OnContextMenuCommand/);
  assert.match(nativeHost, /OnContextMenuDismissed/);
  assert.match(nativeHost, /browser\.native\.context_menu\.before/);
  assert.match(nativeHost, /browser\.native\.context_menu\.run/);
  assert.match(nativeHost, /resonantos-context-menu-smoke/);
  assert.match(nativeHost, /resonantos-menu-command-smoke/);
  assert.match(nativeHost, /browser\.native\.menu_command\.invoke/);
  assert.match(nativeHost, /browser\.native\.menu_command\.result/);
  assert.match(nativeHost, /IDC_NEW_TAB/);
  assert.match(nativeHost, /IDC_NEW_WINDOW/);
  assert.match(nativeHost, /IDC_NEW_INCOGNITO_WINDOW/);
  assert.match(nativeHost, /IDC_CLOSE_TAB/);
  assert.match(nativeHost, /IDC_FOCUS_LOCATION/);
  assert.match(nativeHost, /IDC_OPEN_FILE/);
  assert.match(nativeHost, /IDC_SAVE_PAGE/);
  assert.match(nativeHost, /IDC_FIND/);
  assert.match(nativeHost, /IDC_FIND_NEXT/);
  assert.match(nativeHost, /IDC_FIND_PREVIOUS/);
  assert.match(nativeHost, /IDC_VIEW_SOURCE/);
  assert.match(nativeHost, /IDC_DEV_TOOLS/);
  assert.match(nativeHost, /IDC_MANAGE_EXTENSIONS/);
  assert.match(nativeHost, /IDC_SHOW_HISTORY/);
  assert.match(nativeHost, /IDC_SHOW_DOWNLOADS/);
  assert.match(nativeHost, /IDC_CLEAR_BROWSING_DATA/);
  assert.match(nativeHost, /IDC_OPTIONS/);
  assert.match(nativeHost, /IDC_VIEW_PASSWORDS/);
  assert.match(nativeHost, /IDC_BOOKMARK_THIS_TAB/);
  assert.match(nativeHost, /IDC_SHOW_BOOKMARK_MANAGER/);
  assert.match(nativeHost, /IDC_MANAGE_CHROME_PROFILES/);
  assert.match(nativeHost, /IDC_SELECT_NEXT_TAB/);
  assert.match(nativeHost, /IDC_RESTORE_TAB/);
  assert.match(nativeHost, /GetZoomLevel/);
  assert.match(nativeHost, /SetZoomLevel/);
  assert.match(nativeHost, /SendEscapeKey/);
  assert.match(nativeHost, /CefDownloadHandler/);
  assert.match(nativeHost, /CefPermissionHandler/);
  assert.match(nativeHost, /GetDownloadHandler/);
  assert.match(nativeHost, /GetPermissionHandler/);
  assert.match(nativeHost, /CanDownload/);
  assert.match(nativeHost, /OnBeforeDownload/);
  assert.match(nativeHost, /OnDownloadUpdated/);
  assert.match(nativeHost, /OnRequestMediaAccessPermission/);
  assert.match(nativeHost, /OnShowPermissionPrompt/);
  assert.match(nativeHost, /browser\.native\.download_updated/);
  assert.match(nativeHost, /browser\.native\.permission\.prompt/);
  assert.match(nativeHost, /deny-by-default/);
  assert.match(nativeHost, /allow-resonant-mic/);
  assert.match(nativeHost, /allow-resonant-audio/);
  assert.match(nativeHost, /resonantos-download-smoke/);
  assert.match(nativeHost, /resonantos-permission-smoke/);
  assert.match(nativeHostMac, /ResonantInstallMainMenu/);
  assert.match(nativeHostMac, /resonant_browser_native_install_appkit_menu/);
  assert.match(nativeHostMac, /setMainMenu/);
  assert.match(nativeHostMac, /resonant_browser_native_execute_menu_command/);
  assert.match(nativeHost, /CefInitialize/);
  assert.match(nativeHost, /resonant_browser_native_install_appkit_menu\(\)/);
  assert.match(nativeHostMac, /ResonantShouldDisableAppKitMenu/);
  assert.match(nativeHostMac, /RESONANTOS_NATIVE_DISABLE_APPKIT_MENU/);
  assert.match(nativeHostMac, /-smoke/);
  assert.match(nativeHostMac, /browser\.native\.appkit_menu\.installed/);
  assert.match(nativeHostMac, /pre-cef/);
  assert.match(nativeHostMac, /post-cef/);
  assert.match(nativeHostMac, /browser\.native\.appkit_menu\.disabled/);
  assert.match(nativeHostMac, /ResonantOS Browser/);
  assert.match(nativeHostMac, /File/);
  assert.match(nativeHostMac, /New Incognito Window/);
  assert.match(nativeHostMac, /Open Location/);
  assert.match(nativeHostMac, /Edit/);
  assert.match(nativeHostMac, /View/);
  assert.match(nativeHostMac, /Assistant/);
  assert.match(nativeHostMac, /History/);
  assert.match(nativeHostMac, /Bookmarks/);
  assert.match(nativeHostMac, /Profiles/);
  assert.match(nativeHostMac, /Tab/);
  assert.match(nativeHostMac, /Window/);
  assert.match(nativeHostMac, /Help/);
  assert.match(nativeHostMac, /copy:/);
  assert.match(nativeHostMac, /paste:/);
  assert.match(nativeHostMac, /selectAll:/);
  assert.match(nativeHostMac, /terminate:/);
  assert.match(nativeHostMac, /resonantNewTab:/);
  assert.match(nativeHostMac, /resonantOpenFile:/);
  assert.match(nativeHostMac, /resonantSavePage:/);
  assert.match(nativeHostMac, /resonantFind:/);
  assert.match(nativeHostMac, /resonantFindNext:/);
  assert.match(nativeHostMac, /resonantFindPrevious:/);
  assert.match(nativeHostMac, /resonantReloadPage:/);
  assert.match(nativeHostMac, /resonantViewSource:/);
  assert.match(nativeHostMac, /resonantDeveloperTools:/);
  assert.match(nativeHostMac, /resonantManageExtensions:/);
  assert.match(nativeHostMac, /resonantOpenAugmentor:/);
  assert.match(nativeHostMac, /resonantShowHistory:/);
  assert.match(nativeHostMac, /resonantShowDownloads:/);
  assert.match(nativeHostMac, /resonantClearBrowsingData:/);
  assert.match(nativeHostMac, /resonantBookmarkThisPage:/);
  assert.match(nativeHostMac, /resonantDefaultProfile:/);
  assert.match(nativeHostMac, /resonantManageProfiles:/);
  assert.match(nativeHostMac, /resonantPasswordManager:/);
  assert.match(nativeHostMac, /resonantSettings:/);
  assert.match(nativeHostMac, /resonantNextTab:/);
  assert.match(nativeHostMac, /resonantHelp:/);
  assert.match(nativeHostMac, /ResonantRedirectStdoutToLog/);
  assert.match(nativeHostMac, /--resonantos-log-path=/);
  assert.match(nativeHostInfoPlist, /NSMicrophoneUsageDescription/);
  assert.match(nativeHelperInfoPlist, /NSMicrophoneUsageDescription/);
});

test("native AppKit browser menus expose only implemented CEF command routes", async () => {
  const nativeHost = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "src", "resonant_browser_native_host.cc"),
  );
  const nativeHostMac = await readText(
    path.join(repoRoot, "addons", "resonant-browser-native", "native_host", "src", "resonant_browser_native_host_mac.mm"),
  );

  const menuCommands = [...nativeHostMac.matchAll(/resonant_browser_native_execute_menu_command\("([^"]+)"\)/g)]
    .map((match) => match[1])
    .sort();
  assert.ok(menuCommands.length > 20, "The native menu should expose real browser command coverage.");

  for (const command of menuCommands) {
    assert.match(
      nativeHost,
      new RegExp(`command == "${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `Native menu command ${command} must be handled by the CEF host.`,
    );
  }

  const chromeCommandIds = [
    "IDC_NEW_TAB",
    "IDC_NEW_WINDOW",
    "IDC_CLOSE_TAB",
    "IDC_OPEN_FILE",
    "IDC_FOCUS_LOCATION",
    "IDC_SAVE_PAGE",
    "IDC_FIND",
    "IDC_FIND_NEXT",
    "IDC_FIND_PREVIOUS",
    "IDC_VIEW_SOURCE",
    "IDC_DEV_TOOLS",
    "IDC_MANAGE_EXTENSIONS",
    "IDC_OPTIONS",
    "IDC_SHOW_HISTORY",
    "IDC_SHOW_DOWNLOADS",
    "IDC_BOOKMARK_THIS_TAB",
    "IDC_SHOW_BOOKMARK_MANAGER",
    "IDC_MANAGE_CHROME_PROFILES",
    "IDC_VIEW_PASSWORDS",
    "IDC_SELECT_NEXT_TAB",
    "IDC_SELECT_PREVIOUS_TAB",
    "IDC_RESTORE_TAB",
    "IDC_PRINT",
  ];
  for (const commandId of chromeCommandIds) {
    assert.match(nativeHost, new RegExp(commandId), `CEF host must route ${commandId}.`);
  }
});

test("browser-first bridge rejects unauthenticated localhost requests", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--bridge-auth-self-test=true",
    "--bridge-token=test-token",
    "--bridge-port=0",
  ], 10_000);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.unauthorizedStatus, 401);
  assert.equal(payload.wrongTokenStatus, 401);
  assert.equal(payload.authorizedStatus, 200);
});

test("browser-first bridge completes deterministic Hermes delegation lifecycle", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--hermes-delegation-self-test=true",
    "--bridge-token=test-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.match(toPortablePath(payload.artifactPath), /BrowserFirst\/DelegationArtifacts\/hermes/);
  assert.equal(payload.statusAfter, "completed");
  assert.ok(payload.listed >= 1);
});

test("browser-first bridge executes enabled Hermes CLI adapter through host boundary", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--hermes-cli-execution-self-test=true",
    "--bridge-token=test-token",
    "--addon-execution-settings-token=execution-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.adapter, "hermes-cli");
  assert.equal(payload.hermesMode, "local-hermes-cli");
  assert.equal(payload.statusAfter, "completed");
  assert.match(toPortablePath(payload.artifactPath), /BrowserFirst\/DelegationArtifacts\/hermes/);
  assert.match(payload.summary, /Hermes CLI adapter completed/);
});

test("browser-first bridge executes enabled OpenCode CLI adapter through host boundary", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--opencode-cli-execution-self-test=true",
    "--bridge-token=test-token",
    "--addon-execution-settings-token=execution-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.adapter, "opencode-cli");
  assert.equal(payload.opencodeMode, "local-opencode-cli");
  assert.equal(payload.statusAfter, "completed");
  assert.match(toPortablePath(payload.artifactPath), /BrowserFirst\/DelegationArtifacts\/opencode/);
  assert.match(payload.summary, /OpenCode CLI adapter completed/);
});

test("browser-first bridge completes deterministic OpenCode delegation lifecycle", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--opencode-delegation-self-test=true",
    "--bridge-token=test-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.match(toPortablePath(payload.artifactPath), /BrowserFirst\/DelegationArtifacts\/opencode/);
  assert.equal(payload.gatedStatus, "blocked");
  assert.equal(payload.statusAfter, "completed");
  assert.ok(payload.listed >= 1);
});

test("browser-first bridge persists add-on execution settings behind scoped capability", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--addon-execution-settings-self-test=true",
    "--bridge-token=test-token",
    "--addon-execution-settings-token=execution-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.deniedStatus, 403);
  assert.equal(payload.hermesMode, "local-hermes-cli");
  assert.equal(payload.opencodeMode, "local-opencode-cli");
  assert.equal(payload.settings.hermes.localCliExecution, true);
  assert.equal(payload.settings.opencode.localCliExecution, true);
});

test("browser-first bridge executes move-on-import through scoped routes", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--memory-source-move-self-test=true",
    "--bridge-token=test-token",
    "--memory-source-move-token=move-token",
    "--bridge-port=0",
  ]);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.unauthorizedCapabilityStatus, 403);
  assert.equal(payload.ordinaryMoveSettings.status, 500);
  assert.match(payload.ordinaryMoveSettings.error, /audited move preflight and execute flow/i);
  assert.equal(payload.preflight.ok, true);
  assert.equal(payload.preflight.okToMove, true);
  assert.equal(payload.preflight.fileCount, 2);
  assert.equal(payload.preflight.hiddenFiles, 1);
  assert.match(payload.preflight.preflightFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(payload.stalePreflight.ok, true);
  assert.equal(payload.stalePreflight.status, 500);
  assert.equal(payload.stalePreflight.sourcePreserved, true);
  assert.match(payload.stalePreflight.error, /source changed after preflight/i);
  assert.equal(payload.execute.ok, true);
  assert.equal(payload.execute.status, "moved");
  assert.equal(payload.execute.movedCount, 2);
  assert.equal(payload.execute.sourceCleanupStatus, "removed");
  assert.equal(payload.execute.sourceRemoved, true);
  assert.equal(payload.execute.movedNoteExists, true);
  assert.equal(payload.rollback.ok, true);
  assert.equal(payload.rollback.restoredCount, 2);
  assert.equal(payload.rollback.restoredNoteExists, true);
  assert.equal(payload.partialRollback.ok, true);
  assert.equal(payload.partialRollback.restoredCount, 0);
  assert.equal(payload.partialRollback.skippedCount, 1);
  assert.equal(payload.partialRollback.sourceStillRegistered, true);
});

test("browser-first host blocks move-on-import through ordinary memory settings save", async () => {
  const launcher = await readText(path.join(browserFirstRoot, "host", "run-browser-first.mjs"));
  const memoryHostService = await readText(path.join(browserFirstRoot, "host", "memory-host-service.mjs"));
  const memorySourceSettingsService = await readText(path.join(browserFirstRoot, "host", "memory-source-settings-service.mjs"));
  assert.match(launcher, /createMemorySourceSettingsService/);
  assert.match(memorySourceSettingsService, /assertMemorySettingsSourceCanSave\(payload\.source\)/);
  assert.match(memoryHostService, /\/memory\/source\/move-preflight/);
  assert.match(memoryHostService, /\/memory\/source\/move-execute/);
});

test("browser-first bridge hardens selected Living Archive source file intake", (t) => {
  const payload = runBridgeSelfTest(t, [
    "--memory-source-file-intake-self-test=true",
    "--bridge-token=test-token",
    "--memory-settings-token=settings-token",
    "--memory-source-file-intake-token=file-intake-token",
    "--bridge-port=0",
  ], 30_000);
  if (!payload) return;

  assert.equal(payload.ok, true);
  assert.equal(payload.unauthorizedCapabilityStatus, 403);
  assert.equal(payload.createdCount, 200);
  assert.equal(payload.snapshotRecorded, true);
  assert.equal(payload.duplicateRejected, true);
  assert.equal(payload.escapeRejected, true);
  assert.equal(payload.overflowRejected, 5);
  assert.equal(payload.failureStatus, 500);
  assert.equal(payload.rollbackReservedVersions, 0);
});
