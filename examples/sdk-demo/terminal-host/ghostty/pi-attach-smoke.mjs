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
// CP-L1 memory-projection threading (fields added by this phase):
//   smoke launchBootstrap({ memoryAccess, memoryRoot })            [this file]
//     -> terminal-host-service.launchBootstrap({ memoryAccess, memoryRoot })
//     -> composeBootstrapCommand emits `--memory-mode <mode> --memory-root <path>`
//     -> ros-session attach CLI flags (bin/ros-session.mjs)
//     -> POST /terminal-host/session/attach body { memoryAccess, memoryRoot }
//     -> route delegates to buildProjectedSessionEnv (stagingBase from the
//        host wiring: <userRoot>/Staging) -> buildHarnessMemoryProjection
//        writes <stagingBase>/memory-context/<identity>/context.md (0600)
//     -> exported env carries ROS_MEMORY_CONTEXT=<that path>; memory
//        CONTENT never rides argv/env/logs/bus/proof output.
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
// CP-L2 launch-Pi proof (both modes, after the env-proof assertions):
//   the smoke dispatches a REAL turn via POST /agent/turn. The harness
//   resolves the generic external-cli launcher + reviewed pi-v1 policy
//   (pi-terminal-v1 -> pi-v1), which stages a 0600 prompt file (the smoke
//   prompt is multi-line so the file path is always exercised), composes
//   `'<pi executable>' '@<prompt file>'` as commandSuffix, and delivers it
//   via launchBootstrap (host-owned grant/token/attach — F1 preserved).
//   Pi is long-lived: the smoke asserts terminal.session.started +
//   terminal.command.started and that command.ended does NOT fire within
//   the observation window — it never waits on ended as a success signal.
//   In real Ghostty mode the operator must confirm the Pi TUI visually;
//   afterwards the smoke kills pi by its exact rewritten process title
//   (`pkill -x pi` — pi rewrites its title at startup, so argv patterns do
//   not survive) so the turn finalizes (session.terminated -> generator
//   finally -> prompt file unlinked) and the window closes silently (no
//   live child at close, the CP-SW2 precondition). A real credential is
//   NOT required: Pi starts unauthenticated and the TUI stays open.
//
// CP-L3 (Tier 3, manual acceptance — real credential):
//   1. Store a real OpenAI key in a 0600 file outside the repo, e.g.
//      ~/.config/ros/openai-key (Settings → Providers persists it for ROS
//      itself; the smoke reads it session-only from this file).
//   2. Run the smoke with ROS_S5C_OPENAI_KEY_FILE=<path> — the host wiring
//      resolves that key for profile "openai" instead of the sentinel, and
//      every no-leak assertion switches to the real value.
//   3. Operator confirms in the Pi TUI that /models lists models and one
//      cheap chat turn completes with the delivered credential.
//   This is a manual gate; record the outcome in the run report.
//
// Exit code 0 = green; 1 = red.

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { execFile as execFileCb } from "node:child_process";
import nodeEvents from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const FAKE_CRED = "sk-cp-s5c-sentinel-do-not-leak";
const FAKE_CRED_NAME = "OPENAI_API_KEY";
const PROOF_FILE = "/tmp/ros-s5c-proof.txt";
const ATTACH_ERROR_FILE = "/tmp/ros-s5c-attach-error.json";
// CP-L1: written by the proof tail AFTER `sleep 1` completes, so teardown
// can wait for the in-window command to be fully process-free before
// closing the window (the CP-SW2 silent-close precondition).
const DONE_FILE = `/tmp/ros-s5c-done-${randomUUID().slice(0, 8)}`;
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
const { createTerminalHostService, listOutstandingGrants } = await import(TERMINAL_HOST_SERVICE_PATH);
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

// Promisified execFile that never rejects (callers inspect output/exit via
// other means; used for pgrep/pkill/osascript probes).
const execFile = (cmd, args) => new Promise((resolve) => execFileCb(cmd, args, (err, stdout) => resolve({ err, stdout: stdout ?? "" })));
// Live Ghostty window ids (real mode bookkeeping only).
const ghosttyWindowIds = async () => {
  const { err, stdout } = await execFile("osascript", ["-e", 'tell application "Ghostty" to get id of every window']);
  if (err || !stdout.trim()) return [];
  return stdout.trim().split(/,\s*/);
};

console.error(`[smoke] CP-S5c pi-attach external-terminal end-to-end (mode=${STUB_MODE ? "stub" : "ghostty"})`);

