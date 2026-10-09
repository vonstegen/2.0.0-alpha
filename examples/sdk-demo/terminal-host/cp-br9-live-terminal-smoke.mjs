#!/usr/bin/env node
// CP-BR9 live terminal smoke (acceptance phase).
//
// Proves the real-binary facts the unit tests cannot — the CP-BR9
// `Enable + grant -> real adapter spawn -> Open in Terminal` chain
// reaches a live Ghostty/iTerm2 window, stops it cleanly, and never
// leaks a path / token / PID / env value across the boundary.
//
// Hard rules (CP-BR9 §7 + CP-BR8 §7):
//   - No caller-supplied command / argv / cwd / env (the factory owns
//     the spawn policy; this script never bypasses it).
//   - No `process.env` spread: only `RESONANT_TERMINAL_DRIVER`,
//     `RESONANT_TERMINAL_HOST_BRIDGE`, and explicit `PATH` / `HOME`.
//   - Output is redacted by construction: only public identifiers and
//     the smoke's own run summary appear. No credential, token, full
//     private path, PID, or env value is emitted.
//
// Run via:
//   node --experimental-strip-types \
//     examples/sdk-demo/terminal-host/cp-br9-live-terminal-smoke.mjs [driver]
//
// Default driver: ghostty. Pass `iterm2` to exercise the iTerm2 path.
// Exit code 0 = pass, 1 = fail, 2 = not-runnable (binary missing).

import { existsSync } from "node:fs";
import {
  createHarnessHostService,
} from "../../../browser-first/host/harness-host-service.mjs";
import {
  loadTerminalAddonSeedInstallations,
} from "../../../browser-first/host/terminal-addon-seed.mjs";
import {
  createTerminalHostServiceOwner,
} from "../../../browser-first/host/terminal-host-service-owner.mjs";
import {
  createRuntimeFactoryRegistry,
  ensureReviewedRuntimeFactories,
} from "../../../browser-first/host/runtime-factory-registry.mjs";
import {
  seedTerminalRuntimeFactories,
} from "../../../browser-first/host/terminal-runtime-factories.mjs";
import { createHostRuntimeLifecycle } from "../../../browser-first/host/runtime-lifecycle-host.mjs";
import { createRuntimeProjectionService } from "../../../browser-first/host/runtime-projection-service.mjs";
import { evaluateBridgeRequestForSelfTest } from "../../../browser-first/host/bridge-server.mjs";

const driver = (process.argv[2] || "ghostty").toLowerCase();
const addonId = `addon.resonant-terminal-${driver}`;
const tokens = {
  "addon-runtime-read": "read-token",
  "addon-runtime-control": "control-token",
};

