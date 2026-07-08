// Neon Postgres implementation of the read-path Repository.
//
// Takes an injected SQL executor `db` with `db.query(text, params) => { rows }`
// (the shape of a `@neondatabase/serverless` Pool and of node-postgres). Keeping
// the driver injected means:
//   - production wires the real Neon Pool (db/neon.mjs),
//   - tests can drive it with a tiny fake executor without a live database.
//
// The SQL below is the source of truth for what the hosted backend computes; the
// in-memory repository mirrors it. Hidden rows are excluded (constitution Art. VII).

import { taskStatusToGoalStepStatus } from "./goal-mapping.mjs";

const LIST_EVENTS_SQL = `
  SELECT
    e.id,
    e.title,
    e.description,
    e.starts_at,
    e.ends_at,
    e.location,
    e.url,
    e.host_id,
    h.handle AS host_handle,
    e.created_at,
    COALESCE(r.going, 0)       AS going,
    COALESCE(r.interested, 0)  AS interested,
    COALESCE(r.no, 0)          AS no,
    COALESCE(c.attendance, 0)  AS attendance
  FROM events e
  LEFT JOIN members h ON h.id = e.host_id
  LEFT JOIN (
    SELECT event_id,
           COUNT(*) FILTER (WHERE state = 'going')      AS going,
           COUNT(*) FILTER (WHERE state = 'interested') AS interested,
           COUNT(*) FILTER (WHERE state = 'no')         AS no
    FROM rsvps
    GROUP BY event_id
  ) r ON r.event_id = e.id
  LEFT JOIN (
    SELECT event_id, COUNT(DISTINCT member_id) AS attendance
    FROM check_ins
    GROUP BY event_id
  ) c ON c.event_id = e.id
  WHERE e.hidden = false
  ORDER BY e.starts_at ASC;
`;

const LIST_TASKS_SQL = `
  SELECT
    t.id,
    t.title,
    t.description,
    t.status,
    t.due_at,
    t.created_at,
    COALESCE(
      ARRAY(
        SELECT tc.member_id
        FROM task_claims tc
        WHERE tc.task_id = t.id
        ORDER BY tc.claimed_at ASC
      ),
      '{}'
    ) AS claimed_by
  FROM tasks t
  WHERE t.hidden = false
  ORDER BY
    CASE t.status WHEN 'open' THEN 0 WHEN 'claimed' THEN 1 WHEN 'done' THEN 2 ELSE 9 END ASC,
    COALESCE(t.due_at, t.created_at) ASC;
`;

const LIST_PRESENCE_SQL = `
  SELECT
    p.member_id,
    m.handle,
    m.display_name,
    p.status,
    p.note,
    p.updated_at
  FROM presence p
  JOIN members m ON m.id = p.member_id
  WHERE p.hidden = false
  ORDER BY p.updated_at DESC;
`;

function iso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function num(value) {
  return typeof value === "number" ? value : Number.parseInt(value, 10) || 0;
}

/**
 * @param {{ query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {{ now?: () => number, newId?: (prefix: string) => string }} [opts]
 */
