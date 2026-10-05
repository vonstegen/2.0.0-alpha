// Resonant Ghostty terminal host adapter (Phase 5 / TH-7c).
//
// The bridge spawns this Node script as a stdio JSON-RPC peer and
// forwards the 4 adapter ops (createSession, launchBootstrap,
// sendInput, terminateSession) over JSON-RPC 2.0. We speak to the
// running Ghostty instance via the AppleScript dictionary shipped
// inside /Applications/Ghostty.app/Contents/Resources/Ghostty.sdef.
//
// Lifecycle: we poll Ghostty every POLL_INTERVAL_MS ms via osascript,
// diffing `application.terminals` and `application.windows` to detect
// session start / terminate / cwd-changed / command.started /
// command.ended. Polling is the only automation surface Ghostty 1.3.1
// exposes; the upstream PR (#11713) adding event-stream AppleScript
// is not yet in a stable release.
//
// F4 hardening: this adapter tracks every grant token it has been
// handed (via the launchBootstrap RPC) and rejects any user-supplied
// text (in bootstrapCommand or sendInput) that contains one of those
// tokens as a substring. The grant never rides the wire except as
// the RPC return value.
//
// Wire contract: one JSON-RPC message per line on stdin; one JSON-RPC
// message per line on stdout. Notifications use `method: "terminal.event"`
// with a `RosTerminalEventEnvelope` body (terminal-host-contract.ts).
//
// ADR-040 compliance:
//   - never shells out with ambient PATH for the AppleScript bridge
//     (osascript is at /usr/bin/osascript; not ambient).
//   - never holds credentials: grant tokens live only in the in-memory
//     `grantTokens` set.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, writeFile, unlink, stat, readdir, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const JSON_RPC_VERSION = "2.0";
const POLL_INTERVAL_MS = 250;
const SCRIPT_DIR = `${tmpdir()}/ros-ghostty-bootstrap`;
/** Bounded cleanup window (CP-SG1). The shell inside Ghostty reads the
 *  script file via `bash '<file>'` AFTER osascript returns, so we cannot
 *  unlink synchronously. Anything older than this is reaped by the
 *  poller on each tick; long enough that the in-window shell has had
 *  plenty of wall-clock to read + exec. */
const SCRIPT_REAPER_MAX_AGE_MS = 5 * 60 * 1000;
const SUPPORTED_METHODS = new Set([
  "createSession",
  "launchBootstrap",
  "sendInput",
  "terminateSession",
]);

/** Token-shaped grant tracker (F4 hardening). */
const grantTokens = new Set();

/** sessionId -> { windowId, lastTitle, lastCwd, startedAt } */
const sessions = new Map();

/** sessionId -> scriptFilePath (CP-SG1). Reaped on next launch or by
 *  the poller; never leaked (0600, no secrets). */
const scriptFiles = new Map();

/** Pending RPCs: id -> { resolve, reject, timer, method } */
const pending = new Map();

/** Latest known list of Ghostty windowIds (for polling diffs). */
let lastWindowIds = new Set();

/** Latest known list of Ghostty terminal titles. */
let lastTitles = new Map(); // windowId -> title

let pollTimer = null;
let alive = true;

function nowIso() {
  return new Date().toISOString();
}

function frame(message) {
  return `${JSON.stringify(message)}\n`;
}

function send(message) {
  process.stdout.write(frame(message));
}

