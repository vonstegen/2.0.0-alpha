// Intent citation: docs/architecture/ADR-002-modular-codebase.md

import type { ResonantShellState } from "../../core/contracts";
import { Panel } from "../../components/Panel";
import { buildLineageSteps } from "./augmentor-approval-lineage";

export function StrategistWorkspace({
  state,
  displayedStrategistName,
  onStrategistRename,
  onToggleChannel,
}: {
  state: ResonantShellState;
  displayedStrategistName: string;
  onStrategistRename: (value: string) => void;
  onToggleChannel: (channelId: string) => void;
}) {
  return (
    <>
      <Panel title="Strategist Workspace" subtitle="Identity, trust note, and channel surfaces for the main agent.">
        <div className="form-grid strategist-grid">
          <label className="field">
            <span>Display name</span>
            <input
              value={state.strategistIdentity.customName ?? ""}
              onChange={(event) => onStrategistRename(event.target.value)}
              placeholder={state.strategistIdentity.defaultName}
            />
          </label>
          <div className="identity-card">
            <span className="eyebrow">Trusted identity</span>
            <strong>{state.strategistIdentity.defaultName}</strong>
            <p>{state.strategistIdentity.trustNote}</p>
          </div>
          <div className="channel-grid">
            {state.channels.map((channel) => (
              <article key={channel.id} className="channel-card">
                <div className="channel-header">
                  <div>
                    <strong>{channel.label}</strong>
                    <p>
                      {channel.type} · {channel.sessionMode.replace("-", " ")}
                    </p>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => onToggleChannel(channel.id)}>
                    {channel.enabled ? "Disable" : "Enable"}
                  </button>
                </div>
                <dl>
                  <div>
                    <dt>Workspace</dt>
                    <dd>{channel.workspaceId}</dd>
                  </div>
                  <div>
                    <dt>Owning agent</dt>
                    <dd>{channel.owningAgentId}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{channel.enabled ? "live" : "inactive"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>
      </Panel>

      <Panel title="Core Agents" subtitle="Core services attached to the shell, including the Strategist-owned ingest service.">
        <div className="agent-grid">
          {state.agents.map((agent) => (
            <article key={agent.id} className="agent-card">
              <div className="agent-heading">
                <strong>{agent.id === "strategist.core" ? displayedStrategistName : agent.displayName}</strong>
                <span className={`tone tone-${agent.trustTier === "core" ? "active" : "neutral"}`}>{agent.trustTier}</span>
              </div>
              <p>{agent.workspaceBehavior} workspace behavior</p>
              <ul>
                <li>Provider: {agent.providerProfileId}</li>
                <li>Archive read scopes: {agent.archiveReadScopes.join(", ") || "none"}</li>
                <li>Knowledge writes: {agent.canWriteKnowledgePages ? "allowed" : "blocked"}</li>
              </ul>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Lineage &amp; Approval" subtitle="Delegation chain and pending approval gates for the current task context.">
        <ol className="lineage-list">
          {buildLineageSteps(displayedStrategistName, null).map((step) => (
            <li key={`${step.kind}:${step.principalId}`} className={`lineage-step lineage-${step.kind}`}>
              <span className="eyebrow">{step.kind}</span>
              <strong>{step.label}</strong>
            </li>
          ))}
        </ol>
        <p className="muted">
          A task's extension runs under an identity subordinate to Augmentor
          (user &rarr; Augmentor &rarr; extension &rarr; tool). No extension invocation
          is awaiting human approval in this session.
        </p>
      </Panel>
    </>
  );
}
