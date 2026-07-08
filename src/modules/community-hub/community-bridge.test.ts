import { describe, expect, it } from "vitest";
import { createCommunityBridge } from "./community-bridge";

function recordingTransport(responder: (method: string, params?: Record<string, unknown>) => unknown = () => ({})) {
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const transport = async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    return responder(method, params);
  };
  return { transport, calls };
}

describe("createCommunityBridge (Art. II — everything routes through the host)", () => {
  it("normalizes the poller snapshot shape", async () => {
    const { transport } = recordingTransport(() => ({ events: [{ id: "e1" }], tasks: null, degraded: true }));
    const bridge = createCommunityBridge(transport);
    const snap = await bridge.snapshot();
    expect(snap.events).toEqual([{ id: "e1" }]);
    expect(snap.tasks).toEqual([]);
    expect(snap.presence).toEqual([]);
    expect(snap.degraded).toBe(true);
  });

  it("unwraps list reads to arrays", async () => {
    const { transport } = recordingTransport((method) =>
      method === "community.list_tasks" ? { tasks: [{ id: "t1" }] } : {},
    );
    const bridge = createCommunityBridge(transport);
    expect(await bridge.listTasks()).toEqual([{ id: "t1" }]);
    expect(await bridge.listEvents()).toEqual([]);
  });

  it("tags every write as source:user so the host approval gate lets it through", async () => {
    const { transport, calls } = recordingTransport();
    const bridge = createCommunityBridge(transport);
    await bridge.rsvp("e1", "going");
    await bridge.checkIn("e1");
    await bridge.claimTask("t1", "claim");
    await bridge.setPresence("around", "prepping");
    await bridge.clearPresence();
    await bridge.report("event", "e1", "spam");

    expect(calls.map((c) => c.method)).toEqual([
      "community.rsvp",
      "community.checkin",
      "community.claim_task",
      "community.set_presence",
      "community.set_presence",
      "community.report",
    ]);
    for (const call of calls) {
      expect(call.params?.source).toBe("user");
    }
    expect(calls[0].params).toMatchObject({ eventId: "e1", state: "going" });
    expect(calls[2].params).toMatchObject({ taskId: "t1", action: "claim" });
    expect(calls[4].params).toMatchObject({ clear: true });
  });

  it("throws if constructed without a transport", () => {
    // @ts-expect-error intentional misuse
    expect(() => createCommunityBridge(undefined)).toThrow(/transport/);
  });
});
