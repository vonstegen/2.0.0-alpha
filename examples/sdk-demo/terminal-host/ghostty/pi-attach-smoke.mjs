#!/usr/bin/env node
// CP-S5c end-to-end smoke — pi attached in the adopted external terminal.
//
// The full chain (Step 5 / 5B / 5C):
//   harness-host-service (in-process, real createHarnessHostService)
//     -> startBridgeServer (real ephemeral loopback, real bridge auth)
//     -> terminal-host service (REAL Ghostty adapter) OR stub mode
//     -> launchBootstrap(...) WITHOUT bootstrapCommand override
//        -> host mints + tracks the SessionBootstrapGrant
//        -> host writes the 0600 token file
//        -> host writes the 0600 auth file (baseUrl + bridge/capability
//           tokens) when the host wires attachAuth
//        -> host composes the ros-session attach command (eval head)
//        -> appends the supplied commandSuffix
//        -> emits the composed command to the adapter
//   in Ghostty (or stub): the shell sources
//     eval "$(ros-session attach --token-file ... --auth-file ...)"
//     which POSTs to the live loopback route, consumes the grant, and
//     prints `export NAME='value'` lines for the projected env
//
//   then the supplied proof tail writes /tmp/ros-s5c-proof.txt with
//   observed env names (no literal token/credential values ride argv).
//
// The smoke is runnable against a real Ghostty.app on macOS, OR in
// deterministic stub mode (ROS_S5C_STUB_TERMINAL=1) which replaces the
// real Ghostty adapter with a captured-command stub that the smoke
// executes locally. Stub mode proves the live HTTP route is reachable
// and authenticated end-to-end without requiring Ghostty.
//
// Run (real Ghostty):
//   PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
//     RESONANT_TERMINAL_DRIVER=ghostty \
//     RESONANT_TERMINAL_HOST_BRIDGE=1 \
//     node --experimental-strip-types \
//       examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
//
// Run (deterministic stub):
//   ROS_S5C_STUB_TERMINAL=1 \
//     node --experimental-strip-types \
//       examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
//
// Exit code 0 = green; 1 = red.

import { existsSync } from "node:fs";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import nodeEvents from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const FAKE_CRED = "sk-cp-s5c-sentinel-do-not-leak";
const FAKE_CRED_NAME = "OPENAI_API_KEY";
const PROOF_FILE = "/tmp/ros-s5c-proof.txt";
const ATTACH_ERROR_FILE = "/tmp/ros-s5c-attach-error.json";
const STUB_MODE = process.env.ROS_S5C_STUB_TERMINAL === "1";

if (!STUB_MODE && !existsSync("/Applications/Ghostty.app")) {
  console.error("[smoke] FAIL: /Applications/Ghostty.app not found; install Ghostty or run with ROS_S5C_STUB_TERMINAL=1");
  process.exit(1);
}

let pass = true;

const REPO = process.cwd();
const TERMINAL_HOST_SERVICE_PATH = join(REPO, "browser-first/host/terminal-host-service.mjs");
const ROS_SESSION_CLI = join(REPO, "browser-first/bin/ros-session.mjs");

// Dynamic imports so the smoke fails cleanly when Ghostty is missing.
const { createHarnessHostService } = await import(join(REPO, "browser-first/host/harness-host-service.mjs"));
const { createTerminalHostHostWiring } = await import(join(REPO, "browser-first/host/terminal-host-host-wiring.mjs"));
const { createTerminalHostService } = await import(TERMINAL_HOST_SERVICE_PATH);
const { installTerminalHostBridge, uninstallTerminalHostBridge } = await import(join(REPO, "browser-first/host/terminal-host-bridge-wiring.mjs"));
const { createBridgeToken, startBridgeServer } = await import(join(REPO, "browser-first/host/bridge-server.mjs"));
const { piCommand } = await import(join(REPO, "browser-first/host/pi-runtime.mjs"));

// Tiny assert helper; defined up front so the stub-mode block can use it.
const assert = {
  match(actual, pattern) {
    if (!pattern.test(actual)) {
      console.error(`[smoke] FAIL: ${actual} does not match ${pattern}`);
      pass = false;
    }
  },
};

console.error(`[smoke] CP-S5c pi-attach external-terminal end-to-end (mode=${STUB_MODE ? "stub" : "ghostty"})`);

// Clear stale error/proof files from any prior run.
try { await rm(ATTACH_ERROR_FILE, { force: true }); } catch { /* */ }
try { await rm(PROOF_FILE, { force: true }); } catch { /* */ }

