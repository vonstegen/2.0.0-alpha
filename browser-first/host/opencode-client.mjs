// Thin host-side client for a running `opencode serve` (its plain HTTP + SSE API),
// plus a lifecycle helper that ensures the server is up. Kept dependency-free
// (no @opencode-ai/sdk) — the server is a plain HTTP server — and fully
// dependency-injected so the lifecycle/state machine is unit-testable without
// spawning a real process.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 4096;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const PROMPT_FALLBACK_TIMEOUT_MS = 600_000;
const BRIDGE_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function opencodeBaseUrl({ hostname = DEFAULT_HOST, port = DEFAULT_PORT } = {}) {
  return `http://${hostname}:${port}`;
}

export function opencodeServeBaseUrl(serverInfo = {}) {
  const raw = typeof serverInfo === "string" ? serverInfo : serverInfo?.baseUrl;
  const url = new URL(String(raw ?? ""));
  if (url.protocol !== "http:") {
    throw new Error("OpenCode serve URL must use http on a loopback literal.");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("OpenCode serve URL must use the 127.0.0.1 loopback literal.");
  }
  url.hostname = "127.0.0.1";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
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
  // Healthy-server reuse assumes the Alpha's single-project deployment: cwd is
  // pinned only when we spawn; a pre-existing server for another directory wins.
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

function modelPayload(model) {
  const raw = String(model ?? "").trim();
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) return null;
  return {
    providerID: raw.slice(0, slash),
    modelID: raw.slice(slash + 1)
  };
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
  const {
    fetchImpl,
    baseUrl,
    headers = {},
    directory,
    workspace,
    apiDoc,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    promptFallbackTimeoutMs = PROMPT_FALLBACK_TIMEOUT_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
  } = options;
  const pinnedDirectory = Object.hasOwn(options, "directory") ? directory : resolveOpencodeCwd({ env: process.env });
  let cachedDoc = apiDoc ?? null;
  let docLoaded = Boolean(apiDoc);
  let docPromise = null;

  const fetchWithTimeout = async (callName, url, init = {}, timeoutMs = requestTimeoutMs) => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller && typeof setTimeoutImpl === "function"
      ? setTimeoutImpl(() => controller.abort(), timeoutMs)
      : null;
    try {
      return await fetchImpl(url, { ...init, signal: controller?.signal });
    } catch (error) {
      if (controller?.signal?.aborted || error?.name === "AbortError") {
        throw new Error(`opencode ${callName} timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timer && typeof clearTimeoutImpl === "function") clearTimeoutImpl(timer);
    }
  };

  const loadApiDoc = async () => {
    if (docLoaded) return cachedDoc;
    if (docPromise) return docPromise;
    docPromise = (async () => {
      try {
        const res = await fetchWithTimeout("loadApiDoc", `${baseUrl}/doc`, { method: "GET", headers: { ...headers } });
        if (!res?.ok) return null;
        const text = await res.text().catch(() => "");
        cachedDoc = text ? JSON.parse(text) : null;
        docLoaded = true;
      } catch {
        cachedDoc = null;
      } finally {
        docPromise = null;
      }
      return cachedDoc;
    })();
    return docPromise;
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

  const call = async (callName, method, path, body, query, { timeoutMs = requestTimeoutMs } = {}) => {
    const fullPath = appendQuery(path, query);
    const res = await fetchWithTimeout(callName, `${baseUrl}${fullPath}`, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    }, timeoutMs);
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      throw new Error(`opencode ${method} ${fullPath} failed: ${res.status} ${typeof data === "string" ? data : (data?.error ?? "")}`.trim());
    }
    return data;
  };

  return {
    createSession: (title = "ResonantOS session") => call("createSession", "POST", "/session", { title }, routeQuery()),
    prompt: async (sessionId, parts, { model, agent } = {}) => {
      const usesPromptAsync = await hasEndpoint("/session/{sessionID}/prompt_async", "POST");
      const path = usesPromptAsync
        ? `/session/${encodePathSegment(sessionId)}/prompt_async`
        : `/session/${encodePathSegment(sessionId)}/message`;
      const structuredModel = modelPayload(model);
      return call("prompt", "POST", path, {
        parts: textParts(parts),
        ...(structuredModel ? { model: structuredModel } : {}),
        ...(agent ? { agent } : {})
      }, routeQuery(), { timeoutMs: usesPromptAsync ? requestTimeoutMs : promptFallbackTimeoutMs });
    },
    replyPermission: (sessionId, permissionId, decision) =>
      call("replyPermission", "POST", `/session/${encodePathSegment(sessionId)}/permissions/${encodePathSegment(permissionId)}`, {
        response: decision?.approved ? (decision?.remember ? "always" : "once") : "reject"
      }, routeQuery()),
    abort: (sessionId) => call("abort", "POST", `/session/${encodePathSegment(sessionId)}/abort`, undefined, routeQuery()),
    sessionDiff: (sessionId, { messageID } = {}) =>
      call("sessionDiff", "GET", `/session/${encodePathSegment(sessionId)}/diff`, undefined, routeQuery({ ...(messageID ? { messageID } : {}) })),
    rename: (sessionId, title) =>
      call("rename", "PATCH", `/session/${encodePathSegment(sessionId)}`, { title }, routeQuery()),
    remove: (sessionId) => call("delete", "DELETE", `/session/${encodePathSegment(sessionId)}`, undefined, routeQuery()),
    archive: (sessionId, archived = Date.now()) =>
      call("archive", "PATCH", `/session/${encodePathSegment(sessionId)}`, { time: { archived } }, routeQuery()),
    listAgents: () => call("listAgents", "GET", "/agent", undefined, routeQuery()),
    listSessions: () => call("listSessions", "GET", "/session", undefined, routeQuery()),
    messages: (sessionId) => call("messages", "GET", `/session/${encodePathSegment(sessionId)}/message`, undefined, routeQuery()),
    eventUrl: () => `${baseUrl}/event`
  };
}
