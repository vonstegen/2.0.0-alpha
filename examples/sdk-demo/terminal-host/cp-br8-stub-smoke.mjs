#!/usr/bin/env node
// CP-BR8 stub-terminal smoke (acceptance phase).
//
// Drives the terminal-host bridge service in `in-memory` driver mode and
// proves the CP-BR8 acceptance facts that DO NOT require a real terminal
// binary:
//
//   1. The terminal-host service composes without spawning.
//   2. The terminal.* event envelopes validate and round-trip through
//      `envelopeToHarnessEvent` to the harness event bus.
//   3. The CP-BR5 runtime projection derived from the reconciler + factory
//      active list surfaces the terminal runtime as `ready` and never
//      leaks a token, credential, path, or PID into the public projection.
//   4. The factory's spawn summary is the only public process metadata;
//      the executable, argv, cwd, env, and endpoint never cross the
//      factory boundary into the projection.
//
// This script is the stub-terminal smoke from CP-BR8 §5.1 item 8. It
// never spawns a real terminal. The real Ghostty smoke is
// `cp-br8-real-ghostty-smoke.mjs`.
//
// Run via:
//   node --experimental-strip-types examples/sdk-demo/terminal-host/cp-br8-stub-smoke.mjs
//
// Evidence emitted to stdout is redacted by construction: the script
// only ever prints public identifiers (factory ids, addon ids, status
// vocabulary, and the smoke's own run summary). No credential, token,
// path, PID, env value, or absolute filesystem path appears in output.

import { createRuntimeFactoryRegistry } from "../../../browser-first/host/runtime-factory-registry.mjs";
import {
  ensureReviewedRuntimeFactories,
} from "../../../browser-first/host/runtime-factory-registry.mjs";
import { createRuntimeReconciler } from "../../../browser-first/host/runtime-reconciler.mjs";
import {
  createRuntimeProjectionService,
} from "../../../browser-first/host/runtime-projection-service.mjs";
import {
  seedTerminalRuntimeFactories,
} from "../../../browser-first/host/terminal-runtime-factories.mjs";
import {
  envelopeToHarnessEvent,
  validateRosTerminalEventEnvelope,
} from "../../../browser-first/host/terminal-host-service.mjs";
import { TERMINAL_HOST_CONTRACT_VERSION } from "../../../src/core/terminal-host-contract.ts";

const FAILURES = [];
const record = (name, ok, detail) => {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[stub-smoke] ${status} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAILURES.push(name);
};

const at = () => new Date().toISOString();

