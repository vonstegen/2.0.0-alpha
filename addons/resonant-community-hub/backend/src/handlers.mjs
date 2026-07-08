// Pure request handlers for the M1 public read path.
//
// Handlers are framework-agnostic: each takes a Repository and returns
// { status, body }. The Vercel Function wrappers (api/v1/*.mjs) only translate
// Node req/res <-> these values, so the same logic runs under `node --test`
// offline. Reads are public (constitution Art. IV) — no auth guard here.

// Cache directive for the idempotent public GET reads (events/tasks/presence).
// ONLY these reads opt into shared/proxy caching. Everything else (writes, auth,
// errors) is `no-store` by default in sendNodeResponse — a session token or a
// mutation response must never be publicly cacheable (see sendNodeResponse).
export const PUBLIC_READ_CACHE_CONTROL = "public, max-age=10, stale-while-revalidate=20";
const READ_HEADERS = { "cache-control": PUBLIC_READ_CACHE_CONTROL };

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListEvents(repo) {
  const events = await repo.listEvents();
  return { status: 200, body: { events }, headers: { ...READ_HEADERS } };
}

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListTasks(repo) {
  const tasks = await repo.listTasks();
  return { status: 200, body: { tasks }, headers: { ...READ_HEADERS } };
}

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListPresence(repo) {
  const presence = await repo.listPresence();
  return { status: 200, body: { presence }, headers: { ...READ_HEADERS } };
}

/**
 * Guard a read endpoint to GET (+ HEAD). Returns a 405 result if the method is
 * not allowed, otherwise null.
 * @param {string | undefined} method
 * @returns {{ status: number, body: object, headers?: object } | null}
 */
export function methodGuard(method) {
  const m = (method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD") return null;
  return {
    status: 405,
    headers: { Allow: "GET" },
    body: { error: "method_not_allowed", message: `Method ${m} not allowed; use GET.` },
  };
}

/**
 * Read and JSON-parse a request body, framework-agnostically. Vercel's Node helper
 * may pre-parse `req.body`; when it doesn't (or under `node --test`), fall back to
 * draining the stream. Returns {} for an empty body. Throws on malformed JSON.
 * @param {any} req
 * @returns {Promise<any>}
 */
export async function readJsonBody(req) {
  if (req && req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") {
      return req.body.trim() === "" ? {} : JSON.parse(req.body);
    }
    return req.body; // already-parsed object (Vercel Node helper)
  }
  if (!req || typeof req.on !== "function") return {};
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw === "" ? {} : JSON.parse(raw);
}

/**
 * Guard a write endpoint to a specific method. Returns a 405 result if the method
 * is not allowed, otherwise null.
 * @param {string | undefined} method
 * @param {string} allowed e.g. "POST" or "PUT"
 */
export function requireMethod(method, allowed) {
  const m = (method || "GET").toUpperCase();
  if (m === allowed.toUpperCase()) return null;
  return {
    status: 405,
    headers: { Allow: allowed.toUpperCase() },
    body: { error: "method_not_allowed", message: `Method ${m} not allowed; use ${allowed}.` },
  };
}

/**
 * Write a { status, body, headers } result to a Node/Vercel response.
 *
 * Cache policy (fail-safe): `no-store` is the DEFAULT for every response, so
 * auth-token and mutation bodies are never retained by a browser/back cache or a
 * shared proxy — regardless of status code. Only the idempotent public GET reads
 * opt in, by returning an explicit `cache-control` header (PUBLIC_READ_CACHE_CONTROL,
 * see handleListEvents/Tasks/Presence). An explicit header in `headers` always wins.
 * Tune the read max-age at the CDN edge in M3.
 */
export function sendNodeResponse(res, result) {
  const { status = 200, body = {}, headers = {} } = result || {};
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  const hasCacheControl = Object.keys(headers).some((k) => k.toLowerCase() === "cache-control");
  if (!hasCacheControl) {
    res.setHeader("cache-control", "no-store");
  }
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}
