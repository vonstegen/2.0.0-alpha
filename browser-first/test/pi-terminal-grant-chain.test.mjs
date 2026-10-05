// CP-XH2 / CP-S5F3: real-chain integration test for the pi-v1
// grant flow, now driven by the generic external-CLI launcher.
//
// Combines the REAL createExternalCliTerminalAdapter (with the
// reviewed pi-v1 policy) with the REAL createTerminalHostService
// and stubs ONLY the external terminal JSON-RPC peer (the stdio
// child). Nothing in the grant path is stubbed:
//
//   createExternalCliTerminalAdapter({ policyId: "pi-v1" }).invoke()
//     -> buildProjectedSessionEnv (real)
//     -> policy.resolveExecutable -> piCommand() (real allowlist)
//     -> launchBootstrap WITHOUT bootstrapCommand (real service)
//        -> mint + track SessionBootstrapGrant (real broker)
//        -> write 0600 token file (real fs)
//        -> compose ros-session attach + `; <pi-v1 suffix>`
//        -> launchBootstrap RPC to the (stubbed) terminal peer
//     -> consumeGrant (real broker) succeeds once; replay rejected
//
// This proves the same gap the CP-S5b unit suite missed on
// c1e705c8, now through the generic launcher.

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import nodeEvents from "node:events";

import { createExternalCliTerminalAdapter } from "../host/agent-adapters/external-cli-terminal.mjs";
import {
  consumeGrant,
  createTerminalHostService,
  __resetSessionBootstrapGrantBroker,
  listOutstandingGrants,
} from "../host/terminal-host-service.mjs";

// Stub for the external terminal JSON-RPC peer only: captures requests
// written to stdin and answers each with a synthesized success response.
function makeStubTerminalPeer() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let capturedRequest = null;
  stdin.on("data", (chunk) => {
    const line = chunk.toString().replace(/\n+$/, "");
    capturedRequest = line;
    let reqObj;
    try { reqObj = JSON.parse(line); } catch { return; }
    if (typeof reqObj.id === "undefined") return;
    stdout.write(JSON.stringify({ jsonrpc: "2.0", id: reqObj.id, result: { sessionId: "term-f3", ok: true } }) + "\n");
  });
  const { EventEmitter } = nodeEvents;
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin, stdout, stderr,
    kill() { child.killed = true; setImmediate(() => child.emit("exit", 0, null)); },
    killed: false, pid: 99998,
  });
  return { child, getCaptured: () => capturedRequest };
}

// A fake fixed-root Pi install: <home>/npm-global/bin/pi (regular
// executable file) whose realpath stays inside the reviewed install
// root. Resolved via the adapter's piHomeDir seam -> piCommand(), the
// same allowlist the production path uses.
async function makeFixedRootPi(homeDir) {
  const bin = join(homeDir, "npm-global", "bin");
  await mkdir(join(homeDir, "npm-global", "lib", "node_modules"), { recursive: true });
  await mkdir(bin, { recursive: true });
  const executable = join(bin, "pi");
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return executable;
}

