// Resonant iTerm2 terminal host adapter — reference implementation skeleton.
//
// ADR-040 Migration step 4. This is a `local-service` add-on that implements
// the ROS Terminal Host Contract (src/core/terminal-host-contract.ts) against
// iTerm2's Python API. It is a SCAFFOLD: the iTerm2-specific integration
// points are marked TODO for OMP to complete.
//
// Architecture note: the ROS-side adapter is a Node process speaking
// JSON-RPC over stdio (service.protocol = "stdio-json-rpc"). iTerm2 control
// is delegated to iTerm2's Python API (its bundled `iterm2env` runtime), so
// the ROS adapter never shells out with ambient PATH and never holds
// credentials (see ADR-040 "Authorization model").

// Contract descriptor (mirrors TerminalHostAdapterContract). iTerm2 is a
// Level-3 host: it can launch/adopt/attach/detach/terminate sessions and
// stream lifecycle events back to ROS.
export const iterm2AdapterContract = {
  adapterVersion: 1,
  adapterId: "iterm2",
  transport: "local-ipc",
  supportedOperations: [
    "createSession",
    "adoptSession",
    "attachSession",
    "detachSession",
    "terminateSession",
    "listSessions",
    "getSessionState",
    "sendInput",
    "launchBootstrap",
  ],
  capabilities: [
    "launch",
    "adopt",
    "attach",
    "detach",
    "terminate",
    "list-sessions",
    "cwd",
    "environment",
    "command",
    "send-input",
    "lifecycle-events",
    "screen-stream",
    "multiplexer",
  ],
  feedbackChannel: "event-stream",
};

// TODO(OMP): establish the iTerm2 Python API connection (iterm2.connect or the
// AutoLaunch daemon) and resolve each operation against the iTerm2 Python API.

export async function createSession({ project, providerProfileId, bootstrapCommand }) {
  // TODO: iTerm2 Python API — create a window/tab running the bootstrap command
  // (`ros-session attach <id>`), never a credential-bearing command string.
  throw new Error("not implemented: createSession");
}

export async function adoptSession({ hostSessionId }) {
  // TODO: iTerm2 Python API — adopt an existing session by GUID/user variable.
  throw new Error("not implemented: adoptSession");
}

export async function attachSession({ sessionId }) {
  // TODO: assign ros.session.id + authorize resources for the adopted/created session.
  throw new Error("not implemented: attachSession");
}

export async function detachSession({ sessionId, reason }) {
  // TODO: detach without terminating; record detachedReason.
  throw new Error("not implemented: detachSession");
}

export async function terminateSession({ sessionId }) {
  // TODO: iTerm2 Python API — close the session/window; report terminal.session.terminated.
  throw new Error("not implemented: terminateSession");
}

export async function listSessions() {
  // TODO: iTerm2 Python API — enumerate windows/tabs/sessions with CWD + identity.
  throw new Error("not implemented: listSessions");
}

export async function getSessionState({ sessionId }) {
  // TODO: report cwd, process identity, terminal capabilities for a session.
  throw new Error("not implemented: getSessionState");
}

export async function sendInput({ sessionId, text }) {
  // TODO: iTerm2 Python API — send text to the session.
  throw new Error("not implemented: sendInput");
}

export async function launchBootstrap({ sessionId, bootstrapCommand }) {
  // TODO: run the ROS bootstrap in the managed session so secrets stay out of
  // the command line (see SessionBootstrapGrant in the contract).
  throw new Error("not implemented: launchBootstrap");
}
