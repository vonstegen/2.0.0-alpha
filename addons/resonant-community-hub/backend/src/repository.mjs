// Read-path repository contract + an in-memory implementation.
//
// The contract (`Repository`) is the seam the constitution's local-first / hosted
// split leans on: Vercel Functions talk to a `Repository`, never to a driver
// directly. Two implementations exist:
//   - createMemoryRepository (this file) — offline test double, also usable as an
//     explicit local/preview fallback when COMMUNITY_HUB_INMEMORY=1.
//   - createSqlRepository (./sql-repository.mjs) — real Neon Postgres via an
//     injected SQL executor.
// Both return byte-identical read shapes so tests exercise the real handler code
// offline (see test/read-path.test.mjs).
//
// Read shapes (M1, public reads — hidden rows excluded per constitution Art. VII):
//   Event    { id, title, description, startsAt, endsAt, location, url, hostId,
//              hostHandle, createdAt, rsvpCounts:{going,interested,no}, attendanceCount }
//   Task     { id, title, description, status, goalStepStatus, claimedBy[], dueAt, createdAt }
//   Presence { memberId, handle, displayName, status, note, updatedAt }

import { taskStatusToGoalStepStatus } from "./goal-mapping.mjs";

/**
 * @typedef {Object} Repository
 * @property {() => Promise<object[]>} listEvents
 * @property {() => Promise<object[]>} listTasks
 * @property {() => Promise<object[]>} listPresence
 */

const RSVP_STATES = ["going", "interested", "no"];

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  // Already an ISO string (fixtures) — normalize through Date for consistency.
  return new Date(value).toISOString();
}

/**
 * Shape a raw event row + its related collections into the public read shape.
 * Shared so the SQL repository and the memory repository cannot drift.
 */
export function shapeEvent(event, { rsvps, checkIns, members }) {
  const rsvpCounts = { going: 0, interested: 0, no: 0 };
  for (const r of rsvps) {
    if (r.eventId === event.id && RSVP_STATES.includes(r.state)) {
      rsvpCounts[r.state] += 1;
    }
  }
  const attendees = new Set();
  for (const c of checkIns) {
    if (c.eventId === event.id) attendees.add(c.memberId);
  }
  const host = members.find((m) => m.id === event.hostId);
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? null,
    startsAt: toIso(event.startsAt),
    endsAt: toIso(event.endsAt),
    location: event.location ?? null,
    url: event.url ?? null,
    hostId: event.hostId ?? null,
    hostHandle: host ? host.handle : null,
    createdAt: toIso(event.createdAt),
    rsvpCounts,
    attendanceCount: attendees.size,
  };
}

export function shapeTask(task, { claims }) {
  const claimedBy = claims
    .filter((c) => c.taskId === task.id)
    .sort((a, b) => new Date(a.claimedAt) - new Date(b.claimedAt))
    .map((c) => c.memberId);
  return {
    id: task.id,
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    goalStepStatus: taskStatusToGoalStepStatus(task.status),
    claimedBy,
    dueAt: toIso(task.dueAt),
    createdAt: toIso(task.createdAt),
  };
}

