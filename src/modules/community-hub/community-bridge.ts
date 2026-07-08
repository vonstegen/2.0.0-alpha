// Bridge client for the Community Hub surfaces (M3).
//
// Constitution Art. II: the extension/shell NEVER calls the hosted Community API
// directly. Every call here goes through the local-service host (the loopback
// http-json server in addons/resonant-community-hub/src/http-server.mjs) via the
// injected `transport`. The transport is the bridge RPC boundary — the shell wires
// a real one (bridge -> 127.0.0.1:4890); tests pass a fake. Under no path does this
// module hold the Community API base URL or the member token.
//
// Writes are user-initiated from a surface, so they carry `source: "user"`; the
// host's approval gate (Art. V) only blocks `source: "agent"` calls. Agent writes
// come from the delegation fabric, not from these surface actions.

import type { CommunityEvent, CommunityTask, PresenceEntry, RsvpState } from "./community-view-model";

/** The bridge RPC seam: a single call into the local-service host. */
export type CommunityHostTransport = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

export interface CommunitySnapshot {
  events: CommunityEvent[];
  tasks: CommunityTask[];
  presence: PresenceEntry[];
  degraded: boolean;
  fetchedAt: string | null;
  lastError: string | null;
}

export interface CommunityHostStatus {
  ok: boolean;
  service: string;
  baseUrl: string;
  signedIn: boolean;
  backend: { reachable: boolean; detail: string };
  checkedAt: string;
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function createCommunityBridge(transport: CommunityHostTransport) {
  if (typeof transport !== "function") {
    throw new Error("createCommunityBridge requires a host transport function.");
  }

  return {
    async status(): Promise<CommunityHostStatus> {
      return (await transport("community.status")) as CommunityHostStatus;
    },

    /** Latest reconciled snapshot the host's poller holds (Art. VI polling sync). */
    async snapshot(): Promise<CommunitySnapshot> {
      const raw = asRecord(await transport("community.snapshot"));
      return {
        events: asArray<CommunityEvent>(raw.events),
        tasks: asArray<CommunityTask>(raw.tasks),
        presence: asArray<PresenceEntry>(raw.presence),
        degraded: Boolean(raw.degraded),
        fetchedAt: (raw.fetchedAt as string) ?? null,
        lastError: (raw.lastError as string) ?? null,
      };
    },

    // Direct reads (also available via the poller snapshot) — used for a manual refresh.
    async listEvents(): Promise<CommunityEvent[]> {
      return asArray<CommunityEvent>(asRecord(await transport("community.list_events")).events);
    },
    async listTasks(): Promise<CommunityTask[]> {
      return asArray<CommunityTask>(asRecord(await transport("community.list_tasks")).tasks);
    },
    async listPresence(): Promise<PresenceEntry[]> {
      return asArray<PresenceEntry>(asRecord(await transport("community.list_presence")).presence);
    },

    // Writes — user-initiated surface actions (source defaults to "user" host-side).
    rsvp(eventId: string, state: RsvpState): Promise<unknown> {
      return transport("community.rsvp", { eventId, state, source: "user" });
    },
    checkIn(eventId: string): Promise<unknown> {
      return transport("community.checkin", { eventId, source: "user" });
    },
    claimTask(taskId: string, action: "claim" | "unclaim"): Promise<unknown> {
      return transport("community.claim_task", { taskId, action, source: "user" });
    },
    setPresence(status: string, note?: string): Promise<unknown> {
      return transport("community.set_presence", { status, note, source: "user" });
    },
    clearPresence(): Promise<unknown> {
      return transport("community.set_presence", { clear: true, source: "user" });
    },
    report(targetType: "event" | "task" | "presence", targetId: string, reason?: string): Promise<unknown> {
      return transport("community.report", { targetType, targetId, reason, source: "user" });
    },
  };
}

export type CommunityBridge = ReturnType<typeof createCommunityBridge>;