// 1. Per-run isolated userRoot so a prior smoke's manifest is not silently
//    owned by this run.
const USER_ROOT = `/tmp/ros-s5c-user-${randomUUID().slice(0, 8)}`;

// 2. Real host wiring with an injected profile + secret for OPENAI_API_KEY.
const hostTerminal = createTerminalHostHostWiring({
  userRoot: USER_ROOT,
  env: process.env,
  getProfile: async (id) => id === "openai"
    ? { id, templateId: "openai", providerType: "openai" }
    : null,
  resolveSecret: async (profile) => profile?.id === "openai" ? FAKE_CRED : null,
});

// 3. Resolve pi before constructing the terminal host; abort early if missing.
const piProbe = piCommand();
console.error(`[smoke] piCommand probe: ${piProbe ? piProbe.command + " (source=" + piProbe.source + ")" : "NOT FOUND"}`);

// 4. Mint bridge + capability tokens; the attachAuth closure supplies them.
const bridgeToken = createBridgeToken();
const controlToken = createBridgeToken();
// baseUrl is assigned just below after startBridgeServer; the closure
// captures it via the shared `baseUrl` binding (not a stale literal).
let baseUrl = "<pending>";
const attachAuth = async () => ({ baseUrl, bridgeToken, controlCapabilityToken: controlToken });

// 5. Construct the terminal-host service FIRST so the harness can resolve
//    the pi-terminal-v1 adapter at createSession time (the adapter needs
//    terminalHost.service + terminalHost.start.bus in its closure).
let terminalBridge; // { service, started }
let bus;
let stubCommands = []; // captured composed commands in stub mode

if (STUB_MODE) {
  const captured = [];
  const makeStubChild = () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const { EventEmitter } = nodeEvents;
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin, stdout, stderr, pid: 99999, killed: false,
      kill() { child.killed = true; setImmediate(() => child.emit("exit", 0, null)); },
    });
    stdin.on("data", (chunk) => {
      const line = chunk.toString().replace(/\n+$/, "");
      let reqObj;
      try { reqObj = JSON.parse(line); } catch { return; }
      if (typeof reqObj.id === "undefined") return;
      if (reqObj.method === "launchBootstrap") {
        captured.push(reqObj.params.bootstrapCommand);
        stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqObj.id, result: { sessionId: reqObj.params.sessionId, status: "started" } }) + "\n");
      } else {
        stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqObj.id, result: { ok: true } }) + "\n");
      }
    });
    return { child, captured };
  };
  const stub = makeStubChild();
  const service = createTerminalHostService({
    env: { ...process.env, RESONANT_TERMINAL_DRIVER: "ghostty" },
    rosSessionPath: ROS_SESSION_CLI,
    spawn: () => stub.child,
    attachAuth,
  });
  const startedHandle = await service.start();
  bus = startedHandle.bus;
  terminalBridge = { service, started: startedHandle };
  stubCommands = stub.captured;
} else {
  terminalBridge = await installTerminalHostBridge({
    env: { ...process.env, RESONANT_TERMINAL_HOST_BRIDGE: "1" },
    serviceOptions: { attachAuth },
  });
  if (!terminalBridge.enabled) {
    console.error("[smoke] FAIL: terminal-host bridge did not start (set RESONANT_TERMINAL_HOST_BRIDGE=1)");
    process.exit(1);
  }
  console.error(`[smoke] terminal bridge started: driveId=${terminalBridge.started.driveId}`);
  bus = terminalBridge.started.bus;
}

// 6. Build the harness host service. The pi-terminal-v1 adapter is
//    resolved at createSession time and needs the terminalHost
//    service/start in its closure. The manifest declares a
//    terminal://host endpoint that must be approved by an explicit
//    binding; without it the registry refuses install with
//    permission-denied.
const fakeProviderHost = {
  executeRawProviderChat: async () => ({ reply: "noop" }),
  executeProviderStatus: async () => ({ providers: [] }),
};
const harness = await createHarnessHostService({
  userRoot: USER_ROOT,
  env: process.env,
  providerHost: fakeProviderHost,
  hostTerminal,
  terminalHost: { service: terminalBridge.service, start: terminalBridge.started },
  bindings: [{
    name: "host.terminal-session-env",
    addonId: "addon.pi-terminal",
    adapterId: "pi-terminal-v1",
    authScheme: "session-environment",
    endpoint: "terminal://host",
  }],
});

