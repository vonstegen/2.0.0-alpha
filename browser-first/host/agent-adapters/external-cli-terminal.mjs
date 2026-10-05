// Generic External-CLI Terminal Adapter (XH2).
//
// The harness-policy-agnostic launcher for any policy registered in
// `harness-policy-registry.mjs` and any surface registered in
// `terminal-surface-registry.mjs`. The launcher is the single owner
// of:
//
//   - reviewed policy resolution (`policyId` -> policy)
//   - reviewed surface resolution (compatibility pick)
//   - reviewed executable resolution (policy.resolveExecutable)
//   - the projected session env build (host-owned)
//   - the prompt file staging (0600)
//   - the host-owned bootstrap grant (terminalHostService.launchBootstrap)
//   - the bus -> harness-event translation
//
// The launcher MUST NOT import `pi-runtime.mjs`, reference `"pi"`, or
// branch on harness/terminal identity. Pi, Claude Code, Codex, and
// future harnesses all go through the same code path; the only
// difference is the policy module and the surface registry entry.

import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { publicHarnessError } from "../harness-adapter-contract.mjs";
import {
  buildProjectedSessionEnv,
} from "../terminal-host-service.mjs";
import { getHarnessPolicy } from "../harness-policy-registry.mjs";
import { listTerminalSurfaceDescriptors } from "../terminal-surface-registry.mjs";
import { resolveHarnessTerminalCompatibility } from "../harness-terminal-compatibility.mjs";

const PROMPT_ARGV_MAX_BYTES = 4096;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) => typeof value === "string" && value.trim() && value.length <= 256;
function fail(code) {
  return Object.assign(new Error(publicHarnessError({ code }).message), { code });
}

/**
 * createExternalCliTerminalAdapter — the single owner of the
 * generic launcher path.
 *
 * @param {object} options
 * @param {string} options.sessionId
 * @param {string} options.policyId             reviewed policy id (e.g. "pi-v1")
 * @param {object} options.terminalHostService  host-owned service
 * @param {object} options.terminalHostStart    { adapterId, bus, driveId }
 * @param {() => string} options.promptFilePath callable -> absolute path
 * @param {string} [options.harness]            harness id (e.g. "addon.resonant-terminal-iterm2")
 * @param {object} [options.project]            { root, cwd? }
 * @param {object} [options.hostTerminal]       host boundary wiring
 * @param {object} [options.terminalBus]        { subscribe() } bus to translate
 * @param {readonly string[]} [options.preferredSurfaces]
 *   adapter ids the host prefers (e.g. ["ghostty", "iterm2", "in-memory"]).
 *   Defaults to the order the host's terminal-host service is
 *   currently running, then in-memory as the universal fallback.
 * @param {string} [options.homeDirOverride]    test-only seam for policy.resolveExecutable
 */
