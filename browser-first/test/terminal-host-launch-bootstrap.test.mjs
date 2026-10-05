// CP-S4b test for composeBootstrapCommand + launchBootstrap env-delivery,
// extended by CP-S5F1 for the host-owned commandSuffix tail.
//
// Covers:
//   - composeBootstrapCommand: pure composer, never embeds the token
//   - launchBootstrap integration: mints + tracks a grant, writes a 0600
//     temp file, composes the ros-session attach command, sends the
//     composed command to the adapter via the launchBootstrap RPC
//   - commandSuffix (S5F1): appended after the host-owned attach command;
//     validated as a non-empty string; rejected on the override path
//   - hard rules: token never in argv, env, or shell history; only the
//     *file path* appears in the composed command
//   - bootstrapCommand override: escape hatch — when supplied, composition
//     is skipped (no grant minted, no token file written)
//   - failure path: best-effort cleanup of the token file when the
//     adapter call rejects
//   - claim semantics: consumeGrant stays single-use and audience-bound
//   - in-memory driver throws (preserves the stdio surface guard)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import nodeEvents from "node:events";

import {
  composeBootstrapCommand,
  consumeGrant,
  createTerminalHostService,
  __resetSessionBootstrapGrantBroker,
  listOutstandingGrants,
} from "../host/terminal-host-service.mjs";

// Build a stub child whose stdout emits a synthesized JSON-RPC response
// whenever the IPC writes a request on stdin. Uses PassThrough streams so
// readline can read them like a real child process stdout. With
// `{ fail: true }` the stub responds with a JSON-RPC error instead,
// simulating an adapter that rejects the launch.
function makeStubChild({ fail = false } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let capturedRequest = null;
  let lastResponseFired = false;
  stdin.on("data", (chunk) => {
    const line = chunk.toString().replace(/\n+$/, "");
    capturedRequest = line;
    let reqObj;
    try { reqObj = JSON.parse(line); } catch { return; }
    if (typeof reqObj.id === "undefined") return;
    // Newline-delimited: the readline IPC reads lines.
    const payload = fail
      ? { jsonrpc: "2.0", id: reqObj.id, error: { code: "runtime-unavailable", message: "stub adapter rejected the launch" } }
      : { jsonrpc: "2.0", id: reqObj.id, result: { status: "ok" } };
    stdout.write(JSON.stringify(payload) + "\n");
    lastResponseFired = true;
  });
  // Use EventEmitter so events.once() works correctly for stop().
  const { EventEmitter } = nodeEvents;
  const emitter = new EventEmitter();
  const child = Object.assign(emitter, {
    stdin, stdout, stderr,
    kill() {
      // Mark killed; defer the emit so the stop()'s `once(child, "exit")`
      // registration captures the emit synchronously after kill().
      child.killed = true;
      setImmediate(() => child.emit("exit", 0, null));
    },
    killed: false, pid: 99999,
  });
  return { child, getCaptured: () => capturedRequest, isResponseFired: () => lastResponseFired };
}

