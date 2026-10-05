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