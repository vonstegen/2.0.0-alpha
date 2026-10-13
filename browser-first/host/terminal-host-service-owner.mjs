// CP-BR9: single owner of the live terminal-host services.
//
// Before CP-BR9 there were two terminal-host service instances in play:
//
//   1. the per-add-on service a CP-BR7 factory creates in `start()` (the
//      real Ghostty/iTerm2 adapter, driver pinned by the factory), and
//   2. the bridge-level `installTerminalHostBridge({ env })` service
//      exposed on `globalThis` (active only under
//      `RESONANT_TERMINAL_HOST_BRIDGE=1`; in the default ROS-started
//      bridge its driver is `in-memory`, so `POST /terminal-host/launch`
//      could never reach a real terminal).
//
// This module unifies them. Every LIVE per-add-on terminal service — one
// per enabled+granted terminal add-on — is tracked here, and the facade
// routes "enable a terminal add-on", "Open in Terminal", and harness
// launches to the correct service. Multiple terminal add-ons MAY be live
// concurrently (multi-live terminals); the owner:
//
//   - tracks each factory-active service (`attach` / `detach`), keyed by
//     add-on id;
//   - exposes a `facade({ fallback })` with the same `{ service, start }`
//     shape the harness host service already consumes, dispatching to the
//     add-on-addressed service first and to the bridge-level boot
//     composition (`installTerminalHostBridge`, in-memory in production)
//     only when no per-add-on service is attached.
//
// Hard rules (CP-BR9 §7):
//   - The owner never spawns anything and never sees a command / argv /
//     cwd / env / path / token. It holds references; factories own spawn.
//   - `attach` is per-add-on idempotent: the same `{ addonId, service }`
//     pair re-attach is a no-op, and a same-addon DIFFERENT-service attach
//     REPLACES the stale entry (the factory's dead-service restart path
//     drops its stale handle without detaching; refusing here would wedge
//     crash recovery). There is no cross-add-on refusal: two terminals
//     may be live at once.
//   - `detach` only releases the exact `{ addonId, service }` pair that
//     attached, so a stale stop cannot evict a newer owner.
//   - The facade fails closed: an add-on-addressed call for an add-on
//     with no attached service never falls through to a DIFFERENT
//     terminal, and with no active service and no fallback, status
//     reports not-alive and RPCs throw `runtime-unavailable`.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §13/§14 and the CP-BR9 build prompt §5.3. Multi-live supersedes the
// terminal-singleton note in docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md.

const INACTIVE_STATUS = Object.freeze({
  alive: false,
  driveId: null,
  adapterId: null,
  sessions: Object.freeze([]),
});

const unavailable = () =>
  Object.assign(new Error("terminal-host service is not active"), { code: "runtime-unavailable" });

/**
 * @returns {{
 *   attach: (entry: { addonId: string, service: object, started: object }) => { ok: boolean },
 *   detach: (entry: { addonId: string, service: object }) => boolean,
 *   ownerAddonIds: () => string[],
 *   facade: (options?: { fallback?: { service: object, started: object } | null }) => { service: object, start: object },
 *   _activesForTests: () => Map<string, { addonId: string, service: object, started: object }>,
 * }}
 */
