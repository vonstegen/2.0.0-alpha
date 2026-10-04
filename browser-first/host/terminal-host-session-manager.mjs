// ROS-side terminal session manager. The 5 ROS verbs (F2 split) live here:
// adoptSession, attachSession, detachSession, listSessions, getSessionState,
// plus the lifecycle entry/exit verbs (createSession, terminateSession).
//
// Law: docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md. This module owns
// RosTerminalSession records; it never invokes a terminal adapter and never
// touches a real terminal. A terminal contributes to a session only
// indirectly, via the telemetry event hook (`onTerminalTelemetry`): a
// `terminal.session.terminated` event marks the matching ROS session
// `terminated`.
//
// Ported from examples/sdk-demo/terminal-host/in-memory-host.ts so the
// ROS-side session model is the same executable form the demo uses; the
// demo keeps the in-memory adapter wired through `createInMemoryTerminalHost`
// for contract tests, while this module is the ROS-side surface that
// browser-first callers depend on at runtime.
//
// Types are referenced via JSDoc typedefs from src/core/terminal-host-contract.ts
// so this module remains plain ESM (no `import type`) and runs under
// `node --experimental-strip-types --test`.

/**
 * @typedef {import("../../src/core/terminal-host-contract.ts").ProvenanceFidelity
 * } ProvenanceFidelity
 * @typedef {import("../../src/core/terminal-host-contract.ts").RosTerminalSession
 * } RosTerminalSession
 * @typedef {import("../../src/core/terminal-host-contract.ts").RosTerminalSessionState
 * } RosTerminalSessionState
 * @typedef {import("../../src/core/terminal-host-contract.ts").TerminalSessionEntryMode
 * } TerminalSessionEntryMode
 * @typedef {import("../../src/core/terminal-host-contract.ts").TerminalTelemetryEvent
 * } TerminalTelemetryEvent
 * @typedef {import("../../src/core/contracts.ts").Capability} Capability
 */

// Valid lifecycle transitions. Both entry states converge on `attached` so a
// harness cannot tell whether ROS launched the terminal (`create`) or adopted
// an existing one (`adopt`) -- the TH-3D equivalence requirement. `detached`
// is both a post-detach rest state and the state of an observed-but-unadopted
// session; `detached -> attached` covers adopt and re-attach.
/** @type {Readonly<Record<RosTerminalSessionState, readonly RosTerminalSessionState[]>>} */
export const TERMINAL_SESSION_TRANSITIONS = Object.freeze({
  created: Object.freeze(["attached", "terminated"]),
  adopted: Object.freeze(["attached", "terminated"]),
  attached: Object.freeze(["running", "detached", "terminated"]),
  running: Object.freeze(["detached", "terminated"]),
  detached: Object.freeze(["attached", "terminated"]),
  terminated: Object.freeze([]),
});

/**
 * @param {RosTerminalSessionState} from
 * @param {RosTerminalSessionState} to
 * @returns {RosTerminalSessionState}
 */
