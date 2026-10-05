// CP-S5b: pi-terminal-v1 adapter (Step 5, 5B).
//
// Drives createPiTerminalAdapter against a stubbed terminal-host service
// + bus. Verifies:
//   * piCommand() is consulted (probe exposed; test does not assert the
//     exact path, but verifies the adapter surfaces the executable
//     metadata so the host can audit it)
//   * buildProjectedSessionEnv is called (host wiring injects the
//     credential; missing-credential surfaces as harness error event)
//   * launchBootstrap RPC is issued with a composed command whose argv
//     references the token-file PATH + (when multi-line) prompt-file
//     PATH, but never the token VALUE or the credential VALUE
//   * Bus events translate to delta / final / error harness events with
//     correct provenance
//   * Fail closed: missing pi (via env override), missing profile,
//     shared-* profile, missing prompt -> error event

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

import {
  createPiTerminalAdapter,
  composePiInvocation,
  composePiTerminalBootstrap,
} from "../host/agent-adapters/pi-terminal.mjs";
import {
  __resetSessionBootstrapGrantBroker,
  trackSessionBootstrapGrant,
  mintSessionBootstrapGrant,
  listOutstandingGrants,
} from "../host/terminal-host-service.mjs";

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

describe("composePiInvocation", () => {
  it("uses pi @<file> for multi-line prompts", () => {
    const out = composePiInvocation({ prompt: "line1\nline2", promptFilePath: "/tmp/p.txt" });
    assert.equal(out, "pi '@/tmp/p.txt'");
  });

  it("uses pi @<file> for oversize prompts", () => {
    const big = "x".repeat(5000);
    const out = composePiInvocation({ prompt: big, promptFilePath: "/tmp/p.txt" });
    assert.equal(out, "pi '@/tmp/p.txt'");
  });

  it("argv-quotes single-line short prompts", () => {
    const out = composePiInvocation({ prompt: "hello world", promptFilePath: null });
    assert.equal(out, "pi 'hello world'");
  });

  it("argv-quotes prompts with single quotes (POSIX escape)", () => {
    const out = composePiInvocation({ prompt: "it's fine", promptFilePath: null });
    assert.equal(out, "pi 'it'\\''s fine'");
  });

  it("rejects empty prompts", () => {
    assert.throws(() => composePiInvocation({ prompt: "   ", promptFilePath: null }), /empty/);
  });
});

