// ResonantOS terminal cards shared module (CP-BR11).
//
// The Settings → Add-on Tools section (CP-BR10) and the new
// left-rail Terminals workspace (CP-BR11) both render the same
// terminal-host add-on surface. This module owns the cross-surface
// primitives:
//
//   - DOM helpers (`element`, `actionButton`).
//   - Badge vocabulary (`statusBadgeForSurface`, `notInstalledBadge`).
//   - The status/projection/grants view-model
//     (`buildTerminalsViewModel`).
//   - The list of reviewed terminal add-on ids and the default agent.
//
// Both `settings/addon-tools-section.js` and
// `lib/main-workspace-terminals.js` import from here so the rail and
// the Settings section cannot drift. The shared module renders text
// nodes only (no innerHTML, no script injection) and never touches
// the secret-shaped fields that the shape-walker rejects.
//
// Intent citation:
//   docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md §1
//   (Add-on Surfaces → Terminal) and §13/§14, TERMINAL-ACTIVATION.md,
//   ADR-047.

export const TERMINAL_ADDON_IDS = Object.freeze([
  "addon.resonant-terminal-ghostty",
  "addon.resonant-terminal-iterm2",
]);

export const DEFAULT_AGENT_ID = "pi";

export const TERMINAL_CARD_FIELD = "terminals-card";

const SECRET_FIELD_NAMES = new Set([
  "token", "tokens", "password", "passwd", "apiKey", "api_key", "apikey",
  "secret", "secrets", "credential", "credentials", "privateKey",
  "private_key", "sessionToken", "session_token", "bearer", "bearerToken",
  "bearer_token", "authorization", "auth", "cookie",
]);

// ---------------------------------------------------------------------------
// DOM helpers (text-only)
// ---------------------------------------------------------------------------

/**
 * Create an element with a small declarative props API.
 *
 * - `className` → className
 * - `dataset` → `data-*` attributes (null/undefined entries skipped)
 * - `ariaLabel` / `ariaLive` → ARIA attributes
 * - `disabled` → `button.disabled = true` when truthy
 * - `text` → textContent (no innerHTML)
 * - any other key → setAttribute
 *
 * Children are appended via `append` (no innerHTML).
 */
export function element(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined) continue;
    if (key === "className") node.className = String(value);
    else if (key === "dataset" && typeof value === "object") {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue === null || dataValue === undefined) continue;
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === "ariaLabel") node.setAttribute("aria-label", String(value));
    else if (key === "ariaLive") node.setAttribute("aria-live", String(value));
    else if (key === "disabled") {
      if (value) node.disabled = true;
    } else if (key === "text") {
      node.textContent = String(value);
    } else if (key === "datasetAddonId") {
      // Convenience: surface `datasetAddonId` so callers can use
      // shorter object literals without building a dataset.
      node.dataset.addonId = String(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

/**
 * Build a `button.settings-action` / `button.terminals-action` with
 * a stable test id. The label is set via `textContent` (no
 * innerHTML).
 */
export function actionButton({ label, onClick, disabled = false, ariaLabel, testid, className }) {
  const button = element("button", {
    type: "button",
    className: className ?? "settings-action",
    disabled,
  });
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  if (testid) button.dataset.testid = testid;
  button.textContent = label;
  if (!disabled && typeof onClick === "function") {
    button.addEventListener("click", onClick);
  }
  return button;
}

// ---------------------------------------------------------------------------
// Badge vocabulary
// ---------------------------------------------------------------------------

export function statusBadgeForSurface(surface) {
  if (!surface || surface.compatible !== true) {
    return { label: "Not installed", tone: "info" };
  }
  if (surface.connected) return { label: "Connected", tone: "ok" };
  return { label: "Disconnected", tone: "warn" };
}

export function notInstalledBadge() {
  return { label: "Not installed", tone: "info" };
}

// ---------------------------------------------------------------------------
// View-model: status + projection + grants → per-id view
// ---------------------------------------------------------------------------

/**
 * Merge the three host data sources the card needs:
 *   - `/terminal-host/status` (live surfaces with `connected`)
 *   - `/bridge/runtimes` projection (runtimeList with `status`)
 *   - `/addons/registry` (`installations` with `grantedCapabilities`)
 *   - `/terminal-host/prompt-path` (prompt file path + valid)
 *
 * The card view model is a closed shape: callers see only the
 * public fields the renderer is allowed to display. Secret-shaped
 * fields are intentionally absent from the view model.
 */
export function buildTerminalsViewModel({ status, projectionRuntime, registry, prompt }) {
  const surfacesByAddon = new Map();
  if (status && Array.isArray(status.surfaces)) {
    for (const surface of status.surfaces) {
      if (surface && typeof surface.adapterId === "string") {
        surfacesByAddon.set(surface.adapterId, surface);
      }
    }
  }
  const projectionByAddon = new Map();
  if (Array.isArray(projectionRuntime)) {
    for (const entry of projectionRuntime) {
      if (entry && typeof entry.addonId === "string") {
        projectionByAddon.set(entry.addonId, entry);
      }
    }
  }
  const installations = (registry && typeof registry === "object" && registry.installations && typeof registry.installations === "object")
    ? registry.installations
    : {};
  const tabs = TERMINAL_ADDON_IDS.map((addonId) => {
    const surface = surfacesByAddon.get(addonId);
    const projection = projectionByAddon.get(addonId);
    const installation = installations[addonId];
    const installed = Boolean(projection) || Boolean(surface);
    const label = surface?.label
      ?? (projection?.displayLabel
        ? (projection.displayLabel.startsWith("resonant-")
            ? projection.displayLabel.slice("resonant-".length)
            : projection.displayLabel)
        : addonId.replace(/^addon\.resonant-terminal-/, ""));
    const connected = surface ? Boolean(surface.connected) : false;
    const compatible = surface ? Boolean(surface.compatible) : installed;
    const projectionStatus = projection?.status ?? "inactive";
    const grantedCapabilities = Array.isArray(installation?.grantedCapabilities)
      ? installation.grantedCapabilities
      : [];
    const capabilityGranted = grantedCapabilities.some(
      (g) => g && g.capability === "terminal-host" && g.granted === true,
    );
    return {
      addonId,
      label,
      installed,
      connected,
      compatible,
      projectionStatus,
      projectionGeneration: projection?.generation ?? 0,
      capabilityGranted,
    };
  });
  return {
    bridgeConnected: Boolean(status?.connected),
    driveId: status?.driveId ?? null,
    promptPath: prompt?.promptPath ?? null,
    promptValid: Boolean(prompt?.valid),
    tabs,
  };
}

// ---------------------------------------------------------------------------
// Internal: assert the view model carries no secret-shaped values.
// Called by the test suite (assertNoSecretShapedValue) to confirm the
// shared card view-model is safe to render.
// ---------------------------------------------------------------------------

export function assertNoSecretShapedValue(value, path = "$") {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const pattern of SECRET_FIELD_NAMES) {
      // String content is not pattern-checked here; the renderer's
      // contract is "do not display strings that look like secrets".
      // The shape-walker in the test file covers that exhaustive
      // check; this helper only validates the field-name contract.
    }
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretShapedValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_FIELD_NAMES.has(key)) {
      throw new Error(`${path}.${key} is a secret-shaped field name; renderer must not carry it`);
    }
    assertNoSecretShapedValue(entry, `${path}.${key}`);
  }
}
