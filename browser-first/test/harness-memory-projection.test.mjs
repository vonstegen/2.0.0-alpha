// CP-M1: harness memory projection contract + builder.
//
// Hard rules:
//   - Memory is projected as a file path, never as inline content.
//   - The context file is 0600, session-bound, under a reviewed staging
//     root, and is deleted on cleanup.
//   - `archiveReadMode: "none"` -> no file, `path: null`.
//   - `archiveReadMode: "read-only-context"` -> 0600 file exists with a
//     subset of approved domains only.
//   - `archiveReadMode: "retrieval-with-citations"` -> `path: null` with
//     a non-secret `notImplemented` marker (deferred endpoint).
//   - The returned projection object carries ONLY public identifiers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp as _unusedMkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildHarnessMemoryProjection,
  cleanupHarnessMemoryProjection,
  defaultApprovedMemoryDomains,
  deriveMemoryProjectionMode,
  deriveMemoryStagingIdentity,
  MEMORY_DIR_NAME,
} from "../host/harness-memory-projection.mjs";
import { memoryDomainRoots } from "../host/memory-schema.mjs";

const RE_ID = /^[a-zA-Z0-9-]+$/;
const RE_HEX_32 = /^[a-f0-9]{32}$/;

describe("deriveMemoryProjectionMode (pure)", () => {
  it("maps 'none' to 'none'", () => {
    assert.equal(deriveMemoryProjectionMode({ archiveReadMode: "none" }), "none");
  });
  it("maps 'read-only-context' to 'context'", () => {
    assert.equal(deriveMemoryProjectionMode({ archiveReadMode: "read-only-context" }), "context");
  });
  it("maps 'retrieval-with-citations' to 'retrieval'", () => {
    assert.equal(deriveMemoryProjectionMode({ archiveReadMode: "retrieval-with-citations" }), "retrieval");
  });
  it("returns 'none' on a missing or non-object memoryAccess", () => {
    assert.equal(deriveMemoryProjectionMode(null), "none");
    assert.equal(deriveMemoryProjectionMode(undefined), "none");
    assert.equal(deriveMemoryProjectionMode("read-only-context"), "none");
    assert.equal(deriveMemoryProjectionMode({}), "none");
    assert.equal(deriveMemoryProjectionMode({ archiveReadMode: "bogus" }), "none");
  });
});