export function createSqlRepository(db, opts = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("createSqlRepository requires a db executor with a query(text, params) method");
  }
  const now = opts.now ?? Date.now;
  let seq = 0;
  const newId = opts.newId ?? ((prefix) => `${prefix}_${(++seq).toString(36)}${now().toString(36)}`);
  const nowIso = () => new Date(now()).toISOString();

  async function memberRow(id) {
    const { rows } = await db.query(
      "SELECT id, handle, display_name, oauth_sub, roles, joined_at FROM members WHERE id = $1",
      [id],
    );
    return rows[0] ?? null;
  }
  function mapMember(row) {
    if (!row) return null;
    return {
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      oauthSub: row.oauth_sub,
      roles: Array.isArray(row.roles) ? row.roles : [],
      joinedAt: iso(row.joined_at),
    };
  }

  const write = {
    async getMemberById(id) {
      return mapMember(await memberRow(id));
    },

    async getMemberByOauthSub(oauthSub) {
      const { rows } = await db.query(
        "SELECT id, handle, display_name, oauth_sub, roles, joined_at FROM members WHERE oauth_sub = $1",
        [oauthSub],
      );
      return mapMember(rows[0]);
    },

    async getEventById(id) {
      const { rows } = await db.query("SELECT * FROM events WHERE id = $1", [id]);
      const e = rows[0];
      if (!e) return null;
      return {
        id: e.id,
        title: e.title,
        description: e.description ?? null,
        startsAt: iso(e.starts_at),
        endsAt: iso(e.ends_at),
        location: e.location ?? null,
        url: e.url ?? null,
        hostId: e.host_id ?? null,
        createdAt: iso(e.created_at),
        hidden: e.hidden === true,
      };
    },

    async getTaskById(id) {
      const { rows } = await db.query("SELECT id, status, hidden FROM tasks WHERE id = $1", [id]);
      const t = rows[0];
      return t ? { id: t.id, status: t.status, hidden: t.hidden === true } : null;
    },

    async provisionMember({ oauthSub, handle, displayName, roles }) {
      const existing = await write.getMemberByOauthSub(oauthSub);
      if (existing) {
        if (displayName) {
          await db.query("UPDATE members SET display_name = $2 WHERE id = $1", [existing.id, displayName]);
          existing.displayName = displayName;
        }
        return { member: existing, created: false };
      }
      // Assign a stable, unique handle (retry with a numeric suffix on collision).
      const base = String(handle || "member").toLowerCase().replace(/[^a-z0-9_-]+/g, "").slice(0, 39) || "member";
      let finalHandle = base;
      for (let n = 2; n < 1000; n += 1) {
        const { rows } = await db.query("SELECT 1 FROM members WHERE handle = $1", [finalHandle]);
        if (rows.length === 0) break;
        finalHandle = `${base}-${n}`;
      }
      const id = newId("m");
      await db.query(
        "INSERT INTO members (id, handle, display_name, oauth_sub, roles, joined_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, finalHandle, displayName || finalHandle, oauthSub, Array.isArray(roles) ? roles : [], nowIso()],
      );
      const member = await write.getMemberById(id);
      return { member, created: true };
    },

    async createEvent({ title, description, startsAt, endsAt, location, url, hostId }) {
      const id = newId("e");
      await db.query(
        `INSERT INTO events (id, title, description, starts_at, ends_at, location, url, host_id, created_at, hidden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
        [id, title, description ?? null, startsAt, endsAt ?? null, location ?? null, url ?? null, hostId ?? null, nowIso()],
      );
      const [event] = await write.listOneEvent(id);
      return event;
    },

    // Shape a single event through the same read query (keeps parity with reads).
    async listOneEvent(id) {
      const { rows } = await db.query(
        `SELECT e.id, e.title, e.description, e.starts_at, e.ends_at, e.location, e.url,
                e.host_id, h.handle AS host_handle, e.created_at,
                COALESCE(r.going,0) going, COALESCE(r.interested,0) interested, COALESCE(r.no,0) no,
                COALESCE(c.attendance,0) attendance
         FROM events e
         LEFT JOIN members h ON h.id = e.host_id
         LEFT JOIN (SELECT event_id,
                      COUNT(*) FILTER (WHERE state='going') going,
                      COUNT(*) FILTER (WHERE state='interested') interested,
                      COUNT(*) FILTER (WHERE state='no') no
                    FROM rsvps GROUP BY event_id) r ON r.event_id = e.id
         LEFT JOIN (SELECT event_id, COUNT(DISTINCT member_id) attendance
                    FROM check_ins GROUP BY event_id) c ON c.event_id = e.id
         WHERE e.id = $1`,
        [id],
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        location: row.location ?? null,
        url: row.url ?? null,
        hostId: row.host_id ?? null,
        hostHandle: row.host_handle ?? null,
        createdAt: iso(row.created_at),
        rsvpCounts: { going: num(row.going), interested: num(row.interested), no: num(row.no) },
        attendanceCount: num(row.attendance),
      }));
    },

    async setRsvp({ eventId, memberId, state }) {
      const updatedAt = nowIso();
      await db.query(
        `INSERT INTO rsvps (id, event_id, member_id, state, updated_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (event_id, member_id) DO UPDATE SET state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
        [newId("rsvp"), eventId, memberId, state, updatedAt],
      );
      return { eventId, memberId, state, updatedAt };
    },

    async checkIn({ eventId, memberId }) {
      const at = nowIso();
      const { rows } = await db.query(
        `INSERT INTO check_ins (id, event_id, member_id, at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (event_id, member_id) DO NOTHING RETURNING at`,
        [newId("ci"), eventId, memberId, at],
      );
      if (rows[0]) return { eventId, memberId, at: iso(rows[0].at), created: true };
      const existing = await db.query(
        "SELECT at FROM check_ins WHERE event_id = $1 AND member_id = $2",
        [eventId, memberId],
      );
      return { eventId, memberId, at: iso(existing.rows[0]?.at), created: false };
    },

    async claimTask({ taskId, memberId, action }) {
      const task = await write.getTaskById(taskId);
      if (!task) return null;
      if (action === "unclaim") {
        await db.query("DELETE FROM task_claims WHERE task_id = $1 AND member_id = $2", [taskId, memberId]);
      } else {
        await db.query(
          "INSERT INTO task_claims (task_id, member_id, claimed_at) VALUES ($1,$2,$3) ON CONFLICT (task_id, member_id) DO NOTHING",
          [taskId, memberId, nowIso()],
        );
      }
      const { rows: countRows } = await db.query(
        "SELECT COUNT(*)::int AS n FROM task_claims WHERE task_id = $1",
        [taskId],
      );
      const remaining = num(countRows[0]?.n);
      if (task.status !== "done") {
        await db.query("UPDATE tasks SET status = $2 WHERE id = $1", [taskId, remaining > 0 ? "claimed" : "open"]);
      }
      const { rows } = await db.query(
        `SELECT t.id, t.title, t.description, t.status, t.due_at, t.created_at,
                COALESCE(ARRAY(SELECT tc.member_id FROM task_claims tc WHERE tc.task_id = t.id ORDER BY tc.claimed_at ASC), '{}') AS claimed_by
         FROM tasks t WHERE t.id = $1`,
        [taskId],
      );
      const row = rows[0];
      return {
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        status: row.status,
        goalStepStatus: taskStatusToGoalStepStatus(row.status),
        claimedBy: Array.isArray(row.claimed_by) ? row.claimed_by : [],
        dueAt: iso(row.due_at),
        createdAt: iso(row.created_at),
      };
    },

    async setPresence({ memberId, status, note }) {
      const updatedAt = nowIso();
      // A moderator hide is STICKY: a member's own self-write must NOT clear it
      // (constitution Art. VII — the reported party cannot reverse a moderation
      // control). On a fresh insert hidden defaults to false; on conflict we
      // deliberately DO NOT touch `hidden` (only unhideEntry clears it). Mirrors the
      // in-memory repository (M4).
      await db.query(
        `INSERT INTO presence (member_id, status, note, updated_at, hidden) VALUES ($1,$2,$3,$4,false)
         ON CONFLICT (member_id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
        [memberId, status, note ?? null, updatedAt],
      );
      const { rows } = await db.query(
        `SELECT p.member_id, m.handle, m.display_name, p.status, p.note, p.updated_at
         FROM presence p JOIN members m ON m.id = p.member_id WHERE p.member_id = $1`,
        [memberId],
      );
      const row = rows[0];
      return {
        memberId: row.member_id,
        handle: row.handle ?? null,
        displayName: row.display_name ?? null,
        status: row.status,
        note: row.note ?? null,
        updatedAt: iso(row.updated_at),
      };
    },

    async clearPresence(memberId) {
      // RETURNING makes the deleted-count portable across drivers (node-postgres
      // exposes rowCount; PGlite exposes affectedRows — RETURNING rows works on both).
      const { rows } = await db.query(
        "DELETE FROM presence WHERE member_id = $1 RETURNING member_id",
        [memberId],
      );
      return { cleared: Array.isArray(rows) && rows.length > 0 };
    },

    // --- moderation + erasure (M4) ------------------------------------------

    async getPresence(memberId) {
      const { rows } = await db.query(
        "SELECT member_id, status, note, updated_at, hidden FROM presence WHERE member_id = $1",
        [memberId],
      );
      const p = rows[0];
      if (!p) return null;
      return {
        memberId: p.member_id,
        status: p.status,
        note: p.note ?? null,
        updatedAt: iso(p.updated_at),
        hidden: p.hidden === true,
      };
    },

    async createReport({ targetType, targetId, reporterId, reason }) {
      const id = newId("rep");
      const createdAt = nowIso();
      await db.query(
        `INSERT INTO reports (id, target_type, target_id, reporter_id, reason, created_at, resolved)
         VALUES ($1,$2,$3,$4,$5,$6,false)`,
        [id, targetType, targetId, reporterId ?? null, reason ?? null, createdAt],
      );
      return { id, targetType, targetId, reporterId: reporterId ?? null, reason: reason ?? null, createdAt, resolved: false };
    },

    async hideEntry({ targetType, targetId }) {
      let found = false;
      if (targetType === "event") {
        const { rows } = await db.query("UPDATE events SET hidden = true WHERE id = $1 RETURNING id", [targetId]);
        found = rows.length > 0;
      } else if (targetType === "task") {
        const { rows } = await db.query("UPDATE tasks SET hidden = true WHERE id = $1 RETURNING id", [targetId]);
        found = rows.length > 0;
      } else if (targetType === "presence") {
        const { rows } = await db.query("UPDATE presence SET hidden = true WHERE member_id = $1 RETURNING member_id", [targetId]);
        found = rows.length > 0;
      }
      let resolvedReports = 0;
      if (found) {
        const { rows } = await db.query(
          "UPDATE reports SET resolved = true WHERE target_type = $1 AND target_id = $2 AND resolved = false RETURNING id",
          [targetType, targetId],
        );
        resolvedReports = Array.isArray(rows) ? rows.length : 0;
      }
      return { found, targetType, targetId, resolvedReports };
    },

    async unhideEntry({ targetType, targetId }) {
      // Moderator-gated reversal of a hide (the only path that clears `hidden`).
      let found = false;
      if (targetType === "event") {
        const { rows } = await db.query("UPDATE events SET hidden = false WHERE id = $1 RETURNING id", [targetId]);
        found = rows.length > 0;
      } else if (targetType === "task") {
        const { rows } = await db.query("UPDATE tasks SET hidden = false WHERE id = $1 RETURNING id", [targetId]);
        found = rows.length > 0;
      } else if (targetType === "presence") {
        const { rows } = await db.query("UPDATE presence SET hidden = false WHERE member_id = $1 RETURNING member_id", [targetId]);
        found = rows.length > 0;
      }
      return { found, targetType, targetId };
    },

    async deleteMember(memberId) {
      const exists = await write.getMemberById(memberId);
      if (!exists) return { deleted: false, memberId, erased: null };

      // Capture affected tasks + erasure counts BEFORE the cascade removes the rows.
      const affected = await db.query("SELECT DISTINCT task_id FROM task_claims WHERE member_id = $1", [memberId]);
      const affectedTaskIds = affected.rows.map((r) => r.task_id);
      const counts = await db.query(
        `SELECT
           (SELECT COUNT(*)::int FROM rsvps      WHERE member_id = $1) AS rsvps,
           (SELECT COUNT(*)::int FROM check_ins  WHERE member_id = $1) AS check_ins,
           (SELECT COUNT(*)::int FROM task_claims WHERE member_id = $1) AS task_claims,
           (SELECT COUNT(*)::int FROM presence   WHERE member_id = $1) AS presence`,
        [memberId],
      );
      const c = counts.rows[0] ?? {};

      // ON DELETE CASCADE removes rsvps/check_ins/task_claims/presence; ON DELETE
      // SET NULL de-identifies hosted events + filed reports (0001_init.sql).
      await db.query("DELETE FROM members WHERE id = $1", [memberId]);

      // The cascade does not recompute task.status, so do it explicitly (parity with
      // the in-memory repo + claimTask semantics): a lost claim can reopen a task.
      for (const taskId of affectedTaskIds) {
        const { rows: taskRows } = await db.query("SELECT status FROM tasks WHERE id = $1", [taskId]);
        if (!taskRows[0] || taskRows[0].status === "done") continue;
        const { rows: countRows } = await db.query("SELECT COUNT(*)::int AS n FROM task_claims WHERE task_id = $1", [taskId]);
        const remaining = num(countRows[0]?.n);
        await db.query("UPDATE tasks SET status = $2 WHERE id = $1", [taskId, remaining > 0 ? "claimed" : "open"]);
      }

      return {
        deleted: true,
        memberId,
        erased: {
          rsvps: num(c.rsvps),
          checkIns: num(c.check_ins),
          taskClaims: num(c.task_claims),
          presence: num(c.presence),
        },
      };
    },
  };

  return {
    ...write,

    async listEvents() {
      const { rows } = await db.query(LIST_EVENTS_SQL);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        startsAt: iso(row.starts_at),
        endsAt: iso(row.ends_at),
        location: row.location ?? null,
        url: row.url ?? null,
        hostId: row.host_id ?? null,
        hostHandle: row.host_handle ?? null,
        createdAt: iso(row.created_at),
        rsvpCounts: {
          going: num(row.going),
          interested: num(row.interested),
          no: num(row.no),
        },
        attendanceCount: num(row.attendance),
      }));
    },

    async listTasks() {
      const { rows } = await db.query(LIST_TASKS_SQL);
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description ?? null,
        status: row.status,
        goalStepStatus: taskStatusToGoalStepStatus(row.status),
        claimedBy: Array.isArray(row.claimed_by) ? row.claimed_by : [],
        dueAt: iso(row.due_at),
        createdAt: iso(row.created_at),
      }));
    },

    async listPresence() {
      const { rows } = await db.query(LIST_PRESENCE_SQL);
      return rows.map((row) => ({
        memberId: row.member_id,
        handle: row.handle ?? null,
        displayName: row.display_name ?? null,
        status: row.status,
        note: row.note ?? null,
        updatedAt: iso(row.updated_at),
      }));
    },
  };
}

export const _sql = { LIST_EVENTS_SQL, LIST_TASKS_SQL, LIST_PRESENCE_SQL };
