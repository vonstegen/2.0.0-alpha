import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backgroundPath = path.resolve(__dirname, "../resonantos-side-panel-extension/src/background.js");

test("background service worker imports the raw bridge fetch helper used during rebind", async () => {
  const source = await readFile(backgroundPath, "utf8");

  assert.match(source, /import\s+\{[^}]*createRawBridgeFetch[^}]*\}\s+from\s+"\.\/lib\/bridge-client\.js"/s);
  assert.match(source, /createRawBridgeFetch\(cfg\)/);
});

test("background service worker keeps Blackboard relay extension-scoped", async () => {
  const source = await readFile(backgroundPath, "utf8");

  assert.match(source, /const BLACKBOARD_RELAY_CHANNEL\s*=\s*"resonantos\.blackboard\.relay"/);
  assert.match(source, /const BLACKBOARD_TO_PANEL_CHANNEL\s*=\s*"resonantos\.blackboard\.to_panel"/);
  assert.match(source, /Blackboard relay is restricted to ResonantOS extension pages/);
  assert.match(source, /Blackboard context return is restricted to ResonantOS extension pages/);
  assert.match(source, /chrome\.storage\.session\.set\(\{\s*blackboardRelay:/s);
  assert.match(source, /chrome\.storage\.session\.set\(\{\s*blackboardToPanel:\s*record\s*\}\)/s);
});
