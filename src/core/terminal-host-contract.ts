// Intent citation: docs/architecture/ADR-040-terminal-host-adapter-contract.md
//
// Terminal Host Contract — the replaceable-host boundary between ResonantOS
// (resource/authority/session authority) and an external terminal (iTerm2,
// Ghostty, WezTerm, kitty, Apple Terminal) that runs a harness (Pi, OMP,
// Codex, Claude Code, Gemini, Hermes).
//
// The host does terminal things; ROS does ROS things. A harness sees a
// PTY/shell environment and never learns which terminal host is attached.

import type { Capability } from "./contracts";

export const TERMINAL_HOST_CONTRACT_VERSION = 1 as const;

// Open union: third-party terminals may register without a core change, in the
// same style as `ShellSectionId` / `AddOnDockIconName`.
export type TerminalHostAdapterId =
  "iterm2" | "ghostty" | "wezterm" | "kitty" | "apple-terminal" | (string & {});

// What a terminal adapter can do. This is an adapter-discovery axis, distinct
// from the core `Capability` axis (what ROS grants an add-on). A Level-1 host
// (Apple Terminal) declares only launch/cwd/environment/command; a Level-3 host
// (iTerm2/WezTerm/kitty) also declares feedback capabilities.
export type TerminalHostAdapterCapability =
  | "launch"
  | "adopt"
  | "attach"
  | "detach"
  | "terminate"
  | "list-sessions"
  | "cwd"
  | "environment"
  | "profile"
  | "command"
  | "send-input"
  | "get-text"
  | "lifecycle-events"
  | "screen-stream"
  | "multiplexer";

// The operations a terminal adapter implements — terminal-API primitives only.
// Each adapter maps these onto its native mechanism (Python API, AppleScript,
// CLI, remote control protocol). Session bookkeeping verbs (adopt/attach/
// detach/list/state) live on `RosSessionOperation`, NOT here, because ROS owns
// them and they never require a terminal-API call. See
// docs/architecture/TERMINAL-HOST-OPERATION-SPLIT.md.
export const TERMINAL_HOST_OPERATIONS = [
  "createSession",
  "launchBootstrap",
  "sendInput",
  "terminateSession",
] as const;

export type TerminalHostOperation = (typeof TERMINAL_HOST_OPERATIONS)[number];

// The operations ROS performs on its own `RosTerminalSession` model. These are
// terminal-agnostic session-bookkeeping verbs, implemented by a ROS session
// manager (not yet built), never by a terminal adapter. A terminal contributes
// to them only indirectly, via its feedback channel (event-stream telemetry).
export const ROS_SESSION_OPERATIONS = [
  "adoptSession",
  "attachSession",
  "detachSession",
  "listSessions",
  "getSessionState",
] as const;

export type RosSessionOperation = (typeof ROS_SESSION_OPERATIONS)[number];

// How a session came to exist. `create` (ROS launched the terminal), `adopt`
// (user already had a terminal and ran `ros attach`), `detached` (an ordinary
// session ROS observed but has not adopted).
export type TerminalSessionEntryMode = "create" | "adopt" | "detached";

// Session lifecycle. `created`/`adopted` are the two entry states; both must
// converge on the same `attached` contract so a harness cannot tell who
// launched the terminal (TH-3D equivalence).
export type RosTerminalSessionState =
  "created" | "adopted" | "attached" | "running" | "detached" | "terminated";

export type TerminalHostTransport =
  "local-ipc" | "stdio-json-rpc" | "http-json" | "apple-script" | "remote-control";

// Mirrors `AddOnAgentRuntimeAdapterContract`: declarative, reviewed, and the
// only place a terminal's transport/authority is described.
export interface TerminalHostAdapterContract {
  adapterVersion: typeof TERMINAL_HOST_CONTRACT_VERSION;
  adapterId: TerminalHostAdapterId;
  transport: TerminalHostTransport;
  supportedOperations: readonly TerminalHostOperation[];
  capabilities: readonly TerminalHostAdapterCapability[];
  // Whether terminal state can flow back to ROS. iTerm2/WezTerm/kitty expose
  // event streams; Apple Terminal is polling-limited; some hosts are one-way.
  feedbackChannel: "none" | "polling" | "event-stream";
}

// The ROS-owned session object. ROS is the session authority; the terminal is a
// replaceable host. `hostSessionId` is an opaque host-specific reference
// (iTerm2 session GUID, WezTerm pane id, kitty window id, ...).
export interface RosTerminalSession {
  id: string; // ros-session-8F92
  state: RosTerminalSessionState;
  entryMode: TerminalSessionEntryMode;
  terminalHost: {
    adapterId: TerminalHostAdapterId;
    hostSessionId?: string;
  };
  harness?: {
    addonId: string;
    processId?: number;
  };
  project?: {
    root: string;
    cwd: string;
  };
  providerProfileId?: string;
  grantedCapabilities: readonly Capability[];
  // Best provenance fidelity this session can produce (see ProvenanceFidelity).
  provenanceFidelity: ProvenanceFidelity;
  createdAt: string;
  attachedAt?: string;
  terminatedAt?: string;
  detachedReason?: string;
}