/** Build a JSON-RPC 2.0 success response. */
function ok(id, result) {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

/** Build a JSON-RPC 2.0 error response. */
function err(id, code, message) {
  return { jsonrpc: JSON_RPC_VERSION, id, error: { code, message } };
}

function notify(method, params) {
  send({ jsonrpc: JSON_RPC_VERSION, method, params });
}

function envelope(sessionId, event) {
  return {
    version: 1,
    sessionId,
    source: "terminal",
    at: nowIso(),
    event,
  };
}

function emit(sessionId, event) {
  notify("terminal.event", envelope(sessionId, event));
}

function rejectKnownTokens(text, field) {
  for (const token of grantTokens) {
    if (text.includes(token)) {
      const err = new Error(
        `permission-denied: ${field} contains a SessionBootstrapGrant token; tokens never ride the wire`,
      );
      err.code = "permission-denied";
      throw err;
    }
  }
}

function runOsa(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out += chunk.toString(); });
    child.stderr.on("data", (chunk) => { err += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`osascript exit ${code}: ${err.trim() || out.trim()}`));
    });
  });
}

// Escape a string for embedding in an AppleScript double-quoted literal.
function osaEscape(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Escape a string for embedding inside single-quoted POSIX shell
 *  (`bash '<path>'`). Closes the quote, escapes any embedded single
 *  quote (close + literal + open), reopens. */
function shellSingleQuoteEscape(value) {
  return String(value).replace(/'/g, "'\\''");
}

/**
 * Compose the Ghostty `new window with configuration …` AppleScript
 * literal. CP-SG1: the bootstrap command is written to a 0600 file and
 * delivered as `bash '<scriptFile>'` — the AppleScript literal never
 * carries the long composed command. The caller owns the script file
 * cleanup (best-effort unlink is a no-op while bash is still forking
 * into it; the reaper in startPoller() bounds the lifetime).
 *
 * @param {{ bootstrapCommand: string, sessionId: string }} args
 * @returns {{
 *   osa: string,
 *   scriptFilePath: string,
 *   cleanup: () => Promise<void>,
 *   bootstrapCommandBytes: number,
 *   appleScriptBytes: number,
 * }}
 */
export async function composeGhosttyNewWindowOsa({ bootstrapCommand, sessionId }) {
  if (typeof bootstrapCommand !== "string") {
    throw new TypeError("composeGhosttyNewWindowOsa: bootstrapCommand must be a string");
  }
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new TypeError("composeGhosttyNewWindowOsa: sessionId must be a non-empty string");
  }
  await mkdir(SCRIPT_DIR, { recursive: true, mode: 0o700 });
  const safeSession = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
  const scriptFilePath = join(SCRIPT_DIR, `${safeSession}-${randomUUID()}.sh`);
  // Write the script first so the file exists before we hand the path
  // to osascript. chmod after for the same mode the token/auth files
  // use. No secrets ride the file (only paths + shell syntax).
  await writeFile(scriptFilePath, bootstrapCommand, { encoding: "utf8" });
  await chmod(scriptFilePath, 0o600);
  // The bash invocation inside Ghostty reads the script. POSIX
  // single-quote-escape the path; the outer AppleScript literal wraps
  // it in double quotes.
  const shellPath = `'${shellSingleQuoteEscape(scriptFilePath)}'`;
  const inner = `bash ${shellPath}`;
  const fields = [];
  fields.push(`command:"${osaEscape(inner)}"`);
  fields.push(`wait after command:false`);
  const osa = `tell application "Ghostty" to return id of (new window with configuration {${fields.join(", ")}})`;
  return {
    osa,
    scriptFilePath,
    cleanup: async () => {
      try { await unlink(scriptFilePath); } catch { /* already gone */ }
    },
    bootstrapCommandBytes: Buffer.byteLength(bootstrapCommand, "utf8"),
    appleScriptBytes: Buffer.byteLength(osa, "utf8"),
  };
}

/** Reap script files older than SCRIPT_REAPER_MAX_AGE_MS. Best-effort;
 *  never throws into the polling loop. */
async function reapScriptFiles() {
  let entries;
  try { entries = await readdir(SCRIPT_DIR); } catch { return; }
  const cutoff = Date.now() - SCRIPT_REAPER_MAX_AGE_MS;
  for (const name of entries) {
    if (!name.endsWith(".sh")) continue;
    const p = join(SCRIPT_DIR, name);
    try {
      const st = await stat(p);
      if (st.mtimeMs < cutoff) await unlink(p);
    } catch { /* raced; gone */ }
  }
}

async function ghosttyNewWindow({ command, initialInput, workingDirectory, sessionId, deps }) {
  const executeOsa = deps?.executeOsa ?? runOsa;
  // Long composed commands are walked via a 0600 script file.
  // CP-SG1: the long form is NEVER embedded in an AppleScript literal.
  let composed;
  let osa;
  if (command && sessionId) {
    composed = await composeGhosttyNewWindowOsa({ bootstrapCommand: command, sessionId });
    osa = composed.osa;
    scriptFiles.set(sessionId, composed.scriptFilePath);
  } else {
    const fields = [];
    if (command) fields.push(`command:"${osaEscape(command)}"`);
    if (initialInput) fields.push(`initial input:"${osaEscape(initialInput)}"`);
    if (workingDirectory) fields.push(`initial working directory:"${osaEscape(workingDirectory)}"`);
    fields.push(`wait after command:false`);
    osa = `tell application "Ghostty" to return id of (new window with configuration {${fields.join(", ")}})`;
  }
  const result = await executeOsa(osa);
  // Unlink-on-next-launch: any prior script for this session is now
  // dead — bash will not race because the osascript call returned
  // before bash forked into the file (macOS Apple Events are
  // synchronous; the shell exec happens inside the new window after
  // this returns).
  const prior = scriptFiles.get(sessionId);
  if (prior && prior !== composed?.scriptFilePath) {
    try { await unlink(prior); } catch { /* */ }
    scriptFiles.delete(sessionId);
  }
  const windowId = String(result).replace(/^window id /, "").trim();
  return composed ? { windowId, scriptFilePath: composed.scriptFilePath } : { windowId };
}

async function ghosttyCloseTerminal(windowId) {
  // The "terminal" is the focused terminal of tab 1 of the window.
  // iTerm2 has distinct session ids; Ghostty's surface identity is
  // the (windowId, tabId) pair. We close the focused terminal.
  await runOsa(
    `tell application "Ghostty" to tell window id "${osaEscape(windowId)}" to ` +
    `close (focused terminal of tab 1)`,
  );
}

async function ghosttyListWindows() {
  // Returns a newline-separated list of "window id <id>" entries, or
  // empty string if no windows are open.
  try {
    const out = await runOsa(
      `tell application "Ghostty" to return id of every window`,
    );
    if (!out) return [];
    return out.split(/,\s*/).map((s) => s.replace(/^window id /, "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function ghosttyWindowTitle(windowId) {
  try {
    return await runOsa(
      `tell application "Ghostty" to return name of window id "${osaEscape(windowId)}"`,
    );
  } catch {
    return "";
  }
}

async function ghosttyWindowCwd(windowId) {
  try {
    return await runOsa(
      `tell application "Ghostty" to return working directory of focused terminal of tab 1 of window id "${osaEscape(windowId)}"`,
    );
  } catch {
    return "";
  }
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (!SUPPORTED_METHODS.has(method)) {
    return err(id, -32601, `unsupported-operation: ${method}`);
  }
  try {
    switch (method) {
      case "createSession": {
        const sessionId = params?.sessionId || `ghostty-${randomUUID().slice(0, 8)}`;
        const windowId = await ghosttyNewWindow({});
        sessions.set(sessionId, { windowId, lastTitle: "", lastCwd: "", startedAt: nowIso() });
        emit(sessionId, { type: "terminal.session.started", sessionId, at: nowIso() });
        return ok(id, { sessionId, windowId });
      }
      case "launchBootstrap": {
        const sessionId = params?.sessionId || `ghostty-${ghosttyLaunchCounter()}`;
        const bootstrapCommand = params?.bootstrapCommand || "";
        const grant = params?.grant;
        if (grant && typeof grant === "object" && typeof grant.token === "string" && grant.token) {
          grantTokens.add(grant.token);
        }
        rejectKnownTokens(bootstrapCommand, "bootstrapCommand");
        // Single op covers launchBootstrap + sendInput in 1.3.1: pass
        // command AND initial input to the new window. If the harness
        // needs to inject more text later, that's a follow-up sendInput
        // (degrades to "fires immediately" in 1.3.1; tracked as a known
        // limitation in TERMINAL-HOST-GHOSTTY-RECONCILIATION.md).
        //
        // CP-SG1: long composed commands are NEVER embedded in the
        // AppleScript literal — ghosttyNewWindow writes a 0600 script
        // file and delivers `bash '<scriptFile>'`. The script file is
        // returned to the host in the RPC result so the host can audit
        // (it does not own the cleanup; the adapter does).
        const { windowId, scriptFilePath } = await ghosttyNewWindow({
          command: bootstrapCommand,
          initialInput: "",
          sessionId,
        });
        sessions.set(sessionId, { windowId, lastTitle: "", lastCwd: "", startedAt: nowIso() });
        emit(sessionId, { type: "terminal.session.started", sessionId, at: nowIso() });
        // The bridge's first poll will see the new window in the
        // application.windows list; we emit session.started immediately
        // for the lowest-latency path. terminal.command.started /
        // ended come from title diffs.
        const result = { sessionId, grant, windowId };
        if (scriptFilePath) result.scriptFilePath = scriptFilePath;
        return ok(id, result);
      }
      case "sendInput": {
        const sessionId = params?.sessionId;
        const text = params?.text || "";
        if (!sessionId) {
          return err(id, -32602, "invalid-params: sessionId required");
        }
        rejectKnownTokens(text, "sendInput.text");
        // 1.3.1 limitation: input text to a per-tab terminal is broken.
        // We degrade: emit terminal.command.started and terminal.command.ended
        // back-to-back, same semantics as the iTerm2 adapter. This is the
        // documented Phase 3 limitation.
        emit(sessionId, { type: "terminal.command.started", sessionId, at: nowIso() });
        emit(sessionId, { type: "terminal.command.ended", sessionId, at: nowIso() });
        return ok(id, { sessionId, delivered: true, at: nowIso() });
      }
      case "terminateSession": {
        const sessionId = params?.sessionId;
        if (!sessionId) {
          return err(id, -32602, "invalid-params: sessionId required");
        }
        const entry = sessions.get(sessionId);
        if (!entry) {
          return err(id, -32604, "session-not-found");
        }
        await ghosttyCloseTerminal(entry.windowId);
        sessions.delete(sessionId);
        emit(sessionId, { type: "terminal.session.terminated", sessionId, at: nowIso() });
        return ok(id, { sessionId, terminated: true });
      }
      default:
        return err(id, -32601, `unsupported-operation: ${method}`);
    }
  } catch (error) {
    const code = error?.code === "permission-denied" ? -32002 : -32000;
    return err(id, code, error?.message || String(error));
  }
}

let _launchCounter = 0;
function ghosttyLaunchCounter() {
  _launchCounter += 1;
  return `auto-${_launchCounter}`;
}

function handleLine(line) {
  if (line.length === 0) return;
  let msg;
  try { msg = JSON.parse(line); }
  catch (error) { process.stderr.write(`[adapter] bad_json: ${String(error)}\n`); return; }
  if (msg.jsonrpc !== JSON_RPC_VERSION) return;
  if ("id" in msg && (msg.result !== undefined || msg.error !== undefined)) {
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code }));
      else waiter.resolve(msg.result);
    }
    return;
  }
  if ("method" in msg && "id" in msg) {
    // request
    handleRequest(msg).then((response) => send(response));
  }
}

