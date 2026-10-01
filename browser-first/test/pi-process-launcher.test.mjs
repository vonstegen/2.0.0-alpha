// Bounded native-Pi process launcher (P2). Uses a fake child process; no real
// Pi binary is ever spawned. Proves: fixed argv (--print/--no-session + plan
// args + prompt, never --api-key), private env only (no blanket inheritance),
// shell disabled, bounded/truncated capture, deterministic SIGTERM->SIGKILL
// timeout, and credential stripping from any echoed output.
import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

import { createPiProcessLauncher, redactPiText } from "../host/pi-process-launcher.mjs";

const CREDENTIAL = "pi-native-launch-canary-0123456789abcdef";

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killed = [];
    this.exitCode = null;
    this.signalCode = null;
  }
  kill(signal) {
    this.killed.push(signal);
    return true;
  }
  exit(code, signal) {
    this.exitCode = code ?? null;
    this.signalCode = signal ?? null;
    this.emit("exit", code ?? null, signal ?? null);
  }
}

const PLAN = {
  executable: {
    command: "/usr/local/bin/pi",
    canonicalPath: "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
  },
  argv: ["--provider", "openrouter", "--model", "openai/gpt-5.5"],
  env: { TERM: "xterm-256color", OPENROUTER_API_KEY: CREDENTIAL },
  envVar: "OPENROUTER_API_KEY",
  projectPath: "/home/u/project",
};

const PROMPT = "Respond with exactly: ROS_PI_NATIVE_CREDENTIAL_PROOF_OK";

function launcher(overrides = {}) {
  return createPiProcessLauncher({
    timeoutMs: 50,
    killGraceMs: 20,
    now: () => 0,
    ...overrides,
  });
}

test("argv is exactly --print/--no-session + plan args + prompt and never --api-key", async () => {
  let spawned;
  const run = launcher({
    spawnImpl: (command, args, opts) => {
      const child = new FakeChild();
      spawned = { command, args, opts };
      process.nextTick(() => child.exit(0, null));
      return child;
    },
  });
  const result = await run.launch(PLAN, { prompt: PROMPT });
  assert.equal(result.exitCode, 0);
  assert.equal(spawned.command, PLAN.executable.command);
  assert.deepEqual(spawned.args, [
    "--print",
    "--no-session",
    "--provider",
    "openrouter",
    "--model",
    "openai/gpt-5.5",
    PROMPT,
  ]);
  assert.ok(!spawned.args.includes("--api-key"));
  assert.ok(!spawned.args.includes(CREDENTIAL));
  assert.equal(spawned.opts.cwd, PLAN.projectPath);
  assert.deepEqual(spawned.opts.env, PLAN.env);
  assert.equal(spawned.opts.shell, false);
  assert.deepEqual(spawned.opts.stdio, ["ignore", "pipe", "pipe"]);
});

test("credential is stripped from captured output even when the process echoes it", async () => {
  const run = launcher({
    spawnImpl: (command, args, opts) => {
      const child = new FakeChild();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from(`ok ${CREDENTIAL} done\n`));
        child.stderr.emit("data", Buffer.from(`err ${CREDENTIAL}\n`));
        child.exit(0, null);
      });
      return child;
    },
  });
  const result = await run.launch(PLAN, { prompt: PROMPT });
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("ok"));
  assert.ok(!result.stdout.includes(CREDENTIAL));
  assert.ok(result.stdout.includes("[redacted]"));
  assert.ok(!result.stderr.includes(CREDENTIAL));
});

test("rejects a plan whose argv contains --api-key", async () => {
  const run = launcher();
  await assert.rejects(
    run.launch(
      { ...PLAN, argv: ["--provider", "openrouter", "--api-key", "x"] },
      { prompt: PROMPT },
    ),
    { code: "invalid-plan" },
  );
});

