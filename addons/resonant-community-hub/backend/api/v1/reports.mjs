// POST /v1/reports — report an entry for moderation (member; spec FR-M2).
import { sendNodeResponse, requireMethod } from "../../src/handlers.mjs";
import { handleCreateReport } from "../../src/mod-handlers.mjs";
import { runEndpoint } from "../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "POST");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleCreateReport);
}
