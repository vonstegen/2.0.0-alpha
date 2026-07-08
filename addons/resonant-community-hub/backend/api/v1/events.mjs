// GET /v1/events — public read: events with RSVP + live-attendance counts (spec §6).
import { createRepositoryFromEnv } from "../../db/index.mjs";
import { handleListEvents, methodGuard, sendNodeResponse } from "../../src/handlers.mjs";

let repoPromise;

export default async function handler(req, res) {
  const notAllowed = methodGuard(req.method);
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  try {
    repoPromise ??= createRepositoryFromEnv();
    const repo = await repoPromise;
    sendNodeResponse(res, await handleListEvents(repo));
  } catch (err) {
    repoPromise = undefined; // allow retry on next warm request
    sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: err.message } });
  }
}
