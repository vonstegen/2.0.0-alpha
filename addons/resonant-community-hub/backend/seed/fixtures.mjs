// Deterministic seed fixtures for local/preview and offline tests.
//
// Timestamps are fixed ISO strings so tests are clock-independent. Data is chosen
// to exercise the read path: multiple RSVP states, live check-ins distinct from
// RSVPs, a multi-claim task, every task status, opt-in presence for a subset of
// members, and HIDDEN event + task rows that must NOT appear in public reads
// (constitution Art. VII).
//
// `fixtures()` returns a fresh deep copy each call so callers can mutate freely.

const RAW = {
  members: [
    { id: "m_ada", handle: "ada", displayName: "Ada L.", oauthSub: "gh|1001", roles: ["organizer"], joinedAt: "2026-01-04T10:00:00.000Z" },
    { id: "m_grace", handle: "grace", displayName: "Grace H.", oauthSub: "gh|1002", roles: ["moderator"], joinedAt: "2026-01-05T10:00:00.000Z" },
    { id: "m_alan", handle: "alan", displayName: "Alan T.", oauthSub: "gh|1003", roles: [], joinedAt: "2026-02-01T10:00:00.000Z" },
    { id: "m_kata", handle: "kata", displayName: "Katherine J.", oauthSub: "gh|1004", roles: [], joinedAt: "2026-03-12T10:00:00.000Z" },
  ],

  events: [
    {
      id: "e_kickoff",
      title: "Community Kickoff Meetup",
      description: "First in-person gathering for the season. Lightning talks + hangout.",
      startsAt: "2026-07-20T18:00:00.000Z",
      endsAt: "2026-07-20T20:30:00.000Z",
      location: "The Commons, 5th floor",
      url: null,
      hostId: "m_ada",
      createdAt: "2026-06-30T09:00:00.000Z",
      hidden: false,
    },
    {
      id: "e_workshop",
      title: "Async Workshop: Building Add-ons",
      description: "Hands-on session building a ResonantOS add-on. Online.",
      startsAt: "2026-07-28T16:00:00.000Z",
      endsAt: "2026-07-28T17:30:00.000Z",
      location: null,
      url: "https://meet.example.org/addons-workshop",
      hostId: "m_grace",
      createdAt: "2026-07-01T09:00:00.000Z",
      hidden: false,
    },
    {
      id: "e_retro",
      title: "Spring Retro",
      description: "Looking back on the spring cohort.",
      startsAt: "2026-05-10T17:00:00.000Z",
      endsAt: "2026-05-10T18:00:00.000Z",
      location: "Online",
      url: "https://meet.example.org/spring-retro",
      hostId: "m_ada",
      createdAt: "2026-04-20T09:00:00.000Z",
      hidden: false,
    },
    {
      id: "e_spam",
      title: "[HIDDEN] Buy followers now!!!",
      description: "Moderated spam event — must never appear in public reads.",
      startsAt: "2026-07-22T12:00:00.000Z",
      endsAt: null,
      location: null,
      url: "https://spam.example.com",
      hostId: null,
      createdAt: "2026-07-02T03:00:00.000Z",
      hidden: true,
    },
  ],

  rsvps: [
    { id: "rsvp_1", eventId: "e_kickoff", memberId: "m_ada", state: "going", updatedAt: "2026-07-01T10:00:00.000Z" },
    { id: "rsvp_2", eventId: "e_kickoff", memberId: "m_alan", state: "going", updatedAt: "2026-07-02T10:00:00.000Z" },
    { id: "rsvp_3", eventId: "e_kickoff", memberId: "m_kata", state: "interested", updatedAt: "2026-07-03T10:00:00.000Z" },
    { id: "rsvp_4", eventId: "e_kickoff", memberId: "m_grace", state: "no", updatedAt: "2026-07-03T12:00:00.000Z" },
    { id: "rsvp_5", eventId: "e_workshop", memberId: "m_alan", state: "interested", updatedAt: "2026-07-04T10:00:00.000Z" },
    { id: "rsvp_6", eventId: "e_retro", memberId: "m_ada", state: "going", updatedAt: "2026-05-01T10:00:00.000Z" },
    { id: "rsvp_7", eventId: "e_retro", memberId: "m_kata", state: "going", updatedAt: "2026-05-02T10:00:00.000Z" },
  ],

  // Live attendance — deliberately NOT the same set as RSVPs (spec FR-E4).
  checkIns: [
    { id: "ci_1", eventId: "e_retro", memberId: "m_ada", at: "2026-05-10T17:03:00.000Z" },
    { id: "ci_2", eventId: "e_retro", memberId: "m_kata", at: "2026-05-10T17:05:00.000Z" },
    { id: "ci_3", eventId: "e_retro", memberId: "m_alan", at: "2026-05-10T17:12:00.000Z" }, // attended without RSVP
  ],

  tasks: [
    { id: "t_venue", title: "Confirm venue for kickoff", description: "Lock the 5th-floor room and A/V.", status: "open", dueAt: "2026-07-15T00:00:00.000Z", createdAt: "2026-07-01T09:00:00.000Z", hidden: false },
    { id: "t_notes", title: "Take notes at kickoff", description: "Capture lightning-talk notes for the archive intake.", status: "claimed", dueAt: "2026-07-20T00:00:00.000Z", createdAt: "2026-07-01T09:05:00.000Z", hidden: false },
    { id: "t_slides", title: "Prepare workshop slides", description: "Draft the add-on workshop deck.", status: "claimed", dueAt: "2026-07-25T00:00:00.000Z", createdAt: "2026-07-01T09:10:00.000Z", hidden: false },
    { id: "t_recap", title: "Publish spring retro recap", description: "Write up the retro outcomes.", status: "done", dueAt: "2026-05-15T00:00:00.000Z", createdAt: "2026-04-21T09:00:00.000Z", hidden: false },
    { id: "t_spam", title: "[HIDDEN] Free crypto airdrop", description: "Moderated spam task — must never appear.", status: "open", dueAt: null, createdAt: "2026-07-02T03:10:00.000Z", hidden: true },
  ],

  taskClaims: [
    { taskId: "t_notes", memberId: "m_alan", claimedAt: "2026-07-03T09:00:00.000Z" },
    { taskId: "t_slides", memberId: "m_kata", claimedAt: "2026-07-03T09:30:00.000Z" },
    { taskId: "t_slides", memberId: "m_ada", claimedAt: "2026-07-04T09:30:00.000Z" }, // multi-claim
  ],

  // Opt-in presence: only members who set it appear. grace/kata have none.
  presence: [
    { memberId: "m_ada", status: "prepping slides", note: "Kickoff deck WIP", updatedAt: "2026-07-07T14:00:00.000Z" },
    { memberId: "m_alan", status: "reviewing PRs", note: null, updatedAt: "2026-07-07T15:30:00.000Z" },
  ],

  reports: [
    { id: "rep_1", targetType: "event", targetId: "e_spam", reporterId: "m_grace", reason: "spam", createdAt: "2026-07-02T04:00:00.000Z", resolved: true },
  ],
};

/** @returns {typeof RAW} a fresh deep copy of the fixture tables */
export function fixtures() {
  return JSON.parse(JSON.stringify(RAW));
}
