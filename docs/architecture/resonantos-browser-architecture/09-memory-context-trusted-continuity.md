# 09 — Memory, Context, and Trusted Continuity

## Memory classes

| Class | Purpose | Trust |
| --- | --- | --- |
| Raw transcript/event log | Replay and audit | immutable evidence, potentially sensitive/unverified |
| Working context | Active task reasoning | ephemeral and task-scoped |
| Harness-local state | Checkpoints/internal execution | provider-owned, untrusted by default |
| Returned artifact | Reviewable output | untrusted until verified |
| Candidate memory/intake | Proposed durable knowledge | pending review |
| Trusted continuity | identity, preferences, decisions, commitments, known-good state | host-governed |

## Context envelope

Delegation sends an explicit envelope containing selected facts, source references, sensitivity labels, freshness, allowed purpose, retention policy, and redactions. A harness does not receive an entire chat or archive merely because it has `archive-read`.

## Trusted-memory boundary

The existing rule remains: harnesses and add-ons may retrieve within granted scope, but they MUST NOT write directly to trusted Living Archive knowledge. Writes flow through intake, provenance, review, and promotion. The same rule applies to any replacement memory provider through the neutral broker.

## Continuity record

Trusted continuity SHOULD preserve:

- stable user and system principal identifiers;
- user preferences with sources and consent;
- project scope and rationale;
- decision ledger;
- open commitments/tasks;
- artifact and code pointers;
- grant/delegation audit summaries (not reusable credentials);
- last-known-good configuration and continuity snapshot;
- recovery reports and unresolved risks.

ADR-016's structured compaction remains the baseline. Provider-side summaries and caches are optimizations, not memory authority.

## Ground-0 behavior

Ground-0 may read the last-known-good trusted continuity snapshot and raw audit/history necessary for diagnosis. It MUST quarantine optional executable memory such as hooks, scripts, generated instructions, provider plug-ins, or harness checkpoints until revalidated. Preserving history does not mean replaying code.

## Portability and deletion

Continuity data should remain portable under the user-state architecture. Export, retention, redaction, and deletion policies must preserve audit integrity while respecting user control. Secrets and capability tokens are references or vault state, never continuity payloads.
