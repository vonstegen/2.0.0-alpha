// Headless in-memory terminal host for contract tests (ADR-040 Migration
// step 3). It owns session state and emits terminal telemetry events; it never
// touches a real terminal. The state machine and provenance rules are the
// executable form of the contract in
// `src/core/terminal-host-contract.ts`, kept here under `examples/` so no
// terminal runtime logic enters the Alpha `src/core` path.

import type {
  ProvenanceFidelity,
  RosTerminalSession,
  RosTerminalSessionState,
  TerminalHostAdapterContract,
  TerminalSessionEntryMode,
  TerminalTelemetryEvent,
} from "../../../src/core/terminal-host-contract";

// Valid lifecycle transitions. Both entry states converge on `attached` so a
// harness cannot tell whether ROS launched the terminal (`create`) or adopted
// an existing one (`adopt`) — the TH-3D equivalence requirement. `detached`
// is both a post-detach rest state and the state of an observed-but-unadopted
// session; `detached -> attached` covers adopt and re-attach.
export const TERMINAL_SESSION_TRANSITIONS: Readonly<
  Record<RosTerminalSessionState, readonly RosTerminalSessionState[]>
> = {
  created: ["attached", "terminated"],
  adopted: ["attached", "terminated"],
  attached: ["running", "detached", "terminated"],
  running: ["detached", "terminated"],
  detached: ["attached", "terminated"],
  terminated: [],
};

export function assertValidSessionTransition(
  from: RosTerminalSessionState,
  to: RosTerminalSessionState,
): RosTerminalSessionState {
  if (!TERMINAL_SESSION_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid terminal session transition: ${from} -> ${to}`);
  }
  return to;
}

export function initialStateForEntryMode(
  entryMode: TerminalSessionEntryMode,
): RosTerminalSessionState {
  switch (entryMode) {
    case "create":
      return "created";
    case "adopt":
      return "adopted";
    case "detached":
      return "detached";
  }
}

// Executable form of ADR-040's "DAR provenance fidelity" table.
export function deriveProvenanceFidelity(args: {
  harnessCooperative: boolean;
  feedbackChannel: TerminalHostAdapterContract["feedbackChannel"];
}): ProvenanceFidelity {
  if (args.harnessCooperative) return "structured";
  if (args.feedbackChannel !== "none") return "telemetry";
  return "observation";
}

const IN_MEMORY_ADAPTER: TerminalHostAdapterContract = {
  adapterVersion: 1,
  adapterId: "in-memory",
  transport: "local-ipc",
  // Adapter primitives only; adopt/attach/detach/list/state are ROS
  // session-manager verbs (see TERMINAL-HOST-OPERATION-SPLIT.md), exposed as
  // this host's own methods rather than `supportedOperations`.
  supportedOperations: ["createSession", "terminateSession"],
  capabilities: [
    "launch",
    "adopt",
    "attach",
    "detach",
    "terminate",
    "list-sessions",
    "lifecycle-events",
  ],
  feedbackChannel: "event-stream",
};

export function createInMemoryTerminalHost() {
  const sessions = new Map<string, RosTerminalSession>();
  const listeners = new Set<(event: TerminalTelemetryEvent) => void>();
  const now = () => new Date().toISOString();

  const emit = (event: TerminalTelemetryEvent) => {
    for (const listener of listeners) listener(event);
  };
  const requireSession = (id: string): RosTerminalSession => {
    const session = sessions.get(id);
    if (!session) throw new Error(`Unknown session: ${id}`);
    return session;
  };
  const transition = (id: string, to: RosTerminalSessionState): RosTerminalSession => {
    const session = requireSession(id);
    assertValidSessionTransition(session.state, to);
    session.state = to;
    return session;
  };

  return {
    adapter: IN_MEMORY_ADAPTER,
    onTelemetry(listener: (event: TerminalTelemetryEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    createSession(args: {
      id: string;
      entryMode: TerminalSessionEntryMode;
      provenanceFidelity: ProvenanceFidelity;
    }): RosTerminalSession {
      const session: RosTerminalSession = {
        id: args.id,
        state: initialStateForEntryMode(args.entryMode),
        entryMode: args.entryMode,
        terminalHost: { adapterId: IN_MEMORY_ADAPTER.adapterId },
        grantedCapabilities: [],
        provenanceFidelity: args.provenanceFidelity,
        createdAt: now(),
      };
      sessions.set(session.id, session);
      emit({ type: "terminal.session.started", sessionId: session.id, at: session.createdAt });
      return session;
    },
    attach(id: string): RosTerminalSession {
      const session = transition(id, "attached");
      session.attachedAt = now();
      return session;
    },
    run(id: string): RosTerminalSession {
      return transition(id, "running");
    },
    detach(id: string, reason?: string): RosTerminalSession {
      const session = transition(id, "detached");
      session.detachedReason = reason;
      return session;
    },
    terminate(id: string): RosTerminalSession {
      const session = transition(id, "terminated");
      session.terminatedAt = now();
      emit({
        type: "terminal.session.terminated",
        sessionId: session.id,
        at: session.terminatedAt,
      });
      return session;
    },
    get(id: string): RosTerminalSession {
      return requireSession(id);
    },
    list(): RosTerminalSession[] {
      return [...sessions.values()];
    },
  };
}
