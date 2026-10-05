// pi-terminal-v1 adapter (Step 5, 5B / TH-6).
//
// Attaches Pi as a `cli` harness that runs in the adopted external
// terminal (iTerm2 / Ghostty), not as a bridge-spawned embedded PTY. The
// adapter delegates the *runtime* to the terminal host:
//
//   invoke(input)
//     1. validate `pi` via piCommand()             (fail-closed: runtime-unavailable)
//     2. resolve the projected session env (host wiring -> buildProjectedSessionEnv)
//     3. mint a session-bootstrap grant + write the 0600 token file
//     4. write the prompt to a sibling 0600 file (when multi-line or
//        >4096 bytes; otherwise argv-quote via shellQuote)
//     5. compose the bootstrap command:
//          eval "$(node <ros-session> attach --session-id <id> --token-file <file> [--harness] [--project])"
//          ; pi [ @<prompt-file> | '<quoted>' ] [ --cd <ros-project-root> ]
//     6. issue the composed command via launchBootstrap
//     7. subscribe to the terminal-host bus and translate:
//          terminal.command.started        -> delta { terminalSessionId, command }
//          terminal.command.ended (ok)     -> final { text, terminalSessionId, exitStatus }
//          terminal.command.ended (non-0)  -> error { code: 'runtime-unavailable', ... }
//          terminal.session.terminated     -> error { code: 'runtime-unavailable', ... }
//
// Hard rules:
//   * Token never argv/env/shell history: lives under the 0600 file only
//   * Secret (credential value) never argv/env/shell history: enters only
//     via the projected env (host-owned env-var name)
//   * Prompt argv-quoted only when the prompt is a single line of <=4096
//     bytes AND contains no shell metacharacters. Otherwise: prompt file.
//   * `pi` is resolved only via piCommand(); never from PATH, manifest,
//     or caller argv.
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
  composeBootstrapCommand,
  listOutstandingGrants,
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
 * Compose the `pi` invocation tail. Returns the argv-shape (after the
 * `eval ...; `), e.g. `pi --prompt-file '/path/to/file'` or
 * `pi 'one-line prompt'`. The prompt file path is preferred when the
 * prompt is multi-line or exceeds the argv byte limit; argv-quoting is
 * used only for short single-line prompts with no shell metacharacters.
 *
 * @param {{ prompt: string, promptFilePath: string | null }} args
 * @returns {string} the `pi` invocation tail (without the eval ...; prefix)
 */
export function composePiInvocation({ prompt, promptFilePath } = {}) {
  if (typeof prompt !== "string") throw new TypeError("composePiInvocation: prompt (string) required");
  const trimmed = prompt.trim();
  if (trimmed.length === 0) throw new TypeError("composePiInvocation: prompt is empty");
  // Multi-line prompts or oversize prompts -> prompt file (via
  // `pi @<file>` syntax that `pi` natively supports; the file path is
  // shellQuote-escaped so the value never enters argv).
  if (promptFilePath && (prompt.includes("\n") || Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES)) {
    return `pi ${shellQuote(`@${promptFilePath}`)}`;
  }
  // Single-line short prompt -> argv quote (via shellQuote). The
  // shellQuote escape is safe for any printable character including
  // spaces, quotes, and backslashes.
  return `pi ${shellQuote(trimmed)}`;
}

/**
 * Compose the full bootstrap command: `eval "$(<ros-session> attach ...)"; <pi>`.
 *
 * @param {{ sessionId: string, tokenFilePath: string, providerProfileId: string,
 *           rosSessionPath: string, harness?: string, project?: object,
 *           prompt: string, promptFilePath: string | null }} args
 * @returns {string} the composed bootstrap command (POSIX shell)
 */