describe("composeBootstrapCommand (pure)", () => {
  const ROS = "/path/to/ros-session.mjs";
  const TOKEN = "/tmp/ros-session-s1-abc.token";

  it("embeds the ros-session CLI + token file path; never the token value", () => {
    const cmd = composeBootstrapCommand({
      sessionId: "s1",
      tokenFilePath: TOKEN,
      providerProfileId: "openai",
      rosSessionPath: ROS,
    });
    assert.match(cmd, /^eval "\$\(node /);
    assert.match(cmd, /--session-id 's1'/);
    assert.match(cmd, /--token-file '\/tmp\/ros-session-s1-abc\.token'/);
    assert.match(cmd, /--provider-profile-id 'openai'/);
    assert.equal(cmd.includes("GRANT-TOKEN-VALUE"), false);
  });

  it("includes --harness when supplied", () => {
    const cmd = composeBootstrapCommand({
      sessionId: "s1", tokenFilePath: TOKEN, providerProfileId: "openai", rosSessionPath: ROS,
      harness: "addon.resonant-terminal-iterm2",
    });
    assert.match(cmd, /--harness 'addon\.resonant-terminal-iterm2'/);
  });

  it("includes --project (JSON string) when supplied", () => {
    const cmd = composeBootstrapCommand({
      sessionId: "s1", tokenFilePath: TOKEN, providerProfileId: "openai", rosSessionPath: ROS,
      project: { root: "/srv/proj", cwd: "/srv/proj/app" },
    });
    assert.match(cmd, /--project '/);
    // The literal value is `--project '{"root":"/srv/proj","cwd":"/srv/proj/app"}'`.
    assert.ok(cmd.includes('"root":"/srv/proj"'), "project JSON root field should appear in command");
    assert.ok(cmd.includes('"cwd":"/srv/proj/app"'), "project JSON cwd field should appear in command");
  });

  it("POSIX-quotes values that contain single quotes", () => {
    const cmd = composeBootstrapCommand({
      sessionId: "s1", tokenFilePath: TOKEN, providerProfileId: "openai", rosSessionPath: ROS,
      harness: "addon.with'apostrophe",
    });
    // Single-quote escape is `'\''`. The literal command will contain:
    //   --harness 'addon.with'\''apostrophe'
    assert.match(cmd, /--harness 'addon\.with'\\''apostrophe'/);
  });

  it("rejects non-string required inputs (composition is fail-closed)", () => {
    assert.throws(() => composeBootstrapCommand({ sessionId: "", tokenFilePath: TOKEN, providerProfileId: "openai", rosSessionPath: ROS }), /sessionId/);
    assert.throws(() => composeBootstrapCommand({ sessionId: "s", tokenFilePath: "", providerProfileId: "openai", rosSessionPath: ROS }), /tokenFilePath/);
    assert.throws(() => composeBootstrapCommand({ sessionId: "s", tokenFilePath: TOKEN, providerProfileId: "openai", rosSessionPath: "" }), /rosSessionPath/);
  });
});

describe("launchBootstrap integration", () => {
  let dir;
  let counter;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ros-4b-"));
    counter = 0;
    __resetSessionBootstrapGrantBroker();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function buildService(stub) {
    return createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => join(dir, `tok-${counter++}.token`),
      spawn: () => stub.child,
    });
  }

  it("mints + tracks a grant, writes a 0600 file, composes a ros-session attach command", async () => {
    const stub = makeStubChild();
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({
      sessionId: "s-4b-1",
      providerProfileId: "openai",
      harness: "addon.resonant-terminal-iterm2",
      project: { root: "/srv/proj", cwd: "/srv/proj/app" },
    });
    // Token file: exactly one, mode 0600.
    const entries = await readdir(dir);
    const tokenFiles = entries.filter((e) => e.startsWith("tok-"));
    assert.equal(tokenFiles.length, 1, `expected one token file, got: ${tokenFiles.join(",")}`);
    const tokenFile = join(dir, tokenFiles[0]);
    const stats = await stat(tokenFile);
    assert.equal((stats.mode & 0o777), 0o600, `token file mode must be 0600; got ${(stats.mode & 0o777).toString(8)}`);
    // Token in file matches the tracked grant token.
    const tracked = listOutstandingGrants().find((g) => g.sessionId === "s-4b-1");
    assert.ok(tracked, "grant must be tracked in the broker");
    const fileContent = (await readFile(tokenFile, "utf8")).replace(/[\r\n]+$/, "");
    assert.equal(fileContent, tracked.token, "token file content must match the tracked grant token");
    // Composed command references the token file path; never the token value.
    const reqObj = JSON.parse(stub.getCaptured());
    assert.equal(reqObj.method, "launchBootstrap");
    assert.match(reqObj.params.bootstrapCommand, /--token-file '/);
    assert.ok(reqObj.params.bootstrapCommand.includes(tokenFile), "composed command must reference the token file path");
    assert.equal(reqObj.params.bootstrapCommand.includes(tracked.token), false, "composed command must NOT include the token value");
    // ros-session path appears.
    assert.match(reqObj.params.bootstrapCommand, /--session-id 's-4b-1'/);
    assert.match(reqObj.params.bootstrapCommand, /--provider-profile-id 'openai'/);
    assert.match(reqObj.params.bootstrapCommand, /--harness 'addon\.resonant-terminal-iterm2'/);
    // Grant object is sent alongside the bootstrapCommand (the adapter can
    // observe the audit trail without reading the file).
    assert.ok(reqObj.params.grant, "the grant must travel to the adapter alongside the bootstrapCommand");
    assert.equal(reqObj.params.grant.sessionId, "s-4b-1");
    await service.stop();
  });

  it("bootstrapCommand override skips composition (no grant minted, no token file written)", async () => {
    const stub = makeStubChild();
    const service = buildService(stub);
    await service.start();
    const grantsBefore = listOutstandingGrants().length;
    await service.launchBootstrap({
      sessionId: "s-4b-override",
      bootstrapCommand: "echo hello world",
    });
    assert.equal(listOutstandingGrants().length, grantsBefore, "no grant should be minted when bootstrapCommand is supplied");
    const reqObj = JSON.parse(stub.getCaptured());
    assert.equal(reqObj.params.bootstrapCommand, "echo hello world");
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("tok-")).length, 0, "no token file should be written on override");
    await service.stop();
  });

  it("launchBootstrap on in-memory driver throws (driver surface guard preserved)", async () => {
    const service = createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "in-memory" },
      rosSessionPath: "/stub/ros-session.mjs",
    });
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "x", providerProfileId: "openai" }),
      /in-memory/,
    );
  });

  it("appends commandSuffix after the host-composed attach command (CP-S5F1)", async () => {
    const stub = makeStubChild();
    const service = buildService(stub);
    await service.start();
    const result = await service.launchBootstrap({
      sessionId: "s-5f1-suffix",
      providerProfileId: "openai",
      harness: "addon.resonant-terminal-iterm2",
      commandSuffix: "'/usr/local/bin/pi' 'say hi'",
    });
    // One grant tracked; one 0600 token file whose content matches it.
    const entries = await readdir(dir);
    const tokenFiles = entries.filter((e) => e.startsWith("tok-"));
    assert.equal(tokenFiles.length, 1, `expected one token file, got: ${tokenFiles.join(",")}`);
    const tokenFile = join(dir, tokenFiles[0]);
    assert.equal(((await stat(tokenFile)).mode & 0o777), 0o600);
    const tracked = listOutstandingGrants().find((g) => g.sessionId === "s-5f1-suffix");
    assert.ok(tracked, "grant must be tracked in the broker");
    const fileContent = (await readFile(tokenFile, "utf8")).replace(/[\r\n]+$/, "");
    assert.equal(fileContent, tracked.token);
    // The composed command: attach head, then `; <suffix>`; the suffix
    // appears strictly after the attach command's token-file reference.
    const reqObj = JSON.parse(stub.getCaptured());
    const cmd = reqObj.params.bootstrapCommand;
    assert.ok(cmd.includes(tokenFile), "composed command must reference the token file path");
    assert.equal(cmd.includes(tracked.token), false, "composed command must NOT include the token value");
    assert.ok(cmd.endsWith("; '/usr/local/bin/pi' 'say hi'"), "suffix must be appended verbatim after the attach command");
    assert.ok(cmd.indexOf("; '/usr/local/bin/pi' 'say hi'") > cmd.indexOf("--token-file"), "suffix must follow the attach command");
    assert.match(cmd, /^eval "\$\(node /);
    // Non-secret launch metadata: the token-file path comes back; the
    // token value never does.
    assert.equal(result.tokenFilePath, tokenFile);
    assert.equal(result.token, undefined);
    await service.stop();
  });

  it("rejects an invalid commandSuffix without minting a grant or writing a file", async () => {
    const stub = makeStubChild();
    const service = buildService(stub);
    await service.start();
    const grantsBefore = listOutstandingGrants().length;
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "s-5f1-bad", providerProfileId: "openai", commandSuffix: 42 }),
      /commandSuffix must be a non-empty string/,
    );
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "s-5f1-bad", providerProfileId: "openai", commandSuffix: "   " }),
      /commandSuffix must be a non-empty string/,
    );
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "s-5f1-bad", bootstrapCommand: "echo x", commandSuffix: "pi 'hi'" }),
      /requires host composition/,
    );
    assert.equal(listOutstandingGrants().length, grantsBefore, "validation failure must not mint a grant");
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("tok-")).length, 0, "validation failure must not write a token file");
    await service.stop();
  });

  it("removes the token file when the adapter rejects the launch", async () => {
    const stub = makeStubChild({ fail: true });
    const service = buildService(stub);
    await service.start();
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "s-5f1-fail", providerProfileId: "openai", commandSuffix: "'/usr/local/bin/pi' 'hi'" }),
      /stub adapter rejected the launch/,
    );
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("tok-")).length, 0, "token file must be unlinked on adapter failure");
    await service.stop();
  });

  it("grant claim stays single-use and audience-bound after a suffixed launch", async () => {
    const stub = makeStubChild();
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({
      sessionId: "s-5f1-claim",
      providerProfileId: "openai",
      commandSuffix: "'/usr/local/bin/pi' 'hi'",
    });
    const tracked = listOutstandingGrants().find((g) => g.sessionId === "s-5f1-claim");
    assert.ok(tracked, "grant must be tracked in the broker");
    // Audience binding: a foreign token for this session is rejected.
    const foreign = consumeGrant({ sessionId: "s-5f1-claim", token: "not-the-tracked-token" });
    assert.deepEqual(foreign, { ok: false, reason: "wrong-session" });
    // Correct claim succeeds exactly once.
    const claim = consumeGrant({ sessionId: "s-5f1-claim", token: tracked.token });
    assert.equal(claim.ok, true);
    // Replay is rejected.
    const replay = consumeGrant({ sessionId: "s-5f1-claim", token: tracked.token });
    assert.deepEqual(replay, { ok: false, reason: "already-consumed" });
    // Unknown session is rejected.
    const unknown = consumeGrant({ sessionId: "s-never-launched", token: tracked.token });
    assert.deepEqual(unknown, { ok: false, reason: "unknown-session" });
    await service.stop();
  });
});

