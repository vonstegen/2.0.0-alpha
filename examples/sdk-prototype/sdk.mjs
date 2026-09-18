// ResonantOS Prototype SDK — minimal, self-contained, runnable reference.
//
// This file demonstrates the core of the Resonant Extension Framework in a way a
// community leader can hand to an agentic AI agent: manifest validation, the
// Public / Privileged / Core-only capability split, deny-by-default grants,
// caller-attributed tool execution, and a prepare/propose boundary.
//
// This is a DEMO prototype, not the production SDK (which lives in
// src/sdk/addons and is governed by ADR-018). It intentionally mirrors the
// production manifest vocabulary so a plugin authored here maps to the real SDK.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Capability taxonomy — mirrors the roadmap's Public / Privileged / Core-only.
export const CAPABILITY_CLASSES = Object.freeze({
  public: Object.freeze([
    "notifications",
    "archive-read",
    "archive-intake-write",
    "task-delegate",
    "network",
    "agent-delegation",
    "chat-interface",
  ]),
  privileged: Object.freeze(["providers", "browser-commit", "credential-broker"]),
  coreOnly: Object.freeze([
    "policy-override",
    "trust-root-modify",
    "credential-export",
    "ground0-replace",
  ]),
});

const ALL_CAPABILITIES = new Set([
  ...CAPABILITY_CLASSES.public,
  ...CAPABILITY_CLASSES.privileged,
  ...CAPABILITY_CLASSES.coreOnly,
]);

const REQUIRED_FIELDS = [
  "id",
  "name",
  "version",
  "author",
  "category",
  "description",
  "runtimeType",
  "entry",
  "requestedCapabilities",
  "tools",
];

export class SdkError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SdkError";
    this.details = details;
  }
}

export function capabilityClass(capability) {
  if (CAPABILITY_CLASSES.public.includes(capability)) return "public";
  if (CAPABILITY_CLASSES.privileged.includes(capability)) return "privileged";
  if (CAPABILITY_CLASSES.coreOnly.includes(capability)) return "core-only";
  return null;
}

export function validateManifest(manifest) {
  const errors = [];
  for (const field of REQUIRED_FIELDS) {
    if (manifest[field] === undefined) errors.push(`missing required field: ${field}`);
  }
  if (manifest.id && !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id)) {
    errors.push(`invalid id: ${manifest.id}`);
  }
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`invalid semver version: ${manifest.version}`);
  }

  const requested = manifest.requestedCapabilities ?? [];
  for (const capability of requested) {
    if (!ALL_CAPABILITIES.has(capability)) {
      errors.push(`unknown capability: ${capability}`);
    }
    if (capabilityClass(capability) === "core-only") {
      errors.push(`core-only capability cannot be requested by an add-on: ${capability}`);
    }
  }

  for (const tool of manifest.tools ?? []) {
    if (!tool.name || !tool.description) {
      errors.push(`every tool must declare a name and description`);
    }
    for (const capability of tool.requiredCapabilities ?? []) {
      if (!requested.includes(capability)) {
        errors.push(
          `tool ${tool.name} requires capability "${capability}" not declared in requestedCapabilities`,
        );
      }
    }
  }

  if (errors.length) {
    throw new SdkError(`manifest validation failed: ${errors.join("; ")}`, { errors });
  }
  return true;
}

export async function loadPlugin(pluginDir, { grantedCapabilities = [] } = {}) {
  const dir = resolve(pluginDir);
  const manifestPath = resolve(dir, "plugin.json");

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new SdkError(`unable to read plugin.json in ${dir}`, { cause: error.message });
  }
  validateManifest(manifest);

  // Deny-by-default: nothing is granted unless the host passes it explicitly.
  // Public capabilities are safe to grant; Privileged capabilities require a
  // reviewed host decision. Core-only capabilities are never grantable.
  const granted = grantedCapabilities.filter((capability) => {
    const cls = capabilityClass(capability);
    return cls === "public" || cls === "privileged";
  });

  const entryPath = resolve(dir, manifest.entry);
  let module;
  try {
    module = await import(pathToFileURL(entryPath).href);
  } catch (error) {
    throw new SdkError(`unable to import plugin entry ${manifest.entry}`, { cause: error.message });
  }

  const activator = module.default ?? module;
  if (typeof activator.activate !== "function") {
    throw new SdkError(`plugin entry must export an activate(context) function: ${manifest.entry}`);
  }

  const context = {
    manifest,
    granted,
    capabilityClass,
    // Prepare is not commit: a plugin can propose an action, but the host
    // (or a human) owns the commit boundary.
    propose: (record) => ({ status: "proposed", record }),
  };

  const instance = await activator.activate(context);

  return {
    manifest,
    granted,
    instance,
    tools: instance.tools ?? {},
    warnings: requestedWarnings(manifest, granted),
    async enable() {
      return instance.onEnable ? instance.onEnable() : { ok: true };
    },
    async disable() {
      return instance.onDisable ? instance.onDisable() : { ok: true };
    },
  };
}

function requestedWarnings(manifest, granted) {
  const warnings = [];
  for (const capability of manifest.requestedCapabilities ?? []) {
    if (capabilityClass(capability) === "privileged" && !granted.includes(capability)) {
      warnings.push(`privileged capability requested but not granted: ${capability}`);
    }
  }
  return warnings;
}

export async function runTool(plugin, toolName, args = {}) {
  const declaration = plugin.manifest.tools.find((tool) => tool.name === toolName);
  if (!declaration) return { ok: false, error: `unknown tool: ${toolName}` };

  const missing = (declaration.requiredCapabilities ?? []).filter(
    (capability) => !plugin.granted.includes(capability),
  );
  if (missing.length) {
    return {
      ok: false,
      error: `tool ${toolName} requires ungranted capabilities: ${missing.join(", ")}`,
    };
  }

  const impl = plugin.tools[toolName];
  if (typeof impl !== "function")
    return { ok: false, error: `tool ${toolName} has no implementation` };

  try {
    const result = await impl(args, { manifest: plugin.manifest, granted: plugin.granted });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export function describePlugin(plugin) {
  return {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    granted: plugin.granted,
    warnings: plugin.warnings,
    tools: plugin.manifest.tools.map((tool) => tool.name),
  };
}
