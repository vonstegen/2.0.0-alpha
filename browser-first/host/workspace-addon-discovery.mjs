// Generic workspace add-on discovery (SDK-DEMO-003 / P3).
//
// Scans a canonical repo location (`examples/sdk-demo/*/addon.json`) for
// `local-service` add-ons authored against the public `@resonantos/addon-sdk`
// manifest contract (`packages/addon-sdk/`). Each manifest is validated with
// `validateAddOnManifest`; only valid, local-service, endpoint-bearing
// manifests are exposed. The discovery layer is **purely declarative**:
//
//   - No `spawn`. Add-ons declare `service.entrypoint`; the operator starts
//     them. The bridge never launches an add-on.
//   - No `process.env` inheritance. Tokens minted for the bridge stay in the
//     bridge; the add-on's own loopback upstream is contacted same-origin.
//   - No self-granted capabilities. `requestedCapabilities` are authored with
//     `granted: false`; host grants live in the harness registry
//     (`browser-first/host/harness-registry.mjs`).
//
// `probeAvailability` performs a short, loopback-only, non-credentialed
// probe of each `service.entrypoint`'s `/health` route to derive `available`.
// This is purely a UI hint (the add-on card's "Open" button is disabled
// when unavailable). The probe never reaches the bridge or any non-loopback
// network, never carries a token, and never touches the add-on's request
// surfaces.

import { readFile, readdir, stat } from "node:fs/promises";
import { validateAddOnManifest } from "../../packages/addon-sdk/src/validation.ts";

const DEFAULT_DISCOVERY_ROOT = "examples/sdk-demo";
const PROBE_TIMEOUT_MS = 800;
const HEALTH_PROBE_PATH_HINT = "/health";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function asString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isLoopbackHostname(hostname) {
  if (typeof hostname !== "string" || !hostname) return false;
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTS.has(lower)) return true;
  if (lower.startsWith("127.")) return true;
  if (lower === "0.0.0.0") return true;
  return false;
}

function parseLoopbackOrigin(entrypoint) {
  if (typeof entrypoint !== "string") return null;
  try {
    const url = new URL(entrypoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isLoopbackHostname(url.hostname)) return null;
    return { origin: url.origin, hostname: url.hostname, port: url.port || (url.protocol === "https:" ? "443" : "80") };
  } catch {
    return null;
  }
}

function deriveProbePath(manifest) {
  const explicit = asString(manifest?.health?.endpoint);
  if (explicit) {
    try {
      const url = new URL(explicit);
      return url.pathname || HEALTH_PROBE_PATH_HINT;
    } catch {
      return HEALTH_PROBE_PATH_HINT;
    }
  }
  return HEALTH_PROBE_PATH_HINT;
}

function summarizeCapabilities(manifest) {
  const requested = Array.isArray(manifest?.requestedCapabilities) ? manifest.requestedCapabilities : [];
  return requested.map((grant) => ({
    capability: asString(grant?.capability),
    scope: asString(grant?.scope, "none"),
    revocationBehavior: asString(grant?.revocationBehavior, "hard-stop"),
    granted: Boolean(grant?.granted),
  }));
}

function summarizeGrantPresets(manifest) {
  const presets = Array.isArray(manifest?.grantPresets) ? manifest.grantPresets : [];
  return presets.map((preset) => ({
    id: asString(preset?.id),
    label: asString(preset?.label),
    description: asString(preset?.description),
    grants: Array.isArray(preset?.grants) ? preset.grants.map((grant) => ({
      capability: asString(grant?.capability),
      scope: asString(grant?.scope, "none"),
      revocationBehavior: asString(grant?.revocationBehavior, "hard-stop"),
      granted: Boolean(grant?.granted),
    })) : [],
  }));
}

/**
 * Read, validate, and project every `local-service` add-on manifest under
 * `repoRoot/examples/sdk-demo/<addon>/addon.json`. Returns a stable shape
 * suitable for the bridge route (`workspaceAddonManifests` array) and the
 * extension UI.
 *
 * @param {object} options
 * @param {string} options.repoRoot                absolute repo root
 * @param {string} [options.discoveryRelativePath] override the canonical
 *                                                  `examples/sdk-demo` path
 * @param {(manifestPath: string) => Promise<boolean>} [options.probeAvailability]
 *                                                  loopback probe for `available`
 * @param {typeof readdir} [options.fsReaddir]
 * @param {typeof readFile} [options.fsReadFile]
 * @param {typeof stat} [options.fsStat]
 */