const FAILURES = [];
const record = (name, ok, detail) => {
  const status = ok ? "PASS" : "FAIL";
  console.log(`[cp-br9-live-${driver}] ${status} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAILURES.push(name);
};

// Guard: real terminal binary at the canonical path.
const GHOSTTY_APP = "/Applications/Ghostty.app";
const ITERM_APP = "/Applications/iTerm.app";
if (driver === "ghostty" && !existsSync(GHOSTTY_APP)) {
  console.error(`[cp-br9-live-${driver}] SKIP: ${GHOSTTY_APP} not found`);
  process.exit(2);
}
if (driver === "iterm2" && !existsSync(ITERM_APP)) {
  console.error(`[cp-br9-live-${driver}] SKIP: ${ITERM_APP} not found`);
  process.exit(2);
}

// Env allowlist: only the documented keys cross the boundary. The
// smoke is the agent-side caller, not the bridge; the bridge spawns
// the adapter using its own pinned allowlist.
const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  RESONANT_TERMINAL_DRIVER: driver,
  RESONANT_TERMINAL_HOST_BRIDGE: "0", // factory-driven start; the bridge-level service is off so the owner is the single source
};

let storeStored = null;
const store = {
  read: async () => storeStored,
  write: async (value) => { storeStored = structuredClone(value); },
};
const providerHost = {
  executeProviderStatus: async () => ({ providers: [] }),
  executeBridgeChat: async () => ({}),
};

async function callRoute(svc, url, body = {}, headers = {}) {
  const method = url.startsWith("/terminal-host/status") || url.startsWith("/addons/registry") ? "GET" : "POST";
  const route = svc.harnessRoutes.find((entry) => entry.path === url.split("?")[0]);
  return evaluateBridgeRequestForSelfTest({
    method,
    url,
    body,
    routes: svc.harnessRoutes,
    bridgeToken: "bridge-token",
    bridgeCapabilityTokens: tokens,
    listenerPort: 47773,
    headers: {
      host: "127.0.0.1:47773",
      "x-resonantos-bridge-token": "bridge-token",
      "x-resonantos-bridge-capability-token": tokens[route?.requiredCapability],
      ...headers,
    },
    rawHeaders: ["Host", "127.0.0.1:47773"],
  });
}

function eventLog(label) {
  return (event) => {
    // Reconciler events are public identifiers only (CP-BR4 §9).
    const safe = {
      type: event?.type,
      addonId: event?.addonId,
      factoryId: event?.factoryId,
      generation: event?.generation,
      publicFailureCode: event?.publicFailureCode,
      publicReason: event?.publicReason,
    };
    console.log(`[cp-br9-live-${driver}] ${label}: ${JSON.stringify(safe)}`);
  };
}

async function main() {
  // --- 1. Compose the production wiring (no bridge-level service). ---
  const owner = createTerminalHostServiceOwner();
  const facade = owner.facade({ fallback: null });
  const svc = await createHarnessHostService({
    env,
    store,
    providerHost,
    terminalHost: facade,
    seedInstallations: await loadTerminalAddonSeedInstallations(),
  });
  const factoryRegistry = createRuntimeFactoryRegistry({});
  ensureReviewedRuntimeFactories(factoryRegistry, { observers: new Map() });
  seedTerminalRuntimeFactories(factoryRegistry, {
    serviceFactory: undefined, // use the real createTerminalHostService
    baseEnv: env,
    terminalHostService: null,
    serviceOwner: owner,
  });
  const events = [];
  let projectionSink = null;
  const lifecycle = createHostRuntimeLifecycle({
    factoryRegistry,
    hostRegistry: svc.registry,
    emit: (event) => {
      events.push(event);
      eventLog("reconcile-event")(event);
      projectionSink?.(event);
    },
  });
  const projection = createRuntimeProjectionService({
    hostRegistry: svc.registry,
    reconciler: lifecycle.reconciler,
    bridgeStatus: {
      snapshot: () => ({
        status: "connected",
        version: "alpha",
        endpoint: "http://127.0.0.1:47773",
        publicEndpoint: "http://127.0.0.1:47773",
        startedAt: new Date(0).toISOString(),
        uptimeSeconds: 0,
        instanceId: "cp-br9-live-smoke",
        bootEpoch: String(svc.registry.snapshot().bootEpoch ?? ""),
      }),
    },
    sessionCounts: { getSessionsByRuntime: () => ({ activeSessionCount: 0 }) },
  });
  projectionSink = (event) => projection.recordEvent(event);

  // The fence hook is intentionally left unwired: the smoke drives
  // reconciles explicitly so the assertions are deterministic.
  await lifecycle.reconciler.reconcile();
  record(
    "seed-installed-target-addon",
    svc.registry.snapshot().installations[addonId]?.installed === true,
    `installed=${svc.registry.snapshot().installations[addonId]?.installed}`,
  );

  // --- 2. Drive the real registry routes: enable, then grant. ---
  const enableResp = await callRoute(svc, "/addons/enabled", {
    addonId,
    enabled: true,
    expectedRevision: svc.registry.snapshot().revision,
  });
  record(
    "enable-route-ok",
    enableResp.status === 200,
    `status=${enableResp.status} body=${JSON.stringify(enableResp.payload)}`,
  );
  // Grant must come AFTER enable so the registry fence is on the
  // enabled+granted state by the time the reconciler runs.
  const grantResp = await callRoute(svc, "/addons/grants", {
    addonId,
    grants: [{ capability: "terminal-host", scope: "system", revocationBehavior: "degrade", granted: true }],
    consent: true,
    expectedRevision: svc.registry.snapshot().revision,
  });
  record(
    "grant-route-ok",
    grantResp.status === 200,
    `status=${grantResp.status} body=${JSON.stringify(grantResp.payload)}`,
  );
  // Drive a reconcile to consume the fences.
  await lifecycle.reconciler.reconcile();
  await lifecycle.reconciler.reconcile();

  // --- 3. The live terminal service is bound through the single owner. ---
  record(
    "owner-binds-terminal-addon",
    owner.ownerAddonId() === addonId,
    `owner=${owner.ownerAddonId()}`,
  );
  const liveStatus = facade.service.status();
  record(
    "live-service-alive",
    liveStatus.alive === true,
    `alive=${liveStatus.alive} driveId=${liveStatus.driveId} adapterId=${liveStatus.adapterId}`,
  );
  record(
    "live-driver-pinned",
    liveStatus.driveId === driver,
    `driveId=${liveStatus.driveId}`,
  );

  // --- 4. CP-BR5 projection surfaces the runtime as `ready`. ---
  const snap = projection.snapshot();
  const target = snap.runtimeList.find((entry) => entry.addonId === addonId);
  record(
    "projection-status-ready",
    target?.status === "ready",
    `status=${target?.status} factoryId=${target?.factoryId}`,
  );
  record(
    "projection-runtime-type-local-service",
    target?.runtimeType === "local-service",
    `runtimeType=${target?.runtimeType}`,
  );
  record(
    "bridge-overview-connected",
    snap.bridgeOverview?.status === "connected",
    `status=${snap.bridgeOverview?.status}`,
  );

  // --- 5. The projection is public by construction: no secret-shaped values. ---
  const serialized = JSON.stringify(snap);
  const forbiddenSubstrings = [
    "token", "secret", "password", "bearer", "credential",
    "/Users/", "/home/", "argv", "pid", "RESONANT_TERMINAL_HOST_BRIDGE",
    "HOME=", "PATH=",
  ];
  const hits = forbiddenSubstrings.filter((needle) => serialized.toLowerCase().includes(needle.toLowerCase()));
  record(
    "projection-no-secret-shaped-substring",
    hits.length === 0,
    hits.length === 0 ? "clean" : `forbidden: ${hits.join(",")}`,
  );

  // --- 6. Lifecycle events are non-secret. ---
  const forbiddenEventFields = ["token", "secret", "password", "bearer", "credential", "argv", "pid"];
  const eventLeaks = events.flatMap((event) => {
    const flat = JSON.stringify(event);
    return forbiddenEventFields.filter((needle) => flat.toLowerCase().includes(needle));
  });
  record(
    "lifecycle-events-no-secret-shaped-substring",
    eventLeaks.length === 0,
    eventLeaks.length === 0 ? "clean" : `leaks: ${eventLeaks.join(",")}`,
  );

  // --- 7. Disable the runtime and confirm clean teardown. ---
  await callRoute(svc, "/addons/enabled", {
    addonId,
    enabled: false,
    expectedRevision: svc.registry.snapshot().revision,
  });
  await lifecycle.reconciler.reconcile();
  await lifecycle.reconciler.reconcile();
  record(
    "disable-stops-runtime",
    owner.ownerAddonId() === null,
    `owner=${owner.ownerAddonId()}`,
  );
  const afterStop = projection.snapshot().runtimeList.find((entry) => entry.addonId === addonId);
  record(
    "projection-status-inactive-after-stop",
    afterStop?.status === "inactive" || afterStop?.status === undefined,
    `status=${afterStop?.status}`,
  );

  // --- 8. Tear down. ---
  await lifecycle.reconciler.stopAll();
  await svc.close();

  if (FAILURES.length === 0) {
    console.log(`[cp-br9-live-${driver}] overall: PASS`);
    process.exit(0);
  }
  console.error(`[cp-br9-live-${driver}] overall: FAIL (${FAILURES.length} failure${FAILURES.length === 1 ? "" : "s"})`);
  for (const name of FAILURES) console.error(`[cp-br9-live-${driver}]   - ${name}`);
  process.exit(1);
}

main().catch(async (error) => {
  console.error(`[cp-br9-live-${driver}] fatal: ${error?.message ?? error}`);
  process.exit(1);
});
