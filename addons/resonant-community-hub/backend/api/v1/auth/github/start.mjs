// GET /v1/auth/github/start — begin GitHub OAuth; 302 to GitHub with signed state.
import { sendNodeResponse, requireMethod } from "../../../../src/handlers.mjs";
import { handleAuthStart } from "../../../../src/write-handlers.mjs";
import { runEndpoint } from "../../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "GET");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleAuthStart, { needsBody: false, needsOAuth: true });
}
