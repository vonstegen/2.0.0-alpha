// POST /v1/events/:id/checkin — live attendance within the event window (spec FR-E4).
import { sendNodeResponse, requireMethod } from "../../../../src/handlers.mjs";
import { handleCheckin } from "../../../../src/write-handlers.mjs";
import { runEndpoint } from "../../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "POST");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleCheckin, { needsBody: false, params: (r) => ({ id: r.query?.id }) });
}
