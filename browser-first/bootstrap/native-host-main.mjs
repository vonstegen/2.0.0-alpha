// CP-BR1: ResonantOS bridge bootstrap native-messaging host — entry point.
//
// Installed per-user by browser-first/bootstrap/install-macos.mjs as the
// Chrome native host `com.resonantos.bridge_bootstrap`. Chrome launches it
// when the extension calls `chrome.runtime.connectNative` (CP-BR2 wires the
// extension side; this host is independently callable today, with no bridge
// HTTP server running).
//
// Transport contract:
//   * stdin carries Chrome native-messaging frames; stdout carries framed
//     protocol responses ONLY. Nothing else may write stdout — console
//     methods are redirected to the bounded stderr logger at startup.
//   * Diagnostics go to stderr as bounded single-line JSON events. They
//     contain event codes, the closed operation/failure vocabularies, and
//     non-secret generation ids — never request payloads, environment,
//     tokens, paths, argv, or PIDs.
//   * The host answers every well-framed message, including malformed
//     envelopes (a framed "invalid-request" response). An oversized
//     declared frame is unrecoverable (the stream cannot resynchronize):
//     the host logs one event and exits nonzero.
//   * When the extension port closes (stdin end), the host exits without
//     touching the bridge child; the child is detached and outlives the
//     host by design. Ownership is in-process: a later host process treats
//     a surviving bridge as external (start → alreadyRunning; shutdown
//     leaves it untouched). See BRIDGE-BOOTSTRAP-PROTOCOL.md.

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { createBridgePolicy, policyProblems } from "./bridge-policy.mjs";
import { createBootstrapLifecycle } from "./bootstrap-lifecycle.mjs";
import {
  buildErrorResponse,
  buildSuccessResponse,
  validateBootstrapRequest,
} from "./bootstrap-protocol.mjs";
import { createFrameDecoder, createStdoutFramer } from "./native-framing.mjs";
import { ensureBridgeReachable } from "../host/bridge-bootstrap.mjs";

const STDERR_LINE_MAX = 400;

/** Bounded, redacted stderr diagnostics. Event codes and closed-vocabulary
 *  fields only; nothing caller-supplied is logged. */
export function createStderrLogger({ stderr, nowImpl = () => new Date() } = {}) {
  return (event, fields = {}) => {
    const safe = { event: String(event).slice(0, 64) };
    for (const key of ["operation", "failureCode", "status", "code", "generation"]) {
      const value = fields[key];
      if (typeof value === "string" && value.length <= 64) safe[key] = value;
      else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    }
    let line = JSON.stringify(safe);
    if (line.length > STDERR_LINE_MAX) line = `${line.slice(0, STDERR_LINE_MAX - 1)}…`;
    try {
      stderr.write(`${line}\n`);
    } catch {
      // stderr must never take the host down
    }
  };
}

/**
 * Wire the native host. All I/O and lifecycle dependencies are injectable
 * so tests drive the exact production path with fake streams, a fake
 * lifecycle, and a fake exit.
 *
 * @param {{
 *   stdin?: NodeJS.ReadStream | EventEmitter,
 *   stdout?: NodeJS.WriteStream,
 *   stderr?: NodeJS.WriteStream,
 *   lifecycle?: ReturnType<typeof createBootstrapLifecycle>,
 *   policy?: ReturnType<typeof createBridgePolicy>,
 *   exitImpl?: (code: number) => void,
 *   nowImpl?: () => Date,
 * }} [options]
 */