export async function discoverWorkspaceAddonManifests({
  repoRoot,
  discoveryRelativePath = DEFAULT_DISCOVERY_ROOT,
  probeAvailability,
  fsReaddir = readdir,
  fsReadFile = readFile,
  fsStat = stat,
} = {}) {
  if (typeof repoRoot !== "string" || !repoRoot) {
    return { manifests: [], errors: [{ code: "missing-repo-root", message: "repoRoot is required." }] };
  }

  const discoveryRoot = `${repoRoot.replace(/\/+$/, "")}/${discoveryRelativePath.replace(/^\/+/, "")}`;
  let entries;
  try {
    const discoveryStat = await fsStat(discoveryRoot);
    if (!discoveryStat.isDirectory()) {
      return { manifests: [], errors: [{ code: "not-a-directory", path: discoveryRoot }] };
    }
    entries = await fsReaddir(discoveryRoot, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      // No demo folder is fine — the bridge runs cleanly without SDK-DEMO add-ons.
      return { manifests: [], errors: [] };
    }
    return { manifests: [], errors: [{ code: "discovery-failed", message: String(error?.message ?? error) }] };
  }

  const manifests = [];
  const errors = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = `${discoveryRoot}/${entry.name}/addon.json`;
    let raw;
    try {
      raw = await fsReadFile(manifestPath, "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      errors.push({ code: "manifest-unreadable", path: manifestPath, message: String(error?.message ?? error) });
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push({ code: "manifest-invalid-json", path: manifestPath, message: String(error?.message ?? error) });
      continue;
    }

    const validation = validateAddOnManifest(parsed, { source: "sideload" });
    const fatal = validation.issues.filter((issue) => issue.severity === "error");

    if (!isPlainObject(parsed) || parsed.runtimeType !== "local-service") continue;
    if (fatal.length) {
      errors.push({
        code: "manifest-validation-failed",
        path: manifestPath,
        addonId: parsed?.id,
        issues: fatal.map((issue) => `${issue.path}: ${issue.message}`),
      });
      continue;
    }

    const entrypoint = parsed?.service?.entrypoint;
    const parsedOrigin = parseLoopbackOrigin(entrypoint);
    if (!parsedOrigin) {
      errors.push({
        code: "manifest-entrypoint-not-loopback",
        path: manifestPath,
        addonId: parsed?.id,
        message: `service.entrypoint must be a loopback http(s) URL (got ${JSON.stringify(entrypoint)}).`,
      });
      continue;
    }

    const probePath = deriveProbePath(parsed);
    const available = typeof probeAvailability === "function"
      ? Boolean(await probeAvailability(manifestPath))
      : false;

    manifests.push({
      id: asString(parsed.id, entry.name),
      name: asString(parsed.name, entry.name),
      version: asString(parsed.version),
      manifestPath,
      entrypoint,
      origin: parsedOrigin.origin,
      probePath,
      runtimeType: parsed.runtimeType,
      mode: "workspace-addon",
      trust: "host-mediated workspace add-on",
      category: asString(parsed.category),
      available,
      surfaces: Array.isArray(parsed.surfaces) ? parsed.surfaces.map((surface) => ({
        id: asString(surface?.id),
        type: asString(surface?.type),
        label: asString(surface?.label),
        description: asString(surface?.description),
      })) : [],
      requestedCapabilities: summarizeCapabilities(parsed),
      grantPresets: summarizeGrantPresets(parsed),
      validation: {
        valid: validation.valid,
        warnings: validation.issues.filter((issue) => issue.severity === "warning").map((issue) => `${issue.path}: ${issue.message}`),
      },
    });
  }

  manifests.sort((a, b) => a.id.localeCompare(b.id));
  return { manifests, errors };
}

/**
 * Default availability probe — short, loopback-only, token-free HTTP GET to
 * `service.entrypoint`'s `health.endpoint` (or `/health` fallback). The
 * request carries no token, no cookies, no ACAO negotiation. A non-200
 * status or a network error makes the add-on `available: false`.
 *
 * Intentionally not a singleton; the host wires a per-discovery instance.
 */
export function createLoopbackHealthProbe({ fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS, abortControllerImpl = AbortController } = {}) {
  return async function probeAvailability(manifestPath) {
    // The probe needs the manifest's entrypoint; we look it up by reading the
    // manifest file the caller passed in. This keeps the probe API a single
    // boolean so the extension UI doesn't need a second field.
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = JSON.parse(raw);
      const entrypoint = parsed?.service?.entrypoint;
      const origin = parseLoopbackOrigin(entrypoint);
      if (!origin) return false;
      const probePath = deriveProbePath(parsed);
      const url = `${origin.origin}${probePath}`;
      const controller = new abortControllerImpl();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
          redirect: "manual",
        });
        return response.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  };
}