// Terminal Host <-> Host Boundary wiring (Step 5, 5A).
//
// Assembles the host-owned dependencies the /terminal-host/session/attach
// route uses when a caller does NOT inject a resolver or full project
// identity. The route remains host-agnostic: it consumes the result of
// createTerminalHostHostWiring as plain data (functions + strings). The
// wiring owns the host source-of-truth: provider profiles + secrets
// (from provider-bridge-service), a project store (minimal: synthesized
// from caller-supplied roots; overridable for a real store), and a
// skill-catalog source (default empty list; overridable for a real
// catalog).
//
// Hard rules:
//   * The credential value enters ONLY under the host-owned env name
//     returned by the resolver; never in argv, an error, a log, a
//     receipt, or a meta payload.
//   * shared-* / anthropic profiles fail closed (no host fallback; the
//     resolver returns null) per the frozen pi-native provider map.
//   * authorizedProject is host-owned: id + label are NEVER taken from
//     caller input. The caller supplies a root (or a full identity);
//     the wiring materializes the id + label.
//   * skillSourceRoot + stagingBase are host-owned absolute paths.
//     Defaults: <userRoot>/BrowserFirst/HostSkills, <userRoot>/Staging.

import { createHash } from "node:crypto";
import path from "node:path";
import {
  resolvePiNativeProvider,
} from "./pi-native-provider-map.mjs";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isStringRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultProjectId(root) {
  // Stable id from the canonical root; never a caller-supplied value.
  return `proj-${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
}

function defaultProjectLabel(root) {
  return path.basename(root) || "project";
}

/**
 * Build the host-side wiring for the terminal-host attach route.
 *
 * @param {object} [options]
 * @param {(profileId: string) => object | Promise<object | null>} [options.getProfile]
 *   Maps a profileId to the provider profile record used to compute
 *   the host-owned env-var name (via resolvePiNativeProvider). Must
 *   support built-in (openrouter, anthropic, zai, ollama, vllm) and
 *   shared-* identities. Defaults to a frozen pi-native map check
 *   (fails closed on shared-* / anthropic / unknown).
 * @param {(profile: object) => string | Promise<string | null>} [options.resolveSecret]
 *   Maps the profile record to the credential string. Returns null
 *   for absent secrets. The default reads from a session-only env
 *   (RESONANTOS_PROVIDER_SECRETS or {PROVIDER_ID}_API_KEY env vars).
 * @param {(input: { root: string }) => ({ id: string, label: string, root: string } | null) | Promise<({ id: string, label: string, root: string } | null)>} [options.resolveProjectIdentity]
 *   Translates a caller-supplied project root into the host-owned
 *   { id, label, root } triple. id + label are NEVER caller-controlled.
 *   The default synthesizes from the root: id = sha256(root) prefix,
 *   label = basename(root). Pass a custom function to read a real
 *   host-owned project store (e.g. userRoot/projects.json).
 * @param {(authorizedProject: { id: string, label: string, root: string }) => Array<object> | Promise<Array<object>>} [options.resolveSkillCatalog]
 *   Returns the skill catalog for an authorized project. Default: [].
 * @param {string} [options.skillSourceRoot]
 *   Absolute path to the host-owned skill source root. Default:
 *   <userRoot>/BrowserFirst/HostSkills.
 * @param {string} [options.stagingBase]
 *   Absolute path to the host-owned session staging base. Default:
 *   <userRoot>/Staging.
 * @param {string} [options.userRoot]
 *   Host user root. Default: env.RESONANTOS_BROWSER_FIRST_USER_ROOT
 *   or $HOME/ResonantOS_User.
 * @param {Record<string, string>} [options.env]
 *   Env to read secrets from. Default: process.env.
 *
 * @returns {{
 *   resolveCredential: (profileId: string) => ({ name: string, value: string } | null) | Promise<({ name: string, value: string } | null)>,
 *   resolveProjectIdentity: (input: { root: string }) => ({ id: string, label: string, root: string } | null) | Promise<({ id: string, label: string, root: string } | null)>,
 *   resolveSkillCatalog: (authorizedProject: { id: string, label: string, root: string }) => Array<object> | Promise<Array<object>>,
 *   skillSourceRoot: string,
 *   stagingBase: string,
 *   readonlyFrozen: true,
 * }}
 */
export function createTerminalHostHostWiring(options = {}) {
  const env = options.env ?? process.env;
  const userRoot = path.resolve(
    options.userRoot
      ?? env.RESONANTOS_BROWSER_FIRST_USER_ROOT
      ?? path.join(process.env.HOME ?? "/tmp", "ResonantOS_User")
  );
  const skillSourceRoot = path.resolve(
    options.skillSourceRoot
      ?? env.RESONANTOS_TERMINAL_HOST_SKILL_SOURCE
      ?? path.join(userRoot, "BrowserFirst", "HostSkills")
  );
  const stagingBase = path.resolve(
    options.stagingBase
      ?? env.RESONANTOS_TERMINAL_HOST_STAGING
      ?? path.join(userRoot, "Staging")
  );

  // Default: read the profile map from the frozen pi-native map. Real
  // host wiring in run-bridge passes a getProfile built on top of
  // allProviderProfiles() (provider-bridge-service) so user-added
  // accounts reach the same env-var gate.
  const getProfile = options.getProfile ?? (() => null);

  // Default secret resolver: env-first (RESONANTOS_PROVIDER_SECRETS is a
  // JSON blob, {PROVIDER_ID}_API_KEY is the legacy var). The host
  // wiring in run-bridge passes resolveSecret = (profile) =>
  // readProviderSecrets()[normalizeProviderId(profile.id)].
  const envSecretResolver = (profile) => {
    if (!isStringRecord(profile)) return null;
    const id = String(profile.id ?? "").trim();
    if (!id) return null;
    const blobRaw = env.RESONANTOS_PROVIDER_SECRETS;
    if (isNonEmptyString(blobRaw)) {
      try {
        const blob = JSON.parse(blobRaw);
        const value = blob?.[id];
        if (typeof value === "string" && value.length > 0) return value;
      } catch { /* fall through */ }
    }
    const direct = env[`${id.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_API_KEY`];
    if (typeof direct === "string" && direct.length > 0) return direct;
    return null;
  };
  const resolveSecret = options.resolveSecret ?? envSecretResolver;

  // validate-profile: ensure the profile record is recognized by the
  // frozen pi-native map. This is the choke-point that fails closed
  // for shared-* / anthropic / unknown identities. Async because the
  // host getProfile may itself be async (e.g. allProviderProfiles() in
  // provider-bridge-service).
  async function validatedProfile(profileId) {
    if (!isNonEmptyString(profileId)) return null;
    const profile = await Promise.resolve(getProfile(profileId));
    if (!isStringRecord(profile)) return null;
    const mapping = resolvePiNativeProvider(profile);
    if (!mapping) return null; // fail closed: shared-*, anthropic, unknown
    return profile;
  }

  // Project identity resolution. The id is host-derived (sha256 of
  // canonical root); the label is host-derived (basename). The caller
  // never controls id/label — the route only passes through a full
  // authorizedProject when the caller already supplied it.
  const resolveProjectIdentity = options.resolveProjectIdentity
    ?? (({ root }) => {
      if (!isNonEmptyString(root)) return null;
      const canonical = path.resolve(root);
      return {
        id: defaultProjectId(canonical),
        label: defaultProjectLabel(canonical),
        root: canonical,
      };
    });

  const resolveSkillCatalog = options.resolveSkillCatalog ?? (() => []);

  // Async resolver. The route's /terminal-host/session/attach handler
  // awaits this result once per request, then bridges the value into
  // the sync seam used by attachSessionEnv / buildProjectedSessionEnv
  // (Step 3 contract is sync). Returning a Promise here is the
  // deliberate split: host wiring can be async; step-3 stays sync.
  async function resolveCredential(profileId) {
    if (!isNonEmptyString(profileId)) return null;
    const profile = await validatedProfile(profileId);
    if (!profile) return null;
    const mapping = resolvePiNativeProvider(profile);
    if (!mapping || typeof mapping.envVar !== "string") return null;
    const value = await Promise.resolve(resolveSecret(profile));
    if (typeof value !== "string" || !value) return null;
    return { name: mapping.envVar, value };
  }

  return Object.freeze({
    resolveCredential,
    resolveProjectIdentity,
    resolveSkillCatalog,
    skillSourceRoot,
    stagingBase,
    readonlyFrozen: true,
  });
}

export const TERMINAL_HOST_HOST_WIRING_SYMBOL = Object.freeze({
  name: "createTerminalHostHostWiring",
  contract: "host-boundary",
});
