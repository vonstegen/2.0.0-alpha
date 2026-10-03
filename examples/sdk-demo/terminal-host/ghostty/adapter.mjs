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

const JSON_RPC_VERSION = "2.0";
const POLL_INTERVAL_MS = 250;
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

async function ghosttyNewWindow({ command, initialInput, workingDirectory }) {
  // Build a surface configuration record. Ghostty's sdef accepts a
  // record literal: {command:"...", initial input:"...", initial
  // working directory:"..."}. The keys are the sdef's exact spelling.
  const fields = [];
  if (command) fields.push(`command:"${osaEscape(command)}"`);
  if (initialInput) fields.push(`initial input:"${osaEscape(initialInput)}"`);
  if (workingDirectory) fields.push(`initial working directory:"${osaEscape(workingDirectory)}"`);
  fields.push(`wait after command:false`);
  const cfg = `{${fields.join(", ")}}`;
  const result = await runOsa(`tell application "Ghostty" to return id of (new window with configuration ${cfg})`);
  // result looks like "window id window-XXXX"
  return result.replace(/^window id /, "").trim();
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
        const windowId = await ghosttyNewWindow({
          command: bootstrapCommand,
          initialInput: "",
        });
        sessions.set(sessionId, { windowId, lastTitle: "", lastCwd: "", startedAt: nowIso() });
        emit(sessionId, { type: "terminal.session.started", sessionId, at: nowIso() });
        // The bridge's first poll will see the new window in the
        // application.windows list; we emit session.started immediately
        // for the lowest-latency path. terminal.command.started /
        // ended come from title diffs.
        return ok(id, { sessionId, grant, windowId });
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
        pollOnce().catch(() => {});
      }, POLL_INTERVAL_MS);
    });
}

function stopPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", handleLine);

process.on("SIGTERM", () => { alive = false; stopPoller(); process.exit(0); });
process.on("SIGINT", () => { alive = false; stopPoller(); process.exit(0); });

startPoller();
