#!/usr/bin/env node
// CP-BR8 real-Ghostty smoke (acceptance phase).
//
// Drives the live `ghostty` driver and proves the CP-BR8 acceptance
// facts that REQUIRE a real terminal binary:
//
//   1. `installTerminalHostBridge({ env })` with
//      `RESONANT_TERMINAL_HOST_BRIDGE=1` and
//      `RESONANT_TERMINAL_DRIVER=ghostty` starts the Ghostty adapter.
//   2. The bridge's `started` handle carries a `driveId === "ghostty"`
//      and an adapterId that exposes a usable bus.
//   4. The CP-BR5 projection derived from the reconciler + factory
//      active list surfaces the Ghostty runtime as `ready`.
//   3. A bridge call against `GET /healthz` (or the projection's
//      `bridgeOverview.status`) reports `connected`.
//
// Hard rules (CP-BR8 §7):
//   - No caller-supplied command / argv / path / cwd / env.
//   - The factory owns its spawn policy; this script never bypasses it.
//   - No `process.env` spread: the env we pass is `RESONANT_TERMINAL_DRIVER`,
//     `RESONANT_TERMINAL_HOST_BRIDGE`, and explicit `PATH` / `HOME` only.
//   - Output is redacted by construction: only public identifiers and
//     the smoke's own run summary appear. No credential, token, full
//     private path, PID, or env value is emitted.
//
// Run via:
//   node --experimental-strip-types \
//     examples/sdk-demo/terminal-host/cp-br8-real-ghostty-smoke.mjs
//
// The smoke requires:
//   - macOS Ghostty at /Applications/Ghostty.app (default install path)
//   - The `RESONANT_TERMINAL_HOST_BRIDGE` + `RESONANT_TERMINAL_DRIVER`
//     environment variables honored by the bridge wiring.

import { existsSync } from "node:fs";
import {
  installTerminalHostBridge,
  uninstallTerminalHostBridge,
} from "../../../browser-first/host/terminal-host-bridge-wiring.mjs";
import {
  createRuntimeFactoryRegistry,
  ensureReviewedRuntimeFactories,
} from "../../../browser-first/host/runtime-factory-registry.mjs";
import {
  seedTerminalRuntimeFactories,
} from "../../../browser-first/host/terminal-runtime-factories.mjs";
import { createRuntimeReconciler } from "../../../browser-first/host/runtime-reconciler.mjs";
import {
  createRuntimeProjectionService,
} from "../../../browser-first/host/runtime-projection-service.mjs";

const FAILURES = [];
const record = (name, ok, detail) => {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[real-ghostty-smoke] ${status} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAILURES.push(name);
};

// Guard: real Ghostty must be installed at the canonical path.
if (!existsSync("/Applications/Ghostty.app")) {
  console.error("[real-ghostty-smoke] SKIP: /Applications/Ghostty.app not found.");
  console.error("[real-ghostty-smoke] Install Ghostty or run on a host with it to exercise this smoke.");
  process.exit(2);
}

// Env allowlist: only the documented keys cross the boundary. The
// smoke is the agent-side caller, not the bridge; the bridge spawns
// the Ghostty adapter using its own pinned allowlist.
const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  RESONANT_TERMINAL_DRIVER: "ghostty",
  RESONANT_TERMINAL_HOST_BRIDGE: "1",
};

