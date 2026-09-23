// Generic workspace add-on launcher.
//
// Discovers workspace add-ons via `loadWorkspaceAddonManifests()` (an
// addon.json scanner in `addon-delegation-service.mjs`) and, for each that
// declares a runtime command (workspace.runtime.command) and a listening
// port, spawns the upstream HTTP server and exposes bridge routes that
// forward to it.
//
// This module exists so a workspace add-on needs NO edits to Core to be
// adopted: register its `addon.json` under `browser-first/addons/<id>/`,
// declare its `runtime` (start command + port), and the bridge takes
// care of capability tokens, route registration, and reverse-proxying.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { buildWorkspaceAddonRoutes } from "./addon-delegation-host-service.mjs";

async function resolveRuntimeCommand(command) {
  if (!command) return command;
  if (path.isAbsolute(command) && existsSync(command)) return command;
  // Walk PATH to find an absolute match. This makes the launcher robust
  // when the calling process (CI runner, supervised process) has a
  // stripped-down PATH that does not contain common binary locations.
  const PATH = process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  for (const dir of PATH.split(":")) {
    const candidate = path.join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return command;
}

export async function startWorkspaceAddons({
  browserFirstRoot,
  workspaceAddonManifests = [],
  bridgeCapabilityTokens = {},
  bridgePublicUrl = null,
  parentEnv = process.env,
}) {
  const runtimeState = new Map();
  const routes = [];
  const handlers = [];

  for (const entry of workspaceAddonManifests) {
    const { manifest } = entry;
    const runtime = manifest?.contributions?.workspace?.runtime ?? null;
    if (!runtime?.command || !runtime?.port) {
      continue;
    }

    // Resolve the on-disk add-on directory. The loader stores
    // `addonDirName` (the literal directory name under
    // `browser-first/addons/`); fall back to the manifest id minus
    // the `addon.` prefix when not present.
    const addonDirName = String(entry.addonDirName ?? String(manifest.id ?? "").replace(/^addon\./, ""));

    const port = Number(runtime.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      process.stderr.write(
        `[workspace-addon-launcher] ${manifest.id} declared runtime.port=${runtime.port}; invalid, skipping spawn.\n`
      );
      continue;
    }

    const addonDir = path.join(browserFirstRoot(), "addons", addonDirName);
    // Derive an addon-id-specific env-var prefix from the manifest id, e.g.
    // "addon.resonant-echo" → RESONANTOS_BROWSER_FIRST_RESONANT_ECHO_*.
    // The historical `RESONANT_ECHO_*` names are still emitted for backward
    // compatibility with the very first SDK demo workspace add-on.
    const safeId = String(manifest.id ?? "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    const addonPrefix = `RESONANTOS_BROWSER_FIRST_${safeId}`;
    // SDK-DEMO-002: bridgePublicUrl is also exposed via the bridge-token
    // env (added below) so upstreams can hand the iframe enough auth
    // material to call /api/<addon>/* directly through their own
    // origin (not via the bridge proxy). The bridge token is the
    // bound credential the launcher minted; passing it into the
    // upstream env is safe because the upstream only forwards it
    // through its /bootstrap endpoint to the same iframe it is
    // already embedded by.
    const addonBridgeToken = parentEnv?.RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN ?? "";
    const env = {
      ...(parentEnv ?? {}),
      PATH: (parentEnv?.PATH ?? process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"),
      HOME: parentEnv?.HOME ?? process.env.HOME ?? "/root",
      USER: parentEnv?.USER ?? process.env.USER ?? "root",
      LANG: parentEnv?.LANG ?? process.env.LANG ?? "C.UTF-8",
      NODE_ENV: parentEnv?.NODE_ENV ?? process.env.NODE_ENV ?? "development",
      [`${addonPrefix}_PORT`]: String(port),
      [`${addonPrefix}_HOST`]: "127.0.0.1",
      [`${addonPrefix}_BRIDGE_IDENTITY`]: bridgePublicUrl ?? "bridge",
      [`${addonPrefix}_CAPABILITY_TOKEN`]: bridgeCapabilityTokens[manifest?.messaging?.requestCapability] ?? "",
      [`${addonPrefix}_ENTRY`]: path.join(addonDir, String(manifest?.contributions?.workspace?.entry ?? "index.html")),
      [`${addonPrefix}_BRIDGE_TOKEN`]: addonBridgeToken,
      // SDK-DEMO-002: every upstream also sees the canonical bridge
      // token name so a generic add-on (Echo, Counter, or any future
      // workspace add-on) can read the same env var regardless of its
      // addon-id prefix. This is the variable the bootstrap endpoint
      // hands to the iframe.
      RESONANTOS_BROWSER_FIRST_BRIDGE_TOKEN: addonBridgeToken,
      // Upstream servers typically key off the canonical capability name
      // (e.g. RESONANTOS_BROWSER_FIRST_HARNESS_MESSAGING_TOKEN) so they
      // can verify the bridge-forwarded capability token without a
      // per-addon lookup. Set every known capability here.
      ...Object.fromEntries(
        Object.entries(bridgeCapabilityTokens).map(([capability, token]) => [
          `RESONANTOS_BROWSER_FIRST_${String(capability).replace(/-/g, "_").toUpperCase()}_TOKEN`,
          token
        ])
      ),
      // Backward-compatible legacy names used by the very first SDK demo.
      RESONANT_ECHO_HOST: "127.0.0.1",
      RESONANT_ECHO_PORT: String(port),
      RESONANT_ECHO_BRIDGE_IDENTITY: bridgePublicUrl ?? "bridge",
      RESONANT_ECHO_CAPABILITY_TOKEN: bridgeCapabilityTokens[manifest?.messaging?.requestCapability] ?? ""
    };
    // Resolve runtime.command to an absolute path if possible. The launcher
    // may be invoked from a context (CI runner, supervised process) where
    // the runtime spawn does not inherit the caller's PATH; failing
    // explicitly here is preferable to silently skipping the upstream.
    const resolvedCommand = await resolveRuntimeCommand(runtime.command);
    const child = spawn(resolvedCommand, Array.isArray(runtime.args) ? runtime.args : [], {
      cwd: addonDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false
    });

    const startedAt = new Date().toISOString();
    // Write structured events to stderr so they do not contaminate
    // stdout, which downstream self-test runners (e.g.
    // addon-cli-execution-inprocess-self-test) JSON.parse.
    process.stderr.write(JSON.stringify({
      event: "workspace_addon.upstream_started",
      addon: manifest.id,
      pid: child.pid,
      port,
      command: runtime.command
    }) + "\n");

    child.stdout?.on("data", (chunk) => {
      process.stderr.write(`[${manifest.id}] ${chunk}`);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(`[${manifest.id}] ${chunk}`);
    });
    child.on("exit", (code, signal) => {
      process.stderr.write(JSON.stringify({
        event: "workspace_addon.upstream_exited",
        addon: manifest.id,
        pid: child.pid,
        code,
        signal
      }) + "\n");
    });

    runtimeState.set(manifest.id, {
      manifest,
      child,
      port,
      startedAt,
      addonDir
    });
  }

  const addonRegistry = new Map();
  for (const { manifest } of workspaceAddonManifests) {
    addonRegistry.set(manifest.id, manifest);
  }

  const executeWorkspaceAddonRequest = async ({ addon, route, payload }) => {
    const state = runtimeState.get(addon.id);
    if (!state) {
      return {
        status: 503,
        body: {
          ok: false,
          error: `Workspace add-on ${addon.id} runtime is not running on the bridge host.`
        }
      };
    }
    const targetPath = route.path;
    const upstreamPort = state.port;
    const method = String(route.method ?? "POST").toUpperCase();
    // Only attach a body for methods that permit one (POST/PUT/PATCH).
    // GET/HEAD/OPTIONS must not carry a request body — Node's fetch
    // throws "Request with GET/HEAD method cannot have body" otherwise.
    const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
    const fetchOptions = {
      method,
      headers: {
        "content-type": "application/json",
        "x-resonantos-bridge-capability-token":
          bridgeCapabilityTokens[addon?.messaging?.requestCapability] ?? ""
      }
    };
    if (hasBody) {
      fetchOptions.body = JSON.stringify(payload ?? {});
    }
    try {
      const response = await fetch(`http://127.0.0.1:${upstreamPort}${targetPath}`, fetchOptions);
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      return { status: response.status, body: parsed };
    } catch (error) {
      return {
        status: 502,
        body: {
          ok: false,
          error: `Workspace add-on ${addon.id} upstream fetch failed: ${error?.message ?? String(error)}`
        }
      };
    }
  };

  for (const { manifest } of workspaceAddonManifests) {
    const addon = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      mode: manifest.mode,
      trust: manifest.trust,
      boundary: manifest.boundary,
      contributions: manifest.contributions,
      messaging: manifest.messaging
    };
    const addonRoutes = buildWorkspaceAddonRoutes({
      workspaceAddons: [addon],
      executeWorkspaceAddonRequest
    });
    routes.push(...addonRoutes);
    handlers.push(addon);
  }

  const stop = () => {
    for (const [id, state] of runtimeState.entries()) {
      try {
        state.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      console.log(JSON.stringify({
        event: "workspace_addon.upstream_stopping",
        addon: id,
        pid: state.child.pid
      }));
    }
  };

  return { routes, handlers, runtimeState, stop };
}
