// Polling sync for the Community Hub host (M3).
//
// Constitution Art. VI: the localhost bridge CANNOT receive webhooks, so sync is
// polling, never server push. The plan fixes the cadence at ~20s. This poller
// pulls the three public read surfaces (events, tasks, presence) on an interval,
// reconciles them into a single snapshot, and hands that snapshot to `onSnapshot`
// so the shell surfaces update on the next poll (spec §9: "the count updates for
// other members on next poll").
//
// Timers are injected (`setTimer`/`clearTimer`, default global setTimeout/clear)
// so tests drive ticks deterministically with zero real waiting. On a failed poll
// the poller keeps the last good snapshot and applies capped exponential backoff
// rather than hammering an unreachable/slow backend (Art. I "degrade gracefully",
// plan risk "polling load").

const DEFAULT_INTERVAL_MS = 20_000;
const MAX_BACKOFF_MULTIPLIER = 8; // cap backoff at intervalMs * 8

/**
 * @param {object} opts
 * @param {{ call(method: string, params?: object): Promise<any> }} opts.service community-host service
 * @param {number} [opts.intervalMs]
 * @param {(snapshot: object) => void} [opts.onSnapshot]
 * @param {(error: Error) => void} [opts.onError]
 * @param {(fn: () => void, ms: number) => any} [opts.setTimer]
 * @param {(handle: any) => void} [opts.clearTimer]
 * @param {() => number} [opts.now]
 */
export function createCommunityPoller({
  service,
  intervalMs = DEFAULT_INTERVAL_MS,
  onSnapshot = () => {},
  onError = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
} = {}) {
  if (!service || typeof service.call !== "function") {
    throw new Error("createCommunityPoller requires a service with a call() method.");
  }
  const baseInterval = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : DEFAULT_INTERVAL_MS;

  let running = false;
  let handle = null;
  let consecutiveErrors = 0;
  let snapshot = {
    events: [],
    tasks: [],
    presence: [],
    degraded: false,
    fetchedAt: null,
    lastError: null,
  };

  function currentDelay() {
    if (consecutiveErrors === 0) return baseInterval;
    const mult = Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** consecutiveErrors);
    return baseInterval * mult;
  }

  /** Run exactly one poll cycle. Resolves to the new snapshot (always, even on error). */
  async function tick() {
    try {
      const [events, tasks, presence] = await Promise.all([
        service.call("community.list_events"),
        service.call("community.list_tasks"),
        service.call("community.list_presence"),
      ]);
      const degraded = Boolean(events?.degraded || tasks?.degraded || presence?.degraded);
      snapshot = {
        events: events?.events ?? [],
        tasks: tasks?.tasks ?? [],
        presence: presence?.presence ?? [],
        degraded,
        fetchedAt: new Date(now()).toISOString(),
        lastError: null,
      };
      // A read that came back `degraded` (backend unreachable) is not an exception,
      // but we still back off so we don't spin against a down backend.
      consecutiveErrors = degraded ? consecutiveErrors + 1 : 0;
      onSnapshot(snapshot);
    } catch (error) {
      consecutiveErrors += 1;
      snapshot = { ...snapshot, degraded: true, lastError: error?.message ?? String(error) };
      onError(error);
      onSnapshot(snapshot);
    }
    return snapshot;
  }

  function schedule() {
    if (!running) return;
    handle = setTimer(async () => {
      if (!running) return;
      await tick();
      schedule();
    }, currentDelay());
  }

  return {
    /** Start polling. `immediate` (default true) runs one tick right away. */
    async start({ immediate = true } = {}) {
      if (running) return snapshot;
      running = true;
      consecutiveErrors = 0;
      if (immediate) await tick();
      schedule();
      return snapshot;
    },
    stop() {
      running = false;
      if (handle != null) {
        clearTimer(handle);
        handle = null;
      }
    },
    isRunning: () => running,
    tick,
    getSnapshot: () => snapshot,
    /** Exposed for tests/telemetry: the delay the next scheduled poll would use. */
    currentDelay,
  };
}