export function assertValidSessionTransition(from, to) {
  if (!TERMINAL_SESSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid terminal session transition: ${from} -> ${to}`);
  }
  return to;
}

/**
 * @param {TerminalSessionEntryMode} entryMode
 * @returns {RosTerminalSessionState}
 */
export function initialStateForEntryMode(entryMode) {
  switch (entryMode) {
    case "create":
      return "created";
    case "adopt":
      return "adopted";
    case "detached":
      return "detached";
  }
}

// Single-use, audience-bound rejection reason for grant-related errors that
// the bootstrap broker raises. Kept distinct from TerminalHostErrorCode
// because the manager itself does not surface terminal-adapter errors.
/** @type {Readonly<Record<string, string>>} */
export const SESSION_MANAGER_PUBLIC_REASONS = Object.freeze({
  "unknown-session": "Session not found.",
  "invalid-transition": "Invalid terminal session transition.",
  "attach-conflict": "Terminal session is already attached.",
});

/**
 * @typedef {Object} CreateTerminalSessionManagerOptions
 * @property {() => Date} [now]                  Wall clock for `createdAt` / `attachedAt` / `terminatedAt`.
 * @property {(event: TerminalTelemetryEvent) => void} [telemetryListener] Subscribed listener for terminal telemetry; one global bus.
 */

/**
 * @typedef {Object} TerminalSessionManager
 * @property {(args: { id: string, entryMode: TerminalSessionEntryMode, provenanceFidelity: ProvenanceFidelity, adapterId: string, hostSessionId?: string }) => RosTerminalSession} createSession
 * @property {(args: { id: string, adapterId: string, hostSessionId: string, provenanceFidelity: ProvenanceFidelity }) => RosTerminalSession} adoptSession
 * @property {(id: string, binding: { harness?: { addonId: string, processId?: number }, project?: { root: string, cwd: string }, providerProfileId?: string, grantedCapabilities?: readonly Capability[] }) => RosTerminalSession} attachSession
 * @property {(id: string, reason?: string) => RosTerminalSession} detachSession
 * @property {(id: string) => RosTerminalSession} terminateSession
 * @property {() => RosTerminalSession[]} listSessions
 * @property {(id: string) => RosTerminalSession | null} getSessionState
 * @property {(event: TerminalTelemetryEvent) => void} onTerminalTelemetry
 */

/**
 * @param {CreateTerminalSessionManagerOptions} [options]
 * @returns {TerminalSessionManager}
 */
export function createTerminalHostSessionManager(options = {}) {
  /** @type {Map<string, RosTerminalSession>} */
  const sessions = new Map();
  const now = options.now ?? (() => new Date());
  /** @type {((event: TerminalTelemetryEvent) => void) | null} */
  const telemetryListener = options.telemetryListener ?? null;

  /**
   * @param {TerminalTelemetryEvent} event
   */
  const emit = (event) => {
    if (telemetryListener) telemetryListener(event);
  };

  /**
   * @param {string} id
   * @returns {RosTerminalSession}
   */
  const requireSession = (id) => {
    const session = sessions.get(id);
    if (!session) throw new Error(SESSION_MANAGER_PUBLIC_REASONS["unknown-session"]);
    return session;
  };

  /**
   * @param {string} id
   * @param {RosTerminalSessionState} to
   * @returns {RosTerminalSession}
   */
  const transition = (id, to) => {
    const session = requireSession(id);
    assertValidSessionTransition(session.state, to);
    session.state = to;
    return session;
  };

  return {
    /**
     * @param {{ id: string, entryMode: TerminalSessionEntryMode, provenanceFidelity: ProvenanceFidelity, adapterId: string, hostSessionId?: string }} args
     * @returns {RosTerminalSession}
     */
    createSession(args) {
      if (sessions.has(args.id)) {
        throw new Error(`Session already exists: ${args.id}`);
      }
      /** @type {RosTerminalSession} */
      const session = {
        id: args.id,
        state: initialStateForEntryMode(args.entryMode),
        entryMode: args.entryMode,
        terminalHost: {
          adapterId: args.adapterId,
          hostSessionId: args.hostSessionId,
        },
        grantedCapabilities: [],
        provenanceFidelity: args.provenanceFidelity,
        createdAt: now().toISOString(),
      };
      sessions.set(session.id, session);
      emit({ type: "terminal.session.started", sessionId: session.id, at: session.createdAt });
      return session;
    },

    /**
     * @param {{ id: string, adapterId: string, hostSessionId: string, provenanceFidelity: ProvenanceFidelity }} args
     * @returns {RosTerminalSession}
     */
    adoptSession(args) {
      // Reuse the session if it already exists in `detached` (adopt is the
      // canonical "I see an existing terminal" verb). Otherwise create a
      // fresh `adopted` entry -- matching the in-memory demo.
      const existing = sessions.get(args.id);
      if (existing) {
        if (existing.state !== "detached") {
          throw new Error(SESSION_MANAGER_PUBLIC_REASONS["attach-conflict"]);
        }
        // Adopted via re-bind: the TH-3D equivalence rule says both `create`
        // and `adopt` converge on the `attached` state, so an adopt that
        // re-binds a previously detached session also lands in `attached`.
        assertValidSessionTransition(existing.state, "attached");
        existing.state = "attached";
        existing.entryMode = "adopt";
        existing.terminalHost = {
          adapterId: args.adapterId,
          hostSessionId: args.hostSessionId,
        };
        existing.provenanceFidelity = args.provenanceFidelity;
        existing.attachedAt = now().toISOString();
        return existing;
      }
      /** @type {RosTerminalSession} */
      const session = {
        id: args.id,
        state: "adopted",
        entryMode: "adopt",
        terminalHost: {
          adapterId: args.adapterId,
          hostSessionId: args.hostSessionId,
        },
        grantedCapabilities: [],
        provenanceFidelity: args.provenanceFidelity,
        createdAt: now().toISOString(),
      };
      sessions.set(session.id, session);
      emit({ type: "terminal.session.started", sessionId: session.id, at: session.createdAt });
      return session;
    },

    /**
     * @param {string} id
     * @param {{ harness?: { addonId: string, processId?: number }, project?: { root: string, cwd: string }, providerProfileId?: string, grantedCapabilities?: readonly Capability[] }} binding
     * @returns {RosTerminalSession}
     */
    attachSession(id, binding) {
      const session = transition(id, "attached");
      session.attachedAt = now().toISOString();
      if (binding.harness) session.harness = { ...binding.harness };
      if (binding.project) session.project = { ...binding.project };
      if (binding.providerProfileId) session.providerProfileId = binding.providerProfileId;
      if (binding.grantedCapabilities) {
        session.grantedCapabilities = Object.freeze([...binding.grantedCapabilities]);
      }
      return session;
    },

    /**
     * @param {string} id
     * @param {string} [reason]
     * @returns {RosTerminalSession}
     */
    detachSession(id, reason) {
      const session = transition(id, "detached");
      session.detachedReason = reason;
      return session;
    },

    /**
     * @param {string} id
     * @returns {RosTerminalSession}
     */
    terminateSession(id) {
      const session = transition(id, "terminated");
      session.terminatedAt = now().toISOString();
      emit({
        type: "terminal.session.terminated",
        sessionId: session.id,
        at: session.terminatedAt,
      });
      return session;
    },

    listSessions() {
      return [...sessions.values()];
    },

    getSessionState(id) {
      return sessions.get(id) ?? null;
    },

    /**
     * @param {TerminalTelemetryEvent} event
     */
    onTerminalTelemetry(event) {
      if (event.type === "terminal.session.terminated") {
        const session = sessions.get(event.sessionId);
        if (!session) return;
        if (session.state === "terminated") return;
        try {
          assertValidSessionTransition(session.state, "terminated");
        } catch {
          // Stale or out-of-order telemetry: do not throw; the source of
          // truth for state transitions is the verb surface.
          return;
        }
        session.state = "terminated";
        session.terminatedAt = event.at;
        emit(event);
      }
    },
  };
}