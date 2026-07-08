// /v1/presence — GET: public presence strip (M1); PUT: set/clear own presence (M2).
import { createRepositoryFromEnv } from "../../db/index.mjs";
import { handleListPresence, sendNodeResponse } from "../../src/handlers.mjs";
import { handleSetPresence } from "../../src/write-handlers.mjs";
import { runEndpoint } from "../../src/vercel-adapter.mjs";

let repoPromise;

export default async function handler(req, res) {
  const method = (req.method || "GET").toUpperCase();
  if (method === "PUT") {
    return runEndpoint(req, res, handleSetPresence);
  }
  if (method === "GET" || method === "HEAD") {
    try {
      repoPromise ??= createRepositoryFromEnv();
      const repo = await repoPromise;
      return sendNodeResponse(res, await handleListPresence(repo));
    } catch (err) {
      repoPromise = undefined;
      return sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: err.message } });
    }
  }
  return sendNodeResponse(res, {
    status: 405,
    headers: { Allow: "GET, PUT" },
    body: { error: "method_not_allowed", message: `Method ${method} not allowed; use GET or PUT.` },
  });
}
