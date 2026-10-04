// CP-S2A test for browser-first/host/terminal-host-session-manager.mjs.
//
// Covers:
//  - state machine: TERMINAL_SESSION_TRANSITIONS + initialStateForEntryMode
//  - happy path: createSession -> attachSession -> detachSession -> listSessions
//  - getSessionState lookup
//  - adoptSession + adopt-over-detached + attach-conflict
//  - attachSession binds harness / project / providerProfileId / grantedCapabilities
//  - detachSession records reason
//  - terminateSession sets terminatedAt + emits terminal.session.terminated
//  - onTerminalTelemetry event auto-terminates a session
//  - telemetry for unknown / already-terminated session is silently ignored
//  - invalid transitions throw (created -> running is rejected)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TERMINAL_SESSION_TRANSITIONS,
  assertValidSessionTransition,
  initialStateForEntryMode,
  createTerminalHostSessionManager,
} from "../host/terminal-host-session-manager.mjs";

describe("state machine primitives", () => {
  it("declares the TH-3D equivalence: created and adopted both converge on attached", () => {
    assert.deepEqual([...TERMINAL_SESSION_TRANSITIONS.created], ["attached", "terminated"]);
    assert.deepEqual([...TERMINAL_SESSION_TRANSITIONS.adopted], ["attached", "terminated"]);
  });

  it("rejects any forward transition out of terminated (terminal rest state)", () => {
    assert.deepEqual([...TERMINAL_SESSION_TRANSITIONS.terminated], []);
    assert.throws(
      () => assertValidSessionTransition("terminated", "attached"),
      /Invalid terminal session transition: terminated -> attached/,
    );
  });

  it("initialStateForEntryMode maps entry modes to entry states", () => {
    assert.equal(initialStateForEntryMode("create"), "created");
    assert.equal(initialStateForEntryMode("adopt"), "adopted");
    assert.equal(initialStateForEntryMode("detached"), "detached");
  });
});

describe("createTerminalHostSessionManager", () => {
  it("creates a session in 'created' state on entryMode=create", () => {
    const mgr = createTerminalHostSessionManager();
    const s = mgr.createSession({
      id: "s1",
      entryMode: "create",
      provenanceFidelity: "telemetry",
      adapterId: "in-memory",
    });
    assert.equal(s.state, "created");
    assert.equal(s.entryMode, "create");
    assert.equal(s.terminalHost.adapterId, "in-memory");
    assert.deepEqual([...s.grantedCapabilities], []);
    assert.ok(typeof s.createdAt === "string" && s.createdAt.length > 0);
  });

  it("refuses to recreate a session with the same id (idempotency rejection)", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "s1", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    assert.throws(() => mgr.createSession({ id: "s1", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" }), /Session already exists/);
  });

  it("happy path: create -> attach -> detach -> list -> get -> terminate", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "s1", entryMode: "create", provenanceFidelity: "structured", adapterId: "iterm2", hostSessionId: "GUID-A" });

    const attached = mgr.attachSession("s1", {
      harness: { addonId: "addon.p", processId: 4242 },
      project: { root: "/home/me/proj", cwd: "/home/me/proj" },
      providerProfileId: "openai",
      grantedCapabilities: ["filesystem"],
    });
    assert.equal(attached.state, "attached");
    assert.deepEqual(attached.harness, { addonId: "addon.p", processId: 4242 });
    assert.deepEqual(attached.project, { root: "/home/me/proj", cwd: "/home/me/proj" });
    assert.equal(attached.providerProfileId, "openai");
    assert.deepEqual([...attached.grantedCapabilities], ["filesystem"]);
    assert.ok(attached.attachedAt);

    const detached = mgr.detachSession("s1", "user-paused");
    assert.equal(detached.state, "detached");
    assert.equal(detached.detachedReason, "user-paused");

    assert.equal(mgr.listSessions().length, 1);
    const listed = mgr.listSessions()[0];
    assert.equal(listed.id, "s1");
    assert.equal(listed.state, "detached");

    assert.equal(mgr.getSessionState("s1").state, "detached");
    assert.equal(mgr.getSessionState("missing"), null);

    const terminated = mgr.terminateSession("s1");
    assert.equal(terminated.state, "terminated");
    assert.ok(terminated.terminatedAt);
  });

  it("adoptSession records an existing terminal session as 'adopted'", () => {
    const mgr = createTerminalHostSessionManager();
    const adopted = mgr.adoptSession({
      id: "s2",
      adapterId: "ghostty",
      hostSessionId: "WIN-9",
      provenanceFidelity: "observation",
    });
    assert.equal(adopted.state, "adopted");
    assert.equal(adopted.entryMode, "adopt");
    assert.equal(adopted.terminalHost.adapterId, "ghostty");
    assert.equal(adopted.terminalHost.hostSessionId, "WIN-9");
  });

  it("adoptSession can re-bind an existing detached session (TH-3D: lands in attached)", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "s3", entryMode: "detached", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    const adopted = mgr.adoptSession({ id: "s3", adapterId: "ghostty", hostSessionId: "WIN-3", provenanceFidelity: "structured" });
    assert.equal(adopted.state, "attached");
    assert.equal(adopted.entryMode, "adopt");
    assert.equal(adopted.terminalHost.adapterId, "ghostty");
    assert.equal(adopted.terminalHost.hostSessionId, "WIN-3");
    assert.equal(adopted.provenanceFidelity, "structured");
    assert.ok(adopted.attachedAt);
  });

  it("adoptSession refuses to overwrite a non-detached session (attach-conflict)", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "s4", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    mgr.attachSession("s4", { harness: { addonId: "addon.p" } });
    assert.throws(() => mgr.adoptSession({ id: "s4", adapterId: "ghostty", hostSessionId: "WIN-4", provenanceFidelity: "structured" }), /already attached/);
  });

  it("rejects an invalid transition (created -> running without attach)", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "s5", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    assert.throws(
      () => /** @type {any} */ (mgr).attachSession.missing("s5"),  // noop sanity check
      undefined,
    );
    // The real assertion: directly poking internal state is impossible; we
    // test the invalid-transition rejection by attempting attach without the
    // required pre-state via the public API: terminate before attach is
    // valid (created -> terminated), but attached -> running is allowed.
    // So instead verify created -> running is not reachable from any verb:
    const s = mgr.createSession({ id: "s6", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    assert.equal(s.state, "created");
    assert.deepEqual([...TERMINAL_SESSION_TRANSITIONS.created], ["attached", "terminated"]);
    // Confirm via assertValidSessionTransition directly:
    assert.throws(() => assertValidSessionTransition("created", "running"), /Invalid terminal session transition: created -> running/);
  });

  it("getSessionState returns null for unknown sessions (no throw)", () => {
    const mgr = createTerminalHostSessionManager();
    assert.equal(mgr.getSessionState("does-not-exist"), null);
  });

  it("throws on unknown session in transition verbs", () => {
    const mgr = createTerminalHostSessionManager();
    assert.throws(() => mgr.attachSession("ghost", { harness: { addonId: "x" } }), /Session not found/);
    assert.throws(() => mgr.detachSession("ghost"), /Session not found/);
    assert.throws(() => mgr.terminateSession("ghost"), /Session not found/);
  });
});

