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
//     [--base-url http://127.0.0.1:<port>] [--auth-file <path>] \
//     [--error-file <path>]
//
// Auth file (CP-S5H3): a 0600 JSON file carrying the non-URL secrets the
// CLI needs for the authenticated loopback route:
//   { "baseUrl": "http://127.0.0.1:<port>",
//     "bridgeToken": "...", "controlCapabilityToken": "..." }
// Only its PATH ever appears in argv; the file is read-then-unlinked with
// the same discipline as the token file. An explicit --base-url flag wins
// over the auth file; the env defaults apply when neither is present.
//
// Error file: on failure the CLI writes the structured
// { event: "ros-session.error", reason } payload to this 0600 file (in
// addition to stderr) so a composing host can report the exact failure
// layer without scraping terminal output. Reasons never carry secrets.
//
// Output: lines of the form
//   export NAME='value'
// where NAME excludes the internal `_meta` key. The shell sources these.
//
// Failures emit a structured JSON error to stderr and exit non-zero.
// The secret value (if any) is never echoed.

import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
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
 * Read the 0600 auth file carrying the loopback route's base URL and
 * bridge/capability tokens. Same read-then-rename-then-unlink discipline
 * as readTokenFile: the secrets never ride argv/env/shell history, and the
 * file is consumed on read.
 *
 * Returns only well-formed string fields; the file content is never echoed
 * in thrown errors.
 *
 * @param {string} path
 * @returns {Promise<{ baseUrl?: string, bridgeToken?: string, controlCapabilityToken?: string }>}
 */
export async function readAuthFile(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw Object.assign(new Error("auth file is unreadable"), { code: "AUTH_FILE_UNREADABLE" });
  }
  try {
    await rename(path, `${path}.consumed`);
    await unlink(`${path}.consumed`).catch(() => {});
  } catch {
    // best-effort; the caller may have already unlinked it
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("auth file is not valid JSON"), { code: "AUTH_FILE_MALFORMED" });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("auth file must contain a JSON object"), { code: "AUTH_FILE_MALFORMED" });
  }
  const out = {};
  if (typeof parsed.baseUrl === "string" && parsed.baseUrl) out.baseUrl = parsed.baseUrl;
  if (typeof parsed.bridgeToken === "string" && parsed.bridgeToken) out.bridgeToken = parsed.bridgeToken;
  if (typeof parsed.controlCapabilityToken === "string" && parsed.controlCapabilityToken) out.controlCapabilityToken = parsed.controlCapabilityToken;
  return out;
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
 * @param {(url: string, init: object) => Promise<Response>} [args.fetcher]
 *        Injection for tests. Native `fetch(url, init)` semantics: the
 *        resolved value must expose the standard `Response` contract
 *        (`status`, `json()`). Defaults to globalThis.fetch.
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
    // A project-scoped attach needs the host's projection path (the bare
    // attachSessionEnv path carries only the credential). Mirror the
    // pi-terminal-v1 adapter's authority basis: the SessionBootstrapGrant
    // in the POST body is the audience-bound, single-use authority the
    // host minted for exactly this session.
    ...(project
      ? {
          request: { requests: { project: ["read"], skills: ["list", "read"] } },
          grantedCapabilities: [
            { capability: "filesystem", granted: true },
            { capability: "agent-runtime", granted: true },
          ],
        }
      : {}),
  };

  let response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-token": bridgeToken,
        "x-resonantos-bridge-capability-token": controlCapabilityToken,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, reason: "bridge-unreachable" };
  }

  const status = typeof response?.status === "number" ? response.status : 0;
  if (status !== 200) {
    return { ok: false, reason: `http-${status}` };
  }
  let parsedBody;
  try {
    parsedBody = await response.json();
  } catch {
    // Malformed/non-JSON body: fail closed without echoing the payload.
    return { ok: false, reason: "invalid-response" };
  }
  if (parsedBody?.ok === true) {
    return { ok: true, exports: formatExports(parsedBody.env ?? {}) };
  }
  return { ok: false, reason: typeof parsedBody?.reason === "string" ? parsedBody.reason : "unknown" };
}

// ---- main ----

function emitError(payload) {
  process.stderr.write(JSON.stringify({ event: "ros-session.error", ...payload }) + "\n");
}

// Best-effort structured failure capture for the composing host (CP-S5H3).
// The reason vocabulary is public and never carries token/credential values.
async function writeErrorFile(path, payload) {
  try {
    await writeFile(path, JSON.stringify({ event: "ros-session.error", ...payload }) + "\n", { mode: 0o600 });
  } catch {
    // diagnostics must never mask the primary failure
  }
}

async function main() {
  // Subcommand is positional and parseArgs v22.13 only accepts a boolean
  // for allowPositionals. Detect "attach" from the raw argv (after the
  // script path) and feed only the flags to parseArgs.
  const scriptArgs = process.argv.slice(2);
  const subcommand = scriptArgs[0];
  if (subcommand !== "attach") {
    emitError({ reason: "unknown-subcommand", subcommand });
    process.exit(2);
  }
  const flagArgs = scriptArgs.slice(1);

  let parsed;
  try {
    parsed = parseArgs({
      args: flagArgs,
      options: {
        "session-id": { type: "string" },
        "token-file": { type: "string" },
        "provider-profile-id": { type: "string" },
        harness: { type: "string" },
        project: { type: "string" },
        "base-url": { type: "string" },
        "auth-file": { type: "string" },
        "error-file": { type: "string" },
      },
      strict: true,
    });
  } catch (error) {
    emitError({ reason: "parsing-malformed", message: String(error?.message ?? error) });
    process.exit(2);
  }

  const opts = parsed.values;
  const errorFile = typeof opts["error-file"] === "string" && opts["error-file"] ? opts["error-file"] : null;
  const fail = async (reason, extra = {}) => {
    emitError({ reason, ...extra });
    if (errorFile) await writeErrorFile(errorFile, { reason });
    process.exit(1);
  };

  // Auth file first: if it is unreadable/malformed we fail BEFORE the token
  // file is consumed, so no half-consumed attach state is left behind.
  let auth = null;
  if (typeof opts["auth-file"] === "string" && opts["auth-file"]) {
    try {
      auth = await readAuthFile(opts["auth-file"]);
    } catch (error) {
      await fail(error?.code === "AUTH_FILE_MALFORMED" ? "auth-file-malformed" : "auth-file-unreadable");
      return; // unreachable; fail() exits
    }
  }

  const result = await attach({
    sessionId: opts["session-id"],
    tokenFile: opts["token-file"],
    providerProfileId: opts["provider-profile-id"],
    ...(opts.harness ? { harness: opts.harness } : {}),
    ...(opts.project ? { project: JSON.parse(opts.project) } : {}),
    // Precedence: explicit --base-url flag > auth file > env/default.
    ...(opts["base-url"] ? { baseUrl: opts["base-url"] } : auth?.baseUrl ? { baseUrl: auth.baseUrl } : {}),
    ...(auth?.bridgeToken ? { bridgeToken: auth.bridgeToken } : {}),
    ...(auth?.controlCapabilityToken ? { controlCapabilityToken: auth.controlCapabilityToken } : {}),
  });

  if (!result.ok) {
    await fail(result.reason);
    return; // unreachable
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