// How much provenance DAR (or any recorder) can capture for a session. The
// value is the highest fidelity the session's harness can actually produce:
//
//   - "structured": a cooperative harness publishes HarnessRuntimeEvent
//     (tool calls, artifacts, messages). Full DAR/CSRO provenance.
//   - "telemetry": a stock CLI publishes no harness events; DAR records only
//     TerminalTelemetryEvent (command boundaries, cwd, exit status, lifecycle).
//   - "observation": no terminal feedback channel; screen-stream/debug only.
//
// A wrapping adapter may upgrade "telemetry" -> "structured" for a specific
// CLI, but that is per-harness work and is never assumed.
export type ProvenanceFidelity = "structured" | "telemetry" | "observation";

// ---------------------------------------------------------------------------
// Bidirectional event surface.
//
// Two event families, kept separate on purpose:
//   1. Terminal telemetry — observed at the terminal boundary, supplemental.
//      Never the primary protocol (no screen-scraping).
//   2. Harness runtime events — structured, published by a cooperative harness.
//      Primary source for DAR/CSRO provenance.
// ---------------------------------------------------------------------------

export type TerminalTelemetryEvent =
  | { type: "terminal.session.started"; sessionId: string; at: string }
  | { type: "terminal.command.started"; sessionId: string; at: string; command?: string }
  | { type: "terminal.command.ended"; sessionId: string; at: string; exitStatus?: number }
  | { type: "terminal.cwd.changed"; sessionId: string; at: string; cwd: string }
  | { type: "terminal.session.terminated"; sessionId: string; at: string; exitStatus?: number };

export type HarnessRuntimeEvent =
  | { type: "harness.session.created"; sessionId: string; at: string }
  | { type: "harness.session.started"; sessionId: string; at: string }
  | { type: "harness.user.message"; sessionId: string; at: string; content: string }
  | { type: "harness.assistant.message"; sessionId: string; at: string; content: string }
  | {
      type: "harness.tool.called";
      sessionId: string;
      at: string;
      tool: string;
      args?: Record<string, unknown>;
    }
  | {
      type: "harness.artifact.created";
      sessionId: string;
      at: string;
      artifact: { type: string; path?: string };
    }
  | { type: "harness.resource.accessed"; sessionId: string; at: string; resource: string }
  | { type: "harness.session.completed"; sessionId: string; at: string; exitStatus?: number };

export type RosTerminalEventSource = "terminal" | "harness";

// Normalized envelope. DAR (or any event-consumer add-on) subscribes to this;
// it does not own the terminal or the harness.
export interface RosTerminalEventEnvelope {
  version: typeof TERMINAL_HOST_CONTRACT_VERSION;
  sessionId: string;
  source: RosTerminalEventSource;
  at: string;
  event: TerminalTelemetryEvent | HarnessRuntimeEvent;
}

// ---------------------------------------------------------------------------
// Error model — one fixed public vocabulary, same pattern as
// `HARNESS_PUBLIC_ERROR_MESSAGES`.
// ---------------------------------------------------------------------------

export type TerminalHostErrorCode =
  | "invalid-manifest"
  | "unsupported-operation"
  | "session-not-found"
  | "adopt-failed"
  | "attach-conflict"
  | "permission-denied"
  | "terminal-unavailable";

export const TERMINAL_HOST_PUBLIC_ERROR_MESSAGES = Object.freeze({
  "invalid-manifest": "Invalid terminal host manifest.",
  "unsupported-operation": "Terminal operation unavailable.",
  "session-not-found": "Terminal session not found.",
  "adopt-failed": "Terminal session could not be adopted.",
  "attach-conflict": "Terminal session is already attached.",
  "permission-denied": "Terminal permission denied.",
  "terminal-unavailable": "Terminal host unavailable.",
} as const satisfies Record<TerminalHostErrorCode, string>);

// ---------------------------------------------------------------------------
// Authorization. The terminal host reuses the existing per-addon bearer/admin
// token + capability-grant model (P6 precedent); only the session bootstrap
// token is new. See ADR-040 "Authorization model".
// ---------------------------------------------------------------------------

// The single credential that crosses the terminal command line. `ros-session
// attach <id>` receives this from ROS; it is audience-bound to one session,
// single-use (claim then discard), and may only fetch the authorized runtime
// environment. It can never mint authority, read the add-on bearer/admin
// tokens, or grant capabilities.
export interface SessionBootstrapGrant {
  sessionId: string;
  token: string;
  purpose: "attach" | "adopt";
  issuedAt: string;
  expiresAt: string;
}
