// Community Hub local-service host — the policy layer (M3).
//
// This sits between the bridge RPC (what the extension calls) and the outbound
// api-client (what actually reaches the hosted Community API). It enforces the
// constitution at the host boundary:
//
//   Art. II  — the extension talks to THIS host; only this host talks to the API.
//   Art. IV  — public read, authenticated write. Reads never need a token; writes
//              fail closed (no member token => refused locally, never sent anon).
//   Art. V   — agent-initiated writes are human-approval gated. A write whose
//              `source` is "agent" is refused unless `approved: true` is present.
//              User-initiated writes (`source: "user"`, the default) are explicit
//              user actions and pass. This is the client-side mirror of the
//              manifest's `requiresHumanApproval: true` on every write tool.
//   Art. I   — degrade gracefully. When the backend is unreachable, READS return a
//              `{ degraded: true }` marker instead of throwing, so the UI can drop
//              to read-only/offline. WRITES never fake success — a network failure
//              on a write propagates as an error.
//
// Everything is injectable (client, vault, clock, timers) so it runs offline.

import { CommunityNetworkError } from "./api-client.mjs";

/** The `community.*` tool methods that mutate hosted state (writes). */
export const WRITE_METHODS = Object.freeze(
  new Set(["community.rsvp", "community.checkin", "community.claim_task", "community.set_presence", "community.report"]),
);

/** Public read tool methods. */
export const READ_METHODS = Object.freeze(
  new Set(["community.list_events", "community.list_tasks", "community.list_presence"]),
);

/** A refusal produced by the host's own guards (not the backend). */
export class CommunityHostError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "CommunityHostError";
    this.status = status;
    this.code = code;
  }
}

const nowIso = (now) => new Date(now()).toISOString();

/**
 * @param {object} opts
 * @param {ReturnType<import("./api-client.mjs").createCommunityApiClient>} opts.client
 * @param {ReturnType<import("./token-vault.mjs").createTokenVault>} opts.vault
 * @param {() => number} [opts.now]
 * @param {number} [opts.maxAudit]
 */
export function createCommunityHubService({ client, vault, now = Date.now, maxAudit = 100 } = {}) {
  if (!client) throw new Error("createCommunityHubService requires an api client.");
  if (!vault) throw new Error("createCommunityHubService requires a token vault.");

  const audit = [];
  function record(event, details = {}) {
    audit.push({ at: nowIso(now), event, ...details });
    if (audit.length > maxAudit) audit.splice(0, audit.length - maxAudit);
  }
  const recentAudit = () => audit.slice(-60);

  /**
   * Approval gate (Art. V). Returns nothing on pass; throws CommunityHostError on
   * refusal. `source` defaults to "user" (an explicit user action in a surface).
   */
  function assertApproved(method, params) {
    const source = String(params?.source ?? "user").toLowerCase();
    if (source === "agent" && params?.approved !== true) {
      throw new CommunityHostError(
        `Agent-initiated ${method} requires human approval before it can run.`,
        { status: 403, code: "approval_required" },
      );
    }
  }

  /** Fail-closed write auth (Art. IV): a write needs a member token locally. */
  function requireToken(method) {
    const token = vault.get();
    if (!token) {
      throw new CommunityHostError(
        `${method} requires sign-in: writes are members-only (no anonymous writes).`,
        { status: 401, code: "auth_required" },
      );
    }
    return token;
  }

  // --- reads (degrade on unreachable backend) --------------------------------
  async function safeRead(method, fn) {
    try {
      const body = await fn();
      record(`${method}.ok`, {});
      return { ok: true, degraded: false, ...body };
    } catch (error) {
      if (error instanceof CommunityNetworkError) {
        // Art. I: do not hard-fail a public read when the hub is unreachable.
        record(`${method}.degraded`, { reason: error.message });
        return { ok: false, degraded: true, error: "backend_unreachable", message: error.message };
      }
      throw error;
    }
  }

  const handlers = {
    // --- read tools ----------------------------------------------------------
    "community.list_events": () => safeRead("community.list_events", () => client.listEvents()),
    "community.list_tasks": () => safeRead("community.list_tasks", () => client.listTasks()),
    "community.list_presence": () => safeRead("community.list_presence", () => client.listPresence()),

    // --- write tools (approval-gated + token-required) -----------------------
    "community.rsvp": (params) => {
      const token = requireToken("community.rsvp");
      const eventId = String(params?.eventId ?? "").trim();
      const state = String(params?.state ?? "").trim();
      if (!eventId) throw new CommunityHostError("community.rsvp requires an eventId.");
      record("community.rsvp.request", { eventId, state });
      return client.rsvp({ eventId, state, token });
    },
    "community.checkin": (params) => {
      const token = requireToken("community.checkin");
      const eventId = String(params?.eventId ?? "").trim();
      if (!eventId) throw new CommunityHostError("community.checkin requires an eventId.");
      record("community.checkin.request", { eventId });
      return client.checkin({ eventId, token });
    },
    "community.claim_task": (params) => {
      const token = requireToken("community.claim_task");
      const taskId = String(params?.taskId ?? "").trim();
      const action = String(params?.action ?? "claim").trim();
      if (!taskId) throw new CommunityHostError("community.claim_task requires a taskId.");
      record("community.claim_task.request", { taskId, action });
      return client.claimTask({ taskId, action, token });
    },
    "community.set_presence": (params) => {
      const token = requireToken("community.set_presence");
      record("community.set_presence.request", { clear: Boolean(params?.clear) });
      return client.setPresence({
        status: params?.status,
        note: params?.note,
        clear: Boolean(params?.clear),
        token,
      });
    },
    "community.report": (params) => {
      const token = requireToken("community.report");
      const targetType = String(params?.targetType ?? "").trim();
      const targetId = String(params?.targetId ?? "").trim();
      if (!targetType || !targetId) throw new CommunityHostError("community.report requires targetType and targetId.");
      record("community.report.request", { targetType, targetId });
      return client.report({ targetType, targetId, reason: params?.reason, token });
    },
  };

  return {
    audit: recentAudit,

    /** Store the member session token after an OAuth sign-in completes. */
    signIn(token) {
      vault.set(token);
      record("community.sign_in", {});
      return { signedIn: true };
    },
    signOut() {
      vault.clear();
      record("community.sign_out", {});
      return { signedIn: false };
    },
    isSignedIn() {
      return vault.hasToken();
    },

    /**
     * Health/status for the host (manifest `healthCommand: community.status`).
     * Reports auth state + a live reachability probe of the read path.
     */
    async status() {
      let reachable = false;
      let detail = "";
      try {
        await client.listEvents();
        reachable = true;
      } catch (error) {
        detail = error?.message ?? String(error);
      }
      return {
        ok: true,
        service: "community-hub",
        baseUrl: client.baseUrl,
        signedIn: vault.hasToken(),
        backend: { reachable, detail: reachable ? "" : detail },
        checkedAt: nowIso(now),
      };
    },

    /**
     * Central dispatch for a `community.*` tool call. Applies the approval gate to
     * writes, then runs the handler. This is what the bridge RPC calls.
     * @param {string} method
     * @param {object} [params]
     */
    async call(method, params = {}) {
      const handler = handlers[method];
      if (!handler) {
        throw new CommunityHostError(`Unknown community method: ${method}`, { status: 404, code: "unknown_method" });
      }
      if (WRITE_METHODS.has(method)) {
        assertApproved(method, params);
      }
      return handler(params);
    },
  };
}
