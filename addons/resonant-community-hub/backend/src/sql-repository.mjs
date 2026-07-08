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
 */
export function createSqlRepository(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("createSqlRepository requires a db executor with a query(text, params) method");
  }

  return {
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
