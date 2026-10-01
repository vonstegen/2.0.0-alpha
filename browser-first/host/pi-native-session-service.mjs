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
    // An optional AbortSignal reaches the launcher's deterministic kill path
    // (SIGTERM → SIGKILL) so a cancelled turn terminates the real Pi process.
    async launchProof({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId, prompt, signal } = {}) {
      const privatePlan = await adapter.plan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId });
      const evidence = await launch.launch(privatePlan, { prompt, signal });
      return {
        projection: redactLaunchPlan(privatePlan, { homeDir }),
        evidence,
      };
    },

    // Executable readiness: the allowlisted piCommand() must resolve before any
    // session is granted. Fails closed when no reviewed executable is present.
    async probe() {
      try {
        const executable = await resolveExecutable({ platform: process.platform });
        return { available: Boolean(executable?.command) };
      } catch {
        return { available: false };
      }
    },

    // Interactive TUI session (2D). Same clean chain as launchProof — plan,
    // authorize, credential, projection-consumed cwd — but spawns the real Pi
    // TUI in a pseudo-TTY via the launcher's interactive mode. The caller owns
    // the returned handle: write()/resize()/cancel() and the onData/onExit
    // callbacks. Only the redacted plan projection crosses this boundary.
    //
    // Session continuity is host-owned: `--session-dir` points into the
    // isolated agent dir (baseEnv PI_CODING_AGENT_DIR), never the user's
    // durable Pi data, so --continue/--resume inside the TUI stay disposable.
    async startSession({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId, cols, rows, initialPrompt, onData, onExit, signal } = {}) {
      const privatePlan = await adapter.plan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId });
      const isolatedDir = privatePlan.env?.PI_CODING_AGENT_DIR;
      const argv = typeof isolatedDir === "string" && isolatedDir
        ? [...privatePlan.argv, "--session-dir", `${isolatedDir}/sessions`]
        : privatePlan.argv;
      const handle = launch.launchInteractive(
        { ...privatePlan, argv },
        { cols, rows, initialPrompt, onData, onExit, signal },
      );
      return {
        projection: redactLaunchPlan(privatePlan, { homeDir }),
        handle,
      };
    },

    redact(privatePlan, options = {}) {
      return redactLaunchPlan(privatePlan, { homeDir, ...options });
    },
  });
}
