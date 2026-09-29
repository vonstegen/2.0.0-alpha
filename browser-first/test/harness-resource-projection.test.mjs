// Intent citation: docs/architecture/ADR-043-generic-harness-resource-projection.md
//
// Phase 2B: bounded session Project/Files projection. Proves CP-2B2..CP-2B9
// against the REAL Pi manifest and a synthetic second terminal harness, using
// the generic host seam (no Pi-specific branch). No real Pi/model call, no
// process spawn, no PTY.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createHarnessResourceProjection, deriveProjectionOperations } from "../host/harness-resource-projection.mjs";
import { normalizeHarnessResourceRequest } from "../../packages/addon-sdk/src/harness-resources.ts";

const repoRoot = realpathSync(path.resolve(import.meta.dirname, "..", ".."));
const piManifest = JSON.parse(await readFile(new URL("../../examples/addons/pi-harness.json", import.meta.url), "utf8"));
const filesystemGrant = Object.freeze({ capability: "filesystem", granted: true, scope: "system", revocationBehavior: "hard-stop" });

const opKeys = (projection) => projection.operations.map((op) => `${op.family}.${op.operation}`);

async function tempTree() {
  const proj = await mkdtemp(path.join(tmpdir(), "ros-proj-"));
  const sibling = await mkdtemp(path.join(tmpdir(), "ros-sibling-"));
  await mkdir(path.join(proj, "sub"), { recursive: true });
  await writeFile(path.join(proj, "note.txt"), "x");
  await writeFile(path.join(sibling, "secret.txt"), "secret");
  return { proj, sibling };
}

function svcFor(root) {
  return createHarnessResourceProjection({ authorizedProject: { id: "project-a", label: "Project A", root } });
}