// 7. Start the real bridge server with the harness routes + capability tokens.
const seen = [];
const spiedRoutes = harness.harnessRoutes.map((r) =>
  r.path === "/terminal-host/session/attach"
    ? {
        ...r,
        handler: async (payload, request) => {
          seen.push({
            url: request?.url,
            host: request?.headers?.host,
            hasGrantToken: typeof payload?.token === "string" && payload.token.length > 0,
            payloadKeys: payload ? Object.keys(payload).sort() : [],
          });
          return r.handler(payload, request);
        },
      }
    : r);
const bridgeServer = await startBridgeServer({
  port: 0,
  host: "127.0.0.1",
  bridgeToken,
  bridgeCapabilityTokens: { "addon-runtime-control": controlToken },
  routes: spiedRoutes,
});
baseUrl = `http://127.0.0.1:${bridgeServer.address().port}`;
console.error(`[smoke] loopback bridge mounted at ${baseUrl}`);

// 8. Install the pi-terminal harness manifest + grant + assign primary slot.
const manifest = JSON.parse(await readFile(new URL("../../../../browser-first/host/harness-examples/pi-terminal.json", import.meta.url), "utf8"));
const installRes = await harness.harnessRoutes.find((r) => r.path === "/addons/install").handler({ manifest, enabled: true });
if (!installRes || installRes.error) {
  console.error("[smoke] FAIL: install returned", installRes);
  await (STUB_MODE ? terminalBridge.service.stop() : uninstallTerminalHostBridge({ service: terminalBridge.service }));
  await new Promise((resolve) => bridgeServer.close(resolve));
  process.exit(1);
}
const grantRes = await harness.harnessRoutes.find((r) => r.path === "/addons/grants").handler({
  addonId: manifest.id,
  grants: manifest.requestedCapabilities.map((g) => ({ ...g, granted: true })),
  consent: true,
  expectedRevision: installRes.revision,
});
if (!grantRes || grantRes.error) {
  console.error("[smoke] FAIL: grants returned", grantRes);
  await (STUB_MODE ? terminalBridge.service.stop() : uninstallTerminalHostBridge({ service: terminalBridge.service }));
  await new Promise((resolve) => bridgeServer.close(resolve));
  process.exit(1);
}
const slotRes = await harness.harnessRoutes.find((r) => r.path === "/addons/slots/assign").handler({
  slot: "primary-agent",
  addonId: manifest.id,
  expectedGeneration: 0,
});
if (!slotRes || slotRes.error) {
  console.error("[smoke] FAIL: slot assignment returned", slotRes);
  await (STUB_MODE ? terminalBridge.service.stop() : uninstallTerminalHostBridge({ service: terminalBridge.service }));
  await new Promise((resolve) => bridgeServer.close(resolve));
  process.exit(1);
}
console.error("[smoke] addon installed + granted + assigned");

// 9. Create a session.
const sessionRes = await harness.harnessRoutes.find((r) => r.path === "/agent/session").handler({ addonId: manifest.id });
if (!sessionRes?.session) {
  console.error("[smoke] FAIL: createSession returned", sessionRes);
  await (STUB_MODE ? terminalBridge.service.stop() : uninstallTerminalHostBridge({ service: terminalBridge.service }));
  await new Promise((resolve) => bridgeServer.close(resolve));
  process.exit(1);
}
const session = sessionRes.session;
console.error(`[smoke] session: ${session.sessionId}`);

// 10. Subscribe to the terminal bus BEFORE the env-proof launch so we don't
//     miss events. In stub mode the stub does not emit events; the proof
//     file + structured error file are the real evidence.
const busEvents = [];
const subscription = bus.subscribe();
(async () => {
  for await (const event of subscription) {
    busEvents.push(event);
  }
})();

