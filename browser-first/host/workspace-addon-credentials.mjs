// Generic host-owned workspace add-on credential provisioning (SDK-DEMO-003R T6).
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
// therefore never live in source control: the document is supplied via CLI
// arg, an env var, or a file the operator keeps outside the repository.
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
// configuration, never caller-supplied, and always validated loopback http(s).
//
// Lifecycle: credentials are read once at bridge startup (process memory), not
// per request, and are not regenerable or revocable at runtime. Rotation is
// restart-bound. See SDK-DEMO-003-ARCHITECTURE-MAP.md §T6 for the semantics.

import { readFile } from "node:fs/promises";

export const WORKSPACE_ADDON_CREDENTIAL_PURPOSES = Object.freeze(["bearer", "admin"]);

const CREDENTIALS_ARG = "workspace-addon-credentials";
const CREDENTIALS_FILE_ARG = "workspace-addon-credentials-file";
const CREDENTIALS_ENV = "RESONANTOS_WORKSPACE_ADDON_CREDENTIALS";
const CREDENTIALS_FILE_ENV = "RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function isString(value) {
  return typeof value === "string";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackHostname(hostname) {
  if (!isString(hostname) || !hostname) return false;
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(lower)) return true;
  if (lower.startsWith("127.")) return true;
  return lower === "0.0.0.0";
}

// Parse a loopback-only http(s) origin from a URL string. Returns
// { origin, hostname, port } or null. Mirrors the discovery guard so the admin
// URL derived here can never leave loopback.
export function parseLoopbackHttpOrigin(entrypoint) {
  if (!isString(entrypoint)) return null;
  try {
    const url = new URL(entrypoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isLoopbackHostname(url.hostname)) return null;
    return {
      origin: url.origin,
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? "443" : "80"),
    };
  } catch {
    return null;
  }
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

// Load the provisioning document, precedence:
//   1. --workspace-addon-credentials=<json>       (CLI arg)
//   2. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS      (env, JSON)
//   3. --workspace-addon-credentials-file=<path>   (CLI arg)
//   4. RESONANTOS_WORKSPACE_ADDON_CREDENTIALS_FILE (env, file path)
// A missing/malformed source yields {} (fail closed per add-on).
export async function loadWorkspaceAddonCredentials({ args, env = process.env, readFileFn = readFile } = {}) {
  const inlineArg = argValue(args, CREDENTIALS_ARG);
  const inline = isString(inlineArg) && inlineArg.trim()
    ? inlineArg
    : (isString(env?.[CREDENTIALS_ENV]) ? env[CREDENTIALS_ENV] : "");
  if (inline) return parseWorkspaceAddonCredentials(inline);

  const filePath = argValue(args, CREDENTIALS_FILE_ARG) ?? env?.[CREDENTIALS_FILE_ENV] ?? "";
  if (isString(filePath) && filePath.trim()) {
    try {
      return parseWorkspaceAddonCredentials(await readFileFn(filePath.trim(), "utf8"));
    } catch {
      return {};
    }
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
// capability: resolve an add-on's credential by (identity, purpose). It never
// accepts caller-supplied credential material — only identity + purpose (and
// the host's own authoritative manifest entrypoint for admin derivation).
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