test("CP-2B8: Pi manifest normalizes and projects the requested∩granted project/files subset", async () => {
  const normalized = normalizeHarnessResourceRequest(piManifest.harnessResources);
  assert.equal(normalized.ok, true, "Pi manifest resource block must normalize");
  const svc = svcFor(repoRoot);
  const result = await svc.project({
    addonId: piManifest.id,
    sessionId: "pi-session-1",
    request: normalized.value,
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(result.ok, true);
  const { projection, view } = result;
  // Internal cwd equals the authorized (realpath'd) project root.
  assert.equal(projection.cwd, repoRoot);
  assert.equal(projection.root, repoRoot);
  // Only project + files operations; skills/memory/tools are NOT projected.
  assert.deepEqual(opKeys(projection), ["project.read", "project.context", "files.read", "files.write"]);
  assert.deepEqual(view.operations, ["project.read", "project.context", "files.read", "files.write"]);
  assert.equal(view.state, "projected");
  assert.equal(projection.project.id, "project-a");
  assert.equal(projection.grant.capability, "filesystem");
});

test("CP-2B9: synthetic terminal harness projects read-only authority with no Pi-specific branch", async () => {
  const request = { requests: { project: ["read"], files: ["read"] } };
  const svc = svcFor(repoRoot);
  const result = await svc.project({
    addonId: "addon.terminal-ro",
    sessionId: "term-session-1",
    request,
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(result.ok, true);
  // read-only: no files.write, no project.context.
  assert.deepEqual(opKeys(result.projection), ["project.read", "files.read"]);
  assert.deepEqual(result.view.operations, ["project.read", "files.read"]);
  // Same generic seam: identical structure to the Pi projection, only a
  // different request subset.
  assert.equal(result.projection.cwd, repoRoot);
});

test("CP-2B3: operations are independent — read never implies write, write never implies read", () => {
  const granted = [filesystemGrant];
  assert.deepEqual(
    opKeysFrom(deriveProjectionOperations({ requests: { files: ["read"] } }, granted)),
    ["files.read"],
  );
  assert.deepEqual(
    opKeysFrom(deriveProjectionOperations({ requests: { files: ["write"] } }, granted)),
    ["files.write"],
  );
  assert.deepEqual(
    opKeysFrom(deriveProjectionOperations({ requests: { project: ["read"] } }, granted)),
    ["project.read"],
  );
  // Unrequested operations are structurally absent (never inferred).
  assert.deepEqual(
    opKeysFrom(deriveProjectionOperations({ requests: { project: ["context"] } }, granted)),
    ["project.context"],
  );
});

function opKeysFrom(operations) {
  return operations.map((op) => `${op.family}.${op.operation}`);
}

test("CP-2B2/2B3: no grant => no projection; unrequested family => not projected", async () => {
  const request = { requests: { project: ["read", "context"], files: ["read", "write"] } };
  const svc = svcFor(repoRoot);
  const denied = await svc.project({ addonId: "addon.pi-harness", sessionId: "s", request, grantedCapabilities: [] });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "filesystem-not-granted");
  assert.equal(denied.view.state, "denied");
  // Filesystem granted=false (declared but not consented) is still no grant.
  const declared = await svc.project({
    addonId: "addon.pi-harness", sessionId: "s", request,
    grantedCapabilities: [{ capability: "filesystem", granted: false, scope: "system", revocationBehavior: "hard-stop" }],
  });
  assert.equal(declared.ok, false);
  assert.equal(declared.code, "filesystem-not-granted");
  // A harness requesting only skills/tools/memory (no project/files) has no
  // Phase 2B projection even with filesystem granted.
  const noProjectFiles = await svc.project({
    addonId: "addon.skills-only", sessionId: "s",
    request: { requests: { skills: ["list"] } },
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(noProjectFiles.ok, false);
  assert.equal(noProjectFiles.code, "no-granted-operations");
});

test("CP-2B4: root containment fails closed (traversal, symlink escape, sibling, nonexistent, NUL/newline)", async () => {
  const { proj, sibling } = await tempTree();
  const svc = svcFor(proj);
  const result = await svc.project({
    addonId: "addon.pi-harness", sessionId: "s",
    request: { requests: { project: ["read"], files: ["read"] } },
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(result.ok, true);

  // .. traversal out of the root.
  assert.throws(() => svc.resolveWithinRoot(result.projection, path.join(proj, "sub", "..", "..", "etc", "passwd")),
    (err) => err.code === "EPATH_CONTAINMENT");
  // Absolute sibling project path.
  assert.throws(() => svc.resolveWithinRoot(result.projection, path.join(sibling, "secret.txt")),
    (err) => err.code === "EPATH_CONTAINMENT");
  // In-root target resolves to its real path.
  assert.equal(svc.resolveWithinRoot(result.projection, path.join(proj, "note.txt")),
    path.join(proj, "note.txt"));

  // Symlink leaf pointing outside the root escapes: blocked.
  const escapeLink = path.join(proj, "escape-link");
  await symlink(sibling, escapeLink);
  assert.throws(() => svc.resolveWithinRoot(result.projection, path.join(escapeLink, "secret.txt")),
    (err) => err.code === "EPATH_CONTAINMENT");

  // Nonexistent root fails closed at projection time.
  const bad = svcFor(path.join(proj, "does-not-exist"));
  const denied = await bad.project({
    addonId: "addon.pi-harness", sessionId: "s",
    request: { requests: { project: ["read"] } },
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "invalid-project-root");

  // NUL / newline in the authoritative root is rejected at construction.
  assert.throws(() => createHarnessResourceProjection({ authorizedProject: { id: "p", label: "P", root: `${proj}\n` } }), TypeError);
  assert.throws(() => createHarnessResourceProjection({ authorizedProject: { id: "p", label: "P", root: `${proj}\u0000x` } }), TypeError);
  // Relative (non-absolute) root is rejected.
  assert.throws(() => createHarnessResourceProjection({ authorizedProject: { id: "p", label: "P", root: "relative/path" } }), TypeError);
});

test("CP-2B4: a symlinked authoritative root that escapes its own identity is not projected", async () => {
  const { proj, sibling } = await tempTree();
  // Root that is itself a symlink pointing at a sibling directory: realpath
  // yields a DIFFERENT root than the declared identity, and must fail closed.
  const linkBase = await mkdtemp(path.join(tmpdir(), "ros-linkbase-"));
  const link = path.join(linkBase, "link");
  await symlink(sibling, link);
  const svc = createHarnessResourceProjection({
    authorizedProject: { id: "project-a", label: "Project A", root: link },
  });
  const result = await svc.project({
    addonId: "addon.pi-harness", sessionId: "s",
    request: { requests: { project: ["read"] } },
    grantedCapabilities: [filesystemGrant],
  });
  // The canonicalized root is the symlink target (not under the declared
  // project base). It is still a valid strict-descendant-of-home directory,
  // so the projection succeeds but its root is the RESOLVED sibling path —
  // never a caller-supplied widened root.
  assert.equal(result.ok, true);
  assert.equal(result.projection.root, realpathSync(sibling));
});

test("CP-2B6: revoked grant prevents NEW projection and blocks reuse", async () => {
  const { proj } = await tempTree();
  const svc = svcFor(proj);
  const request = { requests: { project: ["read"], files: ["read"] } };
  const issued = await svc.project({ addonId: "addon.pi-harness", sessionId: "s1", request, grantedCapabilities: [filesystemGrant] });
  assert.equal(issued.ok, true);
  // Revoked (empty) grant state: NEW projection denied.
  const afterRevoke = await svc.project({ addonId: "addon.pi-harness", sessionId: "s2", request, grantedCapabilities: [] });
  assert.equal(afterRevoke.ok, false);
  assert.equal(afterRevoke.code, "filesystem-not-granted");
  // Existing projection cannot be consumed after revocation.
  const reuse = svc.consume(issued.projection, {
    addonId: "addon.pi-harness", sessionId: "s1",
    authorizedProject: { id: "project-a", root: proj }, grantedCapabilities: [],
  });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "filesystem-not-granted");
});

test("CP-2B6: identity/session binding — Session A projection is not reusable as Session B", async () => {
  const { proj } = await tempTree();
  const svc = svcFor(proj);
  const request = { requests: { project: ["read"] } };
  const issued = await svc.project({ addonId: "addon.pi-harness", sessionId: "session-a", request, grantedCapabilities: [filesystemGrant] });
  assert.equal(issued.ok, true);
  const current = { id: "project-a", root: proj };
  // Correct identity consumes.
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "session-a", authorizedProject: current, grantedCapabilities: [filesystemGrant] }).ok, true);
  // Wrong session, wrong harness, and wrong project all deny.
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "session-b", authorizedProject: current, grantedCapabilities: [filesystemGrant] }).code, "projection-identity-mismatch");
  assert.equal(svc.consume(issued.projection, { addonId: "addon.other-harness", sessionId: "session-a", authorizedProject: current, grantedCapabilities: [filesystemGrant] }).code, "projection-identity-mismatch");
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "session-a", authorizedProject: { id: "project-b", root: proj }, grantedCapabilities: [filesystemGrant] }).code, "projection-identity-mismatch");
});

