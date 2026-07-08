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
 * hidden rows, orders identically, computes the same counts.
 *
 * @param {object} [seed] raw tables { members, events, rsvps, checkIns, tasks, taskClaims, presence, reports }
 * @returns {Repository & { tables: object, load: (t: object) => void }}
 */
export function createMemoryRepository(seed = {}) {
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

  return {
    tables,
    load,

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
        .slice()
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .map((row) => shapePresence(row, { members: tables.members }));
    },
  };
}
