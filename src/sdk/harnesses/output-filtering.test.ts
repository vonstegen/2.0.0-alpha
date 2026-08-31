// Intent citation: docs/architecture/resonantos-browser-architecture/05-ai-harness-provider-model.md
// Intent citation: docs/architecture/resonantos-browser-architecture/12-sdk-api-implications.md
import { describe, expect, it } from "vitest";

import { filterHarnessOutput, type HarnessOutputRecord } from "./output-filtering";

const stream: HarnessOutputRecord[] = [
  { kind: "raw", content: "\u001b[2Jterminal boot noise" },
  { kind: "user_message", content: "summarize the repo" },
  { kind: "tool_call", content: "grep -r TODO src" },
  { kind: "assistant_message", content: "Here is the summary." },
  { kind: "artifact_written", content: "summary.md" },
  { kind: "verification_report", content: "verified" },
  { kind: "agent_end", content: "done" },
  { kind: "raw", content: "exit 0" },
];

describe("filterHarnessOutput", () => {
  it("assistant-reply-only keeps only the assistant reply text", () => {
    const out = filterHarnessOutput(stream, "assistant-reply-only");
    expect(out.map((record) => record.kind)).toEqual(["assistant_message"]);
    expect(out[0].content).toBe("Here is the summary.");
  });

  it("structured-events drops raw TUI noise but keeps the structured transcript", () => {
    const out = filterHarnessOutput(stream, "structured-events");
    expect(out.map((record) => record.kind)).toEqual([
      "user_message",
      "tool_call",
      "assistant_message",
      "artifact_written",
      "verification_report",
      "agent_end",
    ]);
    expect(out.some((record) => record.kind === "raw")).toBe(false);
  });

  it("raw-log passes everything through without aliasing the input", () => {
    const out = filterHarnessOutput(stream, "raw-log");
    expect(out.map((record) => record.kind)).toEqual(stream.map((record) => record.kind));
    expect(out).not.toBe(stream);
  });

  it("supports the deterministic smoke-test contract (expectedOutputPattern vs filtered output)", () => {
    const visible = filterHarnessOutput(stream, "assistant-reply-only")
      .map((record) => record.content ?? "")
      .join("\n");
    // AddOnDeterministicSmokeTest.expectedOutputPattern matches the filtered,
    // assistant-visible output — tool chatter and TUI noise must not leak.
    expect(new RegExp("Here is the summary\\.").test(visible)).toBe(true);
    expect(visible).not.toContain("grep");
    expect(visible).not.toContain("terminal boot");
  });
});