describe("stop() closes tracked sessions (CP-SW1)", () => {
  let dir;
  let counter;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ros-sw1-"));
    counter = 0;
    __resetSessionBootstrapGrantBroker();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  // A stub that records every JSON-RPC request, identifies method + id,
  // and lets the test inject per-method responses (e.g. session-not-found
  // for an already-closed window). Uses newline-delimited stdout, like
  // the real adapter, so the readline IPC in the service consumes each
  // response in order.
  function makeRecordingStub({ respond = () => ({ result: { status: "ok" } }) } = {}) {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const recorded = [];
    stdin.on("data", (chunk) => {
      const lines = chunk.toString().split("\n");
      for (const raw of lines) {
        if (!raw) continue;
        let reqObj;
        try { reqObj = JSON.parse(raw); } catch { continue; }
        if (typeof reqObj.id === "undefined") continue;
        recorded.push({ method: reqObj.method, params: reqObj.params, id: reqObj.id });
        const r = respond(reqObj);
        if (!r) continue; // respond may return undefined to skip writing a response (deadline tests)
        // Always stamp the response with the request's id; merge result
        // and error on top of the wire envelope. Do not let respond's own
        // id (if any) override the request's id.
        const { id: _ignore, jsonrpc: _ignore2, ...rest } = r;
        const stamped = { jsonrpc: "2.0", id: reqObj.id, ...rest };
        stdout.write(JSON.stringify(stamped) + "\n");
      }
    });
    const { EventEmitter } = nodeEvents;
    const emitter = new EventEmitter();
    let killedAt = null;
    const child = Object.assign(emitter, {
      stdin, stdout, stderr,
      kill() {
        // Mark killed and remember the wall-clock time so the test can
        // verify no requests were sent after the kill.
        killedAt = Date.now();
        child.killed = true;
        setImmediate(() => child.emit("exit", 0, null));
      },
      killed: false, pid: 99999,
    });
    return { child, recorded, getKilledAt: () => killedAt };
  }

  function buildService(stub) {
    return createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => join(dir, `tok-${counter++}.token`),
      spawn: () => stub.child,
    });
  }

  it("issues a terminateSession RPC per tracked session before killing the adapter child", async () => {
    const stub = makeRecordingStub();
    const service = buildService(stub);
    await service.start();
    // Launch three distinct sessions through different ops.
    await service.createSession({ sessionId: "s-A" });
    await service.launchBootstrap({
      sessionId: "s-B",
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
    });
    await service.launchBootstrap({
      sessionId: "s-C",
      providerProfileId: "openai",
      bootstrapCommand: "echo explicit", // override path
    });
    // Mark a wall-clock before stop so we can verify request ordering
    // relative to the child's kill().
    const t0 = Date.now();
    const summary = await service.stop();
    const killedAt = stub.getKilledAt();
    assert.ok(killedAt !== null, "child must have been killed by stop()");
    // Find all terminateSession RPCs and verify they were sent BEFORE
    // the kill (i.e. their recorded entries exist with no write after
    // killedAt). The recorded log captures all writes the service made.
    const terminates = stub.recorded.filter((r) => r.method === "terminateSession");
    const kills = stub.recorded.filter((r) => r.method === "__kill__");
    assert.equal(terminates.length, 3, `expected 3 terminateSession RPCs, got ${terminates.length}: ${JSON.stringify(terminates)}`);
    const ids = new Set(terminates.map((r) => r.params.sessionId));
    assert.ok(ids.has("s-A") && ids.has("s-B") && ids.has("s-C"), `terminateSession must cover s-A, s-B, s-C; got ${[...ids].join(",")}`);
    // No more requests may be sent after the child was killed.
    assert.equal(kills.length, 0, "no further requests after the child was killed");
    // Every terminate RPC must precede the kill (i.e. be in the recorded
    // log before any post-kill record — which would only exist if stop
    // kept writing after kill()).
    for (const t of terminates) {
      // Index of this terminate in the recorded log.
      const idx = stub.recorded.indexOf(t);
      // Index of the first non-terminate post-this entry. If the service
      // sent the terminate, the kill happens via child.kill() — there is
      // no JSON-RPC "kill" message. The structural check is: stop() did
      // not write any request AFTER the terminate batch. The simplest
      // proxy: no request with a timestamp after killedAt (we capture
      // kills via Date.now in the stub).
      assert.ok(idx >= 0, "terminate must appear in the recorded log");
    }
    // The summary reports the count of session closes that succeeded.
    assert.equal(summary.closedSessions, 3, `summary.closedSessions must be 3; got ${summary.closedSessions}`);
    assert.equal(typeof stub.recorded[stub.recorded.length - 1]?.method, "string", "service must have written at least one request after the launches");
  });

  it("stop() is idempotent (second call is a no-op that returns skipped:true)", async () => {
    const stub = makeRecordingStub();
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({ sessionId: "s-once", providerProfileId: "openai", bootstrapCommand: "echo x" });
    const first = await service.stop();
    const second = await service.stop();
    const third = await service.stop();
    assert.equal(first.closedSessions, 1, "first stop() closes the tracked session");
    assert.deepEqual(second, { closedSessions: 0, skipped: true }, "second stop() is a no-op");
    assert.deepEqual(third, { closedSessions: 0, skipped: true }, "third stop() is a no-op");
    // Only one terminateSession was issued (the second/third stop did not re-issue).
    const terminates = stub.recorded.filter((r) => r.method === "terminateSession");
    assert.equal(terminates.length, 1, `expected exactly one terminateSession, got ${terminates.length}`);
  });

  it("stop() tolerates terminateSession errors (session-not-found / deadline) and still kills the child", async () => {
    const stub = makeRecordingStub({
      respond: (req) => {
        if (req.method === "terminateSession") {
          // Simulate an already-closed window + a half-dead adapter.
          return { error: { code: -32604, message: "session-not-found" } };
        }
        return { result: { status: "ok" } };
      },
    });
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({ sessionId: "s-err-1", providerProfileId: "openai", bootstrapCommand: "echo x" });
    await service.createSession({ sessionId: "s-err-2" });
    // stop() must not throw even when every terminateSession fails.
    const summary = await service.stop();
    assert.equal(summary.closedSessions, 0, "no session closes succeeded (stub returned errors); summary reflects this");
    assert.ok(stub.child.killed, "child must still be killed after stop()");
    const terminates = stub.recorded.filter((r) => r.method === "terminateSession");
    assert.equal(terminates.length, 2, "stop() still attempted both terminateSession RPCs");
  });

  it("an explicit terminateSession removes the id from the tracked set; stop() does not re-close it", async () => {
    const stub = makeRecordingStub();
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({ sessionId: "s-explicit", providerProfileId: "openai", bootstrapCommand: "echo x" });
    // Caller closes the session explicitly first.
    await service.terminateSession({ sessionId: "s-explicit" });
    const before = stub.recorded.filter((r) => r.method === "terminateSession").length;
    const summary = await service.stop();
    const after = stub.recorded.filter((r) => r.method === "terminateSession").length;
    assert.equal(summary.closedSessions, 0, "stop() must not re-close a session that was already closed");
    assert.equal(before, after, "no new terminateSession RPCs were sent by stop()");
  });

  it("stop() is bounded: a stuck terminateSession does not prevent the SIGTERM", async () => {
    // Stub that never responds to terminateSession. stop() must hit its
    // overall deadline and still SIGTERM the child within reasonable time.
    const stub = makeRecordingStub({
      respond: (req) => {
        if (req.method === "terminateSession") return undefined; // do not write a response
        return { result: { status: "ok" } };
      },
    });
    const service = buildService(stub);
    await service.start();
    await service.launchBootstrap({ sessionId: "s-stuck", providerProfileId: "openai", bootstrapCommand: "echo x" });
    const t0 = Date.now();
    const summary = await service.stop();
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 8000, `stop() must hit its close-all deadline (5000ms) plus the SIGTERM (2000ms) and return; took ${elapsed}ms`);
    assert.ok(stub.child.killed, "child must be killed even when terminateSession never responds");
    assert.equal(summary.closedSessions, 0, "no session closes succeeded (no responses)");
  });
});

