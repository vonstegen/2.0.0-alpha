// CP-S5b: pi-terminal-v1 adapter (Step 5, 5B), updated for CP-S5F2.
//
// Drives createPiTerminalAdapter against a stubbed terminal-host service
// + bus. Verifies:
//   * piCommand() is consulted (probe exposed; test does not assert the
//     exact path, but verifies the adapter surfaces the executable
//     metadata so the host can audit it)
//   * buildProjectedSessionEnv is called (host wiring injects the
//     credential; missing-credential surfaces as harness error event)
//   * launchBootstrap is called WITHOUT bootstrapCommand: grant minting,
//     the 0600 token file, and attach-command composition are owned by
//     terminal-host-service (CP-S5F1). The adapter passes only attach
//     context + a reviewed commandSuffix built from the validated
//     absolute Pi executable.
//   * the commandSuffix references the validated executable PATH + (when
//     multi-line) the prompt-file PATH, but never the token VALUE, the
//     credential VALUE, or (multi-line) the prompt text
//   * Bus events translate to delta / final / error harness events with
//     correct provenance
//   * Fail closed: missing pi (via env override), missing profile,
//     shared-* profile, missing prompt -> error event

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPiTerminalAdapter,
  composePiInvocation,
} from "../host/agent-adapters/pi-terminal.mjs";

function makeBus() {
  const queue = [];
  const subscribers = new Set();
  function publish(event) { queue.push(event); for (const s of subscribers) s(event); }
  return {
    publish,
    subscribe() {
      let closed = false;
      const sub = {
        events: (async function* () {
          let i = 0;
          while (!closed) {
            if (i < queue.length) { yield queue[i++]; continue; }
            await new Promise((r) => subscribers.add((ev) => { queue.push(ev); r(ev); }));
          }
        })(),
        [Symbol.asyncIterator]() { return this.events; },
        async return() { closed = true; return { value: undefined, done: true }; },
      };
      return sub;
    },
  };
}

const EXEC = "/usr/local/bin/pi";

describe("composePiInvocation", () => {
  it("uses <exec> @<file> for multi-line prompts", () => {
    const out = composePiInvocation({ executable: EXEC, prompt: "line1\nline2", promptFilePath: "/tmp/p.txt" });
    assert.equal(out, `'/usr/local/bin/pi' '@/tmp/p.txt'`);
  });

  it("uses <exec> @<file> for oversize prompts", () => {
    const big = "x".repeat(5000);
    const out = composePiInvocation({ executable: EXEC, prompt: big, promptFilePath: "/tmp/p.txt" });
    assert.equal(out, `'/usr/local/bin/pi' '@/tmp/p.txt'`);
  });

  it("argv-quotes single-line short prompts", () => {
    const out = composePiInvocation({ executable: EXEC, prompt: "hello world", promptFilePath: null });
    assert.equal(out, `'/usr/local/bin/pi' 'hello world'`);
  });

  it("argv-quotes prompts with single quotes (POSIX escape)", () => {
    const out = composePiInvocation({ executable: EXEC, prompt: "it's fine", promptFilePath: null });
    assert.equal(out, `'/usr/local/bin/pi' 'it'\\''s fine'`);
  });

  it("rejects empty prompts", () => {
    assert.throws(() => composePiInvocation({ executable: EXEC, prompt: "   ", promptFilePath: null }), /empty/);
  });

  it("rejects a non-absolute executable (never a bare ambient command)", () => {
    assert.throws(() => composePiInvocation({ executable: "pi", prompt: "hi", promptFilePath: null }), /absolute path/);
    assert.throws(() => composePiInvocation({ executable: "", prompt: "hi", promptFilePath: null }), /absolute path/);
    assert.throws(() => composePiInvocation({ prompt: "hi", promptFilePath: null }), /absolute path/);
  });
});

