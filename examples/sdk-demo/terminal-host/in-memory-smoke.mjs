#!/usr/bin/env node
// Phase 1.5 Step B manual smoke (in-memory mode).
//
// Drives the terminal-host bridge service in `in-memory` driver mode and
// confirms:
//   1. Service composes without spawning.
//   2. The bus accepts terminal.* event types (Phase 1.5 Step 0 contract).
//   3. A consumer subscribing to the bus receives the events in order.
//
// This is the no-iTerm2 smoke; the live iTerm2 smoke is gated on the
// adapter implementation (Phase 1) being real. Run via:
//
//   node --experimental-strip-types examples/sdk-demo/terminal-host/in-memory-smoke.mjs

import { createTerminalHostService, envelopeToHarnessEvent, validateRosTerminalEventEnvelope } from "../../../browser-first/host/terminal-host-service.mjs";
import { TERMINAL_HOST_CONTRACT_VERSION } from "../../../src/core/terminal-host-contract.ts";

const at = () => new Date().toISOString();

async function main() {
  const env = { ...process.env, RESONANT_TERMINAL_DRIVER: "in-memory" };
  const svc = createTerminalHostService({ env, spawn: () => { throw new Error("in-memory mode must not spawn"); } });
  const { driveId, bus } = await svc.start();
  console.log(`[smoke] start: driveId=${driveId}, bus.provenance.addonId=${bus && "ok"}`);

  const observed = [];
  const subscription = bus.subscribe();
  const consumer = (async () => {
    for (let i = 0; i < 3; i += 1) {
      const { value, done } = await subscription.next();
      if (done) break;
      observed.push(value);
    }
  })();

  // Publish three terminal.* envelopes, simulating the iTerm2 adapter.
  const events = [
    { type: "terminal.session.started", sessionId: "smoke-1", at: at() },
    { type: "terminal.cwd.changed", sessionId: "smoke-1", at: at(), cwd: "/Users/andrewjochl/Developer/Projects/resonant-os" },
    { type: "terminal.session.terminated", sessionId: "smoke-1", at: at(), exitStatus: 0 },
  ];
  for (const ev of events) {
    const envelope = { version: TERMINAL_HOST_CONTRACT_VERSION, sessionId: "smoke-1", source: "terminal", at: at(), event: ev };
    const v = validateRosTerminalEventEnvelope(envelope);
    if (!v.ok) { console.error(`[smoke] invalid envelope: ${v.reason}`); process.exit(1); }
    const harnessEvent = envelopeToHarnessEvent(v.value, {
      addonId: "addon.resonant-terminal-iterm2",
      sessionId: "terminal-host-bus",
      turnId: "smoke-1",
      bootEpoch: "smoke-boot",
      generation: 0,
      sequence: 0,
    });
    bus.publish({ turnId: harnessEvent.turnId, type: harnessEvent.type, data: harnessEvent.data });
  }

  await consumer;
  await svc.stop();

  console.log(`[smoke] observed ${observed.length} events:`);
  for (const e of observed) console.log(`  - ${e.type}  ${JSON.stringify(e.data)}`);
  if (observed.length !== 3) { console.error("[smoke] FAIL: expected 3 events"); process.exit(1); }
  if (observed[0].type !== "terminal.session.started") { console.error("[smoke] FAIL: first event type"); process.exit(1); }
  if (observed[2].type !== "terminal.session.terminated") { console.error("[smoke] FAIL: last event type"); process.exit(1); }
  console.log("[smoke] PASS");
}

main().catch((error) => { console.error("[smoke] error", error); process.exit(1); });
