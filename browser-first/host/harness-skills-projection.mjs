// Intent citation: docs/architecture/ADR-044-generic-harness-skills-projection.md
//
// Generic Harness Skills Projection (Phase 2C) — host-owned session seam.
//
//   RESOURCE REQUEST != CAPABILITY GRANT != SESSION PROJECTION
//
// Skills have no single backing capability in HARNESS_RESOURCE_CAPABILITY. This
// module resolves skills authority from the EXISTING CapabilityGrant records and
// the skill's own manifest metadata (`requiredCapabilities`), and projects the
// skills family into a bounded session view:
//
//   - list authority     the harness session authority grant (`agent-runtime`).
//                         List exposes safe skill identity/label/version/status
//                         metadata ONLY — never a source path, credential, or
//                         command.
//   - read authority     list authority + a named, eligible skill: eligibility
//                         requires every skill `requiredCapability` to be
//                         granted. Read produces bounded material (a disposable,
//                         host-owned staging copy), never raw filesystem access.
//
// A skill's `requiredCapabilities` are descriptive metadata — they state what a
// skill needs to RUN, not authority the skill holds. The projection never mints
// grants from skill metadata, never widens the session's capability grants, and
// read never implies tool/shell/network/filesystem authority. The canonical
// skill source is never mutated; materialization is disposable and host-owned.
//
// It reuses the pure request/grant helpers from the canonical SDK layer
// (packages/addon-sdk/src/harness-resources.ts) and the symlink-aware path
// containment primitive (addons/resonant-browser-host/src/lib/path-contains.mjs).
// It never spawns a process, opens a PTY, resolves a credential/provider/model,
// or exposes an arbitrary path to a manifest.
//
// Host-owned staging base:
//   - Host injects `stagingBase` in `createHarnessSkillsProjection`.
//   - Projection staging identity is a host-derived opaque digest of the full
//     session binding (addonId + NUL + sessionId + NUL + projectId), never a raw
//     caller/session/project string. Staging path is derived as:
//     `${stagingBase}/skills/<opaque-digest>`.
//   - Caller cannot supply arbitrary staging root.
//
// Host-owned layout:
//   - Layout (dir, file) is injected in `createHarnessSkillsProjection`.
//   - Default: `.pi/skills/SKILL.md` (Pi native).
//   - Caller cannot supply layout.
//
// Projection-owned cleanup:
//   - cleanup(projection, currentContext) replaces cleanup(stagingRoot).
//   - Validates: projection identity, addon/session/project binding, staging
//     ownership (exact structural equality, never substring/prefix), strict
//     containment under stagingBase/skills, protected roots (exact equality,
//     no blanket /home rejection), symlink escape.
//   - Only removes the exact owned staging tree for THIS projection/session.

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeHarnessResourceRequest } from "../../packages/addon-sdk/src/harness-resources.ts";
import { ADDON_CAPABILITIES } from "../../packages/addon-sdk/src/contracts.ts";
import { pathContains } from "../../addons/resonant-browser-host/src/lib/path-contains.mjs";

const SKILLS_FAMILY = "skills";

// The existing Capability that backs a harness session's authority to list/read
// skills. Reused (not invented): `agent-runtime` is the harness category's
// required runtime authority. A skill with no `requiredCapabilities` is eligible
// whenever this grant is present; a skill with requirements additionally needs
// each requirement granted.
export const SKILLS_LIST_CAPABILITY = "agent-runtime";

// Agent Skills standard name (Pi 0.80.3 docs/skills.md): 1-64 chars, lowercase
// a-z, 0-9, hyphens only, no leading/trailing/consecutive hyphens. Used to derive
// the materialization directory name and to reject path-confusing names.
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ABS_PATH_ILLEGAL = /[\0\n]/;

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

const operationKey = (family, operation) => `${family}.${operation}`;

/** Canonical, order-independent operation-set key for equality comparison. */
const operationKeySet = (operations) =>
  [...new Set((operations ?? []).map((op) => operationKey(op.family, op.operation)))].sort().join("\u0000");

