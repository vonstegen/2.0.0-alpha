// POST /v1/mod/unhide — moderator reverses a hide (spec FR-M2).
import { sendNodeResponse, requireMethod } from "../../../src/handlers.mjs";
import { handleUnhideEntry } from "../../../src/mod-handlers.mjs";
import { runEndpoint } from "../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "POST");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleUnhideEntry);
}
