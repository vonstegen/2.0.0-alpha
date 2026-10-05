// pi-v1 External-CLI Harness Policy (XH2) — reviewed host code.
//
// Implements the Pi CLI on the generic external-CLI launcher. This
// module is the ONLY place that knows the Pi executable is called
// "pi" and is looked up via `piCommand()`. The generic launcher
// never imports this module by name; it pulls it from the
// reviewed-policy registry and dispatches through
// `policy.resolveExecutable()` / `policy.composeInvocation()`.

import { piCommand } from "../pi-runtime.mjs";

const PROMPT_ARGV_MAX_BYTES = 4096;

// Mirror of the POSIX single-quote escape used by the host. The
// generic launcher never shell-quotes — the policy owns the escape
// for the suffix it produces.
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Reviewed executable. Pi is allowlisted by `piCommand()` which
 * resolves to a regular executable file under a fixed install root
 * or `npm-global` sibling. The allowlist is the only path source;
 * the policy never reads PATH, the manifest, or the caller's argv.
 */
function resolvePiExecutable(input) {
  if (!input || typeof input.sessionId !== "string" || typeof input.hostProjectRoot !== "string") return null;
  const probe = piCommand(input.homeDirOverride ? { homeDir: input.homeDirOverride } : {});
  if (!probe) return null;
  if (typeof probe.command !== "string" || !probe.command.startsWith("/")) return null;
  return {
    command: probe.command,
    source: probe.source === "npm-install-g" ? "npm-global-sibling" : "fixed-install-root",
    note: "Pi CLI resolved via fixed-install-root allowlist",
  };
}

/**
 * Reviewed invocation. The harness-side `commandSuffix` is the Pi
 * CLI invocation, never the attach clause, never the bootstrap grant,
 * and never the credential value. For multi-line / oversize prompts
 * the host stages a 0600 prompt file and we use `pi @<file>`; for
 * short single-line prompts we argv-quote.
 */
export function composePiInvocation(input) {
  if (!input || typeof input.executable?.command !== "string") {
    throw new TypeError("pi policy: composeInvocation requires a reviewed executable");
  }
  if (typeof input.prompt !== "string") {
    throw new TypeError("pi policy: composeInvocation requires a string prompt");
  }
  const prompt = input.prompt;
  if (prompt.trim().length === 0) {
    throw new TypeError("pi policy: empty prompt");
  }
  const executable = input.executable.command;
  // Hard rule: a bare ambient command is never trusted. The reviewed
  // executable's path must be absolute (allowlist-only).
  if (!executable.startsWith("/")) {
    throw new TypeError("pi policy: composeInvocation requires an absolute executable path");
  }
  const promptFilePath = input.promptFilePath ?? null;
  const useFile = promptFilePath !== null && (
    prompt.includes("\n") || Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES
  );
  if (useFile) {
    return {
      commandSuffix: `${shellQuote(executable)} ${shellQuote(`@${promptFilePath}`)}`,
      auditSummary: `pi @<file> (${Buffer.byteLength(prompt, "utf8")} bytes)`,
    };
  }
  return {
    commandSuffix: `${shellQuote(executable)} ${shellQuote(prompt.trim())}`,
    auditSummary: `pi '<argv-quoted prompt>' (${Buffer.byteLength(prompt, "utf8")} bytes)`,
  };
}

/**
 * Build the reviewed pi-v1 policy. The `supportedProviderFamilies`
 * mirrors the Pi native provider identities; the host owns profile
 * resolution and will reject a profile that is not in
 * `resolvePiNativeProvider` (fail-closed).
 */
export function createPiHarnessPolicy() {
  return {
    contractVersion: 1,
    policyId: "pi-v1",
    harnessId: "pi",
    executablePolicyId: "pi-runtime-fixed-root",
    terminalRequirements: ["command", "environment", "lifecycle-events"],
    credentialPolicy: {
      source: "provider-profile",
      supportedProviderFamilies: ["openai", "anthropic", "minimax"],
      delivery: "session-environment",
    },
    promptDelivery: "file",
    supportsModelSelection: true,
    resolveExecutable: resolvePiExecutable,
    composeInvocation: composePiInvocation,
  };
}