/**
 * Host-derived opaque staging identity for a full session binding (F2).
 *
 * The raw addon/session/project identity strings are NEVER used as filesystem
 * path components. Instead the binding is folded into a fixed 64-char lowercase
 * SHA-256 hex digest via the standard Node crypto module. This is deterministic
 * (same binding -> same identity across the projection lifecycle) so a caller
 * cannot predict/forge another binding's staging directory, nor inject path
 * separators, traversal, absolute reroots, or path-confusing characters.
 */
export function deriveStagingIdentity(addonId, sessionId, projectId) {
  return createHash("sha256")
    .update(`${addonId}\u0000${sessionId}\u0000${projectId}`)
    .digest("hex");
}

/**
 * Exact-equality protected-root check (F4). A candidate canonical path is a
 * protected root only when it EXACTLY equals one of the host protected roots —
 * never by prefix/substring. Sub-paths under a protected root (e.g. a legitimate
 * staging tree beneath `/home/<user>/...`) are NOT protected by this rule; they
 * are governed instead by the strict-containment/escape checks.
 */
export function isProtectedStagingRoot(candidate, { stagingBase, skillSourceRoot, projectRoot = null } = {}) {
  const canonical = path.resolve(candidate);
  const roots = ["/", process.env.HOME, projectRoot, skillSourceRoot, stagingBase].filter(isNonEmptyString);
  return roots.some((root) => path.resolve(root) === canonical);
}

/**
 * Pure lexical ownership decision (F3/F4/F5) for a candidate staging root.
 * Returns pass only when the candidate is EXACTLY the derived owned staging root
 * for the binding, is strictly contained under `stagingBase/skills` (never equal
 * to it), and is not a protected root. No prefix/substring identity test is ever
 * used. Pure lexical validation (no filesystem writes); the caller layers the
 * read-only symlink-resolved containment check on top.
 */
export function decideStagingOwnership(candidate, { stagingBase, skillSourceRoot, projectRoot = null, addonId, sessionId, projectId } = {}) {
  if (!isNonEmptyString(candidate) || !path.isAbsolute(candidate) || ABS_PATH_ILLEGAL.test(candidate)) {
    return { ok: false, code: "invalid-path" };
  }
  const skillsDir = path.resolve(stagingBase, "skills");
  const identity = deriveStagingIdentity(addonId, sessionId, projectId);
  const expected = path.resolve(skillsDir, identity);
  const canonical = path.resolve(candidate);

  if (isProtectedStagingRoot(canonical, { stagingBase, skillSourceRoot, projectRoot })) {
    return { ok: false, code: "protected-root", canonical, expected, identity, skillsDir };
  }
  if (canonical !== expected) {
    return { ok: false, code: "not-owned-staging", canonical, expected, identity, skillsDir };
  }
  const relative = path.relative(skillsDir, canonical);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, code: "outside-skills-dir", canonical, expected, identity, skillsDir };
  }
  return { ok: true, canonical, expected, identity, skillsDir };
}

/**
 * Validate the authoritative host project identity shape (identity binding only:
 * skills are bound to addon + session + project identity; no project filesystem
 * root is required for the skills family).
 */
function validProjectIdentity(project) {
  return Boolean(project) && typeof project === "object" &&
    isNonEmptyString(project.id) && isNonEmptyString(project.label);
}

function validSkillName(name) {
  return isNonEmptyString(name) && name.length <= 64 && SKILL_NAME_PATTERN.test(name);
}

const isGranted = (grantedCapabilities, capability) =>
  (grantedCapabilities ?? []).some((grant) => grant?.capability === capability && grant?.granted === true);

/**
 * Pure eligibility: a skill is eligible only when EVERY required capability is
 * granted by the EXISTING CapabilityGrant records. A skill never grants its own
 * requirements; this derives eligibility from host grants only.
 */