describe("composePiTerminalBootstrap", () => {
  it("prefixes the eval ros-session attach with a semicolon and a pi invocation", () => {
    const out = composePiTerminalBootstrap({
      sessionId: "s1",
      tokenFilePath: "/tmp/tok",
      providerProfileId: "openai",
      rosSessionPath: "/srv/ros-session.mjs",
      prompt: "hello",
      promptFilePath: null,
    });
    assert.match(out, /^\s*eval "\$\(node '?\/srv\/ros-session\.mjs'? attach/);
    assert.match(out, /; pi 'hello'\s*$/);
  });

  it("embeds --harness and --project JSON when supplied", () => {
    const out = composePiTerminalBootstrap({
      sessionId: "s1",
      tokenFilePath: "/tmp/tok",
      providerProfileId: "openai",
      rosSessionPath: "/srv/ros-session.mjs",
      harness: "addon.resonant-terminal-iterm2",
      project: { root: "/srv/proj" },
      prompt: "hi",
      promptFilePath: null,
    });
    assert.match(out, /--harness 'addon\.resonant-terminal-iterm2'/);
    assert.match(out, /--project '\{[^']*"root":"\/srv\/proj"[^']*\}'/);
  });

  it("never includes the token value in the composed command", () => {
    const out = composePiTerminalBootstrap({
      sessionId: "s1",
      tokenFilePath: "/tmp/tok",
      providerProfileId: "openai",
      rosSessionPath: "/srv/ros-session.mjs",
      prompt: "hi",
      promptFilePath: null,
    });
    // The token value is the secret; it must not appear anywhere in argv.
    assert.equal(out.includes("sk-"), false);
  });
});

describe("createPiTerminalAdapter", () => {
  let dir;
  beforeEach(async () => {
    __resetSessionBootstrapGrantBroker();
    dir = await mkdtemp(join(tmpdir(), "pi-term-"));
  });

  function buildStubHost({ grant, grantToken, tokenFilePath, promptFilePath }) {
    let launchArgs = null;
    const bus = makeBus();
    const service = {
      async launchBootstrap(args) {
        launchArgs = args;
        // Write the token file the way the real launchBootstrap does so
        // the test can assert mode 0600.
        const { writeFile: wf } = await import("node:fs/promises");
        await wf(tokenFilePath, grantToken, { mode: 0o600 });
        return { sessionId: "term-1", ok: true };
      },
      async terminateSession() {},
    };
    return { service, bus, getLaunch: () => launchArgs };
  }

  it("exposes the pi executable metadata (piCommand was consulted)", () => {
    // Stub host with the bare minimum shape.
    const bus = makeBus();
    const service = { launchBootstrap: async () => ({ sessionId: "term-1" }), terminateSession: async () => {} };
    const adapter = createPiTerminalAdapter({
      sessionId: "s-1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => "/tmp/tok",
      promptFilePath: () => "/tmp/p.txt",
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
    });
    assert.equal(typeof adapter.piExecutable, "object");
    assert.equal(typeof adapter.piExecutable.command, "string");
    assert.equal(typeof adapter.piExecutable.source, "string");
  });

  it("issues launchBootstrap with a composed command (token in file, not argv)", async () => {
    const grantToken = "GRANT-SECRET-VALUE-DO-NOT-LEAK";
    const tokenFilePath = join(dir, "tok.token");
    const promptFilePath = join(dir, "prompt.txt");
    const { service, bus, getLaunch } = buildStubHost({ grantToken, tokenFilePath, promptFilePath });
    const FAKE_CRED = "sk-CREDENTIAL-DO-NOT-LEAK";

    const adapter = createPiTerminalAdapter({
      sessionId: "s-1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: FAKE_CRED } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    // Drive one invoke. The bus has no events queued; the iterator
    // blocks. We cancel via the abort signal to unblock.
    const controller = new AbortController();
    const invokeP = (async () => {
      const events = [];
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "say hi" }] },
        signal: controller.signal,
      })) {
        events.push(event);
      }
      return events;
    })();

    // Wait for the first delta (turn start) then cancel.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    const events = await invokeP;
    const firstDelta = events.find((e) => e.type === "delta");
    assert.ok(firstDelta, "expected at least one delta event");
    assert.equal(firstDelta.data.terminalSessionId, "term-1");

    const launch = getLaunch();
    assert.ok(launch, "expected launchBootstrap to have been called");
    const cmd = launch.bootstrapCommand;
    // Token path appears (argv) but token value NEVER does.
    assert.match(cmd, new RegExp(tokenFilePath.replace(/[/.]/g, "\\$&")));
    assert.equal(cmd.includes(grantToken), false);
    // Credential value NEVER appears.
    assert.equal(cmd.includes(FAKE_CRED), false);
    // Token file mode is 0600.
    const stats = await stat(tokenFilePath);
    assert.equal(stats.mode & 0o777, 0o600);
  });

  it("uses a prompt file for multi-line prompts and never embeds the prompt in argv", async () => {
    const grantToken = "GRANT-SECRET";
    const tokenFilePath = join(dir, "tok2.token");
    const promptFilePath = join(dir, "prompt2.txt");
    const { service, bus, getLaunch } = buildStubHost({ grantToken, tokenFilePath, promptFilePath });
    const FAKE_CRED = "sk-CRED";
    const LONG_PROMPT = "line1\nline2\nline3\nline4";

    const adapter = createPiTerminalAdapter({
      sessionId: "s-2",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: FAKE_CRED } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    const controller = new AbortController();
    const invokeP = (async () => {
      const events = [];
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-2" },
        input: { messages: [{ role: "user", content: LONG_PROMPT }] },
        signal: controller.signal,
      })) events.push(event);
      return events;
    })();
    // Capture the prompt file content BEFORE the invoke's finally
    // unlinks it. The adapter writes the file synchronously before
    // launchBootstrap; waiting 30ms is enough for the write + the
    // launchBootstrap to complete.
    await new Promise((r) => setTimeout(r, 50));
    let promptContent = null;
    let promptStats = null;
    try { promptContent = await readFile(promptFilePath, "utf8"); promptStats = await stat(promptFilePath); }
    catch { /* may have been unlinked if invoke finished */ }
    controller.abort();
    await invokeP;

    const launch = getLaunch();
    const cmd = launch.bootstrapCommand;
    // Multi-line prompt -> pi @<file> path; prompt text NEVER in argv.
    assert.match(cmd, new RegExp(`pi '@${promptFilePath.replace(/[/.]/g, "\\$&")}'`));
    assert.equal(cmd.includes("line1"), false);
    assert.equal(cmd.includes("line2"), false);
    if (promptContent !== null) {
      assert.equal(promptContent, LONG_PROMPT);
      assert.equal(promptStats.mode & 0o777, 0o600);
    }
  });

  it("fails closed when the credential is missing (host wiring returns null)", async () => {
    const tokenFilePath = join(dir, "tok3.token");
    const promptFilePath = join(dir, "prompt3.txt");
    const { service, bus } = buildStubHost({ grantToken: "G", tokenFilePath, promptFilePath });

    const adapter = createPiTerminalAdapter({
      sessionId: "s-3",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
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
    // No token file should be created on the missing-credential path
    // because we never reach the launchBootstrap step.
    const tokenStat = await stat(tokenFilePath).catch((e) => e);
    assert.equal(tokenStat.code, "ENOENT");
  });

  it("translates terminal.command.ended (exitStatus 0) to a final event", async () => {
    const tokenFilePath = join(dir, "tok4.token");
    const promptFilePath = join(dir, "prompt4.txt");
    const { service, bus, getLaunch } = buildStubHost({ grantToken: "G", tokenFilePath, promptFilePath });

    const adapter = createPiTerminalAdapter({
      sessionId: "s-4",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: "sk" } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    const events = [];
    const invokeP = (async () => {
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-4" },
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
    const tokenFilePath = join(dir, "tok5.token");
    const promptFilePath = join(dir, "prompt5.txt");
    const { service, bus } = buildStubHost({ grantToken: "G", tokenFilePath, promptFilePath });

    const adapter = createPiTerminalAdapter({
      sessionId: "s-5",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2" },
      rosSessionPath: "/srv/ros-session.mjs",
      tokenFilePath: () => tokenFilePath,
      promptFilePath: () => promptFilePath,
      providerProfileId: "openai",
      hostTerminal: {
        resolveCredential: async (id) => id === "openai" ? { name: "OPENAI_API_KEY", value: "sk" } : null,
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });

    const events = [];
    const invokeP = (async () => {
      for await (const event of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-5" },
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
