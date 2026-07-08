// Offline tests for the Community Hub policy layer (M3).
// A stub api-client records calls; we assert the host's constitutional guards:
//   Art. IV  writes fail closed without a member token (never sent anonymously)
//   Art. V   agent-initiated writes need explicit approval; user writes pass
//   Art. I   reads degrade (not throw) when the backend is unreachable
//   Art. II  writes attach the vault token when they DO go out

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCommunityHubService, CommunityHostError, WRITE_METHODS } from "../src/community-host.mjs";
import { createTokenVault } from "../src/token-vault.mjs";
import { CommunityNetworkError } from "../src/api-client.mjs";

function stubClient(overrides = {}) {
  const calls = [];
  const rec = (name) => (args) => {
    calls.push({ name, args });
    return Promise.resolve({ ok: true, name });
  };
  const client = {
    baseUrl: "https://hub.example.com",
    listEvents: rec("listEvents"),
    listTasks: rec("listTasks"),
    listPresence: rec("listPresence"),
    rsvp: rec("rsvp"),
    checkin: rec("checkin"),
    claimTask: rec("claimTask"),
    setPresence: rec("setPresence"),
    report: rec("report"),
    ...overrides,
  };
  client.calls = calls;
  return client;
}

function makeService({ client = stubClient(), token } = {}) {
  const vault = createTokenVault({ env: {} });
  if (token) vault.set(token);
  return { service: createCommunityHubService({ client, vault }), client, vault };
}

describe("community-host reads", () => {
  it("proxies public reads without requiring a token", async () => {
    const { service, client } = makeService();
    const res = await service.call("community.list_events");
    assert.equal(res.ok, true);
    assert.equal(res.degraded, false);
    assert.equal(client.calls[0].name, "listEvents");
  });

  it("degrades (does not throw) when the backend is unreachable (Art. I)", async () => {
    const client = stubClient({
      listEvents: () => Promise.reject(new CommunityNetworkError("down")),
    });
    const { service } = makeService({ client });
    const res = await service.call("community.list_events");
    assert.equal(res.ok, false);
    assert.equal(res.degraded, true);
    assert.equal(res.error, "backend_unreachable");
  });
});

describe("community-host write auth (Art. IV — no anonymous writes)", () => {
  it("refuses a write with no member token and never calls the client", async () => {
    const { service, client } = makeService();
    await assert.rejects(
      () => service.call("community.rsvp", { eventId: "e1", state: "going" }),
      (e) => e instanceof CommunityHostError && e.status === 401 && e.code === "auth_required",
    );
    assert.equal(client.calls.length, 0);
  });

  it("passes the vault token through on an authenticated write", async () => {
    const { service, client } = makeService({ token: "member-tok" });
    await service.call("community.rsvp", { eventId: "e1", state: "going" });
    assert.equal(client.calls[0].name, "rsvp");
    assert.equal(client.calls[0].args.token, "member-tok");
    assert.equal(client.calls[0].args.eventId, "e1");
  });
});

describe("community-host approval gate (Art. V)", () => {
  it("refuses an agent-initiated write without approval", async () => {
    const { service, client } = makeService({ token: "t" });
    await assert.rejects(
      () => service.call("community.claim_task", { taskId: "t1", source: "agent" }),
      (e) => e instanceof CommunityHostError && e.status === 403 && e.code === "approval_required",
    );
    assert.equal(client.calls.length, 0);
  });

  it("allows an agent-initiated write once approved:true is present", async () => {
    const { service, client } = makeService({ token: "t" });
    await service.call("community.claim_task", { taskId: "t1", action: "claim", source: "agent", approved: true });
    assert.equal(client.calls[0].name, "claimTask");
  });

  it("allows user-initiated writes (the default source) without an approval flag", async () => {
    const { service, client } = makeService({ token: "t" });
    await service.call("community.checkin", { eventId: "e1" });
    assert.equal(client.calls[0].name, "checkin");
  });

  it("gates every declared write method", () => {
    assert.deepEqual(
      [...WRITE_METHODS].sort(),
      ["community.checkin", "community.claim_task", "community.report", "community.rsvp", "community.set_presence"],
    );
  });
});

describe("community-host sign-in + status", () => {
  it("sign-in stores the token so subsequent writes are authorized", async () => {
    const { service, client } = makeService();
    assert.equal(service.isSignedIn(), false);
    service.signIn("fresh-token");
    assert.equal(service.isSignedIn(), true);
    await service.call("community.set_presence", { status: "around" });
    assert.equal(client.calls[0].args.token, "fresh-token");
    service.signOut();
    assert.equal(service.isSignedIn(), false);
  });

  it("status probes reachability and reports auth state", async () => {
    const { service } = makeService({ token: "t" });
    const status = await service.status();
    assert.equal(status.service, "community-hub");
    assert.equal(status.signedIn, true);
    assert.equal(status.backend.reachable, true);
  });

  it("status reports unreachable without throwing", async () => {
    const client = stubClient({ listEvents: () => Promise.reject(new CommunityNetworkError("down")) });
    const { service } = makeService({ client });
    const status = await service.status();
    assert.equal(status.backend.reachable, false);
    assert.match(status.backend.detail, /down/);
  });

  it("rejects unknown methods", async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.call("community.nope"),
      (e) => e instanceof CommunityHostError && e.status === 404,
    );
  });
});
