import assert from "node:assert/strict";
import test from "node:test";

import { summarizeBrowserLaunchLog } from "../host/browser-launch-diagnostics.mjs";

test("browser launch diagnostics proves native Chromium app readiness from launch log", () => {
  const summary = summarizeBrowserLaunchLog(`
{"event":"browser.first.launch_mode","mode":"mac-app-bundle","appBundle":"/private/home/ResonantBrowserNativeHost.app"}
{"event":"browser.first.bridge_started","requestedPort":47773,"attemptedPort":47773,"actualPort":47773,"recovered":false}
{
  "phantomLoaded": true,
  "pinnedExtensions": [
    "cdpdmmalhmokbfcfgogoepnjplaakgnl",
    "bfnaelmomeimhlpmgjnjophhpkkoljpa"
  ]
}
{"event":"browser.native.cef_initialize_ok"}
{"event":"browser.native.appkit_menu.installed","phase":"post-cef","menus":["ResonantOS Browser","File","Edit","View","Assistant","History","Bookmarks","Profiles","Tab","Window","Help"]}
{"hostId":"resonant-browser-native","engineCandidate":"cef-chrome-runtime"}
{"event":"browser.native.load_end","status":200,"url":"chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html"}
`);

  assert.equal(summary.status, "ready");
  assert.deepEqual(summary.issues, []);
  assert.equal(summary.launchMode, "mac-app-bundle");
  assert.equal(summary.appkitMenu, "installed");
  assert.equal(summary.appkitMenuPhase, "post-cef");
  assert.equal(summary.postCefMenuInstalled, true);
  assert.equal(summary.cefInitialized, true);
  assert.equal(summary.nativeHostStarted, true);
  assert.equal(summary.mainWorkspaceLoaded, true);
  assert.equal(summary.phantomLoaded, true);
  assert.deepEqual(summary.bridge, {
    status: "started",
    requestedPort: 47773,
    attemptedPort: 47773,
    actualPort: 47773,
    recovered: false,
  });
  assert.equal(summary.pinnedExtensions.resonantOS, true);
  assert.equal(summary.pinnedExtensions.phantom, true);
  assert.deepEqual(summary.menuNames, [
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
  ]);
  assert.deepEqual(summary.missingMenus, []);
});

test("browser launch diagnostics flags direct fallback or missing menu as attention", () => {
  const summary = summarizeBrowserLaunchLog(`
{"event":"browser.first.launch_mode","mode":"direct-native-host","directHost":"/tmp/host"}
{"event":"browser.first.bridge_failed","requestedPort":47773,"code":"EPERM","message":"listen EPERM"}
{"event":"browser.native.appkit_menu.disabled","reason":"direct-or-smoke-launch"}
{"event":"browser.native.cef_initialize_ok"}
{"hostId":"resonant-browser-native","engineCandidate":"cef-chrome-runtime"}
{"event":"browser.native.load_end","status":200,"url":"chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html"}
`);

  assert.equal(summary.status, "attention");
  assert.equal(summary.launchMode, "direct-native-host");
  assert.equal(summary.appkitMenu, "disabled");
  assert.equal(summary.phantomLoaded, false);
  assert.equal(summary.bridge.status, "failed");
  assert.equal(summary.bridge.code, "EPERM");
  assert.ok(summary.missingMenus.includes("Assistant"));
  assert.ok(summary.issues.some((issue) => /AppKit menu is disabled/.test(issue)));
  assert.ok(summary.issues.some((issue) => /Local bridge is failed/.test(issue)));
});

test("browser launch diagnostics does not report ready when bridge is missing", () => {
  const summary = summarizeBrowserLaunchLog(`
{"event":"browser.first.launch_mode","mode":"mac-app-bundle","appBundle":"/private/home/ResonantBrowserNativeHost.app"}
{
  "phantomLoaded": true,
  "pinnedExtensions": [
    "cdpdmmalhmokbfcfgogoepnjplaakgnl",
    "bfnaelmomeimhlpmgjnjophhpkkoljpa"
  ]
}
{"event":"browser.native.appkit_menu.installed","menus":["ResonantOS Browser","File","Edit","View","Assistant","History","Bookmarks","Profiles","Tab","Window","Help"]}
{"event":"browser.native.cef_initialize_ok"}
{"hostId":"resonant-browser-native","engineCandidate":"cef-chrome-runtime"}
{"event":"browser.native.load_end","status":200,"url":"chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html"}
`);

  assert.equal(summary.status, "attention");
  assert.equal(summary.bridge.status, "unknown");
  assert.ok(summary.issues.some((issue) => /Local bridge is unknown/.test(issue)));
});

test("browser launch diagnostics requires menu reassertion after CEF initializes", () => {
  const summary = summarizeBrowserLaunchLog(`
{"event":"browser.first.launch_mode","mode":"mac-app-bundle","appBundle":"/private/home/ResonantBrowserNativeHost.app"}
{"event":"browser.first.bridge_started","requestedPort":47773,"attemptedPort":47773,"actualPort":47773,"recovered":false}
{
  "phantomLoaded": true,
  "pinnedExtensions": [
    "cdpdmmalhmokbfcfgogoepnjplaakgnl",
    "bfnaelmomeimhlpmgjnjophhpkkoljpa"
  ]
}
{"event":"browser.native.appkit_menu.installed","phase":"pre-cef","menus":["ResonantOS Browser","File","Edit","View","Assistant","History","Bookmarks","Profiles","Tab","Window","Help"]}
{"event":"browser.native.cef_initialize_ok"}
{"hostId":"resonant-browser-native","engineCandidate":"cef-chrome-runtime"}
{"event":"browser.native.load_end","status":200,"url":"chrome-extension://cdpdmmalhmokbfcfgogoepnjplaakgnl/src/main-workspace.html"}
`);

  assert.equal(summary.status, "attention");
  assert.equal(summary.appkitMenu, "installed");
  assert.equal(summary.appkitMenuPhase, "pre-cef");
  assert.equal(summary.postCefMenuInstalled, false);
  assert.ok(summary.issues.some((issue) => /not reasserted after CEF/.test(issue)));
});
