import { describe, expect, it } from "vitest";
import type { TerminalTelemetryEvent } from "../../../src/core/terminal-host-contract";
import {
  assertValidSessionTransition,
  createInMemoryTerminalHost,
  deriveProvenanceFidelity,
  initialStateForEntryMode,
  TERMINAL_SESSION_TRANSITIONS,
} from "../terminal-host/in-memory-host";

describe("terminal host session state machine", () => {
  it("maps each entry mode to its initial state", () => {
    expect(initialStateForEntryMode("create")).toBe("created");
    expect(initialStateForEntryMode("adopt")).toBe("adopted");
    expect(initialStateForEntryMode("detached")).toBe("detached");
  });

  it("converges create and adopt on the same attached state (TH-3D equivalence)", () => {
    expect(assertValidSessionTransition("created", "attached")).toBe("attached");
    expect(assertValidSessionTransition("adopted", "attached")).toBe("attached");
  });

  it("accepts the full managed lifecycle including detach and re-attach", () => {
    let state = assertValidSessionTransition("created", "attached");
    state = assertValidSessionTransition(state, "running");
    state = assertValidSessionTransition(state, "detached");
    state = assertValidSessionTransition(state, "attached");
    state = assertValidSessionTransition(state, "terminated");
    expect(state).toBe("terminated");
  });

  it("rejects invalid transitions", () => {
    expect(() => assertValidSessionTransition("created", "running")).toThrow(
      /Invalid terminal session transition/,
    );
    expect(() => assertValidSessionTransition("adopted", "detached")).toThrow(
      /Invalid terminal session transition/,
    );
    expect(() => assertValidSessionTransition("terminated", "attached")).toThrow(
      /Invalid terminal session transition/,
    );
  });

  it("declares no transitions out of the terminal state", () => {
    expect(TERMINAL_SESSION_TRANSITIONS.terminated).toEqual([]);
  });
});

describe("provenance fidelity (ADR-040)", () => {
  it("is structured for a cooperative harness, even without a feedback channel", () => {
    expect(deriveProvenanceFidelity({ harnessCooperative: true, feedbackChannel: "none" })).toBe(
      "structured",
    );
  });

  it("is telemetry for a stock CLI with a feedback channel", () => {
    expect(
      deriveProvenanceFidelity({ harnessCooperative: false, feedbackChannel: "event-stream" }),
    ).toBe("telemetry");
  });

  it("is observation when there is no feedback channel", () => {
    expect(deriveProvenanceFidelity({ harnessCooperative: false, feedbackChannel: "none" })).toBe(
      "observation",
    );
  });
});

describe("in-memory terminal host", () => {
  it("drives a session through the lifecycle and emits terminal telemetry", () => {
    const host = createInMemoryTerminalHost();
    const events: TerminalTelemetryEvent[] = [];
    const dispose = host.onTelemetry((event) => events.push(event));

    const session = host.createSession({
      id: "ros-session-1",
      entryMode: "create",
      provenanceFidelity: "telemetry",
    });
    expect(session.state).toBe("created");

    host.attach(session.id);
    host.run(session.id);
    host.detach(session.id, "user closed tab");
    host.attach(session.id);
    host.terminate(session.id);

    expect(host.get(session.id).state).toBe("terminated");
    expect(host.get(session.id).detachedReason).toBe("user closed tab");

    dispose();
    expect(events.map((event) => event.type)).toEqual([
      "terminal.session.started",
      "terminal.session.terminated",
    ]);
    for (const event of events) {
      expect(event.sessionId).toBe(session.id);
      expect(typeof event.at).toBe("string");
    }
  });

  it("rejects an invalid transition through the host", () => {
    const host = createInMemoryTerminalHost();
    const session = host.createSession({
      id: "ros-session-2",
      entryMode: "create",
      provenanceFidelity: "telemetry",
    });
    expect(() => host.run(session.id)).toThrow(/Invalid terminal session transition/);
  });
});
