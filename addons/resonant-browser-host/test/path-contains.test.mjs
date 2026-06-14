// Intent citation: docs/architecture/ADR-017-resonant-browser-addon.md
// PR-R08 / finding P1-d — containment tests for pathContains + the two product
// sites (captureEvidence artifactsDir, loadUnpackedExtension directory).

import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before } from "node:test";

import { pathContains, assertContained } from "../src/lib/path-contains.mjs";
import { ResonantBrowserHost } from "../src/browser-host.mjs";
import { ResonantElectronBrowserHost, handleElectronJsonRpcLine } from "../src/electron-visible-host.mjs";

describe("pathContains primitive (P1-d)", () => {
  let root;
  let outside;

  before(async () => {
    root = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-root-")));
    outside = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-outside-")));
    await writeFile(path.join(outside, "secret.txt"), "secret");
  });

  it("passes a target equal to the root", () => {
    const v = pathContains(root, root);
    assert.equal(v.result, "pass");
  });

  it("passes an in-root target (existing and not-yet-created leaf)", () => {
    assert.equal(pathContains(root, path.join(root, "a", "b.png")).result, "pass");
    assert.equal(pathContains(root, path.join(root, "child")).result, "pass");
  });

  it("blocks a `..` chain that escapes the root", () => {
    const v = pathContains(root, path.join(root, "..", "..", "etc", "passwd"));
    assert.equal(v.result, "block");
  });

  it("blocks an absolute path outside the root", () => {
    const v = pathContains(root, path.join(outside, "secret.txt"));
    assert.equal(v.result, "block");
    assert.equal(v.evidence.escapeKind, "absolute-outside");
  });

  it("blocks a symlink leaf that points outside the root", async () => {
    const link = path.join(root, "escape-link");
    await symlink(outside, link);
    const v = pathContains(root, path.join(link, "secret.txt"));
    assert.equal(v.result, "block");
    assert.equal(v.evidence.escapeKind, "symlink-escape");
  });

  it("assertContained throws EPATH_CONTAINMENT on escape and returns the real path on pass", () => {
    assert.equal(assertContained(root, path.join(root, "ok.png"), "x"), path.join(root, "ok.png"));
    assert.throws(
      () => assertContained(root, path.join(outside, "secret.txt"), "x"),
      (err) => err.code === "EPATH_CONTAINMENT",
    );
  });
});

describe("captureEvidence artifactsDir containment (P1-d, browser-host)", () => {
  let artifactsDir;
  let outside;

  before(async () => {
    artifactsDir = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-artifacts-")));
    outside = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-art-outside-")));
  });

  function hostWithFakePage(captured) {
    const host = new ResonantBrowserHost({ headless: true });
    host.sessionId = "session-test";
    host.page = {
      async screenshot({ path: screenshotPath }) {
        captured.push(screenshotPath);
      },
    };
    return host;
  }

  it("allows an in-root artifactsDir and writes the screenshot inside it", async () => {
    const captured = [];
    const host = hostWithFakePage(captured);
    const evidence = await host.captureEvidence({ artifactsDir, reason: "ok" });
    assert.equal(captured.length, 1);
    assert.ok(captured[0].startsWith(`${artifactsDir}${path.sep}`));
    assert.ok(evidence.evidenceRef.startsWith(`${artifactsDir}${path.sep}`));
  });

  it("rejects a screenshot leaf that traverses out of the artifacts root", async () => {
    const captured = [];
    const host = hostWithFakePage(captured);
    // The screenshot leaf is composed from sessionId; a traversal in sessionId
    // would walk the written file out of the artifacts root. The guard contains
    // the resolved leaf to realpath(artifactsDir) and refuses before any write.
    host.sessionId = "../../escape";
    await assert.rejects(
      () => host.captureEvidence({ artifactsDir, reason: "escape" }),
      (err) => err.code === "EPATH_CONTAINMENT" || /escapes the allowed root/.test(err.message),
    );
    assert.equal(captured.length, 0);
  });

  it("rejects a screenshot leaf that absolute-reroots out of the artifacts root via symlink", async () => {
    const captured = [];
    const host = hostWithFakePage(captured);
    // artifactsDir is itself a symlink whose realpath is `outside`; a sessionId
    // traversal then walks the leaf out of realpath(artifactsDir).
    const linkBase = path.join(artifactsDir, "linked-base");
    await symlink(outside, linkBase).catch(() => {});
    host.sessionId = "../../escape";
    await assert.rejects(
      () => host.captureEvidence({ artifactsDir: linkBase, reason: "escape" }),
      (err) => err.code === "EPATH_CONTAINMENT" || /escapes the allowed root/.test(err.message),
    );
    assert.equal(captured.length, 0);
  });
});