function request(method, params, { timeoutMs = 5000 } = {}) {
  // Used by the poller to call back into the bridge? No — the poller
  // only emits notifications. This helper is for symmetry with the
  // iTerm2 adapter's outbound-RPC shape; not used in the current
  // implementation but kept for forward-compat.
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`${method} timed out after ${timeoutMs}ms`), { code: "deadline-exceeded" }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    send({ jsonrpc: JSON_RPC_VERSION, id, method, params });
  });
}

async function pollOnce() {
  if (!alive) return;
  let currentWindowIds;
  try {
    currentWindowIds = new Set(await ghosttyListWindows());
  } catch {
    return;
  }
  // Detect session.terminated: any windowId in lastWindowIds but not in
  // currentWindowIds, AND that maps to a session we know about.
  for (const oldId of lastWindowIds) {
    if (!currentWindowIds.has(oldId)) {
      // Find the session that owned this window
      for (const [sessionId, entry] of sessions.entries()) {
        if (entry.windowId === oldId) {
          sessions.delete(sessionId);
          lastTitles.delete(oldId);
          emit(sessionId, { type: "terminal.session.terminated", sessionId, at: nowIso() });
          break;
        }
      }
    }
  }
  // Detect cwd-changed and command.started/ended via title diffs
  for (const sessionId of [...sessions.keys()]) {
    const entry = sessions.get(sessionId);
    if (!entry) continue;
    let title = "";
    let cwd = "";
    try {
      title = await ghosttyWindowTitle(entry.windowId);
      cwd = await ghosttyWindowCwd(entry.windowId);
    } catch {
      continue;
    }
    if (cwd && cwd !== entry.lastCwd) {
      entry.lastCwd = cwd;
      emit(sessionId, { type: "terminal.cwd.changed", sessionId, at: nowIso(), cwd });
    }
    if (title !== entry.lastTitle) {
      const previous = entry.lastTitle;
      entry.lastTitle = title;
      // A title change in Ghostty is the shell updating `user@host: cwd`
      // (similar to the iTerm2 screen-stream debug signal). Treat any
      // change as command.started; emit command.ended when the title
      // stabilizes on the same value across two polls.
      if (previous !== "" && previous !== title) {
        emit(sessionId, { type: "terminal.command.ended", sessionId, at: nowIso() });
      }
      emit(sessionId, { type: "terminal.command.started", sessionId, at: nowIso() });
    }
  }
  lastWindowIds = currentWindowIds;
}

