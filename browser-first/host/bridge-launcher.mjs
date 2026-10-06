// DEPRECATED CP-BR0 IMPLEMENTATION EVIDENCE — not a bootstrap boundary.
//
// This launcher is intentionally unreachable from bridge routes and UI. A
// stopped bridge cannot serve a route that starts itself. CP-BR1 may reuse its
// probe-first, env-allowlist, and bounded-polling ideas inside the independent
// native-messaging bootstrap host after correcting spawn ownership, generation
// fencing, concurrent-start handling, and timeout cleanup.
//
// Hard rules (CP-LBa invariants):
//   * Probe first via the existing `ensureBridgeReachable`. The probe
//     is the single owner of bridge health-checking; this module never
//     inlines a second probe.
//   * Already-running short-circuits with `alreadyRunning: true` and
//     NO spawn. Idempotent on repeated clicks.
//   * On `bridge-not-running`, spawns a detached child
//     (`detached: true`, `stdio: "ignore"`, `child.unref()`) so the
//     bridge outlives the launching host. The spawn argv is pinned:
//     `process.execPath <bridgeEntry> --bridge-port=<port>`. The
//     port is derived from the `endpoint`, never from the caller.
//   * Minimal env allowlist ONLY:
//       `RESONANT_TERMINAL_HOST_BRIDGE=1`,
//       `RESONANT_TERMINAL_DRIVER` (when present in `env`),
//       `PATH` (when present in `env`).
//     `process.env` is never spread. Token, credential, prompt file,
//     or provider secret values never enter the child env.
//   * Polls `probe` on a bounded interval (250 ms) up to
//     `timeoutMs`. Healthy → success receipt. Spawn error / timeout
//     → typed `{ ok: false, reason: "bridge-start-failed" }`.
//   * Never reads `bridge-config.generated.js`, any token, any
//     credential, any prompt file, or any provider secret. The
//     response is strictly `{ ok, alreadyRunning?, endpoint,
//     version, pid? }` on success, or
//     `{ ok: false, reason: "bridge-start-failed", endpoint, code? }`
//     on failure.

import { spawn } from "node:child_process";
import { URL } from "node:url";
import { ensureBridgeReachable as defaultEnsureBridgeReachable } from "./bridge-bootstrap.mjs";

const POLL_INTERVAL_MS = 250;

/**
 * Test seam. Tests may reassign this module-level export to swap in
 * a fake launchBridge without redefining the module's named export
 * (ESM forbids re-defining own properties of a module namespace
 * object). Production code NEVER reads this seam — it always calls
 * the named `launchBridge` defined below.
 */
export const __launchBridgeForTest = { value: null };

/**
 * @typedef {Object} LaunchBridgeArgs
 * @property {string} endpoint                  Absolute loopback URL, e.g. http://127.0.0.1:47773
 * @property {string} bridgeEntry               Pinned absolute path to run-bridge-minimal.mjs
 * @property {NodeJS.ProcessEnv} env            Minimal allowlist (see CP-LBa invariants)
 * @property {(args: { endpoint: string, timeoutMs?: number }) => Promise<{ ok: true, version: string | null, endpoint: string } | { ok: false, reason: "bridge-not-running", endpoint: string, code?: string }>} [probe]
 * @property {typeof spawn} [spawnImpl]         Test seam (node:child_process spawn)
 * @property {number} [timeoutMs=10_000]        Bounded healthy-window
 */

/**
 * @typedef {{ ok: true, alreadyRunning: true, endpoint: string, version: string | null }
 *          | { ok: true, alreadyRunning: false, endpoint: string, version: string | null, pid: number }
 *          | { ok: false, reason: "bridge-start-failed", endpoint: string, code?: string }}
 * LaunchBridgeResult
 */

/**
 * Minimal env allowlist enforced on the spawn. The launcher is
 * forbidden from passing caller-supplied credential, token, secret,
 * or arbitrary env keys. Only the keys the bridge actually needs to
 * compose `terminal-host-service` and to resolve its PATH are
 * forwarded.
 */
function buildChildEnv(env) {
  const allow = {
    RESONANT_TERMINAL_HOST_BRIDGE: "1",
  };
  if (typeof env?.RESONANT_TERMINAL_DRIVER === "string" && env.RESONANT_TERMINAL_DRIVER.length > 0) {
    allow.RESONANT_TERMINAL_DRIVER = env.RESONANT_TERMINAL_DRIVER;
  }
  if (typeof env?.PATH === "string" && env.PATH.length > 0) {
    allow.PATH = env.PATH;
  }
  return allow;
}

/**
 * Derive the `--bridge-port=<port>` argument from `endpoint`. The
 * port MUST come from the endpoint URL (which the caller controls
 * already via the loopback check) — never from caller-supplied
 * arbitrary input.
 */
function portFromEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Launch the pinned bridge entry, probe its loopback endpoint, and
 * return a non-secret receipt when the bridge becomes healthy.
 *
 * @param {LaunchBridgeArgs} args
 * @returns {Promise<LaunchBridgeResult>}
 */
export async function launchBridge({
  endpoint,
  bridgeEntry,
  env,
  probe = defaultEnsureBridgeReachable,
  spawnImpl = spawn,
  timeoutMs = 10_000,
} = {}) {
  // 1. Probe first. Healthy → short-circuit with `alreadyRunning: true`.
  const initial = await probe({ endpoint, timeoutMs: Math.min(timeoutMs, 1500) });
  if (initial.ok) {
    return { ok: true, alreadyRunning: true, endpoint, version: initial.version };
  }

  // 2. Spawn the pinned bridge entry with detached stdio.
  const port = portFromEndpoint(endpoint);
  const childEnv = buildChildEnv(env);

  let child;
  try {
    child = spawnImpl(
      bridgeEntry,
      [`--bridge-port=${port}`],
      {
        detached: true,
        stdio: "ignore",
        env: childEnv,
      },
    );
  } catch (error) {
    return {
      ok: false,
      reason: "bridge-start-failed",
      endpoint,
      code: error?.code ?? "SPAWN_THREW",
    };
  }
  if (!child || typeof child.unref !== "function") {
    return {
      ok: false,
      reason: "bridge-start-failed",
      endpoint,
      code: "SPAWN_NULL",
    };
  }
  child.unref();

  const pid = typeof child.pid === "number" ? child.pid : 0;
  // Spawn can emit an async `error` before the child has a chance to
  // come up; if the listener fires, fail-closed.
  let spawnErrorCode = null;
  child.once("error", (error) => {
    spawnErrorCode = error?.code ?? "SPAWN_ERROR";
  });

  // 3. Poll the probe on a bounded interval up to `timeoutMs`.
  const deadline = Date.now() + timeoutMs;
  let lastCode;
  while (Date.now() < deadline) {
    if (spawnErrorCode) {
      return {
        ok: false,
        reason: "bridge-start-failed",
        endpoint,
        code: spawnErrorCode,
      };
    }
    await delay(POLL_INTERVAL_MS);
    const result = await probe({ endpoint, timeoutMs: Math.min(1500, Math.max(50, deadline - Date.now())) });
    if (result.ok) {
      return { ok: true, alreadyRunning: false, endpoint, version: result.version, pid };
    }
    lastCode = result.code;
  }

  return {
    ok: false,
    reason: "bridge-start-failed",
    endpoint,
    code: lastCode ?? "TIMEOUT",
  };
}