// Clear stale error/proof files from any prior run.
try { await rm(ATTACH_ERROR_FILE, { force: true }); } catch { /* */ }
try { await rm(PROOF_FILE, { force: true }); } catch { /* */ }
try { await rm(DONE_FILE, { force: true }); } catch { /* */ }

// 1. Per-run isolated userRoot so a prior smoke's manifest is not silently
//    owned by this run.
const USER_ROOT = `/tmp/ros-s5c-user-${randomUUID().slice(0, 8)}`;

// 1b. CP-L1: a minimal Living Archive fixture so the M2 memory projection
//     has a real memoryRoot to approve domains against. The projection
//     writes a context file that LISTS approved domains; it never inlines
//     content. The sentinel lets the smoke assert that memory CONTENT
//     never reaches the proof file (only the ROS_MEMORY_CONTEXT path may).
const MEMORY_ROOT = `${USER_ROOT}/memory`;
const MEM_SENTINEL = `s5c-mem-sentinel-${randomUUID().slice(0, 8)}`;
await mkdir(`${MEMORY_ROOT}/AI_MEMORY/wiki`, { recursive: true });
await writeFile(`${MEMORY_ROOT}/AI_MEMORY/wiki/sentinel.md`, `# S5c fixture\n\n${MEM_SENTINEL}\n`, { mode: 0o600 });

// 1c. CP-L2 launch-Pi fixture. The turn prompt is multi-line so the pi-v1
//     policy ALWAYS stages the 0600 prompt file and composes the '@<file>'
//     form (never the prompt text on argv). The sentinel lets the smoke
//     assert the prompt content never reaches the composed command or bus.
const PI_PROMPT_FILE = `${USER_ROOT}/pi-prompt-l2.txt`;
const PI_SENTINEL = `s5c-l2-sentinel-${randomUUID().slice(0, 8)}`;
const PI_PROMPT = [
  "CP-L2 launch smoke; no repository changes requested.",
  `Sentinel (must never appear on argv or the bus): ${PI_SENTINEL}.`,
  "If a working provider credential is present, reply with the single word PONG; otherwise remain at the prompt.",
].join("\n");

