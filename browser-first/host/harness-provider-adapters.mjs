// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-5 bridge-side harness provider adapters. These are the RUNTIME
// implementations of the SDK `HarnessProviderAdapter` contract (mirrored in
// plain JS — the bridge is dependency-free of `src/`): the generic
// start/status/events/cancel/artifact lifecycle is written ONCE, and each
// provider wires only its real `diagnose()` + `dispatch()` transport.
//
// Authority never lives here: the bridge's governed envelope (CP-2) authorizes
// before any adapter method runs. The dispatch is dependency-injected so the
// lifecycle is unit-testable without a live Cordis/OpenCode/Hermes.

import { hermesRuntimeDiagnostics } from "./hermes-runtime.mjs";
import { opencodeRuntimeDiagnostics } from "./opencode-runtime.mjs";
import { dispatchGovernedExternalAgentRuntime, findAddonManifest } from "./external-agent-runtime-dispatcher.mjs";
import { createOpencodeHttpClient, ensureOpencodeServer } from "./opencode-client.mjs";
import { spawnSync } from "node:child_process";
import { runPiPrompt } from "./pi-rpc-client.mjs";

function isPathWithin(path, root) {
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`);
}

/**
 * Generic harness lifecycle (mirrors src/sdk/harnesses/base-harness-provider.ts).
 * `diagnose` and `dispatch` are the only provider-specific seams.
 */
export function createHarnessProviderAdapter({
  providerId,
  cancellationSemantics,
  sandboxStrength,
  diagnose,
  dispatch = null,
}) {
  const runs = new Map();
  let seq = 0;

  function entry(runId) {
    const run = runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }

  function appendEvent(runId, kind, actorPrincipalId, detail) {
    const run = entry(runId);
    run.events.push({
      eventId: `${runId}:${run.events.length}`,
      taskId: run.run.taskId,
      at: new Date().toISOString(),
      kind,
      actorPrincipalId,
      detail,
    });
    run.run.lastEventId = String(run.events.length - 1);
  }

  async function startTask(packet, grant) {
    const runId = `${providerId}-run-${++seq}`;
    const workspaceRoot = packet.workspaceRoots?.[0] ?? "/tmp";
    runs.set(runId, {
      run: { runId, providerId, taskId: packet.taskId, status: "running", startedAt: new Date().toISOString() },
      events: [],
      artifacts: [],
      workspaceRoot,
    });
    appendEvent(runId, "active", packet.issuerPrincipalId);
    if (typeof dispatch === "function") {
      try {
        const outcome = await dispatch(packet, grant);
        if (outcome && outcome.outcome === "deny") {
          fail(runId, outcome.detail ?? outcome.reason ?? "dispatch denied");
        } else {
          complete(runId);
        }
      } catch (error) {
        fail(runId, error?.message ?? String(error));
      }
    }
    return { ...runs.get(runId).run };
  }

  async function getTask(runId) {
    return { ...entry(runId).run };
  }

  async function* events(runId, cursor) {
    const run = entry(runId);
    let index = cursor == null ? 0 : Number(cursor);
    while (index < run.events.length) {
      yield run.events[index];
      index += 1;
    }
  }

  async function cancelTask(runId, reason) {
    const run = entry(runId);
    run.run.status = "cancelled";
    run.run.detail = reason;
    run.run.endedAt = new Date().toISOString();
    appendEvent(runId, "revoked", "core", reason);
  }

  async function collectArtifacts(runId) {
    return entry(runId).artifacts.map((artifact) => ({ ...artifact }));
  }

  function recordArtifact(runId, artifact) {
    const run = entry(runId);
    if (!isPathWithin(artifact.root, run.workspaceRoot)) {
      throw new Error(`artifact root ${artifact.root} escapes workspace root ${run.workspaceRoot}`);
    }
    run.artifacts.push(artifact);
  }

  function complete(runId, artifacts = []) {
    const run = entry(runId);
    run.run.status = "completed";
    run.run.endedAt = new Date().toISOString();
    for (const artifact of artifacts) recordArtifact(runId, artifact);
    appendEvent(runId, "completed", "core");
  }

  function fail(runId, detail) {
    const run = entry(runId);
    run.run.status = "failed";
    run.run.detail = detail;
    run.run.endedAt = new Date().toISOString();
    appendEvent(runId, "revoked", "core", detail);
  }

  return {
    providerId,
    cancellationSemantics,
    sandboxStrength,
    diagnose,
    startTask,
    getTask,
    events,
    cancelTask,
    collectArtifacts,
    recordArtifact,
    complete,
    fail,
  };
}

/**
 * Dispatch a packet through the governed envelope (CP-2). Builds a GovernedRequest
 * from the TaskPacket + grant handle and defers authority to
 * `dispatchGovernedExternalAgentRuntime`. Fails closed when no governedAuthority.
 */
function governedRuntimeDispatch({ addonId, toolName, governedAuthority, fetchImpl, repoRoot }) {
  return (packet, grant) => {
    if (!governedAuthority) {
      return { outcome: "deny", reason: "governed-authority-unavailable", detail: "no governed authority on this bridge" };
    }
    const request = {
      taskId: packet.taskId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      payload: {
        addonId,
        tool: toolName,
        messages: [{ role: "user", content: packet.intent }],
      },
    };
    return dispatchGovernedExternalAgentRuntime({ request, governedAuthority, fetchImpl, repoRoot });
  };
}

/**
 * OpenCode transport (structurally different from Cordis): validate the governed
 * envelope, then drive a real `opencode serve` session via the injected client
 * (`ensureOpencodeServer` + `createOpencodeHttpClient`). Authority is still the
 * governed envelope; the effect is the OpenCode HTTP/SSE session, not Cordis.
 */
function opencodeRuntimeDispatch({
  governedAuthority,
  ensureServer = ensureOpencodeServer,
  createClient = createOpencodeHttpClient,
  fetchImpl,
  spawnImpl,
  command,
  directory,
  baseUrl,
}) {
  return async (packet, grant) => {
    if (!governedAuthority) {
      return { outcome: "deny", reason: "governed-authority-unavailable", detail: "no governed authority on this bridge" };
    }
    const request = {
      taskId: packet.taskId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      payload: { addonId: "addon.opencode", tool: "opencode.run", messages: [{ role: "user", content: packet.intent }] },
    };
    const decision = governedAuthority.validateGovernedRequest(request);
    if (!decision.ok) {
      return { outcome: "deny", reason: decision.reason, detail: `governed request rejected: ${decision.reason}` };
    }
    const server = await ensureServer({ fetchImpl, spawnImpl, command, directory });
    const client = createClient({ fetchImpl, baseUrl: server.baseUrl ?? baseUrl, directory });
    const session = await client.createSession(packet.taskId);
    await client.prompt(session.id, packet.intent);
    return { outcome: "allow", response: session, sessionId: session.id };
  };
}


// Pi transport (stdio-json-rpc): validate the governed envelope, then drive
function piRuntimeDispatch({ governedAuthority, command, provider, model, env, timeoutMs, runPrompt = runPiPrompt }) {
  return async (packet, grant) => {
    if (!governedAuthority) {
      return { outcome: "deny", reason: "governed-authority-unavailable", detail: "no governed authority on this bridge" };
    }
    const request = {
      taskId: packet.taskId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      payload: { addonId: "addon.pi", tool: "pi.delegate", messages: [{ role: "user", content: packet.intent }] },
    };
    const decision = governedAuthority.validateGovernedRequest(request);
    if (!decision.ok) {
      return { outcome: "deny", reason: decision.reason, detail: `governed request rejected: ${decision.reason}` };
    }
    return runPrompt({ intent: packet.intent, command, provider, model, env, timeoutMs });
  };
}

// Host-command transport: validate the governed envelope, then spawn a CLI in
// the workspace root and capture stdout/stderr plus exit status. Aider, OpenClaw,
// and Hermes all dispatch a single non-interactive CLI invocation this way; only
// their `command` and `buildArgs` differ.
function hostCommandRuntimeDispatch({ governedAuthority, addonId, tool, command, buildArgs = (packet) => [], env, directory, timeoutMs = 120000, spawnImpl = spawnSync }) {
  return async (packet, grant) => {
    if (!governedAuthority) {
      return { outcome: "deny", reason: "governed-authority-unavailable", detail: "no governed authority on this bridge" };
    }
    const request = {
      taskId: packet.taskId,
      delegationId: packet.delegationChainRef?.delegationId ?? null,
      subjectPrincipalId: packet.executorPrincipalId,
      grantHandle: grant,
      auditCorrelationId: packet.auditCorrelationId,
      payload: { addonId, tool, messages: [{ role: "user", content: packet.intent }] },
    };
    const decision = governedAuthority.validateGovernedRequest(request);
    if (!decision.ok) {
      return { outcome: "deny", reason: decision.reason, detail: `governed request rejected: ${decision.reason}` };
    }
    const cwd = directory ?? packet.workspaceRoots?.[0];
    const r = spawnImpl(command, buildArgs(packet), { cwd, env: { ...process.env, ...env }, encoding: "utf8", timeout: timeoutMs });
    if (r.error) {
      return { outcome: "deny", reason: "upstream-unreachable", detail: `${command} spawn failed: ${r.error?.message ?? r.error}` };
    }
    if (r.status !== 0) {
      return { outcome: "deny", reason: "upstream-error", detail: `${command} exited ${r.status}`, response: { stdout: r.stdout, stderr: r.stderr } };
    }
    return { outcome: "allow", response: { stdout: r.stdout, stderr: r.stderr } };
  };
}

export function createHermesProviderAdapter(options = {}) {
  const diagnose = async () => {
    const diag = hermesRuntimeDiagnostics({ homeDir: options.homeDir });
    return {
      status: diag.installed ? "ok" : "unavailable",
      providerId: "hermes",
      message: diag.installed ? undefined : "Hermes CLI not found",
      command: diag.command ?? undefined,
    };
  };
  return createHarnessProviderAdapter({
    providerId: "hermes",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose,
    dispatch: hostCommandRuntimeDispatch({
      ...options,
      addonId: "addon.hermes",
      tool: "hermes.delegate",
      command: options.command ?? "hermes",
      buildArgs: (packet) => {
        const args = ["-z", packet.intent];
        if (options.model) args.push("-m", options.model);
        const provider = options.provider ?? (options.model?.includes("/") ? options.model.split("/")[0] : "");
        if (provider) args.push("--provider", provider);
        return args;
      },
    }),
  });
}

export function createOpenCodeProviderAdapter(options = {}) {
  const diagnose = async () => {
    const diag = opencodeRuntimeDiagnostics({ homeDir: options.homeDir });
    return {
      status: diag.installed ? "ok" : "unavailable",
      providerId: "opencode",
      message: diag.installed ? undefined : "OpenCode CLI not found",
      command: diag.command ?? undefined,
    };
  };
  return createHarnessProviderAdapter({
    providerId: "opencode",
    cancellationSemantics: "finish-atomic",
    sandboxStrength: "sandboxed-outer-boundary",
    diagnose,
    dispatch: opencodeRuntimeDispatch({ ...options }),
  });
}

export function createOpenClawProviderAdapter(options = {}) {
  const diagnose = async () => {
    const manifest = await findAddonManifest("addon.openclaw", { repoRoot: options.repoRoot });
    return {
      status: manifest ? "ok" : "unavailable",
      providerId: "openclaw",
      message: manifest ? "runtime-gateway manifest present" : "OpenClaw manifest not found",
    };
  };
  return createHarnessProviderAdapter({
    providerId: "openclaw",
    cancellationSemantics: "quarantine",
    sandboxStrength: "sandboxed-outer-boundary",
    diagnose,
    dispatch: hostCommandRuntimeDispatch({
      ...options,
      addonId: "addon.openclaw",
      tool: "openclaw.delegate",
      command: options.command ?? "openclaw",
      buildArgs: (packet) => ["agent", "--local", "--agent", options.agent ?? "main", "-m", packet.intent, "--json"],
    }),
  });
}

export function createAgentZeroProviderAdapter(options = {}) {
  const diagnose = async () => {
    const manifest = await findAddonManifest("addon.agentzero", { repoRoot: options.repoRoot });
    return {
      status: manifest ? "ok" : "unavailable",
      providerId: "agentzero",
      message: manifest ? "containerized agent framework manifest present" : "AgentZero manifest not found",
    };
  };
  return createHarnessProviderAdapter({
    providerId: "agentzero",
    cancellationSemantics: "cancel",
    sandboxStrength: "sandboxed-outer-boundary",
    diagnose,
    dispatch: governedRuntimeDispatch({ addonId: "addon.agentzero", toolName: "agentzero.delegate", ...options }),
  });
}

export function createDeepSeekHarnessProviderAdapter(options = {}) {
  const diagnose = async () => {
    const manifest = await findAddonManifest("addon.deepseek-harness", { repoRoot: options.repoRoot });
    return {
      status: manifest ? "ok" : "unavailable",
      providerId: "deepseek-harness",
      message: manifest ? "OpenAI-compatible harness manifest present" : "DeepSeek harness manifest not found",
    };
  };
  return createHarnessProviderAdapter({
    providerId: "deepseek-harness",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose,
    dispatch: governedRuntimeDispatch({ addonId: "addon.deepseek-harness", toolName: "deepseek_harness.run_task", ...options }),
  });
}

export function createPiProviderAdapter(options = {}) {
  const diagnose = async () => {
    const manifest = await findAddonManifest("addon.pi", { repoRoot: options.repoRoot });
    return {
      status: manifest ? "ok" : "unavailable",
      providerId: "pi",
      message: manifest ? "pi.dev harness manifest present" : "Pi manifest not found",
    };
  };
  return createHarnessProviderAdapter({
    providerId: "pi",
    cancellationSemantics: "cancel",
    sandboxStrength: "host-mediated",
    diagnose,
    dispatch: piRuntimeDispatch({ ...options }),
  });
}

export function createAiderProviderAdapter(options = {}) {
  const diagnose = async () => {
    const manifest = await findAddonManifest("addon.aider", { repoRoot: options.repoRoot });
    return {
      status: manifest ? "ok" : "unavailable",
      providerId: "aider",
      message: manifest ? "aider manifest present" : "Aider manifest not found",
    };
  };
  return createHarnessProviderAdapter({
    providerId: "aider",
    cancellationSemantics: "finish-atomic",
    sandboxStrength: "host-mediated",
    diagnose,
    dispatch: hostCommandRuntimeDispatch({
      ...options,
      addonId: "addon.aider",
      tool: "aider.delegate",
      command: options.command ?? "aider",
      buildArgs: (packet) => ["--yes-always", "--message", packet.intent, ...(options.model ? ["--model", options.model] : [])],
    }),
  });
}
