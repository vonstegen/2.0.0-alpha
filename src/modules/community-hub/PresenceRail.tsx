// Community Hub presence rail (manifest surface `community-hub-presence`, type: rail).
//
// Opt-in, revocable presence (spec FR-P1/FR-P2; constitution Art. V). Members see
// who is around; a signed-in member can set or clear their own status. All writes
// go through the bridge -> local-service host (Art. II).

import { useState } from "react";
import type { CommunityBridge } from "./community-bridge";
import { memberLabel, sortPresence, type PresenceEntry } from "./community-view-model";
import "./community-hub.css";

export interface PresenceRailProps {
  bridge: CommunityBridge;
  presence: PresenceEntry[];
  memberId: string | null;
  signedIn: boolean;
  onChanged?: () => void;
}

export function PresenceRail({ bridge, presence, memberId, signedIn, onChanged }: PresenceRailProps) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows = sortPresence(presence);
  const mine = memberId ? rows.find((r) => r.memberId === memberId) ?? null : null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="community-presence" aria-label="Community presence">
      <div className="community-hub__section-title">Around now</div>
      {rows.length === 0 ? (
        <div className="community-hub__empty">No one has shared presence yet.</div>
      ) : (
        rows.map((entry) => (
          <div key={entry.memberId} className="community-presence__row">
            <span className="community-presence__avatar" aria-hidden>
              {memberLabel(entry).slice(0, 1).toUpperCase()}
            </span>
            <span>
              <span className="community-presence__name">{memberLabel(entry)}</span>
              {entry.status ? <span className="community-presence__note"> · {entry.status}</span> : null}
              {entry.note ? <div className="community-presence__note">{entry.note}</div> : null}
            </span>
          </div>
        ))
      )}

      {signedIn ? (
        <form
          className="community-presence__self"
          onSubmit={(e) => {
            e.preventDefault();
            const status = draft.trim();
            if (!status) return;
            void run(() => bridge.setPresence(status, note.trim() || undefined));
          }}
        >
          <div className="community-hub__section-title">Your presence</div>
          <input
            className="community-presence__input"
            placeholder="Status (e.g. prepping slides)"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
          />
          <input
            className="community-presence__input"
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          <div className="community-actions">
            <button type="submit" className="community-btn community-btn--primary" disabled={busy || !draft.trim()}>
              Set presence
            </button>
            {mine ? (
              <button type="button" className="community-btn" disabled={busy} onClick={() => void run(() => bridge.clearPresence())}>
                Clear
              </button>
            ) : null}
          </div>
          {error ? <div className="community-hub__error">{error}</div> : null}
        </form>
      ) : (
        <div className="community-hub__empty">Sign in to share presence.</div>
      )}
    </aside>
  );
}
