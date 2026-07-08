// Thin translation layer between Vercel/Node req/res and the pure write handlers.
// Keeps every api/v1/** entrypoint a two-liner and centralizes body parsing,
// param extraction, and error mapping (bad JSON -> 400, misconfig/throw -> 500).

import { readJsonBody, sendNodeResponse } from "./handlers.mjs";
import { getWriteContext, getOAuthContext } from "./write-context.mjs";

/**
 * @param {any} req  Node/Vercel request
 * @param {any} res  Node/Vercel response
 * @param {(nreq: object, ctx: object) => Promise<{status,body,headers?}>} handler
 * @param {{ needsBody?: boolean, needsOAuth?: boolean, params?: (req:any)=>object }} [opts]
 */
export async function runEndpoint(req, res, handler, { needsBody = true, needsOAuth = false, params } = {}) {
  let body = {};
  if (needsBody) {
    try {
      body = await readJsonBody(req);
    } catch (e) {
      return sendNodeResponse(res, {
        status: 400,
        body: { error: "invalid_json", message: `Request body is not valid JSON: ${e.message}` },
      });
    }
  }
  try {
    const ctx = needsOAuth ? await getOAuthContext() : await getWriteContext();
    const nreq = { headers: req.headers ?? {}, body, params: params ? params(req) : {} };
    sendNodeResponse(res, await handler(nreq, ctx));
  } catch (e) {
    sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: e.message } });
  }
}
