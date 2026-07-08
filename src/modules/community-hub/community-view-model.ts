// Pure view-model for the Community Hub shell surfaces (M3).
//
// This module holds the presentational logic the events feed, tasks board, and
// presence rail share, with zero React and zero I/O so it is unit-testable under
// vitest (environment: node). The .tsx surfaces stay thin: they call the bridge,
// drop the snapshot through these helpers, and render.
//
// Shapes come straight from the backend public read path
// (addons/resonant-community-hub/backend/src/repository.mjs):
//   Event    { id, title, description, startsAt, endsAt, location, url, hostId,
//              hostHandle, createdAt, rsvpCounts:{going,interested,no}, attendanceCount }
//   Task     { id, title, description, status, goalStepStatus, claimedBy[], dueAt, createdAt }
//   Presence { memberId, handle, displayName, status, note, updatedAt }

export type RsvpState = "going" | "interested" | "no";
export type TaskStatus = "open" | "claimed" | "done";
// Mirrors src/core/contracts.ts GoalStepStatus (FR-T3 — agents read this).
export type GoalStepStatus = "planned" | "active" | "blocked" | "completed" | "cancelled";
export type EventPhase = "live" | "upcoming" | "past";

export interface CommunityEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  hostId: string | null;
  hostHandle: string | null;
  createdAt: string | null;
  rsvpCounts: Record<RsvpState, number>;
  attendanceCount: number;
}

export interface CommunityTask {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  goalStepStatus: GoalStepStatus;
  claimedBy: string[];
  dueAt: string | null;
  createdAt: string | null;
}

export interface PresenceEntry {
  memberId: string;
  handle: string | null;
  displayName: string | null;
  status: string;
  note: string | null;
  updatedAt: string | null;
}

// Check-in window constants — kept identical to the backend guard in
// backend/src/write-handlers.mjs (handleCheckin) so the UI enables the button
// exactly when the server would accept the check-in (spec FR-E4).
export const CHECKIN_GRACE_MS = 15 * 60 * 1000;
export const DEFAULT_EVENT_DURATION_MS = 4 * 60 * 60 * 1000;

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function eventWindow(event: CommunityEvent): { start: number | null; end: number | null } {
  const start = ms(event.startsAt);
  if (start === null) return { start: null, end: null };
  const end = ms(event.endsAt) ?? start + DEFAULT_EVENT_DURATION_MS;
  return { start, end };
}

/** Live / upcoming / past classification at a given instant. */
export function deriveEventPhase(event: CommunityEvent, now: number = Date.now()): EventPhase {
  const { start, end } = eventWindow(event);
  if (start === null || end === null) return "upcoming";
  if (now < start) return "upcoming";
  if (now > end) return "past";
  return "live";
}

/** Whether the live check-in button should be enabled (matches the server window). */
export function canCheckIn(event: CommunityEvent, now: number = Date.now()): boolean {
  const { start, end } = eventWindow(event);
  if (start === null || end === null) return false;
  return now >= start - CHECKIN_GRACE_MS && now <= end + CHECKIN_GRACE_MS;
}

/** Split + sort events for the feed: live first, then soonest upcoming, then recent past. */
export function partitionEvents(
  events: CommunityEvent[],
  now: number = Date.now(),
): { live: CommunityEvent[]; upcoming: CommunityEvent[]; past: CommunityEvent[] } {
  const live: CommunityEvent[] = [];
  const upcoming: CommunityEvent[] = [];
  const past: CommunityEvent[] = [];
  for (const event of events ?? []) {
    const phase = deriveEventPhase(event, now);
    if (phase === "live") live.push(event);
    else if (phase === "upcoming") upcoming.push(event);
    else past.push(event);
  }
  const byStartAsc = (a: CommunityEvent, b: CommunityEvent) => (ms(a.startsAt) ?? 0) - (ms(b.startsAt) ?? 0);
  const byStartDesc = (a: CommunityEvent, b: CommunityEvent) => (ms(b.startsAt) ?? 0) - (ms(a.startsAt) ?? 0);
  live.sort(byStartAsc);
  upcoming.sort(byStartAsc);
  past.sort(byStartDesc);
  return { live, upcoming, past };
}

/** Short human RSVP summary, e.g. "5 going · 2 interested · 3 checked in". */
export function formatRsvpSummary(event: CommunityEvent): string {
  const counts = event.rsvpCounts ?? { going: 0, interested: 0, no: 0 };
  const parts = [`${counts.going ?? 0} going`, `${counts.interested ?? 0} interested`];
  if ((event.attendanceCount ?? 0) > 0) parts.push(`${event.attendanceCount} checked in`);
  return parts.join(" · ");
}

const TASK_ORDER: Record<TaskStatus, number> = { open: 0, claimed: 1, done: 2 };

/** Group tasks into the board columns, each sorted by due date then creation. */
export function groupTasksByStatus(
  tasks: CommunityTask[],
): Record<TaskStatus, CommunityTask[]> {
  const groups: Record<TaskStatus, CommunityTask[]> = { open: [], claimed: [], done: [] };
  for (const task of tasks ?? []) {
    (groups[task.status] ?? groups.open).push(task);
  }
  const byDue = (a: CommunityTask, b: CommunityTask) =>
    (ms(a.dueAt) ?? ms(a.createdAt) ?? 0) - (ms(b.dueAt) ?? ms(b.createdAt) ?? 0);
  for (const key of Object.keys(groups) as TaskStatus[]) groups[key].sort(byDue);
  return groups;
}

export function isTaskClaimedBy(task: CommunityTask, memberId: string | null): boolean {
  if (!memberId) return false;
  return Array.isArray(task.claimedBy) && task.claimedBy.includes(memberId);
}

/** The action a claim toggle should send for the current member. */
export function nextClaimAction(task: CommunityTask, memberId: string | null): "claim" | "unclaim" {
  return isTaskClaimedBy(task, memberId) ? "unclaim" : "claim";
}

/** Presence rail ordering: most recently updated first. Callers pass already-hidden-filtered rows. */
export function sortPresence(entries: PresenceEntry[]): PresenceEntry[] {
  return [...(entries ?? [])].sort((a, b) => (ms(b.updatedAt) ?? 0) - (ms(a.updatedAt) ?? 0));
}

/** Best display label for a member row (displayName, else @handle, else id). */
export function memberLabel(entry: { displayName?: string | null; handle?: string | null; memberId?: string }): string {
  if (entry.displayName) return entry.displayName;
  if (entry.handle) return `@${entry.handle}`;
  return entry.memberId ?? "member";
}
