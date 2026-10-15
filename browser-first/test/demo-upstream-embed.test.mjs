import assert from "node:assert/strict";
import test from "node:test";

import { maybeEmbedDemoUpstreams } from "../host/demo-upstream-embed.mjs";

const spec = (overrides = {}) => ({
  addonId: "addon.test",
  port: 49999,
  bearerToken: "bearer",
  adminToken: "admin",
  create: () => ({
    start: async () => ({}),
    close: async () => undefined,
  }),
  ...overrides,
});

test("skips upstreams without a configured bearer token", async () => {
  let created = 0;
  const { started, decisions } = await maybeEmbedDemoUpstreams({
    upstreams: [spec({ bearerToken: "", create: () => { created += 1; return spec().create(); } })],
  });
  assert.equal(created, 0);
  assert.equal(started.length, 0);
  assert.equal(decisions[0].action, "skipped");
});

test("defers to an already-listening external upstream (embedding never shadows it)", async () => {
  let created = 0;
  const { started, decisions } = await maybeEmbedDemoUpstreams({
    upstreams: [spec({ create: () => { created += 1; return spec().create(); } })],
    probe: async () => ({ occupied: true, status: 200 }),
  });
  assert.equal(created, 0);
  assert.equal(started.length, 0);
  assert.equal(decisions[0].action, "external");
});

test("embeds in-process with the pinned bearer/admin tokens when the port is free", async () => {
  const calls = [];
  const service = { start: async () => ({}), close: async () => calls.push("close") };
  const { started, decisions } = await maybeEmbedDemoUpstreams({
    upstreams: [spec({
      create: (opts) => { calls.push(opts); return service; },
    })],
    probe: async () => ({ occupied: false }),
  });
  assert.deepEqual(calls[0], { port: 49999, bearerToken: "bearer", adminToken: "admin" });
  assert.equal(decisions[0].action, "embedded");
  assert.equal(started.length, 1);
  await started[0].close();
  assert.deepEqual(calls[1], "close");
});

test("a failed embed is reported, not fatal — remaining upstreams still process", async () => {
  const { started, decisions } = await maybeEmbedDemoUpstreams({
    upstreams: [
      spec({ addonId: "addon.broken", create: () => { throw new Error("boom"); } }),
      spec({ addonId: "addon.healthy" }),
    ],
    probe: async () => ({ occupied: false }),
  });
  assert.equal(decisions[0].action, "embed-failed");
  assert.match(decisions[0].detail, /boom/);
  assert.equal(decisions[1].action, "embedded");
  assert.equal(started.length, 1);
  assert.equal(started[0].addonId, "addon.healthy");
});
