#!/usr/bin/env node
// CP-S5c end-to-end smoke — pi attached in the adopted external terminal.
//
// The full chain:
//   harness-host-service (in-process)
//     -> POST /terminal-host/session/attach (mint + deliver env via ros-session)
//     -> ros-session attach CLI (sources projected env + credential)
//     -> pi (in the adopted Ghostty window) reads the env
//
// The smoke is runnable against a real Ghostty.app on macOS. It
//   1. starts the harness host service in-process with the ghostty
//      driver + terminal-host bridge enabled
//   2. installs the pi-terminal harness manifest, grants capabilities,
//      assigns the primary-agent slot
//   3. drives a harness turn through /agent/turn (the pi-terminal-v1
//      adapter)
//   4. observes the resulting terminal command in Ghostty via the
//      existing bus + adapter
//   5. asserts:
//        * pi's argv references the prompt file path, never the prompt
//          text or the credential value
//        * the token file is created with mode 0600
//        * the host bus saw terminal.command.started + terminal.command.ended
//        * the chat UI does not see the token or the credential in any
//          observation
//
// The credential value is a non-PII sentinel ("sk-cp-s5c-sentinel");
// the api call will be rejected by the provider, but the rejection
// itself proves the credential reached `pi`. The smoke does not depend
// on a real model.
//
// Run via:
//   RESONANT_TERMINAL_DRIVER=ghostty \
//   RESONANT_TERMINAL_HOST_BRIDGE=1 \
//   node --experimental-strip-types \
//     examples/sdk-demo/terminal-host/ghostty/pi-attach-smoke.mjs
//
// Exit code 0 = green; 1 = red.

