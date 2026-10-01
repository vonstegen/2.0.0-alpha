// Bounded native-Pi process launcher (P2). Spawns ONLY the executable the
// reviewed piCommand() allowlist returned, under the private session-environment
// plan built by pi-native-credential-adapter.mjs. Headless via Pi's `--print`;
// ephemeral via `--no-session`.
//
// Hard invariants:
//   * argv is exactly [--print, --no-session, ...plan.argv, prompt] — the
//     provider/model flags come from the reviewed plan, the prompt is the single
//     non-secret proof message, and `--api-key` is never used.
//   * env is the plan's private session environment (base + allowlist + the
//     host-owned credential var); no blanket process.env inheritance.
//   * shell is never enabled; the command and args are passed as an array.
//   * stdout/stderr are bounded, the credential is stripped from any captured
//     text before it is returned, and the timeout path is deterministic
//     (SIGTERM, then SIGKILL).
//
// No manifest command, caller argv, or arbitrary executable is ever accepted:
// the command comes only from plan.executable.command.
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_STDOUT_BYTES = 64 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 16 * 1024;
const KILL_GRACE_MS = 2_000;
const MAX_PROMPT_BYTES = 65_536;

const fail = (code) => Object.assign(new Error(`Pi launch rejected: ${code}`), { code });

// Redact a set of forbidden strings (longest first) from text output.
export function redactPiText(value, forbidden = []) {
  let text = String(value ?? "");
  for (const pattern of [...forbidden]
    .filter((entry) => typeof entry === "string" && entry)
    .sort((a, b) => b.length - a.length)) {
    text = text.split(pattern).join("[redacted]");
  }
  return text;
}

// The credential value (and its base64/base64url encodings) is the only thing
// that must never escape captured output. Everything else is safe evidence.
function forbiddenFor(plan) {
  const credentialName = typeof plan?.envVar === "string" ? plan.envVar : "";
  const credential = plan?.env?.[credentialName];
  if (typeof credential !== "string" || !credential) return [];
  return [
    credential,
    Buffer.from(credential).toString("base64"),
    Buffer.from(credential).toString("base64url"),
  ].filter(Boolean);
}

function validatePlan(plan) {
  if (!plan || typeof plan !== "object") throw fail("invalid-plan");
  const command = plan.executable?.command;
  if (typeof command !== "string" || !command) throw fail("invalid-plan");
  const argv = plan.argv ?? [];
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== "string"))
    throw fail("invalid-plan");
  if (argv.includes("--api-key")) throw fail("invalid-plan");
  if (typeof plan.projectPath !== "string" || !plan.projectPath) throw fail("invalid-plan");
  const env = plan.env ?? {};
  if (
    env === null ||
    typeof env !== "object" ||
    Array.isArray(env) ||
    Object.entries(env).some(([key, value]) => typeof key !== "string" || typeof value !== "string")
  ) {
    throw fail("invalid-plan");
  }
  return { command, argv, projectPath: plan.projectPath, env };
}

export function createPiProcessLauncher({
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdoutBytes = DEFAULT_MAX_STDOUT_BYTES,
  maxStderrBytes = DEFAULT_MAX_STDERR_BYTES,
  killGraceMs = KILL_GRACE_MS,
  now = () => Date.now(),
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new TypeError("Bounded launch timeout required.");
  if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1)
    throw new TypeError("Bounded stdout required.");
  if (!Number.isSafeInteger(maxStderrBytes) || maxStderrBytes < 1)
    throw new TypeError("Bounded stderr required.");
  if (!Number.isSafeInteger(killGraceMs) || killGraceMs < 1)
    throw new TypeError("Bounded kill grace required.");

  return {
    // plan is the private launch material; prompt is the non-secret proof
    // message. Resolves with sanitized evidence only (never the credential).
    // An optional AbortSignal triggers the same deterministic SIGTERM→SIGKILL
    // path as the timeout; the evidence records aborted: true in that case.
    launch(plan, { prompt, signal } = {}) {
      if (signal !== undefined && (signal === null || typeof signal !== "object" ||
          typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
        return Promise.reject(new TypeError("A valid AbortSignal is required."));
      }
      let command, argv, projectPath, env, forbidden, args;
      try {
        ({ command, argv, projectPath, env } = validatePlan(plan));
        const message = String(prompt ?? "").trim();
        if (!message) throw fail("invalid-plan");
        if (Buffer.byteLength(message) > MAX_PROMPT_BYTES) throw fail("invalid-plan");
        forbidden = forbiddenFor(plan);
        args = ["--print", "--no-session", ...argv, message];
      } catch (error) {
        return Promise.reject(error);
      }

      return new Promise((resolve) => {
        const startedAt = now();
        let settled = false;
        let timedOut = false;
        let aborted = false;
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let child;
        let killTimer;
        let forceTimer;

        const finish = (extra = {}) => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          clearTimeout(forceTimer);
          signal?.removeEventListener("abort", onAbort);
          resolve({
            exitCode: extra.exitCode ?? null,
            signal: extra.signal ?? null,
            timedOut,
            aborted,
            spawnError: extra.spawnError ?? null,
            durationMs: now() - startedAt,
            stdout: redactPiText(stdout.toString("utf8"), forbidden),
            stderr: redactPiText(stderr.toString("utf8"), forbidden),
            stdoutTruncated,
            stderrTruncated,
          });
        };

        const kill = () => {
          if (settled) return;
          try {
            child?.kill("SIGTERM");
          } catch {
            /* already exited */
          }
          forceTimer = setTimeout(() => {
            if (settled) return;
            try {
              child?.kill("SIGKILL");
            } catch {
              /* already exited */
            }
          }, killGraceMs);
          forceTimer.unref?.();
        };

        const onAbort = () => {
          if (settled) return;
          aborted = true;
          kill();
        };

        const append = (buffer, chunk, limit) => {
          const remaining = limit - buffer.length;
          if (remaining <= 0) return { buffer, truncated: true };
          if (chunk.length > remaining) {
            return {
              buffer: Buffer.concat([buffer, chunk.subarray(0, remaining)]),
              truncated: true,
            };
          }
          return { buffer: Buffer.concat([buffer, chunk]), truncated: false };
        };

        try {
          child = spawnImpl(command, args, {
            cwd: projectPath,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
          });
        } catch (error) {
          finish({ spawnError: error instanceof Error ? error.message : String(error) });
          return;
        }

        child.once("error", (error) => {
          finish({ spawnError: error instanceof Error ? error.message : String(error) });
        });
        child.once("exit", (code, signal) => {
          finish({ exitCode: code, signal: signal ?? null });
        });

        if (child.stdout) {
          child.stdout.on("data", (chunk) => {
            const next = append(stdout, chunk, maxStdoutBytes);
            stdout = next.buffer;
            stdoutTruncated = stdoutTruncated || next.truncated;
          });
        }
        if (child.stderr) {
          child.stderr.on("data", (chunk) => {
            const next = append(stderr, chunk, maxStderrBytes);
            stderr = next.buffer;
            stderrTruncated = stderrTruncated || next.truncated;
          });
        }

        // A pre-aborted signal takes the deterministic kill path immediately,
        // matching the timeout discipline (SIGTERM, then SIGKILL).
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });

        killTimer = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          kill();
        }, timeoutMs);
        killTimer.unref?.();
      });
    },
    redact: redactPiText,
  };
}