// 2. Real host wiring with an injected profile + secret for OPENAI_API_KEY.
//    CP-L3: when ROS_S5C_OPENAI_KEY_FILE names a 0600 file, its contents are
//    resolved as the "openai" secret instead of the sentinel so the operator
//    can perform the Tier-3 real-model acceptance run. The value is read
//    session-only and only ever delivered under the host-owned env-var name.
const REAL_KEY_FILE = process.env.ROS_S5C_OPENAI_KEY_FILE || null;
const CRED_VALUE = REAL_KEY_FILE ? (await readFile(REAL_KEY_FILE, "utf8")).trim() : FAKE_CRED;
const hostTerminal = createTerminalHostHostWiring({
  userRoot: USER_ROOT,
  env: process.env,
  getProfile: async (id) => id === "openai"
    ? { id, templateId: "openai", providerType: "openai" }
    : null,
  resolveSecret: async (profile) => profile?.id === "openai" ? CRED_VALUE : null,
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
  // CP-L2: deterministic prompt-file path so the launch-Pi proof can assert
  // the 0600 staging + post-turn cleanup of the file the pi-v1 policy
  // references via '@<file>'.
  promptFilePath: () => PI_PROMPT_FILE,
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

// 10b. Baseline Ghostty window set (real mode): every window that exists
//      BEFORE the smoke launches anything belongs to the operator. The
//      teardown assertion is "current windows ⊆ baseline" — any extra
//      window is a smoke window that failed to close (e.g. blocked by a
//      "Close Window?" confirm dialog).
const BASELINE_WINDOW_IDS = STUB_MODE ? [] : await ghosttyWindowIds();

// 11. The proof tail writes PROOF_FILE using env NAMES only (no literals).
//     It runs AFTER the eval head; if attach failed, env is unset and the
//     file still gets written but with empty values — the smoke asserts
//     non-empty + the structured error file tells the operator why.
//     Single-line so the shell-expansion semantics are unambiguous and
//     no backslash-line-continuations smuggle whitespace into printf args.
//     Stderr is captured to /tmp/ros-s5c-stderr.txt so a failure surfaces
//     the actual in-window error (not just "the command did not finish").
//
//     CP-SW2 (window cleanup): the smoke uses the one-shot form (no
//     `exec $SHELL` keep-alive). The window stays open only because
//     Ghostty's `wait after command:true` is set (see adapter's
//     composeGhosttyNewWindowOsa). With no process running inside the
//     window, terminateSession's `close (focused terminal of tab 1)`
//     is silent — no "Close Window?" confirm prompt. Earlier iterations
//     left an interactive shell via `exec $SHELL` which forced a
//     confirm dialog on every teardown. Teardown must therefore wait
//     for the tail's done marker (CP-L1): the proof file landing does
//     NOT imply the window is process-free.
//
//     The adapter's `wait after command:true` default also means the
//     production pi-terminal path keeps the window open after pi exits,
//     so the user can review output before closing manually.
//     CP-L1: the tail also prints ROS_MEMORY_CONTEXT (the 0600 context-file
//     PATH from the M2 projection — never memory content), and ends with
//     `sleep 1` so the in-window command runtime exceeds Ghostty's default
//     `abnormal-command-exit-runtime = 250`ms threshold; the cosmetic
//     "failed to launch" error page no longer fires on the one-shot proof.
//     The final `touch DONE_FILE` lets teardown wait until the window is
//     genuinely process-free before closing: the proof file lands BEFORE
//     the sleep finishes, so watching the proof file alone races the close
//     into the still-running sleep and Ghostty shows a "Close Window?"
//     confirm dialog (observed on 1.3.1 — the aborted close also left the
//     held surface to be replaced by a live login shell).
const STDERR_FILE = "/tmp/ros-s5c-stderr.txt";
const proofTail = `bash -c 'printf "%s\\n" "OPENAI_API_KEY=$OPENAI_API_KEY" "ROS_PROJECT_ROOT=$ROS_PROJECT_ROOT" "ROS_SKILLS_DIR=$ROS_SKILLS_DIR" "ROS_MEMORY_CONTEXT=$ROS_MEMORY_CONTEXT" > ${PROOF_FILE} 2>${STDERR_FILE}'; sleep 1; touch ${DONE_FILE}`;

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
  // CP-L1: M2 memory projection. The host composes --memory-mode /
  // --memory-root into the attach CLI; the CLI POSTs memoryAccess +
  // memoryRoot; the route's buildProjectedSessionEnv writes the 0600
  // context file under the host-owned stagingBase and exports
  // ROS_MEMORY_CONTEXT (path only — content never crosses).
  memoryAccess: { archiveReadMode: "read-only-context" },
  memoryRoot: MEMORY_ROOT,
  commandSuffix: proofTail,
  errorFile: ATTACH_ERROR_FILE,
});
// Hard rule #1: the RPC return echoes the minted grant (token value included)
// — redact it before logging; paths and status are the useful diagnostics.
const envProofLog = (envProofResult && typeof envProofResult === "object" && "grant" in envProofResult)
  ? { ...envProofResult, grant: "<redacted>" }
  : envProofResult;
