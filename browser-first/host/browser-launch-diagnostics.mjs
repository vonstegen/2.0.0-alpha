const resonantExtensionId = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
const phantomExtensionId = "bfnaelmomeimhlpmgjnjophhpkkoljpa";
const requiredMenuNames = [
  "ResonantOS Browser",
  "File",
  "Edit",
  "View",
  "Assistant",
  "History",
  "Bookmarks",
  "Profiles",
  "Tab",
  "Window",
  "Help",
];

function parseJsonLines(logContent = "") {
  const events = [];
  for (const line of String(logContent).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        events.push(parsed);
      }
    } catch {
      // Multi-line pretty-printed blocks are intentionally ignored here.
      // The diagnostics below also checks stable string markers from those blocks.
    }
  }
  return events;
}

function lastMatching(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) {
      return events[index];
    }
  }
  return null;
}

export function summarizeBrowserLaunchLog(logContent = "") {
  const content = String(logContent);
  const events = parseJsonLines(content);
  const launchModeEvent = lastMatching(events, (event) => event.event === "browser.first.launch_mode");
  const bridgeStartedEvent = lastMatching(events, (event) => event.event === "browser.first.bridge_started");
  const bridgeFailedEvent = lastMatching(events, (event) => event.event === "browser.first.bridge_failed");
  const menuInstalledEvent = lastMatching(events, (event) => event.event === "browser.native.appkit_menu.installed");
  const postCefMenuInstalledEvent = lastMatching(
    events,
    (event) => event.event === "browser.native.appkit_menu.installed" && event.phase === "post-cef",
  );
  const menuDisabledEvent = lastMatching(events, (event) => event.event === "browser.native.appkit_menu.disabled");
  const loadEndEvent = lastMatching(events, (event) => event.event === "browser.native.load_end");

  const phantomPinned = content.includes(phantomExtensionId);
  const resonantPinned = content.includes(resonantExtensionId);
  const phantomLoaded = /"phantomLoaded"\s*:\s*true/.test(content) ||
    events.some((event) => event.event === "browser.native.phantom_provider_detection" && event.detected === true);
  const cefInitialized = events.some((event) => event.event === "browser.native.cef_initialize_ok");
  const nativeHostStarted = content.includes("\"hostId\":\"resonant-browser-native\"") ||
    content.includes('"hostId": "resonant-browser-native"');
  const mainWorkspaceLoaded = events.some((event) =>
    event.event === "browser.native.load_end" &&
    String(event.url ?? "").includes(`${resonantExtensionId}/src/main-workspace.html`)
  );

  const appkitMenu = menuInstalledEvent
    ? "installed"
    : menuDisabledEvent
      ? "disabled"
      : "unknown";
  const appkitMenuPhase = menuInstalledEvent?.phase ?? "";
  const postCefMenuInstalled = Boolean(postCefMenuInstalledEvent);
  const menuNames = Array.isArray(menuInstalledEvent?.menus) ? menuInstalledEvent.menus : [];
  const missingMenus = requiredMenuNames.filter((name) => !menuNames.includes(name));
  const bridge = bridgeStartedEvent
    ? {
        status: "started",
        requestedPort: bridgeStartedEvent.requestedPort,
        attemptedPort: bridgeStartedEvent.attemptedPort,
        actualPort: bridgeStartedEvent.actualPort,
        recovered: Boolean(bridgeStartedEvent.recovered),
      }
    : bridgeFailedEvent
      ? {
          status: "failed",
          requestedPort: bridgeFailedEvent.requestedPort,
          code: bridgeFailedEvent.code,
          message: bridgeFailedEvent.message,
        }
      : { status: "unknown" };
  const issues = [
    appkitMenu !== "installed" ? `AppKit menu is ${appkitMenu}; launch through the installed macOS app bundle.` : "",
    appkitMenu === "installed" && !postCefMenuInstalled
      ? "AppKit menu was not reasserted after CEF initialized."
      : "",
    missingMenus.length ? `Missing native browser menus: ${missingMenus.join(", ")}.` : "",
    !nativeHostStarted ? "Native Chromium host did not start." : "",
    !cefInitialized ? "CEF/Chromium did not initialize." : "",
    !mainWorkspaceLoaded ? "ResonantOS main workspace did not load." : "",
    !phantomLoaded ? "Phantom provider was not detected in the browser profile." : "",
    !resonantPinned ? "ResonantOS extension is not pinned or not present in the launch log." : "",
    !phantomPinned ? "Phantom extension is not pinned or not present in the launch log." : "",
    bridge.status !== "started" ? `Local bridge is ${bridge.status}${bridge.code ? ` (${bridge.code})` : ""}.` : "",
  ].filter(Boolean);
  const launchMode = launchModeEvent?.mode ?? (menuInstalledEvent ? "mac-app-bundle" : "unknown");
  const status = appkitMenu === "installed" &&
    postCefMenuInstalled &&
    missingMenus.length === 0 &&
    cefInitialized &&
    nativeHostStarted &&
    mainWorkspaceLoaded &&
    phantomLoaded &&
    resonantPinned &&
    phantomPinned &&
    bridge.status === "started"
    ? "ready"
    : "attention";

  return {
    status,
    issues,
    launchMode,
    appkitMenu,
    appkitMenuPhase,
    postCefMenuInstalled,
    menuNames,
    missingMenus,
    nativeHostStarted,
    cefInitialized,
    mainWorkspaceLoaded,
    phantomLoaded,
    bridge,
    pinnedExtensions: {
      resonantOS: resonantPinned,
      phantom: phantomPinned,
    },
    lastLoadedUrl: loadEndEvent?.url ?? "",
    lastEvents: events
      .filter((event) => typeof event.event === "string")
      .slice(-12)
      .map((event) => ({
        event: event.event,
        mode: event.mode,
        status: event.status,
        url: event.url,
        title: event.title,
        reason: event.reason,
        phase: event.phase,
      })),
  };
}
