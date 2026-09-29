// Generic host-owned workspace add-on credential provisioning (SDK-DEMO-003R T6,
// hardened in T6.1 credential-boundary hardening).
//
// Replaces the demo-specific per-add-on credential wiring
// (`workspaceAddonBearerTokens` / `workspaceAddonAdminTokens` maps plus the
// `--echo-*` / `--counter-*` / `--sdk-guide-*` flags) with a single typed,
// provider/add-on-neutral resolver. Callers name *what they want*
// (`addon identity + credential purpose`) and the host resolves the *material*.
//
// Purposes (the only two credential classes a workspace add-on has):
//   - "bearer" — the add-on-scoped capability token delivered to the sandboxed
//     iframe in the bootstrap envelope for each host-granted capability. It is
//     designed to cross into that one add-on/capability boundary and nowhere else.
//   - "admin"  — the host-only admin credential + upstream admin URL used to
//     drive the add-on upstream's `/admin/deny` enforcement flag. It is NEVER
//     delivered to the iframe, status projection, or bootstrap envelope.
//
// Backing store: environment/config-backed only. There is no encrypted vault.
// The operator supplies ONE provisioning document (JSON) keyed by add-on id;
// both the bridge (resolver) and the operator-started add-on upstreams
// (`resolveProvisionedWorkspaceAddonCredential`) read the same document, so a
// value provisioned host-side is the same value the upstream enforces. Secrets
// therefore never live in source control.
//
// T6.1 provisioning sources — NO raw secret material in argv:
//   * The historical `--workspace-addon-credentials=<json>` flag is removed and
//     is NOT read. If present it is ignored; the resolver fails closed to an
//     empty table. There is no replacement raw-secret argv flag.
//   * A CLI *file reference* is supported (a path, not credential material):
//     `--workspace-addon-credentials-file=<path>`.
//   * Environment JSON remains supported for this milestone:
//     `RESONANTOS_WORKSPACE_ADDON_CREDENTIALS`. Environment variables are
//     process-level host configuration, NOT an encrypted vault; treat them as
//     plaintext host state, not a secret store.
//   Precedence (highest first):
//     1. --workspace-addon-credentials-file=<path>        (CLI file reference)
//     2. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE       (env, file path)
//     3. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS            (env, JSON)
//     4. {} — fail closed per add-on
//   Credential-file permissions/ownership are NOT enforced here; owner-only
//   (0600) / ownership enforcement is recorded as future hardening. Do not
//   claim secure file permissions.
//
// Document shape (all values are non-empty strings):
//   {
//     "addon.resonant-echo": {
//       "bearer": "<add-on-scoped capability token>",
//       "adminToken": "<host-only admin token>",
//       "adminUrl": "http://127.0.0.1:47321/admin/deny"   // OPTIONAL host config
//     }
//   }
//
// `adminUrl` is optional: when absent, the resolver derives it from the
// validated manifest `service.entrypoint` + `/admin/deny`. It is always host
// configuration, never caller-supplied, and always validated TRUE-loopback
// http(s): 127.0.0.0/8, ::1, or localhost. `0.0.0.0` (bind-any) and any other
// non-loopback host are rejected.
//
// TRUST SEMANTICS. `resolveWorkspaceAddonCredential(addonId, purpose)` is an
// internal host-owned lookup: it resolves material BY add-on id, but it does
// NOT authenticate the identity of an arbitrary caller — it trusts that the
// caller already holds the add-on identity it is asking for. Add-on isolation
// therefore comes from the trusted host call sites, not from the resolver:
//   * the resolver is never exposed to the iframe or to an add-on;
//   * privileged bridge routes are capability-gated at the host-service layer;
//   * production call sites pass the add-on id from the host lifecycle's own
//     registry/install state, never from caller-controlled input;
//   * the manifest entrypoint used for admin derivation comes from the
//     host-owned discovery/install cache;
//   * caller-supplied credential material can never override host provisioning
//     (unknown fields on the resolution request are ignored).
//
// Lifecycle: credentials are read once at bridge startup (process memory), not
// per request, and are not regenerable or revocable at runtime. Rotation is
// restart-bound. See SDK-DEMO-003-ARCHITECTURE-MAP.md §T6 for the semantics.

import { readFile } from "node:fs/promises";
import { parseLoopbackHttpOrigin } from "./loopback-url.mjs";

export const WORKSPACE_ADDON_CREDENTIAL_PURPOSES = Object.freeze(["bearer", "admin"]);

