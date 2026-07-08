// Community Hub page surface (manifest surface `community-hub-home`, type: page).
//
// Composes the three manifest surfaces the milestone ships:
//   - events feed  (RSVP + live check-in)   — panel `community-hub-events`
//   - tasks board  (claim / un-claim)        — panel `community-hub-tasks`
//   - presence rail                          — rail  `community-hub-presence`
//
// Sync (Art. VI): the local-service host runs the real ~20s poller against the
// Community API; this surface just pulls the host's latest reconciled snapshot on
// its own light interval and re-renders. Every call goes through the injected
// `transport` (bridge RPC -> loopback host), never the API directly (Art. II).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createCommunityBridge, type CommunityHostTransport, type CommunitySnapshot } from "./community-bridge";
import {
  canCheckIn,
  deriveEventPhase,
  formatRsvpSummary,
  groupTasksByStatus,
  memberLabel,
  nextClaimAction,
  partitionEvents,
  type CommunityEvent,
  type CommunityTask,
  type RsvpState,
} from "./community-view-model";
import { PresenceRail } from "./PresenceRail";
import "./community-hub.css";

export interface CommunityHubWorkspaceProps {
  /** Bridge RPC seam into the local-service host (bridge -> 127.0.0.1 host). */
  transport: CommunityHostTransport;
  /** Signed-in member id, if known (drives "claimed by me" / presence ownership). */
  memberId?: string | null;
  /** How often the surface re-pulls the host snapshot (ms). */
  refreshMs?: number;
  /** Kick off the GitHub OAuth sign-in flow (host provides the authorize URL). */
  onSignIn?: () => void;
}

const EMPTY_SNAPSHOT: CommunitySnapshot = {
  events: [],
  tasks: [],
  presence: [],
  degraded: false,
  fetchedAt: null,
  lastError: null,
};

export function CommunityHubWorkspace({ transport, memberId = null, refreshMs = 20_000, onSignIn }: CommunityHubWorkspaceProps) {
  const bridge = useMemo(() => createCommunityBridge(transport), [transport]);
  const [snapshot, setSnapshot] = useState<CommunitySnapshot>(EMPTY_SNAPSHOT);
  const [signedIn, setSignedIn] = useState(false);
  const [reachable, setReachable] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const nowRef = useRef(Date.now());
  nowRef.current = Date.now();

  const refresh = useCallback(async () => {
    try {
      const [snap, status] = await Promise.all([bridge.snapshot(), bridge.status()]);
      setSnapshot(snap);
      setSignedIn(Boolean(status?.signedIn));
      setReachable(Boolean(status?.backend?.reachable));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), Math.max(3_000, refreshMs));
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  async function act(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId("");
    }
  }

  const { live, upcoming, past } = partitionEvents(snapshot.events, nowRef.current);
  const taskGroups = groupTasksByStatus(snapshot.tasks);

  const connState = !reachable ? "offline" : snapshot.degraded ? "degraded" : "online";

  return (
    <section className="community-hub" aria-label="Community Hub">
      <header className="community-hub__header">
        <div>
          <div className="community-hub__eyebrow">Community</div>
          <h1 className="community-hub__title">Community Hub</h1>
        </div>
        <div className="community-hub__signin">
          <span className="community-hub__status">
            <span className={`community-hub__dot community-hub__dot--${connState}`} aria-hidden />
            {connState === "online" ? "Live" : connState === "degraded" ? "Reconnecting" : "Offline"}
          </span>
          {signedIn ? (
            <button type="button" className="community-btn" onClick={() => void act("signout", () => transport("community.sign_out"))}>
              Sign out
            </button>
          ) : (
            <button type="button" className="community-btn community-btn--primary" onClick={() => onSignIn?.()}>
              Sign in with GitHub
            </button>
          )}
        </div>
      </header>

      {connState !== "online" ? (
        <div className="community-hub__banner">
          {connState === "offline"
            ? "The community backend is unreachable. Showing the last synced view (read-only)."
            : "Reconnecting to the community backend; some data may be stale."}
        </div>
      ) : null}
      {error ? <div className="community-hub__error">{error}</div> : null}

      <div className="community-hub__grid">
        {/* Events feed panel */}
        <div className="community-hub__column" aria-label="Events">
          <div className="community-hub__section-title">Events</div>
          {[...live, ...upcoming, ...past].length === 0 ? (
            <div className="community-hub__empty">No events yet.</div>
          ) : (
            [...live, ...upcoming, ...past].map((event) => (
              <EventCard
                key={event.id}
                event={event}
                now={nowRef.current}
                signedIn={signedIn}
                busy={busyId === event.id}
                onRsvp={(state) => act(event.id, () => bridge.rsvp(event.id, state))}
                onCheckIn={() => act(event.id, () => bridge.checkIn(event.id))}
              />
            ))
          )}
        </div>

        {/* Tasks board panel */}
        <div className="community-hub__column" aria-label="Community tasks">
          <div className="community-hub__section-title">Community tasks</div>
          {snapshot.tasks.length === 0 ? (
            <div className="community-hub__empty">No open tasks.</div>
          ) : (
            (["open", "claimed", "done"] as const).flatMap((status) =>
              taskGroups[status].map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  memberId={memberId}
                  signedIn={signedIn}
                  busy={busyId === task.id}
                  onToggleClaim={() => act(task.id, () => bridge.claimTask(task.id, nextClaimAction(task, memberId)))}
                />
              )),
            )
          )}
        </div>
      </div>

      <PresenceRail bridge={bridge} presence={snapshot.presence} memberId={memberId} signedIn={signedIn} onChanged={() => void refresh()} />
    </section>
  );
}

