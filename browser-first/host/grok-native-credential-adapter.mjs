// Grok native credential adapter. Builds INTERNAL host-owned launch material
// for the official Grok CLI ("Grok Build") through the same session-
// environment delivery chain as the reviewed native Pi harness:
//
//   addon identity -> approved provider profile -> host-derived protocol gate
//        -> host-owned identity mapping -> host-owned env var
//        -> approved executable -> selected model
//        -> authorized Project/Files projection (host-wired consume -> cwd)
//        -> authorize (binding + grant, host-wired) -> secret-free argv + env
//
// This adapter is a pure planner: it resolves launch material, never spawns a
// process, opens a PTY, or exposes a route. The runtime-adapter chat path
// (harness-provider-adapter.mjs / harness-credentials.mjs) is unchanged. A
// credential enters only through the injected `credentialEnv` hook and is
// placed under the mapping's host-owned env var (XAI_API_KEY); it never
// appears in argv, the returned projection, an error, or any durable store.
// Unknown mapping, a harness that does not accept session-environment, a
// missing executable, or a missing credential all fail closed.
//
// Grok CLI isolation (countermeasure — same shape as PI_CODING_AGENT_DIR):
// the host-owned baseEnv sets GROK_HOME to a disposable per-user-root directory,
// so the durable ~/.grok/auth.json (OIDC login, config, leader socket, sessions)
// is invisible to harness turns. The session-environment credential is the ONLY
// key source.
import path from "node:path";
import process from "node:process";
import { publicHarnessError } from "./harness-adapter-contract.mjs";
import { deriveProviderProtocol } from "./provider-fabric-core.mjs";
import { resolveGrokNativeProvider } from "./grok-native-provider-map.mjs";
import { buildSessionEnvironment, redactEnvironment } from "./harness-session-environment.mjs";

const fail = (code) => Object.assign(new Error(publicHarnessError({ code }).message), { code });

export function createGrokNativeCredentialAdapter({
  resolveExecutable,
  allProviderProfiles,
  allModelCatalog,
  credentialEnv,
  authorize,
  consumeProjection,
  envAllowlist = [],
  baseEnv = {},
  now = () => new Date().toISOString(),
} = {}) {
  async function plan(input = {}) {
    const { addonId, manifest, providerProfileId, selectedModel, projection, sessionId } = input ?? {};
    console.error(JSON.stringify({ event: "grok.planner.enter", addonId, providerProfileId, hasManifest: Boolean(manifest), manifestId: manifest?.id, hasProjection: Boolean(projection) }));
    if (typeof addonId !== "string" || !addonId) throw fail("permission-denied");
    // The launch cwd is NEVER a caller-supplied path. It must be the cwd of an
    // already-authorized Project/Files session projection, re-validated against
    // CURRENT host state (identity + grant) before use. A raw caller path is
    // ignored; a missing/invalid/stale/revoked projection fails closed.
    if (typeof consumeProjection !== "function") throw fail("runtime-unavailable");
    let consumed;
    try {
      consumed = await consumeProjection(projection, { addonId, sessionId });
    } catch (error) {
      throw fail(publicHarnessError(error).code);
    }
    const projectPath = consumed?.ok === true && typeof consumed.projection?.cwd === "string"
      ? consumed.projection.cwd
      : null;
    if (!projectPath || !path.isAbsolute(projectPath) || /[\0\n]/.test(projectPath)) {
      throw fail("permission-denied");
    }

    const connection = manifest?.harnessProviderConnection;
    const consumes = connection
      ? connection.consumesProviderProfiles === true
      : manifest?.agentRuntime?.credentialSource === "provider-profile";
    if (!consumes) throw fail("permission-denied");
    const delivery = connection ? [...(connection.credentialDelivery ?? [])] : [];
    if (!delivery.includes("session-environment")) throw fail("permission-denied");
    const protocols = connection ? [...(connection.providerProtocols ?? [])] : [];

    if (typeof allProviderProfiles !== "function") throw fail("runtime-unavailable");
    const profiles = await allProviderProfiles();
    const profile = profiles.find((candidate) => candidate?.id === providerProfileId);
    if (!profile) throw fail("permission-denied");
    // Host-derived protocol compatibility gate. Re-derived from the selected
    // profile's host providerType, never from a manifest, caller, template
    // label, or a spoofable profile field. The Grok CLI speaks the OpenAI-
    // compatible wire; only that protocol qualifies.
    const providerProtocol = deriveProviderProtocol(profile);
    if (!providerProtocol || !protocols.includes(providerProtocol)) throw fail("permission-denied");
    // Host-owned identity mapping. Unknown identity fails closed; protocol
    // compatibility alone is never sufficient.
    const mapping = resolveGrokNativeProvider(profile);
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
      await authorize({ addonId, adapterId: "grok-native-v1", providerProfileId });
    } catch (error) {
      throw fail(publicHarnessError(error).code);
    }

    const executable = typeof resolveExecutable === "function"
      ? await resolveExecutable({ platform: process.platform })
      : null;
    console.error(JSON.stringify({ event: "grok.planner.executable_check", addonId, executable: executable ? { command: executable.command, source: executable.source } : null }));
    if (!executable || typeof executable.command !== "string" || !executable.command) {
      throw fail("runtime-unavailable");
    }

    let secret;
    if (typeof credentialEnv === "function") {
      secret = await credentialEnv({ providerProfileId, envVar: mapping.envVar });
    }
    if (typeof secret !== "string" || !secret) throw fail("runtime-unavailable");

    const env = buildSessionEnvironment({
      baseEnv,
      envAllowlist,
      parentEnv: process.env,
      credentialName: mapping.envVar,
      credentialValue: secret,
    });
    // Grok CLI argv: --cwd <projectPath>, --model <selectedModel>. No provider
    // flag (the CLI is single-provider xAI). No --api-key — the credential is
    // delivered only via env.
    const argv = ["--cwd", projectPath];
    if (selectedModel) argv.push("--model", selectedModel);

    return Object.freeze({
      addonId,
      providerProfileId,
      providerType: typeof profile.providerType === "string" ? profile.providerType : null,
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
    executable: safe.executable && {
      ...safe.executable,
      command: redactPath(safe.executable.command),
      canonicalPath: redactPath(safe.executable.canonicalPath),
    },
    envKeys: redactEnvironment(env ?? {}),
  };
}
