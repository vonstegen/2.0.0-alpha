import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverBundledAddonManifests,
  modeForManifest,
  trustLabelFor,
} from "../host/addon-delegation-service.mjs";

// Helper: build a temp repo with examples/addons/ and/or public/addons/
// populated with the given manifests, then run discovery against it.
async function withTempRepo(layout, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "addon-discovery-"));
  try {
    for (const [relDir, files] of Object.entries(layout)) {
      const absDir = path.join(root, relDir);
      await mkdir(absDir, { recursive: true });
      for (const [name, body] of Object.entries(files ?? {})) {
        await writeFile(path.join(absDir, name), JSON.stringify(body));
      }
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const baseManifest = {
  name: "Test Addon",
  version: "0.1.0",
  author: "tester",
  category: "tool",
  sdkVersion: "0.1.0",
  description: "test addon manifest for discovery",
  runtimeType: "agent-addon",
  surfaces: [],
  requestedCapabilities: [{ capability: "providers", scope: "self", justification: "test" }],
  providerRequirements: { sharedProfiles: [], allowExperimentalAuth: false },
  archiveIntegration: { readMode: "none", writeMode: "none" },
  health: { command: "test.status", intervalSeconds: 60 },
  installHooks: { preInstall: [], postInstall: [], preUninstall: [], postUninstall: [] },
  compatibility: { minShellVersion: "2.0.0", blockedShells: [] },
};

test("discoverBundledAddonManifests returns manifests from examples/addons/", async () => {
  await withTempRepo({
    "examples/addons": {
      "addon.alpha.json": { ...baseManifest, id: "addon.alpha" },
    },
  }, async (root) => {
    const list = await discoverBundledAddonManifests(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "addon.alpha");
    assert.equal(list[0].source, "examples/addons");
  });
});

test("discoverBundledAddonManifests deduplicates by id across directories", async () => {
  await withTempRepo({
    "examples/addons": {
      "addon.alpha.json": { ...baseManifest, id: "addon.alpha", name: "From Examples" },
    },
    "public/addons": {
      "addon.alpha.json": { ...baseManifest, id: "addon.alpha", name: "From Public" },
    },
  }, async (root) => {
    const list = await discoverBundledAddonManifests(root);
    assert.equal(list.length, 1, "expected one merged entry");
    assert.equal(list[0].manifest.name, "From Public", "later dir wins");
    assert.equal(list[0].source, "public/addons");
  });
});

test("discoverBundledAddonManifests skips unparseable JSON without throwing", async () => {
  await withTempRepo({
    "examples/addons": {
      "addon.broken.json": "{ this is not valid json",
      "addon.good.json": { ...baseManifest, id: "addon.good" },
    },
  }, async (root) => {
    const list = await discoverBundledAddonManifests(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "addon.good");
  });
});

test("discoverBundledAddonManifests returns empty when no addon dirs exist", async () => {
  await withTempRepo({}, async (root) => {
    const list = await discoverBundledAddonManifests(root);
    assert.deepEqual(list, []);
  });
});

test("discoverBundledAddonManifests skips manifests without an id field", async () => {
  await withTempRepo({
    "examples/addons": {
      "addon.no-id.json": { ...baseManifest }, // no id
      "addon.with-id.json": { ...baseManifest, id: "addon.with-id" },
    },
  }, async (root) => {
    const list = await discoverBundledAddonManifests(root);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "addon.with-id");
  });
});

test("modeForManifest maps runtimeType + category to the historical mode strings", () => {
  assert.equal(modeForManifest({ runtimeType: "agent-addon" }), "delegation-addon");
  assert.equal(modeForManifest({ runtimeType: "embedded-module" }), "coding-addon");
  assert.equal(modeForManifest({ runtimeType: "local-service", category: "memory" }), "memory-system");
  assert.equal(modeForManifest({ runtimeType: "local-service", category: "tool" }), "draft-only-communication-addon");
  assert.equal(
    modeForManifest({ runtimeType: "local-service", systemSlots: [{ id: "memory-system" }] }),
    "memory-system",
  );
  assert.equal(modeForManifest({ runtimeType: "ui-module" }), "unknown");
});

test("trustLabelFor returns the historical labels so the UI tone mapping keeps working", () => {
  assert.equal(trustLabelFor({ runtimeType: "agent-addon" }), "add-on agent");
  assert.equal(
    trustLabelFor({ runtimeType: "local-service", category: "memory" }),
    "host-mediated memory provider",
  );
  assert.equal(trustLabelFor({ runtimeType: "local-service" }), "host-mediated service");
  assert.equal(trustLabelFor({ runtimeType: "embedded-module" }), "host-mediated service");
});