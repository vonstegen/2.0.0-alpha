// /v1/events — GET: public list (M1); POST: create event, organizers only (M2).
import { createRepositoryFromEnv } from "../../db/index.mjs";
import { handleListEvents, sendNodeResponse } from "../../src/handlers.mjs";
import { handleCreateEvent } from "../../src/write-handlers.mjs";
import { runEndpoint } from "../../src/vercel-adapter.mjs";

let repoPromise;

export default async function handler(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "POST") {
    return runEndpoint(req, res, handleCreateEvent);
  }
  if (method === "GET" || method === "HEAD") {
    try {
      repoPromise ??= createRepositoryFromEnv();
      const repo = await repoPromise;
      return sendNodeResponse(res, await handleListEvents(repo));
    } catch (err) {
      repoPromise = undefined;
      return sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: err.message } });
    }
  }
  return sendNodeResponse(res, {
    status: 405,
    headers: { Allow: "GET, POST" },
    body: { error: "method_not_allowed", message: `Method ${method} not allowed; use GET or POST.` },
  });
}