export function isSkillEligible(skill, grantedCapabilities) {
  const required = Array.isArray(skill?.requiredCapabilities) ? skill.requiredCapabilities : [];
  return required.every((capability) => isGranted(grantedCapabilities, capability));
}

/**
 * Pure derivation: the requested skills operations that are authorized. Both
 * `list` and `read` gate on the harness session authority (`listCapability`);
 * read additionally requires a named eligible skill at consumption time (list
 * authority does not imply read of any particular skill's content).
 */
export function deriveSkillsOperations(request, grantedCapabilities, listCapability = SKILLS_LIST_CAPABILITY) {
  const skills = request?.requests?.skills;
  if (!Array.isArray(skills) || skills.length === 0) return [];
  if (!isGranted(grantedCapabilities, listCapability)) return [];
  return skills.map((operation) => Object.freeze({ family: SKILLS_FAMILY, operation }));
}

/**
 * Normalize a host-injected skill catalog (the smallest host-owned skills source
 * abstraction). There is no separate skills database: the host derives canonical
 * records from reviewed add-on manifests (see buildSkillCatalogFromManifests)
 * and passes them here. Every record must carry a stable id, a validated Agent
 * Skills name, label/description/version, a host-owned absolute source path, and
 * a requiredCapabilities array drawn from the existing capability vocabulary.
 * Malformed records fail closed (rejected), never default-allow.
 */
export function normalizeSkillCatalog(catalog) {
  const issues = [];
  const push = (code, message) => issues.push({ code, message });
  if (!Array.isArray(catalog)) {
    push("skill-catalog-array", "Skill catalog must be an array of canonical skill records.");
    return { ok: false, issues };
  }
  const records = [];
  const seen = new Set();
  for (const [index, entry] of catalog.entries()) {
    const at = `skills[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      push("skill-record-object", `${at} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(entry.id)) { push("skill-id", `${at}.id must be a non-empty string.`); continue; }
    if (seen.has(entry.id)) { push("skill-duplicate-id", `${at}.id "${entry.id}" is duplicated.`); continue; }
    seen.add(entry.id);
    if (!validSkillName(entry.name)) {
      push("skill-name", `${at}.name "${entry.name ?? ""}" is not a valid Agent Skills name (1-64 chars, lowercase a-z, 0-9, hyphens).`);
      continue;
    }
    if (!isNonEmptyString(entry.label)) { push("skill-label", `${at}.label must be a non-empty string.`); continue; }
    if (!isNonEmptyString(entry.description)) { push("skill-description", `${at}.description must be a non-empty string.`); continue; }
    if (!isNonEmptyString(entry.version)) { push("skill-version", `${at}.version must be a non-empty string.`); continue; }
    if (!isNonEmptyString(entry.source) || !path.isAbsolute(entry.source) || ABS_PATH_ILLEGAL.test(entry.source)) {
      push("skill-source", `${at}.source must be a host-owned absolute path.`);
      continue;
    }
    const requiredCapabilities = Array.isArray(entry.requiredCapabilities) ? entry.requiredCapabilities : null;
    if (requiredCapabilities === null) {
      push("skill-required-capabilities", `${at}.requiredCapabilities must be an array.`);
      continue;
    }
    const unknown = requiredCapabilities.filter((capability) => !ADDON_CAPABILITIES.includes(capability));
    if (unknown.length > 0) {
      push("skill-unknown-capability", `${at}.requiredCapabilities names unknown capability ${JSON.stringify(unknown)}.`);
      continue;
    }
    records.push(Object.freeze({
      id: entry.id,
      name: entry.name,
      label: entry.label,
      description: entry.description,
      version: entry.version,
      source: entry.source,
      requiredCapabilities: Object.freeze([...new Set(requiredCapabilities)]),
    }));
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, records: Object.freeze(records) };
}

