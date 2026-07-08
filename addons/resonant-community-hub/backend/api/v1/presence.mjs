// GET /v1/presence — public read: opt-in presence strip (spec §6, FR-P2).
import { createRepositoryFromEnv } from "../../db/index.mjs";
import { handleListPresence, methodGuard, sendNodeResponse } from "../../src/handlers.mjs";

let repoPromise;

export default async function handler(req, res) {
  const notAllowed = methodGuard(req.method);
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  try {
    repoPromise ??= createRepositoryFromEnv();
    const repo = await repoPromise;
    sendNodeResponse(res, await handleListPresence(repo));
  } catch (err) {
    repoPromise = undefined;
    sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: err.message } });
  }
}