describe("deriveMemoryStagingIdentity (pure)", () => {
  it("is a 32-char hex string", () => {
    const id = deriveMemoryStagingIdentity("addon.x", "s-1");
    assert.match(id, RE_HEX_32);
  });
  it("is deterministic for the same (addon, session) pair", () => {
    const a = deriveMemoryStagingIdentity("addon.x", "s-1");
    const b = deriveMemoryStagingIdentity("addon.x", "s-1");
    assert.equal(a, b);
  });
  it("differs when addon or session differs", () => {
    const a = deriveMemoryStagingIdentity("addon.x", "s-1");
    const b = deriveMemoryStagingIdentity("addon.x", "s-2");
    const c = deriveMemoryStagingIdentity("addon.y", "s-1");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});

describe("defaultApprovedMemoryDomains", () => {
  it("is a subset of memoryDomainRoots", () => {
    const allowed = defaultApprovedMemoryDomains();
    for (const d of allowed) {
      assert.ok(memoryDomainRoots.includes(d), `${d} must be in memoryDomainRoots`);
    }
  });
  it("excludes raw / private / host-internal domains", () => {
    const allowed = defaultApprovedMemoryDomains();
    for (const forbidden of ["INTAKE/browser", "CONFIG", "LOGS", "MANIFESTS", "HUMAN_KNOWLEDGE"]) {
      assert.ok(!allowed.includes(forbidden), `${forbidden} must NOT be in the read-only default allowlist`);
    }
  });
});

describe("buildHarnessMemoryProjection", () => {
  it("archiveReadMode 'none' -> no file, path:null, empty domains", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-none",
        memoryAccess: { archiveReadMode: "none" },
        memoryRoot: stagingBase,
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.equal(projection.archiveReadMode, "none");
      assert.equal(projection.path, null);
      assert.deepEqual([...projection.domains], []);
      assert.equal(projection.sessionId, "s-none");
      assert.match(projection.projectionId, RE_HEX_32);
      assert.equal(projection.notImplemented, undefined);
      // Staging base directory is untouched.
      const entries = await readdirEmpty(stagingBase);
      assert.deepEqual(entries, []);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("missing memoryAccess defaults to 'none'", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-missing",
        memoryAccess: undefined,
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.equal(projection.archiveReadMode, "none");
      assert.equal(projection.path, null);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("'retrieval-with-citations' -> path:null + non-secret notImplemented marker", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-ret",
        memoryAccess: { archiveReadMode: "retrieval-with-citations" },
        memoryRoot: stagingBase,
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.equal(projection.archiveReadMode, "retrieval-with-citations");
      assert.equal(projection.path, null);
      assert.deepEqual([...projection.domains], []);
      assert.equal(projection.notImplemented, "retrieval-with-citations");
      // No file written.
      const entries = await readdirEmpty(stagingBase);
      assert.deepEqual(entries, []);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("'read-only-context' -> 0600 file exists under staging/memory-context/<id>/context.md", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-mr-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-ctx",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.equal(projection.archiveReadMode, "read-only-context");
      assert.ok(projection.path, "projection.path is set");
      // Path is under stagingBase/memory-context/<projectionId>/context.md
      assert.ok(projection.path.startsWith(`${stagingBase}/${MEMORY_DIR_NAME}/`));
      assert.ok(projection.path.endsWith("/context.md"));
      assert.ok(projection.path.includes(projection.projectionId));
      // File exists.
      const s = await stat(projection.path);
      assert.ok(s.isFile());
      // 0600 file mode (when the platform supports it).
      const mode = s.mode & 0o777;
      assert.equal(mode, 0o600, `file mode is ${mode.toString(8)} (expected 0600)`);
      // Body is a manifest, NOT memory content.
      const body = await readFile(projection.path, "utf8");
      assert.match(body, /# ROS_MEMORY_CONTEXT/);
      assert.match(body, /sessionId: s-ctx/);
      assert.match(body, /projectionId: /);
      assert.match(body, /memoryRoot: /);
      assert.match(body, /archiveReadMode: read-only-context/);
      // Domain list.
      for (const d of projection.domains) {
        assert.match(body, new RegExp(`- ${d.replace(/\//g, "\\/")}`));
      }
      // Body must not contain INTAKE / CONFIG / LOGS / private secrets.
      assert.ok(!/INTAKE\/browser/.test(body), "INTAKE/browser must not be listed");
      assert.ok(!/CONFIG/.test(body), "CONFIG must not be listed");
      assert.ok(!/sk-/.test(body), "no API-key shape in body");
      assert.ok(!/API_KEY=/.test(body), "no credential assignment in body");
      // exp is monotonic: issuedAt <= expiresAt.
      const issued = new Date(/issuedAt: (.+)/.exec(body)[1]);
      const exp = new Date(/expiresAt: (.+)/.exec(body)[1]);
      assert.ok(exp.getTime() >= issued.getTime());
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("only approved domains appear; caller-supplied domain never leaks when not approved", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-mr-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-allowlist",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
        approvedDomains: ["AI_MEMORY/wiki", "INTAKE/browser"], // INTAKE is NOT in defaults
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.deepEqual([...projection.domains], ["AI_MEMORY/wiki"]);
      const body = await readFile(projection.path, "utf8");
      assert.match(body, /- AI_MEMORY\/wiki/);
      assert.ok(!/INTAKE\/browser/.test(body), "INTAKE/browser must be filtered out");
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("an empty caller-supplied allowlist falls back to the host default", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-mr-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-fb",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
        approvedDomains: [],
        stagingBase,
      });
      assert.equal(rejection, null);
      assert.deepEqual([...projection.domains], [...defaultApprovedMemoryDomains()]);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("rejects (fail closed) when memoryRoot is missing for read-only-context", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-noroot",
        memoryAccess: { archiveReadMode: "read-only-context" },
        stagingBase,
      });
      assert.equal(projection, null);
      assert.equal(rejection.code, "memory-root-missing");
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("rejects (fail closed) when stagingBase is missing for read-only-context", async () => {
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-mr-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-nostage",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
      });
      assert.equal(projection, null);
      assert.equal(rejection.code, "memory-staging-base-missing");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("rejects (fail closed) when memoryRoot does not exist on disk", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-badroot",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot: join(stagingBase, "does-not-exist"),
        stagingBase,
      });
      assert.equal(projection, null);
      assert.equal(rejection.code, "memory-root-invalid");
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("returns a non-secret shape (no content / credential / token in the projection object)", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-"));
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-mr-"));
    try {
      const { projection, rejection } = await buildHarnessMemoryProjection({
        sessionId: "s-secret",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
        stagingBase,
      });
      assert.equal(rejection, null);
      const obj = projection;
      // String fields: only public identifiers.
      assert.match(obj.projectionId, RE_HEX_32);
      assert.match(obj.sessionId, RE_ID);
      assert.match(obj.archiveReadMode, /^(none|read-only-context|retrieval-with-citations)$/);
      assert.equal(typeof obj.expiresAt, "string");
      // path is an absolute path under staging base — it's the only file
      // the harness is allowed to read. It is non-secret but MUST NOT
      // appear in logs. It MUST be inside the staging base.
      assert.ok(obj.path.startsWith(`${stagingBase}/${MEMORY_DIR_NAME}/`));
      // Walk every string in obj and assert it contains no secret shape.
      for (const [k, v] of Object.entries(obj)) {
        if (k === "domains") continue;
        if (typeof v === "string") {
          assert.ok(!/sk-/.test(v), `field ${k} must not contain API-key shape: ${v}`);
          assert.ok(!/API_KEY=/.test(v), `field ${k} must not contain credential assignment: ${v}`);
        }
      }
      for (const d of obj.domains) {
        assert.match(d, /^[A-Z_]+(\/[a-z-]+)?$/, `domain ${d} is identifier-shaped`);
      }
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });
});

describe("cleanupHarnessMemoryProjection", () => {
  it("removes the session's memory-context tree (best-effort)", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-clean-"));
    const memoryRoot = await mkCanonicalTemp(join(tmpdir(), "mem-m1-clean-mr-"));
    try {
      const { projection } = await buildHarnessMemoryProjection({
        sessionId: "s-clean",
        memoryAccess: { archiveReadMode: "read-only-context" },
        memoryRoot,
        stagingBase,
      });
      const before = await readdirEmpty(stagingBase);
      assert.deepEqual(before, [MEMORY_DIR_NAME]);
      const removed = await cleanupHarnessMemoryProjection({ stagingBase, sessionId: "s-clean" });
      assert.equal(removed.removed, true);
      assert.ok(removed.path.endsWith(`${MEMORY_DIR_NAME}/${projection.projectionId}`));
      const after = await readdirEmpty(stagingBase);
      assert.deepEqual(after, []);
      // Idempotent: a second cleanup is also best-effort.
      const second = await cleanupHarnessMemoryProjection({ stagingBase, sessionId: "s-clean" });
      assert.equal(second.removed, false);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("is a no-op when nothing to clean (missing file)", async () => {
    const stagingBase = await mkCanonicalTemp(join(tmpdir(), "mem-m1-clean2-"));
    try {
      const removed = await cleanupHarnessMemoryProjection({ stagingBase, sessionId: "s-missing" });
      assert.equal(removed.removed, false);
    } finally {
      await rm(stagingBase, { recursive: true, force: true });
    }
  });

  it("requires both stagingBase and sessionId", async () => {
    const removed = await cleanupHarnessMemoryProjection({});
    assert.equal(removed.removed, false);
    assert.equal(removed.path, "");
  });
});

// readdirEmpty: tiny fs.mjs wrapper to drop a non-existent dir without throwing.
async function readdirEmpty(p) {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(p);
  } catch {
    return [];
  }
}

// mkCanonicalTemp: mkdtemp + realpath so the returned path matches the
// canonical form the production projection uses (symlink-aware, drops
// /var/folders -> /private/var/folders on macOS).
async function mkCanonicalTemp(prefix) {
  const p = await _unusedMkdtemp(prefix);
  return await realpath(p);
}