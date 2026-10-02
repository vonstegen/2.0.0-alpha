// Resonant iTerm2 terminal host adapter — Node-side metadata + contract
// descriptor. The runtime adapter is `adapter.py` (a Python process that
// speaks JSON-RPC over stdio to the ROS bridge). This file exists so
// Node-side consumers (tests, manifest validators) can `import` the
// `iterm2AdapterContract` descriptor and the supported-operations list
// without spawning a process. The two surfaces stay in lockstep:
// changes to either file must be reflected in addon.json's
// `service.entrypoint` and `service.supportedOperations`.

export const iterm2AdapterContract = {
  adapterVersion: 1,
  adapterId: "iterm2",
  transport: "local-ipc",
  // Operations the Python runtime (adapter.py) implements in this commit.
  // The full list per ADR-040 (adopt/attach/detach/list/getState) is
  // scaffolded for follow-up commits; the bridge service rejects calls
  // to operations not in this list with `unsupported-operation`.
  supportedOperations: [
    "createSession",
    "launchBootstrap",
    "sendInput",
    "terminateSession",
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

// Stable runtime contract: the Python adapter's argv is `python3 adapter.py`
// (see addon.json `service.entrypoint`); the bridge's stdio loopback is
// configured in `browser-first/host/terminal-host-service.mjs` from the
// same RESONANT_TERMINAL_DRIVER=iterm2 branch.
export const iterm2Runtime = Object.freeze({
  interpreter: "python3",
  script: "adapter.py",
  protocol: "stdio-json-rpc",
});
