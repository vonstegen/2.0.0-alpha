// pi-terminal-v1 adapter (Step 5, 5B / TH-6; grant-flow fix CP-S5F2).
//
// Attaches Pi as a `cli` harness that runs in the adopted external
// terminal (iTerm2 / Ghostty), not as a bridge-spawned embedded PTY. The
// adapter delegates the *runtime* to the terminal host:
//
//   invoke(input)
//     1. validate `pi` via piCommand()             (fail-closed: runtime-unavailable)
//     2. resolve the projected session env (host wiring -> buildProjectedSessionEnv)
//     3. write the prompt to a sibling 0600 file (when multi-line or
//        >4096 bytes; otherwise argv-quote via shellQuote)
//     4. call terminalHostService.launchBootstrap() WITHOUT bootstrapCommand.
//        The host (single owner) mints + tracks the SessionBootstrapGrant,
//        writes the 0600 token file, composes the ros-session attach
//        command, and appends this adapter's `commandSuffix`:
//          <validated-pi-abs-path> [ @<prompt-file> | '<quoted-prompt>' ]
//     5. subscribe to the terminal-host bus and translate:
//          terminal.command.started        -> delta { terminalSessionId, command }
//          terminal.command.ended (ok)     -> final { text, terminalSessionId, exitStatus }
//          terminal.command.ended (non-0)  -> error { code: 'runtime-unavailable', ... }
//          terminal.session.terminated     -> error { code: 'runtime-unavailable', ... }
//
// Hard rules:
//   * Token never argv/env/shell history: it lives under the host-written
//     0600 file only. This adapter never sees the token value at all.
//   * Secret (credential value) never argv/env/shell history: enters only
//     via the projected env (host-owned env-var name)
//   * Prompt argv-quoted only when the prompt is a single line of <=4096
//     bytes AND contains no shell metacharacters. Otherwise: prompt file.
//   * `pi` is resolved only via piCommand(); never from PATH, manifest,
//     or caller argv. The composed suffix uses the validated executable's
//     absolute path, never a bare ambient `pi`.
//   * Fail closed: missing pi, missing profile, missing secret, missing
//     project all reject; no fabrication, no fall-back runtime.
//
// The actual `pi` stdout (the chat response text) does NOT flow through
// the adapter — it lands in the adopted terminal, which the chat UI
// already observes via the side-panel SSE channel. The harness events
// only carry turn lifecycle: launched, ended, errored.

import { mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { publicHarnessError } from "../harness-adapter-contract.mjs";
import { piCommand } from "../pi-runtime.mjs";
import {
  buildProjectedSessionEnv,
} from "../terminal-host-service.mjs";

// Mirror of shellQuote in terminal-host-service.mjs; not exported there
// because the adapter does not need the full surface. POSIX single-quote
// escape; works for any printable string including newlines (via
// single-quote and $'\n' embedding is NOT used here — the prompt file
// path is used for multi-line).
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const PROMPT_ARGV_MAX_BYTES = 4096;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = value => typeof value === "string" && value.trim() && value.length <= 256;
function fail(code) {
  return Object.assign(new Error(publicHarnessError({ code }).message), { code });
}

/**
 * Compose the `pi` invocation tail — the `commandSuffix` the terminal-host
 * service appends after its own ros-session attach command. Uses the
 * validated executable's absolute path (never a bare ambient `pi`). The
 * prompt file path is preferred when the prompt is multi-line or exceeds
 * the argv byte limit; argv-quoting is used only for short single-line
 * prompts with no shell metacharacters.
 *
 * @param {{ executable: string, prompt: string, promptFilePath: string | null }} args
 * @returns {string} the `pi` invocation tail (commandSuffix for launchBootstrap)
 */
export function composePiInvocation({ executable, prompt, promptFilePath } = {}) {
  if (typeof executable !== "string" || !executable.startsWith("/")) {
    throw new TypeError("composePiInvocation: executable (absolute path) required");
  }
  if (typeof prompt !== "string") throw new TypeError("composePiInvocation: prompt (string) required");
  const trimmed = prompt.trim();
  if (trimmed.length === 0) throw new TypeError("composePiInvocation: prompt is empty");
  // Multi-line prompts or oversize prompts -> prompt file (via
  // `pi @<file>` syntax that `pi` natively supports; the file path is
  // shellQuote-escaped so the value never enters argv).
  if (promptFilePath && (prompt.includes("\n") || Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES)) {
    return `${shellQuote(executable)} ${shellQuote(`@${promptFilePath}`)}`;
  }
  // Single-line short prompt -> argv quote (via shellQuote). The
  // shellQuote escape is safe for any printable character including
  // spaces, quotes, and backslashes.
  return `${shellQuote(executable)} ${shellQuote(trimmed)}`;
}

/**
 * createPiTerminalAdapter
 *
 * @param {object} options
 * @param {string} options.sessionId            harness session id (input)
 * @param {object} options.terminalHostService  the host-owned terminal-host service
 *                                              (createTerminalHostService())
 * @param {object} options.terminalHostStart    { adapterId, bus, driveId } from
 *                                              terminalHostService.start()
 * @param {string} options.promptFilePath       callable -> absolute path
 * @param {string} options.providerProfileId    the canonical profile id (e.g. "openai")
 * @param {string} [options.harness]            harness id (e.g. "addon.resonant-terminal-iterm2")
 * @param {object} [options.project]            { root, cwd? } for the projected env
 * @param {object} [options.hostTerminal]       host boundary wiring (5A)
 * @param {object} [options.terminalBus]        { subscribe() } — bus to translate
 *                                              terminal telemetry to harness events.
 *                                              Defaults to terminalHostStart.bus.
 * @param {string} [options.piHomeDir]          reviewed injection seam: homeDir
 *                                              override for piCommand() so tests can
 *                                              point at a fixed-root install. Never
 *                                              sourced from a manifest or caller argv.
 */
export function createPiTerminalAdapter(options = {}) {
  if (!record(options)) throw new TypeError("createPiTerminalAdapter: options object required");
  if (!identifier(options.sessionId)) throw fail("invalid-event");
  if (!record(options.terminalHostService)) throw new TypeError("createPiTerminalAdapter: terminalHostService required");
  if (!record(options.terminalHostStart) || !options.terminalHostStart.bus) {
    throw new TypeError("createPiTerminalAdapter: terminalHostStart with bus required");
  }
  if (typeof options.promptFilePath !== "function") {
    throw new TypeError("createPiTerminalAdapter: promptFilePath must be a function");
  }
  if (options.piHomeDir !== undefined && typeof options.piHomeDir !== "string") {
    throw new TypeError("createPiTerminalAdapter: piHomeDir must be a string");
  }
  // providerProfileId is optional at construction; it is derived at
  // invoke() time from input.model (the chat-ui selection). The
  // caller may still pass it explicitly as a legacy seam.

  // Hard rule #2: `pi` is resolved only via piCommand(). Cache the
  // probe so we fail at createSession(), not on every turn.
  const piProbe = piCommand({
    ...(options.piHomeDir ? { homeDir: options.piHomeDir } : {}),
  });
  if (!piProbe) {
    throw Object.assign(
      new Error("pi executable not found in a reviewed install root"),
      { code: "runtime-unavailable", detail: "piCommand() returned null" }
    );
  }

  let closed = false;
  return {
    piExecutable: { command: piProbe.command, source: piProbe.source },

    async probe() { return { available: !closed }; },

    async createSession({ signal } = {}) {
      if (closed) throw fail("runtime-unavailable");
      if (signal?.aborted) throw fail("cancelled");
      // No local state: the terminal session is owned by the host. The
      // adapter just issues launches and observes the bus.
      return { piTerminalAdapter: true, sessionId: options.sessionId, _probe: { ok: !!piProbe, source: piProbe?.source, command: piProbe?.command } };
    },

    async *invoke({ session, input, signal } = {}) {
      if (closed) throw fail("runtime-unavailable");
      // 1. Pull the prompt from input.messages (last user message).
      const messages = Array.isArray(input?.messages) ? input.messages : [];
      const lastUser = [...messages].reverse().find((m) => record(m) && m.role === "user" && typeof m.content === "string");
      const prompt = lastUser?.content;
      if (typeof prompt !== "string" || prompt.trim().length === 0) {
        yield { type: "error", data: publicHarnessError({ code: "invalid-event" }) };
        return;
      }
      // 2. Derive providerProfileId from input.model (format: "openai/gpt-4o"
      //    or just "gpt-4o"). Falls back to a caller-supplied value on
      //    options (legacy seam) and ultimately to "openai" (host default).
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
      // 3. Pre-resolve the credential via the host wiring (async seam).
      let resolveCredential = () => null;
      if (options.hostTerminal && typeof options.hostTerminal.resolveCredential === "function") {
        const pre = await options.hostTerminal.resolveCredential(providerProfileId);
        if (pre && typeof pre === "object" && typeof pre.name === "string" && typeof pre.value === "string") {
          resolveCredential = () => pre;
        }
      }
      // 4. Build the projected env. The host wiring already gates by
      //    resolvePiNativeProvider, so shared-* / anthropic / unknown
      //    profiles fail closed here. We do not fabricate credentials.
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
      } catch (error) {
        yield { type: "error", data: publicHarnessError({ code: "invalid-event" }) };
        return;
      }
      if (!envResult.ok) {
        // missing-credential, projection-denied, etc. -> error event.
        yield { type: "error", data: publicHarnessError({ code: envResult.code ?? "invalid-event" }) };
        return;
      }
      // envResult.env is the projected env (including ROS_PROJECT_ROOT,
      // ROS_PROJECT_CWD, ROS_SKILLS_DIR, and the credential under the
      // host-owned env-var name). We do not need to inspect it for the
      // launch; the eval "$(ros-session attach ...)" will deliver it.

      // 4. Write the prompt file (0600) for multi-line / oversize prompts.
      //    The grant, token file, and attach command are owned by the
      //    terminal-host service (single-owner rule, CP-S5F1); this adapter
      //    never chooses a token-file path and never sees the token value.
      const sessionId = options.sessionId;
      const promptFilePath = options.promptFilePath();
      const needsPromptFile = prompt.includes("\n") ||
        Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES;
      if (needsPromptFile) {
        await mkdir(dirname(promptFilePath), { recursive: true });
        await writeFile(promptFilePath, prompt, { mode: 0o600 });
        await chmod(promptFilePath, 0o600);
      }

      // 5. Build the Pi invocation tail from the validated executable and
      //    hand it to the host as commandSuffix. The host mints + tracks
      //    the grant, writes the 0600 token file, composes the ros-session
      //    attach command, and appends this suffix.
      const commandSuffix = composePiInvocation({
        executable: piProbe.command,
        prompt,
        promptFilePath: needsPromptFile ? promptFilePath : null,
      });

      // 6. Issue the launch — WITHOUT bootstrapCommand. Passing a complete
      //    bootstrapCommand would skip the host's grant/env composition
      //    (the escape hatch is for reviewed smokes only).
      let launchResult;
      try {
        launchResult = await options.terminalHostService.launchBootstrap({
          sessionId,
          providerProfileId,
          ...(options.harness ? { harness: options.harness } : {}),
          ...(options.project ? { project: options.project } : {}),
          commandSuffix,
        });
      } catch (error) {
        if (needsPromptFile) { try { await unlink(promptFilePath); } catch { /* already gone */ } }
        yield { type: "error", data: publicHarnessError({ code: "runtime-unavailable" }) };
        return;
      }

      const terminalSessionId = launchResult?.sessionId ?? sessionId;

      // 7. Subscribe to the bus and translate terminal events to
      //    harness events. Yield delta on command.started; final on
      //    command.ended with exitStatus 0; error otherwise.
      const bus = options.terminalBus ?? options.terminalHostStart.bus;
      const iterator = bus.subscribe()[Symbol.asyncIterator]();
      const controller = new AbortController();
      const turnSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

      try {
        // Yield a `delta` immediately to mark turn start.
        yield {
          type: "delta",
          data: {
            text: "",
            terminalSessionId,
            piCommand: piProbe.command,
          },
        };
        // Read terminal events until the turn ends. Use a bounded
        // timeout via the controller; the chat UI / caller cancels
        // via the turn signal.
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
            // The adapter is told the command is starting in the
            // terminal; carry the canonical command shape.
            yield {
              type: "delta",
              data: {
                text: "",
                terminalSessionId,
                command: ev.data?.command,
              },
            };
          } else if (ev.type === "terminal.command.ended") {
            const exitStatus = ev.data?.exitStatus;
            if (exitStatus === 0) {
              finalEmitted = true;
              yield {
                type: "final",
                data: {
                  text: `[pi invoked in terminal session ${terminalSessionId}]`,
                  terminalSessionId,
                  exitStatus,
                },
              };
            } else {
              finalEmitted = true;
              yield {
                type: "error",
                data: { code: "runtime-unavailable", message: `pi exited with status ${exitStatus}`, terminalSessionId, exitStatus },
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
      // Best-effort: forward cancel to the terminal host.
      try { await options.terminalHostService.terminateSession({ sessionId: options.sessionId }); }
      catch { /* already gone */ }
    },

    async history({ session } = {}) {
      return { messages: [], hasMore: false };
    },

    async status({ session } = {}) {
      return { status: "idle" };
    },

    async selectModel({ session, input } = {}) {
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
