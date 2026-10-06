// CP-BR1: host-owned bridge lifecycle state machine with generation fencing.
//
// The bootstrap host owns exactly zero or one bridge child process at a
// time. All process inputs come from the pinned policy (bridge-policy.mjs);
// this module never accepts a command, argv, path, cwd, endpoint, or
// environment from a caller.
//
// State machine (public projection in parentheses):
//
//   offline ──start──▶ starting ──health ok──▶ connected (owned)
//     ▲                  │                        │
//     │                  │ spawn error /          │ owned child exit
//     │                  │ exit / timeout         │ or error
//     │                  ▼                        ▼
//     │                failed ◀── unexpected-exit ─┘
//     │                  ▲
//   stopForShutdown      │ start-failed / health-timeout /
//     (owned only)       │ version-mismatch / stop-failed /
//     └──────────────────┘ restart-failed
//
//   restarting: restart fences the old generation, stops only the owned
//   child, and starts exactly one new generation.
//
// Generation fencing:
//   * Every owned start/restart allocates a new monotonically increasing
//     generation plus a fresh non-secret instance id.
//   * Child event handlers and health-wait continuations apply their
//     outcome ONLY while their record is still the current owned record
//     (`state.owned === record`). Late exits, errors, and probe results
//     from an older generation are ignored.
//   * A health success is applied only while the expected child is still
//     alive, so a stale healthy answer can never replace newer state.
//
// Ownership:
//   * Only children spawned BY THIS HOST PROCESS are ever signalled. A
//     healthy bridge discovered on the pinned endpoint that this host did
//     not spawn is reported as already running, is never killed, and blocks
//     `restart` (fail-closed) because no new owned generation could bind
//     the pinned port behind it.
//
// Bounds: every wait (probe, start health, stop, kill escalation) is a hard
// timeout from the policy. No polling is unbounded and there are no
// background timers; transitions are driven by requests and child events.

import { once } from "node:events";
import { randomBytes } from "node:crypto";

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultInstanceId(generation) {
  return `g${generation}-${randomBytes(4).toString("hex")}`;
}

/**
 * @param {{
 *   policy: ReturnType<import("./bridge-policy.mjs").createBridgePolicy>,
 *   probe: (args: { endpoint: string, timeoutMs?: number }) => Promise<{ ok: true, version: string | null, endpoint: string } | { ok: false, reason: string, endpoint: string, code?: string }>,
 *   spawnImpl?: Function,
 *   delayImpl?: (ms: number) => Promise<void>,
 *   nowImpl?: () => number,
 *   createInstanceId?: (generation: number) => string,
 * }} options
 */
