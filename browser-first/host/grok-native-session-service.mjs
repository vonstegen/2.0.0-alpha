// Host wiring for the reviewed Grok CLI ("Grok Build") session-credential
// chain (testing phase, grok-native-v1). Composes the plan-only credential
// adapter (grok-native-credential-adapter.mjs) with the bounded process
// launcher (pi-process-launcher.mjs — its PTY mode is binary-agnostic) so the
// private launch plan flows directly:
//
//   host -> Grok credential planner -> private launch material -> process launcher
//
// The host supplies every authority; nothing is read from a manifest or caller:
//   * allProviderProfiles / allModelCatalog   -> providerHost
//   * credential resolution                   -> resolveProviderProfileCredential
//                                                (ROS provider/vault mechanism)
//   * binding + grant authorization           -> authorize (clean registry gate)
//   * session cwd                             -> consumeProjection (host-wired
//                                                Project/Files projection; a
//                                                caller path is never accepted)
//   * executable                              -> grokCommand() (reviewed allowlist)
//
// The raw plan (secret-bearing env) never leaves this service. Only
// redactLaunchPlan() output crosses an observability/UI boundary.
//
// Scope: this service exposes ONLY the TUI session surface today. The headless
// proof route lives in pi-native-session-service.mjs for the pi chain; if/when
// a Grok headless chat surface lands it composes a separate planner/launcher
// pair (grok -p --output-format streaming-json) and gets its own proof route.
//
// Session continuity is host-owned via GROK_HOME isolation: baseEnv points
// GROK_HOME at a disposable per-user-root directory so the durable ~/.grok
// (auth.json, config, leader socket, session records) is invisible to harness
// turns, and the session-environment credential is the only key source. Grok
// stores session records under $GROK_HOME/sessions automatically — no
// `--session-dir` flag is required (and none exists on the grok CLI).
import { createGrokNativeCredentialAdapter, redactLaunchPlan } from "./grok-native-credential-adapter.mjs";
import { createPiProcessLauncher } from "./pi-process-launcher.mjs";
import { grokCommand } from "./grok-runtime.mjs";

export function createGrokNativeSessionService({
  providerHost,
  resolveProviderProfileCredential,
  authorize,
  consumeProjection,
  resolveExecutable = () => grokCommand(),
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
  if (typeof consumeProjection !== "function") throw new TypeError("Host-wired projection consumer required.");

  const adapter = createGrokNativeCredentialAdapter({
    resolveExecutable,
    allProviderProfiles: providerHost.allProviderProfiles.bind(providerHost),
    allModelCatalog: providerHost.allModelCatalog.bind(providerHost),
    credentialEnv: async ({ providerProfileId, envVar }) => {
      try {
        const resolved = await resolveProviderProfileCredential(providerProfileId);
        // The grok planner resolves the env var internally; the resolver here
        // only returns the credential value. The secret is bound to its env
        // var name inside the adapter's plan().
        if (typeof resolved?.actionToken === "string") {
          return { [envVar]: resolved.actionToken };
        }
        return undefined;
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
    // Executable readiness: the allowlisted grokCommand() must resolve before
    // any session is granted. Fails closed when no reviewed executable is present.
    async probe() {
      try {
        const executable = await resolveExecutable({ platform: process.platform });
        return { available: Boolean(executable?.command) };
      } catch {
        return { available: false };
      }
    },

    // Interactive TUI session. Same clean chain as pi-native startSession:
    // plan, authorize, credential, projection-consumed cwd. Spawns the real
    // Grok CLI TUI in a pseudo-TTY via the launcher's interactive mode (which
    // is binary-agnostic — it consumes plan.command/argv/env/projectPath).
    // Session continuity is implicit: grok stores session records under
    // $GROK_HOME/sessions, so no extra flag is appended.
    async startSession({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId, cols, rows, initialPrompt, onData, onExit, signal } = {}) {
      const privatePlan = await adapter.plan({ addonId, manifest, providerProfileId, selectedModel, projection, sessionId });
      const handle = launch.launchInteractive(privatePlan, {
        cols, rows, initialPrompt, onData, onExit, signal,
      });
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