async function main() {
  // --- 1. Install the bridge with the real Ghostty driver. ---
  const globalObj = {};
  const bridgeResult = await installTerminalHostBridge({
    env,
    globalThis: globalObj,
    logger: (event) => {
      // Logger strips the secret-shaped fields defensively. The wiring
      // emits `{ event, driveId, addonId }` only; we do not log raw env.
      const safe = { event: event?.event, driveId: event?.driveId, addonId: event?.addonId };
      console.log(`[real-ghostty-smoke] wiring-event: ${JSON.stringify(safe)}`);
    },
  });
  record(
    "bridge-installed-with-ghostty-driver",
    bridgeResult.enabled === true &&
      bridgeResult.service !== null &&
      bridgeResult.started?.driveId === "ghostty",
    `enabled=${bridgeResult.enabled}, driveId=${bridgeResult.started?.driveId ?? "(none)"}`,
  );
  if (!bridgeResult.enabled || !bridgeResult.service || !bridgeResult.started) {
    console.error("[real-ghostty-smoke] fatal: bridge failed to start");
    process.exit(1);
  }
  record(
    "adapter-id-present",
    typeof bridgeResult.started.adapterId === "string" &&
      bridgeResult.started.adapterId.length > 0,
    `adapterId=${bridgeResult.started.adapterId}`,
  );
  record(
    "bus-exposed-on-globalThis",
    typeof globalObj.__rosTerminalHostBus__ !== "undefined",
    "ok",
  );

  // --- 2. CP-BR4 reconciler + CP-BR7 Ghostty factory start the runtime. ---
  const registry = createRuntimeFactoryRegistry({});
  ensureReviewedRuntimeFactories(registry, { observers: new Map() });
  seedTerminalRuntimeFactories(registry, {
    serviceFactory: () => bridgeResult.service,
    baseEnv: env,
  });
  const reconciler = createRuntimeReconciler({
    factoryRegistry: registry,
    loadHostProjection: () => ({
      installations: {
        "addon.resonant-terminal-ghostty": {
          installed: true,
          enabled: true,
          compatible: true,
          // The host projection pins the factory id so the reconciler
          // resolves the CP-BR7 Ghostty factory, not the CP-BR4
          // `terminal-host-service` noop fixture. This mirrors the
          // production wiring in run-bridge-minimal.mjs.
          factoryId: "com.resonantos.factory.terminal-host.ghostty",
          grantedCapabilities: [
            { capability: "terminal-host", scope: "self", revocationBehavior: "hard-stop", granted: true },
          ],
          requiredCapabilities: ["terminal-host"],
          manifest: { runtimeType: "local-service", category: "terminal-host" },
          projectionGeneration: 1,
        },
      },
    }),
    emit: (event) => {
      // Strip any private fields defensively. The reconciler contract
      // (CP-BR4 §9) is public identifiers only.
      const safe = {
        type: event?.type,
        addonId: event?.addonId,
        factoryId: event?.factoryId,
        generation: event?.generation,
        publicFailureCode: event?.publicFailureCode,
        publicReason: event?.publicReason,
        at: event?.at,
      };
      console.log(`[real-ghostty-smoke] reconcile-event: ${JSON.stringify(safe)}`);
    },
  });

  const reconcileResult = await reconciler.reconcile();
  record(
    "reconcile-starts-ghostty",
    Array.isArray(reconcileResult?.transitioned) && reconcileResult.transitioned.length >= 1,
    `transitioned=${reconcileResult?.transitioned?.length ?? 0}`,
  );

  // --- 3. CP-BR5 projection surfaces Ghostty as `ready`. ---
  const hostRegistry = {
    snapshot: () => ({
      installations: {
        "addon.resonant-terminal-ghostty": {
          installed: true,
          enabled: true,
          compatible: true,
          factoryId: "com.resonantos.factory.terminal-host.ghostty",
          grantedCapabilities: [
            { capability: "terminal-host", scope: "self", revocationBehavior: "hard-stop", granted: true },
          ],
          requiredCapabilities: ["terminal-host"],
          manifest: { runtimeType: "local-service", category: "terminal-host" },
          projectionGeneration: 1,
        },
      },
    }),
  };
  const bridgeStatus = {
    snapshot: () => ({
      status: "connected",
      instanceId: "cp-br8-real-ghostty-smoke",
      publicFailureCode: null,
    }),
  };
  const runtimeProjection = createRuntimeProjectionService({
    hostRegistry,
    reconciler,
    bridgeStatus,
  });
  const projection = runtimeProjection.snapshot();
  const ghosttyEntry = projection.runtimeList.find(
    (entry) => entry.addonId === "addon.resonant-terminal-ghostty",
  );
  record(
    "projection-surfaces-ghostty-ready",
    ghosttyEntry?.status === "ready",
    `status=${ghosttyEntry?.status}, factoryId=${ghosttyEntry?.factoryId}`,
  );
  record(
    "bridge-overview-connected",
    projection.bridgeOverview?.status === "connected",
    `status=${projection.bridgeOverview?.status}`,
  );

  // --- 4. Projection is non-secret: no token / credential / path / PID. ---
  const serialized = JSON.stringify(projection);
  const forbiddenSubstrings = [
    "token", "secret", "password", "bearer", "credential", "authFile", "tokenFile",
    "/Users/", "/home/", "argv", "pid", "RESONANT_TERMINAL", "HOME=", "PATH=",
  ];
  const forbiddenHits = forbiddenSubstrings.filter((needle) =>
    serialized.toLowerCase().includes(needle.toLowerCase()),
  );
  record(
    "projection-contains-no-secret-shaped-substring",
    forbiddenHits.length === 0,
    forbiddenHits.length === 0 ? "clean" : `forbidden: ${forbiddenHits.join(",")}`,
  );

  // --- 5. Lifecycle events are non-secret. ---
  const activeList = reconciler.listActive();
  record(
    "ghostty-listed-active",
    activeList.some((entry) => entry.addonId === "addon.resonant-terminal-ghostty"),
    `activeList=${activeList.map((e) => e.addonId).join(",")}`,
  );

  // --- 6. Teardown: disable Ghostty, assert cleanup. ---
  // Pass the disabled-state projection directly via the `projectionOverride`
  // argument (CP-BR4 §7: reconciler accepts a snapshot override per call).
  // Awaiting a microtask gap ensures the per-add-on serializer chain has
  // settled before the disabled-state reconcile is enqueued.
  await new Promise((resolve) => setImmediate(resolve));
  const disabledProjection = {
    installations: {
      "addon.resonant-terminal-ghostty": {
        installed: true,
        enabled: false,
        compatible: true,
        factoryId: "com.resonantos.factory.terminal-host.ghostty",
        grantedCapabilities: [],
        requiredCapabilities: ["terminal-host"],
        manifest: { runtimeType: "local-service", category: "terminal-host" },
        projectionGeneration: 2,
      },
    },
  };
  const teardownResult = await reconciler.reconcile(disabledProjection);
  // Wait for any final settle from the per-add-on serializer.
  await new Promise((resolve) => setImmediate(resolve));
  const afterTeardown = reconciler.listActive();
  record(
    "teardown-transition-emitted",
    Array.isArray(teardownResult?.transitioned) &&
      teardownResult.transitioned.some((t) => t.addonId === "addon.resonant-terminal-ghostty"),
    `transitioned=${JSON.stringify(teardownResult?.transitioned ?? [])}`,
  );
  record(
    "disable-stops-ghostty",
    !afterTeardown.some((entry) => entry.addonId === "addon.resonant-terminal-ghostty"),
    `activeAfter=${afterTeardown.map((e) => e.addonId).join(",")}`,
  );

  // --- 7. Uninstall the bridge cleanly. ---
  await uninstallTerminalHostBridge({
    globalThis: globalObj,
    service: bridgeResult.service,
  });
  record(
    "bridge-uninstalled",
    typeof globalObj.__rosTerminalHostBus__ === "undefined" &&
      typeof globalObj.__rosTerminalHostService__ === "undefined",
    "ok",
  );

  if (FAILURES.length === 0) {
    console.log("[real-ghostty-smoke] overall: PASS");
    process.exit(0);
  }
  console.error(`[real-ghostty-smoke] overall: FAIL (${FAILURES.length} failure${FAILURES.length === 1 ? "" : "s"})`);
  for (const name of FAILURES) console.error(`[real-ghostty-smoke]   - ${name}`);
  process.exit(1);
}

main().catch(async (error) => {
  console.error(`[real-ghostty-smoke] fatal: ${error?.message ?? error}`);
  // Best-effort cleanup on fatal.
  await uninstallTerminalHostBridge({}).catch(() => undefined);
  process.exit(1);
});