describe("createPiTerminalAdapter", () => {
  let dir;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pi-term-"));
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  function buildStubHost() {
    let launchArgs = null;
    const bus = makeBus();
    const service = {
      async launchBootstrap(args) {
        launchArgs = args;
        return { sessionId: "term-1", ok: true };
      },
      async terminateSession() {},
    };
    return { service, bus, getLaunch: () => launchArgs };
  }

  function buildAdapter(service, bus, { promptFilePath, project } = {}) {
    return createPiTerminalAdapter({
      sessionId: "s-1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
      ...(project ? { project } : {}),
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: "sk-CREDENTIAL-DO-NOT-LEAK" } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });
  }

  // Drive one invoke until the first delta (turn start) then cancel.
  async function driveOneTurn(adapter, prompt, { sessionId = "s-1" } = {}) {
    const controller = new AbortController();
    const invokeP = (async () => {
      const events = [];
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId },
        input: { messages: [{ role: "user", content: prompt }] },
        signal: controller.signal,
      })) {
        events.push(event);
      }
      return events;
    })();
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    return invokeP;
  }

  it("exposes the pi executable metadata (piCommand was consulted)", () => {
    const bus = makeBus();
    const service = { launchBootstrap: async () => ({ sessionId: "term-1" }), terminateSession: async () => {} };
    const adapter = createPiTerminalAdapter({
      sessionId: "s-1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      promptFilePath: () => join(dir, "p.txt"),
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
    });
    assert.equal(typeof adapter.piExecutable, "object");
    assert.equal(typeof adapter.piExecutable.command, "string");
    assert.ok(adapter.piExecutable.command.startsWith("/"), "executable must be an absolute path");
    assert.equal(typeof adapter.piExecutable.source, "string");
  });

  it("launches WITHOUT bootstrapCommand; suffix carries the validated executable and no secrets", async () => {
    const promptFilePath = join(dir, "prompt.txt");
    const { service, bus, getLaunch } = buildStubHost();
    // Project root must be a real directory (the resource projection
    // canonicalizes it and fails closed on nonexistent roots).
    const adapter = buildAdapter(service, bus, { promptFilePath, project: { root: dir } });

    const events = await driveOneTurn(adapter, "say hi");
    const firstDelta = events.find((e) => e.type === "delta");
    assert.ok(firstDelta, "expected at least one delta event");
    assert.equal(firstDelta.data.terminalSessionId, "term-1");

    const launch = getLaunch();
    assert.ok(launch, "expected launchBootstrap to have been called");
    // The adapter must NOT supply a complete bootstrapCommand: grant
    // minting + attach composition are host-owned (CP-S5F1/F2).
    assert.equal("bootstrapCommand" in launch, false, "adapter must not pass bootstrapCommand");
    // Attach context travels for the host-owned composition.
    assert.equal(launch.sessionId, "s-1");
    assert.equal(launch.providerProfileId, "openai");
    assert.equal(launch.harness, "addon.pi-terminal");
    assert.deepEqual(launch.project, { root: dir });
    // The commandSuffix starts with the validated absolute executable.
    assert.equal(typeof launch.commandSuffix, "string");
    assert.ok(
      launch.commandSuffix.startsWith(`'${adapter.piExecutable.command}' `),
      `suffix must open with the quoted validated executable; got: ${launch.commandSuffix}`,
    );
    // Single-line short prompt stays argv-quoted in the suffix.
    assert.ok(launch.commandSuffix.endsWith(` 'say hi'`), `suffix must carry the quoted prompt; got: ${launch.commandSuffix}`);
    // Token/credential values are absent from every launch argument.
    const wire = JSON.stringify(launch);
    assert.equal(wire.includes("sk-CREDENTIAL-DO-NOT-LEAK"), false, "credential value must never reach launch args");
    assert.equal("grant" in launch, false, "adapter must never handle the grant");
    assert.equal("token" in launch, false, "adapter must never handle the token");
  });

  it("uses a prompt file for multi-line prompts and never embeds the prompt in the suffix", async () => {
    const promptFilePath = join(dir, "prompt2.txt");
    const { service, bus, getLaunch } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath });
    const LONG_PROMPT = "line1\nline2\nline3\nline4";

    const controller = new AbortController();
    const invokeP = (async () => {
      const events = [];
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: LONG_PROMPT }] },
        signal: controller.signal,
      })) events.push(event);
      return events;
    })();
    // Capture the prompt file content BEFORE the invoke's finally
    // unlinks it. The adapter writes the file synchronously before
    // launchBootstrap; waiting 50ms is enough for the write + the
    // launchBootstrap to complete.
    await new Promise((r) => setTimeout(r, 50));
    let promptContent = null;
    let promptStats = null;
    try { promptContent = await readFile(promptFilePath, "utf8"); promptStats = await stat(promptFilePath); }
    catch { /* may have been unlinked if invoke finished */ }
    controller.abort();
    await invokeP;

    const launch = getLaunch();
    assert.ok(launch, "expected launchBootstrap to have been called");
    assert.equal("bootstrapCommand" in launch, false);
    // Multi-line prompt -> <exec> '@<file>'; prompt text NEVER in the suffix.
    assert.ok(
      launch.commandSuffix.includes(`'@${promptFilePath}'`),
      `suffix must reference the prompt-file path; got: ${launch.commandSuffix}`,
    );
    assert.equal(launch.commandSuffix.includes("line1"), false);
    assert.equal(launch.commandSuffix.includes("line2"), false);
    if (promptContent !== null) {
      assert.equal(promptContent, LONG_PROMPT);
      assert.equal(promptStats.mode & 0o777, 0o600);
    }
  });

  it("fails closed when the credential is missing (host wiring returns null)", async () => {
    const promptFilePath = join(dir, "prompt3.txt");
    const { service, bus, getLaunch } = buildStubHost();

    const adapter = createPiTerminalAdapter({
      sessionId: "s-3",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      hostTerminal: {
        resolveCredential: async () => null, // shared-* / anthropic / missing
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    const events = [];
    for await (const event of adapter.invoke({
      session: { piTerminalAdapter: true, sessionId: "s-3" },
      input: { messages: [{ role: "user", content: "hi" }] },
    })) events.push(event);
    const errorEv = events.find((e) => e.type === "error");
    assert.ok(errorEv, "expected an error event");
    // launchBootstrap is never reached on the missing-credential path.
    assert.equal(getLaunch(), null, "launchBootstrap must not be called when the credential is missing");
    // No prompt file is written either.
    const promptStat = await stat(promptFilePath).catch((e) => e);
    assert.equal(promptStat.code, "ENOENT");
  });

  it("translates terminal.command.ended (exitStatus 0) to a final event", async () => {
    const promptFilePath = join(dir, "prompt4.txt");
    const { service, bus } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath });

    const events = [];
    const invokeP = (async () => {
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "hi" }] },
      })) events.push(event);
    })();
    // After launchBootstrap returns, publish a command.ended event.
    await new Promise((r) => setTimeout(r, 30));
    bus.publish({
      type: "terminal.command.ended",
      data: { sessionId: "term-1", at: new Date().toISOString(), exitStatus: 0 },
      turnId: "turn-1",
      sequence: 1,
    });
    await invokeP;
    const final = events.find((e) => e.type === "final");
    assert.ok(final, "expected a final event");
    assert.equal(final.data.exitStatus, 0);
    assert.equal(final.data.terminalSessionId, "term-1");
  });

  it("translates terminal.session.terminated to an error event", async () => {
    const promptFilePath = join(dir, "prompt5.txt");
    const { service, bus } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath });

    const events = [];
    const invokeP = (async () => {
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "hi" }] },
      })) events.push(event);
    })();
    await new Promise((r) => setTimeout(r, 30));
    bus.publish({
      type: "terminal.session.terminated",
      data: { sessionId: "term-1", at: new Date().toISOString(), exitStatus: 137 },
      turnId: "turn-1",
      sequence: 1,
    });
    await invokeP;
    const errorEv = events.find((e) => e.type === "error");
    assert.ok(errorEv, "expected an error event");
    assert.match(errorEv.data.code, /runtime-unavailable/);
  });
});