describe("pi-terminal-v1 -> terminal-host-service real grant chain (CP-S5F3)", () => {
  let dir;
  let service;
  beforeEach(async () => {
    __resetSessionBootstrapGrantBroker();
    // Canonicalize: macOS tmpdir is /var/... (a symlink to /private/var/...),
    // and piCommand()'s fixed-root check compares the candidate's realpath
    // against the (unresolved) root — an unresolved base would fail closed.
    dir = await realpath(await mkdtemp(join(tmpdir(), "pi-grant-chain-")));
  });
  afterEach(async () => {
    try { await service?.stop(); } catch { /* already stopped */ }
    service = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("mints, tracks, delivers, and consumes exactly one grant through the real chain", async () => {
    const FAKE_CRED = "sk-F3-CREDENTIAL-DO-NOT-LEAK";
    const tokenFilePath = join(dir, "grant.token");
    const promptFilePath = join(dir, "prompt.txt");
    const fakeHome = join(dir, "home");
    const piExecutable = await makeFixedRootPi(fakeHome);
    const peer = makeStubTerminalPeer();

    service = createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      spawn: () => peer.child,
    });
    const start = await service.start();

    const adapter = createExternalCliTerminalAdapter({
      sessionId: "s-f3-1",
      policyId: "pi-v1",
      terminalHostService: service,
      terminalHostStart: start,
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      harness: "addon.resonant-terminal-iterm2",
      homeDirOverride: fakeHome,
      // Legacy pre-S5F2 options: ignored by the current adapter (grant
      // composition is host-owned), but supplying them lets this same test
      // run against the c1e705c8 adapter and fail on the untracked grant /
      // missing token file — the regression this file exists to catch.
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => join(dir, "stale-adapter-owned.token"),
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: FAKE_CRED } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    // Drive one turn; the first delta confirms launchBootstrap returned.
    const controller = new AbortController();
    const invokeP = (async () => {
      const events = [];
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-f3-1" },
        input: { messages: [{ role: "user", content: "say hi" }] },
        signal: controller.signal,
      })) events.push(event);
      return events;
    })();

    // Wait (bounded) for the launch RPC to reach the terminal peer.
    let captured = null;
    for (let i = 0; i < 200 && !captured; i += 1) {
      captured = peer.getCaptured();
      if (!captured) await new Promise((r) => setTimeout(r, 10));
    }
    controller.abort();
    await invokeP;
    assert.ok(captured, "the terminal peer must receive the launchBootstrap RPC");

    // 1. The RPC carries a host-composed command + grant; the adapter
    //    never supplied a bootstrapCommand of its own.
    const reqObj = JSON.parse(captured);
    assert.equal(reqObj.method, "launchBootstrap");
    const cmd = reqObj.params.bootstrapCommand;
    assert.equal(typeof cmd, "string");
    assert.match(cmd, /^eval "\$\(node /);
    assert.ok(reqObj.params.grant, "the tracked grant must travel with the launch RPC");
    assert.equal(reqObj.params.grant.sessionId, "s-f3-1");
    // The Pi tail: validated absolute executable + quoted short prompt,
    // appended after the attach command.
    assert.ok(cmd.includes("; '"), "suffix must follow the attach command");
    assert.ok(cmd.endsWith(` '${piExecutable}' 'say hi'`), "suffix must be the validated pi invocation");

    // 2. Parse the --token-file path out of the command (never printed).
    const tokenMatch = cmd.match(/--token-file '([^']+)'/);
    assert.ok(tokenMatch, "command must reference a token file");
    assert.equal(tokenMatch[1], tokenFilePath, "host must use the configured token-file path");

    // 3. The referenced file exists, is 0600, and the grant is tracked.
    const fileStat = await stat(tokenFilePath);
    assert.equal((fileStat.mode & 0o777), 0o600, `token file mode must be 0600; got ${(fileStat.mode & 0o777).toString(8)}`);
    const tracked = listOutstandingGrants().find((g) => g.sessionId === "s-f3-1");
    assert.ok(tracked, "grant must be outstanding/tracked in the real broker");
    const fileToken = (await readFile(tokenFilePath, "utf8")).replace(/[\r\n]+$/, "");
    assert.equal(fileToken, tracked.token, "token file content must equal the tracked grant token (test only)");

    // 4. The composed command carries neither the token value nor the
    //    credential value.
    assert.equal(cmd.includes(tracked.token), false, "token value must never appear in the command");
    assert.equal(cmd.includes(FAKE_CRED), false, "credential value must never appear in the command");

    // 5. Real consumption path: first claim succeeds, replay is rejected.
    let claim;
    let replay;
    try {
      claim = consumeGrant({ sessionId: "s-f3-1", token: fileToken });
      assert.equal(claim.ok, true, "first claim must succeed");
      replay = consumeGrant({ sessionId: "s-f3-1", token: fileToken });
      assert.deepEqual(replay, { ok: false, reason: "already-consumed" }, "replay must be rejected");
    } finally {
      // 6. Cleanup: token/prompt files (the CLI would normally unlink the
      //    token file after a successful read).
      try { await rm(tokenFilePath, { force: true }); } catch { /* already gone */ }
      try { await rm(promptFilePath, { force: true }); } catch { /* already gone */ }
    }
    assert.equal((await stat(tokenFilePath).catch((e) => e)).code, "ENOENT", "token file must be cleaned up");
  });
});

// ---------------------------------------------------------------------------
// CP-M3: real-chain test for memory projection + cleanup.
//
// Drives the full real chain (buildProjectedSessionEnv -> launchBootstrap ->
// tracked session -> service.stop) and asserts:
//   * ROS_MEMORY_CONTEXT is set during the session and points at an existing
//     0600 file.
//   * After service.stop(), the file is removed (no leak).
//   * When memory is NOT declared, ROS_MEMORY_CONTEXT is never set, no
//     context file is written, and cleanup is a no-op.
// ---------------------------------------------------------------------------

import { buildProjectedSessionEnv } from "../host/terminal-host-service.mjs";

