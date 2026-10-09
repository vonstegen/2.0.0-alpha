// CP-BR9: single owner of the live terminal-host service.
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
// This module unifies them. Exactly one LIVE terminal service — the one
// the reconciler started for the enabled terminal add-on — drives both
// "enable a terminal add-on" and "Open in Terminal". The owner:
//
//   - tracks the factory-active service (`attach` / `detach`);
//   - enforces the terminal singleton: at most one add-on may hold the
//     live service at a time (documented in
//     docs/operations/TERMINAL-SWITCHING-AND-CLEANUP.md);
//   - exposes a `facade({ fallback })` with the same `{ service, start }`
//     shape the harness host service already consumes, delegating to the
//     active service first and to the bridge-level boot composition
//     (`installTerminalHostBridge`, in-memory in production) second.
//
// Hard rules (CP-BR9 §7):
//   - The owner never spawns anything and never sees a command / argv /
//     cwd / env / path / token. It holds references; factories own spawn.
//   - `detach` only releases the exact `{ addonId, service }` pair that
//     attached, so a stale stop cannot evict a newer owner.
//   - The facade fails closed: with no active service and no fallback,
//     status reports not-alive and RPCs throw `runtime-unavailable`.
//
// Intent citation: docs/architecture/ADDON-BRIDGE-RUNTIME-ROADMAP.md
// §13/§14 and the CP-BR9 build prompt §5.3.

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
 *   attach: (entry: { addonId: string, service: object, started: object }) => { ok: boolean, reason?: string },
 *   detach: (entry: { addonId: string, service: object }) => boolean,
 *   ownerAddonId: () => string | null,
 *   snapshot: () => { addonId: string, driveId: unknown, alive: unknown } | null,
 *   facade: (options?: { fallback?: { service: object, started: object } | null }) => { service: object, start: object },
 *   _activeForTests: () => object | null,
 * }}
 */
export function createTerminalHostServiceOwner() {
  /** @type {{ addonId: string, service: any, started: any } | null} */
  let active = null;

  function attach({ addonId, service, started } = {}) {
    if (typeof addonId !== "string" || addonId.length === 0 || !service || !started) {
      throw new TypeError("terminal-host-service-owner.attach requires { addonId, service, started }");
    }
    if (active && active.addonId !== addonId) {
      // The terminal runtime is a singleton per bridge. The reconciler
      // sequences disable-before-enable for planned switches; a second
      // live attachment is refused closed so two adapters can never both
      // own the terminal.
      return { ok: false, reason: "terminal-service-owned" };
    }
    active = { addonId, service, started };
    return { ok: true };
  }

  function detach({ addonId, service } = {}) {
    if (!active || active.addonId !== addonId || active.service !== service) {
      return false;
    }
    active = null;
    return true;
  }

  function ownerAddonId() {
    return active?.addonId ?? null;
  }

  function snapshot() {
    if (!active) return null;
    const status = typeof active.service.status === "function" ? active.service.status() : null;
    return {
      addonId: active.addonId,
      driveId: status?.driveId ?? active.started?.driveId ?? null,
      alive: status?.alive === true,
    };
  }

  /**
   * Build the `{ service, start }` pair consumed by
   * `createHarnessHostService({ terminalHost })`. The facade prefers the
   * factory-active service; when no terminal add-on holds the singleton it
   * falls back to the bridge-level boot composition (the
   * `installTerminalHostBridge` handle — in-memory in the default
   * ROS-started bridge, so every route still fails closed).
   */
  function facade({ fallback = null } = {}) {
    const fallbackService = fallback?.service ?? null;
    const fallbackStarted = fallback?.started ?? null;
    const live = () => active?.service ?? fallbackService ?? null;
    const call = (method) => async (args) => {
      const service = live();
      if (!service || typeof service[method] !== "function") throw unavailable();
      return service[method](args);
    };
    const service = {
      status() {
        const current = live();
        if (!current || typeof current.status !== "function") return { ...INACTIVE_STATUS, sessions: [] };
        return current.status();
      },
      launchBootstrap: call("launchBootstrap"),
      sendInput: call("sendInput"),
      terminateSession: call("terminateSession"),
      createSession: call("createSession"),
    };
    const start = {
      get adapterId() {
        return active?.addonId ?? fallbackStarted?.adapterId ?? null;
      },
      get bus() {
        return active?.started?.bus ?? fallbackStarted?.bus ?? null;
      },
      get driveId() {
        return active?.started?.driveId ?? fallbackStarted?.driveId ?? null;
      },
    };
    return { service, start };
  }

  return {
    attach,
    detach,
    ownerAddonId,
    snapshot,
    facade,
    _activeForTests: () => active,
  };
}
