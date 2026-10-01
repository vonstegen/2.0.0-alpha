// Intent citation: docs/architecture/ADR-002-modular-codebase.md
//
// Pi Workspace — the pi-workspace surface of the Pi add-on (addon.pi-harness,
// pi-native-v1). Session-spin UI for the native Pi testing phase:
//   * provider profile + model selection (host-discovered compatible catalog)
//   * start/invoke through /agent/session + /agent/turn
//   * streaming /agent/events (final/cancelled/error frames)
//   * status + cancel
//
// Governance is host-owned: this view only drives the harness client with
// host-acknowledged references. No credential, path, or launch plan ever
// reaches the UI — only redacted host projections.
import { useEffect, useRef, useState } from "react";
import type { AddOnManifest, HarnessEvent } from "../../core/contracts";
import type { HarnessProjection, createHarnessClient } from "../../core/harness-client";
import type { HarnessSession } from "../../core/web-transport";
import { Panel } from "../../components/Panel";

type Client = ReturnType<typeof createHarnessClient>;
type Installation = HarnessProjection["installations"][string];
type Message = { role: "user" | "assistant"; content: string };
type TurnPhase = "idle" | "starting" | "running";

const messageText = (event: HarnessEvent): string | null =>
  event.type === "final" && typeof event.data.text === "string" ? event.data.text : null;
const publicMessage = (event: HarnessEvent): string | null =>
  event.type === "error" && typeof event.data.message === "string" ? event.data.message : null;