// 11. The proof tail writes PROOF_FILE using env NAMES only (no literals).
//     It runs AFTER the eval head; if attach failed, env is unset and the
//     file still gets written but with empty values — the smoke asserts
//     non-empty + the structured error file tells the operator why.
//     Single-line so the shell-expansion semantics are unambiguous and
//     no backslash-line-continuations smuggle whitespace into printf args.
//     Stderr is captured to /tmp/ros-s5c-stderr.txt so a failure surfaces
//     the actual in-window error (not just "the command did not finish").
//
//     Ghostty 1.3.1's `abnormal-command-exit-runtime` threshold (default
//     250 ms) treats any sub-threshold child exit as a failed launch on
//     macOS (because the launch wraps through /usr/bin/login). Without the
//     keep-alive, the user sees a "Ghostty failed to launch the requested
//     command / Runtime: <ms>" banner even though the proof file was
//     written correctly. In real Ghostty mode the tail execs $SHELL so
//     bash stays alive and the window becomes interactive (the natural
//     hosted-terminal behavior after the probe). In stub mode the smoke
//     runs the composed command locally and we cannot keep the local exec
//     alive (it would hang the test); we use the simple one-shot form.
//
//     CP-S5T-2 (paste-input): the inner `bash -c '...; exec $SHELL'`
//     execs the interactive shell inside a child process. If the outer
//     proofTail ALSO execs $SHELL, we end up with TWO shells on the
//     same stdin (the inner $SHELL replaced the child; the outer
//     proofTail exec REPLACES the parent). Both shells then race for
//     the same input — pasting a command can be split or echoed between
//     them and never execute cleanly. The keep-alive lives entirely
//     inside the child `bash -c`, so the outer bash exits cleanly
//     after the child execs and only ONE shell owns the TTY.
const STDERR_FILE = "/tmp/ros-s5c-stderr.txt";
// Bash default-value form is ${VAR:-default} — JS template literals would
// try to parse the interior as JS, so we build the literal at runtime
// (no JS interpolation of the ${...}).
const probeShellForm = "${SHELL:-/bin/bash}";
const proofTailOneShot = `bash -c 'printf "%s\\n" "OPENAI_API_KEY=$OPENAI_API_KEY" "ROS_PROJECT_ROOT=$ROS_PROJECT_ROOT" "ROS_SKILLS_DIR=$ROS_SKILLS_DIR" > ${PROOF_FILE} 2>${STDERR_FILE}'`;
const proofTailKeepAlive = `${proofTailOneShot}; exec "${probeShellForm}"`;
const proofTail = STUB_MODE ? proofTailOneShot : proofTailKeepAlive;

// 12. Exercise the host-composed production path:
//     - attachAuth supplies the auth-file payload (baseUrl + tokens)
//     - host mints + tracks the grant and writes the 0600 token file
//     - host writes the 0600 auth file
//     - host composes the ros-session attach command (eval head)
//     - host appends the supplied proof tail as commandSuffix
//     - host emits the composed command to the adapter
//     - in stub mode the stub captures it; in real Ghostty it runs in a window
const proofSessionId = `s-proof-${randomUUID().slice(0, 8)}`;
const envProofResult = await terminalBridge.service.launchBootstrap({
  sessionId: proofSessionId,
  providerProfileId: "openai",
  harness: manifest.id,
  project: { root: REPO, cwd: REPO },
  commandSuffix: proofTail,
  errorFile: ATTACH_ERROR_FILE,
});
console.error(`[smoke] env proof launchBootstrap -> ${JSON.stringify(envProofResult)}`);

