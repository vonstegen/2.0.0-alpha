// POST /v1/events/:id/rsvp — set RSVP state (member; spec FR-E3).
import { sendNodeResponse, requireMethod } from "../../../../src/handlers.mjs";
import { handleRsvp } from "../../../../src/write-handlers.mjs";
import { runEndpoint } from "../../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "POST");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleRsvp, { params: (r) => ({ id: r.query?.id }) });
}