export function PiWorkspace({
  active,
  manifest,
  installation,
  client,
  projection,
  onConfigureAddon,
}: {
  active: boolean;
  manifest: AddOnManifest | undefined;
  installation: Installation | undefined;
  client: Client;
  projection: HarnessProjection | null;
  onConfigureAddon: () => void;
}) {
  const [session, setSession] = useState<HarnessSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<TurnPhase>("idle");
  const [turnId, setTurnId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const sessionRef = useRef<HarnessSession | null>(null);
  sessionRef.current = session;
  const busy = phase !== "idle";

  const compatibleProfiles = installation?.compatibleProviderProfiles ?? [];
  const compatibleModels = installation?.compatibleModels ?? [];
  const modelsForProfile = compatibleModels.filter((entry) => entry.providerId === profileId);

  // When the host projection reveals the compatible catalog, default to the
  // configured provider profile's first model. Never reads any credential.
  useEffect(() => {
    if (!profileId && compatibleProfiles.length > 0) {
      const first = compatibleProfiles[0];
      setProfileId(first.id);
      const firstModel = compatibleModels.find((entry) => entry.providerId === first.id)?.model ?? "";
      setModel(firstModel);
    } else if (profileId && !model) {
      setModel(compatibleModels.find((entry) => entry.providerId === profileId)?.model ?? "");
    }
  }, [compatibleProfiles, compatibleModels, profileId, model]);

  // Dispose the host session when the surface goes inactive or unmounts.
  useEffect(() => {
    if (!active && sessionRef.current) {
      const disposed = sessionRef.current;
      setSession(null);
      sessionRef.current = null;
      setPhase("idle");
      setTurnId(null);
      setMessages([]);
      void client.dispose(disposed).catch(() => {});
    }
  }, [active, client]);

  const ensureSession = async (): Promise<HarnessSession> => {
    if (sessionRef.current) return sessionRef.current;
    const { session: created } = await client.createSession(manifest?.id ?? "");
    setSession(created);
    sessionRef.current = created;
    try {
      const history = await client.history(created);
      const raw = (history as { history?: { messages?: unknown } } | null)?.history?.messages;
      if (Array.isArray(raw)) {
        setMessages(raw.filter((entry): entry is Message =>
          Boolean(entry) && typeof entry === "object" &&
          ("role" in entry && (entry.role === "user" || entry.role === "assistant")) &&
          typeof entry.content === "string"));
      }
    } catch {
      // No committed host history yet: start the transcript empty.
    }
    return created;
  };

  const startTurn = async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setNotice(null);
    setPhase("starting");
    try {
      const activeSession = await ensureSession();
      if (profileId && model) {
        await client.selectModel(activeSession, { provider: profileId, model }).catch(() => {});
      }
      setMessages((current) => [...current, { role: "user", content: text }]);
      setPrompt("");
      const ack = await client.turn(activeSession, {
        messages: [{ role: "user", content: text }],
        ...(model ? { model } : {}),
      });
      setTurnId(ack.turnId);
      setPhase("running");
      let assistantText: string | null = null;
      for await (const event of client.events(activeSession)) {
        const text = messageText(event);
        if (text !== null) {
          assistantText = text;
          // Pi-native is final-frame only; other adapters may stream deltas into
          // the same frame. Commit only the terminal text.
          setMessages((current) => {
            const last = current[current.length - 1];
            if (last?.role === "assistant") return [...current.slice(0, -1), { role: "assistant", content: text }];
            return [...current, { role: "assistant", content: text }];
          });
          break;
        }
        if (event.type === "cancelled") {
          assistantText = null;
          break;
        }
        if (event.type === "error") {
          setNotice(publicMessage(event) ?? "The Pi runtime refused the turn.");
          break;
        }
      }
      if (assistantText === null && notice === null) {
        setNotice("Turn cancelled.");
      }
      const status = await client.status(activeSession).catch(() => null);
      void status;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Turn failed.");
    } finally {
      setPhase("idle");
      setTurnId(null);
    }
  };

  const cancelTurn = async () => {
    const activeSession = sessionRef.current;
    if (!activeSession || !turnId || phase !== "running") return;
    try {
      await client.cancel(activeSession, turnId);
      setNotice("Cancelling…");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Cancel failed.");
    }
  };

  const refreshStatus = async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    try {
      const status = await client.status(activeSession);
      setNotice(typeof status?.status === "string" ? `Session status: ${status.status}` : null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Status unavailable.");
    }
  };

  const ownerIsPi = projection?.slots["primary-agent"]?.addonId === manifest?.id;
  const installed = installation?.installed === true;
  const enabled = installation?.enabled === true;
  const providerConfigured = installation?.providerProfileConfigured === true;
  const agentGranted = Boolean(installation?.grantedCapabilities.some(
    (grant) => grant.capability === "agent-runtime" && grant.granted,
  ));
  const filesystemGranted = Boolean(installation?.grantedCapabilities.some(
    (grant) => grant.capability === "filesystem" && grant.granted,
  ));
  const ready = installed && enabled && agentGranted && filesystemGranted && providerConfigured && compatibleProfiles.length > 0;

  return (
    <Panel title="Pi Workspace" subtitle="Native Pi session — session-environment credential, no durable copy.">
      {!installed && (
        <div className="slot-empty-state">
          <p>Pi is not installed in the harness registry.</p>
          <button type="button" className="button-primary touch-action" onClick={onConfigureAddon}>Open Add-ons</button>
        </div>
      )}
      {installed && (!enabled || !agentGranted || !filesystemGranted) && (
        <div className="slot-empty-state">
          <p>Pi needs enablement and the agent-runtime and filesystem grants before a session can spin.</p>
          <button type="button" className="button-primary touch-action" onClick={onConfigureAddon}>Manage Pi Add-on</button>
        </div>
      )}
      {installed && enabled && agentGranted && !providerConfigured && (
        <div className="slot-empty-state">
          <p>The approved provider profile has no credential configured in ResonantOS Settings.</p>
          <button type="button" className="button-secondary touch-action" onClick={refreshStatus}>Re-check</button>
        </div>
      )}
      {installed && enabled && agentGranted && !filesystemGranted && (
        <div className="slot-empty-state">
          <p>Grant the filesystem capability so the session cwd can be projected.</p>
          <button type="button" className="button-primary touch-action" onClick={onConfigureAddon}>Manage Pi Add-on</button>
        </div>
      )}

      {ready && !ownerIsPi && (
        <div className="slot-empty-state">
          <p>Pi is not the primary agent. Assign the primary-agent slot to Pi before spinning a session.</p>
          <button type="button" className="button-primary touch-action" onClick={onConfigureAddon}>Manage Pi Add-on</button>
        </div>
      )}

      {ready && ownerIsPi && (
        <>
          <div className="form-grid pi-grid">
            <label className="field">
              <span>Provider profile</span>
              <select value={profileId} disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  setProfileId(next);
                  setModel(compatibleModels.find((entry) => entry.providerId === next)?.model ?? "");
                }}>
                {compatibleProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Model</span>
              <select value={model} disabled={busy || modelsForProfile.length === 0}
                onChange={(event) => setModel(event.target.value)}>
                {modelsForProfile.map((entry) => (
                  <option key={entry.model} value={entry.model}>{entry.label} ({entry.model})</option>
                ))}
              </select>
            </label>
          </div>

          <div className="pi-session-strip">
            <span className="eyebrow">Session</span>
            <strong>{session ? "active" : "not started"}</strong>
            {ownerIsPi ? <em>primary agent</em> : <em>harness session</em>}
            <button type="button" className="button-secondary" disabled={busy}
              onClick={() => void ensureSession().then(() => setNotice("Session ready.")).catch((error) =>
                setNotice(error instanceof Error ? error.message : "Session failed."))}>
              {session ? "Re-check history" : "Start session"}
            </button>
            <button type="button" className="button-secondary" disabled={busy || !session}
              onClick={() => void refreshStatus()}>Status</button>
            <button type="button" className="button-secondary" disabled={phase !== "running"}
              onClick={() => void cancelTurn()}>Cancel</button>
          </div>

          <div className="pi-chat-log" aria-label="Pi session transcript">
            {messages.length === 0 && <p className="muted-copy">No turns yet. Start a session, then invoke the model below.</p>}
            {messages.map((entry, index) => (
              <p key={index} className={`pi-chat-message pi-chat-${entry.role}`}>
                <strong>{entry.role === "assistant" ? "Pi" : "You"}</strong> {entry.content}
              </p>
            ))}
          </div>

          <div className="pi-composer">
            <textarea value={prompt} disabled={busy} placeholder="Prompt the selected model…"
              onChange={(event) => setPrompt(event.target.value)} />
            <button type="button" className="button-primary touch-action" disabled={busy || !prompt.trim()}
              onClick={() => void startTurn()}>
              {phase === "running" ? "Running…" : "Invoke"}
            </button>
          </div>
          {notice && <p role="status" className="pi-notice">{notice}</p>}
        </>
      )}
    </Panel>
  );
}