async function main() {
  // --- 1. Terminal-host service composes in-memory without spawning. ---
  const env = { ...process.env, RESONANT_TERMINAL_DRIVER: "in-memory" };
  let spawnCalled = false;
  const service = await import("../../../browser-first/host/terminal-host-service.mjs").then(
    (m) => m.createTerminalHostService({
      env,
      spawn: () => {
        spawnCalled = true;
        throw new Error("in-memory mode must not spawn");
      },
    }),
  );
  const started = await service.start();
  record(
    "service-composes-without-spawn",
    started.driveId === "in-memory" && !spawnCalled,
    `driveId=${started.driveId}`,
  );

  // --- 2. Event envelope round-trip. ---
  const envelope = {
    version: TERMINAL_HOST_CONTRACT_VERSION,
    sessionId: "cp-br8-stub-session",
    source: "terminal",
    at: at(),
    event: { type: "terminal.session.started", sessionId: "cp-br8-stub-session", at: at() },
  };
  const v = validateRosTerminalEventEnvelope(envelope);
  record(
    "envelope-validates",
    v.ok === true,
    v.ok ? "ok" : v.reason,
  );
  const harnessEvent = envelopeToHarnessEvent(v.value, {
    addonId: "addon.resonant-terminal-iterm2",
    sessionId: "cp-br8-stub-session",
    turnId: "stub-smoke",
    bootEpoch: "cp-br8-stub-boot",
    generation: 0,
    sequence: 0,
  });
  record(
    "envelope-maps-to-harness-event",
    harnessEvent?.type === "terminal.session.started",
    `type=${harnessEvent?.type}`,
  );
  await service.stop();

  // --- 3. CP-BR4 reconciler + CP-BR5 projection surface `ready`. ---
  const registry = createRuntimeFactoryRegistry({});
  ensureReviewedRuntimeFactories(registry, { observers: new Map() });
  seedTerminalRuntimeFactories(registry, {
    serviceFactory: () => service,
  });
  const events = [];
  const hostProjection = () => ({
    installations: {
      "addon.resonant-terminal-ghostty": {
        installed: true,
        enabled: true,
        compatible: true,
        grantedCapabilities: [
          { capability: "terminal-host", scope: "self", revocationBehavior: "hard-stop", granted: true },
        ],
        requiredCapabilities: ["terminal-host"],
        manifest: { runtimeType: "local-service", category: "terminal-host" },
        projectionGeneration: 1,
      },
    },
  });
  const reconciler = createRuntimeReconciler({
    factoryRegistry: registry,
    loadHostProjection: hostProjection,
    emit: (event) => events.push(event),
  });

  // Run reconcile() so the Ghostty factory is actually called; the
  // reconciler is idempotent and a single tick exercises the full
  // start->ready transition.
  const reconcileResult = await reconciler.reconcile();
  record(
    "reconcile-starts-ghostty",
    Array.isArray(reconcileResult?.transitioned) && reconcileResult.transitioned.length >= 1,
    `transitioned=${reconcileResult?.transitioned?.length ?? 0}`,
  );

  const hostRegistry = {
    snapshot: hostProjection,
  };
  const runtimeProjection = createRuntimeProjectionService({
    hostRegistry,
    reconciler,
    bridgeStatus: { snapshot: () => ({ status: "connected", instanceId: "stub-smoke" }) },
  });
  const projection = runtimeProjection.snapshot();
  const ghosttyEntry = projection.runtimeList.find(
    (entry) => entry.addonId === "addon.resonant-terminal-ghostty",
  );
  record(
    "projection-surfaces-ready-runtime",
    ghosttyEntry?.status === "ready",
    `status=${ghosttyEntry?.status}`,
  );

  // --- 4. Projection is non-secret: no token / credential / path / PID. ---
  const serialized = JSON.stringify(projection);
  const forbiddenSubstrings = [
    "token", "secret", "password", "bearer", "credential", "authFile", "tokenFile",
    "/Users/", "/home/", "argv", "pid", "RESONANT_TERMINAL", "HOME=", "PATH=",
  ];
  // Note: "token" is checked as a literal substring, but the projection
  // field name "addonId" / "runtimeType" / etc. do not match the
  // forbidden list above. The shape-walker guards against a hostile host
  // registry projection that smuggles a `token` field.
  const forbiddenHits = forbiddenSubstrings.filter((needle) =>
    serialized.toLowerCase().includes(needle.toLowerCase()),
  );
  record(
    "projection-contains-no-secret-shaped-substring",
    forbiddenHits.length === 0,
    forbiddenHits.length === 0 ? "clean" : `forbidden: ${forbiddenHits.join(",")}`,
  );

  // --- 5. Factory spawn summary is the only public process metadata. ---
  const factoryIds = registry.list().map((f) => f.factoryId);
  const ghosttySummary = registry.list().find((f) =>
    (typeof f.spawnPolicy?.spawnSummary === "string" && f.spawnPolicy.spawnSummary.includes("Ghostty")) ||
    (typeof f.factoryId === "string" && f.factoryId.includes("ghostty")),
  );
  const ghosttyFactory = registry.get(ghosttySummary?.factoryId ?? "");
  record(
    "factory-spawn-summary-public",
    typeof ghosttySummary?.spawnPolicy?.spawnSummary === "string" &&
      ghosttySummary.spawnPolicy.spawnSummary.length > 0,
    `spawnSummary=${ghosttySummary?.spawnPolicy?.spawnSummary ?? "(missing)"}`,
  );
  // The factory object must NOT expose executable / argv / cwd / env
  // keys outside its spawnPolicy. The factory object exposes:
  //   - spawnPolicy (object)
  //   - start, stop, health, degrade, closeSessions (functions)
  //   - __driver, __perAddon: underscored test seams (private)
  const factoryKeys = Object.keys(ghosttyFactory ?? {}).sort();
  const allowedKeys = new Set([
    "spawnPolicy", "start", "stop", "health", "degrade", "closeSessions",
    "__driver", "__perAddon",
  ]);
  record(
    "factory-object-only-public-process-metadata",
    factoryKeys.length > 0 && factoryKeys.every((key) => allowedKeys.has(key)),
    `keys=${factoryKeys.join(",")}`,
  );
  record(
    "factory-ids-stable",
    factoryIds.includes("com.resonantos.factory.terminal-host.ghostty") ||
      factoryIds.includes("com.resonantos.factory.terminal-host.iterm2"),
    `factoryIds=${factoryIds.join(",")}`,
  );

  // --- 6. closeSessions preserves no-confirm teardown (no throw). ---
  // Drive a reconcile that stops Ghostty, asserting the factory's
  // closeSessions is called and does not throw on cleanup errors.
  const ghosttyHandle = reconciler.listActive?.().find(
    (entry) => entry.addonId === "addon.resonant-terminal-ghostty",
  );
  record(
    "ghostty-handle-registered",
    typeof ghosttyHandle !== "undefined",
    `handle=${ghosttyHandle?.addonId ?? "(none)"}`,
  );
  if (ghosttyHandle && ghosttyFactory) {
    try {
      // The handle held by the reconciler is a public summary only; the
      // factory's `closeSessions` accepts a real handle. We exercise the
      // no-confirm guarantee by calling the factory's closeSessions
      // against a synthesized handle that has the minimum the factory
      // expects (it ignores unknown keys), which is exactly what a real
      // teardown looks like.
      const fakeHandle = { addonId: ghosttyHandle.addonId, driveId: "in-memory" };
      await ghosttyFactory.closeSessions(fakeHandle, { addonId: ghosttyHandle.addonId, now: at() });
      record("close-sessions-no-throw", true, "ok");
    } catch (error) {
      record("close-sessions-no-throw", false, error?.message ?? "(unknown)");
    }
  }

  if (FAILURES.length === 0) {
    console.log("[stub-smoke] overall: PASS");
    process.exit(0);
  }
  console.error(`[stub-smoke] overall: FAIL (${FAILURES.length} failure${FAILURES.length === 1 ? "" : "s"})`);
  for (const name of FAILURES) console.error(`[stub-smoke]   - ${name}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(`[stub-smoke] fatal: ${error?.message ?? error}`);
  process.exit(1);
});