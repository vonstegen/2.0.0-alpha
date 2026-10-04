// Generic Harness Provider Connection session-environment delivery (P1.1).
//
// Builds INTERNAL, host-owned child-process launch environment for reviewed
// native harness adapters (Pi is the only reviewed native adapter today). A
// credential enters ONLY under the host-owned env NAME the caller resolved from
// the host mapping (pi-native-provider-map.mjs); the secret value never
// reaches argv, a projection, a log, evidence, or any durable store.
//
// The env name is host-owned by construction: this module accepts a single
// `credentialName` the caller already derived from the host mapping. It never
// reads an env name from a manifest or a caller-supplied map, so a harness
// cannot propose its own variable name.
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

export function buildSessionEnvironment({
  baseEnv = {},
  envAllowlist = [],
  parentEnv = {},
  credentialName,
  credentialValue,
} = {}) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (ENV_NAME.test(key) && typeof value === "string" && value) env[key] = value;
  }
  for (const key of envAllowlist ?? []) {
    if (typeof key === "string" && ENV_NAME.test(key) && Object.hasOwn(parentEnv, key) &&
        typeof parentEnv[key] === "string" && !(key in env)) {
      env[key] = parentEnv[key];
    }
  }
  if (typeof credentialName === "string" && ENV_NAME.test(credentialName) &&
      typeof credentialValue === "string" && credentialValue) {
    env[credentialName] = credentialValue;
  }
  return env;
}

// Environment key NAMES only, never values. Safe for audit/UI/log projections.
export function redactEnvironment(env) {
  if (!env || typeof env !== "object") return [];
  return Object.keys(env).filter((key) => ENV_NAME.test(key)).sort();
}

export { ENV_NAME as SESSION_ENV_NAME_PATTERN };
