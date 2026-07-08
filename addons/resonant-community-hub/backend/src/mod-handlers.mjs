// Pure handlers for the M4 moderation + erasure path (spec §4.5 FR-M2 / §4.4 FR-A3;
// constitution Art. VII "moderation is first-class" + Art. VIII "right to erasure").
//
// Same fail-closed pipeline as every other write (Art. IV/VII): authenticate ->
// rate-limit -> validate -> mutate, via guardWrite. Framework-agnostic results
// ({ status, body, headers }) so they run under `node --test` offline.

import { guardWrite } from "./write-handlers.mjs";
import { validateReport, validateHide } from "./validation.mjs";

const err = (status, code, message) => ({ status, body: { error: code, message } });

/** Does the moderation target exist? (event/task by id, presence by member id.) */
async function targetExists(repo, targetType, targetId) {
  if (targetType === "event") return Boolean(await repo.getEventById(targetId));
  if (targetType === "task") return Boolean(await repo.getTaskById(targetId));
  if (targetType === "presence") return Boolean(await repo.getPresence(targetId));
  return false;
}

/**
 * POST /v1/reports — any member can report an event/task/presence entry (FR-M2).
 * Reports are advisory: they do not hide anything on their own; a moderator acts on
 * them via /v1/mod/hide. Reporting is allowed even for an already-hidden target.
 */
export function handleCreateReport(req, ctx) {
  return guardWrite(req, ctx, "reports:create", async ({ member, body }) => {
    const { targetType, targetId, reason } = validateReport(body);
    if (!(await targetExists(ctx.repo, targetType, targetId))) {
      return err(404, "not_found", "Report target not found.");
    }
    const report = await ctx.repo.createReport({ targetType, targetId, reporterId: member.id, reason });
    return { status: 201, body: { report } };
  });
}

/**
 * POST /v1/mod/hide — moderators only. Hides the target so it drops out of public
 * reads (events/tasks/presence all filter `hidden`) and resolves its open reports.
 */
export function handleHideEntry(req, ctx) {
  return guardWrite(req, ctx, "mod:hide", async ({ member, body }) => {
    if (!Array.isArray(member.roles) || !member.roles.includes("moderator")) {
      return err(403, "forbidden", "Only moderators can hide entries.");
    }
    const { targetType, targetId } = validateHide(body);
    const result = await ctx.repo.hideEntry({ targetType, targetId });
    if (!result.found) return err(404, "not_found", "Hide target not found.");
    return {
      status: 200,
      body: { hidden: { targetType, targetId }, resolvedReports: result.resolvedReports },
    };
  });
}

/**
 * DELETE /v1/account — a member deletes their own account and erases their writes
 * (FR-A3, Art. VIII). Self-service only: the caller can erase only themselves (the
 * member id comes from the authenticated token, never the body). After deletion the
 * member row is gone, so the still-valid HMAC token fails the auth guard's
 * member-lookup on any subsequent request (auth.mjs -> 401 unknown_member).
 */
export function handleDeleteAccount(req, ctx) {
  return guardWrite(req, ctx, "account:delete", async ({ member }) => {
    const result = await ctx.repo.deleteMember(member.id);
    return { status: 200, body: { deleted: result.deleted, memberId: member.id, erased: result.erased } };
  });
}