test("rejects arbitrary material: non-array argv, non-string env, empty command/path/prompt", async () => {
  const run = launcher();
  await assert.rejects(run.launch({ ...PLAN, argv: "not-an-array" }, { prompt: PROMPT }), {
    code: "invalid-plan",
  });
  await assert.rejects(run.launch({ ...PLAN, env: { BAD: 123 } }, { prompt: PROMPT }), {
    code: "invalid-plan",
  });
  await assert.rejects(run.launch({ ...PLAN, executable: { command: "" } }, { prompt: PROMPT }), {
    code: "invalid-plan",
  });
  await assert.rejects(run.launch({ ...PLAN, projectPath: "" }, { prompt: PROMPT }), {
    code: "invalid-plan",
  });
  await assert.rejects(run.launch(PLAN, { prompt: "" }), { code: "invalid-plan" });
});

test("bounded capture truncates oversized stdout and stderr", async () => {
  const run = launcher({
    maxStdoutBytes: 8,
    maxStderrBytes: 4,
    spawnImpl: (command, args, opts) => {
      const child = new FakeChild();
      process.nextTick(() => {
        child.stdout.emit("data", Buffer.from("0123456789abcdef"));
        child.stderr.emit("data", Buffer.from("stderr-long"));
        child.exit(0, null);
      });
      return child;
    },
  });
  const result = await run.launch(PLAN, { prompt: PROMPT });
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 8);
  assert.ok(Buffer.byteLength(result.stderr) <= 4);
});

test("timeout sends SIGTERM then SIGKILL and reports timedOut", async () => {
  let child;
  const run = launcher({
    timeoutMs: 20,
    killGraceMs: 20,
    spawnImpl: (command, args, opts) => {
      child = new FakeChild();
      child.kill = (signal) => {
        child.killed.push(signal);
        if (signal === "SIGKILL") child.exit(null, "SIGKILL");
        return true;
      };
      return child;
    },
  });
  const result = await run.launch(PLAN, { prompt: PROMPT });
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
  assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
});

test("abort signal sends the same deterministic SIGTERM->SIGKILL path and reports aborted", async () => {
  let child;
  const run = launcher({
    spawnImpl: () => {
      child = new FakeChild();
      child.kill = (signal) => {
        child.killed.push(signal);
        if (signal === "SIGKILL") child.exit(null, "SIGKILL");
        return true;
      };
      return child;
    },
  });
  const controller = new AbortController();
  const pending = run.launch(PLAN, { prompt: PROMPT, signal: controller.signal });
  controller.abort();
  const evidence = await pending;
  assert.deepEqual(child.killed, ["SIGTERM", "SIGKILL"]);
  assert.equal(evidence.aborted, true);
  assert.equal(evidence.timedOut, false);
  assert.ok(!JSON.stringify(evidence).includes(CREDENTIAL));
});

test("a pre-aborted signal kills the child immediately without spawning work", async () => {
  let spawned = 0;
  const run = launcher({
    spawnImpl: () => {
      spawned++;
      const child = new FakeChild();
      child.kill = (signal) => {
        child.killed.push(signal);
        if (signal === "SIGKILL") child.exit(null, "SIGKILL");
        return true;
      };
      return child;
    },
  });
  const controller = new AbortController();
  controller.abort();
  const evidence = await run.launch(PLAN, { prompt: PROMPT, signal: controller.signal });
  assert.equal(spawned, 1, "the child still spawns but is killed immediately");
  assert.equal(evidence.aborted, true);
});

test("spawn error resolves with spawnError instead of throwing", async () => {
  const run = launcher({
    spawnImpl: () => {
      throw new Error("ENOENT");
    },
  });
  const result = await run.launch(PLAN, { prompt: PROMPT });
  assert.equal(result.spawnError, "ENOENT");
  assert.equal(result.exitCode, null);
});

test("redactPiText strips forbidden values longest-first", () => {
  assert.equal(redactPiText(`a ${CREDENTIAL} b`, [CREDENTIAL, "short"]), "a [redacted] b");
  assert.equal(redactPiText("nothing here", []), "nothing here");
  assert.equal(redactPiText(null), "");
});

