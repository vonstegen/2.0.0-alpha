# Comet-Parity Backlog

Intent: keep the browser-first ResonantOS work aligned with the AI-browser capabilities users expect from Comet, while preserving stronger ResonantOS safety boundaries.

## Implemented

- Browser-first Chromium-family host with ResonantOS side panel.
- Augmentor chat in browser chrome.
- Agent Control Mode using observe -> decide -> act -> verify.
- Active page reading and visible-page context extraction.
- Click, type, scroll, forms inspection, tab listing, and tab switching through mediated tools.
- Stable page element refs for controls and fields.
- Iframe context support.
- `@tab` targeting by tab number, title, or URL fragment.
- Inline Assistant v1 for selected text.
- Inline Assistant custom prompt input.
- Inline Assistant v2: editable-field selection capture for inputs, textareas, and contenteditable surfaces; Insert replaces only the selected range; visible keyboard shortcuts are rendered for configured actions.
- Site permission modes: blocked, read-only, ask-before-action, trusted-for-safe-actions.
- Visible current-site permission control in the side panel.
- Task-level consent v1: approve once, trust safe actions by site + task class, expire stale grants, or deny, while keeping wallet/payment/login/signing/credential/public-submit boundaries human-only.
- Site Permission Controls v2: context dock manager lists stored site permissions and task-class consents across sites, with reset/revoke actions.
- Site Permission Controls v2 audit trail: site permission changes/resets and task-class consents/revocations record timestamp, source, and reason, and the permission manager surfaces latest audit evidence.
- Permission/Consent UX v2: the current-site panel states what Augmentor can see/do now for blocked, read-only, ask-before-action, and trusted-safe-action modes.
- Permission/Consent UX v3: long autonomous Agent Control tasks require a task-class preflight before Augmentor starts operating the page; `/approve-control <id>` starts the governed run, `/deny-control <id>` cancels it, stored safe task-class consent can skip the preflight, and hard wallet/payment/login/credential/signing/public-submit boundaries remain separately enforced.
- Permission/Consent UX v3.1: the preflight also appears as a context-dock approval card with clickable Approve and Deny buttons, so users do not have to type the slash commands.
- Permission/Consent UX v3.2: the preflight card can also trust safe actions for the current site + task class through the existing task-consent store, then start the governed control run while preserving hard boundaries.
- Permission/Consent UX v3.3: browser jobs persist the preflight decision that allowed the run to start, and both job monitor replay plus saved job reports show approve-once, trusted-safe-actions, skipped-by-consent, or resumed provenance.
- `/capabilities` permission summary for the current page.
- Browser History / Activity Search v2: `/history <query> | site:example.com | days:7 | tabs` supports date filtering, per-site filtering, readable open-tab synthesis, explicit incognito exclusion, and `/history <query> | intake` export into Living Archive intake with a review request.
- Browser-first Add-ons workspace lists visible add-ons, availability, trust tier, and governed workspace actions without granting new capabilities.
- Browser-first Add-ons workspace management v1: add-on cards now show granted, pending, and denied capability chips and expose scoped Hermes/OpenCode local-execution toggles through the same host-mediated execution-settings route used by Settings.
- Main workspace chat now matches the side-panel chat command behavior for keyboard shortcuts, SVG message actions, model/depth controls, shared ring-style context usage, and page/archive/status/mic icon controls. The new-tab main workspace opens first; the side-panel chat stays closed until explicitly opened or a browser-control handoff needs it.
- Main workspace page/context toolbar v1: read current page, save current page to Living Archive intake, save selected page text, and summarize visible context now run directly from the main workspace chat surface instead of opening the side panel for those non-control actions.
- Chat composer parity hardening: both main and side-panel chat inputs support select-all, copy, cut, paste, undo, Enter-to-send, and Shift+Enter newline through the shared composer controller. Native browser editing is preserved first; an explicit clipboard fallback remains available for restricted extension runtimes.
- Augmentor delegation hardening: natural chat phrases such as “spawn Hermes,” “dispatch this to OpenCode,” and “use the ResonantOS agent control layer” are routed before provider chat, and the provider prompt is barred from claiming delegation is outside Augmentor's ResonantOS capabilities.
- Augmentor provider prompt contract v1: the host-side Augmentor chat prompt now lives in a pure tested contract module that explicitly states browser control and delegation capabilities, filters untrusted message roles, and prevents provider replies from drifting back to “text-only assistant” behavior.
- Hermes production delegation v1: `/hermes` and natural Hermes delegation now create governed task packets and immediately attempt a host-mediated Hermes lifecycle start. Result artifacts are readable from the Add-ons workspace, deterministic test execution is supported, real Hermes CLI execution is explicit opt-in from trusted Settings, and a fake-CLI self-test proves the enabled adapter path without touching the user's live Hermes environment.
- OpenCode production delegation v1: `/opencode` workspace handoffs and natural OpenCode delegation now create governed coding packets, attempt host-mediated start/status/artifact/cancel lifecycle actions, and return reviewable coding artifacts. Deterministic execution covers the lifecycle, the enabled CLI adapter path is tested with a fake executable, and real local OpenCode CLI execution remains explicit opt-in and scoped to the ResonantOS repository boundary.
- Delegation chat result visibility v1: completed Hermes/OpenCode handoffs now surface a bounded artifact summary directly in Augmentor chat. If the start response only returns an artifact path, the lifecycle layer fetches the artifact before replying, while still preserving the reviewable artifact link and add-on boundaries.
- Delegation status command v1: `/delegations` and `/handoffs` show recent Hermes/OpenCode/Engineer packets, statuses, result excerpts, artifact links, and packet paths from both main workspace and side-panel chat.
- Delegation blocker guidance v1: Hermes/OpenCode blocked runtime states now show a structured reason, next action, and trust boundary in lifecycle replies and workspaces, keeping add-on workers recoverable without elevating them to trusted core agents.
- Hermes runtime status v1: `/hermes` and `/hermes status` show the Hermes CLI detection state, explicit execution grant state, dashboard state, task counts, and next action. The browser-first Hermes add-on contract is bundled, while the real local CLI runtime remains separately detected and opt-in.
- Hermes workspace runtime visibility v1: the Hermes workspace now renders the same CLI detection, execution grant, dashboard state, task counts, and add-on boundary directly in the central workspace, instead of only showing whether the embedded dashboard is running.
- Installed app diagnostics v1.1: the native macOS browser host now accepts a `--resonantos-log-path` argument and writes CEF/menu/load events into the same launch log as the Node bridge. The installed-app verifier can deterministically prove AppKit menus, CEF initialization, main workspace load, pinned extensions, Phantom presence, and bridge readiness.
- Email/Calendar Add-ons v1: `/email` and `/calendar` create host-mediated draft-only packets from both chat surfaces. Sending email and scheduling events remain human-approval gated and are not automated from chat.
- Email/Calendar Approval v1: the Add-ons workspace lists draft packets and can mark them approved for manual action or rejected with an audit entry; provider sending/scheduling remains blocked until connector-specific approval flows exist.
- Email/Calendar Provider Connectors v1.1: approved draft packets can open Gmail compose or Google Calendar event-template handoff URLs for human review. ResonantOS records an audit event and still does not send email, schedule events, expose credentials, or bypass the provider UI.
- Durable Browser Jobs v2: persistent job registry, persisted active job id, interrupted-job recovery after reload, visible job monitor, `/jobs`, `/pause`, `/resume`, `/continue`, `/report`, and `/cancel`. Resume/continue restart from persisted step history and job reports can be written to Living Archive intake.
- Durable Browser Jobs v2.1: resume/continue reuses the same durable job id, preserves prior step history/artifacts in the monitor, and appends new browser-control steps instead of creating continuation jobs.
- Parallel Browser Jobs v1: the monitor can show multiple durable jobs at once, mark the focused browser job, switch focus with `/jobs focus <job>`, and keep per-job Continue/Report controls without merging their traces.
- Parallel Browser Jobs v1.1: running/queued/approval jobs hold explicit tab/site page locks, conflicting Agent Control starts/resumes are blocked before action, paused/terminal jobs release locks, unresolved approval-paused jobs are cancelled when the user starts a new explicit control task on the same page, and the job monitor shows the locked site/tab.
- Parallel Browser Jobs scheduler state v1: the durable job store now computes scheduler capacity, runnable queued jobs, page-lock-blocked queued jobs, and capacity-waiting queued jobs. `/jobs` and the monitor surface this state so the user can see why a queued job can or cannot run before true simultaneous control loops are enabled.
- Parallel Browser Jobs execution scheduler v1: Agent Control requests are now created as queued durable jobs, a bounded scheduler starts multiple non-conflicting jobs, capacity-waiting work auto-drains as jobs finish, same-page conflicts remain queued instead of being rejected, paused/cancelled jobs stop browser actions, and hard human-only boundaries do not leave approval jobs holding page locks.
- Parallel Browser Jobs context isolation v1: scheduled jobs now keep a job-local last page snapshot and clear shared snapshot state before executing job steps, reducing cross-job page-context leakage while the browser-action lock serializes actual page mutations.
- Parallel Browser Jobs focus isolation v1: scheduler-started background jobs no longer overwrite the currently focused browser job. The durable job store and main workspace prefer live queued/running/approval/paused work over stale terminal active ids while still allowing explicit manual focus on completed jobs for review/reporting.
- Parallel Browser Jobs job-card controls v1: expanded job rows expose Focus, Pause, Cancel, Continue, Report, and persisted public-submit Approve/Deny controls where applicable; live browser-host validation proves Pause/Cancel buttons mutate durable job state from the actual extension UI.
- Parallel Browser Jobs live multi-tab validation v1: the live browser-host suite now opens two real fixture tabs, parks one Agent Control job at a public-submit approval boundary, then proves a second non-conflicting tab job can complete while the first remains waiting for human approval.
- Parallel Browser Jobs approval evidence v1: approval-state job rows now include a compact review card with the pending action, reason, observed page title, URL, locked tab/site target, and an explicit reminder to review visible page state before approving.
- Parallel Browser Jobs completion hardening v1: the scheduler now treats blocked/approval/failed control-loop results as terminal non-success states and does not overwrite them as completed jobs when persistence races with runner shutdown.
- Main Workspace Agent Control status v1: the full-screen Augmentor workspace now shows a compact Agent Control strip for active/queued/approval browser jobs, including focused job status, target, scheduler counts, progress, Open Monitor, Focus, and Stop controls.
- Main Workspace browser-job controls v1.1: Open Monitor, Focus, and Stop now route through a testable controller that owns storage mutation, page-lock release on stop, sidebar handoff prompts, and system trace messages instead of embedding privileged job-state edits in the workspace UI.
- Background approval focus v1: focusing or approving a background browser job activates that job's locked readable tab first, so approval review and replay are tied to the correct page instead of whichever tab happens to be active.
- Browser job command focus v1: `/jobs focus <job>` now routes through the same job-focus boundary as monitor controls, activating the locked readable tab instead of only updating the stored active job id.
- Browser job ownership labels v1: the monitor labels which job owns the visible page and which approval jobs are backgrounded, including the locked tab that Focus activates before approve or deny.
- Browser page summaries can be generated into Living Archive intake with source provenance, review queueing, and a deterministic fallback when the provider is unavailable.
- Multi-tab browser research trails can be captured into one Living Archive intake bundle with per-page provenance and review queueing.
- Browser-first Memory Bridge UX v1.2: main-workspace review handoffs now carry the exact review request and source artifact into the Living Archive workspace, focus the matching review card, and auto-preview preserved source evidence when available.
- Browser-first Memory Bridge UX v1.3: promoted-page handoffs now carry the trusted AI Memory page into the Living Archive workspace, focus the matching promotion history card, and auto-preview the promoted wiki page so completed review results are easier to inspect.
- Browser-first New Tab UX v1: ResonantOS now owns the Chromium new-tab override, seeds startup to the main workspace, and suppresses first-run/default-browser/crash-restore distractions where safe so the product opens as ResonantOS first, not raw Chromium.
- Browser-first Settings deep links v1: direct links such as `#settings/profile` and `#settings/providers` now open the exact Settings section, Settings/Profile clicks update the browser hash, and the default no-hash launch still opens a fresh main chat.
- Living Archive wiki index maintenance v1: trusted promotion upserts the promoted page in `AI_MEMORY/wiki/index.md` as a deduplicated content catalog while preserving `log.md` as the append-only chronology.
- Living Archive wiki health v1.1: health checks now flag duplicate `index.md` catalog entries so old append-style drift is visible and repairable.
- Living Archive search v1.1: AI Memory search now uses `index.md` as the first navigation layer, prioritizes catalog hits, and falls back to page content when the catalog has not caught up.
- Living Archive LLM Wiki completion v1: bootstrap creates `AGENTS.md`, memory domains, `index.md`, and `log.md`; draft ingest artifacts prefer a configured archive ingest writer model with deterministic fallback and include claims/entities/concepts/links/open questions/provenance; health checks validate provenance and contradiction markers; MCP portable search/lint now exposes the same index-first wiki semantics to external agents such as Hermes.
- Agent Control visual overlay v1: persistent Matrix-style green perimeter, in-page action toast, and highlighted clicked/typed targets for the full control session.
- Agent Control UX vNext baseline: structured per-action observation/decision/action/result/safety details, completion/blocker summary cards, and persisted replay details in durable browser jobs.
- Agent Control timing evidence v1: control runs and individual steps record durable timing metadata; monitor details and saved reports show elapsed step/run durations for audit and debugging.
- Agent Control confidence/blocker evidence v1: steps now persist confidence, uncertainty, and recommended next human action; the control monitor and saved reports surface that evidence so blocked tasks tell the user what to do next.
- Agent Control controlled-target evidence v1: active runs persist and display the tab/site/page-lock reason that Augmentor is operating, and saved reports include the same target evidence.
- Agent Control aggregate progress v1: active runs now show phase semantics (reading, navigating, deciding, acting, approval, blocked, waiting, completed), percent complete, queued/blocked/failed counts, and a compact progress track; saved control/job reports include the same aggregate progress evidence.
- Agent Control page-state verification v1: after successful click/type/open/search/tab-switch actions, the runner rereads the page and records whether visible state changed, adding uncertainty evidence when an action appears to do nothing.
- Agent Control settle-reread v1: when a safe action succeeds but immediate verification sees no visible page change, the runner waits briefly and rereads once before recording uncertainty, so slow page updates do not become false blockers.
- Agent Control precise-ref retry v1: after a safe click still shows no page change, the runner may retry once with a single exact visible control ref; non-safe/public/hard-boundary clicks are not retried.
- Agent Control retry evidence v1: settle-reread and precise-ref retry events are now visible in the live monitor and saved reports, so the human can audit when Augmentor waited for page state or retargeted a safe click.
- Durable Browser Jobs retry evidence v1: expanded job rows now preserve the latest settle-reread and precise-ref retry evidence after the active control monitor is gone.
- Main Workspace Agent Control retry evidence v1: the compact full-screen workspace strip now surfaces recheck/retry evidence for the focused job, avoiding a hidden state change between workspace and monitor.
- Agent Control completion-proof guard v1: the runner now blocks a `done` decision if the latest browser mutation reported no visible page-state change, records a completion-verification blocker, and saves that blocker into the report artifact.
- Agent Control resume-evidence continuity v1: durable browser job steps now preserve verificationChanged, settle-reread, and precise-ref retry evidence when a job is resumed after reload.
- Agent Control no-op repeat guard v1: if the planner repeats the same action after verification found no visible page change, the runner blocks before re-executing it and records guidance to inspect, retarget, or delegate.
- Agent Control recovery runbook evidence v1: failed, no-change, and repeat-blocked steps now store page-specific recovery options in the action trace, durable browser job state, and saved reports. Recovery options are derived from the current page snapshot so the human sees concrete visible controls/fields or a clear instruction to expose/clarify the target.
- Agent Control strategy runbook v1: every planning and next-action request now carries a deterministic task-class runbook with phases, safety stops, visible evidence, and completion checks. Step traces, durable jobs, monitor details, and saved reports preserve strategy phase/rationale/completion evidence so Augmentor shows why it is acting, not only what low-level action it chose.
- Agent Control real-site scenario runbooks v1: task classes now resolve into concrete scenarios such as shopping comparison/discovery, booking discovery, news/web research synthesis, DAO/wallet review, safe form editing, and generic page control. Each scenario provides preferred probes, success signals, and stop conditions to the planner before it acts.
- Agent Control strategy monitor v1: the active control monitor now surfaces the current scenario, phase, preferred probes, success signals, and stop boundaries as a compact strategy card, while preserving the same evidence in durable step details and saved reports.
- Agent Control authority card v1: the active monitor now states what Augmentor can see, what safe browser actions it can perform, and which wallet/payment/login/credential/public-submit actions remain human-only.
- Approval audit trail v1: approved-once and denied browser actions now persist explicit approval-decision evidence in monitor details, durable job state, and saved reports.
- Agent Control ambiguous-target guard v1: content-script click/type actions now reject repeated matching labels unless the planner supplies an exact control ref, returning bounded candidate refs for precise retargeting instead of mutating the first matching element.
- Agent Control ambiguity evidence v1: ambiguous target candidate refs now persist into runner history, durable job step details, recovery guidance, and saved reports, so the next planner turn or human review can retarget with the exact visible ref instead of losing the candidate list.
- Agent Control ambiguity resume continuity v1: resumed durable browser jobs now restore ambiguous target flags and candidate refs into planner history, preserving retargeting context after browser reload or job continuation.
- Agent Control ambiguity monitor evidence v1: active monitor detail rows and expanded durable job rows now show ambiguous-target candidate refs, making retargeting options visible without opening the saved report.
- Agent Control internal-UI isolation v1: page snapshots, form detection, and editable targeting now exclude ResonantOS overlay/inline controls so Augmentor cannot confuse its own control UI with the webpage under control.
- Durable Browser Jobs blocker guidance v1: expanded job rows now surface aggregate progress plus the latest recommended next human action, so blocked/failed jobs remain understandable outside the active Agent Control monitor.
- Durable Browser Jobs stale-progress evidence v1: running and approval jobs with no recent recorded progress are flagged passively in `/jobs` and the monitor with last-activity timing plus next human action, without silently mutating job status.
- Durable Browser Jobs focus safety v1: `/jobs focus`, `/resume`, and `/continue` route through the same job-specific focus boundary before restarting work, and missing locked tabs produce a clear no-restart failure instead of falling back to the ambient active page.
- Browser Control delegation packets v1: blocked control tasks delegated to the Resonant Engineer carry a bounded context packet with goal, target, aggregate progress, blocker, recent trace, and safety boundary while keeping add-ons outside provider, wallet, credential, and trusted-memory authority.
- Delegation packet review v1: the Add-ons workspace lists recent Hermes/OpenCode/Engineer handoff packets and highlights whether a bounded context packet is attached, so delegated work remains inspectable instead of disappearing into files.
- Artifacts Workspace action summary v1: browser-control reports and job reports now expose derived status, target, aggregate progress, and next-human-action summaries in artifact cards/previews, while preserving raw markdown as intake evidence.
- Artifacts Workspace grouping v1: saved browser evidence is grouped with filter counts for Agent Control, Browser Jobs, Browser Intake, Wallet/DAO audits, and other intake so the user can inspect the right memory evidence without folder hunting.
- Artifacts Workspace source provenance v1: browser intake previews now extract and display captured page title, URL, and capture timestamp from raw markdown metadata before promotion into AI Memory.
- Secure Autofill Guard v1: content-script field classification permits search/query submits and non-sensitive document/generic typing, while blocking credential, login, payment, wallet, personal-contact, and non-search submit automation before any value is written.
- Wallet State Detection v1: `/wallet status` checks Phantom provider presence and connected/not-connected state from the active page's main world without requesting wallet connection, signatures, seed/private keys, credentials, or transaction submission.
- DAO Workflow Helper v1: `/dao <goal>` reads the active page, identifies visible wallet/governance controls and fields, prepares a safe sequence, and explicitly stops before wallet connect, signing, voting, transfer, transaction confirmation, or public submission.
- Wallet/DAO Audit Artifacts v1: `/wallet audit` and `/dao audit <goal>` save read-only wallet/provider state plus visible governance controls/fields into Living Archive intake and queue review, without requesting wallet connection, signing, voting, transfers, transactions, or public submission.
- Wallet/DAO dApp fixture coverage v1: deterministic and live browser-host tests now cover common DAO controls and fields such as connect wallet, vote for/against/abstain, execute/queue transaction, treasury recipient, quorum, deadline, and treasury-transfer evidence while preserving human-only wallet/vote/submit boundaries.
- Shopping/search/cart-style flows with safety stops.
- Wallet, payment, login, credential, and public submit boundaries.

## Remaining Capability Work

1. Parallel / Durable Browser Jobs
   - Continue refining approval UX only after real user testing; the deterministic baseline now includes job-row approval controls plus page/target evidence.

2. Email / Calendar Provider Connectors
   - Current connectors are manual provider handoffs only.
   - Future provider API connectors require explicit account grants, provider-specific approval flows, and audit trails before any send/schedule action can exist.

3. Secure Autofill Model
   - Vault-backed credential/payment/contact autofill remains blocked until vault, approval, and audit ADRs are complete.
   - Search/query field submission is allowed only when content-script checks classify the target as search-like.

4. Wallet And DAO Workflow Helpers
   - Wallet provider detection is read-only only.
   - DAO helpers now prepare page-specific instructions and stop before signing/submitting.
   - Wallet-adjacent audit artifacts now save read-only evidence to Living Archive intake and queue review.
   - Future work should add provider-specific DAO fixtures only when testing against known dApp patterns, not generic browser automation.

## Validation Rule

Every capability must include:

- deterministic contract test
- live browser-host test where browser behavior matters
- documented safety boundary
- no raw credential, wallet, payment, login, or public-submit automation by default
