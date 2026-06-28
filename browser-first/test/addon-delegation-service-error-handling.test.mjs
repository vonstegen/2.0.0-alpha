import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAddonDelegationService } from "../host/addon-delegation-service.mjs";

function safeFileSlug(value) {
  return String(value ?? "item")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function createService(root, overrides = {}) {
  let id = 0;
  const browserFirstRoot = () => path.join(root, "BrowserFirst");
  return createAddonDelegationService({
    browserFirstRoot,
    bridgePublicUrl: "http://127.0.0.1:47773",
    dashboardTarget: () => ({ host: "127.0.0.1", port: 9119, url: "http://127.0.0.1:9119" }),
    execFileStdout: async () => {
      throw new Error("CLI execution should not run in deterministic tests.");
    },
    expandUserPath: (value) => path.resolve(root, String(value ?? "")),
    firstExistingExecutable: () => null,
    hermesCommand: overrides.hermesCommand ?? (() => null),
    hermesHome: () => path.join(root, "HermesHome"),
    listFilesRecursive: async () => [],
    memoryRoot: () => path.join(root, "Memory"),
    opencodeCommand: overrides.opencodeCommand ?? (() => null),
    opencodeRuntimeDiagnostics: overrides.opencodeRuntimeDiagnostics ?? (() => ({ installed: false, command: null })),
    redactPathForDiagnostics: (value) => String(value ?? "").replace(root, "<root>"),
    readProviderSecrets: overrides.readProviderSecrets ?? (async () => ({})),
    repoRoot: root,
    safeFileSlug,
    spawnProcess: overrides.spawnProcess,
    socketOpen: async () => false,
    uniqueRuntimeId: (prefix) => `${prefix}-test-${++id}`,
    userRoot: () => root,
  });
}

async function withTempService(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ros-delegation-errors-"));
  try {
    return await fn(createService(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function blockArtifactRoot(root) {
  const browserFirstRoot = path.join(root, "BrowserFirst");
  await mkdir(browserFirstRoot, { recursive: true });
  await writeFile(path.join(browserFirstRoot, "DelegationArtifacts"), "not a directory");
}

async function assertFinalizationFailureIsTerminal(target) {
  await withTempService(async (service, root) => {
    const created = await service.executeDelegationRecord({
      target,
      mission: `Exercise ${target} finalization failure handling.`,
    });
    await blockArtifactRoot(root);

    const started = target === "hermes"
      ? await service.executeHermesDelegationStart({ path: created.path, adapter: "deterministic" })
      : await service.executeOpenCodeDelegationStart({ path: created.path, adapter: "deterministic" });

    assert.equal(started.status, "failed");
    assert.match(started.failureReason, /DelegationArtifacts|not a directory|ENOTDIR|EEXIST/i);

    const taskPacket = await readFile(path.join(root, created.path), "utf8");
    assert.match(taskPacket, /^- status:\s*failed$/mi);
    assert.doesNotMatch(taskPacket, /^- status:\s*running$/mi);
    assert.match(taskPacket, /^- failureReason:\s*.+$/mi);
  });
}

function withEnv(values = {}, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    });
}

test("Hermes delegation records failed status when artifact finalization fails", async () => {
  await assertFinalizationFailureIsTerminal("hermes");
});

test("OpenCode delegation records failed status when artifact finalization fails", async () => {
  await assertFinalizationFailureIsTerminal("opencode");
});

test("Hermes status prefers session MiniMax credentials for alpha provider routing", async () => {
  await withTempService(async (_service, root) => {
    const service = createService(root, {
      hermesCommand: () => "/usr/local/bin/hermes",
      readProviderSecrets: async () => ({ "shared-minimax": "session-minimax-credential" }),
    });

    const status = await service.executeHermesStatus();

    assert.equal(status.provider, "minimax");
    assert.equal(status.model, "MiniMax-M3");
    assert.deepEqual(status.providerEnvKeys, ["MINIMAX_API_KEY"]);
  });
});

test("Hermes MiniMax execution uses OpenAI-compatible custom runtime endpoint", async () => {
  await withEnv({
    RESONANTOS_HERMES_EXECUTION: "enabled",
    MINIMAX_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_BASE_URL: undefined,
    RESONANTOS_HERMES_MINIMAX_BASE_URL: undefined,
    RESONANTOS_MINIMAX_OPENAI_BASE_URL: undefined,
  }, async () => {
    await withTempService(async (_service, root) => {
      const hermesBin = path.join(root, "HermesHome", "hermes-agent", "venv", "bin");
      const hermesCommand = path.join(hermesBin, "hermes");
      await mkdir(hermesBin, { recursive: true });
      await writeFile(hermesCommand, "");
      await writeFile(path.join(hermesBin, "python"), "");
      await writeFile(path.join(root, "HermesHome", "hermes-agent", "run_agent.py"), "");

      let captured = null;
      const service = createService(root, {
        hermesCommand: () => hermesCommand,
        readProviderSecrets: async () => ({ "shared-minimax": "session-minimax-credential" }),
        spawnProcess: (_command, args, options) => {
          captured = { args, options };
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => undefined;
          setImmediate(() => {
            writeFile(args[2], JSON.stringify({
              ok: true,
              completed: true,
              apiCalls: 1,
              finalResponse: [
                "Final Summary",
                "HERMES MAIN DELEGATION OK",
                "",
                "Actions Taken",
                "- Ran through the injected Hermes child process.",
                "",
                "Approval Needs",
                "- None.",
                "",
                "Residual Risks",
                "- None for this deterministic adapter test.",
                "",
                "Verification",
                "- Captured the Hermes runtime environment.",
              ].join("\n"),
            }))
              .then(() => child.emit("close", 0, null))
              .catch((error) => child.emit("error", error));
          });
          return child;
        },
      });

      const created = await service.executeDelegationRecord({
        target: "hermes",
        mission: "Exercise MiniMax runtime adapter environment.",
      });
      const started = await service.executeHermesDelegationStart({ path: created.path });

      assert.equal(started.status, "completed");
      assert.equal(captured?.options?.env?.HERMES_INFERENCE_PROVIDER, "custom");
      assert.equal(captured?.options?.env?.HERMES_INFERENCE_MODEL, "MiniMax-M3");
      assert.equal(captured?.options?.env?.RESONANTOS_HERMES_BASE_URL, "https://api.minimax.io/v1");
      assert.equal(captured?.options?.env?.OPENAI_BASE_URL, "https://api.minimax.io/v1");
      assert.equal(captured?.options?.env?.RESONANTOS_HERMES_API_MODE, "chat_completions");
      assert.equal(captured?.options?.env?.MINIMAX_API_KEY, "session-minimax-credential");
      assert.equal(captured?.options?.env?.OPENAI_API_KEY, "session-minimax-credential");
      assert.equal(captured?.options?.env?.RESONANTOS_HERMES_API_KEY, "session-minimax-credential");
    });
  });
});

test("Hermes delegation fails closed when runtime returns unresolved tool-call markup", async () => {
  await withEnv({
    RESONANTOS_HERMES_EXECUTION: "enabled",
    MINIMAX_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
  }, async () => {
    await withTempService(async (_service, root) => {
      const hermesBin = path.join(root, "HermesHome", "hermes-agent", "venv", "bin");
      const hermesCommand = path.join(hermesBin, "hermes");
      await mkdir(hermesBin, { recursive: true });
      await writeFile(hermesCommand, "");
      await writeFile(path.join(hermesBin, "python"), "");
      await writeFile(path.join(root, "HermesHome", "hermes-agent", "run_agent.py"), "");

      const service = createService(root, {
        hermesCommand: () => hermesCommand,
        readProviderSecrets: async () => ({ "shared-minimax": "session-minimax-credential" }),
        spawnProcess: (_command, args) => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => undefined;
          setImmediate(() => {
            writeFile(args[2], JSON.stringify({
              ok: true,
              completed: true,
              apiCalls: 1,
              finalResponse: [
                "Final Summary",
                "I'll create a local-only delegation smoke artifact.]<]minimax[>[<tool_call>",
                "",
                "Actions Taken",
                "- Hermes attempted a provider tool call.",
                "",
                "Approval Needs",
                "- None.",
                "",
                "Residual Risks",
                "- Provider tool-call markup leaked into the result.",
                "",
                "Verification",
                "- Simulated malformed runtime output.",
              ].join("\n"),
            }))
              .then(() => child.emit("close", 0, null))
              .catch((error) => child.emit("error", error));
          });
          return child;
        },
      });

      const created = await service.executeDelegationRecord({
        target: "hermes",
        mission: "Create a local-only Hermes delegation smoke artifact.",
      });
      const started = await service.executeHermesDelegationStart({ path: created.path });

      assert.equal(started.status, "failed");
      assert.match(started.failureReason, /unresolved provider tool-call markup/i);
      const taskPacket = await readFile(path.join(root, created.path), "utf8");
      assert.match(taskPacket, /^- status:\s*failed$/mi);
      assert.match(taskPacket, /^- failureReason:\s*Hermes returned unresolved provider tool-call markup/m);
    });
  });
});

test("OpenCode status prefers MiniMax model when MiniMax credential is available", async () => {
  await withTempService(async (_service, root) => {
    const service = createService(root, {
      opencodeRuntimeDiagnostics: () => ({
        installed: true,
        command: "/usr/local/bin/opencode",
        commandRedacted: "/usr/local/bin/opencode",
      }),
      readProviderSecrets: async () => ({ "shared-minimax": "session-minimax-credential" }),
    });

    const status = await service.executeOpenCodeStatus();

    assert.equal(status.model, "minimax/MiniMax-M3");
    assert.equal(status.modelSource, "provider-default");
    assert.deepEqual(status.providerEnvKeys, ["MINIMAX_API_KEY"]);
  });
});

test("OpenCode status preserves explicit OpenAI model requests", async () => {
  await withEnv({ OPENAI_API_KEY: undefined }, async () => {
    await withTempService(async (_service, root) => {
      const service = createService(root, {
        readProviderSecrets: async () => ({ "shared-minimax": "session-minimax-credential" }),
      });

      const status = await service.executeOpenCodeStatus({ model: "openai/gpt-5.4-mini" });

      assert.equal(status.model, "openai/gpt-5.4-mini");
      assert.equal(status.modelSource, "request");
      assert.deepEqual(status.providerEnvKeys, []);
    });
  });
});

test("OpenCode delegation blocks before CLI execution when selected provider credential is missing", async () => {
  await withEnv({
    RESONANTOS_OPENCODE_EXECUTION: "enabled",
    MINIMAX_API_KEY: undefined,
    OPENAI_API_KEY: undefined,
    OPENROUTER_API_KEY: undefined,
  }, async () => {
    await withTempService(async (_service, root) => {
      const service = createService(root, {
        opencodeRuntimeDiagnostics: () => ({
          installed: true,
          command: "/usr/local/bin/opencode",
          commandRedacted: "/usr/local/bin/opencode",
        }),
        readProviderSecrets: async () => ({}),
      });
      const created = await service.executeDelegationRecord({
        target: "opencode",
        mission: "Exercise missing provider credential guidance before OpenCode execution.",
      });

      const started = await service.executeOpenCodeDelegationStart({ path: created.path });

      assert.equal(started.status, "blocked");
      assert.match(started.blockedReason, /OpenCode provider credential unavailable for openai \/ openai\/gpt-5\.4-mini/);
      assert.match(started.blockedReason, /Settings > Providers/);
      const taskPacket = await readFile(path.join(root, created.path), "utf8");
      assert.match(taskPacket, /^- status:\s*blocked$/mi);
      assert.match(taskPacket, /^- model:\s*openai\/gpt-5\.4-mini$/mi);
    });
  });
});