export function createBootstrapLifecycle({
  policy,
  probe,
  spawnImpl,
  delayImpl = defaultDelay,
  nowImpl = () => Date.now(),
  createInstanceId = defaultInstanceId,
} = {}) {
  if (!policy || typeof policy !== "object") throw new TypeError("createBootstrapLifecycle requires a pinned policy");
  if (typeof probe !== "function") throw new TypeError("createBootstrapLifecycle requires a probe");
  if (typeof spawnImpl !== "function") throw new TypeError("createBootstrapLifecycle requires spawnImpl");

  const endpoint = policy.endpoint;
  const timeouts = policy.timeouts;

  const state = {
    phase: "offline", // offline | starting | connected | degraded | restarting | stopping | failed
    owned: null, // { generation, instanceId, child, startedAt, version, dead, errorCode } | null
    lastFailureCode: null,
  };
  let generationCounter = 0;
  let inflightStart = null;
  let opChain = Promise.resolve();

  /** Serialize lifecycle operations. Concurrent `start` calls coalesce via
   *  `inflightStart`; every other mutating op waits its turn, so a restart
   *  or shutdown can never interleave with a start health wait. */
  function enqueue(operation) {
    const run = opChain.then(operation, operation);
    opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function childAlive(record) {
    return Boolean(record && record.child && !record.dead);
  }

  /** Attach generation-tagged child handlers. Handlers always update the
   *  record itself; they mutate shared state ONLY while the record is the
   *  current owned record. */
  function wireChild(record) {
    const child = record.child;
    const isCurrent = () => state.owned === record;
    if (typeof child.once !== "function") return;
    child.once("error", (error) => {
      record.errorCode = error && typeof error === "object" && typeof error.code === "string" ? error.code : "SPAWN_ERROR";
      record.dead = true;
      if (!isCurrent()) return; // stale generation: fenced
      if (state.phase === "starting" || state.phase === "stopping" || state.phase === "restarting") return;
      state.phase = "failed";
      state.lastFailureCode = "unexpected-exit";
      state.owned = null;
    });
    child.once("exit", () => {
      record.dead = true;
      if (!isCurrent()) return; // stale generation: fenced
      if (state.phase === "starting" || state.phase === "stopping" || state.phase === "restarting") return;
      state.phase = "failed";
      state.lastFailureCode = "unexpected-exit";
      state.owned = null;
    });
  }

  /** Bounded stop of one owned record: SIGTERM, wait, SIGKILL, wait.
   *  Resolves true when the child is confirmed dead. Never touches a
   *  process this host did not spawn. */
  async function stopOwnedRecord(record) {
    if (!childAlive(record)) return true;
    const child = record.child;
    if (typeof child.kill !== "function") return false;
    const waitExit = async (ms) => {
      if (record.dead) return true;
      let timerFired = false;
      const timeout = delayImpl(ms).then(() => {
        timerFired = true;
        return false;
      });
      const exited = once(child, "exit").then(() => true);
      const result = await Promise.race([exited, timeout]);
      if (timerFired) {
        // Avoid an unhandled late resolve on a fake child that never exits.
        exited.catch(() => undefined);
      }
      return result === true || record.dead;
    };
    try {
      child.kill("SIGTERM");
    } catch {
      return record.dead;
    }
    if (await waitExit(timeouts.stopMs)) return true;
    try {
      child.kill("SIGKILL");
    } catch {
      // fall through to the bounded wait
    }
    return waitExit(timeouts.killEscalationMs);
  }

  function failPhase(failureCode, extra = {}) {
    state.phase = "failed";
    state.lastFailureCode = failureCode;
    return { ok: false, status: "failed", failureCode, endpoint, ...extra };
  }

  /** Spawn one new owned generation and wait, bounded, for owned health. */
  async function spawnAndWaitGeneration() {
    generationCounter += 1;
    const generation = generationCounter;
    const record = {
      generation,
      instanceId: createInstanceId(generation),
      child: null,
      startedAt: new Date(nowImpl()).toISOString(),
      version: null,
      dead: false,
      errorCode: null,
    };

    let child;
    try {
      child = spawnImpl(
        policy.nodeExecutable,
        [policy.bridgeEntry, ...policy.bridgeArgv],
        {
          cwd: policy.bridgeCwd,
          env: { ...policy.childEnv },
          detached: true,
          stdio: "ignore",
          shell: false,
        },
      );
    } catch {
      return failPhase("start-failed");
    }
    if (!child || typeof child.kill !== "function") {
      return failPhase("start-failed");
    }
    record.child = child;
    state.owned = record;
    state.phase = "starting";
    wireChild(record);
    try {
      child.unref?.();
    } catch {
      // unref is best-effort; ownership is unaffected
    }

    const deadline = nowImpl() + timeouts.startHealthMs;
    for (;;) {
      if (state.owned !== record) {
        // Fenced by a newer operation while waiting; do not touch state.
        return { ok: false, status: state.phase, failureCode: "start-failed", endpoint, fenced: true };
      }
      if (record.dead) {
        state.owned = null;
        return failPhase("start-failed");
      }
      const remaining = deadline - nowImpl();
      if (remaining <= 0) {
        await stopOwnedRecord(record);
        if (state.owned === record) state.owned = null;
        return failPhase("health-timeout");
      }
      await delayImpl(Math.min(timeouts.healthPollMs, remaining));
      const probeResult = await probe({
        endpoint,
        timeoutMs: Math.min(timeouts.probeMs, Math.max(50, deadline - nowImpl())),
      });
      if (state.owned !== record) {
        return { ok: false, status: state.phase, failureCode: "start-failed", endpoint, fenced: true };
      }
      if (!probeResult.ok) continue;
      if (record.dead) {
        // Stale health success for a child that just died: never connect it.
        state.owned = null;
        return failPhase("start-failed");
      }
      if (
        policy.expectedBridgeVersion
        && typeof probeResult.version === "string"
        && probeResult.version !== policy.expectedBridgeVersion
      ) {
        await stopOwnedRecord(record);
        if (state.owned === record) state.owned = null;
        return failPhase("version-mismatch", { version: probeResult.version });
      }
      record.version = probeResult.version ?? null;
      state.phase = "connected";
      return {
        ok: true,
        status: "connected",
        alreadyRunning: false,
        instanceId: record.instanceId,
        startedAt: record.startedAt,
        version: record.version,
        endpoint,
      };
    }
  }

  async function startOperation() {
    // Re-check ownership after queueing: an earlier start may have
    // completed while this call waited its turn.
    if (childAlive(state.owned)) {
      const record = state.owned;
      return {
        ok: true,
        status: state.phase === "degraded" ? "degraded" : "connected",
        alreadyRunning: true,
        instanceId: record.instanceId,
        startedAt: record.startedAt,
        version: record.version,
        endpoint,
      };
    }
    state.owned = null;
    const initial = await probe({ endpoint, timeoutMs: timeouts.probeMs });
    if (initial.ok) {
      // A healthy bridge we did not spawn. Report it, never adopt or kill it.
      return {
        ok: true,
        status: "connected",
        alreadyRunning: true,
        version: initial.version ?? null,
        endpoint,
      };
    }
    return spawnAndWaitGeneration();
  }

  function start() {
    if (inflightStart) {
      // Concurrent start calls always join the in-flight start: exactly one
      // spawn for one desired generation, with identical public result.
      return inflightStart;
    }
    if (childAlive(state.owned) && (state.phase === "connected" || state.phase === "degraded")) {
      const record = state.owned;
      return Promise.resolve({
        ok: true,
        status: state.phase,
        alreadyRunning: true,
        instanceId: record.instanceId,
        startedAt: record.startedAt,
        version: record.version,
        endpoint,
      });
    }
    const run = enqueue(startOperation);
    inflightStart = run;
    run
      .finally(() => {
        if (inflightStart === run) inflightStart = null;
      })
      .catch(() => undefined);
    return run;
  }

  async function restartOperation() {
    // Fence everything that came before.
    generationCounter += 1;
    const old = state.owned;
    state.owned = null;
    state.phase = "restarting";

    if (childAlive(old)) {
      const stopped = await stopOwnedRecord(old);
      if (!stopped) {
        return failPhase("restart-failed");
      }
    }

    const probeResult = await probe({ endpoint, timeoutMs: timeouts.probeMs });
    if (probeResult.ok) {
      // A healthy bridge this host does not own occupies the endpoint;
      // restart cannot fence it and must not spawn behind it.
      return {
        ok: false,
        status: "connected",
        failureCode: "restart-failed",
        version: probeResult.version ?? null,
        endpoint,
      };
    }
    const result = await spawnAndWaitGeneration();
    return result;
  }

  function restart() {
    return enqueue(async () => {
      const result = await restartOperation();
      // restartOperation leaves phase "restarting" only via spawn path,
      // which sets its own terminal phase. Map the unowned-healthy refusal
      // into the failed phase without touching the foreign bridge.
      if (result.ok === false && result.failureCode === "restart-failed" && result.status === "connected") {
        state.phase = "failed";
        state.lastFailureCode = "restart-failed";
      }
      return result;
    });
  }

  async function stopOperation() {
    generationCounter += 1;
    const old = state.owned;
    state.owned = null;
    if (!childAlive(old)) {
      state.phase = "offline";
      return { ok: true, status: "offline", endpoint };
    }
    state.phase = "stopping";
    const stopped = await stopOwnedRecord(old);
    if (!stopped) {
      return failPhase("stop-failed");
    }
    state.phase = "offline";
    return { ok: true, status: "offline", endpoint };
  }

  function stopForShutdown() {
    return enqueue(stopOperation);
  }

  async function status() {
    switch (state.phase) {
      case "starting":
        return {
          ok: true,
          status: "starting",
          instanceId: state.owned?.instanceId,
          startedAt: state.owned?.startedAt,
          endpoint,
        };
      case "restarting":
        return { ok: true, status: "restarting", endpoint };
      case "stopping":
        return childAlive(state.owned)
          ? { ok: true, status: "connected", instanceId: state.owned.instanceId, startedAt: state.owned.startedAt, version: state.owned.version, endpoint }
          : { ok: true, status: "offline", endpoint };
      case "failed":
        return { ok: true, status: "failed", failureCode: state.lastFailureCode ?? "unexpected-exit", endpoint };
      default:
        break;
    }

    if (childAlive(state.owned)) {
      const record = state.owned;
      const probeResult = await probe({ endpoint, timeoutMs: timeouts.probeMs });
      if (probeResult.ok && !record.dead) {
        state.phase = "connected";
        if (typeof probeResult.version === "string" || probeResult.version === null) record.version = probeResult.version;
        return {
          ok: true,
          status: "connected",
          instanceId: record.instanceId,
          startedAt: record.startedAt,
          version: record.version,
          endpoint,
        };
      }
      state.phase = "degraded";
      return {
        ok: true,
        status: "degraded",
        instanceId: record.instanceId,
        startedAt: record.startedAt,
        version: record.version,
        endpoint,
      };
    }

    const probeResult = await probe({ endpoint, timeoutMs: timeouts.probeMs });
    if (probeResult.ok) {
      return { ok: true, status: "connected", version: probeResult.version ?? null, endpoint };
    }
    if (state.phase !== "failed") state.phase = "offline";
    return state.lastFailureCode && state.phase === "failed"
      ? { ok: true, status: "failed", failureCode: state.lastFailureCode, endpoint }
      : { ok: true, status: "offline", endpoint };
  }

  return Object.freeze({
    status,
    start,
    restart,
    stopForShutdown,
    /** Test introspection: non-secret machine state only. */
    __stateForTest: () => ({
      phase: state.phase,
      generation: state.owned?.generation ?? null,
      instanceId: state.owned?.instanceId ?? null,
      ownedAlive: childAlive(state.owned),
      lastFailureCode: state.lastFailureCode,
    }),
  });
}
