// Intent citation: docs/architecture/ADR-044-generic-harness-skills-projection.md
//
// Phase 2C.2 — Skills Staging Audit Corrections. Adversarial suite A–V.
// Proves the corrected staging identity (opaque digest), exact structural
// ownership (never substring/prefix), protected-root policy (no blanket /home
// rejection), projection-owned cleanup chain, and materialization ownership.
//
// Destructive-safety rule: any recursive rm operates ONLY on temp-owned
// directories; protected-root and path-confusion cases exercise pure
// validation/deny logic and never touch real filesystem locations.

import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createHarnessSkillsProjection,
  buildSkillCatalogFromManifests,
  normalizeSkillCatalog,
  deriveStagingIdentity,
  isProtectedStagingRoot,
  decideStagingOwnership,
} from "../host/harness-skills-projection.mjs";

const repoRoot = realpathSync(path.resolve(import.meta.dirname, "..", ".."));
const opencodeManifest = JSON.parse(await readFile(new URL("../../public/addons/opencode.json", import.meta.url), "utf8"));
const browserManifest = JSON.parse(await readFile(new URL("../../public/addons/browser.json", import.meta.url), "utf8"));

const grant = (capability) => ({ capability, granted: true, scope: "system", revocationBehavior: "hard-stop" });
const agentRuntimeGrant = Object.freeze(grant("agent-runtime"));
const opencodeEligibleGrants = () => ["agent-runtime", "filesystem", "shell", "providers", "archive-read"].map(grant);

const realCatalog = buildSkillCatalogFromManifests([opencodeManifest, browserManifest], { sourceRoot: repoRoot });
const skillsReadRequest = () => ({ requests: { skills: ["list", "read"] } });

const HEX = /^[0-9a-f]{64}$/;
const ownedRoot = (stagingBase, addonId, sessionId, projectId) =>
  path.join(stagingBase, "skills", deriveStagingIdentity(addonId, sessionId, projectId));

function svcFor({ stagingBase, skillSourceRoot = repoRoot, projectRoot = null, catalog = realCatalog, projectId = "project-a" } = {}) {
  return createHarnessSkillsProjection({
    authorizedProject: { id: projectId, label: "Project A" },
    skillCatalog: catalog,
    skillSourceRoot,
    stagingBase,
    projectRoot,
  });
}

const cleanupContext = (overrides = {}) => ({
  addonId: "addon.pi-harness",
  sessionId: "s",
  authorizedProject: { id: "project-a", label: "Project A" },
  grantedCapabilities: opencodeEligibleGrants(),
  skillCatalog: realCatalog,
  ...overrides,
});

// ============================================================================
// A/B/C/D/E — opaque staging identity is inert to path-confusing session values
// ============================================================================

test("A: raw sessionId \"../../../x\" cannot affect staging location", () => {
  const id = deriveStagingIdentity("addon.pi-harness", "../../../x", "project-a");
  assert.match(id, HEX, "identity must be fixed lowercase hex");
  assert.ok(!id.includes("/") && !id.includes(".."), "identity must contain no path separators or traversal");
  assert.ok(!id.includes(".."), "no traversal");
});

test("B: raw absolute-like sessionId cannot affect staging location", () => {
  const id = deriveStagingIdentity("addon.pi-harness", "/etc/passwd", "project-a");
  assert.match(id, HEX);
  assert.ok(!id.includes("/"), "no slash in the opaque id");
});

test("C: slash/dot/unicode/path-confusing session values map only to opaque id", () => {
  const confusing = ["a/b", "..", "../..", "..\\..", ".", "技能", "s p", "s-p", "\u0000", "s\nx"];
  for (const raw of confusing) {
    const id = deriveStagingIdentity("addon.pi-harness", raw, "project-a");
    assert.match(id, HEX, `raw session ${JSON.stringify(raw)} must map to opaque hex`);
    assert.ok(!id.includes("/") && !id.includes("\\") && !id.includes(".."), "opaque id is path-safe");
    assert.equal(id.includes(raw), false, "raw value must never appear in the id");
  }
});