export function createTerminalHostServiceOwner() {
  /** @type {Map<string, { addonId: string, service: any, started: any }>} */
  const actives = new Map();
  /** @type {Map<string, any>} sessionId -> owning service, learned from
   * launchBootstrap / createSession results so session-addressed RPCs
   * (sendInput / terminateSession) reach the terminal that owns the
   * session when more than one service is live. */
  const sessionIndex = new Map();

  function attach({ addonId, service, started } = {}) {
    if (typeof addonId !== "string" || addonId.length === 0 || !service || !started) {
      throw new TypeError("terminal-host-service-owner.attach requires { addonId, service, started }");
    }
    const existing = actives.get(addonId);
    if (existing && existing.service !== service) {
      // Same-addon replacement (crash recovery / dead-service restart):
      // drop the stale service's session routes.
      for (const [sessionId, indexed] of sessionIndex) {
        if (indexed === existing.service) sessionIndex.delete(sessionId);
      }
    }
    actives.set(addonId, { addonId, service, started });
    return { ok: true };
  }

  function detach({ addonId, service } = {}) {
    const existing = actives.get(addonId);
    if (!existing || existing.service !== service) {
      return false;
    }
    actives.delete(addonId);
    for (const [sessionId, indexed] of sessionIndex) {
      if (indexed === service) sessionIndex.delete(sessionId);
    }
    return true;
  }

  function ownerAddonIds() {
    return [...actives.keys()];
  }

  /** Fan-in view over every live service bus. Session-addressed harness
   * adapters filter events by their own sessionId, so a merged stream is
   * safe for subscribers created before/after a second terminal attaches. */
  function mergedBus(buses) {
    const live = buses.filter((bus) => bus && typeof bus.subscribe === "function");
    if (live.length === 0) return null;
    if (live.length === 1) return live[0];
    return {
      subscribe() {
        const iterators = live.map((bus) => bus.subscribe()[Symbol.asyncIterator]());
        const pending = new Map();
        const pull = (index) => {
          pending.set(index, iterators[index].next().then((result) => ({ index, result })));
        };
        iterators.forEach((_, index) => pull(index));
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            if (pending.size === 0) return { done: true, value: undefined };
            const { index, result } = await Promise.race(pending.values());
            pending.delete(index);
            if (!result.done) pull(index);
            return result;
          },
          async return() {
            await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  /**
   * Build the `{ service, start }` pair consumed by
   * `createHarnessHostService({ terminalHost })`. The facade dispatches to
   * the add-on-addressed factory-active service; when NO per-add-on
   * service is attached it falls back to the bridge-level boot
   * composition (the `installTerminalHostBridge` handle — in-memory in
   * the default ROS-started bridge, so every route still fails closed).
   */
  function facade({ fallback = null } = {}) {
    const fallbackService = fallback?.service ?? null;
    const fallbackStarted = fallback?.started ?? null;

    const firstActive = () => actives.values().next().value ?? null;
    const soleActive = () => (actives.size === 1 ? firstActive() : null);
    // An explicit add-on address NEVER falls through to another terminal.
    const serviceFor = (addonId) => (addonId ? actives.get(addonId)?.service ?? null : null);

    function dispatchFor(args, { indexable = false } = {}) {
      const hint = typeof args?.terminalAddonId === "string" && args.terminalAddonId.length > 0
        ? args.terminalAddonId
        : typeof args?.harness === "string" && actives.has(args.harness)
          ? args.harness
          : null;
      if (hint) return { service: serviceFor(hint), indexable };
      const indexed = typeof args?.sessionId === "string" ? sessionIndex.get(args.sessionId) : null;
      if (indexed) return { service: indexed, indexable };
      return { service: soleActive()?.service ?? (actives.size === 0 ? fallbackService : null), indexable };
    }

    const call = (method, { indexResult = false, broadcastFallback = false } = {}) => async (args) => {
      const forwarded = { ...args };
      delete forwarded.terminalAddonId;
      const { service } = dispatchFor(args, { indexable: indexResult });
      if (service && typeof service[method] === "function") {
        const result = await service[method](forwarded);
        const sessionId = result?.sessionId ?? args?.sessionId;
        if (indexResult && typeof sessionId === "string" && sessionId.length > 0) {
          sessionIndex.set(sessionId, service);
        }
        if (method === "terminateSession" && typeof sessionId === "string") {
          sessionIndex.delete(sessionId);
        }
        return result;
      }
      if (broadcastFallback && actives.size > 1) {
        // Session predates the index (e.g. adopted external session): ask
        // every live terminal; terminateSession tolerates not-found.
        let firstError = null;
        for (const entry of actives.values()) {
          if (typeof entry.service[method] !== "function") continue;
          try {
            return await entry.service[method](forwarded);
          } catch (error) {
            firstError ??= error;
          }
        }
        if (firstError) throw firstError;
      }
      throw unavailable();
    };

    const service = {
      status(addonId) {
        if (typeof addonId === "string" && addonId.length > 0) {
          const addressed = serviceFor(addonId);
          return addressed && typeof addressed.status === "function"
            ? addressed.status()
            : { ...INACTIVE_STATUS, sessions: [] };
        }
        if (actives.size === 0) {
          if (fallbackService && typeof fallbackService.status === "function") return fallbackService.status();
          return { ...INACTIVE_STATUS, sessions: [] };
        }
        if (actives.size === 1) {
          const current = firstActive().service;
          return typeof current.status === "function" ? current.status() : { ...INACTIVE_STATUS, sessions: [] };
        }
        // Merged view: connected if ANY terminal is live; identity fields
        // name the first live terminal; sessions are the union.
        const statuses = [...actives.values()].map((entry) =>
          typeof entry.service.status === "function" ? entry.service.status() : null);
        const firstAlive = statuses.find((status) => status?.alive === true) ?? null;
        return {
          alive: firstAlive !== null,
          driveId: firstAlive?.driveId ?? null,
          adapterId: firstAlive?.adapterId ?? null,
          sessions: statuses.flatMap((status) => (Array.isArray(status?.sessions) ? status.sessions : [])),
        };
      },
      launchBootstrap: call("launchBootstrap", { indexResult: true }),
      sendInput: call("sendInput", { broadcastFallback: true }),
      terminateSession: call("terminateSession", { broadcastFallback: true }),
      createSession: call("createSession", { indexResult: true }),
    };
    const start = {
      get adapterId() {
        return firstActive()?.addonId ?? fallbackStarted?.adapterId ?? null;
      },
      get bus() {
        const merged = mergedBus([...actives.values()].map((entry) => entry.started?.bus));
        return merged ?? fallbackStarted?.bus ?? null;
      },
      get driveId() {
        for (const entry of actives.values()) {
          if (typeof entry.service.status === "function" && entry.service.status()?.alive === true) {
            return entry.started?.driveId ?? null;
          }
        }
        return fallbackStarted?.driveId ?? null;
      },
    };
    return { service, start };
  }

  return {
    attach,
    detach,
    ownerAddonIds,
    facade,
    _activesForTests: () => new Map(actives),
  };
}
