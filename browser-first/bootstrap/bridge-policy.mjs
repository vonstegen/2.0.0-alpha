// CP-BR1: host-pinned bridge policy for the independent native bootstrap host.
//
// This module is the single owner of every process input the bootstrap host
// may use. ADR-047 and the CP-BR1 contract require:
//
//   * No caller-supplied executable, command, argv, shell string, script
//     path, working directory, endpoint, environment key, or environment
//     value. Callers of the lifecycle never see these knobs; they are
//     resolved here from the package's own location and Node/OS defaults.
//   * The bridge child is launched as
//       <pinned node> <pinned run-bridge-minimal.mjs> --bridge-port=47773
//     with `shell: false`, `detached: true`, and `stdio: "ignore"`.
//   * The child environment is an explicit allowlist built ONLY from
//     host-pinned constants and Node/OS-derived user directories.
//     `process.env` is never spread, and no provider credential, bridge
//     token, capability token, prompt, memory, or arbitrary user variable
//     is forwarded.
//
// Endpoint decision (CP-BR1): the authoritative Alpha loopback endpoint is
// http://127.0.0.1:47773. It matches `defaultBridgePort` in
// browser-first/host/run-bridge-minimal.mjs and `getBridgePort()` in
// browser-first/host/bridge-server.mjs. The historical
// DEFAULT_BRIDGE_ENDPOINT port 47800 in bridge-bootstrap.mjs was a dormant
// mismatch and is aligned to 47773 by CP-BR1.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BOOTSTRAP_PROTOCOL = "resonantos/bootstrap/v1";

/** Chrome native-messaging host identity. Pinned; must match the installed
 *  manifest file name (`<name>.json`) and the extension's connectNative
 *  argument (CP-BR2). Lowercase reverse-DNS, dots/underscores only. */
export const NATIVE_HOST_NAME = "com.resonantos.bridge_bootstrap";

/** Key-pinned unpacked Alpha extension identity. The native-host manifest
 *  pins `allowed_origins` to exactly this origin; no wildcard. */
export const ROS_EXTENSION_ID = "cdpdmmalhmokbfcfgogoepnjplaakgnl";
export const ROS_EXTENSION_ORIGIN = `chrome-extension://${ROS_EXTENSION_ID}/`;

/** Authoritative Alpha loopback endpoint. Host-pinned; the UI never chooses
 *  an arbitrary port. */
export const BRIDGE_HOST = "127.0.0.1";
export const BRIDGE_PORT = 47773;
export const BRIDGE_ENDPOINT = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

/** Fixed argv shape passed after the pinned entry. The port always matches
 *  BRIDGE_PORT; there is no caller path that can alter it. */
export const BRIDGE_ARGV = Object.freeze([`--bridge-port=${BRIDGE_PORT}`]);

/** PATH pinned for the bridge child. Documented per CP-BR1 §6.4: the bridge
 *  resolves reviewed helper executables (openssl for TLS material, optional
 *  local runtimes) through fixed executable roots; a host-pinned PATH keeps
 *  that lookup deterministic instead of inheriting an arbitrary browser or
 *  native-host environment. This matches the repository's documented Alpha
 *  toolchain PATH. */
export const PINNED_CHILD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/** Bounded lifecycle waits (milliseconds). All are hard bounds; no wait is
 *  unbounded. */
export const PROBE_TIMEOUT_MS = 1500;
export const START_HEALTH_TIMEOUT_MS = 10_000;
export const HEALTH_POLL_INTERVAL_MS = 250;
export const STOP_TIMEOUT_MS = 5000;
export const KILL_ESCALATION_TIMEOUT_MS = 2000;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the reviewed bridge entrypoint, derived from this
 *  package's own location. Never caller-supplied. */
export function bridgeEntryPath({ baseDir = moduleDir } = {}) {
  return path.resolve(baseDir, "..", "host", "run-bridge-minimal.mjs");
}

/** Absolute path to the repository root, derived from this package's own
 *  location. Pinned as the bridge child's working directory. */
export function repoRootPath({ baseDir = moduleDir } = {}) {
  return path.resolve(baseDir, "..", "..");
}

/** Absolute path to this package's native-host entry, used by the installer
 *  to generate the pinned wrapper script. */
export function nativeHostEntryPath({ baseDir = moduleDir } = {}) {
  return path.resolve(baseDir, "native-host-main.mjs");
}