test("D: different addon/session/project bindings produce different staging identities", () => {
  const base = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
  assert.notEqual(deriveStagingIdentity("addon.other", "s", "project-a"), base, "addonId change");
  assert.notEqual(deriveStagingIdentity("addon.pi-harness", "s2", "project-a"), base, "sessionId change");
  assert.notEqual(deriveStagingIdentity("addon.pi-harness", "s", "project-b"), base, "projectId change");
});

test("E: same binding deterministically produces same staging identity for lifecycle", () => {
  const a = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
  const b = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
  assert.equal(a, b);
});

// ============================================================================
// F — exact structural ownership, never substring/prefix
// ============================================================================

test("F: ownership uses exact expected path, never substring/prefix", () => {
  const stagingBase = "/host/state/staging";
  const identity = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
  const exact = path.join(stagingBase, "skills", identity);

  // Exact owned path passes.
  const pass = decideStagingOwnership(exact, {
    stagingBase, skillSourceRoot: "/src", addonId: "addon.pi-harness", sessionId: "s", projectId: "project-a",
  });
  assert.equal(pass.ok, true);

  // A prefix of the identity (substring, not exact) is rejected.
  const prefix = path.join(stagingBase, "skills", identity.slice(0, 10));
  const prefixDecision = decideStagingOwnership(prefix, {
    stagingBase, skillSourceRoot: "/src", addonId: "addon.pi-harness", sessionId: "s", projectId: "project-a",
  });
  assert.equal(prefixDecision.ok, false);
  assert.equal(prefixDecision.code, "not-owned-staging");

  // An extension sharing the identity as a substring is rejected.
  const extended = path.join(stagingBase, "skills", `${identity}extra`);
  const extendedDecision = decideStagingOwnership(extended, {
    stagingBase, skillSourceRoot: "/src", addonId: "addon.pi-harness", sessionId: "s", projectId: "project-a",
  });
  assert.equal(extendedDecision.ok, false);
  assert.equal(extendedDecision.code, "not-owned-staging");
});

// ============================================================================
// G/H/I/J/K — protected roots rejected (exact equality, pure deny logic)
// ============================================================================

test("G: stagingBase itself cannot be cleaned", () => {
  const stagingBase = "/host/state/staging";
  assert.equal(isProtectedStagingRoot(stagingBase, { stagingBase, skillSourceRoot: "/src", projectRoot: "/proj" }), true);
  const d = decideStagingOwnership(stagingBase, { stagingBase, skillSourceRoot: "/src", addonId: "a", sessionId: "s", projectId: "p" });
  assert.equal(d.ok, false);
  assert.equal(d.code, "protected-root");
});

test("H: filesystem root cannot be cleaned", () => {
  assert.equal(isProtectedStagingRoot("/", { stagingBase: "/host/state/staging", skillSourceRoot: "/src" }), true);
});

test("I: actual home root cannot be cleaned", () => {
  assert.equal(isProtectedStagingRoot(process.env.HOME, { stagingBase: "/host/state/staging", skillSourceRoot: "/src" }), true);
});

test("J: project root cannot be cleaned", () => {
  const projectRoot = "/host/project";
  assert.equal(isProtectedStagingRoot(projectRoot, { stagingBase: "/host/state/staging", skillSourceRoot: "/src", projectRoot }), true);
});

test("K: skill source root cannot be cleaned", () => {
  const skillSourceRoot = "/host/skills/src";
  assert.equal(isProtectedStagingRoot(skillSourceRoot, { stagingBase: "/host/state/staging", skillSourceRoot }), true);
});

// ============================================================================
// L/M/N — cross-session/harness/project cleanup denied
// ============================================================================

