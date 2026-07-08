// DELETE /v1/account — self-service account deletion + write erasure (FR-A3, Art. VIII).
import { sendNodeResponse, requireMethod } from "../../src/handlers.mjs";
import { handleDeleteAccount } from "../../src/mod-handlers.mjs";
import { runEndpoint } from "../../src/vercel-adapter.mjs";

export default async function handler(req, res) {
  const notAllowed = requireMethod(req.method, "DELETE");
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  // DELETE carries no body; the member id comes from the authenticated token.
  return runEndpoint(req, res, handleDeleteAccount, { needsBody: false });
}