function startPoller() {
  if (pollTimer) return;
  // Seed the initial state so we don't spuriously emit on first poll
  ghosttyListWindows()
    .then((ids) => { lastWindowIds = new Set(ids); })
    .catch(() => {})
    .finally(() => {
      pollTimer = setInterval(() => {
        Promise.all([
          pollOnce(),
          // CP-SG1: reap stale 0600 bootstrap script files. Best-effort,
          // never throws into the polling loop.
          reapScriptFiles(),
        ]).catch(() => {});
      }, POLL_INTERVAL_MS);
    });
}

function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// The adapter is consumed two ways:
//   1. As the JSON-RPC stdio peer (production: spawned by the bridge).
//      In that mode we want the poller to start so terminal events fire.
//   2. As an ES module import (unit tests, type-aware consumers).
//      In that mode we want the module to be side-effect-free so
//      `node --test …` doesn't hang on the poller's interval.
// We gate the auto-start on the entrypoint check: only start the
// poller if this file is the script Node is running directly.
// ROS_GHOSTTY_ADAPTER_AUTOSTART=0 always disables; =1 forces it.
const __entry = process.argv[1] ? process.argv[1].replace(/^file:\/\//, "") : "";
const __here = new URL(import.meta.url).pathname;
if (process.env.ROS_GHOSTTY_ADAPTER_AUTOSTART === "0") {
} else if (process.env.ROS_GHOSTTY_ADAPTER_AUTOSTART === "1" || __entry === __here) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", handleLine);

  process.on("SIGTERM", () => { alive = false; stopPoller(); process.exit(0); });
  process.on("SIGINT", () => { alive = false; stopPoller(); process.exit(0); });

  startPoller();
}