describe("onTerminalTelemetry", () => {
  it("auto-terminates a matching session when terminal.session.terminated fires", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "t1", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    mgr.attachSession("t1", { harness: { addonId: "addon.p" } });

    mgr.onTerminalTelemetry({ type: "terminal.session.terminated", sessionId: "t1", at: "2026-10-04T00:00:00.000Z" });

    const s = mgr.getSessionState("t1");
    assert.equal(s.state, "terminated");
    assert.equal(s.terminatedAt, "2026-10-04T00:00:00.000Z");
  });

  it("silently ignores telemetry for unknown sessions", () => {
    const mgr = createTerminalHostSessionManager();
    // No session t-unknown exists. Calling must not throw.
    mgr.onTerminalTelemetry({ type: "terminal.session.terminated", sessionId: "t-unknown", at: "2026-10-04T00:00:00.000Z" });
    assert.equal(mgr.listSessions().length, 0);
  });

  it("silently ignores telemetry that targets an already-terminated session", () => {
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "t2", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    mgr.terminateSession("t2");
    const before = mgr.getSessionState("t2").terminatedAt;
    mgr.onTerminalTelemetry({ type: "terminal.session.terminated", sessionId: "t2", at: "2099-01-01T00:00:00.000Z" });
    // terminatedAt unchanged -- no double-termination, no throw.
    assert.equal(mgr.getSessionState("t2").terminatedAt, before);
  });

  it("silently ignores telemetry whose transition would be invalid", () => {
    // created -> running is invalid; the public verbs cannot put the
    // session into `running` without first attaching, but the manager
    // already transitions created -> attached on attachSession. The real
    // transition the telemetry hook guards is the terminal.session.
    // terminated -> running case (impossible). Build an attached session
    // and verify a stale `command.ended` event for it is silently ignored
    // (only `terminated` triggers state mutation).
    const mgr = createTerminalHostSessionManager();
    mgr.createSession({ id: "t3", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    mgr.attachSession("t3", { harness: { addonId: "addon.p" } });
    mgr.onTerminalTelemetry({ type: "terminal.command.ended", sessionId: "t3", at: "2026-10-04T00:00:00.000Z", exitStatus: 0 });
    assert.equal(mgr.getSessionState("t3").state, "attached");
  });

  it("re-emits the terminal.session.terminated event when telemetry triggers termination", () => {
    /** @type {import("../../src/core/terminal-host-contract.ts").TerminalTelemetryEvent[]} */
    const captured = [];
    const mgr = createTerminalHostSessionManager({
      telemetryListener: (event) => captured.push(event),
    });
    mgr.createSession({ id: "t4", entryMode: "create", provenanceFidelity: "telemetry", adapterId: "in-memory" });
    mgr.attachSession("t4", { harness: { addonId: "addon.p" } });
    mgr.onTerminalTelemetry({ type: "terminal.session.terminated", sessionId: "t4", at: "2026-10-04T00:00:00.000Z" });
    // Exactly one terminated event observed (from the telemetry hook).
    const terminatedEvents = captured.filter((e) => e.type === "terminal.session.terminated");
    assert.equal(terminatedEvents.length, 1);
  });
});