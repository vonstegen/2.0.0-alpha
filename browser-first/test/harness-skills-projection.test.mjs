// Intent citation: docs/architecture/ADR-044-generic-harness-skills-projection.md
//
// Phase 2C: bounded session Skills projection. Proves CP-2C2..CP-2C9 against the
// REAL Pi manifest and a synthetic second harness, using the generic host seam
// (no Pi-specific branch). No real Pi/model call, no process spawn, no PTY.

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
  isSkillEligible,
  deriveSkillsOperations,
  deriveStagingIdentity,
  SKILLS_LIST_CAPABILITY,
} from "../host/harness-skills-projection.mjs";
import { normalizeHarnessResourceRequest } from "../../packages/addon-sdk/src/harness-resources.ts";

const repoRoot = realpathSync(path.resolve(import.meta.dirname, "..", ".."));
const piManifest = JSON.parse(await readFile(new URL("../../examples/addons/pi-harness.json", import.meta.url), "utf8"));
const opencodeManifest = JSON.parse(await readFile(new URL("../../public/addons/opencode.json", import.meta.url), "utf8"));
const browserManifest = JSON.parse(await readFile(new URL("../../public/addons/browser.json", import.meta.url), "utf8"));

const agentRuntimeGrant = Object.freeze({ capability: "agent-runtime", granted: true, scope: "system", revocationBehavior: "hard-stop" });
const grant = (capability) => ({ capability, granted: true, scope: "system", revocationBehavior: "hard-stop" });

const OP = (projection) => projection.operations.map((op) => `${op.family}.${op.operation}`);

// Canonical catalog derived from real reviewed add-on manifests (no second DB).
const realCatalog = buildSkillCatalogFromManifests([opencodeManifest, browserManifest], { sourceRoot: repoRoot });
const opencodeSkill = realCatalog.find((s) => s.id === "opencode-coding-handoff");
const browserSkill = realCatalog.find((s) => s.id === "browser-research-session");

function svcFor(catalog, sourceRoot = repoRoot, stagingBase = path.join(tmpdir(), "ros-skills-stage-default")) {
  return createHarnessSkillsProjection({
    authorizedProject: { id: "project-a", label: "Project A" },
    skillCatalog: catalog,
    skillSourceRoot: sourceRoot,
    stagingBase,
  });
}

// Host-derived owned staging root for a binding (mirrors the implementation).
const ownedRoot = (stagingBase, addonId, sessionId, projectId = "project-a") =>
  path.join(stagingBase, "skills", deriveStagingIdentity(addonId, sessionId, projectId));

const skillsReadRequest = () => ({ requests: { skills: ["list", "read"] } });

// Grants that make the real opencode skill eligible (all requiredCapabilities).
const opencodeEligibleGrants = () =>
  ["agent-runtime", "filesystem", "shell", "providers", "archive-read"].map(grant);

test("CP-2C1: normalizeSkillCatalog accepts the canonical derived catalog and rejects malformed records", () => {
  assert.equal(normalizeSkillCatalog(realCatalog).ok, true);
  // Path-traversal name, unknown capability, relative source, duplicate id all fail closed.
  const bad = [
    { id: "x", name: "../evil", label: "x", description: "x", version: "1", source: "/abs/x.md", requiredCapabilities: [] },
    { id: "x", name: "ok-name", label: "x", description: "x", version: "1", source: "/abs/x.md", requiredCapabilities: ["not-a-capability"] },
    { id: "x", name: "ok-name", label: "x", description: "x", version: "1", source: "relative/x.md", requiredCapabilities: [] },
    { id: "x", name: "ok-name", label: "x", description: "x", version: "1", source: "/abs/x.md", requiredCapabilities: [] },
    { id: "x", name: "ok-name", label: "x", description: "x", version: "1", source: "/abs/x.md", requiredCapabilities: [] },
  ];
  assert.equal(normalizeSkillCatalog(bad).ok, false);
});

test("CP-2C1: buildSkillCatalogFromManifests ignores manifest-supplied absolute/escaping documentPaths", () => {
  const manifest = {
    version: "1.0.0",
    skills: [
      { id: "good", name: "Good", description: "g", documentPath: "skills/good.md", requiredCapabilities: [] },
      { id: "bad-abs", name: "Bad abs", description: "b", documentPath: "/etc/passwd", requiredCapabilities: [] },
      { id: "bad-escape", name: "Bad escape", description: "b", documentPath: "../outside/secret.md", requiredCapabilities: [] },
    ],
  };
  const catalog = buildSkillCatalogFromManifests([manifest], { sourceRoot: repoRoot });
  assert.deepEqual(catalog.map((s) => s.id), ["good"]);
  assert.ok(catalog[0].source.startsWith(repoRoot + path.sep));
});

