// Host wiring for the reviewed native Pi session-credential chain (P2-A →
// testing phase). Composes the plan-only credential adapter
// (pi-native-credential-adapter.mjs) with the bounded process launcher
// (pi-process-launcher.mjs) so the private launch plan flows directly:
//
//   host -> Pi credential planner -> private launch material -> process launcher
//
// The host supplies every authority; nothing is read from a manifest or caller:
//   * allProviderProfiles / allModelCatalog   -> providerHost
//   * credential resolution                   -> resolveProviderProfileCredential
//                                                (ROS provider/vault mechanism)
//   * binding + grant authorization           -> authorize (clean registry gate)
//   * session cwd                             -> consumeProjection (host-wired
//                                                Project/Files projection; a
//                                                caller path is never accepted)
//   * executable                              -> piCommand() (reviewed allowlist)
//
// The raw plan (secret-bearing env) never leaves this service. Only
// redactLaunchPlan() output crosses an observability/UI boundary.
import { createPiNativeCredentialAdapter, redactLaunchPlan } from "./pi-native-credential-adapter.mjs";
import { createPiProcessLauncher } from "./pi-process-launcher.mjs";
import { piCommand } from "./pi-runtime.mjs";

export function createPiNativeSessionService({
  providerHost,
  resolveProviderProfileCredential,
  authorize,
  consumeProjection,
  resolveExecutable = () => piCommand(),
  envAllowlist = [],
  baseEnv = {},
  launcher,
  homeDir,
  now,
} = {}) {
  if (!providerHost || typeof providerHost.allProviderProfiles !== "function" ||
      typeof providerHost.allModelCatalog !== "function") throw new TypeError("Authoritative provider host required.");
  if (typeof resolveProviderProfileCredential !== "function") throw new TypeError("Credential resolver required.");
  if (typeof authorize !== "function") throw new TypeError("Host-wired authorize required.");
  // The session cwd is never a caller-supplied path: the planner re-validates an
  // authorized Project/Files projection through this host-wired consumer.
  if (typeof consumeProjection !== "function") throw new TypeError("Host-wired projection consumer required.");

  const adapter = createPiNativeCredentialAdapter({
    resolveExecutable,
    allProviderProfiles: providerHost.allProviderProfiles.bind(providerHost),
    allModelCatalog: providerHost.allModelCatalog.bind(providerHost),
    // A credential enters only through this hook, under the host-owned env var
    // the mapping resolved. It is returned to the adapter as a bare value and
    // placed in the private session env; it never reaches argv or a projection.
    // A resolver miss reads as "not configured" and fails closed upstream.
    credentialEnv: async ({ providerProfileId }) => {
      try {
        const resolved = await resolveProviderProfileCredential(providerProfileId);
        return typeof resolved?.actionToken === "string" ? resolved.actionToken : undefined;
      } catch {
        return undefined;
      }
    },
    authorize,
    consumeProjection,
    envAllowlist,
    baseEnv,
    now,
  });

  const launch = launcher ?? createPiProcessLauncher();

  return Object.freeze({
    // Private: returns the raw launch plan. Callers must never serialize it.
    async createLaunchPlan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId } = {}) {
      return adapter.plan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId });
    },

    // Plan + launch + evidence. The raw plan is never returned; only its
    // redacted projection and the sanitized process evidence cross this boundary.
    async launchProof({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId, prompt } = {}) {
      const privatePlan = await adapter.plan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId });
      const evidence = await launch.launch(privatePlan, { prompt });
      return {
        projection: redactLaunchPlan(privatePlan, { homeDir }),
        evidence,
      };
    },

    redact(privatePlan, options = {}) {
      return redactLaunchPlan(privatePlan, { homeDir, ...options });
    },
  });
}
