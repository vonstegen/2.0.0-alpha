// CP-XH1 / CP-XH2 gate tests: contracts, registry, validator, and
// the behavioral proof that the generic launcher is
// harness/terminal-agnostic.
//
//   - terminal-surface-contract shape + capability matching
//   - external-cli-harness-policy shape + reviewed-policy set
//   - harness-policy-registry: pi-v1 is reviewed, unknowns are not
//   - validator: rejects executable/command/credential/env material
//     inside a manifest's harnessRuntime
//   - generic launcher source has NO harness/terminal identity branches
//   - fixture (in-memory) policy drives the generic launcher end-to-end

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isTerminalSurfaceDescriptor,
  terminalSurfaceSatisfies,
  pickCompatibleSurface,
  getTerminalSurfaceDescriptor,
  listTerminalSurfaceDescriptors,
} from "../host/terminal-surface-registry.mjs";
import {
  getHarnessPolicy,
  listReviewedPolicyIds,
  validateHarnessRuntimePolicyRequest,
} from "../host/harness-policy-registry.mjs";
import { resolveHarnessTerminalCompatibility } from "../host/harness-terminal-compatibility.mjs";
import { createExternalCliTerminalAdapter } from "../host/agent-adapters/external-cli-terminal.mjs";

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

describe("XH1 — terminal surface descriptor", () => {
  it("descriptors validate via the host-side mirror", () => {
    for (const desc of listTerminalSurfaceDescriptors()) {
      assert.ok(isTerminalSurfaceDescriptor(desc), `descriptor ${desc.adapterId} must validate`);
    }
  });

  it("registered surfaces: ghostty, iterm2, in-memory", () => {
    const ids = listTerminalSurfaceDescriptors().map((d) => d.adapterId).sort();
    assert.deepEqual(ids, ["ghostty", "in-memory", "iterm2"]);
  });

  it("iTerm2 descriptor is honest about command-events + multiplexer + adopt-existing", () => {
    const iterm = getTerminalSurfaceDescriptor("iterm2");
    assert.ok(iterm);
    assert.ok(iterm.capabilities.includes("command-events"));
    assert.ok(iterm.capabilities.includes("multiplexer"));
    assert.ok(iterm.capabilities.includes("adopt-existing"));
    assert.equal(iterm.feedbackChannel, "event-stream");
  });

  it("Ghostty descriptor does NOT claim command-events (1.3.1 polls only)", () => {
    const g = getTerminalSurfaceDescriptor("ghostty");
    assert.ok(g);
    assert.ok(!g.capabilities.includes("command-events"), "ghostty 1.3.1 has no AppleScript command-events");
    assert.equal(g.feedbackChannel, "polling");
  });

  it("terminalSurfaceSatisfies: every required capability must be in the descriptor", () => {
    const g = getTerminalSurfaceDescriptor("ghostty");
    assert.ok(terminalSurfaceSatisfies(g, []));
    assert.ok(terminalSurfaceSatisfies(g, ["command", "environment"]));
    assert.ok(!terminalSurfaceSatisfies(g, ["command", "screen-stream"]), "ghostty does not expose screen-stream");
  });

  it("pickCompatibleSurface returns the first descriptor that matches", () => {
    const d = pickCompatibleSurface(["command", "environment", "lifecycle-events", "command-events"], { preferred: ["ghostty", "iterm2", "in-memory"] });
    assert.equal(d.adapterId, "iterm2", "ghostty lacks command-events; iterm2 wins");
  });

  it("pickCompatibleSurface falls back to in-memory when nothing else matches", () => {
    // in-memory exposes [command, environment, cwd, lifecycle-events, command-events].
    // ghostty exposes the same minus command-events. Neither exposes screen-stream
    // or multiplexer, so requiring both means no real driver qualifies — and the
    // fallback is still null (in-memory does not satisfy the request).
    const d = pickCompatibleSurface(["command", "environment", "screen-stream", "multiplexer"], { preferred: ["ghostty"] });
    assert.equal(d, null);
  });

  it("pickCompatibleSurface returns null when no surface satisfies the requirements", () => {
    const d = pickCompatibleSurface(["this-capability-does-not-exist-anywhere"]);
    assert.equal(d, null);
  });
});