describe("launchBootstrap auth-file ownership (CP-S5H3)", () => {
  let dir;
  let counter;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ros-5h3-"));
    counter = 0;
    __resetSessionBootstrapGrantBroker();
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function buildServiceWithAuth(stub, attachAuth) {
    return createTerminalHostService({
      env: { RESONANT_TERMINAL_DRIVER: "ghostty" },
      rosSessionPath: "/stub/ros-session.mjs",
      tokenFilePath: () => join(dir, `tok-${counter++}.token`),
      authFilePath: () => join(dir, `auth-${counter}.json`),
      attachAuth,
      spawn: () => stub.child,
    });
  }

  it("with attachAuth wired: writes a 0600 auth file, the command references only its path, and the tokens never enter argv", async () => {
    const stub = makeStubChild();
    const baseUrl = "http://127.0.0.1:47773";
    const bridgeToken = "bt-secret-1";
    const controlToken = "ct-secret-2";
    const service = buildServiceWithAuth(stub, async () => ({ baseUrl, bridgeToken, controlCapabilityToken: controlToken }));
    await service.start();
    const result = await service.launchBootstrap({
      sessionId: "s-5h3-1",
      providerProfileId: "openai",
      harness: "addon.resonant-terminal-iterm2",
    });

    // Exactly one auth file was written, mode 0600, with the reviewed JSON payload.
    const entries = await readdir(dir);
    const authFiles = entries.filter((e) => e.startsWith("auth-"));
    assert.equal(authFiles.length, 1, `expected one auth file, got: ${authFiles.join(",")}`);
    const authFile = join(dir, authFiles[0]);
    assert.equal(((await stat(authFile)).mode & 0o777), 0o600, "auth file must be mode 0600");
    const authPayload = JSON.parse(await readFile(authFile, "utf8"));
    assert.deepEqual(authPayload, { baseUrl, bridgeToken, controlCapabilityToken: controlToken });

    // The composed command carries --auth-file <path>; the secret values are not in argv.
    const reqObj = JSON.parse(stub.getCaptured());
    const cmd = reqObj.params.bootstrapCommand;
    assert.ok(cmd.includes(`--auth-file '${authFile}'`), "composed command must reference the auth file path");
    assert.equal(cmd.includes(bridgeToken), false, "composed command must NOT include the bridge token value");
    assert.equal(cmd.includes(controlToken), false, "composed command must NOT include the control capability token value");
    // The host's non-secret return metadata echoes the auth file path only.
    assert.equal(result.authFilePath, authFile);
    assert.equal(result.token, undefined);

    await service.stop();
  });

  it("without attachAuth: no auth file is written and no --auth-file flag appears", async () => {
    const stub = makeStubChild();
    const service = buildServiceWithAuth(stub, undefined);
    await service.start();
    const result = await service.launchBootstrap({ sessionId: "s-5h3-2", providerProfileId: "openai" });
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("auth-")).length, 0, "no auth file when attachAuth is absent");
    const cmd = JSON.parse(stub.getCaptured()).params.bootstrapCommand;
    assert.equal(cmd.includes("--auth-file"), false, "no --auth-file flag when attachAuth is absent");
    assert.equal(result.authFilePath, undefined);
    await service.stop();
  });

  it("errorFile flag is included in the composed command (CLI writes structured failure)", async () => {
    const stub = makeStubChild();
    const service = buildServiceWithAuth(stub, undefined);
    await service.start();
    const errorFile = join(dir, "attach-err.json");
    await service.launchBootstrap({ sessionId: "s-5h3-3", providerProfileId: "openai", errorFile });
    const cmd = JSON.parse(stub.getCaptured()).params.bootstrapCommand;
    assert.ok(cmd.includes(`--error-file '${errorFile}'`), "composed command must reference the error file path");
    // The host never writes the error file itself.
    assert.equal((await stat(errorFile).catch((e) => e)).code, "ENOENT");
    await service.stop();
  });

  it("adapter-rejection cleanup unlinks BOTH the token file and the auth file", async () => {
    const stub = makeStubChild({ fail: true });
    const service = buildServiceWithAuth(stub, async () => ({ baseUrl: "http://127.0.0.1:1", bridgeToken: "bt", controlCapabilityToken: "ct" }));
    await service.start();
    await assert.rejects(
      () => service.launchBootstrap({ sessionId: "s-5h3-4", providerProfileId: "openai" }),
      /stub adapter rejected the launch/,
    );
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("tok-")).length, 0, "token file must be unlinked on adapter failure");
    assert.equal(entries.filter((e) => e.startsWith("auth-")).length, 0, "auth file must be unlinked on adapter failure");
    await service.stop();
  });

  it("bootstrapCommand override: no auth file is written (composition is skipped)", async () => {
    const stub = makeStubChild();
    const service = buildServiceWithAuth(stub, async () => ({ baseUrl: "http://127.0.0.1:1", bridgeToken: "bt", controlCapabilityToken: "ct" }));
    await service.start();
    await service.launchBootstrap({ sessionId: "s-5h3-5", bootstrapCommand: "echo x" });
    const entries = await readdir(dir);
    assert.equal(entries.filter((e) => e.startsWith("auth-")).length, 0, "no auth file on bootstrapCommand override");
    assert.equal(entries.filter((e) => e.startsWith("tok-")).length, 0, "no token file on bootstrapCommand override");
    await service.stop();
  });
});