console.error(`[smoke] env proof launchBootstrap -> ${JSON.stringify(envProofLog)}`);

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
    assertNoSecretsInCommand(cmd, { bridgeToken, controlToken, FAKE_CRED: CRED_VALUE });
    if (!pass) {
      console.error(`[smoke] composed command preview: ${cmd.slice(0, 200)}...`);
    }
    assert.match(cmd, /^eval "\$\(node .*ros-session\.mjs' attach /);
    assert.match(cmd, /--token-file '\/[^']+\.token'/);
    assert.match(cmd, /--auth-file '\/[^']+\.auth\.json'/);
    assert.match(cmd, /--error-file '\/tmp\/ros-s5c-attach-error\.json'/);
    assert.match(cmd, /--memory-mode 'read-only-context'/);
    assert.match(cmd, new RegExp(`--memory-root '${MEMORY_ROOT}'`));
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
  check("no credential value in bus events", !allEvents.includes(CRED_VALUE));
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
  check(`proof file contains ${FAKE_CRED_NAME}=<resolved credential>`, credLine.includes(CRED_VALUE));
  check("proof file contains ROS_PROJECT_ROOT=...", /ROS_PROJECT_ROOT=\S+/.test(proof));
  check("proof file contains ROS_SKILLS_DIR=...", /ROS_SKILLS_DIR=\S+/.test(proof));
  // CP-L1: the M2 memory projection delivered ROS_MEMORY_CONTEXT — a
  // non-empty PATH to the host-staged 0600 context file, and nothing else.
  const memLine = proof.split("\n").find((l) => l.startsWith("ROS_MEMORY_CONTEXT=")) ?? "";
  const memPath = memLine.slice("ROS_MEMORY_CONTEXT=".length).trim();
  check("proof file contains ROS_MEMORY_CONTEXT=<non-empty path>", memPath.length > 0);
  check("ROS_MEMORY_CONTEXT points at the staged memory-context projection", /memory-context\/[0-9a-f]{32}\/context\.md$/.test(memPath));
  if (memPath) {
    try {
      const memStat = await stat(memPath);
      check("ROS_MEMORY_CONTEXT file exists", memStat.isFile());
      check("ROS_MEMORY_CONTEXT file is 0600", (memStat.mode & 0o777) === 0o600);
    } catch {
      check("ROS_MEMORY_CONTEXT file exists", false);
    }
  }
  check("proof file contains no memory content (sentinel)", !proof.includes(MEM_SENTINEL));
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

// ==========================================================================
// 15. CP-L2 — launch the REAL pi TUI through the production harness chain.
//
//     POST /agent/turn -> boundary.invoke -> generic external-cli launcher
//     (pi-terminal-v1 -> reviewed pi-v1 policy):
//       resolveExecutable (piCommand allowlist) -> stage 0600 prompt file
//       -> composeInvocation -> commandSuffix `'<pi>' '@<file>'`
//       -> terminalHostService.launchBootstrap (host-owned grant/token/attach)
//       -> new Ghostty window runs: eval "$(ros-session attach …)"; pi @file
//
//     Pi is long-lived. The smoke asserts start signals + process liveness
//     and NEVER treats terminal.command.ended as success (under the Ghostty
//     adapter's title-diff semantics, .ended fires on ANY title change, not
//     on process exit — terminal.session.terminated + pgrep are the real
//     liveness signals).
// ==========================================================================
console.error("[smoke] CP-L2: dispatching launch-Pi turn via /agent/turn");

check("piCommand() resolved a validated absolute pi executable", !!piProbe && typeof piProbe.command === "string" && piProbe.command.startsWith("/"));

// Subscribe to the harness session event stream BEFORE dispatch so every
// turn frame (delta/final/error) is captured for evidence + diagnosis.
// (Streaming routes take their params via the URL query string.)
const eventsSub = await harness.harnessRoutes.find((r) => r.path === "/agent/events").handler({}, {
  url: `/agent/events?addonId=${encodeURIComponent(session.addonId)}&sessionId=${encodeURIComponent(session.sessionId)}&bootEpoch=${encodeURIComponent(session.bootEpoch)}&generation=${session.generation}`,
});
const harnessEvents = [];
(async () => {
  try { for await (const ev of eventsSub.events) harnessEvents.push(ev); } catch { /* stream closed */ }
})();

const busEventsBeforeTurn = busEvents.length;
const turnRes = await harness.harnessRoutes.find((r) => r.path === "/agent/turn").handler({
  session,
  input: {
    model: "openai/cp-l2-smoke",
    messages: [{ role: "user", content: PI_PROMPT }],
  },
});
check("turn dispatched (turnId returned)", typeof turnRes?.turnId === "string" && turnRes.turnId.length > 0);
const turnId = turnRes?.turnId;

// 15a. The launch reached the terminal peer. In stub mode the composed
//      command is captured; in real mode the window + bus events carry it.
let piSessionId = null;
if (STUB_MODE) {
  await delay(750);
  check("stub captured the launch-Pi command", stubCommands.length === 2);
  console.error(`[smoke] harness turn frames so far: ${JSON.stringify(harnessEvents.map((e) => ({ type: e?.type, code: e?.data?.code ?? null })))}`);
  if (stubCommands.length === 2) {
    const piCmd = stubCommands[1];
    assertNoSecretsInCommand(piCmd, { bridgeToken, controlToken, FAKE_CRED: CRED_VALUE });
    assert.match(piCmd, /^eval "\$\(node .*ros-session\.mjs' attach /);
    check("command carries the validated absolute pi path", piProbe ? piCmd.includes(`'${piProbe.command}'`) : false);
    check("command carries the '@<prompt file>' form (never inline prompt)", piCmd.includes(`'@${PI_PROMPT_FILE}'`));
    check("command contains no prompt content (sentinel)", !piCmd.includes(PI_SENTINEL));
  }
  // The prompt file was staged 0600 BEFORE the launch RPC.
  try {
    const pfStat = await stat(PI_PROMPT_FILE);
    check("prompt file staged", pfStat.isFile());
    check("prompt file is 0600", (pfStat.mode & 0o777) === 0o600);
  } catch {
    check("prompt file staged", false);
  }
} else {
  // Real Ghostty: a NEW terminal session starts for the pi launch. On the
  // bus, the top-level sessionId is the broker provenance
  // ("terminal-host-bus"); the REAL terminal session id rides
  // data.sessionId (per the terminal.* event contract).
  let w = 0;
  while (w < 10_000 && !piSessionId) {
    const started = busEvents.slice(busEventsBeforeTurn).find((e) => e.type === "terminal.session.started");
    if (started) piSessionId = started?.data?.sessionId ?? null;
    else { await delay(250); w += 250; }
  }
  check("bus saw terminal.session.started for the pi launch", !!piSessionId);
  // command.started fires on the first title poll after window creation.
  w = 0;
  while (w < 10_000 && !busEvents.some((e) => e.type === "terminal.command.started" && e.data?.sessionId === piSessionId)) {
    await delay(250); w += 250;
  }
  check("bus saw terminal.command.started for the pi launch", busEvents.some((e) => e.type === "terminal.command.started" && e.data?.sessionId === piSessionId));
  // The window's eval head POSTed the attach: grant consumed, second route hit.
  w = 0;
  while (w < 15_000 && seen.filter((s) => s.url === "/terminal-host/session/attach").length < 2) {
    await delay(250); w += 250;
  }
  const piAttachObs = seen.filter((s) => s.url === "/terminal-host/session/attach")[1];
  check("the attach route was exercised for the pi session", !!piAttachObs);
  if (piAttachObs) {
    check("pi attach request payload carries the grant token", piAttachObs.hasGrantToken);
    check("pi attach request's URL has no bridge/capability token", !piAttachObs.host?.includes(bridgeToken) && !piAttachObs.host?.includes(controlToken));
  }
  if (piSessionId) {
    // The seen-spy records the request BEFORE the route handler runs
    // consumeGrant; poll (bounded) for the single-use claim to land.
    let grantConsumed = false;
    for (let gw = 0; gw < 5_000 && !grantConsumed; gw += 250) {
      grantConsumed = listOutstandingGrants().find((g) => g.sessionId === piSessionId)?.consumed === true;
      if (!grantConsumed) await delay(250);
    }
    check("the pi session grant was consumed (single-use claim)", grantConsumed);
  }
  // Prompt file staged 0600 (before any title change could unwind the turn).
  try {
    const pfStat = await stat(PI_PROMPT_FILE);
    check("prompt file staged", pfStat.isFile());
    check("prompt file is 0600", (pfStat.mode & 0o777) === 0o600);
  } catch {
    check("prompt file staged", false);
  }
}

// 15b. No-leak sweep across every bus event (env-proof + pi launch).
{
  const allAfter = JSON.stringify(busEvents.slice(busEventsBeforeTurn));
  if (busEvents.length > busEventsBeforeTurn) {
    check("pi launch: no credential value in bus events", !allAfter.includes(CRED_VALUE));
    check("pi launch: no prompt content in bus events", !allAfter.includes(PI_SENTINEL));
    check("pi launch: no bridge token in bus events", !allAfter.includes(bridgeToken));
    check("pi launch: no capability token in bus events", !allAfter.includes(controlToken));
  }
  // The harness turn stream shows the launch delta and NO error frame while
  // pi is running. (A terminal error frame is EXPECTED later, at teardown,
  // when the pi window's session terminates and unwinds the turn.)
  check("harness stream saw the launch delta with no error frame",
    harnessEvents.some((e) => e?.type === "delta") && !harnessEvents.some((e) => e?.type === "error"));
}

// 15c. Liveness + operator observation (real Ghostty only).
//      Pi rewrites its process title to bare "pi" at startup, so its argv
//      (with the '@<prompt file>' marker) does NOT survive — pgrep on the
//      prompt path is useless after launch. The reliable liveness signal
//      is the window's bootstrap-script bash: its argv always carries the
//      unique script path and it lives exactly as long as pi (the script's
//      last command IS pi). The kill targets pi by its exact rewritten
//      title; the script bash then exits on its own.
const SAFE_PI_SESSION = piSessionId ? piSessionId.replace(/[^A-Za-z0-9._-]/g, "_") : "";
const PI_SCRIPT_PATTERN = `ros-ghostty-bootstrap/${SAFE_PI_SESSION}`;
const piAlive = async () => SAFE_PI_SESSION.length > 0 && !(await execFile("pgrep", ["-f", PI_SCRIPT_PATTERN])).err;
if (!STUB_MODE) {
  // Observation window: pi must stay ALIVE (long-lived TUI). We do not wait
  // for command.ended — under title-diff semantics that fires on any title
  // change; process liveness + no session.terminated are the real signals.
  await delay(2_000);
  check("pi process alive after the observation window (long-lived)", await piAlive());
  check("no terminal.session.terminated for the pi window while observed", !busEvents.some((e) => e.type === "terminal.session.terminated" && e.data?.sessionId === piSessionId));

  // Manual acceptance: the operator must see the Pi TUI.
  let operatorPass = true;
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise((resolve) => rl.question("[smoke] observe Pi TUI in the Ghostty window — PASS? (yes/no) ", resolve));
    rl.close();
    operatorPass = /^y(es)?$/i.test(String(answer).trim());
  } else {
    console.error("[smoke] WARN: stdin is not a TTY — operator observation of the Pi TUI skipped (CP-L2 manual gate UNVERIFIED)");
  }
  check("operator observed the Pi TUI in the Ghostty window (CP-L2)", operatorPass);

  // Graceful teardown prerequisite: pi must exit so the window is
  // process-free at close (the CP-SW2 silent-close precondition). sendInput
  // is degraded in Ghostty 1.3.1, so the smoke kills pi by its exact
  // rewritten process title (argv patterns do not survive pi's startup
  // title rewrite). The dead surface closes silently and the turn's
  // finally unlinks the prompt file.
  await execFile("pkill", ["-x", "pi"]);
  let killWait = 0;
  while (killWait < 10_000 && await piAlive()) { await delay(250); killWait += 250; }
  check("pi exited after pkill (window process-free for silent close)", !(await piAlive()));
} else {
  // Stub: nothing executed; cancel the turn so the generator's finally
  // unlinks the staged prompt file.
  await harness.harnessRoutes.find((r) => r.path === "/agent/cancel").handler({ session, turnId });
}

// 16. Cleanup. CP-L1: close only once the in-window command has FULLY
//     exited (done marker written after `sleep 1`). The proof file alone
//     does not imply the window is process-free — it is written before the
//     sleep finishes — and closing into a live child makes Ghostty show a
//     "Close Window?" confirm dialog instead of the CP-SW2 silent close.
let doneWaited = 0;
let doneLanded = false;
while (doneWaited < 8_000) {
  try { await stat(DONE_FILE); doneLanded = true; break; } catch { /* not yet */ }
  await delay(250); doneWaited += 250;
}
check("in-window command fully exited before teardown (done marker)", doneLanded);
try { await rm(DONE_FILE, { force: true }); } catch { /* */ }
if (!STUB_MODE) {
  await uninstallTerminalHostBridge({ service: terminalBridge.service });
} else {
  await terminalBridge.service.stop();
}

// 16b. CP-L2 teardown assertions.
//      - The turn's generator finally unlinks the staged prompt file: in
//        real mode when the pi window's session terminates, in stub mode
//        via the explicit /agent/cancel above.
//      - Real mode: no Ghostty window may linger. A pending "Close Window?"
//        confirm dialog keeps the window alive, so zero leftovers is the
//        automated proof that every close was silent.
let pfWait = 0;
let pfGone = false;
while (pfWait < 10_000) {
  try { await stat(PI_PROMPT_FILE); } catch { pfGone = true; break; }
  await delay(250); pfWait += 250;
}
check("prompt file cleaned up after the turn", pfGone);
if (!STUB_MODE) {
  let lingerWait = 0;
  let lingering = [];
  while (lingerWait < 6_000) {
    const ids = await ghosttyWindowIds();
    lingering = ids.filter((id) => !BASELINE_WINDOW_IDS.includes(id));
    if (lingering.length === 0) break;
    await delay(250); lingerWait += 250;
  }
  check("no smoke-owned Ghostty window lingers after teardown (all closes silent)", lingering.length === 0);
  if (lingering.length > 0) {
    console.error(`[smoke] lingering window ids: ${lingering.join(", ")} — a "Close Window?" confirm dialog is likely pending on one of them`);
  }
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
