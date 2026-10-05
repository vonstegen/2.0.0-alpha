// CP-XH2: pi-v1 policy driven through the generic external-CLI
// launcher (replaces the old CP-S5b / CP-S5F2 Pi-specific tests).
//
// The harness-specific assertions (Pi executable metadata, multi-line
// prompt file, credential-never-leak, bus translation) are now driven
// by `createExternalCliTerminalAdapter({ policyId: "pi-v1" })`. The
// policy module's own `composePiInvocation` keeps the Pi argv-quoting
// discipline; the launcher is harness-agnostic.

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createExternalCliTerminalAdapter } from "../host/agent-adapters/external-cli-terminal.mjs";
import { composePiInvocation, createPiHarnessPolicy } from "../host/harness-policies/pi.mjs";

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

describe("composePiInvocation (XH2: pi policy exported)", () => {
  it("uses <exec> @<file> for multi-line prompts", () => {
    const out = composePiInvocation({ executable: { command: EXEC, source: "fixed-install-root" }, prompt: "line1\nline2", promptFilePath: "/tmp/p.txt" });
    assert.equal(out.commandSuffix, `'/usr/local/bin/pi' '@/tmp/p.txt'`);
    assert.match(out.auditSummary, /pi @<file>/);
  });

  it("uses <exec> @<file> for oversize prompts", () => {
    const big = "x".repeat(5000);
    const out = composePiInvocation({ executable: { command: EXEC, source: "fixed-install-root" }, prompt: big, promptFilePath: "/tmp/p.txt" });
    assert.equal(out.commandSuffix, `'/usr/local/bin/pi' '@/tmp/p.txt'`);
  });

  it("argv-quotes single-line short prompts", () => {
    const out = composePiInvocation({ executable: { command: EXEC, source: "fixed-install-root" }, prompt: "hello world", promptFilePath: null });
    assert.equal(out.commandSuffix, `'/usr/local/bin/pi' 'hello world'`);
  });

  it("argv-quotes prompts with single quotes (POSIX escape)", () => {
    const out = composePiInvocation({ executable: { command: EXEC, source: "fixed-install-root" }, prompt: "it's fine", promptFilePath: null });
    assert.equal(out.commandSuffix, `'/usr/local/bin/pi' 'it'\\''s fine'`);
  });

  it("rejects empty prompts", () => {
    assert.throws(() => composePiInvocation({ executable: { command: EXEC, source: "fixed-install-root" }, prompt: "   ", promptFilePath: null }), /empty/);
  });

  it("rejects a non-absolute executable (never a bare ambient command)", () => {
    assert.throws(() => composePiInvocation({ executable: { command: "pi", source: "fixed-install-root" }, prompt: "hi", promptFilePath: null }), /absolute executable path/);
    assert.throws(() => composePiInvocation({ executable: { command: "" }, prompt: "hi", promptFilePath: null }), /absolute executable path/);
  });
});