function EventCard({
  event,
  now,
  signedIn,
  busy,
  onRsvp,
  onCheckIn,
}: {
  event: CommunityEvent;
  now: number;
  signedIn: boolean;
  busy: boolean;
  onRsvp: (state: RsvpState) => void;
  onCheckIn: () => void;
}) {
  const phase = deriveEventPhase(event, now);
  const checkInOpen = canCheckIn(event, now);
  return (
    <article className="community-card">
      <div className="community-card__row">
        <h3 className="community-card__title">{event.title}</h3>
        <span className={`community-badge community-badge--${phase}`}>{phase}</span>
      </div>
      <div className="community-card__meta">
        {event.startsAt ? new Date(event.startsAt).toLocaleString() : "Time TBD"}
        {event.location ? ` · ${event.location}` : ""}
        {event.hostHandle ? ` · host @${event.hostHandle}` : ""}
      </div>
      {event.description ? <p className="community-card__desc">{event.description}</p> : null}
      <div className="community-card__meta">{formatRsvpSummary(event)}</div>
      {signedIn ? (
        <div className="community-actions">
          <button type="button" className="community-btn" disabled={busy} onClick={() => onRsvp("going")}>
            Going
          </button>
          <button type="button" className="community-btn" disabled={busy} onClick={() => onRsvp("interested")}>
            Interested
          </button>
          <button
            type="button"
            className="community-btn community-btn--primary"
            disabled={busy || !checkInOpen}
            title={checkInOpen ? "Record live attendance" : "Check-in opens during the event window"}
            onClick={onCheckIn}
          >
            Check in
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TaskCard({
  task,
  memberId,
  signedIn,
  busy,
  onToggleClaim,
}: {
  task: CommunityTask;
  memberId: string | null;
  signedIn: boolean;
  busy: boolean;
  onToggleClaim: () => void;
}) {
  const mineAction = nextClaimAction(task, memberId);
  return (
    <article className="community-card">
      <div className="community-card__row">
        <h3 className="community-card__title">{task.title}</h3>
        <span className={`community-badge community-badge--${task.status}`}>{task.status}</span>
      </div>
      {task.description ? <p className="community-card__desc">{task.description}</p> : null}
      <div className="community-card__meta">
        {task.claimedBy.length > 0 ? `${task.claimedBy.length} claimed` : "Unclaimed"}
        {task.dueAt ? ` · due ${new Date(task.dueAt).toLocaleDateString()}` : ""}
        {` · agent step: ${task.goalStepStatus}`}
      </div>
      {signedIn && task.status !== "done" ? (
        <div className="community-actions">
          <button
            type="button"
            className={`community-btn ${mineAction === "unclaim" ? "community-btn--active" : "community-btn--primary"}`}
            disabled={busy}
            onClick={onToggleClaim}
          >
            {mineAction === "unclaim" ? "Un-claim" : "Claim"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