export function createExternalCliTerminalAdapter(options = {}) {
  if (!record(options)) throw new TypeError("createExternalCliTerminalAdapter: options object required");
  if (!identifier(options.sessionId)) throw fail("invalid-event");
  if (!record(options.terminalHostService)) throw new TypeError("createExternalCliTerminalAdapter: terminalHostService required");
  if (!record(options.terminalHostStart) || !options.terminalHostStart.bus) {
    throw new TypeError("createExternalCliTerminalAdapter: terminalHostStart with bus required");
  }
  if (typeof options.promptFilePath !== "function") {
    throw new TypeError("createExternalCliTerminalAdapter: promptFilePath must be a function");
  }
  if (options.preferredSurfaces !== undefined && !Array.isArray(options.preferredSurfaces)) {
    throw new TypeError("createExternalCliTerminalAdapter: preferredSurfaces must be an array of adapter ids");
  }

  // 1. Look up the reviewed policy. Manifests / callers cannot register
  //    a policy at runtime; the host's reviewed-policy set is the only
  //    source.
  const policy = getHarnessPolicy(options.policyId);
  if (!policy) {
    throw Object.assign(
      new Error(`harness policy not reviewed: ${options.policyId}`),
      { code: "invalid-manifest", detail: "policyId not in reviewed-policy registry" }
    );
  }

  // 2. Resolve harness↔terminal compatibility AT INVOKE TIME so an
  //    incompatible pairing yields a structured fail-closed error
  //    BEFORE any grant/token/launch work happens. The resolver
  //    takes a snapshot of the available surfaces now (so the
  //    adapter exposes its verdict in the construction-time shape
  //    for callers that want a synchronous answer), but the actual
  //    `invoke()` re-resolves to guarantee the fail-closed
  //    ordering: no `launchBootstrap` RPC, no grant minting, no
  //    token/auth file write on an incompatible verdict.
  const requestedRequirements = policy.terminalRequirements ?? [];
  const preferred = options.preferredSurfaces ?? [options.terminalHostStart.adapterId, "in-memory"];
  const initialVerdict = resolveHarnessTerminalCompatibility({
    requirements: requestedRequirements,
    descriptors: listTerminalSurfaceDescriptors(),
    preferred,
  });

  let closed = false;
  return {
    policyId: policy.policyId,
    harnessId: policy.harnessId,
    surfaceAdapterId: initialVerdict.surface?.adapterId ?? null,
    surfaceCapabilities: initialVerdict.surface ? [...initialVerdict.surface.capabilities] : [],
    policySupportsModelSelection: !!policy.supportsModelSelection,
    initialCompatibility: { compatible: initialVerdict.compatible, missingCapabilities: [...initialVerdict.missingCapabilities], provenanceFidelity: initialVerdict.provenanceFidelity },

    async probe() { return { available: !closed }; },

    async createSession({ signal } = {}) {
      if (closed) throw fail("runtime-unavailable");
      if (signal?.aborted) throw fail("cancelled");
      return { sessionId: options.sessionId, surface: initialVerdict.surface?.adapterId ?? null, policyId: policy.policyId };
    },

    async *invoke({ session, input, signal } = {}) {
      if (closed) throw fail("runtime-unavailable");
      // 0. XH3b: re-resolve harness↔terminal compatibility. The
      //    verdict is recomputed at invoke time so an incompatible
      //    pairing yields a structured fail-closed error BEFORE
      //    any of: grant minting, token/auth file write, or
      //    launchBootstrap RPC. No side effects on reject.
      const verdict = resolveHarnessTerminalCompatibility({
        requirements: requestedRequirements,
        descriptors: listTerminalSurfaceDescriptors(),
        preferred,
      });
      if (!verdict.compatible) {
        yield {
          type: "error",
          data: {
            code: "unsupported-terminal",
            message: `no terminal surface satisfies policy ${policy.policyId} requirements`,
            policyId: policy.policyId,
            requestedCapabilities: [...requestedRequirements],
            missingCapabilities: [...verdict.missingCapabilities],
            provenanceFidelity: verdict.provenanceFidelity,
          },
        };
        return;
      }
      const surface = verdict.surface;

      // 1. Pull the prompt from input.messages (last user message).
      const messages = Array.isArray(input?.messages) ? input.messages : [];
      const lastUser = [...messages].reverse().find((m) => record(m) && m.role === "user" && typeof m.content === "string");
      const prompt = lastUser?.content;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        yield { type: "error", data: publicHarnessError({ code: "invalid-event" }) };
        return;
      }

      // 2. Derive providerProfileId from input.model. Falls back to
      //    caller-supplied value (legacy seam) then to "openai".
      const modelStr = typeof input?.model === "string" ? input.model.trim() : "";
      let providerProfileId = options.providerProfileId ?? null;
      if (modelStr.includes("/")) {
        const [prefix] = modelStr.split("/", 1);
        if (prefix) providerProfileId = prefix;
      }
      if (!providerProfileId) {
        yield { type: "error", data: publicHarnessError({ code: "invalid-event" }) };
        return;
      }
      // The policy declares which provider families it supports; if
      // the requested profile is not in the policy's allowlist, the
      // host's projected-env path will fail-closed downstream. We
      // pre-check here for a clean error event.
      if (policy.credentialPolicy?.source === "provider-profile") {
        const supported = policy.credentialPolicy.supportedProviderFamilies ?? [];
        if (!supported.includes(providerProfileId)) {
          yield {
            type: "error",
            data: { code: "runtime-unavailable", message: `policy ${policy.policyId} does not support provider family ${providerProfileId}` },
          };
          return;
        }
      }

      // 3. Pre-resolve the credential via the host wiring (async seam).
      let resolveCredential = () => null;
      if (options.hostTerminal && typeof options.hostTerminal.resolveCredential === "function") {
        const pre = await options.hostTerminal.resolveCredential(providerProfileId);
        if (pre && typeof pre === "object" && typeof pre.name === "string" && typeof pre.value === "string") {
          resolveCredential = () => pre;
        }
      }

      // 4. Build the projected env. The host wiring already gates by
      //    the resolver; shared-* / unknown profiles fail closed here.
      let envResult;
      try {
        envResult = await buildProjectedSessionEnv({
          sessionId: options.sessionId,
          ...(options.harness ? { harness: options.harness } : {}),
          ...(options.project ? { project: options.project } : {}),
          ...(options.hostTerminal && typeof options.hostTerminal.resolveProjectIdentity === "function"
            ? {
                authorizedProject: await options.hostTerminal.resolveProjectIdentity({ root: options.project?.root ?? process.cwd() }),
              }
            : {}),
          ...(options.hostTerminal?.skillSourceRoot ? { skillSourceRoot: options.hostTerminal.skillSourceRoot } : {}),
          ...(options.hostTerminal?.stagingBase ? { stagingBase: options.hostTerminal.stagingBase } : {}),
          providerProfileId,
          resolveCredential,
          request: { requests: { project: ["read"], skills: ["list", "read"] } },
          grantedCapabilities: [
            { capability: "filesystem", granted: true },
            { capability: "agent-runtime", granted: true },
          ],
        });
      } catch {
        yield { type: "error", data: publicHarnessError({ code: "invalid-event" }) };
        return;
      }
      if (!envResult.ok) {
        yield { type: "error", data: publicHarnessError({ code: envResult.code ?? "invalid-event" }) };
        return;
      }

      // 5. Resolve the reviewed executable via the policy.
      const reviewed = policy.resolveExecutable({
        sessionId: options.sessionId,
        hostProjectRoot: options.project?.root ?? process.cwd(),
        ...(options.homeDirOverride ? { homeDirOverride: options.homeDirOverride } : {}),
      });
      if (!reviewed) {
        yield { type: "error", data: publicHarnessError({ code: "runtime-unavailable" }) };
        return;
      }

      // 6. Stage the prompt file when needed.
      const sessionId = options.sessionId;
      const promptFilePath = options.promptFilePath();
      const needsPromptFile = prompt.includes("\n") ||
        Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES;
      if (needsPromptFile) {
        await mkdir(dirname(promptFilePath), { recursive: true });
        await writeFile(promptFilePath, prompt, { mode: 0o600 });
        await chmod(promptFilePath, 0o600);
      }

      // 7. Compose the harness-side commandSuffix via the policy. The
      //    policy returns a reviewed invocation; we never re-shell-quote.
      let invocation;
      try {
        invocation = policy.composeInvocation({
          executable: reviewed,
          prompt,
          promptFilePath: needsPromptFile ? promptFilePath : null,
          credentialEnvVarName: envResult.credentialEnvVarName ?? null,
        });
      } catch {
        if (needsPromptFile) { try { await unlink(promptFilePath); } catch { /* already gone */ } }
        yield { type: "error", data: publicHarnessError({ code: "runtime-unavailable" }) };
        return;
      }

      // 8. Issue the launch — WITHOUT bootstrapCommand. The host owns
      //    the grant, the token file, the attach command, and the env.
      let launchResult;
      try {
        launchResult = await options.terminalHostService.launchBootstrap({
          sessionId,
          providerProfileId,
          ...(options.harness ? { harness: options.harness } : {}),
          ...(options.project ? { project: options.project } : {}),
          commandSuffix: invocation.commandSuffix,
        });
      } catch {
        if (needsPromptFile) { try { await unlink(promptFilePath); } catch { /* already gone */ } }
        yield { type: "error", data: publicHarnessError({ code: "runtime-unavailable" }) };
        return;
      }

      const terminalSessionId = launchResult?.sessionId ?? sessionId;

      // 9. Subscribe to the bus and translate terminal events to
      //    harness events. Same translation table as the Pi-specific
      //    adapter (CP-S5b / CP-S5F2).
      const bus = options.terminalBus ?? options.terminalHostStart.bus;
      const iterator = bus.subscribe()[Symbol.asyncIterator]();
      const controller = new AbortController();
      const turnSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

      try {
        yield {
          type: "delta",
          data: {
            text: "",
            terminalSessionId,
            policyId: policy.policyId,
            surfaceAdapterId: surface.adapterId,
          },
        };
        let finalEmitted = false;
        while (!finalEmitted) {
          if (turnSignal.aborted) {
            finalEmitted = true;
            yield { type: "cancelled", data: {} };
            break;
          }
          const next = await Promise.race([
            iterator.next(),
            new Promise((resolve) => {
              turnSignal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true });
            }),
          ]);
          if (!next || next.done) {
            finalEmitted = true;
            yield { type: "error", data: publicHarnessError({ code: "runtime-unavailable" }) };
            break;
          }
          const ev = next.value;
          if (!record(ev) || typeof ev.type !== "string") continue;
          if (ev.type === "terminal.command.started") {
            yield {
              type: "delta",
              data: { text: "", terminalSessionId, command: ev.data?.command },
            };
          } else if (ev.type === "terminal.command.ended") {
            const exitStatus = ev.data?.exitStatus;
            if (exitStatus === 0) {
              finalEmitted = true;
              yield {
                type: "final",
                data: {
                  text: `[harness ${policy.policyId} invoked in terminal session ${terminalSessionId}]`,
                  terminalSessionId,
                  exitStatus,
                },
              };
            } else {
              finalEmitted = true;
              yield {
                type: "error",
                data: {
                  code: "runtime-unavailable",
                  message: `harness exited with status ${exitStatus}`,
                  terminalSessionId,
                  exitStatus,
                },
              };
            }
          } else if (ev.type === "terminal.session.terminated") {
            finalEmitted = true;
            yield {
              type: "error",
              data: {
                code: "runtime-unavailable",
                message: "terminal session terminated before turn completed",
                terminalSessionId,
                exitStatus: ev.data?.exitStatus,
              },
            };
          }
        }
      } finally {
        controller.abort();
        if (needsPromptFile) {
          try { await unlink(promptFilePath); } catch { /* already gone */ }
        }
      }
    },

    async cancel({ session } = {}) {
      try { await options.terminalHostService.terminateSession({ sessionId: options.sessionId }); }
      catch { /* already gone */ }
    },

    async history({ session } = {}) { return { messages: [], hasMore: false }; },
    async status({ session } = {}) { return { status: "idle" }; },

    async selectModel({ session, input } = {}) {
      if (!policy.supportsModelSelection) {
        throw fail("unsupported-operation");
      }
      if (!record(input) || !identifier(input.provider) || !identifier(input.model)) throw fail("invalid-event");
      return { provider: input.provider, model: input.model };
    },

    async dispose({ session } = {}) {
      closed = true;
      try { await options.terminalHostService.terminateSession({ sessionId: options.sessionId }); }
      catch { /* best-effort */ }
    },
  };
}