test("CP-2C5 A: no skills request -> no skills projection", () => {
  const svc = svcFor(realCatalog);
  const denied = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: { requests: { files: ["read"] } }, grantedCapabilities: [agentRuntimeGrant] });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "no-skills-request");
  assert.equal(denied.view.state, "denied");
});

test("CP-2C5 A/F: skills request without harness session authority -> denied; list does not imply read", () => {
  const svc = svcFor(realCatalog);
  const denied = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [grant("filesystem")] });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "skills-not-authorized");
});

test("CP-2C5 B: request list, authorized -> safe list metadata only", () => {
  const svc = svcFor(realCatalog);
  const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: { requests: { skills: ["list"] } }, grantedCapabilities: [agentRuntimeGrant] });
  assert.equal(result.ok, true);
  assert.deepEqual(OP(result.projection), ["skills.list"]);
  assert.deepEqual(result.view.operations, ["skills.list"]);
  assert.ok(result.view.skills.length >= 2, "catalog skills are listed");
  const serialized = JSON.stringify(result.view);
  assert.equal(serialized.includes(repoRoot), false, "no source path in public view");
  assert.equal(serialized.includes("filesystem"), false, "no capability authority in public view");
  assert.equal(serialized.includes("agent-runtime"), false, "no backing grant in public view");
  for (const skill of result.view.skills) {
    assert.deepEqual(Object.keys(skill).sort(), ["description", "id", "label", "name", "status", "version"]);
  }
});