describe("createExternalCliTerminalAdapter (XH2: pi-v1 path)", () => {
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

  function buildAdapter(service, bus, { promptFilePath, project, policyId = "pi-v1" } = {}) {
    return createExternalCliTerminalAdapter({
      sessionId: "s-1",
      policyId,
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "iterm2", adapterId: "iterm2" },
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

  it("returns a reviewed policy with pi-v1 id and the in-memory surface", async () => {
    const bus = makeBus();
    const service = { launchBootstrap: async () => ({ sessionId: "term-1" }), terminateSession: async () => {} };
    const adapter = createExternalCliTerminalAdapter({
      sessionId: "s-1",
      policyId: "pi-v1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
      promptFilePath: () => join(dir, "prompt.txt"),
      providerProfileId: "openai",
      hostTerminal: { resolveCredential: async () => ({ name: "OPENAI_API_KEY", value: "x" }), resolveProjectIdentity: async () => ({ id: "p1", label: "P1", root: dir }) },
    });
    assert.equal(adapter.policyId, "pi-v1");
    assert.equal(adapter.harnessId, "pi");
    assert.equal(adapter.surfaceAdapterId, "in-memory");
    assert.equal(adapter.policySupportsModelSelection, true);
  });

  it("rejects an unknown policyId at construction (manifest cannot inject a policy)", () => {
    const bus = makeBus();
    const service = { launchBootstrap: async () => ({}), terminateSession: async () => {} };
    assert.throws(() => createExternalCliTerminalAdapter({
      sessionId: "s-1",
      policyId: "not-reviewed",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
      promptFilePath: () => join(dir, "p.txt"),
    }), /not reviewed/);
  });

  it("launches WITHOUT bootstrapCommand; commandSuffix carries the validated pi executable and no secrets", async () => {
    const { service, bus, getLaunch } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath: join(dir, "p.txt"), project: { root: dir } });
    const invokeP = driveOneTurn(adapter, "hello world");
    await invokeP;
    const args = getLaunch();
    assert.ok(args, "launchBootstrap was called");
    assert.equal(args.bootstrapCommand, undefined, "no bootstrapCommand override");
    // Extract the executable's absolute path from the commandSuffix
    // (the first single-quoted token). The path varies by install
    // (fixed-system-root, npm-global-sibling, nvm), so we don't pin
    // the exact value — we just verify the suffix starts with an
    // absolute, single-quoted path to a `pi` binary.
    const match = args.commandSuffix.match(/^'(\/[^']+)'/);
    assert.ok(match, "commandSuffix begins with a single-quoted absolute path");
    assert.ok(match[1].endsWith("/pi"), "absolute path points at the `pi` binary");
    assert.ok(!args.commandSuffix.includes("sk-CREDENTIAL-DO-NOT-LEAK"), "credential value never in commandSuffix");
    assert.ok(!args.commandSuffix.includes("OPENAI_API_KEY=sk-"), "credential env-var assignment never in commandSuffix");
  });

  it("uses a prompt file for multi-line prompts and never embeds the prompt in the suffix", async () => {
    const { service, bus, getLaunch } = buildStubHost();
    const promptFilePath = join(dir, "p.txt");
    const adapter = buildAdapter(service, bus, { promptFilePath, project: { root: dir } });
    const controller = new AbortController();
    const events = [];
    const it = (async () => {
      for await (const ev of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "line1\nline2\nline3" }] },
        signal: controller.signal,
      })) events.push(ev);
    })();
    // Wait for the launch to land BEFORE aborting.
    for (let i = 0; i < 100 && !getLaunch(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    controller.abort();
    await it;
    const args = getLaunch();
    assert.ok(args, "launchBootstrap was called");
    assert.match(args.commandSuffix, /@/, "multi-line prompt uses prompt file");
    assert.ok(!args.commandSuffix.includes("line1"), "prompt text never in commandSuffix");
    assert.ok(!args.commandSuffix.includes("line2"));
    assert.ok(!args.commandSuffix.includes("line3"));
  });

  it("fails closed when the credential is missing (host wiring returns null)", async () => {
    const { service, bus } = buildStubHost();
    const adapter = createExternalCliTerminalAdapter({
      sessionId: "s-1",
      policyId: "pi-v1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
      promptFilePath: () => join(dir, "p.txt"),
      providerProfileId: "openai",
      harness: "addon.pi-terminal",
      project: { root: dir },
      hostTerminal: {
        resolveCredential: async () => null, // missing credential
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });
    const events = [];
    for await (const ev of adapter.invoke({
      session: { piTerminalAdapter: true, sessionId: "s-1" },
      input: { messages: [{ role: "user", content: "hi" }] },
    })) events.push(ev);
    const err = events.find((e) => e.type === "error");
    assert.ok(err, "yielded an error event");
    // The host's projection seam reports a public code (e.g.
    // "missing-credential", "resource-denied"); the launcher passes
    // it through or falls back to "invalid-event". Both are valid
    // fail-closed signals.
    assert.ok(
      /runtime-unavailable|invalid-event|missing-credential|resource-denied/.test(err.data.code),
      `error code is a fail-closed signal; got ${JSON.stringify(err.data.code)}`
    );
  });

  it("translates terminal.command.ended (exitStatus 0) to a final event", async () => {
    const { service, bus, getLaunch } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath: join(dir, "p.txt"), project: { root: dir } });
    const events = [];
    const it = (async () => {
      for await (const ev of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "hi" }] },
      })) events.push(ev);
    })();
    // Wait for the launch to land; the adapter yields the first delta
    // BEFORE subscribing to the bus, so the bus.publish below only
    // reaches a subscriber if launchBootstrap has completed.
    for (let i = 0; i < 100 && !getLaunch(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(getLaunch(), "launchBootstrap called");
    bus.publish({ type: "terminal.command.started", data: { sessionId: "term-1", at: new Date().toISOString() } });
    bus.publish({ type: "terminal.command.ended", data: { sessionId: "term-1", at: new Date().toISOString(), exitStatus: 0 } });
    await it;
    const final = events.find((e) => e.type === "final");
    assert.ok(final, "yielded a final event");
    assert.match(final.data.text, /pi-v1/);
  });

  it("translates terminal.session.terminated to an error event", async () => {
    const { service, bus, getLaunch } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath: join(dir, "p.txt"), project: { root: dir } });
    const events = [];
    const it = (async () => {
      for await (const ev of adapter.invoke({
        session: { piTerminalAdapter: true, sessionId: "s-1" },
        input: { messages: [{ role: "user", content: "hi" }] },
      })) events.push(ev);
    })();
    for (let i = 0; i < 100 && !getLaunch(); i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(getLaunch(), "launchBootstrap called");
    bus.publish({ type: "terminal.session.terminated", data: { sessionId: "term-1", at: new Date().toISOString() } });
    await it;
    const err = events.find((e) => e.type === "error");
    assert.ok(err, "yielded an error event");
    assert.match(err.data.message, /terminated/);
  });

  it("rejects a providerProfileId not in the policy's supportedProviderFamilies", async () => {
    const { service, bus } = buildStubHost();
    const adapter = buildAdapter(service, bus, { promptFilePath: join(dir, "p.txt"), project: { root: dir } });
    const events = [];
    for await (const ev of adapter.invoke({
      session: { piTerminalAdapter: true, sessionId: "s-1" },
      input: { messages: [{ role: "user", content: "hi" }], model: "shared-anthropic/gpt-x" },
    })) events.push(ev);
    const err = events.find((e) => e.type === "error");
    assert.ok(err, "yielded an error event for unsupported provider family");
    assert.match(err.data.message, /does not support provider family/);
  });
});

describe("createPiHarnessPolicy (XH2: reviewed policy module shape)", () => {
  it("exposes the reviewed shape expected by the generic launcher", () => {
    const p = createPiHarnessPolicy();
    assert.equal(p.contractVersion, 1);
    assert.equal(p.policyId, "pi-v1");
    assert.equal(p.harnessId, "pi");
    assert.equal(p.credentialPolicy.source, "provider-profile");
    assert.equal(p.credentialPolicy.delivery, "session-environment");
    assert.equal(p.promptDelivery, "file");
    assert.equal(p.supportsModelSelection, true);
    assert.deepEqual([...p.terminalRequirements], ["command", "environment", "lifecycle-events"]);
    assert.equal(typeof p.resolveExecutable, "function");
    assert.equal(typeof p.composeInvocation, "function");
  });
});