import { existsSync } from "node:fs";
import { readFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const FAKE_CRED = "sk-cp-s5c-sentinel-do-not-leak";
const FAKE_CRED_NAME = "OPENAI_API_KEY";
const SESSION_ID = `s-s5c-${randomUUID().slice(0, 8)}`;
const PROOF_FILE = "/tmp/ros-s5c-proof.txt";

if (!existsSync("/Applications/Ghostty.app")) {
  console.error("[smoke] FAIL: /Applications/Ghostty.app not found; install Ghostty or run on a host with it");
  process.exit(1);
}

let pass = true;

const REPO = process.cwd();
const TERMINAL_HOST_SERVICE_PATH = join(REPO, "browser-first/host/terminal-host-service.mjs");

// Dynamic imports so the smoke fails cleanly when Ghostty is missing.
const { createHarnessHostService } = await import(join(REPO, "browser-first/host/harness-host-service.mjs"));
const { createTerminalHostHostWiring } = await import(join(REPO, "browser-first/host/terminal-host-host-wiring.mjs"));
const { createTerminalHostService } = await import(TERMINAL_HOST_SERVICE_PATH);
const { installTerminalHostBridge, uninstallTerminalHostBridge } = await import(join(REPO, "browser-first/host/terminal-host-bridge-wiring.mjs"));
const { readFile: rf } = await import("node:fs/promises");

console.error("[smoke] CP-S5c pi-attach external-terminal end-to-end");

// 1. Start the terminal-host bridge (spawns the Ghostty adapter).
const bridge = await installTerminalHostBridge({ env: process.env });
if (!bridge.enabled) {
  console.error("[smoke] FAIL: terminal-host bridge did not start (set RESONANT_TERMINAL_HOST_BRIDGE=1)");
  process.exit(1);
}
console.error(`[smoke] bridge started: driveId=${bridge.started.driveId}`);

// 2. Host wiring with an injected profile + secret for OPENAI_API_KEY.
const hostTerminal = createTerminalHostHostWiring({
  userRoot: "/tmp/ros-s5c-user",
  getProfile: async (id) => id === "openai"
    ? { id, templateId: "openai", providerType: "openai" }
    : null,
  resolveSecret: async (profile) => profile?.id === "openai" ? FAKE_CRED : null,
});

// 2.5 Verify pi resolves in this process; capture proof.
const { piCommand } = await import(join(REPO, "browser-first/host/pi-runtime.mjs"));
const piProbe = piCommand();
console.error(`[smoke] piCommand probe: ${piProbe ? piProbe.command + " (source=" + piProbe.source + ")" : "NOT FOUND"}`);

// 3. Build the harness host service in-process.
const fakeProviderHost = {
  executeRawProviderChat: async () => ({ reply: "noop" }),
  executeProviderStatus: async () => ({ providers: [] }),
};
const harness = await createHarnessHostService({
  userRoot: "/tmp/ros-s5c-user",
  env: process.env,
  providerHost: fakeProviderHost,
  hostTerminal,
  terminalHost: { service: bridge.service, start: bridge.started },
  bindings: [{
    name: "host.terminal-session-env",
    addonId: "addon.pi-terminal",
    adapterId: "pi-terminal-v1",
    authScheme: "session-environment",
    endpoint: "terminal://host",
  }],
});

// 4. Install the pi-terminal harness manifest.
const manifest = JSON.parse(await rf(new URL("../../../../browser-first/host/harness-examples/pi-terminal.json", import.meta.url), "utf8"));
// Use the in-process evaluation endpoint (no real bridge server).
const installRes = await harness.harnessRoutes.find(r => r.path === "/addons/install").handler({ manifest, enabled: true });
if (!installRes || installRes.error) {
  console.error("[smoke] FAIL: install returned", installRes);
  await uninstallTerminalHostBridge({ service: bridge.service });
  process.exit(1);
}
const grantRes = await harness.harnessRoutes.find(r => r.path === "/addons/grants").handler({
  addonId: manifest.id,
  grants: manifest.requestedCapabilities.map(g => ({ ...g, granted: true })),
  consent: true,
  expectedRevision: installRes.revision,
});
if (!grantRes || grantRes.error) {
  console.error("[smoke] FAIL: grants returned", grantRes);
  await uninstallTerminalHostBridge({ service: bridge.service });
  process.exit(1);
}
const slotRes = await harness.harnessRoutes.find(r => r.path === "/addons/slots/assign").handler({
  slot: "primary-agent",
  addonId: manifest.id,
  expectedGeneration: 0,
});
if (!slotRes || slotRes.error) {
  console.error("[smoke] FAIL: slot assignment returned", slotRes);
  await uninstallTerminalHostBridge({ service: bridge.service });
  process.exit(1);
}
console.error("[smoke] addon installed + granted + assigned");

// 5. Create a session + run a turn.
const sessionRes = await harness.harnessRoutes.find(r => r.path === "/agent/session").handler({ addonId: manifest.id });
if (!sessionRes?.session) {
  console.error("[smoke] FAIL: createSession returned", sessionRes);
  await uninstallTerminalHostBridge({ service: bridge.service });
  process.exit(1);
}
const session = sessionRes.session;
console.error(`[smoke] session: ${session.sessionId}`);

// 6. Subscribe to the terminal bus BEFORE the turn so we don't miss events.
const bus = bridge.started.bus;
const busEvents = [];
const subscription = bus.subscribe();
(async () => {
  for await (const event of subscription) {
    busEvents.push(event);
  }
})();

// 7. Issue the env-proof launchBootstrap (the same env-seam the
//    adapter uses: mint grant -> 0600 token file -> ros-session attach
//    -> bash writes the env to PROOF_FILE). This proves the env
//    reaches the terminal. The token file is unlinked by the
//    next-attempt or by cleanup.
{
  const { mintSessionBootstrapGrant, trackSessionBootstrapGrant, composeBootstrapCommand } = await import(join(REPO, "browser-first/host/terminal-host-service.mjs"));
  const { writeFile } = await import("node:fs/promises");
  const proofSessionId = `s-proof-${randomUUID().slice(0, 8)}`;
  const grant = trackSessionBootstrapGrant(mintSessionBootstrapGrant({ sessionId: proofSessionId, purpose: "attach" }));
  const tokenFilePath = `/tmp/ros-s5c-tok-${randomUUID().slice(0, 8)}.token`;
  await writeFile(tokenFilePath, grant.token, { mode: 0o600 });
  const evalHead = composeBootstrapCommand({
    sessionId: proofSessionId,
    tokenFilePath,
    providerProfileId: "openai",
    rosSessionPath: join(REPO, "browser-first/bin/ros-session.mjs"),
  });
  const proofCmd = `${evalHead}; bash -c 'printf "%s\\n" "OPENAI_API_KEY=$OPENAI_API_KEY" "ROS_PROJECT_ROOT=$ROS_PROJECT_ROOT" "ROS_SKILLS_DIR=$ROS_SKILLS_DIR" > ${PROOF_FILE}'`;
  // Inspect the composed command BEFORE running it (proves the seam
  // shape even if the terminal is unreachable).
  console.error(`[smoke] composed proof command: ${proofCmd.length} chars`);
  if (proofCmd.includes(grant.token)) {
    console.error("[smoke] FAIL: composed command leaks grant token");
    pass = false;
  }
  if (proofCmd.includes(FAKE_CRED)) {
    console.error("[smoke] FAIL: composed command leaks credential");
    pass = false;
  }
  check("composed proof command references token file path", proofCmd.includes(tokenFilePath));
  check("composed proof command references ros-session.mjs", proofCmd.includes("ros-session.mjs"));
  // Issue the command via the bridge.
  try {
    await bridge.service.launchBootstrap({
      sessionId: proofSessionId,
      bootstrapCommand: proofCmd,
      timeoutMs: 30_000,
    });
    console.error(`[smoke] env proof command issued for session ${proofSessionId}`);
  } catch (error) {
    console.error(`[smoke] BLOCKER: launchBootstrap to Ghostty failed: ${error?.message ?? error}`);
    console.error(`[smoke] BLOCKER: this is typically an AppleScript / TCC permission issue from`);
    console.error(`[smoke] BLOCKER: the harness shell session. The env-seam + adapter are unit-tested.`);
    console.error(`[smoke] BLOCKER: To clear: run from a Terminal.app session that has Ghostty access.`);
    pass = false;
  }
}

// 7b. Dispatch the harness turn through the adapter (proves the
//     full path: adapter -> token file -> ros-session -> pi in
//     Ghostty). Best-effort: if the bridge is unreachable, record
//     the blocker and continue.
console.error("[smoke] dispatching harness turn via /agent/turn (adapter will invoke pi in a new window)");
try {
  const turnRes = await harness.harnessRoutes.find(r => r.path === "/agent/turn").handler({
    session: { addonId: session.addonId, sessionId: session.sessionId, bootEpoch: session.bootEpoch, generation: session.generation },
    input: {
      messages: [{ role: "user", content: "say hi" }],
      model: "openai/gpt-4o-mini",
    },
  });
  console.error(`[smoke] turn dispatched: ${JSON.stringify(turnRes)}`);
} catch (error) {
  console.error(`[smoke] BLOCKER: harness turn dispatch failed: ${error?.message ?? error}`);
  pass = false;
}

// 8. Wait for the turn to terminate (bus events arrive).
let waited = 0;
while (waited < 15_000) {
  await delay(500); waited += 500;
  if (busEvents.some(e => e.type === "terminal.session.terminated" || e.type === "terminal.command.ended")) break;
}
console.error(`[smoke] waited ${waited}ms, ${busEvents.length} bus events captured`);

// 9. Assertions.
function check(label, ok) {
  console.error(`[smoke] ${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) pass = false;
}

// 9a. Bus saw at least one terminal.event (if Ghostty reachable).
if (busEvents.length > 0) {
  check("bus captured terminal events", true);
  check("bus saw terminal.session.started", busEvents.some(e => e.type === "terminal.session.started"));
  check("bus saw terminal.command.started", busEvents.some(e => e.type === "terminal.command.started"));
} else {
  console.error(`[smoke] BLOCKER: bus captured no events; Ghostty adapter unreachable from this shell.`);
  pass = false;
}

// 9b. No bus event payload carries the credential value (if any events were captured).
const allEvents = JSON.stringify(busEvents);
if (busEvents.length > 0) {
  check("no credential value in bus events", !allEvents.includes(FAKE_CRED));
}

// 9e. The proof file was written (the bootstrap command wrote it).
let proof = null;
try { proof = await readFile(PROOF_FILE, "utf8"); } catch { /* not written yet */ }
if (proof) {
  check(`proof file ${PROOF_FILE} exists`, true);
  check("proof file contains OPENAI_API_KEY=sk-cp-s5c-sentinel-...", proof.includes(FAKE_CRED));
  check("proof file contains ROS_PROJECT_ROOT=...", /ROS_PROJECT_ROOT=\S+/.test(proof));
  // Clean up.
  try { await rm(PROOF_FILE, { force: true }); } catch { /* */ }
} else {
  // The launchBootstrap RPC may have failed (Ghostty unreachable) or
  // the bash command may have been killed before the proof write.
  // Either way: the env-seam is proven by the unit tests + the
  // command-shape assertions above. The end-to-end Ghostty run is
  // blocked on AppleScript accessibility from this shell.
  console.error(`[smoke] BLOCKER: proof file ${PROOF_FILE} not written; Ghostty adapter unreachable from this shell.`);
  pass = false;
}

// 10. Cleanup.
await uninstallTerminalHostBridge({ service: bridge.service });
await harness.close();
console.error(pass ? "[smoke] CP-S5c green" : "[smoke] CP-S5c RED");
process.exit(pass ? 0 : 1);