test("L: Session A cannot clean Session B", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-l-"));
  try {
    const svc = svcFor({ stagingBase });
    const a = svc.project({ addonId: "addon.pi-harness", sessionId: "session-a", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    const b = svc.project({ addonId: "addon.pi-harness", sessionId: "session-b", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    await svc.materialize(a.projection, "opencode-coding-handoff");
    await svc.materialize(b.projection, "opencode-coding-handoff");
    const res = await svc.cleanup(b.projection, cleanupContext({ sessionId: "session-a" }));
    assert.equal(res.ok, false);
    assert.equal(res.code, "identity-mismatch");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("M: Harness A cannot clean Harness B", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-m-"));
  try {
    const svc = svcFor({ stagingBase });
    const a = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(a.ok, true);
    await svc.materialize(a.projection, "opencode-coding-handoff");
    const res = await svc.cleanup(a.projection, cleanupContext({ addonId: "addon.other-harness" }));
    assert.equal(res.ok, false);
    assert.equal(res.code, "identity-mismatch");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("N: Project A cannot clean Project B", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-n-"));
  try {
    const svc = svcFor({ stagingBase, projectId: "project-a" });
    const a = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(a.ok, true);
    await svc.materialize(a.projection, "opencode-coding-handoff");
    const res = await svc.cleanup(a.projection, cleanupContext({ authorizedProject: { id: "project-b", label: "Project B" } }));
    assert.equal(res.ok, false);
    assert.equal(res.code, "identity-mismatch");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

// ============================================================================
// O — symlink redirect outside owned staging root denied
// ============================================================================

test("O: symlink redirect outside owned staging root denied", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-o-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ros-audit-o-out-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(result.ok, true);
    // Make the owned root itself a symlink pointing outside.
    const root = ownedRoot(stagingBase, "addon.pi-harness", "s", "project-a");
    await mkdir(path.dirname(root), { recursive: true });
    await writeFile(path.join(outside, "victim.md"), "do not delete");
    await symlink(outside, root);
    const res = await svc.cleanup(result.projection, cleanupContext());
    assert.equal(res.ok, false);
    assert.equal(res.code, "symlink-escape");
    // The outside tree is untouched.
    assert.equal(await readFile(path.join(outside, "victim.md"), "utf8"), "do not delete");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

// ============================================================================
// P — legitimate host staging under /home/<user>/... is allowed
// ============================================================================

test("P: legitimate host staging under /home/<user>/... is allowed", () => {
  const home = process.env.HOME;
  const stagingBase = path.join(home, ".ros", "state", "staging");
  const identity = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
  const owned = path.join(stagingBase, "skills", identity);
  // The home root itself IS a protected root...
  assert.equal(isProtectedStagingRoot(home, { stagingBase, skillSourceRoot: "/src", projectRoot: "/proj" }), true);
  // ...and the staging base itself IS a protected root...
  assert.equal(isProtectedStagingRoot(stagingBase, { stagingBase, skillSourceRoot: "/src", projectRoot: "/proj" }), true);
  // ...but a legitimate owned staging tree under /home/<user>/... is NOT
  // blanket-rejected (no /home prefix rejection), only exact-equality protected.
  assert.equal(isProtectedStagingRoot(owned, { stagingBase, skillSourceRoot: "/src", projectRoot: "/proj" }), false);
  // Pure validation allows the structurally-contained owned tree under /home/<user>.
  const decision = decideStagingOwnership(owned, {
    stagingBase, skillSourceRoot: "/src", projectRoot: "/proj",
    addonId: "addon.pi-harness", sessionId: "s", projectId: "project-a",
  });
  assert.equal(decision.ok, true);
});

// ============================================================================
// Q/R/S/T — own cleanup, idempotency, exact destination, no caller override
// ============================================================================

test("Q: own staging cleanup PASS", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-q-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    await svc.materialize(result.projection, "opencode-coding-handoff");
    const res = await svc.cleanup(result.projection, cleanupContext());
    assert.equal(res.ok, true);
    const exists = await stat(ownedRoot(stagingBase, "addon.pi-harness", "s", "project-a")).then(() => true).catch(() => false);
    assert.equal(exists, false, "owned staging root removed");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("R: repeated own cleanup PASS (idempotent)", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-r-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    await svc.materialize(result.projection, "opencode-coding-handoff");
    assert.equal((await svc.cleanup(result.projection, cleanupContext())).ok, true);
    assert.equal((await svc.cleanup(result.projection, cleanupContext())).ok, true);
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("S: materialization destination is inside exact own staging root", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-s-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    const mat = await svc.materialize(result.projection, "opencode-coding-handoff");
    assert.equal(mat.ok, true);
    const root = ownedRoot(stagingBase, "addon.pi-harness", "s", "project-a");
    assert.ok(mat.stagedPath.startsWith(root + path.sep), "destination is strictly inside the exact owned staging root");
    assert.equal(mat.stagingRoot, root);
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("T: caller cannot override layout/staging/cleanup path", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-t-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    // Attempt to inject a malicious context (stagingRoot + layout) — ignored.
    const mat = await svc.materialize(result.projection, "opencode-coding-handoff", {
      stagingRoot: "/tmp/evil", layout: { dir: "/etc", file: "evil" },
    });
    assert.equal(mat.ok, true);
    const root = ownedRoot(stagingBase, "addon.pi-harness", "s", "project-a");
    assert.equal(mat.stagingRoot, root, "staging root is host-derived, not caller input");
    assert.equal(mat.stagedPath, path.join(root, ".pi", "skills", "opencode-coding-handoff", "SKILL.md"), "layout is host-injected, not caller input");
    // cleanup has no path parameter; a projection/context only (structural).
    assert.equal(svc.cleanup.length, 2, "cleanup(projection, currentContext) accepts no path");
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

// ============================================================================
// U/V — public view secrecy and canonical source immutability
// ============================================================================

test("U: public view exposes no staging identity/path/source/grants/secrets", async () => {
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-u-"));
  try {
    const svc = svcFor({ stagingBase });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(result.view);
    const identity = deriveStagingIdentity("addon.pi-harness", "s", "project-a");
    assert.equal(serialized.includes(identity), false, "no staging identity in public view");
    assert.equal(serialized.includes(stagingBase), false, "no staging base in public view");
    assert.equal(serialized.includes(repoRoot), false, "no source root in public view");
    assert.equal(serialized.includes("source"), false, "no source field in public view");
    assert.equal(serialized.includes("grant"), false, "no grant in public view");
    assert.equal("source" in result.view, false);
    assert.equal("listGrant" in result.view, false);
    assert.equal("request" in result.view, false);
  } finally {
    await rm(stagingBase, { recursive: true, force: true });
  }
});

test("V: canonical skill source unchanged", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "ros-audit-v-src-"));
  const stagingBase = await mkdtemp(path.join(tmpdir(), "ros-audit-v-stage-"));
  try {
    const canonicalPath = path.join(sourceRoot, "canonical-skill.md");
    await writeFile(canonicalPath, "# Canonical\n\nBody stays identical.\n");
    const catalog = normalizeSkillCatalog([{
      id: "canonical-skill", name: "canonical-skill", label: "Canonical", description: "c", version: "1",
      source: canonicalPath, requiredCapabilities: [],
    }]);
    const svc = svcFor({ stagingBase, skillSourceRoot: sourceRoot, catalog: catalog.records });
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
    assert.equal(result.ok, true);
    const before = await readFile(canonicalPath, "utf8");
    assert.equal((await svc.materialize(result.projection, "canonical-skill")).ok, true);
    assert.equal(await readFile(canonicalPath, "utf8"), before);
    await svc.cleanup(result.projection, {
      addonId: "addon.pi-harness", sessionId: "s",
      authorizedProject: { id: "project-a", label: "Project A" },
      grantedCapabilities: [agentRuntimeGrant], skillCatalog: catalog.records,
    });
    assert.equal(await readFile(canonicalPath, "utf8"), before, "cleanup must not touch canonical source");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(stagingBase, { recursive: true, force: true });
  }
});
