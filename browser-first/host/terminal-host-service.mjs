// ResonantOS terminal-host bridge service (Phase 1.5 Step B).
//
// Composition for the bridge-side owner of a replaceable terminal host
// adapter. Subscribes to the iTerm2 add-on's stdio JSON-RPC peer
// (`service.protocol: "stdio-json-rpc"`, `service.entrypoint: "node
// adapter.mjs"` — see examples/sdk-demo/terminal-host/iterm2/addon.json)
// and republishes `terminal.event` notifications onto the broker event
// bus the harness boundary already uses (`browser-first/host/
// harness-boundary.mjs:68, :138, :160, :164, :176`). The bus validator
// (`harness-adapter-contract.mjs:37`) was extended in Step 0
// (e352b6e2) to accept the five `terminal.*` event types.
//
// This file is the **bridge route owner**, not the adapter itself. In
// `iterm2` driver mode the bridge spawns the adapter as an opt-in,
// fixed-root stdio JSON-RPC peer (gated by `RESONANT_TERMINAL_HOST_BRIDGE=1`
// in terminal-host-bridge-wiring.mjs). The spawn is NOT ambient-PATH and
// NOT manifest-controlled: it's a hardcoded `python3 adapter.py` from the
// adapter's own directory. In `in-memory` mode no process is spawned.
//
// Spec: prompts/OMP-BUILD-iTerm2-SDK-Addon-Connection.md v5 §3 #6-#9
// and Phase 1.5 Step B.

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { createHarnessEventBus } from "./harness-event-bus.mjs";
import { validateHarnessEvent } from "./harness-adapter-contract.mjs";
import { TERMINAL_HOST_CONTRACT_VERSION } from "../../src/core/terminal-host-contract.ts";

const TERMINAL_HOST_ADDON_ID = "addon.resonant-terminal-iterm2";
const JSON_RPC_VERSION = "2.0";

// Adapter spawn env allowlist. ADR-039/040 require no `process.env`
// inheritance into the adapter; only PATH (runtime resolution) and HOME
// (iTerm2's Python API locates its socket under the user home) cross the
// boundary. RESONANT_TERMINAL_DRIVER is added explicitly at spawn time.
const ADAPTER_ENV_ALLOWLIST = ["PATH", "HOME"];

const SESSION_BOOTSTRAP_GRANT_TTL_MS = 60_000;

/**
 * Mint a SessionBootstrapGrant. The token is broker-grade: 32 random bytes
 * base64url-encoded, matching createBridgeToken() in bridge-server.mjs — not
 * the old tok-<uuid> placeholder. The grant is audience-bound to one session
 * and single-use (claim then discard); the ros-session attach consumer
 * validates + claims it against the broker, and the token rides the RPC
 * return value only, never argv/env. See ADR-040 "Authorization model" and
 * SessionBootstrapGrant in terminal-host-contract.ts.
 */
export function mintSessionBootstrapGrant({
  sessionId,
  purpose,
  now = () => new Date(),
  mintToken = () => randomBytes(32).toString("base64url"),
  ttlMs = SESSION_BOOTSTRAP_GRANT_TTL_MS,
} = {}) {
  const issuedAt = now();
  return {
    sessionId,
    token: mintToken(),
    purpose,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
  };
}

/**
 * @typedef {Object} JsonRpcRequest
 * @property {"2.0"} jsonrpc
 * @property {string | number | null} id
 * @property {string} method
 * @property {unknown} [params]
 */

/**
 * @typedef {Object} JsonRpcNotification
 * @property {"2.0"} jsonrpc
 * @property {string} method
 * @property {unknown} [params]
 */

/**
 * @typedef {Object} JsonRpcResponse
 * @property {"2.0"} jsonrpc
 * @property {string | number | null} id
 * @property {unknown} [result]
 * @property {{ code: number, message: string, data?: unknown }} [error]
 */

/**
 * Frame a JSON-RPC message on a single line (newline-delimited JSON).
 * @param {JsonRpcRequest | JsonRpcNotification | JsonRpcResponse} message
 */
function frame(message) {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Validate a RosTerminalEventEnvelope. The bridge is the boundary; it must
 * reject malformed envelopes before they reach the bus. Mirrors the
 * `validateHarnessEvent` discipline (size limits, type discriminator).
 *
 * @param {unknown} envelope
 * @returns {{ ok: true, value: import("../../src/core/terminal-host-contract.ts").RosTerminalEventEnvelope } | { ok: false, reason: string }}
 */
export function validateRosTerminalEventEnvelope(envelope) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { ok: false, reason: "envelope is not an object" };
  }
  const e = /** @type {Record<string, unknown>} */ (envelope);
  if (e.version !== TERMINAL_HOST_CONTRACT_VERSION) {
    return { ok: false, reason: `version must be ${TERMINAL_HOST_CONTRACT_VERSION}` };
  }
  if (typeof e.sessionId !== "string" || e.sessionId.length === 0) {
    return { ok: false, reason: "sessionId missing" };
  }
  if (e.source !== "terminal" && e.source !== "harness") {
    return { ok: false, reason: "source must be 'terminal' or 'harness'" };
  }
  if (typeof e.at !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e.at)) {
    return { ok: false, reason: "at must be an ISO-8601 timestamp" };
  }
  if (e.event === null || typeof e.event !== "object" || Array.isArray(e.event)) {
    return { ok: false, reason: "event body missing" };
  }
  const ev = /** @type {Record<string, unknown>} */ (e.event);
  if (typeof ev.type !== "string" || !ev.type.startsWith("terminal.")) {
    return { ok: false, reason: "event.type must start with 'terminal.'" };
  }
  return { ok: true, value: /** @type {any} */ (envelope) };
}