/**
 * Build a host-owned skill catalog from reviewed add-on manifests. This is the
 * concrete "smallest host-owned source abstraction": canonical skill records are
 * derived from each manifest's `skills[]` declaration (the SDK skill contract),
 * with each `documentPath` resolved lexically INSIDE the host-owned `sourceRoot`.
 * Absolute or escaping `documentPath` values are rejected (fail closed). The
 * resolved absolute source path is host-internal and never crosses the public
 * view. `augmentorSkills` (Strategist operating methods) are deliberately NOT a
 * harness skill source and are excluded.
 */
export function buildSkillCatalogFromManifests(manifests, { sourceRoot } = {}) {
  if (!isNonEmptyString(sourceRoot) || !path.isAbsolute(sourceRoot) || ABS_PATH_ILLEGAL.test(sourceRoot)) {
    throw new TypeError("A host-owned absolute sourceRoot is required to build a skill catalog.");
  }
  const root = path.resolve(sourceRoot);
  const records = [];
  for (const manifest of manifests ?? []) {
    const version = isNonEmptyString(manifest?.version) ? manifest.version : "unknown";
    for (const skill of Array.isArray(manifest?.skills) ? manifest.skills : []) {
      if (!skill || typeof skill !== "object") continue;
      if (!isNonEmptyString(skill.id) || !isNonEmptyString(skill.documentPath)) continue;
      if (path.isAbsolute(skill.documentPath) || ABS_PATH_ILLEGAL.test(skill.documentPath)) continue;
      const source = path.resolve(root, skill.documentPath);
      const relative = path.relative(root, source);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) continue;
      records.push(Object.freeze({
        id: skill.id,
        name: skill.id,
        label: isNonEmptyString(skill.name) ? skill.name : skill.id,
        description: isNonEmptyString(skill.description) ? skill.description : "",
        version,
        source,
        requiredCapabilities: Object.freeze([...(Array.isArray(skill.requiredCapabilities) ? skill.requiredCapabilities : [])]),
      }));
    }
  }
  return Object.freeze(records);
}

/** Deterministic, order-independent identity of a catalog (id/name/version/source/requirements). */
const catalogIdentity = (records) =>
  records.map((record) => [
    record.id, record.name, record.version, record.source,
    (record.requiredCapabilities ?? []).slice().sort().join(","),
  ].join("\u0001")).sort().join("\u0002");

const freezeRequest = (request) => Object.freeze({
  requests: Object.freeze(Object.fromEntries(
    Object.entries(request.requests).map(([family, ops]) => [family, Object.freeze([...ops])]),
  )),
});

const safeSkillMeta = (skill, eligibility) => Object.freeze({
  id: skill.id,
  name: skill.name,
  label: skill.label,
  description: skill.description,
  version: skill.version,
  status: eligibility[skill.id] ? "eligible" : "unavailable",
});

