// GET /v1/tasks — public read: community tasks with GoalStepStatus mapping (spec §6, FR-T3).
import { createRepositoryFromEnv } from "../../db/index.mjs";
import { handleListTasks, methodGuard, sendNodeResponse } from "../../src/handlers.mjs";

let repoPromise;

export default async function handler(req, res) {
  const notAllowed = methodGuard(req.method);
  if (notAllowed) return sendNodeResponse(res, notAllowed);
  try {
    repoPromise ??= createRepositoryFromEnv();
    const repo = await repoPromise;
    sendNodeResponse(res, await handleListTasks(repo));
  } catch (err) {
    repoPromise = undefined;
    sendNodeResponse(res, { status: 500, body: { error: "internal_error", message: err.message } });
  }
}