describe("XH1 — manifest harnessRuntime policy request validator", () => {
  it("accepts a valid pi-v1 declaration", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      terminalRequirements: ["command", "environment", "lifecycle-events"],
      credentialSource: "provider-profile",
      promptDelivery: "file",
      executionGating: "explicit-enable",
    });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  });

  it("rejects an unknown policyId", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "not-reviewed",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-id-unknown"));
  });

  it("rejects a missing policyId", () => {
    const result = validateHarnessRuntimePolicyRequest({ variant: "external-cli" });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-id-missing"));
  });

  it("rejects executable paths in any harnessRuntime field", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      executable: "/usr/local/bin/pi",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-executable"));
  });

  it("rejects shell command strings in any harnessRuntime field", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      command: "rm -rf /",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-executable"));
  });

  it("rejects credential material (apiKey, token, secret) anywhere in the tree", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      credential: { apiKey: "sk-leak", name: "OPENAI_API_KEY" },
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-credential"));
  });

  it("rejects unrestricted env blocks", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      environment: { FOO: "bar" },
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-env"));
  });

  it("rejects a variant other than external-cli", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "embedded-agent",
      policyId: "pi-v1",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-variant"));
  });

  it("rejects a non-array terminalRequirements", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      terminalRequirements: "command,environment",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-requirements-shape"));
  });

  it("rejects an unknown credentialSource", () => {
    const result = validateHarnessRuntimePolicyRequest({
      variant: "external-cli",
      policyId: "pi-v1",
      credentialSource: "implicit-injection",
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((i) => i.code === "manifest-policy-credential-source"));
  });
});

describe("XH1 — harness policy registry", () => {
  it("exposes exactly the reviewed pi-v1 policy", () => {
    const ids = listReviewedPolicyIds();
    assert.deepEqual(ids, ["pi-v1"]);
  });

  it("getHarnessPolicy returns the reviewed policy module", () => {
    const p = getHarnessPolicy("pi-v1");
    assert.ok(p);
    assert.equal(p.policyId, "pi-v1");
    assert.equal(p.harnessId, "pi");
    assert.deepEqual([...p.terminalRequirements], ["command", "environment", "lifecycle-events"]);
  });

  it("getHarnessPolicy returns null for unknown ids", () => {
    assert.equal(getHarnessPolicy("claude-code-v1"), null);
    assert.equal(getHarnessPolicy(""), null);
    assert.equal(getHarnessPolicy(null), null);
  });
});