describe("loadUnpackedExtension directory containment (P1-d, electron-host)", () => {
  let extensionsRoot;
  let inRootExt;
  let outsideExt;

  before(async () => {
    extensionsRoot = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-ext-root-")));
    inRootExt = path.join(extensionsRoot, "good-ext");
    await mkdir(inRootExt);
    await writeFile(path.join(inRootExt, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Good", version: "0.1.0" }));

    outsideExt = realpathSync(await mkdtemp(path.join(tmpdir(), "pc-ext-out-")));
    await writeFile(path.join(outsideExt, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Evil", version: "0.1.0" }));
  });

  function fakeElectronApi(loaded) {
    return {
      app: { whenReady: async () => undefined },
      Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => undefined },
      session: {
        defaultSession: {
          async loadExtension(loadPath) {
            loaded.push(loadPath);
            return { id: "ext-id", name: "Ext", version: "0.1.0", permissions: [] };
          },
          getAllExtensions() {
            return [];
          },
        },
      },
    };
  }

  it("allows an in-root extension directory when extensionsRoot is configured", async () => {
    const loaded = [];
    const host = new ResonantElectronBrowserHost({ electronApi: fakeElectronApi(loaded) });
    const result = await handleElectronJsonRpcLine(
      host,
      JSON.stringify({ id: "1", method: "browser.extensions.load_unpacked", params: { path: inRootExt, extensionsRoot } }),
    );
    assert.equal(result.result.extension.extensionId, "ext-id");
    assert.equal(loaded.length, 1);
    assert.equal(realpathSync(loaded[0]), realpathSync(inRootExt));
  });

  it("rejects an extension directory outside the configured extensionsRoot (absolute-outside)", async () => {
    const loaded = [];
    const host = new ResonantElectronBrowserHost({ electronApi: fakeElectronApi(loaded) });
    await assert.rejects(
      () => host.loadUnpackedExtension({ path: outsideExt, extensionsRoot }),
      (err) => err.code === "EPATH_CONTAINMENT" || /escapes the allowed root/.test(err.message),
    );
    assert.equal(loaded.length, 0);
  });

  it("rejects a `..` chain extension path against the configured root", async () => {
    const loaded = [];
    const host = new ResonantElectronBrowserHost({ electronApi: fakeElectronApi(loaded) });
    const escaping = path.join(extensionsRoot, "..", path.basename(outsideExt));
    await assert.rejects(
      () => host.loadUnpackedExtension({ path: escaping, extensionsRoot }),
      (err) => err.code === "EPATH_CONTAINMENT" || /escapes the allowed root|not a directory|ENOENT/.test(err.message),
    );
    assert.equal(loaded.length, 0);
  });

  it("rejects a symlinked extension directory that escapes the configured root", async () => {
    const loaded = [];
    const host = new ResonantElectronBrowserHost({ electronApi: fakeElectronApi(loaded) });
    const linkExt = path.join(extensionsRoot, "linked-ext");
    await symlink(outsideExt, linkExt).catch(() => {});
    await assert.rejects(
      () => host.loadUnpackedExtension({ path: linkExt, extensionsRoot }),
      (err) => err.code === "EPATH_CONTAINMENT" || /escapes the allowed root/.test(err.message),
    );
    assert.equal(loaded.length, 0);
  });

  it("still allows an extension directory with no configured root (backward compatible)", async () => {
    const loaded = [];
    const host = new ResonantElectronBrowserHost({ electronApi: fakeElectronApi(loaded) });
    const result = await host.loadUnpackedExtension({ path: inRootExt });
    assert.equal(result.extension.extensionId, "ext-id");
    assert.equal(loaded.length, 1);
  });
});