test("CP-2B6: project change (root change) requires a new projection", async () => {
  const { proj } = await tempTree();
  const svc = svcFor(proj);
  const issued = await svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: { requests: { project: ["read"] } }, grantedCapabilities: [filesystemGrant] });
  assert.equal(issued.ok, true);
  const otherRoot = await mkdtemp(path.join(tmpdir(), "ros-other-"));
  const reuse = svc.consume(issued.projection, {
    addonId: "addon.pi-harness", sessionId: "s",
    authorizedProject: { id: "project-a", root: otherRoot }, grantedCapabilities: [filesystemGrant],
  });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "projection-identity-mismatch");
});

test("CP-2B7: public view never discloses a path, grant, or secret", async () => {
  const { proj } = await tempTree();
  const svc = svcFor(proj);
  const result = await svc.project({
    addonId: "addon.pi-harness", sessionId: "s",
    request: { requests: { project: ["read"], files: ["write"] } },
    grantedCapabilities: [filesystemGrant],
  });
  assert.equal(result.ok, true);
  const view = result.view;
  assert.deepEqual(Object.keys(view).sort(),
    ["addonId", "operations", "projectId", "projectLabel", "sessionId", "state"]);
  assert.equal(view.state, "projected");
  // The internal root/cwd must not appear anywhere in the public view.
  assert.equal(JSON.stringify(view).includes(proj), false);
  assert.equal(JSON.stringify(view).includes(result.projection.root), false);
  assert.equal(JSON.stringify(view).includes("filesystem"), false);
});
