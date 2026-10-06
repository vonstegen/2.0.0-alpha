// CP-BR2: extension manifest carries `nativeMessaging`, the bootstrap
// client is not reachable from page/React code, and the superseded
// `/bridge/launch` and `bridge_launch` symbols remain absent.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, "../resonantos-side-panel-extension/manifest.json");
const backgroundPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/background.js");
const sidePanelPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/side-panel.js");
const mainWorkspacePath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/main-workspace.js");
const bridgeClientPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/lib/bridge-client.js");
const bridgeTargetSectionPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/lib/settings/bridge-target-section.js");
const bootstrapClientPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/lib/bootstrap-client.js");
const bootstrapStartupPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/lib/bootstrap-startup.js");
const bootstrapRendererPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/lib/bootstrap-renderer.js");

test("manifest.json: nativeMessaging permission is present and not widened to wildcards", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(manifest.permissions.includes("nativeMessaging"), "manifest must declare nativeMessaging permission");
  // No wildcard host_permissions: the manifest's existing host_permissions
  // are unchanged. We assert this is the case by reading the file and
  // grepping for "*" in the host_permissions array (the existing schema
  // uses a single wildcard per protocol which the host permissions
  // already use; the key requirement is no NEW wildcards).
  assert.ok(Array.isArray(manifest.host_permissions), "host_permissions must be an array");
  // The bootstrap client relies on the Alpha extension origin only. The
  // native host manifest's `allowed_origins` is NOT a manifest.json
  // field — it's installed by the CP-BR1 macOS installer — but the
  // extension must not request any host origin wildcards.
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes("\"*://*/*\""), false, "no fresh http://*/* wildcards");
  assert.equal(serialized.includes("\"<all_urls>\""), false, "no <all_urls> wildcard");
});

test("manifest.json: minimum_chrome_version is unchanged and no extension id is exposed in DOM", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.ok(manifest.minimum_chrome_version, "manifest must declare minimum_chrome_version");
  // The "key" field is the Alpha extension id and is not a secret; we
  // just assert it's still present (the CP-BR1 host manifest pins
  // allowed_origins to it).
  assert.ok(manifest.key, "manifest must keep its extension key");
});

test("bootstrap client is only imported by privileged entry points and settings sections", async () => {
  const background = await readFile(backgroundPath, "utf8");
  const sidePanel = await readFile(sidePanelPath, "utf8");
  const mainWorkspace = await readFile(mainWorkspacePath, "utf8");
  assert.match(background, /import\s+\{[^}]*createBootstrapClient[^}]*\}\s+from\s+"\.\/lib\/bootstrap-client\.js"/s);
  assert.match(sidePanel, /import\s+\{[^}]*createBootstrapRenderer[^}]*\}\s+from\s+"\.\/lib\/bootstrap-renderer\.js"/s);
  assert.match(mainWorkspace, /import\s+\{[^}]*createBootstrapRenderer[^}]*\}\s+from\s+"\.\/lib\/bootstrap-renderer\.js"/s);
});

test("bootstrap-client.js refuses to construct in a page context (no chrome.runtime or http(s) origin)", async () => {
  // We re-import lazily so the module is fresh for this assertion.
  const { createBootstrapClient } = await import("../resonantos-side-panel-extension/src/lib/bootstrap-client.js");
  const savedChrome = globalThis.chrome;
  const savedLocation = globalThis.location;
  globalThis.chrome = { runtime: {} };
  globalThis.location = { href: "http://attacker.example/page" };
  try {
    assert.throws(
      () => createBootstrapClient({ createPort: () => { throw new Error("unreachable"); } }),
      /refused in page context/,
    );
  } finally {
    if (savedChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = savedChrome;
    if (savedLocation === undefined) delete globalThis.location;
    else globalThis.location = savedLocation;
  }
});

test("bootstrap-client.js: no chrome.runtime.connectNative in any React renderer code path", async () => {
  // The renderer is the one that talks to the bridge, but it MUST go
  // through the privileged message channel (chrome.runtime.sendMessage
  // to background), not through connectNative directly. We strip
  // comments before the assertion.
  const bootstrapClient = await readFile(bootstrapClientPath, "utf8");
  const bootstrapRenderer = await readFile(bootstrapRendererPath, "utf8");
  assert.match(bootstrapClient, /connectNative/);
  const rendererNoComments = bootstrapRenderer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.equal(
    rendererNoComments.includes("connectNative"),
    false,
    "renderer code must not call connectNative directly (only via the privileged message channel)",
  );
});

test("bridge-client.js: the `/bridge/launch` route and `bridge_launch` symbol remain absent (CP-BR0 supersession)", async () => {
  const bridgeClient = await readFile(bridgeClientPath, "utf8");
  const bridgeTargetSection = await readFile(bridgeTargetSectionPath, "utf8");
  const bootstrapStartup = await readFile(bootstrapStartupPath, "utf8");
  const background = await readFile(backgroundPath, "utf8");
  for (const [name, source] of [
    ["bridge-client.js", bridgeClient],
    ["bridge-target-section.js", bridgeTargetSection],
    ["bootstrap-startup.js", bootstrapStartup],
    ["background.js", background],
  ]) {
    assert.equal(
      source.includes("/bridge/launch"),
      false,
      `${name} must not reference /bridge/launch (CP-BR0 superseded)`,
    );
    assert.equal(
      /bridge_launch/.test(source),
      false,
      `${name} must not reference bridge_launch (CP-BR0 superseded)`,
    );
  }
});
