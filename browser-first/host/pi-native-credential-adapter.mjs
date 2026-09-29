// Pi native credential adapter (P1.2). Builds INTERNAL host-owned launch
// material for the reviewed native Pi harness through the generic
// session-environment delivery chain:
//
//   addon identity -> approved provider profile -> host-owned identity mapping
//        -> host-owned env var -> approved executable -> selected model
//        -> authorize (binding + grant, host-wired) -> secret-free argv + env
//
// This adapter is a pure planner: it resolves launch material, never spawns a
// process, opens a PTY, or exposes a route. The runtime-adapter chat path
// (harness-provider-adapter.mjs / harness-credentials.mjs) is unchanged. A
// credential enters only through the injected `credentialEnv` hook and is
// placed under the mapping's host-owned env var; it never appears in argv,
// the returned projection, an error, or any durable store. Unknown mapping,
// a harness that does not accept session-environment, a missing executable, or
// a missing credential all fail closed.
import path from "node:path";
import process from "node:process";
import { publicHarnessError } from "./harness-adapter-contract.mjs";
import { resolvePiNativeProvider } from "./pi-native-provider-map.mjs";
import { buildSessionEnvironment, redactEnvironment } from "./harness-session-environment.mjs";

const fail = (code) => Object.assign(new Error(publicHarnessError({ code }).message), { code });

export function createPiNativeCredentialAdapter({
  resolveExecutable,
  allProviderProfiles,
  allModelCatalog,
  credentialEnv,
  authorize,
  envAllowlist = [],
  baseEnv = {},
  now = () => new Date().toISOString(),
} = {}) {
  async function plan(input = {}) {
    const { addonId, manifest, providerProfileId, selectedModel, projectPath } = input ?? {};
    if (typeof addonId !== "string" || !addonId) throw fail("permission-denied");
    if (typeof projectPath !== "string" || !projectPath || !path.isAbsolute(projectPath) ||
        /[\0\n]/.test(projectPath)) throw fail("permission-denied");

    const connection = manifest?.harnessProviderConnection;
    const consumes = connection
      ? connection.consumesProviderProfiles === true
      : manifest?.agentRuntime?.credentialSource === "provider-profile";
    if (!consumes) throw fail("permission-denied");
    const delivery = connection ? [...(connection.credentialDelivery ?? [])] : [];
    if (!delivery.includes("session-environment")) throw fail("permission-denied");

    if (typeof allProviderProfiles !== "function") throw fail("runtime-unavailable");
    const profiles = await allProviderProfiles();
    const profile = profiles.find((candidate) => candidate?.id === providerProfileId);
    if (!profile) throw fail("permission-denied");
    // Host-owned identity mapping. Unknown identity fails closed; protocol
    // alone is never sufficient.
    const mapping = resolvePiNativeProvider(profile);
    if (!mapping) throw fail("permission-denied");

    if (selectedModel) {
      const catalog = typeof allModelCatalog === "function" ? await allModelCatalog() : [];
      const entry = catalog.find((candidate) => candidate?.model === selectedModel &&
        candidate?.providerId === providerProfileId);
      if (!entry) throw fail("permission-denied");
    }

    // Binding + grant gate. The host wires this to the registry authorize
    // (addon identity -> approved binding -> grant). A revocation flips this
    // gate and fences any new launch material. Required: no default allow.
    if (typeof authorize !== "function") throw fail("runtime-unavailable");
    try {
      await authorize({ addonId, providerProfileId });
    } catch (error) {
      throw fail(publicHarnessError(error).code);
    }

    const executable = typeof resolveExecutable === "function"
      ? await resolveExecutable({ platform: process.platform })
      : null;
    if (!executable || typeof executable.command !== "string" || !executable.command) {
      throw fail("runtime-unavailable");
    }

    let secret;
    if (typeof credentialEnv === "function") {
      secret = await credentialEnv({ providerProfileId, piProvider: mapping.piProvider, envVar: mapping.envVar });
    }
    if (typeof secret !== "string" || !secret) throw fail("runtime-unavailable");

    const env = buildSessionEnvironment({
      baseEnv,
      envAllowlist,
      parentEnv: process.env,
      credentialName: mapping.envVar,
      credentialValue: secret,
    });
    const argv = [];
    if (mapping.piProvider) argv.push("--provider", mapping.piProvider);
    if (selectedModel) argv.push("--model", selectedModel);
    // `--api-key` is never used: the secret is delivered only via env.

    return Object.freeze({
      addonId,
      providerProfileId,
      providerType: typeof profile.providerType === "string" ? profile.providerType : null,
      piProvider: mapping.piProvider,
      envVar: mapping.envVar,
      selectedModel: selectedModel ?? null,
      credentialMechanism: "session-environment",
      executable: Object.freeze({ ...executable }),
      argv: Object.freeze(argv),
      env,
      projectPath,
      plannedAt: now(),
    });
  }

  return { plan };
}

// Secret-free projection for audit/UI/logs/evidence. Recursively strips the
// private env, emits only its key NAMES, redacts home paths, and never
// includes a credential.
export function redactLaunchPlan(plan, { homeDir } = {}) {
  const { env, ...safe } = plan ?? {};
  const redactPath = (value) => {
    if (typeof value !== "string") return value;
    if (homeDir && value.startsWith(homeDir)) return `~${value.slice(homeDir.length)}`;
    return value;
  };
  return {
    ...safe,
    projectPath: redactPath(safe.projectPath),
    executable: safe.executable
      ? { ...safe.executable, command: redactPath(safe.executable.command), canonicalPath: redactPath(safe.executable.canonicalPath) }
      : null,
    argv: [...(safe.argv ?? [])],
    envKeys: redactEnvironment(env),
  };
}