describe("CP-M3: memory projection through the real chain + service cleanup", () => {
  let dir;
  let service;
  beforeEach(async () => {
    __resetSessionBootstrapGrantBroker();
    dir = await realpath(await mkdtemp(join(tmpdir(), "pi-m3-")));
  });
  afterEach(async () => {
    try { await service?.stop(); } catch { /* already stopped */ }
    service = null;
    await rm(dir, { recursive: true, force: true });
  });

  it("during the session ROS_MEMORY_CONTEXT points at an existing 0600 file; after stop() the file is gone", async () => {
    const tokenFilePath = join(dir, "grant.token");
    const promptFilePath = join(dir, "prompt.txt");
    const fakeHome = join(dir, "home");
    const memoryRoot = join(dir, "memory");
    await mkdir(memoryRoot, { recursive: true });
    const stagingBase = join(dir, "staging");
    await mkdir(stagingBase);
    const piExecutable = await makeFixedRootPi(fakeHome);
    const peer = makeStubTerminalPeer();

    service = createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      stagingBase,
      spawn: () => peer.child,
    });
    await service.start();

    // Drive the full real chain: buildProjectedSessionEnv with memory,
    // then launchBootstrap through the service.
    const grant = service.mintSessionBootstrapGrant
      ? null
      : (await import("../host/terminal-host-service.mjs")).mintSessionBootstrapGrant;
    const minted = grant({ sessionId: "s-m3-1", purpose: "attach" });
    service.trackSessionTrackedGrant
      ? null
      : null;
    const { trackSessionBootstrapGrant } = await import("../host/terminal-host-service.mjs");
    trackSessionBootstrapGrant(minted);

    const projected = await buildProjectedSessionEnv({
      sessionId: "s-m3-1",
      memoryAccess: { archiveReadMode: "read-only-context" },
      memoryRoot,
      stagingBase,
      providerProfileId: "openai",
      resolveCredential: () => ({ name: "OPENAI_API_KEY", value: "sk-m3-1" }),
    });
    assert.equal(projected.ok, true, "buildProjectedSessionEnv must succeed");
    // ROS_MEMORY_CONTEXT is set and points at an existing 0600 file.
    const memPath = projected.env.ROS_MEMORY_CONTEXT;
    assert.equal(typeof memPath, "string");
    assert.ok(memPath.startsWith(await realpath(stagingBase)));
    const st = await stat(memPath);
    assert.ok(st.isFile());
    assert.equal((st.mode & 0o777), 0o600);

    // Now drive launchBootstrap through the real service (with the
    // real pi-v1 policy via the generic adapter — see CP-S5F3 test above).
    const { createHarnessEventBus } = await import("../host/harness-event-bus.mjs");
    const bus = createHarnessEventBus({
      provenance: { addonId: "addon.test", sessionId: "test-bus", turnId: "test", bootEpoch: "boot-test", generation: 0 },
      isCurrent: () => true,
      maxReaders: 8,
    });
    const adapter = createExternalCliTerminalAdapter({
      sessionId: "s-m3-1",
      policyId: "pi-v1",
      terminalHostService: {
        launchBootstrap: (...args) => service.launchBootstrap(...args),
        terminateSession: (...args) => service.terminateSession(...args),
      },
      terminalHostStart: {
        driveId: "ghostty",
        adapterId: "ghostty",
        bus,
      },
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      hostTerminal: {
        resolveCredential: async () => ({ name: "OPENAI_API_KEY", value: "sk-m3-1" }),
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase,
      },
      // piCommand() needs an env override to find our fake `pi` binary.
      env: { ...process.env, PATH: join(fakeHome, "npm-global", "bin"), HOME: fakeHome },
    });
    const controller = new AbortController();
    const invokeTask = (async () => {
      const events = [];
      for await (const ev of adapter.invoke({
        session: { sessionId: "s-m3-1" },
        input: { messages: [{ role: "user", content: "use memory" }] },
        signal: controller.signal,
      })) events.push(ev);
      return events;
    })();
    // Wait until launchBootstrap has been driven (peer has captured request).
    for (let i = 0; i < 200 && !peer.getCaptured(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(peer.getCaptured(), "adapter reached launchBootstrap through the real service");
    // The file STILL exists while the session is tracked.
    assert.equal((await stat(memPath).catch((e) => e)).code, undefined);
    controller.abort();
    await invokeTask;

    // Tear down: stop() must clean up the context file.
    await service.stop();
    const postStop = await stat(memPath).catch((e) => e);
    assert.equal(postStop.code, "ENOENT", "memory context file must be removed after stop()");
    void piExecutable; // referenced for makeFixedRootPi side effect
  });

  it("without memory declared, no context file is ever written and cleanup is a no-op", async () => {
    const tokenFilePath = join(dir, "grant.token");
    const promptFilePath = join(dir, "prompt.txt");
    const fakeHome = join(dir, "home");
    const memoryRoot = join(dir, "memory");
    await mkdir(memoryRoot, { recursive: true });
    const stagingBase = join(dir, "staging");
    await mkdir(stagingBase);
    await makeFixedRootPi(fakeHome);
    const peer = makeStubTerminalPeer();

    service = createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      stagingBase,
      spawn: () => peer.child,
    });
    await service.start();

    const projected = await buildProjectedSessionEnv({
      sessionId: "s-m3-2",
      memoryAccess: { archiveReadMode: "none" },
      stagingBase,
      providerProfileId: "openai",
      resolveCredential: () => ({ name: "OPENAI_API_KEY", value: "sk-m3-2" }),
    });
    assert.equal(projected.ok, true);
    assert.equal(projected.env.ROS_MEMORY_CONTEXT, undefined);
    // No memory-context/<id> dir under staging base.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(stagingBase);
    assert.ok(!entries.includes("memory-context"), "no memory-context dir under staging base");
    // stop() must not throw, and no file should appear after.
    await service.stop();
    const afterEntries = await readdir(stagingBase);
    assert.ok(!afterEntries.includes("memory-context"));
  });
});
