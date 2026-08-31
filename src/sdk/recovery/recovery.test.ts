// Intent citation: docs/architecture/resonantos-browser-architecture/10-ground-0-recovery.md
import { describe, expect, it } from "vitest";

import type { GroundZeroSnapshot } from "./index";
import { driveRecoveryLadder, enterGroundZero, reEnableFromGroundZero, serializeKnownGoodSet, verifyKnownGoodSet } from "./index";

function snapshot(): GroundZeroSnapshot {
  return {
    state: "normal",
    activeGrantIds: ["grant-1", "grant-2"],
    optionalItems: [
      { id: "addon.hermes", kind: "harness" },
      { id: "addon.browser", kind: "extension" },
    ],
    quarantine: [],
    audit: [],
  };
}

describe("Ground-0 state machine", () => {
  it("enters Ground-0 by revoking every grant and quarantining optional items", () => {
    const next = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "2026-08-28T12:00:00Z" });

    expect(next.state).toBe("ground-zero");
    expect(next.activeGrantIds).toEqual([]); // no pre-recovery authority survives
    expect(next.quarantine.map((q) => q.item)).toEqual(["addon.hermes", "addon.browser"]);
    expect(next.audit).toHaveLength(1);
    expect(next.audit[0].effects).toContain("revoked 2 active grants");
    expect(next.audit[0].effects).toContain("quarantined 2 optional items");
  });

  it("refuses to enter Ground-0 from a non-normal state", () => {
    expect(() =>
      enterGroundZero({ ...snapshot(), state: "ground-zero" }, { trigger: "x", at: "y" }),
    ).toThrow(/cannot enter Ground-0/);
  });

  it("re-enables healthy items in dependency order with fresh grants, never old ones", () => {
    const entered = enterGroundZero(snapshot(), { trigger: "crash-loop", at: "t1" });
    const reenabled = reEnableFromGroundZero(entered, {
      order: ["addon.browser", "addon.hermes"], // dependency order
      healthCheck: (id) => id !== "addon.hermes", // hermes fails its health check
      at: "t2",
    });

    expect(reenabled.state).toBe("normal");
    expect(reenabled.activeGrantIds).toEqual(["fresh-grant:addon.browser"]);
    // Old grants are never revived.
    expect(reenabled.activeGrantIds).not.toContain("grant-1");
    expect(reenabled.quarantine.find((q) => q.item === "addon.browser")?.disposition).toBe("accepted");
    expect(reenabled.quarantine.find((q) => q.item === "addon.hermes")?.disposition).toBe("left-disabled");
  });

  it("leaves omitted items disabled", () => {
    const entered = enterGroundZero(snapshot(), { trigger: "manual", at: "t1" });
    const reenabled = reEnableFromGroundZero(entered, {
      order: ["addon.browser"], // addon.hermes omitted
      healthCheck: () => true,
      at: "t2",
    });
    const hermes = reenabled.quarantine.find((q) => q.item === "addon.hermes");
    expect(hermes?.disposition).toBeUndefined();
    expect(reenabled.activeGrantIds).toEqual(["fresh-grant:addon.browser"]);
  });

  it("refuses to re-enable from a non-ground-zero state", () => {
    expect(() =>
      reEnableFromGroundZero(snapshot(), { order: [], healthCheck: () => true, at: "y" }),
    ).toThrow(/cannot re-enable/);
  });
});

describe("known-good manifest set", () => {
  const digest = (serialized: string) => `d:${serialized}`;

  it("serializes canonically — manifest-id order is irrelevant", () => {
    expect(serializeKnownGoodSet({ version: "1", manifestIds: ["b", "a"] })).toBe(
      serializeKnownGoodSet({ version: "1", manifestIds: ["a", "b"] }),
    );
  });

  it("verifies an intact set and rejects a tampered one", () => {
    const set = {
      version: "1",
      frozenAt: "t",
      manifestIds: ["a"],
      configDigest: digest(serializeKnownGoodSet({ version: "1", manifestIds: ["a"] })),
    };
    expect(verifyKnownGoodSet(set, digest)).toBe(true);
    expect(verifyKnownGoodSet({ ...set, manifestIds: ["b"] }, digest)).toBe(false);
    expect(verifyKnownGoodSet({ ...set, version: "2" }, digest)).toBe(false);
  });
});

describe("Engineer recovery ladder beneath Ground-0", () => {
  const ladder = () => ({
    active: false,
    lastNormalThreadId: "thread-main-desktop",
    checklist: [
      { id: "facts", status: "pending" as const },
      { id: "better-brain", status: "pending" as const },
      { id: "report", status: "pending" as const },
    ],
    changeLog: [] as string[],
  });

  it("activates and resets to phase 1 on Ground-0 entry", () => {
    const next = driveRecoveryLadder("ground-zero", ladder(), "t1");
    expect(next.active).toBe(true);
    expect(next.checklist.map((s) => s.status)).toEqual(["active", "pending", "pending"]);
    expect(next.changeLog).toHaveLength(1);
  });

  it("deactivates and marks the report complete on exit", () => {
    const active = driveRecoveryLadder("ground-zero", ladder(), "t1");
    const exited = driveRecoveryLadder("normal", active, "t2");
    expect(exited.active).toBe(false);
    expect(exited.checklist.find((s) => s.id === "report")?.status).toBe("complete");
    expect(exited.lastNormalThreadId).toBe("thread-main-desktop");
  });

  it("is idempotent when the ladder already matches the Ground-0 state", () => {
    const active = driveRecoveryLadder("ground-zero", ladder(), "t1");
    expect(driveRecoveryLadder("ground-zero", active, "t2")).toBe(active);
    const inactive = ladder();
    expect(driveRecoveryLadder("normal", inactive, "t2")).toBe(inactive);
  });
});