test("CP-2C5 C: request read, authorized + eligible -> bounded materialization", async () => {
  const staging = await mkdtemp(path.join(tmpdir(), "ros-skills-stage-"));
  try {
    const svc = svcFor(realCatalog, repoRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(result.ok, true);
    assert.deepEqual(OP(result.projection), ["skills.list", "skills.read"]);
    const read = svc.readSkill(result.projection, "opencode-coding-handoff");
    assert.equal(read.ok, true);
    assert.equal(read.skill.status, "eligible");
    const materialized = await svc.materialize(result.projection, "opencode-coding-handoff");
    assert.equal(materialized.ok, true);
    assert.equal(materialized.name, "opencode-coding-handoff");
    const stagedPath = materialized.stagedPath;
    // Host-derived Pi-native destination under the opaque owned staging root.
    assert.equal(stagedPath, path.join(ownedRoot(staging, "addon.pi-harness", "s"), ".pi", "skills", "opencode-coding-handoff", "SKILL.md"));
    const content = await readFile(stagedPath, "utf8");
    assert.match(content, /^---\nname: opencode-coding-handoff\n/);
    assert.match(content, /description:/);
    const canonical = await readFile(opencodeSkill.source, "utf8");
    assert.ok(content.includes(canonical.trim().slice(0, 60)), "canonical body is preserved");
    // No executable privilege created by copying text.
    const details = await stat(stagedPath);
    assert.equal(details.mode & 0o111, 0, "staged SKILL.md must not be executable");
    assert.equal((details.mode & 0o777), 0o644);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C5 D: list-only cannot read content", async () => {
  const staging = await mkdtemp(path.join(tmpdir(), "ros-skills-listonly-"));
  try {
    const svc = svcFor(realCatalog, repoRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: { requests: { skills: ["list"] } }, grantedCapabilities: opencodeEligibleGrants() });
    assert.equal(result.ok, true);
    assert.deepEqual(OP(result.projection), ["skills.list"]);
    const read = svc.readSkill(result.projection, "opencode-coding-handoff");
    assert.equal(read.ok, false);
    assert.equal(read.code, "skills-read-not-granted");
    const materialized = await svc.materialize(result.projection, "opencode-coding-handoff");
    assert.equal(materialized.ok, false);
    assert.equal(materialized.code, "skills-read-not-granted");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C5 E: read-only does not imply unrelated capabilities", () => {
  const svc = svcFor(realCatalog);
  // Only agent-runtime granted; a skill with NO requiredCapabilities is readable.
  const noRequirement = [{ id: "plain-skill", name: "plain-skill", label: "Plain", description: "no requirements", version: "1", source: path.join(repoRoot, "docs", "architecture", "addon-skills", "opencode", "CODING_HANDOFF.md"), requiredCapabilities: [] }];
  const svc2 = svcFor(noRequirement);
  const result = svc2.project({ addonId: "addon.pi-harness", sessionId: "s", request: { requests: { skills: ["read"] } }, grantedCapabilities: [agentRuntimeGrant] });
  assert.equal(result.ok, true);
  assert.deepEqual(OP(result.projection), ["skills.read"]);
  const serialized = JSON.stringify(result.view);
  assert.equal(serialized.includes("filesystem"), false);
  assert.equal(serialized.includes("shell"), false);
  assert.equal(serialized.includes("network"), false);
  assert.equal(result.view.operations.length, 1);
  assert.equal(result.view.operations[0], "skills.read");
});

test("CP-2C5 F: unknown skill denied", () => {
  const svc = svcFor(realCatalog);
  const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(result.ok, true);
  assert.equal(svc.readSkill(result.projection, "does-not-exist").code, "unknown-skill");
});

test("CP-2C5 G: requiredCapabilities not granted -> skill unavailable/denied", async () => {
  const staging = await mkdtemp(path.join(tmpdir(), "ros-skills-ineligible-"));
  try {
    const svc = svcFor(realCatalog, repoRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
    assert.equal(result.ok, true);
    const opencode = result.view.skills.find((s) => s.id === "opencode-coding-handoff");
    assert.equal(opencode.status, "unavailable", "opencode skill requires filesystem/shell/providers/archive-read");
    const browser = result.view.skills.find((s) => s.id === "browser-research-session");
    assert.equal(browser.status, "unavailable");
    assert.equal(svc.readSkill(result.projection, "opencode-coding-handoff").code, "skill-unavailable");
    const materialized = await svc.materialize(result.projection, "opencode-coding-handoff");
    assert.equal(materialized.ok, false);
    assert.equal(materialized.code, "skill-unavailable");
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C5 H: granted requirements -> eligible skill", () => {
  const svc = svcFor(realCatalog);
  const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(result.ok, true);
  assert.equal(result.view.skills.find((s) => s.id === "opencode-coding-handoff").status, "eligible");
  assert.equal(svc.readSkill(result.projection, "opencode-coding-handoff").ok, true);
});

test("CP-2C5 I: cross-harness/session reuse denied", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "session-a", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const current = { id: "project-a", label: "Project A" };
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "session-b", authorizedProject: current, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: realCatalog }).code, "projection-identity-mismatch");
  assert.equal(svc.consume(issued.projection, { addonId: "addon.other-harness", sessionId: "session-a", authorizedProject: current, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: realCatalog }).code, "projection-identity-mismatch");
});

test("CP-2C5 J: project/context mismatch denied", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const reuse = svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-b", label: "Project B" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: realCatalog });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "projection-identity-mismatch");
});

test("CP-2C6: unchanged authority -> projection remains consumable", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const reuse = svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: realCatalog });
  assert.equal(reuse.ok, true);
});

test("CP-2C6: revoked harness session authority -> existing projection denied", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const reuse = svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: [grant("filesystem")], skillCatalog: realCatalog });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "skills-not-authorized");
});

test("CP-2C6: grant change flipping skill eligibility (narrowing) -> projection stale", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  // CURRENT grants drop filesystem -> opencode eligibility flips to unavailable.
  const narrowed = ["agent-runtime", "shell", "providers", "archive-read"].map(grant);
  const reuse = svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: narrowed, skillCatalog: realCatalog });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "projection-stale");
});

test("CP-2C6: grant change flipping skill eligibility (expansion) -> projection stale", () => {
  const svc = svcFor(realCatalog);
  // Issued with ONLY agent-runtime: opencode unavailable.
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
  assert.equal(issued.ok, true);
  assert.equal(issued.projection.eligibility["opencode-coding-handoff"], false);
  // CURRENT grants now include all required capabilities: eligibility expands.
  const reuse = svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: realCatalog });
  assert.equal(reuse.ok, false);
  assert.equal(reuse.code, "projection-stale");
});

test("CP-2C6: changed skill version/source identity -> fresh projection required", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const changedVersion = realCatalog.map((s) => s.id === "opencode-coding-handoff" ? { ...s, version: "9.9.9" } : s);
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: changedVersion }).code, "projection-stale");
  const changedSource = realCatalog.map((s) => s.id === "opencode-coding-handoff" ? { ...s, source: path.join(repoRoot, "docs", "architecture", "addon-skills", "hermes", "AUGMENTOR_SKILL.md") } : s);
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: changedSource }).code, "projection-stale");
});