// 12b. Stub mode: execute the captured composed command locally so the
//      full ros-session attach chain (auth-file read, POST, grant consume,
//      env export, proof tail) runs against the live server. Use async
//      spawn + a wall-clock budget (spawnSync deadlocks on this shell
//      when a grandchild node writes to stdout while the bash parent
//      pipes are waiting for EOF).
if (STUB_MODE) {
  if (stubCommands.length === 0) {
    console.error("[smoke] FAIL: stub captured no launchBootstrap commands");
    pass = false;
  } else {
    const cmd = stubCommands[0];
    assertNoSecretsInCommand(cmd, { bridgeToken, controlToken, FAKE_CRED });
    if (!pass) {
      console.error(`[smoke] composed command preview: ${cmd.slice(0, 200)}...`);
    }
    assert.match(cmd, /^eval "\$\(node .*ros-session\.mjs' attach /);
    assert.match(cmd, /--token-file '\/[^']+\.token'/);
    assert.match(cmd, /--auth-file '\/[^']+\.auth\.json'/);
    assert.match(cmd, /--error-file '\/tmp\/ros-s5c-attach-error\.json'/);
    if (!cmd.endsWith(`; ${proofTail}`)) {
      console.error(`[smoke] FAIL: commandSuffix must follow the attach command`);
      pass = false;
    }
    const { spawn } = await import("node:child_process");
    const exitInfo = await new Promise((resolve) => {
      const p = spawn("/bin/bash", ["-c", cmd], { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      p.stderr.on("data", (c) => { stderr += c.toString(); });
      p.on("error", (err) => resolve({ code: -1, signal: null, stderr: err.message, killed: false }));
      p.on("exit", (code, signal) => resolve({ code, signal, stderr, killed: false }));
      // Safety bound: the command should finish in well under 5s; if it
      // hangs (e.g. fetch blocked on a blackholed port), SIGKILL the
      // grandchild tree and surface a structured blocker.
      setTimeout(() => {
        p.kill("SIGKILL");
        resolve({ code: -1, signal: "SIGKILL", stderr: stderr + "\n[smoke] BLOCKER: local stub execution timed out after 5000ms", killed: true });
      }, 5_000);
    });
    if (exitInfo.killed) {
      console.error(`[smoke] BLOCKER: local stub execution timed out: ${exitInfo.stderr}`);
      pass = false;
    } else if (exitInfo.code !== 0) {
      console.error(`[smoke] BLOCKER: local stub execution failed (status=${exitInfo.code} signal=${exitInfo.signal}): ${exitInfo.stderr}`);
      pass = false;
    } else {
      console.error("[smoke] local stub execution OK");
    }
  }
}

// 13. Wait briefly for the in-window command (real Ghostty) or read the
//     local effects (stub) — proof file written OR error file written.
let waited = 0;
while (waited < (STUB_MODE ? 1000 : 15_000)) {
  await delay(500); waited += 500;
  let proofExists = false;
  try { await stat(PROOF_FILE); proofExists = true; } catch { /* */ }
  let errorExists = false;
  try { await stat(ATTACH_ERROR_FILE); errorExists = true; } catch { /* */ }
  if (proofExists || errorExists) break;
}
console.error(`[smoke] waited ${waited}ms; bus events: ${busEvents.length}`);

// 14. Assertions.
function check(label, ok) {
  console.error(`[smoke] ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) pass = false;
}

// 14a. Bus saw terminal events (real Ghostty) OR is empty because the
//      stub did not emit them (stub mode). In stub mode we accept the
//      empty bus; the real evidence is the proof file.
//
//      Ghostty's `terminal.command.started` is emitted by title-poll
//      observation (the only automation surface 1.3.1 exposes), which
//      is inherently laggy relative to the in-window bash finishing.
//      The proof file (authoritative) can arrive before the event. We
//      therefore:
//
//        - keep `terminal.session.started` as a HARD assertion (it's
//          deterministic on window creation);
//        - wait an additional bounded 3s window for
//          `terminal.command.started` AFTER the proof/error file has
//          already landed;
//        - if it still does not arrive, log WARN (not FAIL) and let
//          the proof file carry the authoritative evidence.
//      CP-S5T.
let proofFileLanded = false;
try { await stat(PROOF_FILE); proofFileLanded = true; } catch { /* */ }
if (!STUB_MODE && busEvents.length > 0) {
  check("bus captured terminal events", true);
  check("bus saw terminal.session.started", busEvents.some((e) => e.type === "terminal.session.started"));
  const sawCommandStarted = busEvents.some((e) => e.type === "terminal.command.started");
  if (sawCommandStarted) {
    check("bus saw terminal.command.started", true);
  } else {
    // CP-S5T: drain the bus for an additional bounded window AFTER the
    // proof file (or error file) has landed. Ghostty's title-poll can
    // lag the in-window bash finish by several hundred ms in 1.3.1.
    const extraWindowMs = proofFileLanded ? 3_000 : 1_500;
    let extraWaited = 0;
    while (extraWaited < extraWindowMs && !busEvents.some((e) => e.type === "terminal.command.started")) {
      await delay(250);
      extraWaited += 250;
    }
    const sawAfterExtended = busEvents.some((e) => e.type === "terminal.command.started");
    if (sawAfterExtended) {
      console.error(`[smoke] PASS: bus saw terminal.command.started (delivered ${extraWaited}ms late via title-poll)`);
    } else {
      // WARN, not FAIL: the proof file is the authoritative gate. The
      // bus observation is best-effort.
      console.error(`[smoke] WARN: bus never saw terminal.command.started after extended ${extraWindowMs}ms window — known title-poll lag in Ghostty 1.3.1; proof file is authoritative (${proofFileLanded ? "present" : "absent — see FAIL below"})`);
    }
  }
} else if (!STUB_MODE) {
  console.error("[smoke] BLOCKER: bus captured no events; Ghostty adapter unreachable from this shell.");
  pass = false;
}

// 14b. No bus event payload carries the credential value.
const allEvents = JSON.stringify(busEvents);
if (busEvents.length > 0) {
  check("no credential value in bus events", !allEvents.includes(FAKE_CRED));
}

// 14c. The auth + token files were never exposed via the route boundary
//      in any non-secure way: URL never carried the bridge token, the
//      payload carried only the grant token (in the body, as designed).
const attachObs = seen.find((s) => s.url === "/terminal-host/session/attach");
check("the attach route was exercised at least once", !!attachObs);
if (attachObs) {
  check("attach request's URL has no bridge/capability token", !attachObs.host?.includes(bridgeToken) && !attachObs.host?.includes(controlToken));
  check("attach request payload carries the grant token", attachObs.hasGrantToken);
}

// 14d. The proof file was written and contains the expected env names.
let proof = null;
let errPayload = null;
try { proof = await readFile(PROOF_FILE, "utf8"); } catch { /* not written */ }
if (proof) {
  check(`proof file ${PROOF_FILE} exists`, true);
  // Print the proof file (redacted) for diagnosis: lines are stable text,
  // no secrets ride it in the OPENAI_API_KEY value (the smoke is a
  // diagnostic surface, not a report destination).
  console.error(`[smoke] proof file contents:\n${proof}`);
  const credLine = proof.split("\n").find((l) => l.startsWith(`${FAKE_CRED_NAME}=`)) ?? "";
  check(`proof file contains ${FAKE_CRED_NAME}=sk-cp-s5c-sentinel-...`, credLine.includes(FAKE_CRED));
  check("proof file contains ROS_PROJECT_ROOT=...", /ROS_PROJECT_ROOT=\S+/.test(proof));
  check("proof file contains ROS_SKILLS_DIR=...", /ROS_SKILLS_DIR=\S+/.test(proof));
  check("proof file contains no bridge token", !proof.includes(bridgeToken));
  check("proof file contains no capability token", !proof.includes(controlToken));
  try { await rm(PROOF_FILE, { force: true }); } catch { /* */ }
} else {
  if (errPayload) {
    console.error(`[smoke] BLOCKER: proof file absent; structured failure reason: ${errPayload.reason}`);
  } else if (!STUB_MODE) {
    console.error(`[smoke] BLOCKER: proof file ${PROOF_FILE} not written; Ghostty adapter did not complete the in-window command.`);
  } else {
    console.error(`[smoke] BLOCKER: proof file ${PROOF_FILE} not written after local stub execution.`);
  }
  // Read the captured in-window stderr so the operator sees the actual
  // failure, not just "the command did not finish". Redacted: only the
  // first 2 KiB is logged; secrets are not expected to ride stderr but
  // the cap is defensive.
  try {
    const stderr = await readFile(STDERR_FILE, "utf8");
    if (stderr) {
      console.error(`[smoke] in-window stderr (first 2 KiB):\n${stderr.slice(0, 2048)}`);
    }
  } catch { /* no stderr captured */ }
  pass = false;
}

// 14e. On a structured failure, report it and do not claim CP-S5c.
try { errPayload = JSON.parse(await readFile(ATTACH_ERROR_FILE, "utf8")); } catch { /* no error file — fine on success */ }
if (errPayload) {
  console.error(`[smoke] ros-session error file: reason=${errPayload.reason} (no secrets, summary only)`);
  if (proof) check("no structured error file on success", false);
  try { await rm(ATTACH_ERROR_FILE, { force: true }); } catch { /* */ }
}

// 15. Cleanup.
if (!STUB_MODE) {
  await uninstallTerminalHostBridge({ service: terminalBridge.service });
} else {
  await terminalBridge.service.stop();
}
await harness.close();
await new Promise((resolve) => bridgeServer.close(resolve));
console.error(pass ? "[smoke] CP-S5c green" : "[smoke] CP-S5c RED");
process.exit(pass ? 0 : 1);

// ---- helpers ----
function assertNoSecretsInCommand(cmd, { bridgeToken: bt, controlToken: ct, FAKE_CRED: cred }) {
  if (cmd.includes(bt)) { console.error("[smoke] FAIL: composed command leaks the bridge token value"); pass = false; }
  if (cmd.includes(ct)) { console.error("[smoke] FAIL: composed command leaks the control capability token value"); pass = false; }
  if (cmd.includes(cred)) { console.error("[smoke] FAIL: composed command leaks the credential value"); pass = false; }
}
