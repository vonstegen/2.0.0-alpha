// Intent citation: docs/architecture/ADR-050-native-and-addon-tool-tiers.md
//
// Single source of truth for the native-tool reserved prefixes and
// reserved literals that the addon manifest validator forbids when
// declaring an `AddOnToolDefinition.name`. The bridge, the validator,
// and any future tooling share this list.
//
// Categories of rejection (per ADR-050 §"Namespacing"):
//   1. Direct shadow:      name === <native capability>
//   2. Dotted-prefix shadow: name starts with <reserved prefix> + "."
//   3. Forbidden literal:   name === one of the reserved literals

/** Native-tool namespace prefixes (each implicitly followed by "."). */
export const NATIVE_TOOL_PREFIXES = Object.freeze([
  "research",
  "browser",
  "filesystem",
  "process",
  "provider",
  "archive",
  "delegation",
  "addon",
  "runner",
  "compute",
]);

/**
 * Native-tool capabilities (closed union; mirrors
 * `NativeToolCapability` in src/core/contracts.ts). Each member is a
 * fully-qualified native-tool name that no addon may use as a tool
 * name.
 */
export const NATIVE_TOOL_CAPABILITIES = Object.freeze([
  "research.search_api",
  "research.fetch_url",
  "browser.session",
  "filesystem.read",
  "filesystem.search",
  "filesystem.patch",
  "process.safe_command",
  "provider.probe",
  "provider.route_select",
  "archive.search",
  "archive.read",
  "archive.intake_write",
  "delegation.create_packet",
  "delegation.render_task_markdown",
  "delegation.dispatch",
  "delegation.monitor",
  "delegation.collect_artifacts",
  "delegation.verify_result",
  "addon.health_check",
  "addon.enable_disable",
  "runner.probe.passive",
  "runner.probe.executable",
  "runner.node.enroll",
  "runner.node.revoke",
  "runner.job.submit",
  "runner.job.cancel",
  "runner.job.status",
  "runner.command.safe",
  "runner.container.run",
  "runner.cleanroom.run",
  "runner.service.start",
  "runner.service.stop",
  "runner.artifact.read",
  "runner.artifact.write",
  "runner.artifact.export",
  "runner.network.egress",
  "runner.model.endpoint_probe",
]);

/**
 * Reserved literals — short names too dangerous to alias even though
 * they don't directly collide with a current native-tool name.
 */
export const NATIVE_TOOL_RESERVED_LITERALS = Object.freeze([
  "fs",
  "shell",
  "exec",
  "browser",
  "wallet",
  "filesystem",
  "process",
  "addon",
  "runner",
]);

/**
 * Classify an addon-declared tool name against the native-tool
 * reserved surface. Pure, no I/O.
 *
 * @param {string} toolName
 * @returns {{kind: string} & {toolName: string, nativeCapability?: string, prefix?: string}}
 */
export function classifyAddOnToolName(toolName) {
  if (typeof toolName !== "string" || toolName.length === 0) {
    return { kind: "none", toolName };
  }
  if (NATIVE_TOOL_CAPABILITIES.includes(toolName)) {
    return { kind: "direct-shadow", toolName, nativeCapability: toolName };
  }
  for (const prefix of NATIVE_TOOL_PREFIXES) {
    if (toolName === prefix || toolName.startsWith(`${prefix}.`)) {
      return { kind: "prefix-shadow", toolName, prefix };
    }
  }
  if (NATIVE_TOOL_RESERVED_LITERALS.includes(toolName)) {
    return { kind: "reserved-literal", toolName };
  }
  return { kind: "none", toolName };
}

export function isAddOnToolNameAllowed(toolName) {
  return classifyAddOnToolName(toolName).kind === "none";
}

export const __testing = { classifyAddOnToolName, isAddOnToolNameAllowed };
