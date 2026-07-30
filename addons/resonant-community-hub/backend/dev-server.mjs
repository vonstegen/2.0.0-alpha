#!/usr/bin/env node
// Local dev server for the Community Hub backend — runs the /v1 API OFFLINE,
// with no Vercel and no Neon, so the add-on can be tested end-to-end locally.
//
// It mounts each api/v1/**.mjs Vercel Function (unchanged) behind a tiny router
// that mirrors backend/vercel.json, extracts the `:id` path param into req.query
// (as Vercel would), and serves everything from ONE shared in-memory store so
// writes reflect in reads.
//
//   node dev-server.mjs            # port 4891 (override with COMMUNITY_HUB_DEV_PORT)
//
// Env it sets for you if unset: COMMUNITY_HUB_INMEMORY=1,
// COMMUNITY_HUB_SHARED_MEMORY=1, and a throwaway COMMUNITY_HUB_AUTH_SECRET.
// Nothing here touches the network or reads a committed secret.

import http from "node:http";
import process from "node:process";
import { createSessionToken, getAuthSecret } from "./src/auth.mjs";
import { fixtures } from "./seed/fixtures.mjs";

// --- offline, single-process defaults -------------------------------------
process.env.COMMUNITY_HUB_INMEMORY ??= "1";
process.env.COMMUNITY_HUB_SHARED_MEMORY ??= "1";
process.env.COMMUNITY_HUB_AUTH_SECRET ??= "dev-only-community-hub-secret-not-for-production";

// Route table — mirrors vercel.json. `id` marks the single dynamic segment.
const ROUTES = [
  { method: "GET", path: "/v1/events", file: "./api/v1/events.mjs" },
  { method: "POST", path: "/v1/events", file: "./api/v1/events.mjs" },
  { method: "POST", path: "/v1/events/:id/rsvp", file: "./api/v1/events/[id]/rsvp.mjs" },
  { method: "POST", path: "/v1/events/:id/checkin", file: "./api/v1/events/[id]/checkin.mjs" },
  { method: "GET", path: "/v1/tasks", file: "./api/v1/tasks.mjs" },
  { method: "POST", path: "/v1/tasks/:id/claim", file: "./api/v1/tasks/[id]/claim.mjs" },
  { method: "GET", path: "/v1/presence", file: "./api/v1/presence.mjs" },
  { method: "PUT", path: "/v1/presence", file: "./api/v1/presence.mjs" },
  { method: "POST", path: "/v1/reports", file: "./api/v1/reports.mjs" },
  { method: "POST", path: "/v1/mod/hide", file: "./api/v1/mod/hide.mjs" },
  { method: "POST", path: "/v1/mod/unhide", file: "./api/v1/mod/unhide.mjs" },
  { method: "DELETE", path: "/v1/account", file: "./api/v1/account.mjs" },
  { method: "GET", path: "/v1/auth/github/start", file: "./api/v1/auth/github/start.mjs" },
  { method: "GET", path: "/v1/auth/github/callback", file: "./api/v1/auth/github/callback.mjs" },
].map((r) => {
  const names = [];
  const source = r.path.replace(/:([A-Za-z0-9_]+)/g, (_m, name) => {
    names.push(name);
    return "([^/]+)";
  });
  return { ...r, regex: new RegExp(`^${source}$`), names };
});

function match(method, pathname) {
  for (const route of ROUTES) {
    if (route.method !== method) continue;
    const m = route.regex.exec(pathname);
    if (!m) continue;
    const query = {};
    route.names.forEach((name, i) => {
      query[name] = decodeURIComponent(m[i + 1]);
    });
    return { route, query };
  }
  return null;
}

const handlerCache = new Map();
async function loadHandler(file) {
  if (!handlerCache.has(file)) {
    const mod = await import(new URL(file, import.meta.url));
    handlerCache.set(file, mod.default);
  }
  return handlerCache.get(file);
}

const server = http.createServer(async (req, res) => {
  const method = (req.method || "GET").toUpperCase();
  // Dev-only permissive CORS so a local Vite preview page (a different localhost
  // port) can call this harness. Production never has the browser hit the API
  // directly (Art. II) — this relaxation lives ONLY in the dev server.
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const { pathname, searchParams } = new URL(req.url, "http://127.0.0.1");
  // Accept both the public /v1/* shape and the raw /api/v1/* shape.
  const normalized = pathname.replace(/^\/api/, "");
  const found = match(method, normalized);
  if (!found) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found", message: `No route for ${method} ${pathname}` }));
    return;
  }
  // Vercel injects path + search params on req.query; the [id] handlers read req.query.id.
  req.query = { ...Object.fromEntries(searchParams), ...found.query };
  try {
    const handler = await loadHandler(found.route.file);
    await handler(req, res);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "dev_server_error", message: err?.message ?? String(err) }));
  }
});

const port = Number.parseInt(process.env.COMMUNITY_HUB_DEV_PORT ?? "", 10) || 4891;
server.listen(port, "127.0.0.1", () => {
  const base = `http://127.0.0.1:${port}`;
  const secret = getAuthSecret();
  const f = fixtures();
  const ada = f.members.find((m) => m.id === "m_ada"); // organizer
  const grace = f.members.find((m) => m.id === "m_grace"); // moderator
  const mint = (m) => createSessionToken({ sub: m.id, handle: m.handle, roles: m.roles }, secret);
  process.stdout.write(
    [
      `Community Hub dev backend on ${base}  (in-memory, shared store, OFFLINE)`,
      ``,
      `Public reads (no auth):`,
      `  curl -s ${base}/v1/events`,
      `  curl -s ${base}/v1/tasks`,
      `  curl -s ${base}/v1/presence`,
      ``,
      `Dev session tokens (Authorization: Bearer <token>):`,
      `  ADA   (organizer): ${mint(ada)}`,
      `  GRACE (moderator): ${mint(grace)}`,
      ``,
    ].join("\n"),
  );
});