export function shapePresence(row, { members }) {
  const member = members.find((m) => m.id === row.memberId);
  return {
    memberId: row.memberId,
    handle: member ? member.handle : null,
    displayName: member ? member.displayName : null,
    status: row.status,
    note: row.note ?? null,
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * In-memory repository over raw tables. Faithful to the SQL semantics: filters
 * hidden rows, orders identically, computes the same counts. As of M2 it is also
 * write-capable (member provisioning + RSVP/check-in/claim/presence/event create)
 * so the auth + rate-limit guards can be exercised end-to-end offline.
 *
 * @param {object} [seed] raw tables { members, events, rsvps, checkIns, tasks, taskClaims, presence, reports }
 * @param {{ now?: () => number, newId?: (prefix: string) => string }} [opts]
 * @returns {Repository & { tables: object, load: (t: object) => void }}
 */
export function createMemoryRepository(seed = {}, opts = {}) {
  const now = opts.now ?? Date.now;
  let seq = 0;
  const newId = opts.newId ?? ((prefix) => `${prefix}_${(++seq).toString(36)}${now().toString(36)}`);
  const nowIso = () => new Date(now()).toISOString();

  const tables = {
    members: [],
    events: [],
    rsvps: [],
    checkIns: [],
    tasks: [],
    taskClaims: [],
    presence: [],
    reports: [],
  };

  function load(next = {}) {
    for (const key of Object.keys(tables)) {
      tables[key] = Array.isArray(next[key]) ? next[key].map((row) => ({ ...row })) : [];
    }
  }
  load(seed);

  const statusOrder = { open: 0, claimed: 1, done: 2 };

  function uniqueHandle(desired) {
    const base = String(desired || "member").toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 39) || "member";
    let handle = base;
    let n = 1;
    while (tables.members.some((m) => m.handle === handle)) {
      handle = `${base}-${++n}`;
    }
    return handle;
  }

  return {
    tables,
    load,

    // --- write path (M2) ----------------------------------------------------

    /** Look up a member by opaque id (used by the auth guard). */
    async getMemberById(id) {
      const m = tables.members.find((x) => x.id === id);
      return m ? { ...m } : null;
    },

    async getMemberByOauthSub(oauthSub) {
      const m = tables.members.find((x) => x.oauthSub === oauthSub);
      return m ? { ...m } : null;
    },

    async getEventById(id) {
      const e = tables.events.find((x) => x.id === id);
      return e ? { ...e } : null;
    },

    async getTaskById(id) {
      const t = tables.tasks.find((x) => x.id === id);
      return t ? { ...t } : null;
    },

    /**
     * Upsert a member from an OAuth identity (FR-A2). Stable by oauthSub; the
     * handle is assigned once and kept stable, displayName refreshes on re-login.
     * @returns {Promise<{ member: object, created: boolean }>}
     */
    async provisionMember({ oauthSub, handle, displayName, roles }) {
      let existing = tables.members.find((m) => m.oauthSub === oauthSub);
      if (existing) {
        if (displayName) existing.displayName = displayName;
        return { member: { ...existing }, created: false };
      }
      const member = {
        id: newId("m"),
        handle: uniqueHandle(handle),
        displayName: displayName || handle,
        oauthSub,
        roles: Array.isArray(roles) ? roles : [],
        joinedAt: nowIso(),
      };
      tables.members.push(member);
      return { member: { ...member }, created: true };
    },

    /** Create an event (FR-E2). Returns the public read shape. */
    async createEvent({ title, description, startsAt, endsAt, location, url, hostId }) {
      const event = {
        id: newId("e"),
        title,
        description: description ?? null,
        startsAt,
        endsAt: endsAt ?? null,
        location: location ?? null,
        url: url ?? null,
        hostId: hostId ?? null,
        createdAt: nowIso(),
        hidden: false,
      };
      tables.events.push(event);
      return shapeEvent(event, {
        rsvps: tables.rsvps,
        checkIns: tables.checkIns,
        members: tables.members,
      });
    },

    /** Set (upsert) a member's standing RSVP for an event (FR-E3). */
    async setRsvp({ eventId, memberId, state }) {
      const existing = tables.rsvps.find((r) => r.eventId === eventId && r.memberId === memberId);
      if (existing) {
        existing.state = state;
        existing.updatedAt = nowIso();
        return { eventId, memberId, state, updatedAt: existing.updatedAt };
      }
      const row = { id: newId("rsvp"), eventId, memberId, state, updatedAt: nowIso() };
      tables.rsvps.push(row);
      return { eventId, memberId, state, updatedAt: row.updatedAt };
    },

    /**
     * Record live attendance, counted once per member/event (FR-E4). Idempotent:
     * a repeat check-in returns the original timestamp.
     */
    async checkIn({ eventId, memberId }) {
      let row = tables.checkIns.find((c) => c.eventId === eventId && c.memberId === memberId);
      let created = false;
      if (!row) {
        row = { id: newId("ci"), eventId, memberId, at: nowIso() };
        tables.checkIns.push(row);
        created = true;
      }
      return { eventId, memberId, at: row.at, created };
    },

    /**
     * Claim / un-claim a task (FR-T2). Also advances task.status:
     * first claim: open -> claimed; last un-claim: claimed -> open (done is sticky).
     * @returns the shaped task after mutation.
     */
    async claimTask({ taskId, memberId, action }) {
      const task = tables.tasks.find((t) => t.id === taskId);
      if (!task) return null;
      const idx = tables.taskClaims.findIndex((c) => c.taskId === taskId && c.memberId === memberId);
      if (action === "unclaim") {
        if (idx !== -1) tables.taskClaims.splice(idx, 1);
      } else if (idx === -1) {
        tables.taskClaims.push({ taskId, memberId, claimedAt: nowIso() });
      }
      const remaining = tables.taskClaims.filter((c) => c.taskId === taskId).length;
      if (task.status !== "done") {
        task.status = remaining > 0 ? "claimed" : "open";
      }
      return shapeTask(task, { claims: tables.taskClaims });
    },

    /**
     * Upsert opt-in presence for a member (FR-P1). One row per member.
     *
     * A moderator hide is STICKY: a member's own self-write must NOT clear a prior
     * moderator hide (constitution Art. VII — a control the reported party can
     * reverse at will is not a control). `hidden` is preserved on update and only
     * ever cleared via the moderator-gated un-hide path (unhideEntry).
     */
    async setPresence({ memberId, status, note }) {
      let row = tables.presence.find((p) => p.memberId === memberId);
      if (row) {
        row.status = status;
        row.note = note ?? null;
        row.updatedAt = nowIso();
        // Intentionally do NOT touch row.hidden here — see doc comment above.
      } else {
        row = { memberId, status, note: note ?? null, updatedAt: nowIso(), hidden: false };
        tables.presence.push(row);
      }
      return shapePresence(row, { members: tables.members });
    },

    /** Clear a member's presence (opt-in + revocable, FR-P1 / Art. V). */
    async clearPresence(memberId) {
      const before = tables.presence.length;
      tables.presence = tables.presence.filter((p) => p.memberId !== memberId);
      return { cleared: tables.presence.length < before };
    },

    // --- read path (M1) -----------------------------------------------------

    async listEvents() {
      return tables.events
        .filter((e) => !e.hidden)
        .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
        .map((e) =>
          shapeEvent(e, {
            rsvps: tables.rsvps,
            checkIns: tables.checkIns,
            members: tables.members,
          }),
        );
    },

    async listTasks() {
      return tables.tasks
        .filter((t) => !t.hidden)
        .sort((a, b) => {
          const s = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
          if (s !== 0) return s;
          return new Date(a.dueAt ?? a.createdAt ?? 0) - new Date(b.dueAt ?? b.createdAt ?? 0);
        })
        .map((t) => shapeTask(t, { claims: tables.taskClaims }));
    },

    async listPresence() {
      return tables.presence
        .filter((p) => !p.hidden)
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map((row) => shapePresence(row, { members: tables.members }));
    },

    // --- moderation + erasure (M4) ------------------------------------------

    /** Fetch a single presence row by member (existence check for reports). */
    async getPresence(memberId) {
      const p = tables.presence.find((x) => x.memberId === memberId);
      return p ? { ...p } : null;
    },

    /** File a report against an entry (FR-M2, Art. VII). */
    async createReport({ targetType, targetId, reporterId, reason }) {
      const row = {
        id: newId("rep"),
        targetType,
        targetId,
        reporterId: reporterId ?? null,
        reason: reason ?? null,
        createdAt: nowIso(),
        resolved: false,
      };
      tables.reports.push(row);
      return { ...row };
    },

    /**
     * Hide an entry so it drops out of public reads (FR-M2, Art. VII). Also
     * resolves any open reports for that target. Returns `{ found, resolvedReports }`.
     */
    async hideEntry({ targetType, targetId }) {
      let found = false;
      if (targetType === "event") {
        const e = tables.events.find((x) => x.id === targetId);
        if (e) { e.hidden = true; found = true; }
      } else if (targetType === "task") {
        const t = tables.tasks.find((x) => x.id === targetId);
        if (t) { t.hidden = true; found = true; }
      } else if (targetType === "presence") {
        const p = tables.presence.find((x) => x.memberId === targetId);
        if (p) { p.hidden = true; found = true; }
      }
      let resolvedReports = 0;
      if (found) {
        for (const r of tables.reports) {
          if (r.targetType === targetType && r.targetId === targetId && !r.resolved) {
            r.resolved = true;
            resolvedReports += 1;
          }
        }
      }
      return { found, targetType, targetId, resolvedReports };
    },

    /**
     * Un-hide an entry so it returns to public reads (FR-M2, Art. VII). Moderator-
     * gated at the handler layer: the ONLY way to reverse a moderator hide, for all
     * three target types. Mirrors hideEntry: `{ found, targetType, targetId }`.
     */
    async unhideEntry({ targetType, targetId }) {
      let found = false;
      if (targetType === "event") {
        const e = tables.events.find((x) => x.id === targetId);
        if (e) { e.hidden = false; found = true; }
      } else if (targetType === "task") {
        const t = tables.tasks.find((x) => x.id === targetId);
        if (t) { t.hidden = false; found = true; }
      } else if (targetType === "presence") {
        const p = tables.presence.find((x) => x.memberId === targetId);
        if (p) { p.hidden = false; found = true; }
      }
      return { found, targetType, targetId };
    },

    /**
     * Delete a member and erase their personal writes (FR-A3, Art. VIII — right to
     * erasure). Mirrors the SQL cascade: removes the member's RSVPs, check-ins, task
     * claims, and presence; de-identifies authored content (hosted events -> null
     * host, filed reports -> null reporter). Task status is recomputed for any task
     * the member had claimed (a removed claim can return claimed -> open).
     */
    async deleteMember(memberId) {
      const member = tables.members.find((m) => m.id === memberId);
      if (!member) return { deleted: false, memberId, erased: null };

      const affectedTaskIds = [
        ...new Set(tables.taskClaims.filter((c) => c.memberId === memberId).map((c) => c.taskId)),
      ];
      const erased = {
        rsvps: tables.rsvps.filter((r) => r.memberId === memberId).length,
        checkIns: tables.checkIns.filter((c) => c.memberId === memberId).length,
        taskClaims: tables.taskClaims.filter((c) => c.memberId === memberId).length,
        presence: tables.presence.some((p) => p.memberId === memberId) ? 1 : 0,
      };

      // Cascade-delete personal participation writes.
      tables.rsvps = tables.rsvps.filter((r) => r.memberId !== memberId);
      tables.checkIns = tables.checkIns.filter((c) => c.memberId !== memberId);
      tables.taskClaims = tables.taskClaims.filter((c) => c.memberId !== memberId);
      tables.presence = tables.presence.filter((p) => p.memberId !== memberId);
      // De-identify authored content (ON DELETE SET NULL in the schema).
      for (const e of tables.events) if (e.hostId === memberId) e.hostId = null;
      for (const r of tables.reports) if (r.reporterId === memberId) r.reporterId = null;
      // Remove the member row itself.
      tables.members = tables.members.filter((m) => m.id !== memberId);

      // Recompute status for tasks that lost a claim (done is sticky).
      for (const taskId of affectedTaskIds) {
        const task = tables.tasks.find((t) => t.id === taskId);
        if (!task || task.status === "done") continue;
        const remaining = tables.taskClaims.filter((c) => c.taskId === taskId).length;
        task.status = remaining > 0 ? "claimed" : "open";
      }

      return { deleted: true, memberId, erased };
    },
  };
}
