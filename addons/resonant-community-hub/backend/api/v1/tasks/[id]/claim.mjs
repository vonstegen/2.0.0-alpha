// POST /v1/tasks/:id/claim — claim / un-claim a task (member; spec FR-T2).
import { sendNodeResponse, requireMethod } from "../../../../src/handlers.mjs";
import { handleClaimTask } from "../../../../src/write-handlers.mjs";
import { runEndpoint } from "../../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "POST");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleClaimTask, { params: (r) => ({ id: r.query?.id }) });
}