export function runBootstrapNativeHost({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  lifecycle,
  policy,
  exitImpl = (code) => process.exit(code),
  nowImpl,
} = {}) {
  const resolvedPolicy = policy ?? createBridgePolicy();
  const log = createStderrLogger({ stderr, nowImpl });

  // stdout purity: nothing but framed protocol messages may reach stdout.
  const framer = createStdoutFramer({
    stdout,
    onError: ({ code }) => log("bootstrap.framer_error", { code }),
  });

  const problems = policyProblems(resolvedPolicy);
  if (problems.length > 0) {
    log("bootstrap.policy_invalid", { code: problems[0] });
  }

  const ops = lifecycle ?? createBootstrapLifecycle({
    policy: resolvedPolicy,
    probe: ensureBridgeReachable,
    spawnImpl: spawn,
  });

  // Serialize request handling: one operation at a time, in arrival order.
  let handling = Promise.resolve();
  const handleMessage = (text) => {
    handling = handling.then(() => dispatch(text)).then(
      () => undefined,
      () => undefined,
    );
  };

  const dispatch = async (text) => {
    let decoded;
    let requestId = null;
    try {
      decoded = JSON.parse(text);
      if (decoded !== null && typeof decoded === "object" && !Array.isArray(decoded)
        && typeof decoded.requestId === "string") {
        requestId = decoded.requestId;
      }
    } catch {
      log("bootstrap.request_invalid", { code: "bad-json" });
      framer.send(buildErrorResponse({
        protocol: resolvedPolicy.protocol,
        requestId: null,
        failureCode: "invalid-request",
      }));
      return;
    }
    const validated = validateBootstrapRequest(decoded, { protocol: resolvedPolicy.protocol });
    if (!validated.ok) {
      log("bootstrap.request_invalid", { code: "bad-envelope" });
      framer.send(buildErrorResponse({
        protocol: resolvedPolicy.protocol,
        requestId: requestId, // known string, never echoed on parse failure
        failureCode: validated.failureCode,
      }));
      return;
    }
    const { request } = validated;
    log("bootstrap.request", { operation: request.operation });
    let result;
    try {
      switch (request.operation) {
        case "status":
          result = await ops.status();
          break;
        case "start":
          result = await ops.start();
          break;
        case "restart":
          result = await ops.restart();
          break;
        case "stopForShutdown":
          result = await ops.stopForShutdown();
          break;
        default:
          result = { ok: false, status: "failed", failureCode: "invalid-request" };
      }
    } catch {
      // The lifecycle converts all expected failures to results; a throw is
      // a host bug. Report the closed defensive code and keep serving.
      log("bootstrap.operation_error", { operation: request.operation, code: "internal-error" });
      framer.send(buildErrorResponse({
        protocol: resolvedPolicy.protocol,
        requestId: request.requestId,
        failureCode: "internal-error",
        result: { status: "failed" },
      }));
      return;
    }
    const failureCode = result && typeof result === "object" ? result.failureCode : undefined;
    log("bootstrap.response", {
      operation: request.operation,
      status: result && typeof result === "object" ? result.status : undefined,
      failureCode: typeof failureCode === "string" ? failureCode : undefined,
    });
    if (result && typeof result === "object" && result.ok === false) {
      framer.send(buildErrorResponse({
        protocol: resolvedPolicy.protocol,
        requestId: request.requestId,
        failureCode: typeof result.failureCode === "string" ? result.failureCode : "internal-error",
        result,
      }));
    } else {
      framer.send(buildSuccessResponse({
        protocol: resolvedPolicy.protocol,
        requestId: request.requestId,
        result,
      }));
    }
  };

  const decoder = createFrameDecoder({
    onFrame: handleMessage,
    onError: async ({ code }) => {
      log("bootstrap.frame_error", { code });
      await framer.flush();
      exitImpl(2);
    },
  });

  const shutdown = (code, reason) => {
    log("bootstrap.host_exit", { code: reason });
    // The owned bridge child is detached and unref'd: it persists after
    // this host exits. Ownership ends with the host process by design.
    handling.finally(() => exitImpl(code)).catch(() => exitImpl(code));
  };

  stdin.on("data", (chunk) => decoder.push(chunk));
  stdin.on("end", () => shutdown(0, "stdin-end"));
  stdin.on("error", () => shutdown(1, "stdin-error"));
  stdout.on?.("error", () => shutdown(1, "stdout-error"));

  log("bootstrap.host_started", {});
  return { framer, decoder, log };
}

/** Redirect console output away from stdout before any dependency can log
 *  onto the native channel. Idempotent. */
export function guardStdoutPurity({ stderr = process.stderr } = {}) {
  const write = (args) => {
    try {
      const line = args.map((value) => {
        if (typeof value === "string") return value;
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }).join(" ");
      stderr.write(`${line.slice(0, STDERR_LINE_MAX)}\n`);
    } catch {
      // best effort
    }
  };
  console.log = (...args) => write(args);
  console.info = (...args) => write(args);
  console.warn = (...args) => write(args);
  console.error = (...args) => write(args);
}

const isMain = (() => {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
})();

if (isMain) {
  guardStdoutPurity();
  process.on("uncaughtException", () => {
    try {
      process.stderr.write('{"event":"bootstrap.fatal","code":"uncaught"}\n');
    } catch { /* noop */ }
    process.exit(2);
  });
  process.on("unhandledRejection", () => {
    try {
      process.stderr.write('{"event":"bootstrap.fatal","code":"unhandled-rejection"}\n');
    } catch { /* noop */ }
  });
  runBootstrapNativeHost();
}