const CREDENTIALS_FILE_ARG = "workspace-addon-credentials-file";
const CREDENTIALS_ENV = "RESONANTOS_WORKSPACE_ADDON_CREDENTIALS";
const CREDENTIALS_FILE_ENV = "RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE";

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function isString(value) {
  return typeof value === "string";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Derive the host-only admin endpoint from the add-on's validated manifest
// entrypoint. The entrypoint is already loopback-validated by discovery before
// the manifest is cached/installed, but this re-validates defensively.
export function deriveUpstreamAdminUrl(entrypoint, addonId) {
  const origin = parseLoopbackHttpOrigin(entrypoint);
  if (!origin) {
    throw fail(
      "credential-unavailable",
      `Cannot derive the admin endpoint for ${addonId}: no loopback http(s) entrypoint.`,
    );
  }
  return `${origin.origin}/admin/deny`;
}

// Normalize a provisioning document into { [addonId]: { bearer, adminToken, adminUrl } }.
// Unknown/non-string material is dropped so a malformed entry fails closed
// (no credentials) rather than leaking a non-secret through.
export function normalizeWorkspaceAddonCredentials(document) {
  if (!isPlainObject(document)) return {};
  const table = {};
  for (const [addonId, raw] of Object.entries(document)) {
    if (!isString(addonId) || !addonId || !isPlainObject(raw)) continue;
    const bearer = isString(raw.bearer) ? raw.bearer.trim() : "";
    const adminToken = isString(raw.adminToken) ? raw.adminToken.trim() : "";
    const adminUrl = isString(raw.adminUrl) ? raw.adminUrl.trim() : "";
    if (!bearer && !adminToken && !adminUrl) continue;
    table[addonId] = { bearer, adminToken, adminUrl };
  }
  return table;
}

// Parse a JSON provisioning document. Malformed JSON/non-object input yields
// an empty table (fail closed) — no credential is ever invented.
export function parseWorkspaceAddonCredentials(source) {
  if (!isString(source) || !source.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return {};
  }
  return normalizeWorkspaceAddonCredentials(parsed);
}

function argValue(args, name) {
  return args && typeof args.get === "function" ? args.get(name) : undefined;
}

// Load the provisioning document. NO raw secret material is read from argv:
// the only argv-based source is a CLI file *reference* (a path, not credential
// material). Precedence (highest first):
//   1. --workspace-addon-credentials-file=<path>        (CLI file reference)
//   2. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE       (env, file path)
//   3. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS            (env, JSON)
//   4. {} — fail closed per add-on
// A missing/malformed source yields {} (fail closed per add-on).
export async function loadWorkspaceAddonCredentials({ args, env = process.env, readFileFn = readFile } = {}) {
  const filePath = argValue(args, CREDENTIALS_FILE_ARG) ?? env?.[CREDENTIALS_FILE_ENV] ?? "";
  if (isString(filePath) && filePath.trim()) {
    try {
      return parseWorkspaceAddonCredentials(await readFileFn(filePath.trim(), "utf8"));
    } catch {
      return {};
    }
  }
  const envJson = env?.[CREDENTIALS_ENV];
  if (isString(envJson) && envJson.trim()) {
    return parseWorkspaceAddonCredentials(envJson);
  }
  return {};
}

function validateAdminUrl(url, addonId) {
  if (!parseLoopbackHttpOrigin(url)) {
    throw fail(
      "credential-unavailable",
      `Admin endpoint for ${addonId} is not a loopback http(s) URL; refusing to send host-only credentials there.`,
    );
  }
  return url;
}

// Typed host-owned resolver factory. The returned resolver exposes a single
// lookup capability: resolve an add-on's credential by (identity, purpose).
// It is an internal host lookup — it does NOT authenticate the caller; it
// trusts the caller already holds the add-on identity (see the header TRUST
// SEMANTICS). It never accepts caller-supplied credential material — only
// identity + purpose (and the host's own authoritative manifest entrypoint for
// admin derivation).
export function createWorkspaceAddonCredentialResolver({ credentials = {} } = {}) {
  const table = normalizeWorkspaceAddonCredentials(credentials);

  function resolveWorkspaceAddonCredential({ addonId, purpose, manifestEntrypoint } = {}) {
    if (!isString(addonId) || !addonId) {
      throw fail("invalid-event", "Workspace add-on credential resolution requires an addonId.");
    }
    if (!WORKSPACE_ADDON_CREDENTIAL_PURPOSES.includes(purpose)) {
      throw fail("invalid-event", `Unknown workspace add-on credential purpose: ${String(purpose)}.`);
    }
    const entry = table[addonId];
    if (!entry) {
      throw fail("credential-unavailable", `No provisioned credential for workspace add-on: ${addonId}.`);
    }
    if (purpose === "bearer") {
      if (!entry.bearer) {
        throw fail("credential-unavailable", `No provisioned bearer credential for workspace add-on: ${addonId}.`);
      }
      // Bearer is the only credential allowed to cross into the iframe boundary;
      // never return admin material here.
      return { addonId, purpose, token: entry.bearer };
    }
    // purpose === "admin" — host-only.
    if (!entry.adminToken) {
      throw fail("credential-unavailable", `No provisioned admin credential for workspace add-on: ${addonId}.`);
    }
    const upstreamAdminUrl = entry.adminUrl || deriveUpstreamAdminUrl(manifestEntrypoint, addonId);
    return { addonId, purpose, upstreamAdminUrl: validateAdminUrl(upstreamAdminUrl, addonId), adminToken: entry.adminToken };
  }

  return { resolveWorkspaceAddonCredential };
}

// Add-on upstream (server) helper. Reads the same provisioning document and
// returns this add-on's own { bearer, adminToken }. The `adminUrl` field is
// host-only and is intentionally never returned here.
export async function resolveProvisionedWorkspaceAddonCredential(addonId, options = {}) {
  const table = await loadWorkspaceAddonCredentials(options);
  const entry = table[addonId];
  return { bearer: entry?.bearer ?? "", adminToken: entry?.adminToken ?? "" };
}