/**
 * Build the bridge child environment allowlist. Every value is host-pinned
 * or derived from Node/OS user-directory resolution — never from ambient
 * `process.env`:
 *
 *   RESONANT_TERMINAL_HOST_BRIDGE=1
 *     The reviewed Alpha bridge composes the terminal-host service only
 *     under this flag (terminal-host-bridge-wiring.mjs); the Alpha product
 *     ships Terminal surfaces, so the bootstrap-started bridge enables it.
 *   HOME, TMPDIR
 *     Node/OS-resolved user directories (os.homedir()/os.tmpdir()) so the
 *     bridge's own os.homedir()-based user-state root resolves identically
 *     under a Chrome-launched (GUI) environment.
 *   PATH
 *     Host-pinned constant (PINNED_CHILD_PATH); see its doc comment.
 *
 * Provider credentials, bridge/capability tokens, generated bridge config,
 * prompt or memory values, RESONANTOS_* operator overrides, and arbitrary
 * user variables are deliberately absent. The bridge mints its own tokens
 * and writes bridge-config.generated.js itself; the bootstrap host never
 * reads or forwards them.
 *
 * @param {{ homeDir?: string, tmpDir?: string, pathValue?: string }} [overrides]
 *   Test seam. Production callers pass nothing.
 */
export function buildBridgeChildEnv(overrides = {}) {
  const homeDir = typeof overrides.homeDir === "string" && overrides.homeDir.length > 0
    ? overrides.homeDir
    : os.homedir();
  const tmpDir = typeof overrides.tmpDir === "string" && overrides.tmpDir.length > 0
    ? overrides.tmpDir
    : os.tmpdir();
  const pathValue = typeof overrides.pathValue === "string" && overrides.pathValue.length > 0
    ? overrides.pathValue
    : PINNED_CHILD_PATH;
  return Object.freeze({
    RESONANT_TERMINAL_HOST_BRIDGE: "1",
    HOME: homeDir,
    TMPDIR: tmpDir,
    PATH: pathValue,
  });
}

/**
 * Assemble the complete host-pinned policy consumed by the lifecycle.
 * `nodeExecutable` defaults to `process.execPath`: the installer pins the
 * absolute Node path in the native-host wrapper, so the host's own
 * executable IS the installer-pinned Node.
 *
 * @param {{
 *   nodeExecutable?: string,
 *   expectedBridgeVersion?: string | null,
 *   baseDir?: string,
 *   envOverrides?: Parameters<typeof buildBridgeChildEnv>[0],
 * }} [options]
 * @returns {{
 *   protocol: string,
 *   endpoint: string,
 *   bridgeEntry: string,
 *   bridgeArgv: readonly string[],
 *   bridgeCwd: string,
 *   nodeExecutable: string,
 *   childEnv: Readonly<Record<string, string>>,
 *   expectedBridgeVersion: string | null,
 *   timeouts: { probeMs: number, startHealthMs: number, healthPollMs: number, stopMs: number, killEscalationMs: number },
 * }}
 */
export function createBridgePolicy(options = {}) {
  const nodeExecutable = typeof options.nodeExecutable === "string" && options.nodeExecutable.length > 0
    ? options.nodeExecutable
    : process.execPath;
  const policy = {
    protocol: BOOTSTRAP_PROTOCOL,
    endpoint: BRIDGE_ENDPOINT,
    bridgeEntry: bridgeEntryPath({ baseDir: options.baseDir }),
    bridgeArgv: BRIDGE_ARGV,
    bridgeCwd: repoRootPath({ baseDir: options.baseDir }),
    nodeExecutable,
    childEnv: buildBridgeChildEnv(options.envOverrides),
    expectedBridgeVersion: typeof options.expectedBridgeVersion === "string" && options.expectedBridgeVersion.length > 0
      ? options.expectedBridgeVersion
      : null,
    timeouts: {
      probeMs: PROBE_TIMEOUT_MS,
      startHealthMs: START_HEALTH_TIMEOUT_MS,
      healthPollMs: HEALTH_POLL_INTERVAL_MS,
      stopMs: STOP_TIMEOUT_MS,
      killEscalationMs: KILL_ESCALATION_TIMEOUT_MS,
    },
  };
  return Object.freeze(policy);
}

/**
 * Fail-closed policy sanity check used by the native host entry and the
 * installer: the pinned entrypoint and the pinned Node executable must
 * exist. Returns a list of public-safe problem tokens (never paths).
 *
 * @param {ReturnType<typeof createBridgePolicy>} policy
 * @param {{ existsSyncImpl?: typeof existsSync }} [seams]
 * @returns {string[]} empty when the policy is usable
 */
export function policyProblems(policy, { existsSyncImpl = existsSync } = {}) {
  const problems = [];
  if (!policy || typeof policy !== "object") return ["policy-missing"];
  if (typeof policy.bridgeEntry !== "string" || !path.isAbsolute(policy.bridgeEntry)) problems.push("entry-not-absolute");
  else if (!existsSyncImpl(policy.bridgeEntry)) problems.push("entry-missing");
  if (typeof policy.nodeExecutable !== "string" || !path.isAbsolute(policy.nodeExecutable)) problems.push("node-not-absolute");
  if (typeof policy.bridgeCwd !== "string" || !path.isAbsolute(policy.bridgeCwd)) problems.push("cwd-not-absolute");
  return problems;
}