test("CP-2C6: skill removed from catalog -> stale", () => {
  const svc = svcFor(realCatalog);
  const issued = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(issued.ok, true);
  const removed = realCatalog.filter((s) => s.id !== "browser-research-session");
  assert.equal(svc.consume(issued.projection, { addonId: "addon.pi-harness", sessionId: "s", authorizedProject: { id: "project-a", label: "Project A" }, grantedCapabilities: opencodeEligibleGrants(), skillCatalog: removed }).code, "projection-stale");
});

test("CP-2C8: synthetic non-Pi harness consumes the SAME generic projection/materialization seam", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "ros-synth-src-"));
  const staging = await mkdtemp(path.join(tmpdir(), "ros-synth-stage-"));
  try {
    await writeFile(path.join(sourceRoot, "synthetic-skill.md"), "# Synthetic skill\n\nUse this to do synthetic things.\n");
    const syntheticManifest = {
      id: "addon.synthetic-harness",
      version: "0.3.0",
      skills: [{ id: "synthetic-skill", name: "Synthetic skill", description: "A synthetic harness skill.", documentPath: "synthetic-skill.md", requiredCapabilities: ["network"] }],
    };
    const catalog = buildSkillCatalogFromManifests([syntheticManifest], { sourceRoot });
    const svc = svcFor(catalog, sourceRoot, staging);
    // Same generic seam, no addon.pi-harness branching.
    const result = svc.project({ addonId: "addon.synthetic-harness", sessionId: "synth-session-1", request: skillsReadRequest(), grantedCapabilities: [grant("agent-runtime"), grant("network")] });
    assert.equal(result.ok, true);
    assert.deepEqual(OP(result.projection), ["skills.list", "skills.read"]);
    assert.equal(result.view.skills[0].status, "eligible");
    const materialized = await svc.materialize(result.projection, "synthetic-skill");
    assert.equal(materialized.ok, true);
    assert.equal(materialized.stagedPath, path.join(ownedRoot(staging, "addon.synthetic-harness", "synth-session-1"), ".pi", "skills", "synthetic-skill", "SKILL.md"));
    const content = await readFile(materialized.stagedPath, "utf8");
    assert.match(content, /name: synthetic-skill/);
    assert.match(content, /Synthetic skill/);
    // The canonical source root is unchanged by materialization.
    const canonical = await readFile(path.join(sourceRoot, "synthetic-skill.md"), "utf8");
    assert.equal(canonical, "# Synthetic skill\n\nUse this to do synthetic things.\n");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C9: symlink escape from skill source fails closed", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "ros-src-sym-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ros-outside-"));
  const staging = await mkdtemp(path.join(tmpdir(), "ros-stage-sym-"));
  try {
    await writeFile(path.join(outside, "secret.md"), "TOP SECRET");
    await writeFile(path.join(sourceRoot, "real-skill.md"), "# real");
    // A symlink inside the source root pointing outside.
    await symlink(outside, path.join(sourceRoot, "escape-link"));
    const catalog = normalizeSkillCatalog([{
      id: "escaped-skill", name: "escaped-skill", label: "Escaped", description: "d", version: "1",
      source: path.join(sourceRoot, "escape-link", "secret.md"), requiredCapabilities: [],
    }]);
    assert.equal(catalog.ok, true, "lexical source path is inside the root; symlink escape is caught at materialization");
    const svc = svcFor(catalog.records, sourceRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
    assert.equal(result.ok, true);
    const plan = svc.planMaterialization(result.projection, "escaped-skill");
    assert.equal(plan.ok, false);
    assert.equal(plan.code, "skill-source-escape");
    const materialized = await svc.materialize(result.projection, "escaped-skill");
    assert.equal(materialized.ok, false);
    assert.equal(materialized.code, "skill-source-escape");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C9: symlink escape from staging destination fails closed", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "ros-src-dst-"));
  const outside = await mkdtemp(path.join(tmpdir(), "ros-out-dst-"));
  const staging = await mkdtemp(path.join(tmpdir(), "ros-stage-dst-"));
  try {
    await writeFile(path.join(sourceRoot, "real-skill.md"), "# real");
    const catalog = normalizeSkillCatalog([{
      id: "dst-skill", name: "dst-skill", label: "DST", description: "d", version: "1",
      source: path.join(sourceRoot, "real-skill.md"), requiredCapabilities: [],
    }]);
    const svc = svcFor(catalog.records, sourceRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
    assert.equal(result.ok, true);
    // A `.pi` symlink inside THIS projection's owned staging root pointing outside.
    const root = ownedRoot(staging, "addon.pi-harness", "s");
    await mkdir(root, { recursive: true });
    await symlink(outside, path.join(root, ".pi"));
    const materialized = await svc.materialize(result.projection, "dst-skill");
    assert.equal(materialized.ok, false);
    assert.equal(materialized.code, "skill-destination-escape");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C9: skill metadata cannot self-grant its own required capabilities", () => {
  const svc = svcFor(realCatalog);
  // Only agent-runtime granted. opencode skill declares filesystem/shell/providers/archive-read.
  const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
  assert.equal(result.ok, true);
  assert.equal(isSkillEligible(opencodeSkill, [agentRuntimeGrant]), false, "requiredCapabilities must be granted, not self-declared");
  assert.equal(result.view.skills.find((s) => s.id === "opencode-coding-handoff").status, "unavailable");
  // The projected view introduces no capability authority.
  assert.equal(JSON.stringify(result.view).includes("filesystem"), false);
  assert.equal(JSON.stringify(result.view).includes("shell"), false);
});

test("CP-2C9: public view exposes no private paths, grants, or secrets", () => {
  const svc = svcFor(realCatalog);
  const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: opencodeEligibleGrants() });
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result.view);
  assert.equal(serialized.includes(repoRoot), false, "no absolute source root");
  assert.equal(serialized.includes("/home"), false, "no home path");
  assert.equal(serialized.includes("agent-runtime"), false, "no backing grant");
  assert.equal(serialized.includes("filesystem"), false, "no capability authority");
  assert.equal(serialized.includes("shell"), false);
  assert.equal(serialized.includes("providers"), false);
  assert.equal(serialized.includes("archive-read"), false);
  assert.equal("source" in result.view, false);
  assert.equal("listGrant" in result.view, false);
  assert.equal("request" in result.view, false);
});