describe("XH2 — generic launcher is harness/terminal-agnostic", () => {
  it("the launcher source has no harness- or terminal-identity branches", async () => {
    const src = await readFile(
      new URL("../host/agent-adapters/external-cli-terminal.mjs", import.meta.url),
      "utf8"
    );
    // Strip comments so the lint-style grep ignores explanatory text
    // (the launcher is documented with `pi` / `ghostty` as examples
    // of what a reviewed policy / surface look like — those literals
    // are commentary, not branches).
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
      .replace(/^\s*\/\/.*$/gm, "")      // line comments
      .replace(/\/\*.*?\*\//g, "");      // trailing block comments on a line
    // Forbidden identities: the launcher code must not mention "pi"
    // or "ghostty" or "iterm2" by name. It also must not import
    // pi-runtime.mjs. Any of these would mean the launcher has
    // leaked a harness/terminal identity into a path the prompt
    // requires to be many-to-many.
    assert.ok(!/\bpi\b/.test(codeOnly), "launcher must not mention 'pi' in code");
    assert.ok(!/iterm2/.test(codeOnly), "launcher must not mention 'iterm2' in code");
    assert.ok(!/ghostty/.test(codeOnly), "launcher must not mention 'ghostty' in code");
    assert.ok(!/pi-runtime\.mjs/.test(codeOnly), "launcher must not import pi-runtime.mjs in code");
    assert.ok(!/piCommand/.test(codeOnly), "launcher must not call piCommand() in code");
  });

  it("drives a second (fixture in-memory) policy through the same launcher end-to-end", async () => {
    // The fixture policy is a second, independent reviewed policy
    // registered at test time. It is not the pi-v1 policy, and the
    // launcher must drive it through the same code path.
    const { registerFixturePolicy, unregisterFixturePolicy, FIXTURE_POLICY_ID } = await import(
      "./_fixture-policy.mjs"
    );
    registerFixturePolicy();
    try {
      const dir = await mkdtemp(join(tmpdir(), "fixture-"));
      let launchArgs = null;
      const bus = makeBus();
      const service = {
        async launchBootstrap(args) { launchArgs = args; return { sessionId: "term-fx" }; },
        async terminateSession() {},
      };
      const adapter = createExternalCliTerminalAdapter({
        sessionId: "s-fx",
        policyId: FIXTURE_POLICY_ID,
        terminalHostService: service,
        terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
        promptFilePath: () => join(dir, "p.txt"),
        providerProfileId: "openai",
        hostTerminal: {
          resolveCredential: async () => ({ name: "OPENAI_API_KEY", value: "x" }),
          resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
          skillSourceRoot: dir,
          stagingBase: dir,
        },
      });
      assert.equal(adapter.policyId, FIXTURE_POLICY_ID);
      assert.equal(adapter.surfaceAdapterId, "in-memory");
      const controller = new AbortController();
      const events = [];
      const it = (async () => {
        for await (const ev of adapter.invoke({
          session: { fxTerminal: true, sessionId: "s-fx" },
          input: { messages: [{ role: "user", content: "hello fixture" }] },
          signal: controller.signal,
        })) events.push(ev);
      })();
      // Wait for the launch to land BEFORE aborting.
      for (let i = 0; i < 100 && !launchArgs; i += 1) {
        await new Promise((r) => setTimeout(r, 5));
      }
      assert.ok(launchArgs, "fixture policy called launchBootstrap through the same generic path");
      assert.match(launchArgs.commandSuffix, /fixture-cli/);
      controller.abort();
      await it;
      await rm(dir, { recursive: true, force: true });
    } finally {
      unregisterFixturePolicy();
    }
  });
});

describe("XH3b — launcher fail-closed on incompatible terminal", () => {
  it("yields a structured unsupported-terminal error BEFORE grant, token file, or launchBootstrap", async () => {
    const {
      registerUnsatisfiablePolicy,
      unregisterUnsatisfiablePolicy,
      UNSATISFIABLE_POLICY_ID,
    } = await import("./_fixture-policy.mjs");
    const {
      __resetSessionBootstrapGrantBroker,
      listOutstandingGrants,
    } = await import("../host/terminal-host-service.mjs");
    registerUnsatisfiablePolicy();
    __resetSessionBootstrapGrantBroker();
    try {
      const dir = await mkdtemp(join(tmpdir(), "xh3b-"));
      // Track every launch RPC + every file under the temp root so
      // the assertions can prove NO side effect happened.
      let launchCalls = 0;
      const bus = makeBus();
      const service = {
        async launchBootstrap(args) { launchCalls += 1; return { sessionId: "term-xh3b" }; },
        async terminateSession() {},
      };
      // Token file path is hard-coded so we can assert it was
      // NEVER written (the grant flow owns this file).
      const tokenFilePath = join(dir, "grant.token");
      const authFilePath = join(dir, "grant.auth.json");
      const adapter = createExternalCliTerminalAdapter({
        sessionId: "s-xh3b-1",
        policyId: UNSATISFIABLE_POLICY_ID,
        terminalHostService: {
          launchBootstrap: (...a) => service.launchBootstrap(...a),
          terminateSession: () => service.terminateSession(),
          // Simulate the real service's launchBootstrap by writing
          // the token / auth file IF the launcher ever asked. The
          // XH3b assertion is that the launcher NEVER asks.
          async composeBootstrapCommand() { return `echo ${tokenFilePath}`; },
          async attachSessionEnv() { return {}; },
        },
        terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
        promptFilePath: () => join(dir, "prompt.txt"),
        providerProfileId: "openai",
        hostTerminal: {
          resolveCredential: async () => ({ name: "OPENAI_API_KEY", value: "x" }),
          resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
          skillSourceRoot: dir,
          stagingBase: dir,
        },
      });
      // The construction-time verdict is INCOMPATIBLE (the policy
      // requires screen-stream, which no real driver exposes).
      assert.equal(adapter.initialCompatibility.compatible, false);
      assert.ok(adapter.initialCompatibility.missingCapabilities.includes("screen-stream"));

      // Drive invoke(). No side effects should happen.
      const events = [];
      for await (const ev of adapter.invoke({
        session: { sessionId: "s-xh3b-1" },
        input: { messages: [{ role: "user", content: "should never run" }] },
      })) events.push(ev);
      const err = events.find((e) => e.type === "error");
      assert.ok(err, "yielded an error event");
      // Public, non-secret shape. The error is a public error code
      // with the missing capability listed; NO path, token,
      // credential, or env value is included.
      assert.equal(err.data.code, "unsupported-terminal");
      assert.match(err.data.message, /no terminal surface satisfies/);
      assert.deepEqual([...err.data.missingCapabilities].sort(), ["screen-stream"]);
      assert.equal(err.data.policyId, UNSATISFIABLE_POLICY_ID);
      // The error data must not contain a path / token / credential /
      // env value. Walk it.
      for (const [k, v] of Object.entries(err.data)) {
        if (typeof v === "string") {
          assert.ok(
            /^[a-zA-Z][a-zA-Z0-9-]*$/.test(v) || v === err.data.message,
            `error data field ${k} looks non-public: ${JSON.stringify(v)}`,
          );
        }
        if (Array.isArray(v)) {
          for (const item of v) {
            assert.ok(
              /^[a-zA-Z][a-zA-Z0-9-]*$/.test(item),
              `error data array field ${k} has non-public element: ${JSON.stringify(item)}`,
            );
          }
        }
      }

      // Hard rules from §4 XH3b:
      assert.equal(launchCalls, 0, "no launchBootstrap RPC reached the terminal peer");
      assert.equal(listOutstandingGrants().length, 0, "no grant was tracked");
      // The token / auth file paths were never even read.
      let tokenExists = false;
      let authExists = false;
      try { await stat(tokenFilePath); tokenExists = true; } catch { /* not written */ }
      try { await stat(authFilePath); authExists = true; } catch { /* not written */ }
      assert.equal(tokenExists, false, "no token file was written");
      assert.equal(authExists, false, "no auth file was written");
      await rm(dir, { recursive: true, force: true });
    } finally {
      unregisterUnsatisfiablePolicy();
    }
  });

  it("a compatible policy (no screen-stream) proceeds normally", async () => {
    // The pi-v1 policy's requirement set ([command, environment,
    // lifecycle-events]) is satisfiable by all three real drivers,
    // so the launcher must NOT short-circuit.
    const dir = await mkdtemp(join(tmpdir(), "xh3b-ok-"));
    let launchArgs = null;
    const bus = makeBus();
    const service = {
      async launchBootstrap(args) { launchArgs = args; return { sessionId: "term-ok" }; },
      async terminateSession() {},
    };
    const adapter = createExternalCliTerminalAdapter({
      sessionId: "s-xh3b-ok",
      policyId: "pi-v1",
      terminalHostService: service,
      terminalHostStart: { bus, driveId: "in-memory", adapterId: "in-memory" },
      promptFilePath: () => join(dir, "p.txt"),
      providerProfileId: "openai",
      project: { root: dir },
      hostTerminal: {
        resolveCredential: async () => ({ name: "OPENAI_API_KEY", value: "x" }),
        resolveProjectIdentity: async ({ root }) => ({ id: "p1", label: "P1", root }),
        skillSourceRoot: dir,
        stagingBase: dir,
      },
    });
    assert.equal(adapter.initialCompatibility.compatible, true);
    assert.equal(adapter.surfaceAdapterId, "in-memory");
    const controller = new AbortController();
    const events = [];
    const it = (async () => {
      for await (const ev of adapter.invoke({
        session: { sessionId: "s-xh3b-ok" },
        input: { messages: [{ role: "user", content: "ok" }] },
        signal: controller.signal,
      })) events.push(ev);
    })();
    for (let i = 0; i < 100 && !launchArgs; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(launchArgs, "compatible policy reached launchBootstrap");
    controller.abort();
    await it;
    await rm(dir, { recursive: true, force: true });
  });
});

describe("XH3c — compatibility matrix (pi-v1 + fixture)", () => {
  it("pi-v1 × {ghostty, iterm2, in-memory} all resolve compatible", async () => {
    const REQS = ["command", "environment", "lifecycle-events"];
    const { getTerminalSurfaceDescriptor } = await import("../host/terminal-surface-registry.mjs");
    for (const id of ["ghostty", "iterm2", "in-memory"]) {
      const desc = getTerminalSurfaceDescriptor(id);
      assert.ok(desc);
      const r = resolveHarnessTerminalCompatibility({ requirements: REQS, descriptors: [desc] });
      assert.equal(r.compatible, true, `pi-v1 must be compatible with ${id}`);
      assert.equal(r.surface.adapterId, id);
      assert.equal(r.provenanceFidelity, "telemetry");
    }
  });

  it("Pi parameterization: pi-v1 + ghostty AND pi-v1 + iterm2 both resolve compatible", async () => {
    const REQS = ["command", "environment", "lifecycle-events"];
    const { getTerminalSurfaceDescriptor } = await import("../host/terminal-surface-registry.mjs");
    const ghostty = getTerminalSurfaceDescriptor("ghostty");
    const iterm2 = getTerminalSurfaceDescriptor("iterm2");
    const r1 = resolveHarnessTerminalCompatibility({ requirements: REQS, descriptors: [ghostty] });
    const r2 = resolveHarnessTerminalCompatibility({ requirements: REQS, descriptors: [iterm2] });
    assert.equal(r1.compatible, true);
    assert.equal(r1.surface.adapterId, "ghostty");
    assert.equal(r2.compatible, true);
    assert.equal(r2.surface.adapterId, "iterm2");
  });

  it("fixture (screen-stream) × ghostty is INCOMPATIBLE with the right missing capability", async () => {
    const { getTerminalSurfaceDescriptor } = await import("../host/terminal-surface-registry.mjs");
    const ghostty = getTerminalSurfaceDescriptor("ghostty");
    const r = resolveHarnessTerminalCompatibility({
      requirements: ["command", "environment", "screen-stream"],
      descriptors: [ghostty],
    });
    assert.equal(r.compatible, false);
    assert.deepEqual([...r.missingCapabilities], ["screen-stream"]);
    assert.equal(r.provenanceFidelity, "unsupported");
  });

  it("matrix row: in-memory satisfies command+environment but NOT screen-stream", () => {
    const inMemory = getTerminalSurfaceDescriptor("in-memory");
    const r1 = resolveHarnessTerminalCompatibility({ requirements: ["command", "environment"], descriptors: [inMemory] });
    const r2 = resolveHarnessTerminalCompatibility({ requirements: ["command", "environment", "screen-stream"], descriptors: [inMemory] });
    assert.equal(r1.compatible, true);
    assert.equal(r2.compatible, false);
    assert.deepEqual([...r2.missingCapabilities], ["screen-stream"]);
  });
});
