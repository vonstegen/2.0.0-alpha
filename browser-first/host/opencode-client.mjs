// Thin host-side client for a running `opencode serve` (its plain HTTP + SSE API),
// plus a lifecycle helper that ensures the server is up. Kept dependency-free
// (no @opencode-ai/sdk) — the server is a plain HTTP server — and fully
// dependency-injected so the lifecycle/state machine is unit-testable without
// spawning a real process.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4096;
const DEFAULT_HOST = "127.0.0.1";
const BRIDGE_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function opencodeBaseUrl({ hostname = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  return `http://${hostname}:${port}`;
}

// Is a server already answering at baseUrl? Probes the OpenAPI doc (always
// present, needs no provider) with a short timeout.
export async function opencodeServerHealthy({ fetchImpl, baseUrl, timeoutMs = 1500 } = {}) {
  if (typeof fetchImpl !== "function") return false;
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const res = await fetchImpl(`${baseUrl}/doc`, { signal: controller?.signal });
    if (timer) clearTimeout(timer);
    return Boolean(res && res.ok);
  } catch {
    return false;
  }
}

// Ensure `opencode serve` is running at the resolved base URL. Reuses an already
// healthy server; otherwise spawns one and waits for it to answer. Returns
// { baseUrl, spawned, process|null }. Never throws for a benign "already up".
export async function ensureOpencodeServer({
  fetchImpl,
  spawnImpl,
  command,
  hostname = DEFAULT_HOST,
  port = DEFAULT_PORT,
  cwd,
  env = process.env,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxWaitMs = 12000,
  pollMs = 300
} = {}) {
  const baseUrl = opencodeBaseUrl({ hostname, port });
  const directory = resolveOpencodeCwd({ cwd, env });
  if (await opencodeServerHealthy({ fetchImpl, baseUrl })) {
    return { baseUrl, spawned: false, process: null, directory };
  }
  if (!command || typeof spawnImpl !== "function") {
    throw new Error("OpenCode runtime is not available to start (no command resolved).");
  }
  const child = spawnImpl(command, ["serve", "--hostname", hostname, "--port", String(port)], {
    cwd: directory,
    env: { ...env },
    stdio: "ignore"
  });
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    if (await opencodeServerHealthy({ fetchImpl, baseUrl })) {
      return { baseUrl, spawned: true, process: child, directory };
    }
  }
  try { child?.kill?.(); } catch { /* noop */ }
  throw new Error("OpenCode server did not become ready in time.");
}

function resolveOpencodeCwd({ cwd, env = process.env } = {}) {
  const explicit = typeof cwd === "string" && cwd.trim() ? cwd.trim() : "";
  const configured = typeof env?.RESONANTOS_OPENCODE_CWD === "string" && env.RESONANTOS_OPENCODE_CWD.trim()
    ? env.RESONANTOS_OPENCODE_CWD.trim()
    : "";
  return explicit || configured || BRIDGE_REPO_ROOT;
}

function encodePathSegment(value) {
  return encodeURIComponent(String(value ?? ""));
}

function textParts(parts) {
  return Array.isArray(parts) ? parts : [{ type: "text", text: String(parts ?? "") }];
}

function appendQuery(path, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

// Minimal typed wrapper over the server's session endpoints.
export function createOpencodeHttpClient(options = {}) {
  const { fetchImpl, baseUrl, headers = {}, directory, workspace, apiDoc } = options;
  const pinnedDirectory = Object.hasOwn(options, "directory") ? directory : resolveOpencodeCwd({ env: process.env });
  let cachedDoc = apiDoc ?? null;
  let docLoaded = Boolean(apiDoc);

  const loadApiDoc = async () => {
    if (docLoaded) return cachedDoc;
    docLoaded = true;
    try {
      const res = await fetchImpl(`${baseUrl}/doc`, { method: "GET", headers: { ...headers } });
      if (!res?.ok) return null;
      const text = await res.text().catch(() => "");
      cachedDoc = text ? JSON.parse(text) : null;
    } catch {
      cachedDoc = null;
    }
    return cachedDoc;
  };

  const hasEndpoint = async (path, method) => {
    const doc = await loadApiDoc();
    return Boolean(doc?.paths?.[path]?.[String(method).toLowerCase()]);
  };

  const routeQuery = (extra = {}) => ({
    ...(pinnedDirectory ? { directory: pinnedDirectory } : {}),
    ...(workspace ? { workspace } : {}),
    ...extra
  });

  const call = async (method, path, body, query) => {
    const fullPath = appendQuery(path, query);
    const res = await fetchImpl(`${baseUrl}${fullPath}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      throw new Error(`opencode ${method} ${fullPath} failed: ${res.status} ${typeof data === "string" ? data : (data?.error ?? "")}`.trim());
    }
    return data;
  };

  return {
    createSession: (title = "ResonantOS session") => call("POST", "/session", { title }, routeQuery()),
    prompt: async (sessionId, parts, { model, agent } = {}) => {
      const path = await hasEndpoint("/session/{sessionID}/prompt_async", "POST")
        ? `/session/${encodePathSegment(sessionId)}/prompt_async`
        : `/session/${encodePathSegment(sessionId)}/message`;
      return call("POST", path, {
        parts: textParts(parts),
        ...(model ? { model } : {}),
        ...(agent ? { agent } : {})
      }, routeQuery());
    },
    replyPermission: (sessionId, permissionId, decision) =>
      call("POST", `/session/${encodePathSegment(sessionId)}/permissions/${encodePathSegment(permissionId)}`, {
        response: decision?.approved ? (decision?.remember ? "always" : "once") : "reject"
      }, routeQuery()),
    abort: (sessionId) => call("POST", `/session/${encodePathSegment(sessionId)}/abort`, undefined, routeQuery()),
    sessionDiff: (sessionId, { messageID } = {}) =>
      call("GET", `/session/${encodePathSegment(sessionId)}/diff`, undefined, routeQuery({ ...(messageID ? { messageID } : {}) })),
    rename: (sessionId, title) =>
      call("PATCH", `/session/${encodePathSegment(sessionId)}`, { title }, routeQuery()),
    remove: (sessionId) => call("DELETE", `/session/${encodePathSegment(sessionId)}`, undefined, routeQuery()),
    archive: (sessionId, archived = Date.now()) =>
      call("PATCH", `/session/${encodePathSegment(sessionId)}`, { time: { archived } }, routeQuery()),
    listAgents: () => call("GET", "/agent", undefined, routeQuery()),
    listSessions: () => call("GET", "/session", undefined, routeQuery()),
    messages: (sessionId) => call("GET", `/session/${encodePathSegment(sessionId)}/message`, undefined, routeQuery()),
    eventUrl: () => `${baseUrl}/event`
  };
}