test("CP-2C9: canonical skill source unchanged after projection and cleanup", async () => {
  const sourceRoot = await mkdtemp(path.join(tmpdir(), "ros-src-unchanged-"));
  const staging = await mkdtemp(path.join(tmpdir(), "ros-stage-unchanged-"));
  try {
    const canonicalPath = path.join(sourceRoot, "canonical-skill.md");
    await writeFile(canonicalPath, "# Canonical skill\n\nBody stays identical.\n");
    const catalog = normalizeSkillCatalog([{
      id: "canonical-skill", name: "canonical-skill", label: "Canonical", description: "c", version: "1",
      source: canonicalPath, requiredCapabilities: [],
    }]);
    const svc = svcFor(catalog.records, sourceRoot, staging);
    const result = svc.project({ addonId: "addon.pi-harness", sessionId: "s", request: skillsReadRequest(), grantedCapabilities: [agentRuntimeGrant] });
    assert.equal(result.ok, true);
    const before = await readFile(canonicalPath, "utf8");
    const materialized = await svc.materialize(result.projection, "canonical-skill");
    assert.equal(materialized.ok, true);
    assert.equal(await readFile(canonicalPath, "utf8"), before, "canonical source must not change");
    await svc.cleanup(result.projection, {
      addonId: "addon.pi-harness",
      sessionId: "s",
      authorizedProject: { id: "project-a", label: "Project A" },
      grantedCapabilities: [agentRuntimeGrant],
      skillCatalog: catalog.records,
    });
    const gone = await readFile(ownedRoot(staging, "addon.pi-harness", "s")).catch((e) => e.code);
    assert.equal(gone, "ENOENT", "session staging root is disposed");
    assert.equal(await readFile(canonicalPath, "utf8"), before, "cleanup must not touch the canonical source");
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
});

test("CP-2C7: Pi manifest declares skills list/read and normalizes", () => {
  const normalized = normalizeHarnessResourceRequest(piManifest.harnessResources);
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.value.requests.skills, ["list", "read"]);
  assert.equal(SKILLS_LIST_CAPABILITY, "agent-runtime");
  assert.deepEqual(deriveSkillsOperations(normalized.value, [agentRuntimeGrant]).map((o) => o.operation), ["list", "read"]);
});
