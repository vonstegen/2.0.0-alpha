// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
//
// CP-5 output filtering. Harness providers stream mixed output (user echoes,
// tool calls, terminal/TUI noise, and assistant replies). The manifest's
// `AddOnOutputFilteringMode` governs what reaches the consumer. This is the
// single parity seam: every provider's output is filtered by the SAME function,
// so no harness surfaces a vendor-specific stream.

import type { AddOnOutputFilteringMode } from "../../core/contracts";

// Aligned with the OpenCode trust-event vocabulary so a provider can feed its
// raw event stream straight into the filter.
export type HarnessOutputRecordKind =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "artifact_written"
  | "agent_end"
  | "verification_report"
  | "raw";

export interface HarnessOutputRecord {
  kind: HarnessOutputRecordKind;
  content?: string;
  at?: string;
}

const STRUCTURED_KINDS: ReadonlySet<HarnessOutputRecordKind> = new Set([
  "user_message",
  "assistant_message",
  "tool_call",
  "artifact_written",
  "agent_end",
  "verification_report",
]);

// Map a raw harness output stream through the declared filtering mode:
//   assistant-reply-only — only `assistant_message` records (the reply the user
//     should see); tool chatter, user echo, and raw TUI noise are dropped.
//   structured-events    — the structured transcript (user/assistant/tool/
//     artifact/agent/verification) minus raw terminal/TUI noise.
//   raw-log              — passthrough (manifest validation warns on this mode).
export function filterHarnessOutput(
  records: readonly HarnessOutputRecord[],
  mode: AddOnOutputFilteringMode,
): HarnessOutputRecord[] {
  switch (mode) {
    case "assistant-reply-only":
      return records.filter((record) => record.kind === "assistant_message");
    case "structured-events":
      return records.filter((record) => STRUCTURED_KINDS.has(record.kind));
    case "raw-log":
      return [...records];
  }
}