export function createHarnessSkillsProjection({
  authorizedProject,
  skillCatalog = [],
  skillSourceRoot,
  stagingBase,
  projectRoot = null,
  listCapability = SKILLS_LIST_CAPABILITY,
  layout = { dir: path.join(".pi", "skills"), file: "SKILL.md" },
  now = () => new Date().toISOString(),
} = {}) {
  if (!validProjectIdentity(authorizedProject)) {
    throw new TypeError("Authoritative host project ({ id, label }) is required to project skills.");
  }
  if (!isNonEmptyString(skillSourceRoot) || !path.isAbsolute(skillSourceRoot) || ABS_PATH_ILLEGAL.test(skillSourceRoot)) {
    throw new TypeError("A host-owned absolute skillSourceRoot is required to materialize skills.");
  }
  if (!isNonEmptyString(stagingBase) || !path.isAbsolute(stagingBase) || ABS_PATH_ILLEGAL.test(stagingBase)) {
    throw new TypeError("A host-owned absolute stagingBase is required for session staging management.");
  }
  if (projectRoot !== null && projectRoot !== undefined && (!isNonEmptyString(projectRoot) || !path.isAbsolute(projectRoot) || ABS_PATH_ILLEGAL.test(projectRoot))) {
    throw new TypeError("A host-owned absolute projectRoot is required when provided.");
  }
  if (!isNonEmptyString(layout.dir) || !isNonEmptyString(layout.file) || ABS_PATH_ILLEGAL.test(layout.dir) || ABS_PATH_ILLEGAL.test(layout.file)) {
    throw new TypeError("A host-injected layout with dir and file is required.");
  }
  const normalizedCatalog = normalizeSkillCatalog(skillCatalog);
  if (!normalizedCatalog.ok) {
    throw new TypeError(`Invalid skill catalog: ${normalizedCatalog.issues[0]?.code ?? "unknown"}.`);
  }
  const records = normalizedCatalog.records;

  const deniedView = (addonId, sessionId, code) => Object.freeze({
    ok: false,
    code,
    view: Object.freeze({
      addonId: isNonEmptyString(addonId) ? addonId : "",
      sessionId: isNonEmptyString(sessionId) ? sessionId : "",
      projectId: authorizedProject.id,
      projectLabel: authorizedProject.label,
      operations: Object.freeze([]),
      skills: Object.freeze([]),
      state: "denied",
    }),
  });

  const publicView = (projection) => Object.freeze({
    addonId: projection.addonId,
    sessionId: projection.sessionId,
    projectId: projection.project.id,
    projectLabel: projection.project.label,
    operations: Object.freeze(projection.operations.map((op) => operationKey(op.family, op.operation))),
    skills: Object.freeze(projection.catalog.map((skill) => safeSkillMeta(skill, projection.eligibility))),
    state: "projected",
  });

  const hasOperation = (projection, operation) =>
    projection?.operations?.some((op) => op.family === SKILLS_FAMILY && op.operation === operation);

  const findSkill = (projection, skillId) =>
    projection?.catalog?.find((skill) => skill.id === skillId) ?? null;

  /**
   * The host-derived session binding (addon + session + project identity). The
   * raw identity strings are never used as path components; they are folded into
   * an opaque digest by deriveStagingIdentity.
   */
  const projectionBinding = (projection) => ({
    addonId: projection?.addonId ?? "",
    sessionId: projection?.sessionId ?? "",
    projectId: projection?.project?.id ?? "",
  });

  /**
   * Derive the host-owned staging root for a projection from its opaque binding
   * identity: stagingBase/skills/<opaque-digest>. Never uses a raw sessionId (or
   * any caller string) as a path component.
   */
  const computeOwnedStagingRoot = (projection) => {
    const binding = projectionBinding(projection);
    return path.resolve(stagingBase, "skills", deriveStagingIdentity(binding.addonId, binding.sessionId, binding.projectId));
  };

  /**
   * Validate the DERIVED owned staging root (F5): the candidate is always
   * host-derived (never caller-supplied), and this proves it is exactly owned
   * (exact structural equality, never substring/prefix), strictly contained
   * under stagingBase/skills, not a protected root, and does not escape via
   * symlink.
   */
  const validateOwnedStagingRoot = async (projection) => {
    const binding = projectionBinding(projection);
    const candidate = path.resolve(stagingBase, "skills", deriveStagingIdentity(binding.addonId, binding.sessionId, binding.projectId));
    const decision = decideStagingOwnership(candidate, { stagingBase, skillSourceRoot, projectRoot, ...binding });
    if (!decision.ok) return decision;
    const verdict = pathContains(stagingBase, decision.expected);
    if (verdict.result !== "pass") return { ...decision, ok: false, code: "symlink-escape" };
    return { ok: true, ...decision, realTarget: verdict.evidence.targetReal };
  };

  /**
   * Read authority gate for one named skill. Requires `skills.read` in the
   * operation set, a known skill id, and eligibility (every required capability
   * granted). Returns safe metadata only; bounded content is produced by
   * materialize() into a host-owned staging root (never raw source-path access).
   */
  const readSkillImpl = (projection, skillId) => {
    if (!hasOperation(projection, "read")) return { ok: false, code: "skills-read-not-granted" };
    const skill = findSkill(projection, skillId);
    if (!skill) return { ok: false, code: "unknown-skill" };
    if (!projection.eligibility?.[skillId]) return { ok: false, code: "skill-unavailable" };
    return { ok: true, skill: safeSkillMeta(skill, projection.eligibility) };
  };

  /**
   * Host-internal materialization plan for one read-eligible skill. Validates
   * the canonical source within the host-owned skill source root and the
   * destination within the host-owned staging root (both symlink-aware), and
   * derives the disposable Pi-native (or flat) destination from the skill name
   * — never a manifest- or caller-supplied path. Plan-only: performs no write.
   *
   * CP-2C1.4: stagingRoot is derived from projection/session identity, not caller input.
   */
  const planMaterializationImpl = (projection, skillId, context = {}) => {
    const gate = readSkillImpl(projection, skillId);
    if (!gate.ok) return gate;
    const skill = findSkill(projection, skillId);
    const sourceVerdict = pathContains(skillSourceRoot, skill.source);
    if (sourceVerdict.result !== "pass") return { ok: false, code: "skill-source-escape" };
    const dir = layout.dir;
    const file = layout.file;
    if (!isNonEmptyString(dir) || !isNonEmptyString(file) || ABS_PATH_ILLEGAL.test(dir) || ABS_PATH_ILLEGAL.test(file)) {
      return { ok: false, code: "invalid-layout" };
    }
    // F6: Derive the SAME opaque owned staging root from THIS projection binding.
    const stagingRoot = computeOwnedStagingRoot(projection);
    const destination = path.resolve(stagingRoot, dir, skill.name, file);
    // Destination must be strictly inside THIS projection's owned staging root
    // (not merely somewhere under stagingBase). Validated skill name is the only
    // skill-derived path component; dir/file are host-injected layout.
    const destVerdict = pathContains(stagingRoot, destination);
    if (destVerdict.result !== "pass") return { ok: false, code: "skill-destination-escape" };
    const relDest = path.relative(path.resolve(stagingRoot), path.resolve(destination));
    if (relDest === "" || relDest.startsWith("..") || path.isAbsolute(relDest)) {
      return { ok: false, code: "skill-destination-escape" };
    }
    return Object.freeze({
      ok: true,
      skill: safeSkillMeta(skill, projection.eligibility),
      source: sourceVerdict.evidence.targetReal,
      destination: destVerdict.evidence.targetReal,
      name: skill.name,
      stagingRoot,
    });
  };

  /**
   * Materialize one read-eligible skill into a disposable, host-owned staging
   * root using the harness's native skill convention (Pi default: .pi/skills/
   * <name>/SKILL.md). Reads the canonical source (containment-checked), writes
   * a derived SKILL.md with host-owned name/description frontmatter plus the
   * canonical body, at mode 0o644 (no executable privilege), injects no
   * credential/secret, and never mutates the canonical source. Fail closed on
   * source/destination escape.
   *
   * CP-2C1.4: No stagingRoot parameter from caller; derived from projection identity.
   */
  const materializeImpl = async (projection, skillId, context = {}) => {
    const plan = planMaterializationImpl(projection, skillId, context);
    if (!plan.ok) return plan;
    const skill = findSkill(projection, skillId);
    let body;
    try {
      body = await readFile(plan.source, "utf8");
    } catch (error) {
      return { ok: false, code: "skill-content-unavailable", detail: error?.code ?? "read-failed" };
    }
    const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n`;
    const content = `${frontmatter}${body}`;
    try {
      await mkdir(path.dirname(plan.destination), { recursive: true });
      await writeFile(plan.destination, content, { mode: 0o644 });
    } catch (error) {
      return { ok: false, code: "skill-materialize-failed", detail: error?.code ?? "write-failed" };
    }
    return Object.freeze({
      ok: true,
      skill: safeSkillMeta(skill, projection.eligibility),
      name: skill.name,
      stagedPath: plan.destination,
      stagingRoot: plan.stagingRoot,
    });
  };

  /**
   * Dispose a host-owned session staging root (disposable projection). Idempotent:
   * removing a missing root is success. Only ever removes the named staging root
   * supplied by the host — never the canonical skill source.
   *
   * CP-2C1.3: cleanup accepts a projection and currentContext, validates ownership,
   * and only removes the staging tree for THIS projection/session.
   */
  const cleanupImpl = async (projection, currentContext) => {
    // Validate projection identity
    if (!projection || typeof projection !== "object") {
      return { ok: false, code: "invalid-projection" };
    }
    if (!isNonEmptyString(projection.addonId) || !isNonEmptyString(projection.sessionId)) {
      return { ok: false, code: "invalid-projection-identity" };
    }
    // Validate current context
    if (!currentContext || typeof currentContext !== "object") {
      return { ok: false, code: "invalid-context" };
    }
    const { addonId, sessionId, authorizedProject: currentProject, grantedCapabilities = [], skillCatalog: currentCatalog } = currentContext;
    // Validate addon/session/project identity binding
    if (projection.addonId !== addonId || projection.sessionId !== sessionId ||
        projection.project?.id !== currentProject?.id) {
      return { ok: false, code: "identity-mismatch" };
    }
    // Validate current authority and catalog match
    const currentGrant = (grantedCapabilities ?? []).find((grant) =>
      grant?.capability === listCapability && grant?.granted === true) ?? null;
    if (!currentGrant) {
      return { ok: false, code: "not-authorized" };
    }
    const current = normalizeSkillCatalog(currentCatalog);
    if (!current.ok) {
      return { ok: false, code: "invalid-skill-catalog" };
    }
    if (catalogIdentity(projection.catalog) !== catalogIdentity(current.records)) {
      return { ok: false, code: "catalog-mismatch" };
    }
    const currentEligibility = Object.fromEntries(
      current.records.map((skill) => [skill.id, isSkillEligible(skill, grantedCapabilities)]),
    );
    const issuedEligibility = projection.eligibility ?? {};
    const issuedIds = Object.keys(issuedEligibility);
    const currentIds = Object.keys(currentEligibility);
    if (issuedIds.length !== currentIds.length ||
        currentIds.some((id) => issuedEligibility[id] !== currentEligibility[id])) {
      return { ok: false, code: "eligibility-mismatch" };
    }
    // F5: Derive the owned staging root from THIS projection binding, prove
    // exact ownership + strict containment + protected roots + symlink safety,
    // then remove ONLY that exact owned tree. Idempotent: removing an
    // already-removed owned tree remains a pass.
    const ownership = await validateOwnedStagingRoot(projection);
    if (!ownership.ok) {
      return { ok: false, code: ownership.code };
    }
    await rm(ownership.expected, { recursive: true, force: true });
    return { ok: true };
  };

  return {
    /**
     * Issue a bounded session skills projection. Denies (fail closed) when the
     * request is malformed, identity is missing, the skills family is not
     * requested, the harness session authority is absent/revoked, or the catalog
     * is empty. The public view carries safe skill metadata only.
     */
    project({ addonId, sessionId, request, grantedCapabilities = [] } = {}) {
      if (!isNonEmptyString(addonId) || !isNonEmptyString(sessionId)) {
        return deniedView(addonId, sessionId, "invalid-identity");
      }
      const normalized = normalizeHarnessResourceRequest(request);
      if (!normalized.ok) return deniedView(addonId, sessionId, "invalid-request");
      const skills = normalized.value.requests.skills;
      if (!Array.isArray(skills) || skills.length === 0) {
        return deniedView(addonId, sessionId, "no-skills-request");
      }
      const operations = deriveSkillsOperations(normalized.value, grantedCapabilities, listCapability);
      if (operations.length === 0) return deniedView(addonId, sessionId, "skills-not-authorized");
      const listGrant = (grantedCapabilities ?? []).find((grant) =>
        grant?.capability === listCapability && grant?.granted === true) ?? null;
      const eligibility = Object.freeze(Object.fromEntries(
        records.map((skill) => [skill.id, isSkillEligible(skill, grantedCapabilities)]),
      ));
      const projection = Object.freeze({
        addonId,
        sessionId,
        project: Object.freeze({ id: authorizedProject.id, label: authorizedProject.label }),
        operations: Object.freeze(operations),
        // HOST-INTERNAL issuance authority basis: the normalized request that
        // produced this operation set. consume() re-evaluates it against CURRENT
        // grants; it never crosses the public view and carries no path/grant/secret.
        request: freezeRequest(normalized.value),
        listGrant: Object.freeze({ ...listGrant }),
        // HOST-INTERNAL catalog snapshot (source paths stay internal). The public
        // view derives safe metadata from this and never exposes `source`.
        catalog: Object.freeze(records.map((skill) => Object.freeze({ ...skill }))),
        eligibility,
        issuedAt: now(),
      });
      return { ok: true, projection, view: publicView(projection) };
    },

    /**
     * Re-validate an existing projection against CURRENT host state before any
     * consumption. Denies when addon/session/project identity differs, the
     * harness session authority was revoked, the current requested∩granted
     * operation set diverges (narrowed OR expanded), the catalog identity changed
     * (skill added/removed/version/source/requirements changed), or per-skill
     * eligibility changed. A stale projection must be re-issued, never silently
     * downgraded in place.
     */
    consume(projection, { addonId, sessionId, authorizedProject: currentProject, grantedCapabilities = [], skillCatalog: currentCatalog } = {}) {
      if (!projection || typeof projection !== "object") {
        return deniedView(addonId, sessionId, "projection-identity-mismatch");
      }
      if (projection.addonId !== addonId || projection.sessionId !== sessionId ||
          projection.project?.id !== currentProject?.id) {
        return deniedView(addonId, sessionId, "projection-identity-mismatch");
      }
      const currentGrant = (grantedCapabilities ?? []).find((grant) =>
        grant?.capability === listCapability && grant?.granted === true) ?? null;
      if (!currentGrant) return deniedView(addonId, sessionId, "skills-not-authorized");
      if (!projection.request || typeof projection.request !== "object") {
        return deniedView(addonId, sessionId, "projection-stale");
      }
      const currentOperations = deriveSkillsOperations(projection.request, grantedCapabilities, listCapability);
      if (operationKeySet(projection.operations) !== operationKeySet(currentOperations)) {
        return deniedView(addonId, sessionId, "projection-stale");
      }
      const current = normalizeSkillCatalog(currentCatalog);
      if (!current.ok) return deniedView(addonId, sessionId, "invalid-skill-catalog");
      if (catalogIdentity(projection.catalog) !== catalogIdentity(current.records)) {
        return deniedView(addonId, sessionId, "projection-stale");
      }
      const currentEligibility = Object.fromEntries(
        current.records.map((skill) => [skill.id, isSkillEligible(skill, grantedCapabilities)]),
      );
      const issuedEligibility = projection.eligibility ?? {};
      const issuedIds = Object.keys(issuedEligibility);
      const currentIds = Object.keys(currentEligibility);
      if (issuedIds.length !== currentIds.length ||
          currentIds.some((id) => issuedEligibility[id] !== currentEligibility[id])) {
        return deniedView(addonId, sessionId, "projection-stale");
      }
      return { ok: true, projection, view: publicView(projection) };
    },

    /** Safe public/audit view: identity, operation names, safe skill metadata. */
    publicView,

    /** Safe skill metadata for a `list` operation (same shape as the public view). */
    listSkills(projection) {
      if (!projection || typeof projection !== "object") return Object.freeze([]);
      return Object.freeze(projection.catalog.map((skill) => safeSkillMeta(skill, projection.eligibility)));
    },

    readSkill: readSkillImpl,

    planMaterialization: planMaterializationImpl,

    materialize: materializeImpl,

    cleanup: cleanupImpl,
  };
}

export { SKILLS_FAMILY, SKILL_NAME_PATTERN };
