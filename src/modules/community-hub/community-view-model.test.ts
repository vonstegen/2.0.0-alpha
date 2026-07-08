import { describe, expect, it } from "vitest";
import {
  canCheckIn,
  CHECKIN_GRACE_MS,
  deriveEventPhase,
  formatRsvpSummary,
  groupTasksByStatus,
  isTaskClaimedBy,
  memberLabel,
  nextClaimAction,
  partitionEvents,
  sortPresence,
  type CommunityEvent,
  type CommunityTask,
  type PresenceEntry,
} from "./community-view-model";

const T0 = Date.parse("2026-07-08T18:00:00.000Z");

function evt(overrides: Partial<CommunityEvent>): CommunityEvent {
  return {
    id: "e",
    title: "Event",
    description: null,
    startsAt: null,
    endsAt: null,
    location: null,
    url: null,
    hostId: null,
    hostHandle: null,
    createdAt: null,
    rsvpCounts: { going: 0, interested: 0, no: 0 },
    attendanceCount: 0,
    ...overrides,
  };
}

function task(overrides: Partial<CommunityTask>): CommunityTask {
  return {
    id: "t",
    title: "Task",
    description: null,
    status: "open",
    goalStepStatus: "planned",
    claimedBy: [],
    dueAt: null,
    createdAt: null,
    ...overrides,
  };
}

describe("deriveEventPhase / canCheckIn (matches backend FR-E4 window)", () => {
  const start = new Date(T0).toISOString();
  const end = new Date(T0 + 60 * 60 * 1000).toISOString();
  const live = evt({ startsAt: start, endsAt: end });

  it("classifies live / upcoming / past", () => {
    expect(deriveEventPhase(live, T0 + 10 * 60 * 1000)).toBe("live");
    expect(deriveEventPhase(live, T0 - 2 * 60 * 60 * 1000)).toBe("upcoming");
    expect(deriveEventPhase(live, T0 + 5 * 60 * 60 * 1000)).toBe("past");
  });

  it("treats a missing start as upcoming", () => {
    expect(deriveEventPhase(evt({}), T0)).toBe("upcoming");
  });

  it("enables check-in within the grace window and disables it outside", () => {
    expect(canCheckIn(live, T0 - CHECKIN_GRACE_MS + 1000)).toBe(true);
    expect(canCheckIn(live, T0 + 30 * 60 * 1000)).toBe(true);
    expect(canCheckIn(live, T0 - CHECKIN_GRACE_MS - 1000)).toBe(false);
    expect(canCheckIn(live, T0 + 60 * 60 * 1000 + CHECKIN_GRACE_MS + 1000)).toBe(false);
  });
});

describe("partitionEvents", () => {
  it("splits and orders live-first, upcoming-asc, past-desc", () => {
    const events = [
      evt({ id: "past1", startsAt: new Date(T0 - 10 * 60 * 60 * 1000).toISOString(), endsAt: new Date(T0 - 9 * 60 * 60 * 1000).toISOString() }),
      evt({ id: "up-late", startsAt: new Date(T0 + 48 * 60 * 60 * 1000).toISOString() }),
      evt({ id: "up-soon", startsAt: new Date(T0 + 2 * 60 * 60 * 1000).toISOString() }),
      evt({ id: "live", startsAt: new Date(T0 - 5 * 60 * 1000).toISOString(), endsAt: new Date(T0 + 55 * 60 * 1000).toISOString() }),
    ];
    const { live, upcoming, past } = partitionEvents(events, T0);
    expect(live.map((e) => e.id)).toEqual(["live"]);
    expect(upcoming.map((e) => e.id)).toEqual(["up-soon", "up-late"]);
    expect(past.map((e) => e.id)).toEqual(["past1"]);
  });
});

describe("formatRsvpSummary", () => {
  it("includes check-in count only when attendance > 0", () => {
    expect(formatRsvpSummary(evt({ rsvpCounts: { going: 5, interested: 2, no: 1 } }))).toBe("5 going · 2 interested");
    expect(formatRsvpSummary(evt({ rsvpCounts: { going: 5, interested: 2, no: 1 }, attendanceCount: 3 }))).toBe(
      "5 going · 2 interested · 3 checked in",
    );
  });
});

describe("tasks board grouping + claim actions", () => {
  it("groups by status and sorts each column by due date", () => {
    const tasks = [
      task({ id: "a", status: "open", dueAt: new Date(T0 + 2000).toISOString() }),
      task({ id: "b", status: "open", dueAt: new Date(T0 + 1000).toISOString() }),
      task({ id: "c", status: "claimed", claimedBy: ["m1"] }),
      task({ id: "d", status: "done" }),
    ];
    const groups = groupTasksByStatus(tasks);
    expect(groups.open.map((t) => t.id)).toEqual(["b", "a"]);
    expect(groups.claimed.map((t) => t.id)).toEqual(["c"]);
    expect(groups.done.map((t) => t.id)).toEqual(["d"]);
  });

  it("derives the toggle action from the current member's claim", () => {
    const claimed = task({ status: "claimed", claimedBy: ["m1", "m2"] });
    expect(isTaskClaimedBy(claimed, "m1")).toBe(true);
    expect(nextClaimAction(claimed, "m1")).toBe("unclaim");
    expect(nextClaimAction(claimed, "m9")).toBe("claim");
    expect(nextClaimAction(claimed, null)).toBe("claim");
  });
});

describe("presence rail", () => {
  it("orders by most recently updated", () => {
    const rows: PresenceEntry[] = [
      { memberId: "m1", handle: "a", displayName: "Ann", status: "around", note: null, updatedAt: new Date(T0 - 5000).toISOString() },
      { memberId: "m2", handle: "b", displayName: "Bo", status: "around", note: "prepping", updatedAt: new Date(T0).toISOString() },
    ];
    expect(sortPresence(rows).map((r) => r.memberId)).toEqual(["m2", "m1"]);
  });

  it("labels a member by displayName, then handle, then id", () => {
    expect(memberLabel({ displayName: "Ann", handle: "a" })).toBe("Ann");
    expect(memberLabel({ displayName: null, handle: "a" })).toBe("@a");
    expect(memberLabel({ displayName: null, handle: null, memberId: "m1" })).toBe("m1");
  });
});
