// GET /v1/auth/github/callback — exchange code, provision Member, mint session token.
import { sendNodeResponse, requireMethod } from "../../../../src/handlers.mjs";
import { handleAuthCallback } from "../../../../src/write-handlers.mjs";
import { runEndpoint } from "../../../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "GET");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  return runEndpoint(req, res, handleAuthCallback, {
    needsBody: false,
    needsOAuth: true,
    params: (r) => ({ code: r.query?.code, state: r.query?.state }),
  });
}