class FakeTerm {
  constructor({ command, args, options }) {
    this.spawn = { command, args, options };
    this.dataHandler = null;
    this.exitHandler = null;
    this.killed = [];
    this.resized = [];
    this.writes = [];
    this.pid = 4242;
  }
  onData(handler) { this.dataHandler = handler; }
  onExit(handler) { this.exitHandler = handler; }
  write(text) { this.writes.push(text); }
  resize(cols, rows) { this.resized.push([cols, rows]); }
  kill(signal) { this.killed.push(signal); }
  emitData(text) { this.dataHandler?.(text); }
  emitExit(code, signal) { this.exitHandler?.({ exitCode: code, signal }); }
}

function tuiLauncher({ ptyImpl, ...overrides } = {}) {
  return launcher({ killGraceMs: 20, ptyImpl, ...overrides });
}

test("launchInteractive spawns plan.argv (no --print/--no-session) with initialPrompt appended and TERM set", () => {
  let term;
  const run = tuiLauncher({
    ptyImpl: { spawn: (command, args, options) => (term = new FakeTerm({ command, args, options })) },
  });
  const handle = run.launchInteractive(PLAN, { cols: 100, rows: 30, initialPrompt: "hello", onData: () => {} });
  assert.equal(term.spawn.command, "/usr/local/bin/pi");
  assert.deepEqual(term.spawn.args, [...PLAN.argv, "hello"]);
  assert.ok(!term.spawn.args.includes("--print") && !term.spawn.args.includes("--no-session"));
  assert.ok(!term.spawn.args.includes("--api-key"));
  assert.equal(term.spawn.options.cols, 100);
  assert.equal(term.spawn.options.rows, 30);
  assert.equal(term.spawn.options.cwd, PLAN.projectPath);
  assert.equal(term.spawn.options.env.TERM, "xterm-256color");
  assert.equal(term.spawn.options.env.OPENROUTER_API_KEY, CREDENTIAL);
  assert.equal(handle.pid, 4242);
});

test("launchInteractive forwards data (redacted), input, resize, and exit", () => {
  let term;
  const run = tuiLauncher({
    ptyImpl: { spawn: (command, args, options) => (term = new FakeTerm({ command, args, options })) },
  });
  const seen = [];
  let exitEvidence = null;
  const handle = run.launchInteractive(PLAN, {
    initialPrompt: "",
    onData: (chunk) => seen.push(chunk),
    onExit: (evidence) => { exitEvidence = evidence; },
  });
  term.emitData(`prompt > echo ${CREDENTIAL}\r\n`);
  term.emitData("ok");
  assert.ok(seen.every((chunk) => !chunk.includes(CREDENTIAL)));
  assert.ok(seen.join("").includes("[redacted]"));
  handle.write("ls\r");
  assert.deepEqual(term.writes, ["ls\r"]);
  handle.resize(120, 40);
  assert.deepEqual(term.resized, [[120, 40]]);
  term.emitExit(0, null);
  assert.equal(exitEvidence?.exitCode, 0);
  assert.equal(exitEvidence?.aborted, false);
});

test("launchInteractive cancel takes SIGTERM then SIGKILL and reports aborted", async () => {
  let term;
  const run = tuiLauncher({
    ptyImpl: { spawn: (command, args, options) => (term = new FakeTerm({ command, args, options })) },
  });
  let exitEvidence = null;
  const handle = run.launchInteractive(PLAN, { onExit: (evidence) => { exitEvidence = evidence; } });
  handle.cancel();
  assert.deepEqual(term.killed, ["SIGTERM"]);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(term.killed, ["SIGTERM", "SIGKILL"]);
  term.emitExit(null, "SIGKILL");
  assert.equal(exitEvidence?.aborted, true);
  assert.ok(!handle.write("x"));
});

test("launchInteractive rejects --api-key argv and invalid geometry", () => {
  const run = tuiLauncher({ ptyImpl: { spawn: () => ({ onData() {}, onExit() {}, kill() {}, write() {}, resize() {} }) } });
  assert.throws(
    () => run.launchInteractive({ ...PLAN, argv: ["--api-key", "x"] }, {}),
    (error) => error?.code === "invalid-plan",
  );
  assert.throws(
    () => run.launchInteractive(PLAN, { cols: 1, rows: 30 }),
    (error) => error?.code === "invalid-plan",
  );
});
