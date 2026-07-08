// Pure request handlers for the M1 public read path.
//
// Handlers are framework-agnostic: each takes a Repository and returns
// { status, body }. The Vercel Function wrappers (api/v1/*.mjs) only translate
// Node req/res <-> these values, so the same logic runs under `node --test`
// offline. Reads are public (constitution Art. IV) — no auth guard here.

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListEvents(repo) {
  const events = await repo.listEvents();
  return { status: 200, body: { events } };
}

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListTasks(repo) {
  const tasks = await repo.listTasks();
  return { status: 200, body: { tasks } };
}

/** @param {import("./repository.mjs").Repository} repo */
export async function handleListPresence(repo) {
  const presence = await repo.listPresence();
  return { status: 200, body: { presence } };
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
 * Write a { status, body, headers } result to a Node/Vercel response.
 * Read endpoints are cache-friendly (Art. VIII availability: serve/degrade from
 * cache); tune max-age at the CDN edge in M3.
 */
export function sendNodeResponse(res, result) {
  const { status = 200, body = {}, headers = {} } = result || {};
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (status === 200) {
    res.setHeader("cache-control", "public, max-age=10, stale-while-revalidate=20");
  }
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(body));
}