/**
 * Map a RosTerminalEventEnvelope to a HarnessEvent for the bus.
 * The bus accepts 5 terminal.* event types (Phase 1.5 Step 0).
 *
 * @param {import("../../src/core/terminal-host-contract.ts").RosTerminalEventEnvelope} envelope
 * @param {{ sessionId: string, turnId: string, bootEpoch: string, generation: number, sequence: number }} provenance
 * @returns {import("../../src/core/contracts.ts").HarnessEvent}
 */
export function envelopeToHarnessEvent(envelope, provenance) {
  const event = /** @type {{ type: string, [k: string]: unknown }} */ (envelope.event);
  const { type, ...rest } = event;
  return {
    ...provenance,
    type: /** @type {any} */ (type),
    data: rest,
  };
}

/**
 * @typedef {Object} TerminalHostServiceOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {() => string} [addonId]
 * @property {() => string} [bootEpoch]
 * @property {(entrypoint: string, env: NodeJS.ProcessEnv) => import("node:child_process").ChildProcess} [spawn]
 * @property {string} [entrypoint] default "node"
 * @property {string} [script]    default "adapter.mjs"
 * @property {string} [cwd]       default examples/sdk-demo/terminal-host/iterm2
 */

/**
 * @typedef {Object} TerminalHostService
 * @property {() => Promise<{ adapterId: string, bus: ReturnType<typeof createHarnessEventBus>, driveId: string }>} start
 * @property {() => Promise<void>} stop
 * @property {(args: { sessionId: string, bootstrapCommand: string, turnId?: string, timeoutMs?: number }) => Promise<import("../../src/core/terminal-host-contract.ts").SessionBootstrapGrant>} launchBootstrap
 * @property {() => { events: number, lastEventAt: number | null, alive: boolean }} status
 */

/**
 * Compose the terminal-host bridge service. The service owns one adapter
 * process (iTerm2 driver) and one broker bus scoped to the addon. The bus
 * is the same `createHarnessEventBus` the harness boundary uses; consumers
 * (DAR, side panel) subscribe via `bus.subscribe()`.
 *
 * @param {TerminalHostServiceOptions} [options]
 * @returns {TerminalHostService}
 */