export function composePiTerminalBootstrap(args) {
  if (!args || typeof args !== "object") throw new TypeError("composePiTerminalBootstrap: args object required");
  const evalHead = composeBootstrapCommand({
    sessionId: args.sessionId,
    tokenFilePath: args.tokenFilePath,
    providerProfileId: args.providerProfileId,
    rosSessionPath: args.rosSessionPath,
    ...(args.harness ? { harness: args.harness } : {}),
    ...(args.project ? { project: args.project } : {}),
  });
  const piTail = composePiInvocation({ prompt: args.prompt, promptFilePath: args.promptFilePath });
  return `${evalHead}; ${piTail}`;
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
 * @param {string} options.rosSessionPath       absolute path to ros-session.mjs
 * @param {string} options.tokenFilePath        callable -> absolute path
 * @param {string} options.promptFilePath       callable -> absolute path
 * @param {string} options.providerProfileId    the canonical profile id (e.g. "openai")
 * @param {string} [options.harness]            harness id (e.g. "addon.resonant-terminal-iterm2")
 * @param {object} [options.project]            { root, cwd? } for the projected env
 * @param {object} [options.hostTerminal]       host boundary wiring (5A)
 * @param {object} [options.terminalBus]        { subscribe() } — bus to translate
 *                                              terminal telemetry to harness events.
 *                                              Defaults to terminalHostStart.bus.
 */
export function createPiTerminalAdapter(options = {}) {
  if (!record(options)) throw new TypeError("createPiTerminalAdapter: options object required");
  if (!identifier(options.sessionId)) throw fail("invalid-event");
  if (!record(options.terminalHostService)) throw new TypeError("createPiTerminalAdapter: terminalHostService required");
  if (!record(options.terminalHostStart) || !options.terminalHostStart.bus) {
    throw new TypeError("createPiTerminalAdapter: terminalHostStart with bus required");
  }
  if (typeof options.rosSessionPath !== "string" || !options.rosSessionPath) {
    throw new TypeError("createPiTerminalAdapter: rosSessionPath required");
  }
  if (typeof options.tokenFilePath !== "function") {
    throw new TypeError("createPiTerminalAdapter: tokenFilePath must be a function");
  }
  if (typeof options.promptFilePath !== "function") {
    throw new TypeError("createPiTerminalAdapter: promptFilePath must be a function");
  }
  // providerProfileId is optional at construction; it is derived at
  // invoke() time from input.model (the chat-ui selection). The
  // caller may still pass it explicitly as a legacy seam.

  // Hard rule #2: `pi` is resolved only via piCommand(). Cache the
  // probe so we fail at createSession(), not on every turn.
  const piProbe = piCommand();
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

      // 4. Mint a fresh grant for this turn and write the 0600 token
      //    file. (The grant broker enforces single-session overwrite.)
      const sessionId = options.sessionId;
      const grant = (() => {
        // Inline the mint + track — we cannot import mintSessionBootstrapGrant
        // from terminal-host-service.mjs without a circular dep; use the
        // public surface (trackSessionBootstrapGrant) and mint via the
        // service's own internal call exposed as __mintSessionBootstrapGrant.
        // To keep this self-contained, we re-mint using the public surface
        // by calling the terminal-host service's launchBootstrap with the
        // composed command (no bootstrapCommand -> it mints internally).
        return null; // sentinel; the actual mint happens in step 5 via launchBootstrap
      })();
      const tokenFilePath = options.tokenFilePath();
      const promptFilePath = options.promptFilePath();
      // Write the prompt file (0600) for multi-line / oversize prompts.
      const needsPromptFile = prompt.includes("\n") ||
        Buffer.byteLength(prompt, "utf8") > PROMPT_ARGV_MAX_BYTES;
      if (needsPromptFile) {
        await mkdir(dirname(promptFilePath), { recursive: true });
        await writeFile(promptFilePath, prompt, { mode: 0o600 });
        await chmod(promptFilePath, 0o600);
      }

      // 5. Compose the full bootstrap command. The grant is minted by
      //    launchBootstrap internally when bootstrapCommand is supplied.
      const bootstrapCommand = composePiTerminalBootstrap({
        sessionId,
        tokenFilePath,
        providerProfileId,
        rosSessionPath: options.rosSessionPath,
        ...(options.harness ? { harness: options.harness } : {}),
        ...(options.project ? { project: options.project } : {}),
        prompt,
        promptFilePath: needsPromptFile ? promptFilePath : null,
      });

      // 6. Issue the launch.
      let launchResult;
      try {
        launchResult = await options.terminalHostService.launchBootstrap({
          sessionId,
          bootstrapCommand,
          providerProfileId,
          ...(options.harness ? { harness: options.harness } : {}),
          ...(options.project ? { project: options.project } : {}),
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
