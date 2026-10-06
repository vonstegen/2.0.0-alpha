// CP-BR0: the core bridge must not host a route that claims to start itself.

import assert from "node:assert/strict";
import test from "node:test";

import { createHarnessHostService } from "../host/harness-host-service.mjs";

async function fixture(t) {
  const host = await createHarnessHostService({
    env: {},
    store: {
      read: async () => null,
      write: async () => undefined,
    },
    providerHost: {
      executeRawProviderChat: async () => ({ reply: "answer" }),
      executeProviderStatus: async () => ({
        providers: [{ configured: true, models: [{ allowed: true }] }],
      }),
    },
    terminalHost: {
      service: {
        status: () => ({
          alive: true,
          driveId: "ghostty",
          adapterId: "addon.resonant-terminal-ghostty",
          sessions: [],
        }),
      },
      start: { bus: {} },
    },
  });
  t.after(() => host.close());
  return host;
}

test("CP-BR0 does not register a bridge-hosted self-start route", async (t) => {
  const host = await fixture(t);
  assert.equal(
    host.harnessRoutes.some((route) => route.path === "/bridge/launch"),
    false,
  );
});
