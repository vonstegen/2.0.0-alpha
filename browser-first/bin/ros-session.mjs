#!/usr/bin/env node
// ros-session — terminal-host bootstrap CLI (alpha; CP-S3c).
//
// Emits the projected session environment for a SessionBootstrapGrant
// the caller minted via mintSessionBootstrapGrant. The shell can source
// the output and inherit a secret under the host-owned credential env-var
// name.
//
// Token delivery (option (a) from the step-3 design decision):
//   * caller writes the grant token to a 0600 file
//   * passes the file path via --token-file
//   * CLI reads it, sends it in the POST body, then unlinks the file
//     (best-effort). The token never appears in argv, env, shell history,
//     or stdout/stderr.
//
// Usage:
//   ros-session attach \
//     --session-id <id> \
//     --token-file <path> \
//     --provider-profile-id <openai|openrouter|xai|deepseek|minimax|zai> \
//     [--harness <addon-id>] [--project <json-string>] \
//     [--base-url http://127.0.0.1:<port>]
//
// Output: lines of the form
//   export NAME='value'
// where NAME excludes the internal `_meta` key. The shell sources these.
//
// Failures emit a structured JSON error to stderr and exit non-zero.
// The secret value (if any) is never echoed.

import { chmod, readFile, rename, unlink } from "node:fs/promises";
import { parseArgs } from "node:util";

/**
 * Read the grant token from a 0600 file.
 *
 * Defensive: read-then-rename-then-unlink avoids a TOCTOU where a hostile
 * process swaps the file between read and unlink. The token is trimmed
 * to remove any trailing newline the caller may have appended.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function readTokenFile(path) {
  const raw = await readFile(path, "utf8");
  // Atomically move the file out of the original path so a second read
  // would fail. Then unlink. If the move fails, the caller still has the
  // content and we proceed.
  try {
    await rename(path, `${path}.consumed`);
    await unlink(`${path}.consumed`).catch(() => {});
  } catch {
    // best-effort; the caller may have already unlinked it
  }
  const trimmed = raw.replace(/[\r\n]+$/, "").trim();
  if (!trimmed) {
    throw Object.assign(new Error("token file is empty"), { code: "EMPTY_TOKEN" });
  }
  return trimmed;
}

/**
 * Format the projected env as `export NAME='value'` lines.
 *
 * Excludes the internal `_meta` key. Single-quotes the value and escapes
 * any embedded single quotes (POSIX shell escaping rule).
 *
 * @param {Record<string, string>} env
 * @returns {string}
 */
export function formatExports(env) {
  const lines = [];
  for (const [name, value] of Object.entries(env)) {
    if (name === "_meta") continue;
    const escaped = String(value).replace(/'/g, `'\\''`);
    lines.push(`export ${name}='${escaped}'`);
  }
  return lines.join("\n") + (lines.length > 0 ? "\n" : "");
}

/**
 * Attach a session: read token, POST to the loopback bridge, format the
 * projected env. Returns `{ ok: true, exports }` or
 * `{ ok: false, reason }`. The secret value is never echoed in any
 * returned field unless it is the projected env (which is the contract).
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.tokenFile
 * @param {string} args.providerProfileId
 * @param {string} [args.harness]
 * @param {string} [args.project]
 * @param {string} [args.baseUrl]    default: http://127.0.0.1:<from-env or 47773>
 * @param {string} [args.bridgeToken]
 * @param {string} [args.controlCapabilityToken]
 * @param {(input: { url: string, init: object }) => Promise<{ status: number, body: object }>} [args.fetcher]
 *        Injection for tests. Defaults to globalThis.fetch.
 */
export async function attach(args) {
  const {
    sessionId,
    tokenFile,
    providerProfileId,
    harness,
    project,
    baseUrl = process.env.ROS_BRIDGE_BASE_URL ?? "http://127.0.0.1:47773",
    bridgeToken = process.env.ROS_BRIDGE_TOKEN ?? "",
    controlCapabilityToken = process.env.ROS_BRIDGE_CONTROL_CAPABILITY ?? "",
    fetcher = globalThis.fetch,
  } = args;

  if (typeof sessionId !== "string" || !sessionId) return { ok: false, reason: "missing-session-id" };
  if (typeof tokenFile !== "string" || !tokenFile) return { ok: false, reason: "missing-token-file" };
  if (typeof providerProfileId !== "string" || !providerProfileId) return { ok: false, reason: "missing-provider-profile-id" };
  if (typeof fetcher !== "function") return { ok: false, reason: "no-fetcher" };

  let token;
  try {
    token = await readTokenFile(tokenFile);
  } catch (error) {
    return { ok: false, reason: "token-file-unreadable" };
  }
  if (!token) return { ok: false, reason: "empty-token" };

  const url = `${baseUrl.replace(/\/$/, "")}/terminal-host/session/attach`;
  const body = {
    sessionId,
    token,
    providerProfileId,
    ...(harness ? { harness } : {}),
    ...(project ? { project } : {}),
  };

  let response;
  try {
    response = await fetcher({
      url,
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-resonantos-bridge-token": bridgeToken,
          "x-resonantos-bridge-capability-token": controlCapabilityToken,
          host: new URL(baseUrl).host,
        },
        body: JSON.stringify(body),
      },
    });
  } catch (error) {
    return { ok: false, reason: "bridge-unreachable" };
  }

  if (response.status !== 200) {
    return { ok: false, reason: `http-${response.status}` };
  }
  if (response.body?.ok === true) {
    return { ok: true, exports: formatExports(response.body.env ?? {}) };
  }
  return { ok: false, reason: response.body?.reason ?? "unknown" };
}

// ---- main ----

function emitError(payload) {
  process.stderr.write(JSON.stringify({ event: "ros-session.error", ...payload }) + "\n");
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        "session-id": { type: "string" },
        "token-file": { type: "string" },
        "provider-profile-id": { type: "string" },
        harness: { type: "string" },
        project: { type: "string" },
        "base-url": { type: "string" },
      },
      allowPositionals: ["attach"],
    });
  } catch (error) {
    emitError({ reason: "parsing-malformed", message: String(error?.message ?? error) });
    process.exit(2);
  }

  const subcommand = parsed.positionals[0];
  if (subcommand !== "attach") {
    emitError({ reason: "unknown-subcommand", subcommand });
    process.exit(2);
  }

  const opts = parsed.values;
  const result = await attach({
    sessionId: opts["session-id"],
    tokenFile: opts["token-file"],
    providerProfileId: opts["provider-profile-id"],
    ...(opts.harness ? { harness: opts.harness } : {}),
    ...(opts.project ? { project: JSON.parse(opts.project) } : {}),
    ...(opts["base-url"] ? { baseUrl: opts["base-url"] } : {}),
  });

  if (!result.ok) {
    emitError({ reason: result.reason });
    process.exit(1);
  }
  process.stdout.write(result.exports);
}

const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false;
    const url = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((error) => {
    emitError({ reason: "unhandled", message: String(error?.message ?? error) });
    process.exit(1);
  });
}