export function createTerminalHostService(options = {}) {
  const env = options.env ?? process.env;
  const addonId = options.addonId ?? (() => TERMINAL_HOST_ADDON_ID);
  const bootEpoch = options.bootEpoch ?? (() => env.RESONANTOS_HARNESS_BOOTEPOCH ?? `boot-${randomUUID().slice(0, 8)}`);
  const cwd = options.cwd ?? "examples/sdk-demo/terminal-host/iterm2";
  const spawnFn = options.spawn ?? ((cmd, args, envArg) => spawn(cmd, args, { cwd, env: envArg, stdio: ["pipe", "pipe", "pipe"] }));
  const driveId = env.RESONANT_TERMINAL_DRIVER ?? "in-memory";
  // Driver-specific spawn plan. The iTerm2 driver is a Python script
  // (iterm2's control API is Python; the bridge is the stdio JSON-RPC
  // peer). The in-memory driver composes without spawning.
  const spawnPlan = (driveId === "iterm2")
    ? { command: "python3", args: ["adapter.py"] }
    : { command: "node", args: ["adapter.mjs"] };
  const entrypoint = options.entrypoint ?? spawnPlan.command;
  const script = options.script ?? spawnPlan.args[0];

  if (driveId !== "in-memory" && driveId !== "iterm2") {
    throw new Error(
      `RESONANT_TERMINAL_DRIVER must be 'in-memory' or 'iterm2'. Got: ${JSON.stringify(driveId)}`,
    );
  }

  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let bus = null;
  let sequence = 0;
  let eventsPublished = 0;
  let lastEventAt = /** @type {number | null} */ (null);
  let alive = false;

  /** @type {Map<string | number, { resolve: (value: unknown) => void, reject: (reason?: unknown) => void, timer: NodeJS.Timeout, startedAt: number }>} */
  const pending = new Map();

  function nextProvenance(turnId) {
    sequence += 1;
    return {
      addonId: addonId(),
      sessionId: "terminal-host-bus",
      turnId: turnId ?? "terminal",
      bootEpoch: bootEpoch(),
      generation: 0,
      sequence,
    };
  }

  function handleNotification(/** @type {JsonRpcNotification} */ msg) {
    if (msg.method !== "terminal.event") return;
    const validation = validateRosTerminalEventEnvelope(msg.params);
    if (!validation.ok) {
      console.error(JSON.stringify({ event: "terminal_host.invalid_envelope", reason: validation.reason }));
      return;
    }
    const provenance = nextProvenance(validation.value.sessionId);
    const harnessEvent = envelopeToHarnessEvent(validation.value, provenance);
    if (!validateHarnessEvent(harnessEvent)) {
      console.error(JSON.stringify({ event: "terminal_host.bus_rejected", type: harnessEvent.type }));
      return;
    }
    bus?.publish({
      turnId: harnessEvent.turnId,
      type: harnessEvent.type,
      data: /** @type {any} */ (harnessEvent.data),
    });
    eventsPublished += 1;
    lastEventAt = performance.now();
  }

  function handleResponse(/** @type {JsonRpcResponse} */ msg) {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code, data: msg.error.data }));
    else waiter.resolve(msg.result);
  }

  function handleLine(/** @type {string} */ line) {
    if (line.length === 0) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch (error) { console.error(JSON.stringify({ event: "terminal_host.bad_json", error: String(error), line: line.slice(0, 200) })); return; }
    if (msg.jsonrpc !== JSON_RPC_VERSION) {
      console.error(JSON.stringify({ event: "terminal_host.bad_version", version: msg.jsonrpc }));
      return;
    }
    if ("id" in msg && (msg.result !== undefined || msg.error !== undefined)) handleResponse(msg);
    else if ("method" in msg) handleNotification(/** @type {any} */ (msg));
  }

  function send(/** @type {JsonRpcRequest | JsonRpcNotification} */ msg) {
    if (!child?.stdin || child.stdin.destroyed) {
      throw new Error("terminal-host adapter is not running");
    }
    child.stdin.write(frame(msg));
  }

  function request(method, params, { timeoutMs = 5000 } = {}) {
    if (!child?.stdin) return Promise.reject(new Error("adapter not started"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Object.assign(new Error(`${method} timed out after ${timeoutMs}ms`), { code: "deadline-exceeded" }));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, startedAt: performance.now() });
      send({ jsonrpc: JSON_RPC_VERSION, id, method, params });
    });
  }

  async function start() {
    if (alive) return { adapterId: addonId(), bus, driveId };
    if (driveId === "in-memory") {
      // The in-memory driver has no stdio surface; the service composes
      // but produces no bus events of its own. Tests in this mode drive
      // the in-memory host directly.
      bus = createHarnessEventBus({
        provenance: { addonId: addonId(), sessionId: "terminal-host-bus", turnId: "terminal", bootEpoch: bootEpoch(), generation: 0 },
        isCurrent: () => alive,
        maxReaders: 8,
      });
      alive = true;
      return { adapterId: addonId(), bus, driveId };
    }
    // iterm2: spawn the operator-provided adapter as a stdio JSON-RPC peer.
    bus = createHarnessEventBus({
      provenance: { addonId: addonId(), sessionId: "terminal-host-bus", turnId: "terminal", bootEpoch: bootEpoch(), generation: 0 },
      isCurrent: () => alive,
      maxReaders: 8,
    });
    const scopedEnv = { RESONANT_TERMINAL_DRIVER: driveId };
    for (const key of ADAPTER_ENV_ALLOWLIST) {
      if (env[key] !== undefined) scopedEnv[key] = env[key];
    }
    child = spawnFn(entrypoint, [script], scopedEnv);
    child.on("exit", (code, signal) => {
      alive = false;
      console.error(JSON.stringify({ event: "terminal_host.adapter_exit", code, signal }));
    });
    const rl = createInterface({ input: child.stdout });
    rl.on("line", handleLine);
    child.stderr.on("data", (chunk) => {
      console.error(`[adapter] ${chunk.toString().trimEnd()}`);
    });
    alive = true;
    return { adapterId: addonId(), bus, driveId };
  }

  async function stop() {
    if (!alive) return;
    alive = false;
    if (bus) bus.close("runtime-unavailable");
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(Object.assign(new Error("service stopped"), { code: "runtime-unavailable" }));
    }
    pending.clear();
    if (child && !child.killed) {
      child.kill("SIGTERM");
      try { await Promise.race([once(child, "exit"), delay(2000)]); }
      catch { child.kill("SIGKILL"); }
    }
    child = null;
  }

  async function launchBootstrap({ sessionId, bootstrapCommand, turnId, timeoutMs = 5000 }) {
    if (driveId === "in-memory") {
      throw new Error("launchBootstrap unavailable: in-memory driver has no stdio surface");
    }
    // Per v5: consumer receives the resolved environment via the bootstrap
    // RPC return value + `terminal.session.started` event. We return the
    // grant here; the bus event is published by the adapter's notification
    // and observed via bus.subscribe().
    const grant = mintSessionBootstrapGrant({ sessionId, purpose: "attach" });
    const result = await request(
      "launchBootstrap",
      { sessionId, bootstrapCommand, grant },
      { timeoutMs },
    );
    return /** @type {any} */ (result);
  }

  function status() {
    return { events: eventsPublished, lastEventAt, alive: !!child && alive };
  }

  return { start, stop, launchBootstrap, status };
}
